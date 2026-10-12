# PRD — Produto: Rastreamento Distribuído de Mensagens RabbitMQ (OpenTelemetry + NestJS)

| Campo | Valor |
|---|---|
| **ID** | PRD-001 |
| **Versão** | 1.0.0 |
| **Data** | 2026-09-25 |
| **Status** | Aprovado para implementação |
| **Autor** | Geovane Araujo (consumido por agentes de implementação) |
| **Fonte** | `MATERIAL.md.pdf` v1.0.0 + `OpenTelemetry + RabbitMQ + NestJS_ Rastreamento Distribuído.md` |
| **Contrato técnico** | [`RFC.md`](./RFC.md) — prevailecem as decisões de design (RFC §3) |
| **Execução** | [`RELEASE_PLAN.md`](./RELEASE_PLAN.md) — fases, ownership, validação |

> **Como usar este documento**
> Este PRD define **o que** deve existir e **como se prova que está pronto** (critérios de aceitação em Given/When/Then).
> Um requisito só está "pronto" quando: (a) o critério de aceitação é verificável por comando, e (b) o item correspondente da matriz de rastreabilidade (T-01..T-20) está fechado.
> IDs de arquivo (`F-xx`) referenciam o inventário canônico do RFC §5.3. WP (`WP-xx`) referenciam o RELEASE_PLAN.

---

## 1. Visão do Produto

> **Como anexo um pedido a um par de microsserviços NestJS que conversam por RabbitMQ e enxergar a jornada completa dessa mensagem — da requisição HTTP até o processamento no consumidor — em um único trace visual no Jaeger, sem escrever uma linha de código de propagação manual no produtor.

### 1.1 Problema

Mensagens que atravessam filas são, por natureza, opacas. Quando algo dá errado (atraso, perda, erro em cascata), as ferramentas tradicionais (logs isolados por serviço) não mostram a **cadeia** de eventos. O resultado é diagnóstico lento e por palpação: atravessar N logs de N serviços e tentar correlacioná-los por timestamp.

### 1.2 Proposta de valor

| Antes | Depois |
|---|---|
| Logs isolados por serviço, sem correlação | **1 trace** com a jornada completa produtor→fila→consumidor |
| "A mensagem chegou?" — sem resposta | Resposta em **um clique**, com latência por etapa |
| Erros descobertos por complaint | Erro visível no span, com `recordException` e status `ERROR` |
| Latência de fila desconhecida | Tempo entre `amqplib send` e `handleOrderCreated` visível |

### 1.3 Escopo do produto (v1)

Um workspace funcional e demonstrável contendo:

1. `docker/` — RabbitMQ + Jaeger + OpenTelemetry Collector (um comando).
2. `producer/` — serviço NestJS HTTP que cria pedidos e publica em `orders_queue`.
3. `consumer/` — serviço NestJS que consome `order.created`, processa e registra spans.
4. `scripts/verify-trace.mjs` — prova automatizada de que o trace atravessa os dois serviços.
5. Documentação em PT-BR com quickstart, arquitetura e troubleshooting.

### 1.4 Fora do escopo (v1)

Banco de dados · DLQ/retry/backoff · métricas e logs como produto (exporters) · auth nos endpoints · deploy/CI-CD/Kubernetes · UI própria · teste de carga · propagação de baggage como requisito.

*(Justificativas e alternativas: RFC §1.2, §11.)*

---

## 2. Personas e Casos de Uso

### 2.1 Personas

| Persona | Descrição | O que precisa |
|---|---|---|
| **P1 — Dev/Observability Builder** (usuário primário) | Dev que está aprendendo ou aplicando OpenTelemetry em microsserviços | Código didático, nomes autoexplicativos, explicação de *por quê* em cada decisão |
| **P2 — SRE / Platform** | Quer garantir que a infraestrutura de telemetria não é ponto único de falha e que os traces são úteis | Métricas de health, resiliência quando o Collector cai, custo/latência previsíveis |
| **P3 — Avaliador/Revisor** | Julga se o projeto cumpre o material | Critérios verificáveis, script automatizado, documentação coerente |

