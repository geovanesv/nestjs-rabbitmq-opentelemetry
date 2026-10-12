// W3C Baggage do producer (RFC §7.10 / D-037 / F-53).
// Cria o baggage de negócio (user.id/request.id) que viaja no header
// `baggage` da mensagem do RabbitMQ junto do traceparent (D-006).
// O requestId vem de F-56 (ids.ts — mesmo gerador colision-safe do order.id).
import { propagation, type Baggage } from '@opentelemetry/api';
import { newRequestId } from './ids';

export function createOrderBaggage(
  customerId: string,
  requestId: string = newRequestId(),
): Baggage {
  return propagation.createBaggage({
    'user.id': { value: customerId },
    'request.id': { value: requestId },
  });
}