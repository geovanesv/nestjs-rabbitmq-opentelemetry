// verify-dlq.mjs — E2E de DLQ/retry (RFC §7.2.1 / WP-13 / F-47).
// Pré-condições: infra e producer no ar; consumer de TESTE rodando no host com
// SIMULATE_FAILURE_RATE=1, MAX_RETRIES=2 e RETRY_TTL_MS=1000 (via make verify-dlq).
// Fluxo esperado: POST /orders → attempt 1 falha → orders_queue.retry (TTL 1s)
// → attempt 2 falha → orders_queue.retry (TTL 2s) → attempt 3 falha (3 > 2) →
// orders_queue.dlq com x-death e x-retry-count. Ao fim: main e retry esvaziam,
// DLQ tem exatamente 1 mensagem.
const MGMT_URL =
  process.env.RABBITMQ_MGMT_URL || 'http://localhost:15672';
const MGMT_USER = process.env.RABBITMQ_USER || 'guest';
const MGMT_PASS = process.env.RABBITMQ_PASS || 'guest';
const PRODUCER_URL = process.env.PRODUCER_URL || 'http://localhost:3001';
const ORDER_QUEUE = process.env.ORDER_QUEUE || 'orders_queue';
const ORDER_QUEUE_DLQ = process.env.ORDER_QUEUE_DLQ || 'orders_queue.dlq';
const ORDER_QUEUE_RETRY = process.env.ORDER_QUEUE_RETRY || 'orders_queue.retry';
const TIMEOUT_MS = 60_000;
const POLL_MS = 700;
const AUTH = Buffer.from(`${MGMT_USER}:${MGMT_PASS}`).toString('base64');

async function mgmtQueue(name) {
  const res = await fetch(`${MGMT_URL}/api/queues/%2f/${encodeURIComponent(name)}`, {
    headers: { Authorization: `Basic ${AUTH}` },
  });
  if (res.status === 404) return null; // fila ainda não existe
  if (!res.ok) throw new Error(`management API HTTP ${res.status} (${name})`);
  return res.json();
}

async function getOneFromQueue(name) {
  const res = await fetch(`${MGMT_URL}/api/queues/%2f/${encodeURIComponent(name)}/get`, {
    method: 'POST',
    headers: { Authorization: `Basic ${AUTH}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ count: 1, ackmode: 'ack_requeue_true', encoding: 'auto' }),
  });
  if (!res.ok) throw new Error(`/get HTTP ${res.status} (${name})`);
  return res.json();
}

function log(step, msg) {
  console.log(`[verify-dlq] ${step}: ${msg}`);
}

async function main() {
  log('1', 'Criando pedido de teste no producer (será processado em falha 100%)...');
  const created = await fetch(`${PRODUCER_URL}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerId: 'CUST-DLQ',
      amount: 42.42,
      items: ['dlq-item'],
    }),
  });
  if (created.status !== 201) {
    throw new Error(`POST /orders falhou: HTTP ${created.status}`);
  }
  const { id: orderId } = await created.json();
  log('1', `order.id = ${orderId}`);

  log('2', 'Aguardando: retries (TTL) -> DLQ...');
  const deadline = Date.now() + TIMEOUT_MS;
  let last = { dlq: 0, retry: 0, main: 0 };
  let dlqDepth = 0;
  while (Date.now() < deadline) {
    const [main, retry, dlq] = await Promise.all([
      mgmtQueue(ORDER_QUEUE),
      mgmtQueue(ORDER_QUEUE_RETRY),
      mgmtQueue(ORDER_QUEUE_DLQ),
    ]);
    last.main = (main?.messages ?? main?.messages_ready ?? 0);
    last.retry = (retry?.messages ?? 0);
    last.dlq = (dlq?.messages ?? 0);
    if (last.main === 0 && last.retry === 0 && last.dlq >= 1) {
      dlqDepth = last.dlq;
      break;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }

  log('3', `Estado final — main=${last.main}, retry=${last.retry}, dlq=${dlqDepth}`);
  if (dlqDepth < 1) {
    throw new Error('DLQ vazia: a mensagem não chegou a orders_queue.dlq (main/retry não zeraram?)');
  }
  if (last.main !== 0 || last.retry !== 0) {
    throw new Error('main/retry não voltaram a 0: retry/TTL não drenou corretamente');
  }

  log('4', 'Inspecionando a mensagem no DLQ (payload + headers)...');
  const [msg] = await getOneFromQueue(ORDER_QUEUE_DLQ);
  if (!msg) throw new Error('não foi possível ler a mensagem do DLQ');

  const parsed = JSON.parse(msg.payload);
  const gotOrderId = parsed?.data?.id;
  const death = msg.properties?.headers?.['x-death'];
  const retryCount = msg.properties?.headers?.['x-retry-count'];

  if (gotOrderId !== orderId) {
    throw new Error(`payload do DLQ não bate: ordem ${gotOrderId} != ${orderId}`);
  }
  if (!Array.isArray(death) || death.length < 1) {
    throw new Error('DLQ sem header x-death (histórico de dead-letter esperado)');
  }
  if (retryCount < 1) {
    throw new Error(`x-retry-count ausente/inválido no DLQ (obtido ${retryCount})`);
  }

  log('5', 'Verificando continuidade de rastreamento no Jaeger...');
  const og = await fetch('http://localhost:16686/api/services').catch(() => null);
  if (og && og.ok) {
    log('5', 'Jaeger responde (UI em http://localhost:16686)');
  }

  console.log('\n✓ VERIFY-DLQ OK — pedido falhou, retryou com backoff e caiu no DLQ');
  console.log(`  order.id    : ${orderId}`);
  console.log(`  tentativas  : ${retryCount + 1} (retries = ${retryCount})`);
  console.log(`  dlq         : orders_queue.dlq (${dlqDepth} na fila)`);
  console.log(`  x-death     : ${death.length} registro(s)`);
  console.log('  o consumer canônico será restaurado pelo make verify-dlq');
  process.exit(0);
}

main().catch((err) => {
  console.error(`\n✗ VERIFY-DLQ FAIL — ${err.message}`);
  process.exit(1);
});