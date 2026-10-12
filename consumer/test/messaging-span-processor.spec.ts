// Testes unitários do MessagingSemconvSpanProcessor (RFC §7.12 / D-039 / F-58).
// Determinísticos, sem broker/collector/rede — InMemorySpanExporter local.
import { describe, expect, it } from '@jest/globals';
import { SpanKind } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { MessagingSemconvSpanProcessor } from '../src/messaging-span-processor';

type SpanOut = {
  name: string;
  attributes: Record<string, unknown>;
};

function runThroughProcessor(
  name: string,
  kind: SpanKind,
  attributes: Record<string, string>,
): SpanOut {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider();
  provider.addSpanProcessor(new MessagingSemconvSpanProcessor());
  provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
  const span = provider.getTracer('test').startSpan(name, {
    kind,
    attributes,
  });
  span.end();
  const [readable] = exporter.getFinishedSpans();
  exporter.shutdown();
  if (!readable) throw new Error('nenhum span exported');
  return {
    name: readable.name,
    attributes: { ...readable.attributes } as Record<string, unknown>,
  };
}

describe('MessagingSemconvSpanProcessor (D-039)', () => {
  it('renomeia span producer do amqplib para "<dest> publish" e faz backfill', () => {
    const span = runThroughProcessor(
      '<default> -> orders_queue send',
      SpanKind.PRODUCER,
      {
        'messaging.system': 'rabbitmq',
        'messaging.rabbitmq.routing_key': 'orders_queue',
      },
    );
    expect(span.name).toBe('orders_queue publish');
    expect(span.attributes['messaging.operation.type']).toBe('publish');
    expect(span.attributes['messaging.destination.name']).toBe('orders_queue');
  });

  it('normaliza span consumer (op antiga "process") para "<dest> process"', () => {
    const span = runThroughProcessor(
      'orders_queue process',
      SpanKind.CONSUMER,
      {
        'messaging.system': 'rabbitmq',
        'messaging.rabbitmq.routing_key': 'orders_queue',
        'messaging.operation': 'process',
      },
    );
    expect(span.name).toBe('orders_queue process');
    expect(span.attributes['messaging.operation.type']).toBe('process');
    expect(span.attributes['messaging.destination.name']).toBe('orders_queue');
  });

  it('NÃO renomeia span de negócio (sem routing key) — contrato M3', () => {
    const span = runThroughProcessor('createOrder', SpanKind.INTERNAL, {
      'messaging.system': 'rabbitmq',
      'messaging.destination.name': 'orders_queue',
    });
    expect(span.name).toBe('createOrder');
    expect(span.attributes['messaging.operation.type']).toBeUndefined();
  });

  it('NÃO renomeia handleOrderCreated (span de negócio do consumer)', () => {
    const span = runThroughProcessor('handleOrderCreated', SpanKind.INTERNAL, {
      'messaging.system': 'rabbitmq',
      'messaging.operation.type': 'process',
    });
    expect(span.name).toBe('handleOrderCreated');
  });

  it('ignora spans que não são de messaging', () => {
    const span = runThroughProcessor('POST /orders', SpanKind.SERVER, {
      'http.method': 'POST',
    });
    expect(span.name).toBe('POST /orders');
  });

  it('não renomeia quando não há operação derivável nem routing key', () => {
    const span = runThroughProcessor('whatever send', SpanKind.INTERNAL, {
      'messaging.system': 'rabbitmq',
    });
    expect(span.name).toBe('whatever send');
  });
});