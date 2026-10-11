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
| `OTEL_SERVICE_NAME` | `consumer-service` | `service.name` no OTel |
| `SERVICE_VERSION` | `1.0.0` | `service.version` |
| `NODE_ENV` | `development` | `deployment.environment` |
| `SIMULATE_FAILURE_RATE` | `0` | Taxa de falha injetada (0..1) — D-021 |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | — | Endpoint OTLP (prev. 1 — D-010) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — | Endpoint base OTLP (prev. 2) |
| `OTEL_TRACES_SAMPLER` | `always_on` | Amostragem |
| `LOG_LEVEL` | `log` | Nível de log do app |
| `OTEL_LOG_LEVEL` | `info` | Nível de log do SDK OTel |

> `SIMULATE_FAILURE_RATE=1` faz todo pedido falhar (para demonstrar `recordException` + status ERROR no Jaeger sem requeue).

## Scripts

| Comando | Ação |
|---|---|
| `npm run dev` | Sobe em watch (`nest start --watch`) |
| `npm run build` | Compila para `dist/` |
| `npm run start` | Roda o compilado (`node dist/main`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run clean` | Remove `dist/` |
| `npm test` | Testes unitários (jest) do helper de extração |

## Comportamento

- Assina `orders_queue` (`durable=true`, `prefetchCount=1`).
- A cada mensagem: log `Processing order: <id>` → span `handleOrderCreated` com eventos `order_received` / `order_processed` e atributos pesquisáveis (`order.id`, `order.customer_id`, `order.amount`, `messaging.*`).
- Falha de processamento → `recordException` + status `ERROR` no span e log `Error processing order <id>`; **sem requeue** (D-019, evita loop). O consumer segue vivo.

## Como ver os spans deste serviço

1. Abra `http://localhost:16686` (Jaeger).
2. Busque por `service=consumer-service` + tag `order.id=ORD-<id>`.
3. O trace inclui `orders_queue process` (auto, `amqplib`) e `handleOrderCreated` (manual) — no **mesmo** `trace_id` do producer (FR-013).

## Troubleshooting

| Sintoma | Causa | Ação |
|---|---|---|
| Warning `headers traceparent não encontrados` | Header ausente na mensagem (R-03/R-04) | Inspecionar a mensagem na UI do RabbitMQ (`:15672`); conferir se o producer injeta `traceparent` |
| Consumer não processa | Pattern não casa | Confirmar que o payload tem `pattern: order.created` (Nest RMQ roteia pelo payload) |
| Dois `trace_id` para um pedido | Extração manual sem `traceparent` (D-007) | Inspecionar headers no broker; validar `extractTraceHeaders` |
| `Cannot find module '@opentelemetry/...'` | Deps não instaladas | `npm ci` + `npm run build` |

Detalhes: runbook completo em [`docs/RFC.md` §8.3](../docs/RFC.md).