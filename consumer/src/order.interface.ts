// Contrato da mensagem/pedido (RFC §7.2 / F-27) — idêntico ao producer.
export interface Order {
  id: string;
  customerId: string;
  amount: number;
  items: string[];
  timestamp: string;
}