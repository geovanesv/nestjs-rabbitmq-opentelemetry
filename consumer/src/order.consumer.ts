// Handler de processamento de pedidos do consumer (RFC §7.3 / F-28).
// v1.1: DLQ + retry com backoff + idempotência (D-026..D-030, §7.2.1).
// Todos os caminhos de saída conferem ack/nack explícito (D-030):
//   sucesso/duplicata → ack; falha retryável → republish em orders_queue.retry
//   + ack da original; falha terminal → nack(requeue=false) → DLX/DLQ.
import { Controller, Logger } from '@nestjs/common';
import {
  Ctx,
  EventPattern,
  Payload,
  RmqContext,
} from '@nestjs/microservices';
import {
  context,
  propagation,
  ROOT_CONTEXT,
  trace,
  SpanStatusCode,
} from '@opentelemetry/api';
import { config } from './config';
import { Order } from './order.interface';
import { IdempotencyStore } from './idempotency.store';
import {
  isExhausted,
  nextAttempt,
  retryTtlForAttempt,
} from './retry-policy';
import { extractTraceHeaders } from './tracing/extract-trace-context';

const PROCESSING_DURATION_MS = 500;

// Tipos estruturais mínimos das APIs do amqplib que usamos (evita acoplar
// tipos do módulo no handler — D-030 usa canal/mensagem via RmqContext).
interface AmqpChannel {
  ack(message: unknown, allUpTo?: boolean): void;
  nack(message: unknown, allUpTo?: boolean, requeue?: boolean): void;
  sendToQueue(
    queue: string,
    content: Buffer,
    options?: Record<string, unknown>,
  ): boolean;
}

interface AmqpMessage {
  content: Buffer;
  fields: Record<string, unknown>;
  properties: {
    contentType?: string;
    deliveryMode?: number;
    expiration?: string;
    correlationId?: string;
    replyTo?: string;
    messageId?: string;
    timestamp?: number;
    type?: string;
    userId?: string;
    appId?: string;
    clusterId?: string;
    headers?: Record<string, unknown>;
  };
}

@Controller()
export class OrderConsumer {
  private readonly logger = new Logger(OrderConsumer.name);
  // Nome do tracer igual ao service.name do Resource (RFC §7.3).
  private readonly tracer = trace.getTracer('consumer-service');
  // Idempotência por order.id, limitada por TTL/tamanho (D-029).
  private readonly idempotency = new IdempotencyStore(
    config.idempotencyTtlMs,
    config.idempotencyMaxEntries,
  );

  @EventPattern('order.created')
  async handleOrderCreated(
    @Payload() order: Order,
    @Ctx() ctx: RmqContext,
  ): Promise<void> {
    // D-007: extração EXPLÍCITA do contexto usando os headers do RmqRecord.
    const message = ctx.getMessage() as AmqpMessage;
    const headers = extractTraceHeaders(message);
    const parent = propagation.extract(ROOT_CONTEXT, headers);
    try {
      await context.with(parent, () =>
        this.process(order, (ctx.getChannelRef() as AmqpChannel), message),
      );
    } catch (error) {
      // Failsafe: erro fora do caminho esperado nunca deixa a mensagem órfã
      // (unacked). Vai ao DLQ como falha terminal (D-030).
      this.logger.error(
        `Unhandled failure for order ${order.id}: ${(error as Error).message}`,
      );
      (ctx.getChannelRef() as AmqpChannel).nack(message, false, false);
    }
  }

