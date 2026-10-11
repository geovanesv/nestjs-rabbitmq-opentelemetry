# RFC — Rastreamento Distribuído de Mensagens RabbitMQ com OpenTelemetry (NestJS)

| Campo | Valor |
|---|---|
| **ID** | RFC-001 |
| **Título** | OpenTelemetry + RabbitMQ + NestJS — rastreamento distribuído ponta a ponta |
| **Status** | Aprovado para implementação |
| **Versão** | 1.0.0 |
| **Data** | 2026-09-25 |
| **Autoria** | Geovane Araujo (especificação executada por agentes de implementação) |
| **Fontes** | `MATERIAL.md.pdf` (v1.0.0, Março/2026) e `OpenTelemetry + RabbitMQ + NestJS_ Rastreamento Distribuído.md` |
| **Documentos relacionados** | [`PRD.md`](./PRD.md) (o quê e como validar) · [`RELEASE_PLAN.md`](./RELEASE_PLAN.md) (quando e como) |

> **Como usar este documento**
> Este é o contrato técnico. Um agente só deve criar código que respeite os **contratos (§4–§7)** e as **decisões (§3)**.
> Requisitos funcionais e critérios de aceitação estão no `PRD.md`; sequência de execução, Ownership de arquivos e validação estão no `RELEASE_PLAN.md`.
> Em caso de conflito: **RFC (contrato técnico) > PRD (escopo) > RELEASE_PLAN (ordem)**. Se um requisito do `MATERIAL.md.pdf` conflitar com esta RFC, prevalece a RFC — toda divergência já está registrada em §3 com justificativa.

---

## 1. Contexto e Problema

Em arquitetura de microsserviços, uma única requisição do usuário atravessa serviços, filas e bancos de dados. Sem instrumentação, não é possível responder:

- Onde uma mensagem está sendo processada agora?
- Quanto tempo ela leva entre ser publicada e ser consumida?
- Houve erro em algum ponto da jornada? Em qual serviço?
- Qual o contexto de execução em cada etapa?

O projeto entrega **dois microsserviços NestJS** (produtor e consumidor) comunicados por **RabbitMQ**, totalmente instrumentados com **OpenTelemetry**, com traces visualizados no **Jaeger** através do **OpenTelemetry Collector**.

### 1.1 Objetivo do RFC

Especificar de forma inequívoca a arquitetura, os contratos de código, as decisões de design e os riscos, para que a implementação seja **mecânica** (sem decisões ad-hoc durante a execução).

### 1.2 Não-objetivos (fora do escopo da v1)

- Persistência de pedidos em banco de dados.
- Dead Letter Queue (DLQ), retries exponenciais e idempotência.
- Exporter de métricas e de logs (apenas **traces** nesta v1).
- Autenticação/autorização nos endpoints HTTP.
- Deploy em produção / CI-CD / Kubernetes.
- UI própria; a visualização é o Jaeger.
- Baggage, sampling customizado e SLOs como produto (documentados como exemplos/extension points, não implementados).

---

## 2. Restrições e Premissas

| # | Restrição | Impacto no design |
|---|---|---|
| C-01 | Node.js disponível localmente | `engines.node >= 18.0.0` (ver D-011) |
| C-02 | Docker + Docker Compose disponíveis | Infra inteira sobe com `docker compose` |
| C-03 | Serviços rodam **na máquina do host**, infra em containers | Hosts usados nas URLs são `localhost` |
| C-04 | Rastreamento **não pode** afetar a disponibilidade do negócio | Falha de export é silenciosa (ver D-020) |
| C-05 | Documentação e didacticidade são objetivo secundário explícito | Código comentado em português, nomes autoexplicativos, 3 cenários demonstráveis |
| C-06 | Sem segredos versionados | Tudo por variável de ambiente, com `.env.example` commitado |

**Premissas verificadas antes da implementação:** portas 3001, 5672, 15672, 4317, 4318, 16686 livres; `node`, `npm` e `docker` disponíveis.

---

## 3. Decisões de Design (ADR Log)

Formato: **Contexto → Decisão → Justificativa → Consequências**. Toda decisão listada aqui é **obrigatória**; mudar uma delas exige novo ADR em `RFC.md §3`.

