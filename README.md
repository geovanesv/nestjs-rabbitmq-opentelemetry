# Rastreamento Distribuído — OpenTelemetry + RabbitMQ + NestJS

Demonstração funcional de **rastreamento distribuído ponta a ponta**: um pedido criado em um produtor NestJS (HTTP) é publicado em um **RabbitMQ**, consumido por um **consumer** NestJS e a jornada completa — da requisição ao processamento — aparece como **um único trace** no **Jaeger**, atravessando os dois serviços com o mesmo `trace_id`.

Referências: [`docs/PRD.md`](docs/PRD.md) (escopo/aceite) · [`docs/RFC.md`](docs/RFC.md) (contrato técnico) · [`docs/RELEASE_PLAN.md`](docs/RELEASE_PLAN.md) (organização da implementação).

## Pré-requisitos

- Node.js **>= 18**
- Docker + Docker Compose **v2**
- Portas livres: `3001, 5672, 15672, 4317, 4318, 13133, 16686, 9464, 3100`

## Quickstart (5 passos)

```bash
# 1. Infra (RabbitMQ, Jaeger, OTel Collector, Loki) — roda em segundo plano
make infra-up

# 2. Instala dependências dos 2 serviços (npm ci em cada)
make install

# 3. Terminal 1 — producer (HTTP :3001)
make dev-producer

# 4. Terminal 2 — consumer (assinando orders_queue)
make dev-consumer

# 5. Crie um pedido e abra o Jaeger
curl -X POST http://localhost:3001/orders \
  -H 'Content-Type: application/json' \
  -d '{"customerId":"CUST-001","amount":100.50,"items":["item1","item2"]}'
open http://localhost:16686   # busca: service=consumer-service, tag order.id=ORD-...
```

### O que observar no Jaeger

- Um **único trace** com spans de `producer-service` **e** `consumer-service` (mesmo `trace_id`).
- Spans: `POST /orders` e `createOrder` (producer), `orders_queue send` (publish, auto), `orders_queue process` (consume, auto) e `handleOrderCreated` (consumer).
- Eventos de negócio: `order_created`, `order_sent_to_queue`, `order_received`, `order_processed`.
- Latência por etapa e a duração ~500ms do processamento simulado.
- **Baggage (v1.3)**: o span `handleOrderCreated` do consumer carrega `user.id` e `request.id` vindos do producer através do header `baggage` da mensagem (W3C Baggage — 3º mecanismo de propagação do OTel).

## Arquitetura

