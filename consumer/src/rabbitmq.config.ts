// Contrato de conexão RMQ do consumer (RFC §7 / D-009) — mesma fila do producer.
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