| ID | Decisão | Justificativa / Consequência |
|---|---|---|
| **D-001** | Dois serviços NestJS **independentes** (`producer/`, `consumer/`), com `package.json` e `tsconfig.json` próprios. Sem monorepo, sem workspaces, sem banco compartilhado. | Reproduz fielmente o material e o isolamento de microsserviços. Consequência: duplicação de `tracing.ts` e `rabbitmq.config.ts` entre os serviços é **intencional**. |
| **D-002** | `producer` = aplicação **HTTP** (NestFactory) que publica em `orders_queue`. `consumer` = **microservice puro** (`createMicroservice` + `Transport.RMQ`), **sem porta HTTP**. | Consumer não expõe API: sua superfície é a fila. Health check do consumer é feito por log + status do processo/container. |
| **D-003** | Versões **fixadas** (install com `-E` / lockfile commitado): NestJS `10.3.0`, `@opentelemetry/sdk-node` `0.50.0`, `@opentelemetry/api` `1.9.0` (faixa 1.x), TypeScript `5.3.3`, RabbitMQ `3.12`, `@opentelemetry/auto-instrumentations-node`, `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/resources`, `@opentelemetry/semantic-conventions` todos em `0.50.x`/`1.x` compatíveis. | **O `@opentelemetry/api` 2.x é incompatível com o SDK 0.50.x** (que exige api `^1.9.0`) e quebra em runtime. Fixar `api@1.9.0` é obrigatório. Consequência: `npm ci` usa o lockfile; nunca `npm install api@latest`. |
| **D-004** | `import './tracing'` é a **primeira linha** de `main.ts` em ambos os serviços, e `tracing.ts` chama `sdk.start()` no import (síncrono em 0.50.x). | A instrumentação de `amqplib` usa *module hooks* (`require-in-the-middle`): o módulo precisa ser **carregado depois** do `sdk.start()`. Como `@nestjs/microservices` importa `amqplib` no load, o tracing precisa vir antes de qualquer outro import. Consequência: proibido comentário/import antes; testado em WP-06. |
| **D-005** | Instrumentação automática de `amqplib` habilitada **uma única vez**, via `getNodeAutoInstrumentations({ '@opentelemetry/instrumentation-amqplib': { enabled: true } })`. **Não** adicionar `new AmqplibInstrumentation()` em paralelo. | O material mostra as duas juntas, o que **duplica spans** de envio/recebimento. Uma única fonte de instrumentação. |
| **D-006** | Producer: propagação **automática** (o patch de `amqplib` injeta `traceparent`/`tracestate` em `properties.headers` no `sendToQueue`). | Atende a didacticidade do material ("não precisa modificar o código do RabbitMQ"). |
| **D-007** | Consumer: extração de contexto **explícita e manual** no handler — `propagation.extract(ROOT_CONTEXT, headers)` + `context.with(ctx, () => ...)`, lendo os headers de `RmqContext.getMessage()`. | Garante a continuidade do `trace_id` independentemente de o *span* automático de consumo estar ou não no contexto ativo no momento do handler. É a causa nº 1 do item 9.3 do material ("spans não vinculados"). Consequência: o span do handler é **irmão** do span de consumo do `amqplib`, ambos filhos do mesmo pai remoto — aceitável e esperado (ver §7.4). |
| **D-008** | Cadeia de saída: app → **OTel Collector** (receivers OTLP 4317/4318; processors `memory_limiter` + `batch`) → **Jaeger all-in-one** (OTLP 4317 interno). | O Collector desacopla aplic ↔ backend, dá batching/retry e ponto único de troca de backend (Datadog, Tempo, etc.). Health do Collector em `13133`. |
| **D-009** | Fila `orders_queue`, `durable: true`, `prefetchCount: 1`, sem exchange customizado (usa a default exchange, como o `Transport.RMQ` do Nest). | Alinhado ao material. Sem DLQ na v1 (não-objetivo). |
| **D-010** | Endpoint OTLP resolvido com a precedência: `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` → `OTEL_EXPORTER_OTLP_ENDPOINT` + `/v1/traces` → default `http://localhost:4318/v1/traces`. Normalizar barra final duplicada. | `OTEL_EXPORTER_OTLP_ENDPOINT` já apontando para `.../v1/traces` (como o material sugere no troubleshooting) causaria `/v1/traces/v1/traces` e perda silenciosa de traces. |
| **D-011** | Node alvo `>= 18.0.0` (o material diz 16+). Scripts padrão do Nest CLI: `dev` = `nest start --watch`, `build` = `nest build`, `start` = `node dist/main`, `typecheck` = `tsc --noEmit`, `clean` = `rimraf dist`. | Desvio justificado: (a) OTel 0.50 + tooling atual pedem 18+; (b) `nest start --watch` evita fragilidade de *module hooks* com `ts-node` transpilando TS em runtime. Registrado como desvio do material §6.3. |
| **D-012** | Identidade do serviço: `OTEL_SERVICE_NAME` (override) → default `producer-service` / `consumer-service`; sempre enviar `SERVICE_VERSION` (`1.0.0`) e `DEPLOYMENT_ENVIRONMENT` (`development`). | Os nomes exatos `producer-service`/`consumer-service` são usados no material e no critério de busca do Jaeger. |
| **D-013** | Sampling: `ParentBased(AlwaysOn)` em dev (100% das traces). Habilitar `OTEL_TRACES_SAMPLER=ratio_based` + `OTEL_TRACES_SAMPLER_ARG=0.1` para produção, sem mudança de código. | 100% em dev é requisito didático; produção precisa de sampling (material §8.2). |
| **D-014** | Store in-memory no producer: `Map<string, Order>` com capacidade máxima de **100** pedidos (evicção FIFO). `GET /orders`, `GET /orders/:id`. | Permite validar o fluxo ponta a ponta sem banco. `durable: true` na fila é a única persistência na v1. |
| **D-015** | Validação de entrada com `class-validator` + `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` e DTO `CreateOrderDto`. | O material usa `Omit<Order,...>` direto no `@Body`, o que **não valida em runtime**. DTO é o padrão NestJS e evita payloads inválidos que poluem os traces. |
| **D-016** | Identificador do pedido: `ORD-${Date.now()}` (formato do material, ex.: `ORD-1710073800000`). Colisão sob alta concorrência é item de backlog (§12), **não** da v1. | Fidelidade ao exemplo de resposta documentado no material. |
| **D-017** | Shutdown gracioso com **um único** handler de sinais: `process.once('SIGTERM'|'SIGINT')` → `app.close()` → `await shutdownTracing()` (flush do `BatchSpanProcessor`) → `process.exit(0)`. **Não** usar `app.enableShutdownHooks()` simultaneamente. | Garante flush dos spans pendentes e evita handler duplo/conflitante. |
| **D-018** | Spans manuais gravam **atributos no span** (`order.id`, `order.customer_id`, `order.amount`, `messaging.*`) **além** dos eventos. | O material só usa `span.addEvent(...)`. Atributos no span são **pesquisáveis** no Jaeger (tag search) e inspecionáveis via API; eventos não são. Sem isso, a verificação automatizada (WP-06) não conseguirou correlacionar pedido↔trace. |
| **D-019** | Tratamento de erro: `span.recordException(error)` + `span.setStatus({ code: SpanStatusCode.ERROR })` + log estruturado. Falha de processamento **não** faz `nack`/requeue (ack implícito) para evitar loop infinito de reprocessamento. | Sem DLQ na v1, requeue geraria loop de erro infinito. Backlog §12. |
| **D-020** | Falha de telemetry **nunca** derruba o app: erros do exportador/collector são logados pelo próprio SDK e engolidos; nenhuma chamada de tracing está no caminho crítico de negócio sem `try/catch`. | Requisito C-04. Verificação: derrubar o Collector e o fluxo de pedidos deve continuar funcionando. |
| **D-021** | Variável `SIMULATE_FAILURE_RATE` (0–1, default `0`) no consumer: taxa de falha injetada no processamento para demonstrar `recordException` + status ERROR no Jaeger. | Precisa de um caminho de erro **demonstrável** para validar FR/AC de tratamento de erro. |
| **D-022** | Repo expõe **Makefile** na raiz como entrada única de comandos de operação (`make infra-up`, `make dev-producer`, `make verify`, etc.), sem dependência de `jq` ou `package.json` na raiz. | DX consistente; o script de verificação será Node puro (`node scripts/verify-trace.mjs`, `fetch` global do Node 18+). |
| **D-023** | Layout de arquivos é **canônico e fechado** (§5.3). Não criar arquivos fora dessa lista sem atualizar este RFC. | Permite Ownership sem conflito (§RELEASE_PLAN) e review focado. |
| **D-024** | O `otel-collector-config.yml` declara a extensão `health_check` em `0.0.0.0:13133` e a habilita em `service.extensions`. | Correção de omissão do contrato §6.2: §6.1 publica a porta `13133` e FR-001/D-8 exigem `curl :13133` → 200, mas o YAML canônico de §6.2 não configurava nenhuma extensão de health (porta subia sem listener → HTTP 000). Adicionado em WP-02 para tornar o contrato self-consistente. |
| **D-025** | O `pattern` do evento (`order.created`) viaja no **payload** JSON `{ pattern, data }` da mensagem AMQP (serializer padrão do `ClientRMQ`/`ServerRMQ` do NestJS 10.3), e **não** no header `pattern` do AMQP. O roteamento ao `@EventPattern` usa esse campo do payload. | Esclarecimento observado em WP-05/WP-08: o contrato §7.2 afirmava que o `pattern` viajasse no header. Na prática o transport RMQ do Nest injeta o header `traceparent` (via amqplib) e serializa `{pattern, data}` no corpo. O efeito contratual é idêntico (roteamento + rastreabilidade); W3C `traceparent` continua no header, conforme FR-008. |

