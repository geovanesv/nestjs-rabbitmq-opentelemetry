// Contrato da mensagem/pedido compartilhado entre os serviços (RFC §7.2 / F-14).
// timestamp é string ISO-8601 (JSON-safe) — ver R-10.
export interface Order {
  id: string;
  customerId: string;
  amount: number;
  items: string[];
  timestamp: string;
}
