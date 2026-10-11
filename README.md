# Rastreamento Distribuído — OpenTelemetry + RabbitMQ + NestJS

Demonstração funcional de **rastreamento distribuído ponta a ponta**: um pedido criado em um produtor NestJS (HTTP) é publicado em um **RabbitMQ**, consumido por um **consumer** NestJS e a jornada completa — da requisição ao processamento — aparece como **um único trace** no **Jaeger**, atravessando os dois serviços com o mesmo `trace_id`.

Referências: [`docs/PRD.md`](docs/PRD.md) (escopo/aceite) · [`docs/RFC.md`](docs/RFC.md) (contrato técnico) · [`docs/RELEASE_PLAN.md`](docs/RELEASE_PLAN.md) (organização da implementação).

## Pré-requisitos

- Node.js **>= 18**
- Docker + Docker Compose **v2**
- Portas livres: `3001, 5672, 15672, 4317, 4318, 13133, 16686`

## Quickstart (5 passos)

```bash
# 1. Infra (RabbitMQ, Jaeger, OTel Collector) — blocks em segundo plano
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
│                              │ OTLP/HTTP :4318/v1/traces               │
│                              ▼                                         │
│   otel-collector (receivers/procs batch → otlp/jaeger)                 │
│                              ▼                                         │
│               jaeger all-in-one :16686 (UI + API)                      │
└───────────────────────────────────────────────────────────────────────┘
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
  "id": "ORD-1710073800000",
  "customerId": "CUST-001",
  "amount": 100.5,
  "items": ["item1", "item2"],
  "timestamp": "2024-03-10T12:30:00.000Z"
}
```

Payloads inválidos (ex.: `amount` negativo, `items` vazio, campo extra) retornam `400` **sem** criar o span de negócio.

## Como a propagação de contexto funciona

Cada requisição carrega um `trace_id`. Quando o producer publica na fila, a instrumentação do `amqplib` injeta automaticamente o header **`traceparent`** (padrão W3C Trace Context: `00-<32hex trace-id>-<16hex span-id>-01`) na mensagem do RabbitMQ. No consumer, o `@EventPattern` usa um helper puro (`extractTraceHeaders`) para extrair esse header e chamar `propagation.extract`, colocando o processamento no **mesmo contexto** — assim o span `handleOrderCreated` nasce como filho do publish do producer (Forma A, RFC §7.4). Resultado: a jornada completa em um único trace.

## Comandos (Makefile)

| Alvo | Ação |
|---|---|
| `make help` | Lista os alvos |
| `make infra-up` | Sobe RabbitMQ + Jaeger + Collector (`docker compose up -d`) |
| `make infra-down` | Derruba a infra |
| `make infra-logs` | Segue os logs da infra |
| `make install` | `npm ci` nos 2 serviços |
| `make build` | `npm run build` nos 2 serviços |
| `make typecheck` | `tsc --noEmit` nos 2 serviços |
| `make dev-producer` / `make dev-consumer` | Sobe os serviços em watch |
| `make start-producer` / `make start-consumer` | Roda o compilado |
| `make smoke` | Curls de `/health`, `POST /orders`, `GET /orders` |
| `make verify` | **Prova E2E**: trace único com os 2 serviços (exit 0 = aceite) |
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
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | ambos | — | Endpoint OTLP (prev. 1, D-010) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | ambos | — | Endpoint base (prev. 2) |
| `SIMULATE_FAILURE_RATE` | consumer | `0` | Taxa de falha injetada (D-021) |
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
| `Cannot find module '@opentelemetry/...'` | Deps não instaladas | `npm ci` em cada serviço + `npm run build` |

Runbook completo: [`docs/RFC.md` §8.3](docs/RFC.md).

## Desvios documentados em relação ao material de referência

O item não é tratado em silêncio — todos os desvios estão registrados em [`docs/RFC.md` §3.1](docs/RFC.md). Destaques:

- Versões do OTel ajustadas para compatibilidade (SDK `0.50.0`, `api@1.9.0` fixado — nunca 2.x) em D-003.
- Extração de contexto **manual** no consumer (D-007) para garantir o `trace_id` único.
- Atributos pesquisáveis nos spans **além** de eventos (D-018), viabilizando a busca `order.id` e o `make verify`.
- Sem containerização das apps na v1 (é o backlog B-5); serviços rodam no host, infra em containers.
- Extensão `health_check` do Collector adicionada (D-024) para atender FR-001.

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