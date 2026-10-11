// Métricas do producer (RFC §7.9 / D-033 / F-48).
// Singleton: cada instrumento é registrado UMA única vez no MeterProvider
// global (registrar 2× com o mesmo nome geraria série duplicada no /metrics).
import { metrics } from '@opentelemetry/api';

const SERVICE_NAME = process.env.OTEL_SERVICE_NAME || 'producer-service';
const SERVICE_VERSION = process.env.SERVICE_VERSION || '1.0.0';

const meter = metrics.getMeter(SERVICE_NAME, SERVICE_VERSION);

export const ordersCreatedCounter = meter.createCounter('orders.created', {
  description: 'Pedidos criados e publicados em orders_queue',
  unit: '{order}',
});

export const ordersCreationDuration = meter.createHistogram(
  'orders.creation.duration',
  {
    description: 'Latência da criação de pedido (create → publish), em ms',
    unit: 'ms',
  },
);