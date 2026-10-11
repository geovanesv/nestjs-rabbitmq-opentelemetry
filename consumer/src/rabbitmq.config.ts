// Contrato de conexão RMQ do consumer (RFC §7 / D-009 / D-026 / D-030 — F-23).
// Desde a v1.1: `noAck: false` (ack manual explícito, D-030) e `queueOptions`
// com os mesmo `arguments` de DLX usados pelo DlxTopology (owner da topologia,
// D-031) — equivalência evita 406 no assert do Nest.
import { ClientOptions, Transport } from '@nestjs/microservices';
import { config } from './config';
import { orderQueueArguments } from './queue/dlq.setup';

export const ORDER_QUEUE = config.orderQueue;

export const rabbitmqConfig: ClientOptions = {
  transport: Transport.RMQ,
  options: {
    urls: [config.rabbitmqUrl],
    queue: ORDER_QUEUE,
    queueOptions: {
      durable: true,
      arguments: orderQueueArguments,
    },
    noAck: false,
    prefetchCount: 1,
  },
};