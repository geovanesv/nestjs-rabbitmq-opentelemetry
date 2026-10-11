// Topologia de DLQ/retry do consumer (v1.1 — RFC §7.2.1 / D-026 / D-027 / F-42).
// É o OWNER único da declaração da topologia: `orders_queue` (com arguments de
// DLX), o exchange `dlx`, a fila `orders_queue.dlq` e a fila de retry
// `orders_queue.retry` (D-031 — o producer não declara fila).
// Executado de forma idempotente antes do `app.listen()` (main.ts).
import { connect, Channel, ChannelModel } from 'amqplib';
import { config } from '../config';

export const DLX_EXCHANGE = 'dlx';

// Arguments de DLX da fila principal — compartilhados com `rabbitmq.config.ts`
// (queueOptions.arguments) para garantir equivalência exata no assert do Nest
// (evita 406 PRECONDITION_FAILED por mismatch de `arguments`).
// O `x-dead-letter-routing-key` DEVE casar com o binding da DLQ (D-026, §7.2.1):
// como o exchange `dlx` é `direct`, rk divergente descarta a mensagem em silêncio.
export const orderQueueArguments: Record<string, string> = {
  'x-dead-letter-exchange': DLX_EXCHANGE,
  'x-dead-letter-routing-key': config.orderQueue,
};

// Names usados pela fila de retry: ao expirar o TTL, o broker redelivers para a
// fila principal via default exchange + routing key = `orders_queue`.
export const retryQueueArguments: Record<string, string> = {
  'x-dead-letter-exchange': '',
  'x-dead-letter-routing-key': config.orderQueue,
};

export class DlxTopology {
  async setup(): Promise<void> {
    const conn: ChannelModel = await connect(config.rabbitmqUrl);
    let channel: Channel = await conn.createChannel();
    hushChannelErrors(channel);
    try {
      // dlx (direct, durável) liga a DLQ com routing key = nome da fila original
      // (o DLX usa o routing key com que a mensagem chegou à fila dead-lettered).
      await channel.assertExchange(DLX_EXCHANGE, 'direct', { durable: true });

      // A partir daqui, cada fila pode existir com atributos divergentes (ex.:
      // `orders_queue` criada antes da v1.1, sem DLX). reassertOrRecreate troca
      // de canal quando necessário (o 406 fecha o canal atual) e recria a fila
      // para aplicar o contrato (D-026/D-027). Dados de dev são efêmeros (D-014).
      channel = await this.ensureQueue(channel, conn, config.orderQueue, {
        durable: true,
        arguments: orderQueueArguments,
      });
      channel = await this.ensureQueue(channel, conn, config.orderQueueDlq, {
        durable: true,
      });
      await channel.bindQueue(
        config.orderQueueDlq,
        DLX_EXCHANGE,
        config.orderQueue,
      );

      // Retry: TTL por-mensagem (expiration) + redelivery por DLX; sem bind
      // (dead-letter para a default exchange com rk = nome da fila principal).
      channel = await this.ensureQueue(channel, conn, config.orderQueueRetry, {
        durable: true,
        arguments: retryQueueArguments,
      });
    } finally {
      await channel.close();
      await conn.close();
    }
  }

  // Cativa um assert; se RabbitMQ responder 406 (fila existe com atributos
  // divergentes e arguments não podem ser alterados in-place), recria a fila
  // num canal NOVO (o canal atual é fechado pelo 406). Log explícito do evento.
  private async ensureQueue(
    channel: Channel,
    conn: ChannelModel,
    name: string,
    options: { durable: boolean; arguments?: Record<string, string> },
  ): Promise<Channel> {
    try {
      await channel.assertQueue(name, options);
      return channel;
    } catch (error) {
      const err = error as { code?: number };
      if (err?.code !== 406) {
        throw error;
      }
      console.warn(
        `[DlxTopology] fila ${name} existente com atributos divergentes; ` +
          `recriando para aplicar o contrato (${JSON.stringify(options.arguments ?? {})})`,
      );
      const fresh = await conn.createChannel();
      hushChannelErrors(fresh);
      await fresh.deleteQueue(name);
      await fresh.assertQueue(name, options);
      return fresh;
    }
  }
}

// Em amqplib, um `channel.close` enviado pelo broker (ex.: 406) dispara o
// evento 'error' no canal; sem listener, ele vira exceção não tratada e derruba
// o processo mesmo quando a promise correspondente é capturada. O hush é
// intencional: a reconciliação é feita via promises (reject/return) acima.
function hushChannelErrors(channel: Channel): void {
  channel.on('error', () => {
    /* erro de canal tratado via promise no ensureQueue */
  });
}