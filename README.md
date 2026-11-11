# Rastreamento Distribuído com OpenTelemetry, RabbitMQ e NestJS

[![Architecture diagram](https://gitdiagram.com/diagram-badge.svg)](https://gitdiagram.com/geovanesv/nestjs-rabbitmq-opentelemetry?utm_source=readme&utm_medium=badge)
![Node.js](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)
![NestJS](https://img.shields.io/badge/NestJS-E0234E?logo=nestjs&logoColor=white)
![RabbitMQ](https://img.shields.io/badge/RabbitMQ-FF6600?logo=rabbitmq&logoColor=white)
![OpenTelemetry](https://img.shields.io/badge/OpenTelemetry-traces%20%7C%20metrics%20%7C%20logs-425CC7?logo=opentelemetry&logoColor=white)

Demonstração funcional de **rastreamento distribuído ponta a ponta**. Um pedido criado em um *producer* NestJS (HTTP) é publicado no **RabbitMQ**, consumido por um *consumer* NestJS, e toda a jornada (da requisição ao processamento) aparece como **um único trace** no **Jaeger**, atravessando os dois serviços com o mesmo `trace_id`.

Além de traces, o projeto exporta **métricas** (Prometheus) e **logs** (Loki) correlacionados, e demonstra **DLQ, retry com backoff, idempotência** e **W3C Baggage**.

> **Documentação complementar:** [`docs/PRD.md`](docs/PRD.md) (escopo e aceite) · [`docs/RFC.md`](docs/RFC.md) (contrato técnico) · [`docs/RELEASE_PLAN.md`](docs/RELEASE_PLAN.md) (plano de implementação)

---

## Sumário

- [Destaques](#destaques)
- [Arquitetura](#arquitetura)
- [Pré-requisitos](#pré-requisitos)
- [Quickstart](#quickstart)
- [O que observar no Jaeger](#o-que-observar-no-jaeger)
- [API do producer](#api-do-producer)
- [Como a propagação de contexto funciona](#como-a-propagação-de-contexto-funciona)
- [Resiliência: retry, DLQ e idempotência](#resiliência-retry-dlq-e-idempotência-v11)
- [Métricas e logs](#métricas-e-logs-v12)
- [Baggage](#baggage-v13)
- [Comandos (Makefile)](#comandos-makefile)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Verificação automatizada](#verificação-automatizada)
- [Modo opcional: serviços em containers](#modo-opcional-serviços-em-containers)
- [Troubleshooting](#troubleshooting)
- [Desvios em relação ao material de referência](#desvios-em-relação-ao-material-de-referência)

---

## Destaques

| Recurso | Versão | Descrição |
|---|---|---|
| Trace único producer → fila → consumer | v1.0 | Mesmo `trace_id` nos dois serviços via W3C Trace Context |
| DLQ + retry com backoff + idempotência | v1.1 | Falhas determinísticas, mensagens nunca descartadas |
| Métricas e logs via OTLP | v1.2 | Prometheus (`:9464`) e Loki (`:3100`), logs com `trace_id`/`span_id` |
| W3C Baggage | v1.3 | `user.id` e `request.id` propagados pela mensagem |
| IDs de pedido sem colisão | v1.4 | `ORD-<timestamp>-<rand4>` |
| Spans de messaging com semconv novo | v1.5 | `orders_queue publish` / `orders_queue process` |

---

## Arquitetura

Fluxo simplificado (o diagrama completo, com todos os módulos, está logo abaixo):



<details>
<summary><strong>Diagrama completo de componentes</strong> (gerado com GitDiagram)</summary>

![Diagrama de arquitetura](https://github.com/user-attachments/assets/70308332-4e21-4ce9-aeaf-3791c164d4a2)

</details>

### Componentes principais

| Serviço | Componente | Responsabilidade |
|---|---|---|
| **producer** | `main.ts` | Bootstrap; importa `./tracing` primeiro, instala o logger OTel |
| | `order.dto.ts` | Validação do payload (`400` sem criar span de negócio) |
| | `order.service.ts` | Cria pedidos, guarda em memória e publica no RabbitMQ |
| | `ids.ts` · `baggage.ts` | Geração de IDs e criação do baggage |
| | `rabbitmq.config.ts` | Cliente de fila (`noAssert`, não declara topologia) |
| **consumer** | `main.ts` | Bootstrap; declara topologia e inicia o consumo |
| | `order.consumer.ts` | Handler `@EventPattern`: extrai contexto, deduplica, processa, `ack`/retry |
| | `dlq.setup.ts` | Topologia de retry e DLQ (única fonte de declaração de filas) |
| | `retry-policy.ts` | Decide retry vs. falha terminal |
| | `read-baggage.ts` | Restaura o baggage como atributos do span |
| | Idempotency store | Deduplicação por `order.id` com TTL |
| **ambos** | `tracing.ts` · `metrics.ts` · `otel-logger.ts` | SDK OTel, métricas e ponte de logs |
| | Messaging span processor | Renomeia spans de messaging para semconv (D-039) |

---

## Pré-requisitos

- **Node.js** >= 18
- **Docker** + **Docker Compose v2**
- Portas livres: `3001`, `5672`, `15672`, `4317`, `4318`, `13133`, `16686`, `9464`, `3100`

---

## Quickstart

```bash
# 1. Sobe a infra (RabbitMQ, Jaeger, OTel Collector, Loki) em segundo plano
make infra-up

# 2. Instala as dependências dos dois serviços (npm ci em cada)
make install

# 3. Terminal 1: producer (HTTP :3001)
make dev-producer

# 4. Terminal 2: consumer (assinando orders_queue)
make dev-consumer

# 5. Crie um pedido
curl -X POST http://localhost:3001/orders \
  -H 'Content-Type: application/json' \
  -d '{"customerId":"CUST-001","amount":100.50,"items":["item1","item2"]}'
```

Depois abra o Jaeger em <http://localhost:16686> (`open` no macOS, `xdg-open` no Linux) e busque por `service=consumer-service` com a tag `order.id=ORD-...`.

| Interface | URL |
|---|---|
| Jaeger UI | <http://localhost:16686> |
| RabbitMQ Management (`guest`/`guest`) | <http://localhost:15672> |
| Métricas (Prometheus format) | <http://localhost:9464/metrics> |
| Loki | <http://localhost:3100> |

---

## O que observar no Jaeger

- Um **único trace** com spans de `producer-service` **e** `consumer-service` (mesmo `trace_id`).
- Spans esperados:
  - `POST /orders` e `createOrder` (producer)
  - `orders_queue publish` (publicação, automático)
  - `orders_queue process` (consumo, automático)
  - `handleOrderCreated` (consumer)
- Eventos de negócio: `order_created`, `order_sent_to_queue`, `order_received`, `order_processed`.
- Latência por etapa e a duração de ~500 ms do processamento simulado.
- **Baggage:** o span `handleOrderCreated` carrega `user.id` e `request.id` vindos do producer.

---

## API do producer

Base: `http://localhost:3001`

| Método | Rota | Request | Sucesso | Erros |
|---|---|---|---|---|
| `POST` | `/orders` | `CreateOrderDto` | `201` + `Order` | `400` (validação) |
| `GET` | `/orders` | n/a | `200` + `Order[]` (mais recente primeiro, máx. 100) | n/a |
| `GET` | `/orders/:id` | n/a | `200` + `Order` | `404` `Order <id> not found` |
| `GET` | `/health` | n/a | `200` `{ status, service, version, uptime }` | n/a |

**Request**

```json
{
  "customerId": "CUST-001",
  "amount": 100.5,
  "items": ["item1", "item2"]
}
```

**Resposta (`201`)**

```json
{
  "id": "ORD-1710073800000-a1b2",
  "customerId": "CUST-001",
  "amount": 100.5,
  "items": ["item1", "item2"],
  "timestamp": "2024-03-10T12:30:00.000Z"
}
```

Payloads inválidos (`amount` negativo, `items` vazio, campo extra) retornam `400` **sem** criar o span de negócio.

---

## Como a propagação de contexto funciona

1. Cada requisição carrega um `trace_id`.
2. Ao publicar na fila, a instrumentação do `amqplib` injeta automaticamente o header **`traceparent`** (W3C Trace Context: `00-<32hex trace-id>-<16hex span-id>-01`).
3. No consumer, o `@EventPattern` usa o helper puro `extractTraceHeaders` e chama `propagation.extract`, colocando o processamento no **mesmo contexto**.
4. O span `handleOrderCreated` nasce como filho do publish do producer (Forma A, RFC §7.4).

Resultado: a jornada completa em um único trace.

---

## Resiliência: retry, DLQ e idempotência (v1.1)

Contrato completo em [`RFC §7.2.1`](docs/RFC.md).

| Situação | Comportamento |
|---|---|
| **Sucesso** | `ack` + marcação de idempotência |
| **Falha retryável** (até `MAX_RETRIES`) | Cópia republicada em `orders_queue.retry` com `expiration = RETRY_TTL_MS × tentativa` (backoff multiplicativo), preservando `traceparent`. As tentativas seguem o **mesmo `trace_id`** |
| **Falha terminal** | `nack(requeue=false)` → exchange `dlx` (direct) → `orders_queue.dlq`, com `x-retry-count` e `x-death` visíveis na UI do RabbitMQ |
| **Duplicata** (mesmo `order.id` dentro de `IDEMPOTENCY_TTL_MS`) | `ack` + skip, sem reexecução |


**Notas importantes**

- A topologia (incluindo `orders_queue` com argumentos de DLX) é criada **exclusivamente pelo consumer** no boot (D-031). O producer usa `noAssert` e não declara fila.
- Se `x-dead-letter-routing-key` não casar com o binding do `dlx` (`orders_queue`), o exchange `direct` **descarta a mensagem em silêncio** (correção D-026, aplicada no WP-13).

**Demonstração completa** (pausa o consumer canônico, sobe um de teste com falha de 100%, verifica o DLQ e restaura):

```bash
make verify-dlq
```

---

## Métricas e logs (v1.2)

Cada serviço exporta métricas e logs via OTLP/HTTP (contrato em [`RFC §7.9`](docs/RFC.md), decisões D-032 a D-036).

| Sinal | Serviço | Itens |
|---|---|---|
| Métricas | producer | `orders.created` (counter), `orders.creation.duration` (histograma, ms) |
| Métricas | consumer | `orders.consumed`, `orders.dead_lettered` |
| Logs | ambos | Ponte `OtelLogger`: imprime no console **e** emite `LogRecord`s com `trace_id`/`span_id` do span ativo |

- O Collector expõe as métricas no formato Prometheus em <http://localhost:9464/metrics> (prefixo `otel_`).
- Os logs vão para o **Loki** (<http://localhost:3100>), container `loki` do Compose.
- Prometheus/Grafana como UI explorável estão no backlog (RFC §12.2 #7).

```bash
make verify-observability   # exit 0 = aceite
```

---

## Baggage (v1.3)

O **W3C Baggage** (`user.id` e `request.id`, RFC §7.10 / D-037) é injetado pelo producer no header `baggage` da mensagem, junto do `traceparent`, e restaurado pelo consumer, que o expõe como atributos pesquisáveis no span `handleOrderCreated`.

```bash
make verify-baggage
```

---

## Comandos (Makefile)

### Infraestrutura e build

| Alvo | Ação |
|---|---|
| `make help` | Lista os alvos |
| `make infra-up` | Sobe RabbitMQ + Jaeger + Collector + Loki (`docker compose up -d`) |
| `make infra-down` | Derruba a infra |
| `make infra-logs` | Segue os logs da infra |
| `make install` | `npm ci` nos 2 serviços |
| `make build` | `npm run build` nos 2 serviços |
| `make typecheck` | `tsc --noEmit` nos 2 serviços |
| `make clean` | Remove `dist/` dos serviços |

### Execução e testes

| Alvo | Ação |
|---|---|
| `make dev-producer` / `make dev-consumer` | Sobe os serviços em modo watch |
| `make start-producer` / `make start-consumer` | Roda o código compilado |
| `make smoke` | Curls de `/health`, `POST /orders` e `GET /orders` |
| `make test` | Testes unitários (consumer) |

### Provas E2E (exit 0 = aceite)

| Alvo | O que prova |
|---|---|
| `make verify` | Trace único com os 2 serviços |
| `make verify-dlq` | Falha 100% → retries → `orders_queue.dlq` |
| `make verify-observability` | Métricas em `:9464/metrics` + logs no Loki |
| `make verify-baggage` | `user.id`/`request.id` no span do consumer |
| `make verify-ids` | 30 POSTs concorrentes → ids únicos `ORD-<ts>-<rand4>` |
| `make verify-messaging` | Spans `orders_queue publish`/`process` com atributos semconv novos (D-039) |

---

## Variáveis de ambiente

Documentação completa em [`docs/RFC.md` §5.2](docs/RFC.md). Exemplos por serviço: [`producer/.env.example`](producer/.env.example) e [`consumer/.env.example`](consumer/.env.example).

### Gerais

| Variável | Serviços | Default | Uso |
|---|---|---|---|
| `PORT` | producer | `3001` | Porta HTTP |
| `RABBITMQ_URL` | ambos | `amqp://guest:guest@localhost:5672` | Conexão AMQP |
| `ORDER_QUEUE` | ambos | `orders_queue` | Nome da fila |
| `NODE_ENV` | ambos | `development` | `deployment.environment` |
| `LOG_LEVEL` | ambos | `log` | Nível de log do app |

### OpenTelemetry

| Variável | Serviços | Default | Uso |
|---|---|---|---|
| `OTEL_SERVICE_NAME` | ambos | `producer-service` / `consumer-service` | `service.name` |
| `SERVICE_VERSION` | ambos | `1.0.0` | `service.version` |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | ambos | n/a | Endpoint OTLP de traces (prec. 1, D-010) |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | ambos | n/a | Endpoint OTLP de métricas (prec. 1, D-032) |
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | ambos | n/a | Endpoint OTLP de logs (prec. 1, D-034) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | ambos | n/a | Endpoint base (prec. 2, anexa `/v1/{traces,metrics,logs}`) |
| `OTEL_METRIC_EXPORT_INTERVAL_MS` | ambos | `3000` | Intervalo de exportação de métricas (D-032) |
| `OTEL_LOG_LEVEL` | ambos | `info` | Nível de log do SDK |

### Resiliência (consumer)

| Variável | Default | Uso |
|---|---|---|
| `SIMULATE_FAILURE_RATE` | `0` | Taxa de falha injetada, de 0 a 1 (D-021) |
| `ORDER_QUEUE_DLQ` | `orders_queue.dlq` | Fila de dead-letter (D-026) |
| `ORDER_QUEUE_RETRY` | `orders_queue.retry` | Fila de retry com TTL (D-027) |
| `MAX_RETRIES` | `3` | Retries após a 1ª falha; exaustão → DLQ (D-028) |
| `RETRY_TTL_MS` | `2000` | TTL base por tentativa (backoff multiplicativo) |
| `IDEMPOTENCY_TTL_MS` | `300000` | Janela de deduplicação por `order.id` (D-029) |
| `IDEMPOTENCY_MAX_ENTRIES` | `10000` | Capacidade da store de idempotência |

---

## Verificação automatizada

### Trace único (aceite principal)

```bash
make verify
```

```
✓ VERIFY OK — aceite principal M3
  trace id      : <traceID>
  nº de spans   : 12
  serviços      : producer-service + consumer-service
```

`exit 0` prova o aceite principal do produto (FR-013): um único `trace_id` cobrindo os dois serviços. Detalhes em [`docs/RELEASE_PLAN.md`](docs/RELEASE_PLAN.md) (WP-09).

### DLQ e retry

```bash
make verify-dlq
```

```
✓ VERIFY-DLQ OK — pedido falhou, retryou com backoff e caiu no DLQ
  tentativas  : 3 (retries = 2)
  dlq         : orders_queue.dlq (1 na fila)
  x-death     : 2 registro(s)
```

`exit 0` prova o aceite do contrato de falha da v1.1 (RFC §7.2.1 / F-47): com `SIMULATE_FAILURE_RATE=1` e `MAX_RETRIES=2`, o pedido é tentado 3 vezes com backoff e termina **inspecionável** em `orders_queue.dlq` (nenhum dado descartado), com `x-death` preservado e continuidade de `trace_id`.

---

## Modo opcional: serviços em containers

Por padrão, os apps rodam no host e a infra em containers. Para paridade dev/prod, suba tudo via Compose (perfil `app`):

```bash
docker compose -f docker/docker-compose.yml --profile app up -d --build
make verify   # também passa em modo container
```

Nesse modo os apps usam os hosts de rede do Compose (`rabbitmq`, `otel-collector`) em vez de `localhost`. O Jaeger continua em <http://localhost:16686>. Detalhes em [`docs/RFC.md` §12.4](docs/RFC.md).

---

## Troubleshooting

| Sintoma | Causa provável | Ação |
|---|---|---|
| Traces não aparecem | Endpoint OTLP errado | `echo $OTEL_EXPORTER_OTLP_ENDPOINT`; conferir `/v1/traces` uma única vez (D-010) |
| Traces não aparecem | Collector parado | `docker compose -f docker/docker-compose.yml ps`; `curl :13133`; ver logs do collector |
| Dois `trace_id` distintos | Extração manual sem `traceparent` | Inspecionar headers na UI do RabbitMQ; validar `extractTraceHeaders` |
| Spans de RabbitMQ duplicados | Instrumentação dupla | Remover `new AmqplibInstrumentation()` (D-005) |
| RabbitMQ não conecta | `RABBITMQ_URL` errada ou broker *unhealthy* | `docker compose logs rabbitmq` |
| Métricas ausentes em `:9464` | Collector sem pipeline de métricas ou porta não mapeada | `docker compose up -d` (recria o collector); `curl http://localhost:9464/metrics` |
| Logs ausentes no Loki | Loki fora ou pipeline de logs ausente | `curl http://localhost:3100/ready`; `curl 'http://localhost:3100/loki/api/v1/label/job/values'` |
| `Cannot find module '@opentelemetry/...'` | Dependências não instaladas | `npm ci` em cada serviço + `npm run build` |

Runbook completo: [`docs/RFC.md` §8.3](docs/RFC.md).

---

## Desvios em relação ao material de referência

Nenhum desvio é tratado em silêncio: todos estão registrados em [`docs/RFC.md` §3.1](docs/RFC.md).

| Versão | Desvio |
|---|---|
| v1.0 | Versões do OTel ajustadas por compatibilidade: SDK `0.50.0` e `api@1.9.0` fixado, **nunca 2.x** (D-003) |
| v1.0 | Extração de contexto **manual** no consumer para garantir `trace_id` único (D-007) |
| v1.0 | Atributos pesquisáveis nos spans **além** de eventos, viabilizando a busca por `order.id` e o `make verify` (D-018) |
| v1.0 | Apps sem containerização por padrão (backlog B-5); extensão `health_check` do Collector adicionada (D-024) para atender FR-001 |
| v1.1 (WP-13) | `x-dead-letter-routing-key` igual ao binding do `dlx` (`orders_queue`); a redação original da D-026 descartava mensagens em silêncio, então foi emendada |
| v1.2 (WP-14) | `@opentelemetry/sdk-metrics` na linha estável `1.23.0` (D-003, alinhado ao `sdk-node@0.50.0`); demais pacotes de métricas/logs na linha experimental `0.50.0` |
| v1.3 (WP-15) | Na `api@1.9.0`, o baggage usa `propagation.createBaggage`/`setBaggage`/`getBaggage` (não são exports de topo) |
| v1.4 (WP-16) | `order.id` passou de `ORD-<ts>` para `ORD-<ts>-<rand4>` (D-038, backlog §12.2 #1 fechado) |
| v1.5 (WP-17) | Spans de messaging renomeados para semconv: `<default> -> orders_queue send` vira `orders_queue publish`, via `MessagingSemconvSpanProcessor` (D-039, backlog §12.2 #5 fechado) |

---

<sub>Diagrama de arquitetura gerado com [GitDiagram](https://gitdiagram.com/geovanesv/nestjs-rabbitmq-opentelemetry).</sub>
