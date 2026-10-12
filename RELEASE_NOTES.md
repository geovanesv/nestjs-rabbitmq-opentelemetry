# v1.5.0 — Nomes semconv de messaging nos spans (RFC §12.2 #5 / PRD B-8 / WP-17)

## Incluído (v1.5)
- **`MessagingSemconvSpanProcessor`** (D-039/F-58, `{producer,consumer}/src/messaging-span-processor.ts`): renomeia os spans gerados pelo instrumentador amqplib para o template semconv **`{destination} {operation}`**:
  - producer: `<default> -> orders_queue send` → **`orders_queue publish`**
  - consumer: `orders_queue process` → **`orders_queue process`** (nome estável, com backfill de atributos)
- **Backfill semconv novo**: `messaging.operation.type` e `messaging.destination.name` passam a existir também nos spans do instrumentador (antes só nos spans de negócio), com os atributos antigos preservados.
- **Design conservador**: o processor só atua em spans com `messaging.rabbitmq.routing_key` (instrumentação) — `createOrder`/`handleOrderCreated` ficam **intactos** (contrato M3).
- **Verificação**: `make verify-messaging` (F-59) no MESMO trace; + unit test `consumer/test/messaging-span-processor.spec.ts`.

## Verificação (v1.5)
- `make verify-messaging` exit 0 — trace `c3fb0821c0d56af9f759d1e82f1c3031`: `orders_queue publish` (operation.type=publish, dest.name=orders_queue), `orders_queue process` (operation.type=process), nenhum nome `* send`, negócio intacto.
- `make verify` (M3) exit 0 — regressão (spans-chave `createOrder`/`handleOrderCreated` preservados).
- `make verify-ids`/`verify-baggage`/`verify-observability`/`verify-dlq` exit 0 — regressões.
- `make test` 24/24 (18 anteriores + 6 novas do processor); `make typecheck`/`build` limpos.

## Notas
- Os spans do Nest (`OrderController.create`) e do HTTP/Express não são messaging — intocados pelo processor.
- Mudança é puramente de observabilidade: nenhum comportamento/contrato de dados muda (FR-014 atualizado).

---

# v1.4.0 — IDs colision-safe `ORD-<epoch_ms>-<rand4>` (RFC §12.2 #1 / PRD B-2 / WP-16)

## Incluído (v1.4)
- **ID do pedido colision-safe** (D-038, emenda D-016): `producer/src/ids.ts` (F-56) gera `ORD-<epoch_ms>-<rand4>` — prefixo de tempo legível/ordenável + 4 hex aleatórios via `crypto.randomBytes(2)`. Duas requisições no **mesmo ms** não colidem mais.
- **Reuso do gerador**: `request.id` do baggage (WP-15/F-53) passa a usar `newRequestId()` de `ids.ts` (mesmo `rand4`).
- **Verificação**: `make verify-ids` (F-57): **30 POST /orders concorrentes** → 30 ids únicos no formato `^ORD-\d+-[0-9a-f]{4}$`.

## Verificação (v1.4)
- `make verify-ids` exit 0 — 30/30 únicos no mesmo burst (ex.: `ORD-1791806815514-f0b7`); sem colisão.
- `make verify` (M3) exit 0 — regressão (12 spans, 2 serviços).
- `make verify-baggage` exit 0 — regressão (requestid `REQ-<ts>-<rand4>` inalterado).
- `make typecheck`/`build` limpos; formato do id atualizado em FR-004/§5.2 do PRD.

## Notas
- O `id` é **opaco** para verificadores e `GET /orders/:id` (nenhum script parseia o formato — só a UI/README ilustra).
- `rand4` (16 bits) é suficiente para dev (rajada no mesmo ms) sem o custo/verbosidade de um UUID.

---

# v1.3.0 — Baggage de exemplo `user.id` / `request.id` (RFC §12.2 #4 / PRD B-4 / WP-15)

