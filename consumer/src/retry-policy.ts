// Política pura de retry/DLQ do consumer (v1.1 — RFC §7.2.1 / D-027 / D-028 / F-44).
// Funções puras (sem dependência do Nest/amqplib) para permitir teste unitário
// determinístico (F-46). Semântica: `x-retry-count` = reprocessamentos já
// agendados; `tentativa` corrente = `x-retry-count + 1`. Uma falha na tentativa
// em que `tentativa <= MAX_RETRIES` é retryável; acima disso, vira DLQ (D-028).

const RETRY_COUNT_HEADER = 'x-retry-count';

export function nextAttempt(headers: Record<string, unknown> | undefined): number {
  const raw = headers?.[RETRY_COUNT_HEADER];
  const parsed = typeof raw === 'number' ? raw : Number(String(raw ?? ''));
  const base = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
  return base + 1;
}

export function isExhausted(
  headers: Record<string, unknown> | undefined,
  maxRetries: number,
): boolean {
  return nextAttempt(headers) > maxRetries;
}

// Backoff multiplicativo: a TTL da mensagem de retry cresce com a tentativa
// (1×, 2×, 3× o RETRY_TTL_MS) — expiration por-mensagem (D-027).
export function retryTtlForAttempt(attempt: number, baseTtlMs: number): number {
  return Math.max(1, Math.round(baseTtlMs * attempt));
}