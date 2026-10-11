// Arquivo crítico de tracing (RFC §7.1 / F-08).
// DEVE ser importado como a PRIMEIRA linha de main.ts (D-004): a instrumentação
// de amqplib depende de module hooks carregados depois do sdk.start().
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

const DEFAULT_OTLP_ENDPOINT = 'http://localhost:4318';

// Precedência de endpoint por sinal (D-010 + D-032/D-034): env específico
// (*_ENDPOINT) → base OTEL_EXPORTER_OTLP_ENDPOINT + path → default local.
const ENDPOINT_PATH: Record<'traces' | 'metrics' | 'logs', string> = {
  traces: '/v1/traces',
  metrics: '/v1/metrics',
  logs: '/v1/logs',
};

const ENDPOINT_ENV: Record<'traces' | 'metrics' | 'logs', string> = {
  traces: 'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
  metrics: 'OTEL_EXPORTER_OTLP_METRICS_ENDPOINT',
  logs: 'OTEL_EXPORTER_OTLP_LOGS_ENDPOINT',
};

function resolveEndpoint(signal: 'traces' | 'metrics' | 'logs'): string {
  const explicit = process.env[ENDPOINT_ENV[signal]];
  if (explicit) return explicit;
  const base = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const path = ENDPOINT_PATH[signal];
  if (base) return `${base.replace(/\/+$/, '')}${path}`;
  return `${DEFAULT_OTLP_ENDPOINT}${path}`;
}

const traceExporter = new OTLPTraceExporter({
  url: resolveEndpoint('traces'),
});

const metricReader = new PeriodicExportingMetricReader({
  exporter: new OTLPMetricExporter({ url: resolveEndpoint('metrics') }),
  // Intervalo curto em dev (D-032) para a verificação E2E ser determinística.
  exportIntervalMillis: Number(
    process.env.OTEL_METRIC_EXPORT_INTERVAL_MS || 3000,
  ),
});

const logRecordProcessor = new BatchLogRecordProcessor(
  new OTLPLogExporter({ url: resolveEndpoint('logs') }),
);

export const sdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]:
      process.env.OTEL_SERVICE_NAME || 'producer-service',
    [SemanticResourceAttributes.SERVICE_VERSION]:
      process.env.SERVICE_VERSION || '1.0.0',
    [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]:
      process.env.NODE_ENV || 'development',
  }),
  traceExporter,
  metricReader,
  logRecordProcessor,
  instrumentations: [
    getNodeAutoInstrumentations({
      // amqplib habilitado UMA única vez (D-005); fs desabilitado por ruído.
      '@opentelemetry/instrumentation-amqplib': { enabled: true },
      '@opentelemetry/instrumentation-fs': { enabled: false },
      '@opentelemetry/instrumentation-http': { enabled: true },
    }),
  ],
});

sdk.start();

// Flush do BatchSpanProcessor no shutdown (D-017). Erros são engolidos (D-020).
export async function shutdownTracing(): Promise<void> {
  try {
    await sdk.shutdown();
  } catch (error) {
    console.error('Falha ao encerrar tracing', error);
  }
}
