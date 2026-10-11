// Contrato de conexão RMQ do producer (RFC §7 / D-009 / D-031).
// Fila durável, sem exchange customizado (usa a default exchange do Nest) e prefetch 1.
// v1.1 (D-031): `noAssert: true` — o producer NÃO declara `orders_queue`;
// a topologia (incl. arguments de DLX) é declarada exclusivamente pelo consumer.
import { ClientOptions, Transport } from '@nestjs/microservices';
import { config } from './config';

export const ORDER_QUEUE = config.orderQueue;

export const rabbitmqConfig: ClientOptions = {
  transport: Transport.RMQ,
  options: {
    urls: [config.rabbitmqUrl],
    queue: ORDER_QUEUE,
    queueOptions: {
      noAssert: true,
    },
    prefetchCount: 1,
  },
};
