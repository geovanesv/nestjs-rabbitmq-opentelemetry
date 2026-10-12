// SpanProcessor que normaliza nomes de spans de messaging conforme o semconv
// (RFC §7.12 / D-039 / F-58). Atua APENAS em spans do instrumentador amqplib
// (discriminador: `messaging.rabbitmq.routing_key` presente): renomeia para o
// template `{destination} {operation}` (ex.: `orders_queue publish`) e faz
// backfill dos atributos semconv novos, mantendo os antigos.
// Spans de negócio (`createOrder`) NÃO passam por aqui — o contrato M3
// (RFC §10) depende dos nomes intactos.
import { Context, SpanAttributes, SpanKind } from '@opentelemetry/api';
import { ReadableSpan, Span } from '@opentelemetry/sdk-trace-base';

const MESSAGING_SYSTEM = 'messaging.system';
const MESSAGING_DESTINATION_NAME = 'messaging.destination.name';
const MESSAGING_OPERATION_TYPE = 'messaging.operation.type';
const MESSAGING_OPERATION = 'messaging.operation';
const MESSAGING_ROUTING_KEY = 'messaging.rabbitmq.routing_key';

export class MessagingSemconvSpanProcessor {
  onStart(span: Span, _parentContext: Context): void {
    const attrs: SpanAttributes = span.attributes;
    if (attrs[MESSAGING_SYSTEM] !== 'rabbitmq') return;
    // Discriminador conservador (D-039): só spans do instrumentador amqplib
    // carregam a routing key; spans de negócio ficam intactos (contrato M3).
    const routingKey = attrs[MESSAGING_ROUTING_KEY];
    if (routingKey == null) return;

    const destination = String(attrs[MESSAGING_DESTINATION_NAME] ?? routingKey);
    const operation =
      (attrs[MESSAGING_OPERATION_TYPE] as string | undefined) ??
      (attrs[MESSAGING_OPERATION] as string | undefined) ??
      (span.kind === SpanKind.PRODUCER
        ? 'publish'
        : span.kind === SpanKind.CONSUMER
          ? 'process'
          : null);
    if (!operation) return;

    // Backfill dos atributos semconv novos (mantendo os antigos da instrumentação).
    span.setAttribute(MESSAGING_OPERATION_TYPE, operation);
    span.setAttribute(MESSAGING_DESTINATION_NAME, destination);
    span.updateName(`${destination} ${operation}`);
  }

  onEnd(_span: ReadableSpan): void {
    // Nada a fazer.
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
}