### 3.1 Desvios registrados em relação ao `MATERIAL.md`

| Item do material | Desvio | Motivo / decisão |
|---|---|---|
| `getNodeAutoInstrumentations` importado de `@opentelemetry/auto-instrumentation` | Pacote correto: **`@opentelemetry/auto-instrumentations-node`** | Nome de pacote errado no material quebraria o build |
| `getNodeAutoInstrumentations(...)` **+** `new AmqplibInstrumentation()` | Apenas auto-instrumentations | D-005 (spans duplicados) |
| Node 16+ | Node 18+ | D-011 |
| `npm run dev` com `ts-node` | `nest start --watch` | D-011 |
| `ProbabilitySampler` de `@opentelemetry/sdk-trace-node` | Em 0.50.x vem de `@opentelemetry/sdk-trace-base`; e não é necessário na v1 (D-013) | Correção de API |
| `SemanticResourceAttributes` | Mantido (válido em `semantic-conventions` 1.x, apenas *deprecated*) | Compatibilidade com SDK 0.50.x; canônico novo é `ATTR_SERVICE_NAME` |
| `span.addEvent(...)` apenas | Atributos no span + eventos | D-018 |
| Consumer apenas com `tracer.startSpan` | `context.with(propagation.extract(...))` | D-007 |
| Sem `docker-compose.yml` / collector config fornecidos | Definidos em §6 e §7 | Material referencia mas não detalha |

---

## 4. Arquitetura

### 4.1 Diagrama de componentes

```
┌────────────────────────────────────────────────────────────────────┐
│ HOST (desenvolvimento)                                            │
│                                                                    │
│  ┌──────────────────────┐        ┌──────────────────────────────┐   │
│  │ producer-service     │        │ consumer-service             │   │
│  │ NestJS HTTP :3001    │        │ NestJS microservice (no HTTP)│   │
│  │                      │        │                              │   │
│  │ main.ts              │        │ main.ts                      │   │
│  │  └ import './tracing'│        │  └ import './tracing'        │   │
│  │ tracing.ts (SDK)     │        │ tracing.ts (SDK)             │   │
│  │ OrderController ─┐   │        │ OrderConsumer               │   │
│  │ OrderService   ─┴─► │        │  └ @EventPattern            │   │
│  │   manual spans   │   │        │     'order.created'         │   │
│  │ ClientProxy emit │   │        │  └ propagation.extract(...) │   │
│  └─────────┬──────────┘        └──────────▲───────────────┬─────┘   │
│            │ amqp://guest:guest@localhost:5672  │               │    │
└────────────┼───────────────────────────────────┼───────────────┼────┘
             │                                   │               │ OTLP/HTTP
             ▼                                   │               │ 4318/v1/traces
┌────────────────────────────┐                  │               ▼
│ DOCKER                     │                  │   ┌──────────────────────────┐
│ ┌────────────────────────┐ │  consume         │   │ otel-collector-contrib   │  │
│ │ rabbitmq:3.12          │ │  ack             │   │ receivers: otlp(4317/18) │  │
│ │ 5672 / 15672 (mgmt)    │◄┘                  └───┤ processors: memory_limit,│  │
│ │ queue: orders_queue    │                      │ │             batch       │  │
│ │ durable=true           │                      │ │ exporter: otlp -> jaeger │  │
│ └────────────────────────┘                      │ └────────────┬─────────────┘  │
│ ┌────────────────────────┐                      │              │ OTLP/gRPC 4317│
│ │ jaegertracing/         │◄─────────────────────────────────────┘              │
│ │   all-in-one :16686    │                     ▲                               │
│ │  (UI + storage)        │─────────────────────┘                               │
│ └────────────────────────┘                                                    │
└────────────────────────────────────────────────────────────────────┘
```

### 4.2 Fluxo de um pedido (sequência)

