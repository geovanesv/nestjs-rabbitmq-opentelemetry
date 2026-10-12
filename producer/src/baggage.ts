// W3C Baggage do producer (RFC §7.10 / D-037 / F-53).
// Cria o baggage de negócio (user.id/request.id) que viaja no header
// `baggage` da mensagem do RabbitMQ junto do traceparent (D-006).
import { propagation, type Baggage } from '@opentelemetry/api';

export function newRequestId(): string {
  return `REQ-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
}

export function createOrderBaggage(
  customerId: string,
  requestId: string,
): Baggage {
  return propagation.createBaggage({
    'user.id': { value: customerId },
    'request.id': { value: requestId },
  });
}