## Incluído (v1.3)
- **W3C Baggage no transporte RabbitMQ** (D-037): no `createOrder`, o producer cria baggage `user.id` (= `customerId`) + `request.id` (`REQ-<ts>-<rand4>`) e executa o `emit` sob `context.with(propagation.setBaggage(...))` — a instrumentação de amqplib serializa o header `baggage` junto do `traceparent` (D-006).
- **Consumo**: `propagation.extract` (D-007) restaura o baggage no contexto; o span `handleOrderCreated` ganha atributos pesquisáveis `user.id`/`request.id` (D-018) e o log de processamento exibe o usuário.
- **Retries/DLQ**: `scheduleRetry` copia `properties.headers` → o baggage sobrevive às retries e permanece na mensagem da DLQ (nenhuma mudança de código — já era comportamento).
- **Auxiliares**: `producer/src/baggage.ts` (F-53) e `consumer/src/tracing/read-baggage.ts` (F-54, puro) + spec unitário (3 novos).
- **Verificação**: `make verify-baggage` (F-55): POST `CUST-BAGGAGE` → asserta `user.id`/`request.id` no span do consumer no **mesmo** trace.

## Verificação (v1.3)
- `make verify-baggage` exit 0 — trace `0f608fdc504620b44d615224ec5fc7e2`: `user.id=CUST-BAGGAGE`, `request.id=REQ-1791804467103-275a` no span `handleOrderCreated` do consumer.
- `make verify` (M3) exit 0 — regressão de traces sem mudança (13 spans).
- `make verify-dlq` exit 0 — regressão WP-13 (ORD-1791804486541, 3 tentativas/2 retries, DLQ com `x-death`).
- `make verify-observability` exit 0 — regressão WP-14 (métricas `:9464` + log no Loki).
- `make typecheck`/`build` limpos; `make test` 18/18 (15 existentes + 3 do `read-baggage`).

## Notas
- `@opentelemetry/api@1.9.0` (fixada por D-003) expõe baggage por **`propagation.createBaggage`/`setBaggage`/`getBaggage`** — não são exports de topo da API 1.9.
- Baggage é contexto **in-memory**: só é injetado se o `emit` rodar dentro do `context.with` (D-037).

---

# v1.2.0 — Métricas e logs exporters (RFC §12.2 #3 / WP-14)

## Incluído (v1.2)
- **Métricas OTLP** (D-032/D-033): `sdk-node` dos dois serviços passa a configurar `MeterProvider` (`PeriodicExportingMetricReader`, `OTEL_METRIC_EXPORT_INTERVAL_MS` default 3000).
  - Producer: counter `orders.created` + histograma `orders.creation.duration` (ms, create→publish).
  - Consumer: counters `orders.consumed` e `orders.dead_lettered`.
  - Collector expõe no formato Prometheus em `:9464/metrics` (prefixo `otel_`, ex. `otel_orders_created_total`).
- **Logs OTLP** (D-034): ponte `OtelLogger` (F-50/F-51) implementa `LoggerService` do Nest — imprime no console no formato atual **e** emite `LogRecord` via `@opentelemetry/api-logs`, com severidade mapeada e `trace_id`/`span_id` do span ativo. Ativa por `Logger.overrideLogger` no bootstrap.
- **Coleta** (D-035): Collector com pipelines `metrics` (→ prometheus) e `logs` (→ loki); serviço `loki` (`grafana/loki:2.9.6`, `:3100`) no Compose.
- **Verificação**: `make verify-observability` (E2E: `orders_created_total ≥ 1` + histograma em `:9464/metrics` + log no Loki com trace_id) e `make verify-dlq` determinístico (purga as filas antes de testar).

## Verificação (v1.2)
- `make verify` (M3) exit 0 — regressão de traces sem mudança (12 spans, 2 serviços).
- `make verify-observability` exit 0 — `otel_orders_created_total` ≥ 1, `otel_orders_creation_duration_*` presente, log `"Order <id> created and published"` no Loki com `traceid`/`spanid`.
- `make verify-dlq` exit 0 — retry/DLQ intactos; DLQ inspecionada de forma resiliente (janela pós-DLX).
- `make typecheck`, `make build`, `make test` (15/15) limpos.

## Notas
- `@opentelemetry/sdk-metrics` é da linha **estável 1.23.0** (o `sdk-node@0.50.0` já a depende); `sdk-logs`, `api-logs`, `exporter-metrics-otlp-http` e `exporter-logs-otlp-http` são `0.50.0` (paridade experimental com o SDK 0.50.0).
- No collector `0.97.0`, o resource `service.name` vira a label `job` no Loki; os atributos do `LogRecord` vão no corpo JSON da linha.
- Prometheus/Grafana como UI permanecem no backlog RFC §12.2 #7.

---

# v1.1.0 — DLQ, retry com backoff e idempotência (RFC §12.2 #2 / WP-13)