1. `POST /orders` chega no `producer-service` (HTTP).
2. OTel: instrumentação HTTP cria o span servidor `POST /orders` (auto).
3. `ValidationPipe` valida o corpo contra `CreateOrderDto`; inválido → `400` sem span de negócio.
4. `OrderService.createOrder()` cria o span manual `createOrder`.
5. `span.setAttributes({...order.id, order.amount, ...})` + `span.addEvent('order_created')`.
6. `client.emit('order.created', order)` → Nest publica na `orders_queue` (fire-and-forget).
7. OTel (auto, D-006) injeta `traceparent`/`tracestate` em `properties.headers`.
8. `BatchSpanProcessor` exporta os spans do producer via OTLP/HTTP → Collector → Jaeger.
9. RabbitMQ entrega a mensagem ao `consumer-service` (prefetch 1).
10. OTel (auto) cria span de consumo e extrai o contexto.
11. `OrderConsumer.handleOrderCreated()`: `propagation.extract()` + `context.with()` (D-007).
12. Span manual `handleOrderCreated` com eventos `order_received` / `order_processed`.
13. `ack` implícito; `sdk.shutdown()` no `SIGINT/SIGTERM` faz flush dos spans pendentes.

### 4.3 Componentes e versões

| Componente | Versão | Papel |
|---|---|---|
| NestJS (`@nestjs/core`, `common`, `microservices`, `platform-express`) | `10.3.0` | Framework dos dois serviços |
| `@nestjs/cli` (devDep) | `10.x` | `nest build` / `nest start --watch` |
| `class-validator` / `class-transformer` | `0.14.x` / `0.5.x` | Validação do payload |
| RabbitMQ | `rabbitmq:3.12-management` | Broker; UI em `:15672` (guest/guest) |
| OpenTelemetry JS SDK | `@opentelemetry/sdk-node@0.50.0` | Coleta e export de spans |
| OpenTelemetry API | `@opentelemetry/api@1.9.0` (**fixado**) | API de traces (D-003) |
| Auto-instrumentations | `@opentelemetry/auto-instrumentations-node@0.4x.x` | HTTP + amqplib + … (D-005) |
| Exporter | `@opentelemetry/exporter-trace-otlp-http@0.50.0` | OTLP/HTTP 4318 |
| Collector | `otel/opentelemetry-collector-contrib:0.97.0` | Agregação/batch |
| Jaeger | `jaegertracing/all-in-one` (`latest`, pin após validação) | UI + storage |
| TypeScript | `5.3.3` | Linguagem (`strict: true`) |
| Node.js | `>= 18.0.0` | Runtime |

Dependências OTel do SDK 0.50.0: `api`, `resources`, `sdk-trace-base`, `sdk-trace-node`, `semantic-conventions`, `core`, `exporter-trace-otlp-http` — todas com versões compatíveis resolvidas pelo lockfile; **não** fixar `api` em 2.x.

---

## 5. Estrutura do Projeto

### 5.1 Layout

```
project01/
├── PRD.md
├── RFC.md
├── RELEASE_PLAN.md
├── README.md                      # atualizado (WP-07)
├── Makefile                       # comandos operacionais (D-022)
├── .gitignore
├── .editorconfig
├── docker/
│   ├── docker-compose.yml
│   └── otel-collector-config.yml
├── scripts/
│   └── verify-trace.mjs           # verificação E2E do trace (sem deps)
├── producer/
│   ├── .env.example
│   ├── README.md
│   ├── package.json
│   ├── package-lock.json          # commitado (D-003)
│   ├── nest-cli.json
│   ├── tsconfig.json
│   ├── tsconfig.build.json
│   └── src/
│       ├── main.ts
│       ├── tracing.ts
│       ├── shutdown.ts
│       ├── app.module.ts
│       ├── config.ts
│       ├── rabbitmq.config.ts
│       ├── health.controller.ts
│       ├── order.controller.ts
│       ├── order.service.ts
│       ├── order.dto.ts
│       └── order.interface.ts
└── consumer/
    ├── .env.example
    ├── README.md
    ├── package.json
    ├── package-lock.json          # commitado (D-003)
    ├── nest-cli.json
    ├── tsconfig.json
    ├── tsconfig.build.json
    ├── test/
    │   └── trace-context.spec.ts  # unitário do helper de extração (Should)
    └── src/
        ├── main.ts
        ├── tracing.ts
        ├── shutdown.ts
        ├── app.module.ts
        ├── config.ts
        ├── rabbitmq.config.ts
        ├── order.consumer.ts
        ├── order.interface.ts
        └── tracing/
            └── extract-trace-context.ts
```

### 5.2 Configuração de ambiente

Variáveis (todas opcionais, com default de dev) — **nenhum segredo no código**:

| Variável | Serviço | Default | Uso |
|---|---|---|---|
| `PORT` | producer | `3001` | Porta HTTP |
| `RABBITMQ_URL` | ambos | `amqp://guest:guest@localhost:5672` | Conexão AMQP |
| `ORDER_QUEUE` | ambos | `orders_queue` | Nome da fila |
| `OTEL_SERVICE_NAME` | ambos | `producer-service` / `consumer-service` | Override de `service.name` |
| `SERVICE_VERSION` | ambos | `1.0.0` | `service.version` |
| `NODE_ENV` | ambos | `development` | `deployment.environment` |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | ambos | — | Prioridade 1 (D-010) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | ambos | — | Prioridade 2 (sem `/v1/traces`) |
| `OTEL_TRACES_SAMPLER` | ambos | `always_on` | Sampling |
| `OTEL_TRACES_SAMPLER_ARG` | ambos | — | Ex.: `0.1` com `ratio_based` |
| `SIMULATE_FAILURE_RATE` | consumer | `0` | Injeção de erro (D-021) |
| `LOG_LEVEL` | ambos | `log` | `log` \| `debug` \| `error` |
| `OTEL_LOG_LEVEL` | ambos | `info` | Log do próprio SDK |

### 5.3 Inventário canônico de arquivos (D-023)

