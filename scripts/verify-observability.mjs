// verify-observability.mjs — E2E de métricas + logs (RFC §7.9 / D-036 / F-52).
// Pré-condições: infra (`make infra-up` com loki) e producer no ar.
// Fluxo: POST /orders → aguarda ≥ 1 ciclo de export (metricReader 3s + batch 5s)
// → asserta no Collector (`:9464/metrics`) que `otel_orders_created_total ≥ 1`
// e o histograma `otel_orders_creation_duration_*` existem; e no Loki
// (`:3100/loki/api/v1/query_range`) que o log "Order <id> created and published"
// do producer-service chegou (span ativo → trace_id/span_id no LogRecord).
const PRODUCER_URL = process.env.PRODUCER_URL || 'http://localhost:3001';
const COLLECTOR_METRICS_URL =
  process.env.COLLECTOR_METRICS_URL || 'http://localhost:9464/metrics';
const LOKI_URL = process.env.LOKI_URL || 'http://localhost:3100';
const TIMEOUT_MS = 30_000;
const POLL_MS = 1_000;

function log(step, msg) {
  console.log(`[verify-observability] ${step}: ${msg}`);
}

async function fetchMetricsProbe() {
  const res = await fetch(COLLECTOR_METRICS_URL);
  if (!res.ok) throw new Error(`/metrics HTTP ${res.status}`);
  return res.text();
}

function parseCounter(text, name) {
  // Formato Prometheus: "<name>{labels} value". Retorna o valor do primeiro match.
  for (const line of text.split('\n')) {
    const match = line.match(new RegExp(`^${name}(?:\\s+|[\\{])(.*)$`));
    if (match) {
      const value = Number(match[1].replace(/^.*\}\s*/, '') || NaN);
      if (Number.isFinite(value)) return value;
    }
  }
  return undefined;
}

async function fetchLokiLog(job, matcher, orderId) {
  // No Collector 0.97 o resource service.name vira a label `job` (receiver
  // OTLP); os atributos do LogRecord vão no corpo JSON da linha.
  const query = `{job="${job}"} |= "${matcher}" |= "${orderId}"`;
  const endNs = Date.now() * 1_000_000;
  const startNs = endNs - 10 * 60 * 1_000_000_000; // janela de 10 min
  const url =
    `${LOKI_URL}/loki/api/v1/query_range?query=${encodeURIComponent(query)}` +
    `&start=${startNs}&end=${endNs}&limit=10`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`loki query_range HTTP ${res.status}`);
  const json = await res.json();
  return json?.data?.result ?? [];
}

async function main() {
  log('1', 'Criando pedido de teste no producer...');
  const created = await fetch(`${PRODUCER_URL}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerId: 'CUST-OBS',
      amount: 12.34,
      items: ['obs-item'],
    }),
  });
  if (created.status !== 201) {
    throw new Error(`POST /orders falhou: HTTP ${created.status}`);
  }
  const orderId = (await created.json()).id;
  log('1', `order.id = ${orderId}`);

  log('2', 'Aguardando exportação de métricas e logs (metricReader 3s + batch 5s)...');
  const deadline = Date.now() + TIMEOUT_MS;
  let createdTotal = 0;
  let histogramSeen = false;
  let logSeen = false;
  while (Date.now() < deadline) {
    const text = await fetchMetricsProbe();
    createdTotal = parseCounter(text, 'otel_orders_created_total') ?? 0;
    histogramSeen = /otel_orders_creation_duration/.test(text);
    if (createdTotal >= 1 && histogramSeen) {
      const streams = await fetchLokiLog(
        'producer-service',
        'created and published',
        orderId,
      );
      logSeen = streams.some((s) =>
        (s.values ?? []).some(([, line]) => line.includes('traceid')),
      );
      if (logSeen) break;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }

  log('3', `Estado final — orders_created_total=${createdTotal}, histograma=${histogramSeen}, log_loki=${logSeen}`);
  if (createdTotal < 1) {
    throw new Error('otel_orders_created_total não chegou a ≥ 1 em :9464/metrics');
  }
  if (!histogramSeen) {
    throw new Error('histograma otel_orders_creation_duration_* ausente em :9464/metrics');
  }
  if (!logSeen) {
    throw new Error('log "Order <id> created and published" não encontrado no Loki');
  }

  console.log('\n✓ VERIFY-OBSERVABILITY OK — métricas e logs fluem producer → collector');
  console.log(`  order.id             : ${orderId}`);
  console.log(`  pedidos criados      : otel_orders_created_total = ${createdTotal}`);
  console.log(`  latência             : otel_orders_creation_duration_* presente`);
  console.log(`  log no Loki          : {job="producer-service"} |= "created and published"`);
  console.log('  trace_id/span_id     : presentes no LogRecord (span ativo do create)');
  process.exit(0);
}

main().catch((err) => {
  console.error(`\n✗ VERIFY-OBSERVABILITY FAIL — ${err.message}`);
  process.exit(1);
});