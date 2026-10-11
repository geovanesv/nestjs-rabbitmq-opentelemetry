// Configuração tipada do consumer, lida de variáveis de ambiente (RFC §5.2).
// Inclui SIMULATE_FAILURE_RATE (D-021) e, desde a v1.1, o bloco DLQ/retry/
// idempotência (D-026..D-029) e o controle de ack (D-030).
export interface ConsumerConfig {
  rabbitmqUrl: string;
  orderQueue: string;
  orderQueueDlq: string;
  orderQueueRetry: string;
  otelServiceName: string;
  serviceVersion: string;
  nodeEnv: string;
  simulateFailureRate: number;
  maxRetries: number;
  retryTtlMs: number;
  idempotencyTtlMs: number;
  idempotencyMaxEntries: number;
  logLevel: string;
}

// Clamp do SIMULATE_FAILURE_RATE no intervalo 0..1.
function readFailureRate(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || value === undefined || value === '') {
    return 0;
  }
  return Math.min(1, Math.max(0, parsed));
}

// Inteiro positivo com default (usa em MAX_RETRIES, RETRY_TTL_MS e limites da store).
function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

export const config: ConsumerConfig = {
  rabbitmqUrl:
    process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672',
  orderQueue: process.env.ORDER_QUEUE || 'orders_queue',
  orderQueueDlq: process.env.ORDER_QUEUE_DLQ || 'orders_queue.dlq',
  orderQueueRetry: process.env.ORDER_QUEUE_RETRY || 'orders_queue.retry',
  otelServiceName: process.env.OTEL_SERVICE_NAME || 'consumer-service',
  serviceVersion: process.env.SERVICE_VERSION || '1.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  simulateFailureRate: readFailureRate(process.env.SIMULATE_FAILURE_RATE),
  maxRetries: readPositiveInt(process.env.MAX_RETRIES, 3),
  retryTtlMs: readPositiveInt(process.env.RETRY_TTL_MS, 2000),
  idempotencyTtlMs: readPositiveInt(process.env.IDEMPOTENCY_TTL_MS, 300000),
  idempotencyMaxEntries: readPositiveInt(
    process.env.IDEMPOTENCY_MAX_ENTRIES,
    10000,
  ),
  logLevel: process.env.LOG_LEVEL || 'log',
};