### 2.2 Casos de uso

| ID | Caso | Ator | Fluxo de alto nível | Requisitos |
|---|---|---|---|---|
| UC-01 | **Subir o ambiente** | P1 | `make infra-up` → RabbitMQ, Jaeger e Collector disponíveis | FR-001 |
| UC-02 | **Criar um pedido** | P1/Externo | `POST /orders` → resposta `201` com pedido criado | FR-002 |
| UC-03 | **Consultar pedidos** | P1/Externo | `GET /orders`, `GET /orders/:id` | FR-003 |
| UC-04 | **Ver o processamento** | P1 | Log no consumer: `Processing order ORD-...` | FR-006 |
| UC-05 | **Ver a jornada completa** | P1/SRE | UI do Jaeger: 1 trace, 2 serviços, mesmo `trace_id` | FR-007, FR-010 |
| UC-06 | **Diagnosticar uma falha** | SRE | `SIMULATE_FAILURE_RATE=1` → span do consumer com `ERROR` e exceção registrada | FR-015 |
| UC-07 | **Provar automaticamente** | P3 | `make verify` → exit 0 confirmando continuidade de trace | FR-014 |
| UC-08 | **Operar sem depender do Collector** | SRE | Derrubar a infra de telemetria → pedidos seguem funcionando | NFR-002 |
| UC-09 | **Entender a configuração** | P1 | `.env.example` + README por serviço | FR-012, FR-013 |
| UC-10 | **Encerrar sem perder spans** | P1/SRE | `Ctrl+C` → spans pendentes são exportados antes de sair | FR-011 |

---

## 3. Requisitos Funcionais

Prioridade: **M** = Must (bloqueia release) · **S** = Should (alta prioridade) · **C** = Could (backlog).

### 3.1 Infraestrutura

| ID | Requisito | Prio | Critério de aceitação |
|---|---|---|---|
| **FR-001** | Um comando sobe RabbitMQ, Jaeger e OTel Collector com health verificável | M | **Given** o diretório `docker/` e Docker disponível, **when** executo `docker compose -f docker/docker-compose.yml up -d`, **then** `docker compose ps` mostra 3 containers `Up`; RabbitMQ responde em `http://localhost:15672` (guest/guest), Jaeger em `http://localhost:16686`, e `curl -s -o /dev/null -w '%{http_code}' http://localhost:13133` retorna `200` |
| **FR-002** | A fila `orders_queue` é criada e persistida | M | **Given** infra no ar, **when** o producer sobe e publica 1 mensagem, **then** a fila `orders_queue` aparece na UI do RabbitMQ com `durable=true` e a mensagem é consumida (fila volta a 0 pendentes) |
| **FR-003** | O Collector aceita OTLP/HTTP em `4318` e encaminha traces ao Jaeger | M | **Given** o Collector no ar, **when** um app exporta um span, **then** o Jaeger exibe o trace na UI e `GET http://localhost:16686/api/services` lista o serviço do app |

### 3.2 Serviço produtor

| ID | Requisito | Prio | Critério de aceitação |
|---|---|---|---|
| **FR-004** | `POST /orders` cria um pedido, publica `order.created` e responde `201` | M | **Given** o producer no ar, **when** `POST /orders` com `{"customerId":"CUST-001","amount":100.50,"items":["item1","item2"]}`, **then** status `201` e corpo `{"id":"ORD-<epoch_ms>-<rand4>","customerId":"CUST-001","amount":100.50,"items":["item1","item2"],"timestamp":"<ISO-8601>"}` (D-038) |
| **FR-005** | Validação de entrada rejeita payloads inválidos com `400` | M | **Given** o producer no ar, **when** `POST /orders` com `amount` negativo, `items` vazio ou campo desconhecido, **then** status `400` com array de mensagens de validação e **nenhum** span de negócio `createOrder` criado |
| **FR-006** | `GET /orders` e `GET /orders/:id` consultam os pedidos criados na sessão | S | **Given** 2 pedidos criados, **when** `GET /orders`, **then** `200` com 2 pedidos (mais recente primeiro); **when** `GET /orders/ORD-inexistente`, **then** `404` com mensagem `Order ORD-inexistente not found` |
| **FR-007** | `GET /health` reporta saúde do serviço | S | **Given** o producer no ar, **when** `GET /health`, **then** `200` com `{ "status":"ok", "service":"producer-service", "version":"1.0.0", "uptime": <n> }` |
| **FR-008** | Publicação na fila via `ClientProxy.emit('order.created', order)` com headers de rastreamento | M | **Given** um pedido criado, **when** inspeciono a mensagem na UI do RabbitMQ, **then** o header `traceparent` existe no formato `00-<32 hex>-<16 hex>-01` e o header `pattern` é `order.created` |