| # | Arquivo | Responsabilidade | Criado em (WP) |
|---|---|---|---|
| F-01 | `Makefile` | Alvo de comandos operacionais | WP-01 |
| F-02 | `.gitignore` | Ignora `node_modules/`, `dist/`, `.env`, `*.log` | WP-01 |
| F-03 | `.editorconfig` | `2 spaces`, LF, UTF-8 | WP-01 |
| F-04 | `docker/docker-compose.yml` | rabbitmq, jaeger, otel-collector, volume | WP-02 |
| F-05 | `docker/otel-collector-config.yml` | Receivers/processors/exporters de traces | WP-02 |
| F-06 | `producer/package.json` | Deps (D-003) e scripts (D-011) | WP-03 |
| F-07 | `producer/tsconfig.json` / `tsconfig.build.json` / `nest-cli.json` | TS `strict` | WP-03 |
| F-08 | `producer/src/tracing.ts` | SDK Node, resource, exporter, instrumentations, `shutdownTracing()` | WP-03 |
| F-09 | `producer/src/config.ts` | Leitura tipada de env com defaults | WP-03 |
| F-10 | `producer/src/rabbitmq.config.ts` | `ClientOptions` RMQ | WP-03 |
| F-11 | `producer/src/main.ts` | Bootstrap HTTP, pipes, shutdown | WP-04 |
| F-12 | `producer/src/app.module.ts` | Módulo raiz | WP-04 |
| F-13 | `producer/src/shutdown.ts` | Handler único de SIGTERM/SIGINT (D-017) | WP-04 |
| F-14 | `producer/src/order.interface.ts` | `Order` (contrato compartilhado) | WP-04 |
| F-15 | `producer/src/order.dto.ts` | `CreateOrderDto` com decorators | WP-05 |
| F-16 | `producer/src/order.service.ts` | Criação/store/listagem + spans manuais | WP-05 |
| F-17 | `producer/src/order.controller.ts` | `POST /orders`, `GET /orders`, `GET /orders/:id` | WP-05 |
| F-18 | `producer/src/health.controller.ts` | `GET /health` | WP-05 |
| F-19 | `consumer/package.json` | Deps e scripts | WP-06 |
| F-20 | `consumer/tsconfig.json` / `tsconfig.build.json` / `nest-cli.json` | TS `strict` | WP-06 |
| F-21 | `consumer/src/tracing.ts` | Idem F-08, `service.name=consumer-service` | WP-06 |
| F-22 | `consumer/src/config.ts` | Env tipado (inclui `SIMULATE_FAILURE_RATE`) | WP-06 |
| F-23 | `consumer/src/rabbitmq.config.ts` | `ClientOptions` RMQ | WP-06 |
| F-24 | `consumer/src/main.ts` | Bootstrap de microservice | WP-07 |
| F-25 | `consumer/src/app.module.ts` | Módulo raiz | WP-07 |
| F-26 | `consumer/src/shutdown.ts` | Handler único de sinais | WP-07 |
| F-27 | `consumer/src/order.interface.ts` | `Order` | WP-07 |
| F-28 | `consumer/src/order.consumer.ts` | `@EventPattern` + extração de contexto + spans | WP-08 |
| F-29 | `consumer/src/tracing/extract-trace-context.ts` | Helper puro de extração de headers | WP-08 |
| F-30 | `scripts/verify-trace.mjs` | Verificação E2E (POST + Jaeger API) | WP-09 |
| F-31 | `producer/.env.example` | Documenta envs do producer | WP-10 |
| F-32 | `consumer/.env.example` | Documenta envs do consumer | WP-10 |
| F-33 | `producer/README.md` | Runbook do producer | WP-10 |
| F-34 | `consumer/README.md` | Runbook do consumer | WP-10 |
| F-35 | `README.md` | Raiz: quickstart, arquitetura, troubleshooting | WP-10 |
| F-36 | `consumer/test/trace-context.spec.ts` | Teste unitário do helper (Should) | WP-11 |
| F-37 | `producer/.npmrc` | `legacy-peer-deps=true` — permite `api@1.9.0` com o SDK 0.50.x (D-003) | WP-03 |
| F-38 | `consumer/.npmrc` | Idem F-37 para o consumer | WP-06 |

---

## 6. Contrato de Infraestrutura (F-04, F-05)

### 6.1 `docker/docker-compose.yml` (contrato)

- `version:` **omitido** (obsoleto no Compose v2).
- Serviço `rabbitmq`: `rabbitmq:3.12-management`; portas `5672:5672` e `15672:15672`; volume nomeado `rabbitmq_data:/var/lib/rabbitmq`; `healthcheck` com `rabbitmq-diagnostics -q ping`; `restart: unless-stopped`.
- Serviço `jaeger`: `jaegertracing/all-in-one`; porta `16686:16686`; env `COLLECTOR_OTLP_ENABLED=true`; `restart: unless-stopped`. Portas 4317/4318 **não** publicadas (uso interno do Collector).
- Serviço `otel-collector`: `otel/opentelemetry-collector-contrib:0.97.0`; `command: ["--config=/etc/otel/config.yml"]`; mount **read-only** de `./otel-collector-config.yml`; portas `4317:4317`, `4318:4318`, `13133:13133`; `depends_on: [jaeger]`.
- **Sem** `healthcheck` no Collector: a imagem não traz `curl`/`wget`. A validação é externa (`curl http://localhost:13133`, em WP-02).
- Sem containerização das aplicações (não-objetivo; ver §12).

### 6.2 `docker/otel-collector-config.yml` (contrato)

```yaml
receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318
      grpc:
        endpoint: 0.0.0.0:4317

processors:
  memory_limiter:
    check_interval: 1s
    limit_mib: 256
  batch:
    timeout: 5s
    send_batch_size: 1024

exporters:
  otlp/jaeger:
    endpoint: jaeger:4317
    tls:
      insecure: true

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlp/jaeger]
  telemetry:
    logs:
      level: info
```

> Pipeline **apenas de traces** (D-001 do PRD / não-objetivo de métricas e logs). O endpoint HTTP `4318` aceita `POST /v1/traces` — é esse o destino dos apps.

---

## 7. Contratos de Código

### 7.1 `tracing.ts` (F-08 / F-21) — arquivo crítico

Requisitos obrigatórios:

1. Sem `await` (SDK 0.50.x inicia sincronamente).
2. `Resource` com `SERVICE_NAME` (via `process.env.OTEL_SERVICE_NAME` com default por serviço), `SERVICE_VERSION`, `DEPLOYMENT_ENVIRONMENT`.
3. `OTLPTraceExporter` com URL resolvida pela precedência de D-010 (normalizando `//` e evitando `/v1/traces/v1/traces`).
4. `getNodeAutoInstrumentations` com `@opentelemetry/instrumentation-amqplib` habilitado **e** `@opentelemetry/instrumentation-fs` desabilitado (ruído); `@opentelemetry/instrumentation-http` habilitado.
5. **Exporta** `shutdownTracing(): Promise<void>` — faz `await sdk.shutdown()` e loga erro sem-launchar.
6. **Não** registra handlers de sinal aqui (responsabilidade de `shutdown.ts`, D-017).

