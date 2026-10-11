// Configuração tipada do consumer, lida de variáveis de ambiente (RFC §5.2).
// Inclui SIMULATE_FAILURE_RATE (D-021), injetor de erro demonstrável.
export interface ConsumerConfig {
  rabbitmqUrl: string;
  orderQueue: string;
  otelServiceName: string;
  serviceVersion: string;
  nodeEnv: string;
  simulateFailureRate: number;
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

export const config: ConsumerConfig = {
  rabbitmqUrl:
    process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672',
  orderQueue: process.env.ORDER_QUEUE || 'orders_queue',
  otelServiceName: process.env.OTEL_SERVICE_NAME || 'consumer-service',
  serviceVersion: process.env.SERVICE_VERSION || '1.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  simulateFailureRate: readFailureRate(process.env.SIMULATE_FAILURE_RATE),
  logLevel: process.env.LOG_LEVEL || 'log',
};