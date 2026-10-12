// Testes unitários do helper de baggage (RFC §7.10 / F-54 / D-037).
// Determinísticos, sem broker/collector/rede.
import { describe, expect, it } from '@jest/globals';
import { propagation, ROOT_CONTEXT } from '@opentelemetry/api';
import { readBaggage } from '../src/tracing/read-baggage';

describe('readBaggage', () => {
  it('extrai user.id e request.id do contexto', () => {
    const ctx = propagation.setBaggage(
      ROOT_CONTEXT,
      propagation.createBaggage({
        'user.id': { value: 'CUST-BAGGAGE' },
        'request.id': { value: 'REQ-1-2a3b' },
      }),
    );
    expect(readBaggage(ctx)).toEqual({
      userId: 'CUST-BAGGAGE',
      requestId: 'REQ-1-2a3b',
    });
  });

  it('retorna {} para contexto sem baggage', () => {
    expect(readBaggage(ROOT_CONTEXT)).toEqual({});
  });

  it('omite entrada ausente', () => {
    const ctx = propagation.setBaggage(
      ROOT_CONTEXT,
      propagation.createBaggage({ 'user.id': { value: 'CUST-1' } }),
    );
    expect(readBaggage(ctx)).toEqual({ userId: 'CUST-1' });
  });
});