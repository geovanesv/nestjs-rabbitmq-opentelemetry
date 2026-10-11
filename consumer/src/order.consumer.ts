// Handler de processamento de pedidos do consumer (RFC §7.3 / D-007/D-019/D-021 / F-28).
// Fecha a continuidade do trace: extrai o contexto do traceparent e cria o span
// manual `handleOrderCreated` como filho do pai remoto (herdado do producer).
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
import { extractTraceHeaders } from './tracing/extract-trace-context';

const PROCESSING_DURATION_MS = 500;

@Controller()
export class OrderConsumer {
  private readonly logger = new Logger(OrderConsumer.name);
  // Nome do tracer igual ao service.name do Resource (RFC §7.3).
  private readonly tracer = trace.getTracer('consumer-service');

  @EventPattern('order.created')
  handleOrderCreated(
    @Payload() order: Order,
    @Ctx() ctx: RmqContext,
  ): Promise<void> {
    // D-007: extração EXPLÍCITA do contexto usando os headers do RmqRecord.
    const message = ctx.getMessage();
    const headers = extractTraceHeaders(message);
    const parent = propagation.extract(ROOT_CONTEXT, headers);
    return context.with(parent, () => this.process(order));
  }

  private async process(order: Order): Promise<void> {
    const span = this.tracer.startSpan('handleOrderCreated');
    try {
      span.setAttributes({
        'order.id': order.id,
        'order.customer_id': order.customerId,
        'order.amount': order.amount,
        'messaging.system': 'rabbitmq',
        'messaging.operation.type': 'process',
      });
      span.addEvent('order_received', {
        orderId: order.id,
        'queue.name': config.orderQueue,
      });

      this.logger.log(`Processing order: ${order.id}`);

      // D-021: falha injetada apenas na varredura de 0..rate (0 = nunca falha).
      if (config.simulateFailureRate > 0 &&
          Math.random() < config.simulateFailureRate) {
        throw new Error(`Falha simulada ao processar o pedido ${order.id}`);
      }

      // Simula trabalho de processamento (observável na duração do span — FR-012).
      await sleep(PROCESSING_DURATION_MS);

      span.addEvent('order_processed', {
        'processing.duration_ms': PROCESSING_DURATION_MS,
      });
      this.logger.log(`Order ${order.id} processed successfully`);
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      // D-019: sem requeue — ack implícito evita loop infinito (sem DLQ na v1).
      this.logger.error(`Error processing order ${order.id}: ${(error as Error).message}`);
    } finally {
      span.end();
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}