```
┌─ HOST (desenvolvimento) ─────────────────────────────────────────────┐
│                                                                       │
│  producer-service (NestJS HTTP :3001)        consumer-service (NestJS)│
│    main.ts → import './tracing' (SDK OTel)      main.ts → ./tracing   │
│    OrderController/service                      OrderConsumer         │
│      span createOrder ▼ emit order.created        @EventPattern        │
│                                          propagation.extract(s)       │
│                        ┌───────────┐   consume   span handleOrderCreated│
│          publish ────► │  rabbitmq │ ◄───────────────────────────      │
│  amqp://guest:guest@    │ :5672     │                                  │
│   localhost:5672        │ orders_queue                                   │
│                        └───────────┘                                   │
│   DLQ/retry (v1.1): falha retryável → orders_queue.retry (TTL exp)       │
│                    falha terminal → dlx (direct) → orders_queue.dlq      │
│                              │ OTLP/HTTP :4318 (traces, métricas, logs)  │
│                              ▼                                           │
│   otel-collector (batch → otlp/jaeger, prometheus :9464, loki)           │
│        │ traces                          │ métricas      │ logs          │
│        ▼                                 ▼               ▼               │
│   jaeger all-in-one :16686         (/metrics :9464)   loki :3100         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Contrato da API (producer `:3001`)

| Método | Rota | Request | Sucesso | Erros |
|---|---|---|---|---|
| `POST` | `/orders` | `CreateOrderDto` | `201` + `Order` | `400` (validação) |
| `GET` | `/orders` | — | `200` + `Order[]` (mais recente primeiro, máx. 100) | — |
| `GET` | `/orders/:id` | — | `200` + `Order` | `404` `Order <id> not found` |
| `GET` | `/health` | — | `200` `{ status, service, version, uptime }` | — |

Payload de exemplo:

```json
{
  "customerId": "CUST-001",
  "amount": 100.5,
  "items": ["item1", "item2"]
}
```

Resposta (`201`):

```json
{
  "id": "ORD-1710073800000-a1b2",
  "customerId": "CUST-001",
  "amount": 100.5,
  "items": ["item1", "item2"],
  "timestamp": "2024-03-10T12:30:00.000Z"
}
```

Payloads inválidos (ex.: `amount` negativo, `items` vazio, campo extra) retornam `400` **sem** criar o span de negócio.

## Como a propagação de contexto funciona

Cada requisição carrega um `trace_id`. Quando o producer publica na fila, a instrumentação do `amqplib` injeta automaticamente o header **`traceparent`** (padrão W3C Trace Context: `00-<32hex trace-id>-<16hex span-id>-01`) na mensagem do RabbitMQ. No consumer, o `@EventPattern` usa um helper puro (`extractTraceHeaders`) para extrair esse header e chamar `propagation.extract`, colocando o processamento no **mesmo contexto** — assim o span `handleOrderCreated` nasce como filho do publish do producer (Forma A, RFC §7.4). Resultado: a jornada completa em um único trace.

## DLQ, retry com backoff e idempotência (v1.1)

Desde a v1.1 o consumer gerencia falhas de forma determinística (contrato completo em [`RFC §7.2.1`](docs/RFC.md)):

- **Sucesso** → `ack` + marcação de idempotência.
- **Falha retryável** (até `MAX_RETRIES`) → cópia republicada em `orders_queue.retry` com `expiration = RETRY_TTL_MS × tentativa` (backoff multiplicativo), preservando `traceparent` — as tentativas seguem o **mesmo `trace_id`** no Jaeger.
- **Falha terminal** → `nack(requeue=false)` → exchange `dlx` (direct) → **`orders_queue.dlq`**, com headers `x-retry-count` e `x-death` inspecionáveis na UI do RabbitMQ (`:15672`).
- **Duplicata** (mesmo `order.id` na janela `IDEMPOTENCY_TTL_MS`) → `ack` + skip, sem re-execução.

A topologia (incl. `orders_queue` com args de DLX) é criada **exclusivamente pelo consumer** no boot (D-031); o producer usa `noAssert` e não declara fila. Veja a fila `orders_queue` — se `x-dead-letter-routing-key` não casar com o binding do `dlx` (`orders_queue`), o exchange `direct` **descarta a mensagem em silêncio** (correção D-026 aplicada em WP-13).

Demonstração completa (pausa o consumer canônico, sobe um de teste com falha 100%, verifica o DLQ e restaura):

```bash
make verify-dlq
```

## Métricas e logs (v1.2)

Além dos traces, cada serviço exporta **métricas** e **logs** via OTLP/HTTP (contrato em [`RFC §7.9`](docs/RFC.md) e decisões D-032..D-036):

- **Métricas** — producer: `orders.created` (counter) + `orders.creation.duration` (histograma ms); consumer: `orders.consumed` + `orders.dead_lettered`. O Collector as expõe no formato Prometheus em `http://localhost:9464/metrics` (prefixo `otel_`).
- **Logs** — a ponte `OtelLogger` (RFC §7.9/D-034) imprime no console **e** emite `LogRecord`s (com `trace_id`/`span_id` do span ativo) → Collector → **Loki** (`http://localhost:3100`, container `loki` do Compose).
- **Prometheus/Grafana** como UI explorável ficam no backlog do RFC (§12.2 #7).

Verificação (exit 0 = aceite):

```bash
make verify-observability
```

### Baggage (v1.3)

O W3C **Baggage** (`user.id`/`request.id`) — RFC §7.10/D-037 — é injetado pelo producer no header `baggage` da mensagem do RabbitMQ (junto do `traceparent`) e restaurado pelo consumer, que expõe `user.id` e `request.id` como atributos pesquisáveis no span `handleOrderCreated`. Verificação:

```bash
make verify-baggage
```

## Comandos (Makefile)

| Alvo | Ação |
|---|---|
| `make help` | Lista os alvos |
| `make infra-up` | Sobe RabbitMQ + Jaeger + Collector + Loki (`docker compose up -d`) |
| `make infra-down` | Derruba a infra |
| `make infra-logs` | Segue os logs da infra |
| `make install` | `npm ci` nos 2 serviços |
| `make build` | `npm run build` nos 2 serviços |
| `make typecheck` | `tsc --noEmit` nos 2 serviços |
| `make dev-producer` / `make dev-consumer` | Sobe os serviços em watch |
| `make start-producer` / `make start-consumer` | Roda o compilado |
| `make smoke` | Curls de `/health`, `POST /orders`, `GET /orders` |
| `make verify` | **Prova E2E**: trace único com os 2 serviços (exit 0 = aceite) |
| `make verify-dlq` | **Prova E2E do DLQ/retry**: falha 100% → retries → `orders_queue.dlq` (exit 0) |
| `make verify-observability` | **Prova E2E de métricas + logs**: `:9464/metrics` + Loki (exit 0) |
| `make verify-baggage` | **Prova E2E do baggage**: `user.id`/`request.id` no span do consumer (exit 0) |
| `make verify-ids` | **Prova E2E de IDs**: 30 POSTs concorrentes → ids únicos `ORD-<ts>-<rand4>` (exit 0) |
| `make verify-messaging` | **Prova E2E de semconv**: spans `orders_queue publish`/`orders_queue process` com atributos semconv novos (D-039, exit 0) |
| `make test` | Testes unitários (consumer) |
| `make clean` | Remove `dist/` dos serviços |

## Variáveis de ambiente

Documentação completa: [`docs/RFC.md` §5.2](docs/RFC.md). Resumo:

| Variável | Serviços | Default | Uso |
|---|---|---|---|
| `PORT` | producer | `3001` | Porta HTTP |
| `RABBITMQ_URL` | ambos | `amqp://guest:guest@localhost:5672` | Conexão AMQP |
| `ORDER_QUEUE` | ambos | `orders_queue` | Nome da fila |
| `OTEL_SERVICE_NAME` | ambos | `producer-service` / `consumer-service` | `service.name` |
| `SERVICE_VERSION` | ambos | `1.0.0` | `service.version` |
| `NODE_ENV` | ambos | `development` | `deployment.environment` |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | ambos | — | Endpoint OTLP de traces (prev. 1, D-010) |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | ambos | — | Endpoint OTLP de métricas (prev. 1, D-032) |
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | ambos | — | Endpoint OTLP de logs (prev. 1, D-034) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | ambos | — | Endpoint base (prev. 2 — anexa `/v1/{traces,metrics,logs}`) |
| `OTEL_METRIC_EXPORT_INTERVAL_MS` | ambos | `3000` | Intervalo de exportação de métricas (D-032) |
| `SIMULATE_FAILURE_RATE` | consumer | `0` | Taxa de falha injetada (D-021) |
| `ORDER_QUEUE_DLQ` | consumer | `orders_queue.dlq` | Fila de dead-letter (D-026) |
| `ORDER_QUEUE_RETRY` | consumer | `orders_queue.retry` | Fila de retry com TTL (D-027) |
| `MAX_RETRIES` | consumer | `3` | Retries após a 1ª falha; exaustão → DLQ (D-028) |
| `RETRY_TTL_MS` | consumer | `2000` | TTL base por tentativa — backoff multiplicativo |
| `IDEMPOTENCY_TTL_MS` | consumer | `300000` | Janela de deduplicação por `order.id` (D-029) |
| `IDEMPOTENCY_MAX_ENTRIES` | consumer | `10000` | Capacidade da store de idempotência |
| `LOG_LEVEL` | ambos | `log` | Nível de log do app |
| `OTEL_LOG_LEVEL` | ambos | `info` | Nível de log do SDK |

`.env.example` por serviço: [`producer/.env.example`](producer/.env.example) e [`consumer/.env.example`](consumer/.env.example).

## Troubleshooting

| Sintoma | Causa provável | Ação |
|---|---|---|
| Traces não aparecem | Endpoint OTLP errado | `echo $OTEL_EXPORTER_OTLP_ENDPOINT`; conferir `/v1/traces` uma única vez (D-010) |
| Traces não aparecem | Collector parado | `docker compose -f docker/docker-compose.yml ps`; `curl :13133`; logs do collector |
| Dois `trace_id` | Extração manual sem `traceparent` | Inspecionar headers na UI do RabbitMQ; validar `extractTraceHeaders` |
| Spans de RabbitMQ duplicados | Instrumentação dupla | Remover `new AmqplibInstrumentation()` (D-005) |
| RabbitMQ não conecta | `RABBITMQ_URL` errada / unhealty | `docker compose logs rabbitmq` |
| Métricas ausentes em `:9464` | Collector sem pipeline de métricas ou `9464` não mapeada | `docker compose up -d` (recria o collector); depois `curl http://localhost:9464/metrics` |
| Logs ausentes no Loki | Loki fora ou pipeline de logs ausente | `curl http://localhost:3100/ready`; `curl 'http://localhost:3100/loki/api/v1/label/job/values'` |
| `Cannot find module '@opentelemetry/...'` | Deps não instaladas | `npm ci` em cada serviço + `npm run build` |

Runbook completo: [`docs/RFC.md` §8.3](docs/RFC.md).

## Desvios documentados em relação ao material de referência

O item não é tratado em silêncio — todos os desvios estão registrados em [`docs/RFC.md` §3.1](docs/RFC.md). Destaques:

- Versões do OTel ajustadas para compatibilidade (SDK `0.50.0`, `api@1.9.0` fixado — nunca 2.x) em D-003.
- Extração de contexto **manual** no consumer (D-007) para garantir o `trace_id` único.
- Atributos pesquisáveis nos spans **além** de eventos (D-018), viabilizando a busca `order.id` e o `make verify`.
- Sem containerização das apps na v1 (é o backlog B-5); serviços rodam no host, infra em containers.
- Extensão `health_check` do Collector adicionada (D-024) para atender FR-001.
- v1.1 (WP-13): `x-dead-letter-routing-key` da `orders_queue` **igual ao binding do `dlx`** (`orders_queue`) — a redação original da D-026 (`orders_queue.dlq`) descartava a mensagem em silêncio; D-026 foi emendada.
- v1.2 (WP-14): `@opentelemetry/sdk-metrics` é da linha **estável `1.23.0`** (D-003 alinhado ao `sdk-node@0.50.0` que já a depende); demais pacotes de métricas/logs seguem a linha experimental `0.50.0`.
- v1.3 (WP-15): em `@opentelemetry/api@1.9.0` (fixada por D-003) o baggage usa **`propagation.createBaggage`/`setBaggage`/`getBaggage`** (não são exports de topo da API 1.9).
- v1.4 (WP-16): `order.id` passou do formato do material `ORD-<ts>` para **`ORD-<ts>-<rand4>`** (D-038 — backlog §12.2 #1 fechado; id legível e ordenável por tempo, sem colisão sob concorrência).
- v1.5 (WP-17): os spans de messaging da instrumentação (amqplib) foram renomeados para semconv — `<default> -> orders_queue send` vira **`orders_queue publish`** — via `MessagingSemconvSpanProcessor` (D-039 — backlog §12.2 #5 fechado).

## Verificação automatizada

```bash
make verify
```

Saída esperada (resumida):

```
✓ VERIFY OK — aceite principal M3
  trace id      : <traceID>
  nº de spans   : 12
  serviços      : producer-service + consumer-service
```

`exit 0` prova o **aceite principal do produto** (FR-013): um único `trace_id` cobrindo os dois serviços. Detalhes da implementação em [`docs/RELEASE_PLAN.md`](docs/RELEASE_PLAN.md) (WP-09).

### DLQ/retry (v1.1)

```bash
make verify-dlq
```

Saída esperada (resumida):

```
✓ VERIFY-DLQ OK — pedido falhou, retryou com backoff e caiu no DLQ
  tentativas  : 3 (retries = 2)
  dlq         : orders_queue.dlq (1 na fila)
  x-death     : 2 registro(s)
```

`exit 0` prova o aceite do contrato de falha da v1.1 (RFC §7.2.1 / F-47): com `SIMULATE_FAILURE_RATE=1` e `MAX_RETRIES=2`, o pedido é tentado 3 vezes com backoff e termina **inspecionável** em `orders_queue.dlq` (nenhum dado descartado), com `x-death` preservado e continuidade de `trace_id`.

## Modo opcional: serviços em containers (perfil `app`)

A v1 roda por padrão com os apps no host (acima). Se quiser a paridade dev/prod via containers:

```bash
docker compose -f docker/docker-compose.yml --profile app up -d --build
make verify   # também passa em modo container
```

Nesse modo os apps usam os hosts de rede do Compose (`rabbitmq`, `otel-collector`) em vez de `localhost`; o Jaeger continua em `http://localhost:16686`. Detalhes em [`docs/RFC.md` §12.4](docs/RFC.md).