### 3.3 Serviço consumidor

| ID | Requisito | Prio | Critério de aceitação |
|---|---|---|---|
| **FR-009** | O consumer consome `order.created` da `orders_queue` | M | **Given** producer e consumer no ar, **when** crio um pedido, **then** o log do consumer mostra `Processing order: ORD-<id>` seguido de `Order ORD-<id> processed successfully` em até 2s |
| **FR-010** | Processamento registra eventos de negócio `order_received` e `order_processed` | M | **Given** um pedido processado, **when** inspeciono o span `handleOrderCreated` no Jaeger, **then** ele contém os eventos `order_received` e `order_processed` e o atributo `order.id` |
| **FR-011** | Erro de processamento é registrado no span e não trava o consumer | M | **Given** `SIMULATE_FAILURE_RATE=1`, **when** crio um pedido, **then** o span do consumer tem `status=ERROR` e a exceção registrada, o log mostra `Error processing order ORD-<id>`, e o consumer **continua** consumindo o pedido seguinte com sucesso |
| **FR-012** | Tempo de processamento simulado é observável (~500ms) | S | **Given** um pedido, **when** abro o trace, **then** a duração do span `handleOrderCreated` é ≥ 500ms e existe um span filho de processamento |

### 3.4 Rastreamento distribuído (núcleo do produto)

| ID | Requisito | Prio | Critério de aceitação |
|---|---|---|---|
| **FR-013** | Um **único `trace_id`** cobre spans do `producer-service` e do `consumer-service` | M | **Given** um pedido criado e processado, **when** consulto `GET /api/traces/<traceID>` no Jaeger, **then** a lista `data[0].processes` inclui os `serviceName` `producer-service` **e** `consumer-service` |
| **FR-014** | Spans de operação do RabbitMQ são gerados automaticamente | M | **Given** um pedido, **when** abro o trace, **then** existem spans de envio (producer) e de recebimento (consumer) com atributos `messaging.system=rabbitmq` e `messaging.destination.name=orders_queue` |
| **FR-015** | Spans manuais de negócio são criados em produtor e consumidor | M | **Given** um pedido, **when** abro o trace, **then** existem os spans `createOrder` (producer) e `handleOrderCreated` (consumer) |
| **FR-016** | Atributos de negócio são pesquisáveis por pedido | M | **Given** um pedido `ORD-X`, **when** busco no Jaeger por `service=consumer-service` + tag `order.id=ORD-X`, **then** o trace correspondente é encontrado |
| **FR-017** | Instrumentação de `amqplib` ativa e única (sem spans duplicados) | M | **Given** um trace, **when** inspeciono os spans de publish/consume, **then** existe **um** span de envio e **um** de recebimento por mensagem |
| **FR-018** | `service.name` correto por serviço | M | **Given** os dois serviços no ar, **when** consulto `GET /api/services` no Jaeger, **then** retorna `consumer-service` e `producer-service` |
| **FR-019** | Exportação OTLP/HTTP para o Collector com shutdown que faz flush | M | **Given** um span e `SIGINT` no processo, **when** o processo encerra, **then** o span chega ao Jaeger (fila do batch processor esvaziada no shutdown) |

### 3.5 Operação, verificação e documentação

