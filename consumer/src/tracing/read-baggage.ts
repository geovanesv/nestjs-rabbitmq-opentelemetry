// Leitura do W3C Baggage do contexto (RFC §7.10 / D-037 / F-54).
// Função pura (sem dependência do console/broker) para permitir o teste
// unitário. O baggage é restaurado no contexto pelo propagation.extract
// (D-007) — o propagador composto default (OTEL_PROPAGATORS) inclui o
// W3CBaggagePropagator, além do tracecontext.
import { propagation, type Context } from '@opentelemetry/api';

export interface BaggageEntries {
  userId?: string;
  requestId?: string;
}

export function readBaggage(ctx: Context): BaggageEntries {
  const baggage = propagation.getBaggage(ctx);
  const entries: BaggageEntries = {};
  if (!baggage) return entries;

  const userId = baggage.getEntry('user.id');
  if (userId) entries.userId = userId.value;

  const requestId = baggage.getEntry('request.id');
  if (requestId) entries.requestId = requestId.value;

  return entries;
}