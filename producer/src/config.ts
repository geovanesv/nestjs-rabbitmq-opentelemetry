// Configuração tipada do producer, lida de variáveis de ambiente (RFC §5.2).
// Todos os valores têm default de desenvolvimento — nenhum segredo no código.

export interface ProducerConfig {
  port: number;
  rabbitmqUrl: string;
  orderQueue: string;
  otelServiceName: string;
  serviceVersion: string;
  nodeEnv: string;
  logLevel: string;
}

function readNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && value !== undefined && value !== ''
    ? parsed
    : fallback;
}

export const config: ProducerConfig = {
  port: readNumber(process.env.PORT, 3001),
  rabbitmqUrl:
    process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672',
  orderQueue: process.env.ORDER_QUEUE || 'orders_queue',
  otelServiceName: process.env.OTEL_SERVICE_NAME || 'producer-service',
  serviceVersion: process.env.SERVICE_VERSION || '1.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'log',
};
