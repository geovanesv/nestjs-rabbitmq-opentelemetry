// Domínio de pedidos do producer (RFC §7.2/§7.3 / D-014/D-016/D-018 / F-16).
// Cria o span manual `createOrder`, publica em orders_queue com propagação
// automática de contexto e mantém um store in-memory (máx. 100, evicção FIFO).
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { CreateOrderDto } from './order.dto';
import { Order } from './order.interface';
import { ORDER_QUEUE } from './rabbitmq.config';
import { ordersCreatedCounter, ordersCreationDuration } from './metrics';

const MAX_ORDERS = 100;

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);
  // Nome do tracer igual ao service.name do Resource (RFC §7.3).
  private readonly tracer = trace.getTracer('producer-service');
  private readonly store = new Map<string, Order>();
  private readonly orderKeys: string[] = [];

  constructor(
    @Inject('ORDER_SERVICE') private readonly client: ClientProxy,
  ) {}

  async createOrder(dto: CreateOrderDto): Promise<Order> {
    const span = this.tracer.startSpan('createOrder');
    // D-033: o histograma mede o create ponta-a-ponta (→ fim do emit).
    const startedAt = performance.now();
    try {
      const order: Order = {
        // D-016: formato do material; colisões sob concorrência são backlog.
        id: `ORD-${Date.now()}`,
        customerId: dto.customerId,
        amount: dto.amount,
        items: dto.items,
        // R-10: timestamp como string ISO (JSON-safe no transporte).
        timestamp: new Date().toISOString(),
      };

      // D-018: atributos pesquisáveis no Jaeger (tag search).
      span.setAttributes({
        'order.id': order.id,
        'order.customer_id': order.customerId,
        'order.amount': order.amount,
        'messaging.system': 'rabbitmq',
        'messaging.destination.name': ORDER_QUEUE,
      });
      span.addEvent('order_created', { orderId: order.id });

      // Publica fire-and-forget; a instrumentação de amqplib injeta traceparent
      // automaticamente em properties.headers (D-006).
      await this.client.emit('order.created', order).toPromise();
      span.addEvent('order_sent_to_queue', { 'queue.name': ORDER_QUEUE });

      // D-033: métricas de negócio (atributos de baixa cardinalidade, sem
      // order.id — R-08; o id é pesquisável nos traces, D-018).
      ordersCreatedCounter.add(1);
      ordersCreationDuration.record(performance.now() - startedAt, {
        'messaging.system': 'rabbitmq',
      });

      this.logger.log(`Order ${order.id} created and published`);

      this.evictIfNeeded();
      this.store.set(order.id, order);
      this.orderKeys.push(order.id);

      return order;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      this.logger.error(
        `Erro ao publicar pedido: ${(error as Error).message}`,
      );
      throw error;
    } finally {
      span.end();
    }
  }

  // Mais recente primeiro; sem spams de negócio para leituras (RFC §7.5).
  getOrders(): Order[] {
    return [...this.orderKeys]
      .reverse()
      .map((id) => this.store.get(id))
      .filter((order): order is Order => order !== undefined);
  }

  getById(id: string): Order | undefined {
    return this.store.get(id);
  }

  // D-014: capacidade máxima com evicção FIFO.
  private evictIfNeeded(): void {
    while (this.orderKeys.length >= MAX_ORDERS) {
      const evicted = this.orderKeys.shift();
      if (evicted === undefined) break;
      this.store.delete(evicted);
    }
  }
}