Esqueleto canônico (idêntico nos dois serviços, exceto defaults de `SERVICE_NAME`):

```ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

const DEFAULT_TRACES_ENDPOINT = 'http://localhost:4318/v1/traces';

function resolveTracesEndpoint(): string {
  const explicit = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  if (explicit) return explicit;
  const base = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (base) return `${base.replace(/\/+$/, '')}/v1/traces`;
  return DEFAULT_TRACES_ENDPOINT;
}

const traceExporter = new OTLPTraceExporter({ url: resolveTracesEndpoint() });

export const sdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'producer-service',
    [SemanticResourceAttributes.SERVICE_VERSION]: process.env.SERVICE_VERSION || '1.0.0',
    [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'development',
  }),
  traceExporter,
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-amqplib': { enabled: true },
      '@opentelemetry/instrumentation-fs': { enabled: false },
      '@opentelemetry/instrumentation-http': { enabled: true },
    }),
  ],
});

sdk.start();

export async function shutdownTracing(): Promise<void> {
  try {
    await sdk.shutdown();
  } catch (error) {
    console.error('Falha ao encerrar tracing', error);
  }
}
```

> `main.ts` importa `./tracing` **antes** de qualquer outro import local (D-004).

### 7.2 Contrato de mensagens

```ts
interface Order {
  id: string;          // 'ORD-<epoch_ms>'
  customerId: string;  // 'CUST-001'
  amount: number;      // 100.5 (2 casas; validado)
  items: string[];     // >= 1 item
  timestamp: string;   // ISO-8601 UTC
}

interface CreateOrderDto {
  @IsString() @IsNotEmpty() @Matches(/^CUST-[A-Za-z0-9-]+$/) customerId: string;
  @IsNumber() @Min(0.01) @Max(1_000_000) @Type(() => Number) amount: number;
  @IsArray() @ArrayMinSize(1) @IsString({ each: true }) items: string[];
}
```

- **Payload/evento**: `pattern = 'order.created'`, `data = Order` (o `pattern` viaja no header `pattern` do AMQP; o `Nest RMQ server` usa esse header para rotear ao `@EventPattern`).
- **Headers de rastreamento**: `traceparent` (W3C Trace Context: `00-<32 hex trace-id>-<16 hex span-id>-<flags>`) e `tracestate` (opcional), injetados em `properties.headers`.
- **Timestamp**: string ISO-8601 no payload (JSON-safe); o tipo `Date` do material vira `string` no transporte (§12 item de backlog: preservar `Date` exigiria interceptor customizado).

### 7.3 Contrato de spans (observabilidade)

| Serviço | Span (auto) | Span (manual) | Eventos | Atributos |
|---|---|---|---|---|
| producer | `POST /orders` (HTTP server) | `createOrder` | `order_created`, `order_sent_to_queue` | `order.id`, `order.customer_id`, `order.amount`, `messaging.system=rabbitmq`, `messaging.destination.name=orders_queue` |
| producer | `amqplib send` (publish) | — | — | (gerados pela instrumentação) |
| consumer | `amqplib receive` (consume) | `handleOrderCreated` | `order_received`, `order_processed` | `order.id`, `order.customer_id`, `order.amount`, `messaging.system=rabbitmq`, `messaging.operation.type=process` |

Regras:

- Nome de span manual = nome da operação (`createOrder`, `handleOrderCreated`). **Proibido** nomes genéricos (`process`, `handler`, `run`) — material §10.1.
- Sempre `span.end()` em `finally`.
- Erro: `recordException` + `setStatus({ code: SpanStatusCode.ERROR })` (D-019).
- **Sem PII**: apenas identificadores, valores de negócio e atributos `messaging.*`; nunca corpo completo da mensagem, tokens ou e-mails.
- Busca no Jaeger: `service=producer-service` e `service=consumer-service`, tag `order.id=<id>`.

### 7.4 Forma esperada do trace (2 formas aceitas)

**Forma A (alvo, D-007):** `handleOrderCreated` é filho direto do pai remoto (span do `amqplib publish` do producer):

```
POST /orders (producer)
└── createOrder (producer)
    └── amqplib send (producer)
        ├── amqplib receive (consumer)      ← auto-instrumentação
        └── handleOrderCreated (consumer)   ← extração manual
```

**Forma B (aceita, mas sinal de que a extração manual falhou):** `handleOrderCreated` aparece como **raiz** de um trace diferente do producer, ou com `trace_id` diferente.

→ Critério objetivo de aprovação: **um único `trace_id` cobrindo `producer-service` e `consumer-service`** (WP-09).

### 7.5 Contrato da API HTTP (producer)

| Método | Rota | Request | Resposta | Erros |
|---|---|---|---|---|
| `POST` | `/orders` | `CreateOrderDto` | `201` + `Order` | `400` (validação), `500` (falha de publish) |
| `GET` | `/orders` | — | `200` + `Order[]` (mais recente primeiro, máx. 100) | — |
| `GET` | `/orders/:id` | — | `200` + `Order` \| `404` `{ statusCode: 404, message: 'Order ORD-... not found' }` | `404` |
| `GET` | `/health` | — | `200` `{ status: 'ok', service: 'producer-service', version: '1.0.0', uptime: <s> }` | — |

`GET /orders` e `GET /orders/:id` **não** geram span de negócio (apenas o span HTTP automático).

### 7.6 Contrato de extração de contexto no consumer (F-29)

```ts
// extrai headers de multiplas formas possíveis do RmqRecord
export function extractTraceHeaders(source: unknown): Record<string, string>;
```

Regras:

1. Tentar, nesta ordem: `source.headers` → `source.properties?.headers` → `{}`.
2. Só aceitar chaves de **string** (`traceparent`, `tracestate`, `baggage`, `ot-tracer-*`).
3. Se não encontrar `traceparent`, emitir **warning** (Logger `warn`) uma única vez (evitar flood) e retornar `{}` — o processamento **segue normalmente** (D-020).
4. Função **pura e testável** (sem dependência de Nest) → permite o teste unitário F-36.

