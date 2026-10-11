# consumer-service

Serviço **NestJS microservice (sem porta HTTP)** que consome o evento `order.created` da fila `orders_queue` e processa cada pedido, **fechando a continuidade do trace**: usa a extração manual de contexto (`propagation.extract`) para que o span `handleOrderCreated` seja filho do publish feito pelo producer (mesmo `trace_id`).

Papel na arquitetura: ver [`README.md`](../README.md) e [`docs/RFC.md`](../docs/RFC.md).

## Requisitos

- Node.js >= 18
- Infra no ar: `make infra-up` (na raiz do repositório)

## Variáveis de ambiente

Todas opcionais (defaults de dev). Ver `.env.example`:

| Variável | Default | Uso |
|---|---|---|
| `RABBITMQ_URL` | `amqp://guest:guest@localhost:5672` | Conexão AMQP |
| `ORDER_QUEUE` | `orders_queue` | Nome da fila |
| `ORDER_QUEUE_DLQ` | `orders_queue.dlq` | Fila de dead-letter (D-026) |
| `ORDER_QUEUE_RETRY` | `orders_queue.retry` | Fila de retry com TTL (D-027) |
| `MAX_RETRIES` | `3` | Retries após a 1ª falha; exaustão → DLQ (D-028) |
| `RETRY_TTL_MS` | `2000` | TTL base por tentativa — backoff multiplicativo (D-027) |
| `IDEMPOTENCY_TTL_MS` | `300000` | Janela de deduplicação por `order.id` (D-029) |
| `IDEMPOTENCY_MAX_ENTRIES` | `10000` | Capacidade da store de idempotência (FIFO) |
| `OTEL_SERVICE_NAME` | `consumer-service` | `service.name` no OTel |
| `SERVICE_VERSION` | `1.0.0` | `service.version` |
| `NODE_ENV` | `development` | `deployment.environment` |
| `SIMULATE_FAILURE_RATE` | `0` | Taxa de falha injetada (0..1) — D-021 |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | — | Endpoint OTLP de traces (prev. 1 — D-010) |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | — | Endpoint OTLP de métricas (prev. 1 — D-032) |
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | — | Endpoint OTLP de logs (prev. 1 — D-034) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — | Endpoint base OTLP (prev. 2 — anexa `/v1/{traces,metrics,logs}`) |
| `OTEL_METRIC_EXPORT_INTERVAL_MS` | `3000` | Intervalo de exportação de métricas (D-032) |
| `OTEL_TRACES_SAMPLER` | `always_on` | Amostragem |
| `LOG_LEVEL` | `log` | Nível de log do app |
| `OTEL_LOG_LEVEL` | `info` | Nível de log do SDK OTel |

> `SIMULATE_FAILURE_RATE=1` faz todo pedido falhar: o fluxo passa pelas tentativas com backoff (`orders_queue.retry`) até o limite `MAX_RETRIES` e cai no **DLQ** (`orders_queue.dlq`) — ótimo para demonstrar o cenário de erro completo (retry + dead-letter) no Jaeger e na UI do RabbitMQ.

## Scripts

| Comando | Ação |
|---|---|
| `npm run dev` | Sobe em watch (`nest start --watch`) |
| `npm run build` | Compila para `dist/` |
| `npm run start` | Roda o compilado (`node dist/main`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run clean` | Remove `dist/` |
| `npm test` | Testes unitários (idempotency, retry-policy e extração de contexto) |

## Comportamento

- Assina `orders_queue` (`durable=true`, `prefetchCount=1`, `noAck=false`); **owner** único da topologia no boot (declara `dlx`, `orders_queue.dlq`, `orders_queue.retry` e a própria `orders_queue` com arguments de DLX — F-42/D-026/D-031).
- A cada mensagem: log `Processing order: <id>` → span `handleOrderCreated` com eventos `order_received` / `order_processed` e atributos pesquisáveis (`order.id`, `order.customer_id`, `order.amount`, `messaging.*`).
- **Sucesso** → `ack` + `markProcessed` (`order_processed`).
- **Falha retryável** (`tentativa ≤ MAX_RETRIES`) → republica cópia em `orders_queue.retry` com `x-retry-count` e `expiration = RETRY_TTL_MS × tentativa` (backoff multiplicativo, mesmo `trace_id`); `ack` da original.
- **Falha terminal** (`tentativa > MAX_RETRIES`) → `nack(requeue=false)` → `dlx` → `orders_queue.dlq` com headers `x-retry-count` + `x-death` (histórico completo).
- **Duplicata** (`order.id` processado na janela `IDEMPOTENCY_TTL_MS`) → `ack` + skip com evento `order_duplicate_skipped` (não re-executa, não retenta).

## Como ver os spans deste serviço

1. Abra `http://localhost:16686` (Jaeger).
2. Busque por `service=consumer-service` + tag `order.id=ORD-<id>`.
3. O trace inclui `orders_queue process` (auto, `amqplib`) e `handleOrderCreated` (manual) — no **mesmo** `trace_id` do producer (FR-013).

## Métricas e logs (v1.2)

- **Métricas**: `orders.consumed` e `orders.dead_lettered` (counters) exportadas por OTLP → Collector → `http://localhost:9464/metrics` (ex. `otel_orders_consumed_total`).
- **Logs**: ponte `OtelLogger` (RFC §7.9) — console + `LogRecord` para o Collector → **Loki** (`http://localhost:3100`), com `trace_id`/`span_id` do span ativo.
- Para inspecionar: consultar no Loki `{job="consumer-service"}`.

## Troubleshooting

| Sintoma | Causa | Ação |
|---|---|---|
| Warning `headers traceparent não encontrados` | Header ausente na mensagem (R-03/R-04) | Inspecionar a mensagem na UI do RabbitMQ (`:15672`); conferir se o producer injeta `traceparent` |
| Consumer não processa | Pattern não casa | Confirmar que o payload tem `pattern: order.created` (Nest RMQ roteia pelo payload) |
| Dois `trace_id` para um pedido | Extração manual sem `traceparent` (D-007) | Inspecionar headers no broker; validar `extractTraceHeaders` |
| `Cannot find module '@opentelemetry/...'` | Deps não instaladas | `npm ci` + `npm run build` |

Detalhes: runbook completo em [`docs/RFC.md` §8.3](../docs/RFC.md).