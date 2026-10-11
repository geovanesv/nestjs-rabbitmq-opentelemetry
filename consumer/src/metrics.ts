// Métricas do consumer (RFC §7.9 / D-033 / F-49).
// Singleton: cada instrumento é registrado UMA única vez no MeterProvider global.
import { metrics } from '@opentelemetry/api';

const SERVICE_NAME = process.env.OTEL_SERVICE_NAME || 'consumer-service';
const SERVICE_VERSION = process.env.SERVICE_VERSION || '1.0.0';

const meter = metrics.getMeter(SERVICE_NAME, SERVICE_VERSION);

export const ordersConsumedCounter = meter.createCounter('orders.consumed', {
  description: 'Mensagens order.created recebidas pelo consumer',
  unit: '{order}',
});

export const ordersDeadLetteredCounter = meter.createCounter(
  'orders.dead_lettered',
  {
    description: 'Mensagens enviadas ao DLQ após falha terminal',
    unit: '{order}',
  },
);