| ID | Requisito | Prio | Critério de aceitação |
|---|---|---|---|
| **FR-020** | Script de verificação E2E do trace | M | **Given** infra + 2 serviços no ar, **when** executo `make verify` (ou `node scripts/verify-trace.mjs`), **then** exit `0` e saída contendo o `trace_id`, a contagem de spans e os 2 `serviceName`; em falha, exit `1` com diagnóstico |
| **FR-021** | Configuração por variáveis de ambiente com defaults de dev | M | **Given** uma instalação nova, **when** não defino nenhuma variável, **then** o projeto sobe e funciona com os defaults do RFC §5.2 |
| **FR-022** | `Makefile` como entrada única de operação | S | **Given** o clone, **when** executo `make help`, **then** lista `infra-up`, `infra-down`, `infra-logs`, `dev-producer`, `dev-consumer`, `build`, `verify`, `smoke`, `clean` com descrição |
| **FR-023** | Documentação: README raiz + 1 README por serviço + `.env.example` | M | **Given** um leitor novo, **when** lê `README.md`, **then** encontra pré-requisitos, quickstart (5 comandos), arquitetura, contrato da API, explicação da propagação de contexto e troubleshooting; os READMEs de serviço listam todas as envs aplicáveis |
| **FR-024** | Teste unitário do helper de extração de headers | S | **Given** `consumer/test/trace-context.spec.ts`, **when** executo `npm test` no consumer, **then** cobrem: headers diretos, `properties.headers`, entrada sem headers, valores não-string — todos passando |
| **FR-025** | Desligamento gracioso com flush de telemetria | M | **Given** os dois serviços no ar, **when** envio `SIGINT`, **then** logs mostram `Received SIGINT, shutting down` seguido de encerramento do tracing, e nenhum erro 5xx é observado antes do exit |

---

## 4. Requisitos Não Funcionais

| ID | Categoria | Requisito | Prio | Critério de aceitação |
|---|---|---|---|---|
| **NFR-001** | Performance | Overhead de tracing ≤ 5% na latência p50 do `POST /orders` | S | **Given** 100 requisições com `SIMULATE_FAILURE_RATE=0` e Collector no ar, **when** comparo com o mesmo teste com `OTEL_SERVICE_NAME` inativo (tracing desligado), **then** p50 com tracing ≤ 1,05× p50 sem tracing |
| **NFR-002** | Resiliência | Falha da telemetria não afeta o negócio | M | **Given** `docker compose stop otel-collector jaeger`, **when** `POST /orders`, **then** status `201` (ou `200` no `GET /health`) e a mensagem é consumida normalmente; erros do exporter aparecem apenas como log de telemetria |
| **NFR-003** | Build | `tsconfig` com `strict: true`; `npm run typecheck` e `npm run build` limpos nos 2 serviços | M | **Given** as dependências instaladas, **when** `make typecheck` e `make build`, **then** exit `0` e nenhum erro de tipo |
| **NFR-004** | Boot | Producer pronto em ≤ 10s; consumer assinando a fila em ≤ 10s | S | **Given** a infra no ar, **when** inicio os serviços, **then** o log `Producer service is running on http://localhost:3001` e `Consumer service is listening to RabbitMQ` aparecem em até 10s |
| **NFR-005** | Segurança | Nenhum segredo no repositório | M | **Given** o repositório, **when** busco por senha/token/chave, **then** só existem `guest:guest` (padrão de dev documentado) e placeholders em `.env.example`; `.env` está no `.gitignore` |
| **NFR-006** | Reprodutibilidade | Versões fixadas e lockfiles commitados | M | **Given** um clone limpo, **when** executo `npm ci` em `producer/` e `consumer/`, **then** instala com as versões do RFC §4.3 (incluindo `@opentelemetry/api@1.9.0`) sem resolução ambígua |
| **NFR-007** | Portabilidade | Funciona em Linux/macOS com Node ≥ 18 e Docker Compose v2 | S | **Given** `node -v` ≥ 18 e `docker compose version`, **when** `make infra-up && make verify`, **then** fluxo completo passa sem ajustes |
| **NFR-008** | Observabilidade | Sinais de telemetria não contêm PII nem corpo completo de mensagem | M | **Given** um trace capturado, **when** reviso atributos e eventos, **then** há apenas IDs, valores de negócio e atributos `messaging.*`/`service.*` |
| **NFR-009** | Didacticidade | Comentários em PT-BR explicam *por quê*; nomes autoexplicativos | S | **Given** revisão do código, **when** leio os arquivos, **then** entendendo a intenção de cada decisão sem consultar o material |
| **NFR-010** | Manutenibilidade | Inventário de arquivos fechado e sem duplicação desnecessária | S | **Given** o RFC §5.3, **when** comparo com o repositório, **then** não existem arquivos fora do inventário (exceto lockfiles e READMEs) |

