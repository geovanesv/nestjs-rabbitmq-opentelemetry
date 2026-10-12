#!/usr/bin/env node
// Verificação E2E do W3C Baggage (RFC §7.10 / D-037 / F-55).
// - POST /orders (201) com customerId = CUST-BAGGAGE e captura o id.
// - Poll na API do Jaeger até encontrar o trace cujo span tem order.id == id.
// - Exige que o span handleOrderCreated (consumer) tenha os atributos
//   user.id == CUST-BAGGAGE e request.id == /^REQ-/ (baggage cruzou a fila).
// Exit 0 = aceite; exit 1 = falha com diagnóstico. Node puro (fetch, >= 18).

const PRODUCER_URL = 'http://localhost:3001';
const JAEGER_API = 'http://localhost:16686/api/traces';
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 60000;

const PAYLOAD = {
  customerId: 'CUST-BAGGAGE',
  amount: 199.9,
  items: ['baggage-item'],
};

function fail(message) {
  console.error(
    `\n✗ VERIFY-BAGGAGE FALHOU: ${message}\n` +
      '  Runbook (RFC §8.3): baggage é injetado pelo propagador composto default\n' +
      '  (OTEL_PROPAGATORS=tracecontext,baggage) no emit dentro de context.with\n' +
      '  (D-037); conferir headers na UI do RabbitMQ e o span handleOrderCreated.\n',
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
    if (found) return found;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return null;
}

function tagValue(span, key) {
  const tag = span.tags.find((t) => t.key === key);
  return tag ? String(tag.value) : undefined;
}

async function main() {
  console.log('1) Criando pedido de teste no producer...');
  const order = await createOrder();
  console.log(`   order.id = ${order.id} (customerId = ${PAYLOAD.customerId})`);

  console.log('2) Localizando o trace pelo atributo order.id no Jaeger...');
  const trace = await findTraceByOrderId(order.id);
  if (!trace) {
    fail(
      `nenhum trace com order.id=${order.id} apareceu em ${POLL_TIMEOUT_MS / 1000}s`,
    );
  }
  console.log(`   traceID = ${trace.traceID}`);

  console.log('3) Validando o baggage nos spans do consumer...');
  const consumerSpans = trace.spans.filter(
    (s) => s.operationName === 'handleOrderCreated',
  );
  if (consumerSpans.length === 0) {
    fail(`nenhum span handleOrderCreated no trace ${trace.traceID}`);
  }

  const span = consumerSpans[0];
  const userId = tagValue(span, 'user.id');
  const requestId = tagValue(span, 'request.id');

  if (userId !== PAYLOAD.customerId) {
    fail(
      `user.id no span = ${JSON.stringify(userId)}, esperado "${PAYLOAD.customerId}"`,
    );
  }
  if (!requestId || !/^REQ-\d+-\w{1,4}$/.test(requestId)) {
    fail(
      `request.id no span = ${JSON.stringify(requestId)}, esperado REQ-<ts>-<rand4>`,
    );
  }

  console.log('\n✓ VERIFY-BAGGAGE OK — baggage cruzou producer → consumer');
  console.log('  trace id      :', trace.traceID);
  console.log('  user.id       :', userId);
  console.log('  request.id    :', requestId);
  console.log('  transporte    : header "baggage" no RabbitMQ (amqplib, D-006)');
  process.exit(0);
}

main().catch((error) => fail(error.message));