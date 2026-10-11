// Helper puro de extração de headers de trace do registro do RabbitMQ
// (RFC §7.6 / D-007 / F-29).
// É UMA função pura (sem dependência do Nest) para permitir o teste unitário F-36.
// Sem traceparent, emite warning UMA única vez (evita flood — D-020) e a
// extração retorna {} — o processamento segue normalmente.

// Aceita apenas chaves de propagação W3C/labels antigos do OpenTracing.
const ALLOWED_KEYS = /^(traceparent|tracestate|baggage|ot-tracer-.*)$/;

let warnedOnce = false;

function warnMissingTraceParent(): void {
  if (warnedOnce) return;
  warnedOnce = true;
  // console.warn (e não Logger do Nest) para manter a função pura/testável.
  console.warn(
    '[extractTraceHeaders] headers traceparent não encontrados — continua sem contexto de trace (D-020)',
  );
}

// `source` pode ser o RmqRecord do Nest em vários formatos (RFC §7.6).
export function extractTraceHeaders(source: unknown): Record<string, string> {
  let headers: unknown = undefined;

  const candidate = (source as { headers?: unknown } | null)?.headers;
  if (candidate !== undefined && candidate !== null) {
    headers = candidate;
  } else {
    const properties = (source as { properties?: { headers?: unknown } } | null)
      ?.properties;
    headers = properties?.headers;
  }

  if (headers === undefined || headers === null || typeof headers !== 'object') {
    warnMissingTraceParent();
    return {};
  }

  const result: Record<string, string> = {};
  let foundTraceParent = false;
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (!ALLOWED_KEYS.test(key)) continue;
    if (typeof value !== 'string') continue;
    if (key === 'traceparent') foundTraceParent = true;
    result[key] = value;
  }

  if (!foundTraceParent) {
    warnMissingTraceParent();
  }
  return result;
}