---

## 5. Contratos de Interface (resumo normativo)

Detalhes completos em RFC §7. Esta seção é a **fonte de verdade para testes**.

### 5.1 API HTTP (producer, porta 3001)

| Método | Rota | Request | Sucesso | Erros |
|---|---|---|---|---|
| POST | `/orders` | `CreateOrderDto` | `201` + `Order` | `400` validação |
| GET | `/orders` | — | `200` + `Order[]` | — |
| GET | `/orders/:id` | — | `200` + `Order` | `404` |
| GET | `/health` | — | `200` + HealthDTO | — |

### 5.2 Modelo de dados

```ts
interface Order {
  id: string;          // ORD-<epoch_ms>-<rand4> (D-038, colision-safe)
  customerId: string;  // CUST-###
  amount: number;
  items: string[];
  timestamp: string;   // ISO-8601 UTC
}
```

### 5.3 Evento e propagação

| Item | Valor |
|---|---|
| Pattern | `order.created` |
| Fila | `orders_queue` (durable, `prefetchCount=1`) |
| Headers | `pattern=order.created`, `traceparent=00-<32hex>-<16hex>-01`, `tracestate` (quando aplicável) |

### 5.4 Portas e endpoints

| Serviço | Porta/URL | Finalidade |
|---|---|---|
| Producer HTTP | `http://localhost:3001` | API de pedidos |
| RabbitMQ AMQP | `localhost:5672` | Broker |
| RabbitMQ UI | `http://localhost:15672` | Gestão (guest/guest) |
| OTel Collector OTLP/HTTP | `http://localhost:4318/v1/traces` | Receptor de traces |
| OTel Collector health | `http://localhost:13133` | Health check |
| Jaeger UI | `http://localhost:16686` | Visualização e API |

---

## 6. Métricas de Sucesso do Produto

O produto é um projeto didático/instrumental: o "sucesso" é **demonstração verificável**, não adoção.

| # | Métrica | Meta | Como medir |
|---|---|---|---|
| M-1 | **Continuidade de trace** | 100% dos pedidos de teste aparecem em 1 trace com os 2 serviços | `make verify` exit 0 |
| M-2 | **Tempo até o trace visível** | ≤ 15s entre `POST /orders` e o trace na UI do Jaeger | Observação manual (batch timeout de 5s) |
| M-3 | **Cenários demonstráveis** | 3 cenários completos: sucesso, erro injetado, múltiplos pedidos | Checklist manual §8 |
| M-4 | **Fronteira de latência** | Overhead ≤ 5% (NFR-001) | Script de carga simples (100 reqs) |
| M-5 | **Resiliência** | 0 erros de negócio com telemetria fora (NFR-002) | Cenário B (§8) |
| M-6 | **Time-to-clone** | Qualquer pessoa sai do zero até o trace na UI com ≤ 10 comandos e ≤ 15 minutos | README quickstart |
| M-7 | **Qualidade da entrega** | 100% dos WPs com DoD verificado; 0 desvios silenciosos do material | Checklist do RELEASE_PLAN |

---

## 7. Riscos de Produto (top, com origem no RFC)

| ID | Risco | Mitigação no produto | Requisito |
|---|---|---|---|
| R-02/R-04 | Rastreamento silenciosamente quebrado (import errado / headers ausentes) | Verificação automatizada obrigatória antes de dizer "terminado" | FR-020, FR-013 |
| R-01 | Incompatibilidade `@opentelemetry/api` 2.x | Fixar `1.9.0` + lockfiles | NFR-006 |
| R-05 | Versão do Collector incompatível com o YAML | Fixar tag; log do container como fonte de erro | FR-001 |
| R-06 | Telemetria como ponto único de falha | Telemetria fora do caminho crítico | NFR-002 |

