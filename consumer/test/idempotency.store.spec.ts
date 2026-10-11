// Testes unitários da store de idempotência (RFC §7.2.1 / D-029 / F-45).
// Determinísticos, sem broker/rede.
import { describe, expect, it } from '@jest/globals';
import { IdempotencyStore } from '../src/idempotency.store';

describe('IdempotencyStore', () => {
  it('começa vazia', () => {
    const store = new IdempotencyStore(1000, 10);
    expect(store.wasProcessed('ORD-1')).toBe(false);
    expect(store.size).toBe(0);
  });

  it('reconhece a chave depois de markProcessed', () => {
    const store = new IdempotencyStore(1000, 10);
    store.markProcessed('ORD-1');
    expect(store.wasProcessed('ORD-1')).toBe(true);
    expect(store.size).toBe(1);
  });

  it('marca repetida mantém a chave única', () => {
    const store = new IdempotencyStore(1000, 10);
    store.markProcessed('ORD-1');
    store.markProcessed('ORD-1');
    expect(store.size).toBe(1);
    expect(store.wasProcessed('ORD-1')).toBe(true);
  });

  it('expira por TTL', async () => {
    const store = new IdempotencyStore(20, 10);
    store.markProcessed('ORD-1');
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(store.wasProcessed('ORD-1')).toBe(false);
  });

  it('remove a entrada mais antiga ao atingir o teto (FIFO)', () => {
    const store = new IdempotencyStore(60000, 2);
    store.markProcessed('ORD-1');
    store.markProcessed('ORD-2');
    store.markProcessed('ORD-3');
    expect(store.size).toBe(2);
    expect(store.wasProcessed('ORD-1')).toBe(false);
    expect(store.wasProcessed('ORD-2')).toBe(true);
    expect(store.wasProcessed('ORD-3')).toBe(true);
  });
});