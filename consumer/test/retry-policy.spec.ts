// Testes unitários da política de retry/DLQ (RFC §7.2.1 / D-027 / D-028 / F-46).
// Funções puras — deterministicos, sem broker/rede.
import { describe, expect, it } from '@jest/globals';
import {
  isExhausted,
  nextAttempt,
  retryTtlForAttempt,
} from '../src/retry-policy';

describe('retry-policy', () => {
  it('primeira entrega é a tentativa 1', () => {
    expect(nextAttempt(undefined)).toBe(1);
    expect(nextAttempt({})).toBe(1);
  });

  it('respeita x-retry-count numérico', () => {
    expect(nextAttempt({ 'x-retry-count': 2 })).toBe(3);
  });

  it('respeita x-retry-count string e ignora inválidos', () => {
    expect(nextAttempt({ 'x-retry-count': '3' })).toBe(4);
    expect(nextAttempt({ 'x-retry-count': '-5' })).toBe(1);
    expect(nextAttempt({ 'x-retry-count': 'abc' })).toBe(1);
  });

  it('esgota apenas quando a tentativa ultrapassa MAX_RETRIES', () => {
    // x-retry-count=2 => tentativa 3 > 2 => vira DLQ
    expect(isExhausted({ 'x-retry-count': 2 }, 2)).toBe(true);
    // x-retry-count=1 => tentativa 2 <= 2 => ainda retryável
    expect(isExhausted({ 'x-retry-count': 1 }, 2)).toBe(false);
    // primeira entrega => tentativa 1 => retryável
    expect(isExhausted({}, 2)).toBe(false);
  });

  it('backoff multiplicativo por tentativa', () => {
    expect(retryTtlForAttempt(1, 2000)).toBe(2000);
    expect(retryTtlForAttempt(2, 2000)).toBe(4000);
    expect(retryTtlForAttempt(3, 1000)).toBe(3000);
    expect(retryTtlForAttempt(0, 2000)).toBe(1); // piso >= 1
  });
});