---

## 8. Cenários de Aceitação da Release (validação de M3)

| Cenário | Passos | Resultado esperado | Requisito |
|---|---|---|---|
| **A — Sucesso (fluxo principal)** | 1) `make infra-up` 2) producer + consumer no ar 3) `POST /orders` 4) UI do Jaeger | 201; log de processamento no consumer; **1 trace** com `createOrder` + `handleOrderCreated` + spans de `amqplib`; mesmo `trace_id` | FR-004, FR-009, FR-013, FR-015, FR-017 |
| **B — Erro injetado** | 1) consumer com `SIMULATE_FAILURE_RATE=1` 2) `POST /orders` 3) Jaeger 4) `POST /orders` novamente | Span do consumer com `status=ERROR` + exceção registrada; consumer segue vivo e processa o 2º pedido; pedido 1 **não** entra em loop | FR-011 |
| **C — Telemetria fora** | 1) `docker compose stop otel-collector jaeger` 2) `POST /orders` 3) `GET /health` 4) religar | `201` + consumidor OK + `/health` 200; log de erro de export; nenhuma falha de negócio | NFR-002 |
| **D — Múltiplos pedidos (fan-out)** | 1) 3× `POST /orders` em sequência 2) UI do Jaeger | 3 traces **distintos** (3 `trace_id`s), cada um com os 2 serviços; `prefetch=1` respeitado (sem interleaving do mesmo pedido) | FR-013 |
| **E — Validação de payload** | 1) `POST /orders` com `amount: -1` e `items: []` 2) com campo `foo: 1` | `400` com mensagens de validação; nenhum pedido criado; nenhum span de negócio | FR-005 |
| **F — Shutdown com flush** | 1) producer e consumer no ar 2) `SIGINT` em ambos 3) UI do Jaeger | Logs de shutdown; spans das últimas operações **presentes** no Jaeger | FR-025, FR-019 |
| **G — Prova automatizada** | 1) tudo no ar 2) `make verify` | Exit 0 + resumo com trace id e 2 serviços | FR-020 |

---

## 9. Matriz de Rastreabilidade (requisito → artefato → verificação)

| Req. | Artefato (F-xx) | Verificação | Tipo | Marcador |
|---|---|---|---|---|
| FR-001/002/003 | F-04, F-05 | `make infra-up` + `docker compose ps` + curls | Manual | M1 |
| FR-004 | F-16, F-17 | `make smoke` / curl | Manual+script | M2 |
| FR-005 | F-15, F-11 | curl com payload inválido | Manual | M2 |
| FR-006/007 | F-17, F-18 | curl `GET /orders`, `/orders/:id`, `/health` | Manual | M2 |
| FR-008 | F-10, F-16 | inspeção na UI do RabbitMQ | Manual | M3 |
| FR-009/010/011/012 | F-28 | cenário A/B (§8) | Manual | M3 |
| FR-013 | F-06, F-21, F-29, F-30 | `make verify` | **Automatizado** | M3 |
| FR-014/017 | F-08, F-21 | inspeção de spans no Jaeger | Manual | M3 |
| FR-015/016 | F-16, F-28 | inspeção de spans/atributos | Manual | M3 |
| FR-018 | F-08, F-21 | `/api/services` | Manual | M3 |
| FR-019/025 | F-13, F-17, F-26 | cenário F (§8) | Manual | M3/M4 |
| FR-020 | F-30 | `make verify` | **Automatizado** | M3 |
| FR-021 | F-09, F-22, F-31, F-32 | rodar sem definir nenhuma env | Manual | M2/M4 |
| FR-022 | F-01 | `make help` | Manual | M4 |
| FR-023 | F-31..F-35 | revisão documental | Manual | M4 |
| FR-024 | F-36 | `npm test` (consumer) | **Automatizado** | M4 |
| NFR-001 | — | script de 100 reqs (cenário opcional) | Manual | M4 |
| NFR-002 | F-08, F-28 | cenário C (§8) | Manual | M3 |
| NFR-003/006 | F-06, F-19, F-07, F-20 | `make typecheck`, `make build`, `npm ci` | **Automatizado** | M1/M2 |
| NFR-004 | — | cronômetro no boot | Manual | M2 |
| NFR-005 | F-02, F-31, F-32 | busca por segredos | Manual | M4 |
| NFR-008 | F-16, F-28 | revisão de atributos | Manual | M3 |
| NFR-009/010 | todos | revisão de código | Manual | M4 |