Uso no consumer:

```ts
const parent = propagation.extract(ROOT_CONTEXT, extractTraceHeaders(ctx.getMessage()));
return context.with(parent, () => this.processWithTracing(order));
```

### 7.7 Contrato de shutdown (F-13 / F-26)

```ts
export function installShutdownHooks(app: INestApplication | INestMicroservice, name: string): void;
```

Comportamento: `process.once('SIGTERM'|'SIGINT')` → log → `await app.close()` (best effort) → `await shutdownTracing()` → `process.exit(0)`. Idempotente (flag `shuttingDown`). `main.ts` **não** chama `app.enableShutdownHooks()`.

### 7.8 Convenções de código

- TypeScript `strict: true`; `noImplicitAny`, `strictNullChecks`; sem `any` sem justificativa.
- Indentação 2 espaços, aspas simples, ponto e vírgula (`.editorconfig`).
- Logs pelo `Logger` do Nest com contexto (nome da classe); `console.log` apenas em bootstrap e erro de tracing.
- Comentários **em português** explicando *por quê* (não *o quê*) — o material é didático.
- Nenhum `process.exit()` fora de shutdown; nenhum `console.log` de payload completo.

---

## 8. Observabilidade e Operação

### 8.1 Painéis esperados (checklist de validação)

| Verificação | Onde | Resultado esperado |
|---|---|---|
| Serviços de infra | `docker compose ps` | 3 containers `Up` |
| Management do broker | http://localhost:15672 | Fila `orders_queue`, mensagens consumidas, `drain mode` não |
| UI do Jaeger | http://localhost:16686 | Serviço `producer-service` listado |
| OTLP HTTP | `curl -X POST http://localhost:4318/v1/traces -d '{}'` | Resposta válida (status HTTP, mesmo se payload inválido) |
| Health do Collector | `curl http://localhost:13133` | HTTP 200 |
| Trace completo | UI do Jaeger | 1 trace com spans de **ambos** os serviços, mesmo `trace_id` |
| Query API do Jaeger | `GET /api/traces?service=consumer-service&lookback=1h&limit=20` | JSON com `traceID` |

### 8.2 Observabilidade do próprio OTel

- `OTEL_LOG_LEVEL=debug` expõe erros do exporter (ex.: `Export failed` quando o Collector está fora).
- Requisição sempre aceita mesmo com Collector fora: **nenhum erro 5xx** por indisponibilidade de telemetria (D-020).

### 8.3 Runbook de incidentes (resumo)

| Sintoma | Causa provável | Ação |
|---|---|---|
| Traces não aparecem | Endpoint errado (D-010) | `echo $OTEL_EXPORTER_OTLP_ENDPOINT`; conferir `/v1/traces` **uma única vez** |
| Traces não aparecem | Collector parado | `docker compose -f docker/docker-compose.yml ps`; `curl :13133`; `docker compose logs otel-collector` |
| Dois `trace_id` | Extração manual sem `traceparent` (D-007) | Inspecionar headers no RabbitMQ UI; validar `extractTraceHeaders` |
| Spans de RabbitMQ duplicados | Instrumentação dupla (D-005) | Remover `new AmqplibInstrumentation()` |
| RabbitMQ não conecta | `RABBITMQ_URL` errada / container unhealthy | `docker compose logs rabbitmq` |
| `Cannot find module '@opentelemetry/...'` | Deps não instaladas | `npm ci` em cada serviço + `npm run build` |

---

## 9. Segurança

- Sem autenticação/autorização (não-objetivo) — rede local de desenvolvimento apenas.
- Credenciais `guest:guest` são **padrão de desenvolvimento** do RabbitMQ, documentadas como tal; valores reais só por env.
- `.env` no `.gitignore`; apenas `.env.example` versionado.
- Não logar corpo completo de mensagens nem credenciais (D-018/D-020).
- Sem uso de dados pessoais reais nos exemplos de payload.
- Exposição de portas limitada a `localhost`/rede de desenvolvimento.

---

## 10. Estratégia de Testes

| Nível | Escopo | Artefato | Prioridade |
|---|---|---|---|
| Typecheck/build | Ambos os serviços | `npm run typecheck`, `npm run build` | **Must** (gate de CI local) |
| Verificação E2E do trace | Producer + infra + consumer | `scripts/verify-trace.mjs` (F-30) | **Must** (critério de aceite do M3) |
| Smoke manual | API | `make smoke` (curl `POST`/`GET /health`/`GET /orders`) | **Must** |
| Unitário | `extractTraceHeaders` | `consumer/test/trace-context.spec.ts` (F-36) | **Should** |
| Resiliência | Collector fora / falha injetada |WP-09 (cenários B e C) | **Should** |

O script E2E (Node puro, `fetch` global) deve:

1. `POST /orders` com payload fixo; exigir `201` e extrair `id`.
2. Consultar `GET /api/traces?service=consumer-service&lookback=2h&limit=50` em polling (2s, timeout 60s).
3. Localizar o trace cujo span tenha atributo `order.id == <id>`; capturar `traceID`.
4. `GET /api/traces/<traceID>` e exigir presença de `producer-service` **e** `consumer-service`.
5. Exibir o resumo (trace id, nº de spans, duração) e `exit 0`; em falha, `exit 1` com diagnóstico acionável (§8.3).

---

## 11. Alternativas Consideradas

| Alternativa | Decisão | Motivo |
|---|---|---|
| Mongo/Postgres para os pedidos | Rejeitada (não-objetivo) | Escopo didático; store in-memory cobre o caso |
| DLQ + retry exponencial | Rejeitada na v1 | Requer idempotência; backlog §12 |
| `@nestjs/event-emitter` em vez de RabbitMQ | Rejeitada | O ponto do projeto é rastreamento **através de broker** |
| Export direto app→Jaeger (sem Collector) | Rejeitada | Collector é o padrão de produção (vendor-neutral, batch, retry) — material §3.2 |
| `asyncLocalStorage` manual em vez de propagador | Rejeitada | `propagation`/`context` é a API canônica e cobre o caso assíncrono da fila |
| Monorepo (Nx/Turbo) | Rejeitada | Não necessário para 2 serviços; aumenta complexidade e ruído |
| Tempo → Loki/Tempo | Backlog | Fora do escopo de traces (não-objetivo) |

