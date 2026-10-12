#!/usr/bin/env node
// Verificação E2E de IDs colision-safe (RFC §7.11 / D-038 / F-57).
// - Dispara N=30 POST /orders CONCORRENTES (mesmo burst).
// - Assert: todos 201; 30 ids ÚNICOS; formato ^ORD-\d+-[0-9a-f]{4}$.
// Exit 0 = aceite; exit 1 = falha com diagnóstico. Node puro (fetch, >= 18).

const PRODUCER_URL = 'http://localhost:3001';
const CONCURRENCY = 30;
const ID_PATTERN = /^ORD-\d+-[0-9a-f]{4}$/;

function fail(message) {
  console.error(
    `\n✗ VERIFY-IDS FALHOU: ${message}\n` +
      '  Runbook (RFC §8.3): o id é gerado por newOrderId() em ids.ts (F-56/D-038);\n' +
      '  reiniciar o producer após rebuild se o formato vier antigo (ORD-<ts> apenas).\n',
  );
  process.exit(1);
}

async function main() {
  console.log(`1) Disparando ${CONCURRENCY} POST /orders concorrentes...`);
  const responses = await Promise.all(
    Array.from({ length: CONCURRENCY }, () =>
      fetch(`${PRODUCER_URL}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: 'CUST-IDS',
          amount: 99.9,
          items: ['ids-item'],
        }),
      }),
    ),
  );

  const statuses = new Set(responses.map((r) => r.status));
  if (statuses.size !== 1 || statuses.has(201) === false) {
    fail(
      `statuses distintos/inesperados: ${[...statuses].join(', ')} (esperado só 201)`,
    );
  }

  const orders = [];
  for (const res of responses) {
    orders.push(await res.json());
  }
  const ids = orders.map((o) => o.id);
  const unique = new Set(ids);

  if (unique.size !== CONCURRENCY) {
    fail(
      `colisão detectada: ${CONCURRENCY - unique.size} id(s) duplicado(s) — ex.: ${ids.slice(0, 3).join(', ')}`,
    );
  }
  for (const id of ids) {
    if (!ID_PATTERN.test(id)) {
      fail(`id fora do formato ORD-<ts>-<rand4>: ${id}`);
    }
  }

  console.log('\n✓ VERIFY-IDS OK — IDs colision-safe sob concorrência');
  console.log('  requisições  :', CONCURRENCY, '(mesmo burst)');
  console.log('  ids únicos   :', unique.size, '/', CONCURRENCY);
  console.log('  formato      : ORD-<epoch_ms>-<rand4> (D-038)');
  console.log('  exemplo      :', ids[0]);
  process.exit(0);
}

main().catch((error) => fail(error.message));