// Contrato de conexão RMQ do producer (RFC §7 / D-009).
// Fila durável, sem exchange customizado (usa a default exchange do Nest) e prefetch 1.
import { ClientOptions, Transport } from '@nestjs/microservices';
import { config } from './config';

export const ORDER_QUEUE = config.orderQueue;

export const rabbitmqConfig: ClientOptions = {
  transport: Transport.RMQ,
  options: {
    urls: [config.rabbitmqUrl],
    queue: ORDER_QUEUE,
    queueOptions: {
      durable: true,
    },
    prefetchCount: 1,
  },
};