---

## 12. Riscos, Backlog e Questões Abertas

### 12.1 Riscos e mitigação

| ID | Risco | Prob. | Impacto | Mitigação (WP) | Sinal de alerta |
|---|---|---|---|---|---|
| R-01 | `api@2.x` incompatível com SDK 0.50.x | Média | Alto | Fixar `1.9.0` + lockfile (WP-03/WP-06); falha de build imediata | Erro de tipos em `tracer`/`context` |
| R-02 | Rastreamento quebrado porque `tracing` não é o 1º import | Média | Alto | D-004 + revisão + verificação em WP-09 | Zero spans de `amqplib` |
| R-03 | Propagação de contexto não chega ao consumer | Alta | Alto | D-007 (extração manual) + E2E obrigatório (WP-09); contingência: consumer via `channel.consume` cru | Dois `trace_id` |
| R-04 | Headers não expostos no `RmqRecord` nesta versão do Nest | Média | Alto | Helper tolerante (§7.6) + contingência idêntica; inspeção dos headers na UI do broker | Warning "headers não encontrados" |
| R-05 | Imagem/versão do Collector muda e invalida o YAML | Média | Médio | Fixar tag `0.97.0`; se falhar, usar `latest` e validar via `docker compose logs` | Erro de config no Collector |
| R-06 | Rastreamento derruba o app quando a infra cai | Baixa | Alto | D-020 (tracing fora do caminho crítico) | 5xx após derrubar containers |
| R-07 | Overhead de latência perceptível | Baixa | Médio | Sampling + `batch` (D-013, §6.2) | >5% p50 (NFR) |
| R-08 | Alta cardinalidade de atributos | Baixa | Médio | Só IDs/valores; sem PII (D-018) | Volume de spans incomum |
| R-09 | Dois agentes editando o mesmo arquivo | Média | Médio | Matriz de ownership por arquivo (RELEASE_PLAN) | Conflito de merge |
| R-10 | `Date` no payload vs string ISO | **Certo** | Baixo | Contrato define string (D-018/§7.2) e documenta | — |

### 12.2 Backlog pós-v1

1. ID de pedido colision-safe (`ORD-<ts>-<rand4>` ou UUID) — quebra o exemplo do material, por isso fora da v1 (D-016).
2. DLQ `orders_queue.dlq` + `x-dead-letter-exchange`, retry com backoff e idempotência.
3. Exporter de métricas (contador `orders_created`, histograma de latência) e de logs (stdout → Loki).
4. Baggage de exemplo (`user.id`, `request.id`) — material §8.3.
5. Bagunça: `SpanProcessor` customizado para renomear spans conforme semconv de messaging.
6. Profile de orquestração: containerizar producer/consumer e usar hosts de rede do Compose em vez de `localhost` (§12.4).
7. `docker-compose` com perfil `observability` (Prometheus/Grafana) para alertas e SLOs (material §11.3).
8. Exemplo de export para backend comercial (Datadog/Tempo) — material §11.4.

### 12.3 Perguntas em aberto (bloqueiam apenas se a resposta mudar o contrato)

1. **Escopo do consumer HTTP:** algum agente deve decidir se o consumer ganha porta HTTP? Padrão: não (D-002).
2. **Tag do Jaeger:** preferir `order.id` como tag estável (D-018). Confirmar: o script E2E depende disso.
3. **Timestamps:** aceitar `Date` no payload (backlog) ou manter string (D-018)? Padrão: string.

### 12.4 Nota sobre execução em Docker (opcional)

Se, em WP-11 opcional, as aplicações forem containerizadas: `RABBITMQ_URL` passa a `amqp://guest:guest@rabbitmq:5672` e `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` a `http://otel-collector:4318/v1/traces`; a UI do Jaeger continua em `localhost:16686` (publicada). Fora do escopo padrão.

---

## Apêndice A — Checklist rápido de conformidade (por arquivo)

Antes de considerar um PR/arquivo pronto, o autor confirma:

- [ ] `tracing.ts` importa **apenas** SDK/exporters; `sdk.start()` no topo; sem handlers de sinal.
- [ ] `main.ts` tem `import './tracing'` como **primeira** linha.
- [ ] Nomes de span descritivos; `span.end()` em `finally` em todo span manual.
- [ ] Erros: `recordException` + `setStatus(ERROR)`; sem `console.log` de payload completo.
- [ ] Env lido de `config.ts` com default; nenhum segredo hard-coded.
- [ ] `tsconfig.json` com `strict: true`; `npm run typecheck` e `npm run build` limpos.
- [ ] Execuções: `make infra-up` → `make dev-producer` → `make dev-consumer` → `make verify` com sucesso.
- [ ] `.env.example` presente e coerente com `config.ts`.
- [ ] README do serviço com: pré-requisitos, env, comandos, exemplo de request/response, troubleshooting.
- [ ] Deviation do material registrada aqui (§3.1) e não "corrigida" em silêncio.

## Apêndice B — Referências

- `MATERIAL.md.pdf` (v1.0.0, Março/2026) — guia técnico de referência do projeto.
- `OpenTelemetry + RabbitMQ + NestJS_ Rastreamento Distribuído.md` — README de referência.
- OpenTelemetry JS — `NodeSDK`, `getNodeAutoInstrumentations`, `AmqplibInstrumentation`, OTLP/HTTP.
- W3C Trace Context — formato `traceparent` (RFC do padrão).
- OTel Semantic Conventions — `service.*`, `messaging.*`.
- NestJS — `Transport.RMQ`, `ClientsModule`, `@EventPattern`, `RmqContext`.
- RabbitMQ 3.12 Management UI, Jaeger UI + API `/api/traces`.

**Fim do RFC-001 v1.0.0 — o próximo passo é o `RELEASE_PLAN.md`.**
