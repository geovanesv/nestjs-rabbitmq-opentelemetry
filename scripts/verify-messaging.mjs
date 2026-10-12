#!/usr/bin/env node
// Verificação E2E dos nomes semconv de messaging (RFC §7.12 / D-039 / F-59).
// - POST /orders (201) e captura o id.
// - Poll na API do Jaeger até encontrar o trace (span com order.id == id).
// - No MESMO trace, asserta (D-039):
//     * span `orders_queue publish` (producer) com
//       messaging.system=rabbitmq, messaging.destination.name=orders_queue,
//       messaging.operation.type=publish;
//     * span `orders_queue process` (consumer) com
//       messaging.operation.type=process;
//     * ausência de span terminando em " send" (nome antigo do amqplib);
//     * spans de negócio `createOrder`/`handleOrderCreated` INTACTOS (M3).
// Exit 0 = aceite; exit 1 = falha com diagnóstico. Node puro (fetch, >= 18).

const PRODUCER_URL = 'http://localhost:3001';
const JAEGER_API = 'http://localhost:16686/api/traces';
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 60000;

const PAYLOAD = {
  customerId: 'CUST-MESSAGING',
  amount: 1234.5,
  items: ['messaging-item'],
};

function tagValue(span, key) {
  const found = (span.tags || []).find((t) => t.key === key);
  return found?.value;
}

function fail(message) {
  console.error(
    `\n✗ VERIFY-MESSAGING FALHOU: ${message}` +
      '\n  Runbook (RFC §7.12/D-039): o processor é registrado em tracing.ts\n' +
      '  (spanProcessors: MessagingSemconvSpanProcessor + BatchSpanProcessor);\n' +
      '  reiniciar os serviços após rebuild se os nomes vierem antigos (\n' +
      '  "<default> -> orders_queue send").\n',
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

  console.log('3) Validando nomes semconv (D-039) no trace...');
  const res = await fetch(`${JAEGER_API}/${traceID}`);
  const json = await res.json();
  const trace = json.data && json.data[0];
  if (!trace) fail(`trace ${traceID} não retornado pela API`);

  const spans = trace.spans;
  const byName = (name) => spans.filter((s) => s.operationName === name);

  const publish = byName('orders_queue publish');
  if (publish.length !== 1) {
    fail(
      `"orders_queue publish" deveria ter 1 span no trace (encontrados ${publish.length}; spans: ${spans.map((s) => s.operationName).join(', ')})`,
    );
  }
  for (const [key, expected] of [
    ['messaging.system', 'rabbitmq'],
    ['messaging.destination.name', 'orders_queue'],
    ['messaging.operation.type', 'publish'],
  ]) {
    if (tagValue(publish[0], key) !== expected) {
      fail(`span publish sem ${key}=${expected} (achou ${JSON.stringify(tagValue(publish[0], key))})`);
    }
  }

  const processSpans = byName('orders_queue process');
  if (processSpans.length < 1) {
    fail(
      `"orders_queue process" ausente (spans: ${spans.map((s) => s.operationName).join(', ')})`,
    );
  }
  if (tagValue(processSpans[0], 'messaging.operation.type') !== 'process') {
    fail(
      `span process sem messaging.operation.type=process (achou ${JSON.stringify(tagValue(processSpans[0], 'messaging.operation.type'))})`,
    );
  }

  const legacySend = spans.filter((s) => / send$/.test(s.operationName));
  if (legacySend.length > 0) {
    fail(
      `nome antigo do amqplib ainda presente: ${legacySend.map((s) => s.operationName).join(', ')}`,
    );
  }

  const operationNames = new Set(spans.map((s) => s.operationName));
  for (const required of ['createOrder', 'handleOrderCreated']) {
    if (!operationNames.has(required)) {
      fail(
        `contrato M3 quebrado: span de negócio "${required}" ausente (D-039 não pode tocá-lo)`,
      );
    }
  }

  console.log('\n✓ VERIFY-MESSAGING OK — nomes semconv presentes, negócio intacto');
  console.log('  trace id             :', traceID);
  console.log('  producer (amqplib)   : orders_queue publish (operation.type=publish, dest.name=orders_queue)');
  console.log('  consumer (amqplib)   : orders_queue process (operation.type=process)');
  console.log('  nomes antigos " send" : nenhum');
  console.log('  negócio intacto      : createOrder + handleOrderCreated');
  process.exit(0);
}

main().catch((error) => fail(error.message));