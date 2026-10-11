#!/usr/bin/env node
// Verificação E2E do trace distribuído (RFC §10 / F-30 / D-022).
// - POST /orders (201) e captura o id.
// - Poll na API do Jaeger até encontrar o trace cujo span tem order.id == id.
// - Exige producer-service e consumer-service no mesmo trace_id.
// - Exige os spans createOrder, handleOrderCreated e os spans de amqplib.
// Saída legível; exit 0 = aceite principal (M3), exit 1 = falha com diagnóstico.
// Node puro: usa o fetch global (Node >= 18). Sem dependências externas.

const PRODUCER_URL = 'http://localhost:3001';
const JAEGER_API = 'http://localhost:16686/api/traces';
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 60000;

const PAYLOAD = {
  customerId: 'CUST-VERIFY',
  amount: 199.9,
  items: ['verify-item'],
};

function fail(message) {
  console.error(
    `\n✗ VERIFY FALHOU: ${message}\n` +
      '  Runbook (RFC §8.3): traces não aparecem → conferir endpoint OTLP (D-010),\n' +
      '  ' +
      'Collector (`docker compose ps` / `curl :13133`), extração manual (`extractTraceHeaders`),\n' +
      '  ' +
      'e a ordem do import "./tracing" (D-004).\n',
  );
  process.exit(1);
}

async function createOrder() {
  const res = await fetch(`${PRODUCER_URL}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(PAYLOAD),
  });
  if (res.status !== 201) {
    fail(`POST /orders retornou ${res.status} (esperado 201)`);
  }
  const order = await res.json();
  if (!order.id) fail('POST /orders não retornou order.id');
  return order;
}

async function findTraceByOrderId(orderId) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await fetch(
      `${JAEGER_API}?service=consumer-service&lookback=2h&limit=50`,
    );
    const json = await res.json();
    const traces = json.data || [];
    const found = traces.find((t) =>
      t.spans.some((s) =>
        s.tags.some((tg) => tg.key === 'order.id' && tg.value === orderId),
      ),
    );
    if (found) return found.traceID;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return null;
}

async function main() {
  console.log('1) Criando pedido de teste no producer...');
  const order = await createOrder();
  console.log(`   order.id = ${order.id}`);

  console.log('2) Localizando o trace pelo atributo order.id no Jaeger...');
  const traceID = await findTraceByOrderId(order.id);
  if (!traceID) {
    fail(
      `nenhum trace com order.id=${order.id} apareceu em ${POLL_TIMEOUT_MS / 1000}s`,
    );
  }
  console.log(`   traceID = ${traceID}`);

  console.log('3) Buscando o trace completo e validando os dois serviços...');
  const res = await fetch(`${JAEGER_API}/${traceID}`);
  const json = await res.json();
  const trace = json.data && json.data[0];
  if (!trace) fail(`trace ${traceID} não retornado pela API`);

  const services = new Set(
    Object.values(trace.processes).map((p) => p.serviceName),
  );
  if (!services.has('producer-service') || !services.has('consumer-service')) {
    fail(
      `trace ${traceID} não cobre os dois serviços (encontrados: ${[...services].join(', ')})`,
    );
  }

  const operationNames = new Set(trace.spans.map((s) => s.operationName));
  for (const required of ['createOrder', 'handleOrderCreated']) {
    if (!operationNames.has(required)) {
      fail(`span obrigatório "${required}" ausente no trace ${traceID}`);
    }
  }
  const amqpSpans = trace.spans.filter((s) =>
    s.operationName.toLowerCase().includes('orders_queue'),
  );
  if (amqpSpans.length < 2) {
    fail(
      `spans de amqplib insuficientes (${amqpSpans.length}, esperado >= 2) no trace ${traceID}`,
    );
  }

  // Jaeger API trabalha em microssegundos (startTime + duration).
  const totalDurationUs =
    Math.max(...trace.spans.map((s) => s.startTime + s.duration)) -
    Math.min(...trace.spans.map((s) => s.startTime));
  console.log('\n✓ VERIFY OK — aceite principal M3');
  console.log('  trace id      :', traceID);
  console.log('  nº de spans   :', trace.spans.length);
  console.log('  serviços      :', [...services].join(' + '));
  console.log('  spans-chave   : createOrder, handleOrderCreated, amqplib');
  console.log('  duração total :', `${(totalDurationUs / 1000).toFixed(0)}ms`);
  process.exit(0);
}

main().catch((error) => fail(error.message));