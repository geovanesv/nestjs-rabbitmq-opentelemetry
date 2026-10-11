// Arquivo crítico de tracing do consumer (RFC §7.1 / D-001 / F-21).
// Duplicado intencionalmente do producer (isolamento de microsserviços),
// apenas com o default de SERVICE_NAME = consumer-service.
// DEVE ser o primeiro import de main.ts (D-004).
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

const DEFAULT_TRACES_ENDPOINT = 'http://localhost:4318/v1/traces';

// Precedência de endpoint (D-010), normalizando /v1/traces/v1/traces.
function resolveTracesEndpoint(): string {
  const explicit = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  if (explicit) return explicit;
  const base = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (base) return `${base.replace(/\/+$/, '')}/v1/traces`;
  return DEFAULT_TRACES_ENDPOINT;
}

const traceExporter = new OTLPTraceExporter({
  url: resolveTracesEndpoint(),
});

export const sdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]:
      process.env.OTEL_SERVICE_NAME || 'consumer-service',
    [SemanticResourceAttributes.SERVICE_VERSION]:
      process.env.SERVICE_VERSION || '1.0.0',
    [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]:
      process.env.NODE_ENV || 'development',
  }),
  traceExporter,
  instrumentations: [
    getNodeAutoInstrumentations({
      // amqplib UMA única vez (D-005); fs desabilitado por ruído.
      '@opentelemetry/instrumentation-amqplib': { enabled: true },
      '@opentelemetry/instrumentation-fs': { enabled: false },
      '@opentelemetry/instrumentation-http': { enabled: true },
    }),
  ],
});

sdk.start();

export async function shutdownTracing(): Promise<void> {
  try {
    await sdk.shutdown();
  } catch (error) {
    console.error('Falha ao encerrar tracing', error);
  }
}