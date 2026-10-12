// Geradores de identificadores colision-safe (RFC §7.11 / D-038 / F-56).
// `ORD-<epoch_ms>-<rand4>`: prefixo de tempo legível/ordenável + 4 hex
// aleatórios (crypto.randomBytes — 16 bits) para desanexar rajadas no mesmo ms.
import { randomBytes } from 'crypto';

export function randomHex4(): string {
  return randomBytes(2).toString('hex').padStart(4, '0');
}

export function newOrderId(): string {
  return `ORD-${Date.now()}-${randomHex4()}`;
}

export function newRequestId(): string {
  return `REQ-${Date.now()}-${randomHex4()}`;
}