  private async process(
    order: Order,
    channel: AmqpChannel,
    message: AmqpMessage,
  ): Promise<void> {
    const span = this.tracer.startSpan('handleOrderCreated');
    try {
      const amqpHeaders = message.properties.headers ?? {};
      const attempt = nextAttempt(amqpHeaders);

      span.setAttributes({
        'order.id': order.id,
        'order.customer_id': order.customerId,
        'order.amount': order.amount,
        'messaging.system': 'rabbitmq',
        'messaging.operation.type': 'process',
        'order.retry_attempt': attempt,
      });
      span.addEvent('order_received', {
        orderId: order.id,
        'queue.name': config.orderQueue,
      });

      // Idempotência (D-029): duplicata dentro da janela não re-executa.
      if (this.idempotency.wasProcessed(order.id)) {
        this.logger.warn(
          `Duplicate order ${order.id} skipped (idempotency window)`,
        );
        span.addEvent('order_duplicate_skipped', { orderId: order.id });
        channel.ack(message);
        return;
      }

      this.logger.log(`Processing order: ${order.id}`);

      // D-021: falha injetada apenas na varredura de 0..rate (0 = nunca falha).
      if (
        config.simulateFailureRate > 0 &&
        Math.random() < config.simulateFailureRate
      ) {
        throw new Error(`Falha simulada ao processar o pedido ${order.id}`);
      }

      // Simula trabalho de processamento (observável na duração do span — FR-012).
      await sleep(PROCESSING_DURATION_MS);

      this.idempotency.markProcessed(order.id);
      span.addEvent('order_processed', {
        'processing.duration_ms': PROCESSING_DURATION_MS,
      });
      this.logger.log(`Order ${order.id} processed successfully`);
      channel.ack(message);
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });

      const attempt = nextAttempt(message.properties.headers ?? {});

      // Falha terminal (D-028): tentativa > MAX_RETRIES → DLX/DLQ.
      if (isExhausted(message.properties.headers ?? {}, config.maxRetries)) {
        span.addEvent('order_dead_lettered', {
          orderId: order.id,
          attempt,
          maxRetries: config.maxRetries,
        });
        this.logger.error(
          `Order ${order.id} dead-lettered (attempt ${attempt} > max ${config.maxRetries}): ${(error as Error).message}`,
        );
        channel.nack(message, false, false);
        return;
      }

      // Falha retryável (D-027): ack da original + cópia em orders_queue.retry
      // com backoff multiplicativo, antes do ack (sem perda).
      try {
        this.scheduleRetry(channel, message, attempt);
        span.addEvent('order_retry_scheduled', {
          orderId: order.id,
          attempt,
          delayMs: retryTtlForAttempt(attempt, config.retryTtlMs),
        });
        this.logger.warn(
          `Order ${order.id} failed (attempt ${attempt}/${config.maxRetries + 1}), scheduling retry: ${(error as Error).message}`,
        );
        channel.ack(message);
      } catch (scheduleError) {
        // Se a republicação falhar, a tratamos como terminal → DLQ (mesmo
        // efeito contratual; o span já está com status ERROR).
        span.addEvent('order_dead_lettered', {
          orderId: order.id,
          reason: `retry_publish_failed: ${(scheduleError as Error).message}`,
        });
        this.logger.error(
          `Order ${order.id} dead-lettered (could not schedule retry): ${(scheduleError as Error).message}`,
        );
        channel.nack(message, false, false);
      }
    } finally {
      span.end();
    }
  }

  // Republica a mensagem original em orders_queue.retry preservando headers
  // (inclui traceparent → mesma trace_id nas tentativas) e aplicando o backoff
  // multiplicativo via expiration por-mensagem (D-027).
  private scheduleRetry(
    channel: AmqpChannel,
    message: AmqpMessage,
    attempt: number,
  ): void {
    channel.sendToQueue(config.orderQueueRetry, message.content, {
      contentType: message.properties.contentType ?? 'application/json',
      deliveryMode: message.properties.deliveryMode ?? 2,
      expiration: String(retryTtlForAttempt(attempt, config.retryTtlMs)),
      messageId: message.properties.messageId,
      correlationId: message.properties.correlationId,
      timestamp: message.properties.timestamp,
      headers: {
        ...(message.properties.headers ?? {}),
        'x-retry-count': attempt,
      },
      persistent: true,
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}