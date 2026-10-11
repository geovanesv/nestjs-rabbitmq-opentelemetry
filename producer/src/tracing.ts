// Arquivo crítico de tracing (RFC §7.1 / F-08).
// DEVE ser importado como a PRIMEIRA linha de main.ts (D-004): a instrumentação
// de amqplib depende de module hooks carregados depois do sdk.start().
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

const DEFAULT_TRACES_ENDPOINT = 'http://localhost:4318/v1/traces';

// Precedência de endpoint (D-010), normalizando barra final para evitar
// /v1/traces/v1/traces e perda silenciosa de traces.
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
      process.env.OTEL_SERVICE_NAME || 'producer-service',
    [SemanticResourceAttributes.SERVICE_VERSION]:
      process.env.SERVICE_VERSION || '1.0.0',
    [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]:
      process.env.NODE_ENV || 'development',
  }),
  traceExporter,
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