---

## 10. Definição de Pronto (DoD global da v1)

A v1 está **pronta** quando **todas** as condições abaixo forem verdadeiras:

1. ✅ Todos os WPs **Must** (WP-01 a WP-10) com DoD verificado (RELEASE_PLAN §6).
2. ✅ `make infra-up` → `make dev-producer` + `make dev-consumer` → `make verify` passa do zero, em máquina limpa, seguindo **apenas** o README.
3. ✅ Cenários A, B, C e G (§8) executados e aprovados com evidência (print/JSON do `make verify`).
4. ✅ `make typecheck` e `make build` limpos nos dois serviços; `npm ci` funciona a partir dos lockfiles.
5. ✅ FR-013 (trace único atravessando os 2 serviços) comprovado por `make verify` com exit 0 — **é o aceite principal do produto**.
6. ✅ Nenhum desvio do RFC §3.1 ou de outra decisão do RFC §3 sem registro em `RFC.md` (append no log de decisões).
7. ✅ Documentação coerente: nenhum comando, porta, env ou rota citado em README que não exista no código.
8. ✅ Nenhuma pendência **Must** aberta no RELEASE_PLAN; itens **Should** abertos estão registrados no backlog (RFC §12.2) ou na lista de dívida técnica do RELEASE_PLAN §9.

---

## 11. Backlog do Produto (pós-v1, priorizado)

| # | Item | Valor | Origem |
|---|---|---|---|
| B-1 | DLQ + retry com backoff + idempotência | Resiliência real de produção | RFC §12.2 (2) |
| B-2 | ~~ID de pedido colision-safe~~ | Corretude sob concorrência | RFC §12.2 (1) → implementado em WP-16/v1.4 (D-038, §7.11) |
| B-3 | Métricas (contador de pedidos, histograma de latência) + painel | Complementa o "3º pilar" | RFC §12.2 (3) |
| B-4 | ~~Baggage de exemplo (`user.id`)~~ | Contexto de negócio propagado | RFC §12.2 (4) → implementado em WP-15/v1.3 (D-037, §7.10) |
| B-5 | Executar os serviços em containers com o Compose | Paridade dev/prod | RFC §12.4 |
| B-6 | Alertas/SLOs sobre traces (latência p95, taxa de erro) | Operação | Material §11.3 |
| B-7 | Exemplo de exportação para backend comercial | Portabilidade do OTel | Material §11.4 |

---

## Apêndice — Glossário

| Termo | Significado |
|---|---|
| **Trace** | Jornada completa de uma requisição/mensagem através de múltiplos serviços |
| **Span** | Unidade individual de trabalho dentro de um trace |
| **Trace ID** | Identificador de 128 bits (hex) que costura todos os spans da jornada |
| **Span ID** | Identificador de 64 bits (hex) de um span |
| **Contexto propagado** | `traceparent`/`tracestate` que viajam no header da mensagem |
| **Producer/Consumer** | Serviço que publica na fila / serviço que consome da fila |
| **Broker** | RabbitMQ: intermediário que armazena as mensagens |
| **Collector** | OpenTelemetry Collector: recebe, processa e encaminha sinais |
| **Fire-and-forget** | `emit` publica sem esperar resposta (o pedido é processado assincronamente) |
| **BatchSpanProcessor** | Agrupa spans e exporta em lotes (usado no shutdown para flush) |
| **W3C Trace Context** | Padrão de propagação de contexto adotado pelo OpenTelemetry |

**Fim do PRD-001 v1.0.0 — o próximo passo é o `RELEASE_PLAN.md`.**