## Incluído (v1.1)
- **DLQ**: `orders_queue` com `x-dead-letter-exchange: dlx` (direct, durável) + `x-dead-letter-routing-key: orders_queue`; fila `orders_queue.dlq` durável. Falha terminal → `nack(requeue=false)` → DLX → DLQ com headers `x-retry-count` + `x-death` (nada é descartado).
- **Retry com backoff multiplicativo**: `orders_queue.retry` com TTL por mensagem (`expiration = RETRY_TTL_MS × tentativa`); republica a cópia preservando `traceparent`/headers — tentativas seguem o **mesmo `trace_id`**.
- **Limite de tentativas**: `MAX_RETRIES` (default 3); exaustão → DLQ.
- **Idempotência**: store in-memory limitada por `order.id` (`IDEMPOTENCY_TTL_MS`, `IDEMPOTENCY_MAX_ENTRIES`, evicção FIFO); duplicata → ack + skip.
- **Topologia declarada só pelo consumer** (D-031): boot cria `dlx`, `orders_queue.dlq`, `orders_queue.retry` e re-aplica args de DLX na `orders_queue` (recreate em canal novo no 406); producer com `noAssert: true`.
- **Verificação**: `make verify-dlq` (E2E com falha 100% → retries → DLQ); `make test` 15/15 (idempotency + retry-policy + extração).

## Verificação (v1.1)
- `make verify` (aceite M3) exit 0 — caminho feliz intacto após a migração de topologia.
- `make verify-dlq` exit 0 — main/retry zeram, `orders_queue.dlq` recebe o pedido (com `x-death`), consumer canônico restaurado no fim.
- `make typecheck`, `make build` e `make test` limpos.

## Correções relevantes (v1.1)
- **D-026 emendada**: `x-dead-letter-routing-key` da `orders_queue` = `orders_queue` (rk original preservado), casando com o binding do `dlx`. A redação original (`orders_queue.dlq`) fazia o exchange `direct` **descartar a mensagem em silêncio**.
- Boot do consumer não crasha mais com `406 PRECONDITION_FAILED` por causa de fila pré-existente sem args de DLX: `DlxTopology` recria a fila num canal novo.

---

# v1.0.0 — Rastreamento Distribuído (OpenTelemetry + RabbitMQ + NestJS)

## Incluído
- Producer NestJS (HTTP `:3001`) com `POST|GET /orders` e `GET /health`, publishes em `orders_queue` com `traceparent` W3C.
- Consumer NestJS (microservice, sem porta HTTP) com propagação de contexto (`propagation.extract`) e spans de negócio.
- Infra: RabbitMQ 3.12 + OTel Collector (OTLP) + Jaeger via `docker compose` (modo padrão host; perfil `app` opcional para containers).
- Tracing: instrumentação automática (http, amqplib) + spans manuais (`createOrder`, `handleOrderCreated`), atributos pesquisáveis no Jaeger e status de erro com `recordException`.
- Injeção de falha `SIMULATE_FAILURE_RATE` para o cenário de erro sem derrubar o processo.
- Verificação automatizada: `make verify` comprova trace único atravessando os 2 serviços; `make test` com 5 testes unitários do helper de contexto.
- Documentação: README raiz + 2 READMEs de serviço + `.env.example` + release notes.

## Verificação (aceite principal)
- `make verify` → exit 0: trace único (`producer-service` + `consumer-service`) com spans `createOrder`, `handleOrderCreated` e `amqplib` — validado em modo host e em modo container (`docker compose --profile app up`).
- QG: `make typecheck`, `make build`, `make test` (5/5) e `npm ci` limpos; clone limpo (`git clone` → `make install` → `make typecheck`/`make build` → `make verify`) reproduz o aceite.
- Cenários PRD §8: A (sucesso), B (erro), C (telemetria indisponível), D (fan-out), E (payload inválido → 400) e F (graceful shutdown) executados com evidência.

## Limitações conhecidas
- Sem persistência (store in-memory), sem métricas/logs exporters, sem auth, sem CI/CD; DLQ/idempotência são in-memory/single-instance (durabilidade multi-instância → backlog RFC §12.2).
- ~~IDs de pedido não são collision-safe sob alta concorrência (D-016).~~ → resolvido em **v1.4** (WP-16/D-038: `ORD-<epoch_ms>-<rand4>`).
- Consulta ao Jaeger no `make verify` assume API estável e tolera eventual coalescing de spans.
- Ver `docs/RFC.md` §12.2 (backlog) e `docs/RELEASE_PLAN.md` §9 (dívida técnica).