# RELEASE_PLAN — Plano de Implementação por Agentes

| Campo | Valor |
|---|---|
| **ID** | REL-001 |
| **Versão** | 1.0.0 |
| **Data** | 2026-09-25 |
| **Release alvo** | v1.0.0 — demo funcional de rastreamento distribuído |
| **Escopo** | WP-01 a WP-10 (Must) + WP-11 (Should) |
| **Contrato técnico** | [`RFC.md`](./RFC.md) §3 (decisões), §5 (inventário), §7 (contratos) |
| **Escopo/aceite** | [`PRD.md`](./PRD.md) §3 (FR), §4 (NFR), §8 (cenários), §10 (DoD) |

> **Regra de ouro desta execução**
> 1. Um agente executa **um WP por vez**, na ordem de dependência da §3.
> 2. Antes de escrever qualquer linha: ler o(s) arquivo(s) do WP + o contrato correspondente no RFC.
> 3. Ao terminar: cumprir o **DoD do WP** (§6) **com comando executado** e reportar no template da §8.
> 4. **Nunca** mudar arquivo fora do WP atual (ownership na §5) nem criar arquivo fora do inventário canônico (RFC §5.3).
> 5. **Nunca** decidir por conta própria algo já decidido no RFC. Se algo estiver errado ou ausente, **parar e reportar** (§8.1) em vez de improvisar.

---

## 1. Visão de Releases

| Release | Data alvo | Conteúdo | Critério de saída |
|---|---|---|---|
| **R0 — Fundações** | D1 | Repos scaffolding + Makefile + gitignore | M0 (Makefile responde `make help`) |
| **R1 — Infra de Observabilidade** | D1 | Docker Compose (RabbitMQ, Jaeger, Collector) | M1 (3 containers + 3 URLs respondendo) |
| **R2 — Produtor traced** | D2 | Producer com tracing + API + spans | M2 (`POST /orders` 201 + trace no Jaeger) |
| **R3 — Consumidor traced** | D2 | Consumer com tracing + handler | M3 (fluxo ponta a ponta + `make verify` exit 0) |
| **R4 — Qualidade e Docs** | D3 | Testes, hardening, documentação | M4 (DoD global do PRD §10) |

**Estimativa:** 11 WPs · caminho crítico = WP-01 → WP-02 → WP-03 → WP-04 → WP-06 → WP-08 → WP-09.

---

## 2. Visão Geral das Waves

```
WAVE A  ── Setup        : WP-01 (scaffolding+Makefile)
           │
WAVE B  ── Infra        : WP-02 (docker-compose + collector)  ← bloqueia tudo
           │
WAVE C  ── Producer     : WP-03 (skeleton+tracing) → WP-04 (bootstrap+módulos) → WP-05 (domínio+API)
           │                                        │
WAVE D  ── Consumer     : WP-06 (skeleton+tracing) → WP-07 (bootstrap+módulos) → WP-08 (handler+contexto)
           │
WAVE E  ── Prova        : WP-09 (verificação E2E + resgate de trace) ← MARCO CRÍTICO DO PRODUTO
           │
WAVE F  ── Qualidade   : WP-10 (envs+READMEs) · WP-11 (testes Should) · WP-12 (opcional: dockerizar apps)
WAVE G  ── v1.1 backlog : WP-13 (DLQ + retry com backoff + idempotência — RFC §12.2 #2)
WAVE H  ── v1.2 backlog : WP-14 (métricas + logs exporters — RFC §12.2 #3)
WAVE I  ── v1.3 backlog : WP-15 (baggage `user.id`/`request.id` — RFC §12.2 #4)
            │
            ▼
         RELEASE v1.0.0  (DoD global PRD §10)
```

| Wave | WPs | Duração (1 agente) | Pode paralelizar? |
|---|---|---|---|
| A | WP-01 | ~30min | não (pré-requisito) |
| B | WP-02 | ~45min | não (bloqueia WPs C/D) |
| C | WP-03, WP-04, WP-05 | ~3h | parcial: WP-04 e WP-05 (interno) |
| D | WP-06, WP-07, WP-08 | ~2,5h | **sim com C** (diretórios disjuntos: `consumer/` vs `producer/`) |
| E | WP-09 | ~1,5h | não (depende de C+D completos) |
| F | WP-10, WP-11, WP-12 | ~2h | WP-10 e WP-11 em paralelo; WP-12 opcional |

**Orçamento total:** ~10h de trabalho de agente; **caminho crítico** ~6h (com C e D paralelos).

---

## 3. Grafo de Dependências

```
WP-01 ──► WP-02 ──► WP-03 ──► WP-04 ──► WP-05 ──┐
                              │                   ├──► WP-09 ──► WP-10 ──► (release)
                              └───────────────────┤
                   WP-06 ──► WP-07 ──► WP-08 ────┘
                                    
WP-11 (testes) depende de WP-08 (helper existe)
WP-12 (opcional, dockerizar apps) depende de WP-09 (prova passa em modo host)
```

Regras de paralelismo:
- **WP-03..WP-05 (producer/) e WP-06..WP-08 (consumer/) rodam em paralelo** — não compartilham arquivos (matriz §5).
- **WP-02 bloqueia ambos** (sem broker/collector, nada funciona).
- **WP-09 é serial e é o heart da release** — não aceitar atalhos aqui.

---

## 4. Work Packages (detalhamento)

Formato de cada WP: **Objetivo · Entradas · Arquivos (ownership) · Passos · DoD · Riscos**.
Passos numerados são executáveis na ordem; cada passo tem um **comando de verificação**.

### WP-01 — Scaffolding do repositório e Makefile

| Campo | Valor |
|---|---|
| **Wave / Marco** | A / R0 |
| **Agente** | `agent-setup` |
| **Duração** | ~30min |
| **Depende de** | — |
| **Bloqueia** | WP-02 |
| **Requisito servido** | FR-022, NFR-005, NFR-010 |

**Objetivo:** Estrutura de pastas, ignorados e a interface de comandos (`Makefile`) que todo o resto usa.

**Arquivos (ownership exclusivo):** `Makefile`, `.gitignore`, `.editorconfig` e **criação das pastas** `docker/`, `producer/`, `consumer/`, `scripts/`.

**Passos:**
1. Criar pastas `docker/`, `producer/`, `consumer/`, `scripts/`.
2. `.gitignore`: `node_modules/`, `dist/`, `.env`, `.env.*` (!`.env.example`), `*.log`, `coverage/`, `.DS_Store`, `*.tsbuildinfo`.
3. `.editorconfig`: `root=true`; `[*] indent_size=2, end_of_line=lf, charset=utf-8`; `[*.md] trim_trailing_whitespace=false`.
4. `Makefile` com os alvos e descrições (com `.PHONY`):

   | Alvo | Ação |
   |---|---|
   | `help` | lista os alvos (default) |
   | `infra-up` | `docker compose -f docker/docker-compose.yml up -d` |
   | `infra-down` | `docker compose -f docker/docker-compose.yml down` |
   | `infra-logs` | `docker compose -f docker/docker-compose.yml logs -f` |
   | `install` | `npm ci` em `producer/` e `consumer/` (ou `npm install` se sem lockfile) |
   | `build` | `npm run build` nos 2 serviços |
   | `typecheck` | `npm run typecheck` nos 2 serviços |
   | `dev-producer` | `cd producer && npm run dev` |
   | `dev-consumer` | `cd consumer && npm run dev` |
   | `start-producer` / `start-consumer` | `node dist/main.js` em cada serviço |
   | `smoke` | curls de `GET /health` + `POST /orders` + `GET /orders` no producer |
   | `verify` | `node scripts/verify-trace.mjs` |
   | `test` | `npm test` nos serviços que tiverem teste |
   | `clean` | `rimraf dist`/limpeza equivalente nos 2 serviços |

5. Alvos devem usar `cd` interno (`$(MAKE) -C producer` ou subshell) para funcionar da raiz.

**DoD:**
- [ ] `make help` lista todos os alvos acima (verificar por execução).
- [ ] Pastas `docker/`, `producer/`, `consumer/`, `scripts/` existem.
- [ ] `.gitignore` cobre `node_modules/`, `dist/`, `.env`.
- [ ] `make infra-up` falha **de forma esperada** agora (compose ainda não existe) — sem stack trace obscuro.
- [ ] Handoff §8 preenchido.

**Riscos:** nenhum. (WP de menor risco; fazer primeiro.)

---

### WP-02 — Infraestrutura: Docker Compose + OTel Collector

| Campo | Valor |
|---|---|
| **Wave / Marco** | B / R1 |
| **Agente** | `agent-infra` |
| **Duração** | ~45min |
| **Depende de** | WP-01 |
| **Bloqueia** | WP-03..WP-09 |
| **Requisito servido** | FR-001, FR-002, FR-003 |

**Objetivo:** Um `docker compose up` que disponibilize broker, backend de traces e agregador, com health verificável — exatamente o contrato do RFC §6.

**Arquivos:** `docker/docker-compose.yml` (F-04), `docker/otel-collector-config.yml` (F-05).

**Passos:**
1. Escrever `docker-compose.yml` conforme contrato RFC §6.1: serviço `rabbitmq` (`rabbitmq:3.12-management`, portas 5672/15672, volume `rabbitmq_data`, healthcheck `rabbitmq-diagnostics -q ping`, `restart: unless-stopped`); serviço `jaeger` (`jaegertracing/all-in-one`, porta 16686, env `COLLECTOR_OTLP_ENABLED=true`); serviço `otel-collector` (`otel/opentelemetry-collector-contrib:0.97.0`, comando `--config=/etc/otel/config.yml`, mount read-only do config, portas 4317/4318/13133, `depends_on: [jaeger]`). **Sem** campo `version:`. **Sem** healthcheck no collector (RFC §6.1).
2. Escrever `otel-collector-config.yml` **exatamente** como o contrato do RFC §6.2 (receivers otlp http/grpc em `0.0.0.0`, processors `memory_limiter` + `batch`, exporter `otlp/jaeger` → `jaeger:4317` insecure, pipeline `traces`).
3. `docker compose -f docker/docker-compose.yml config` (valida sintaxe YAML) — deve passar.
4. `make infra-up`; esperar os 3 containers `Up`; RabbitMQ pode precisar de ~20-30s para ficar *healthy*.
5. Validar as três URLs (RFC §8.1): `http://localhost:15672` (login guest/guest), `http://localhost:16686` (UI), `http://localhost:13133` (health, HTTP 200).
6. Confirmar receiver OTLP: `curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:4318/v1/traces -H 'Content-Type: application/json' -d '{}'` (status != 000).

**DoD:**
- [ ] `docker compose ps` mostra `rabbitmq`, `jaeger`, `otel-collector` em `Up` (rabbitmq `healthy`).
- [ ] `curl :13133` → 200; `curl :16686` responde HTML; `curl :15672` responde.
- [ ] `curl -X POST :4318/v1/traces` responde com status HTTP (sem conexão recusada).
- [ ] `docker compose logs otel-collector` **sem erros de configuração** (se houver erro de chave YAML → upgrade de tag conforme R-05 e registrar em RFC).
- [ ] Handoff §8.

**Riscos (R-05):** se a tag `0.97.0` do collector falhar ao baixar ou rejeitar o YAML → usar `latest`, revalidar, **e registrar** a tag final usada em RFC §4.3.

---

### WP-03 — Producer: skeleton + tracing (arquitetura de execução)

| Campo | Valor |
|---|---|
| **Wave / Marco** | C / R2 |
| **Agente** | `agent-producer` |
| **Duração** | ~1h |
| **Depende de** | WP-02 |
| **Bloqueia** | WP-04 |
| **Requisito servido** | FR-013 (parcial), FR-018, NFR-003, NFR-006, NFR-008 |

**Objetivo:** O serviço producer compila, sobe **e** já emite traces com `service.name=producer-service` para o Collector. Este é o WP de maior risco técnico (versões OTel).

**Arquivos:** `producer/package.json` (F-06), `producer/tsconfig.json` + `tsconfig.build.json` (F-07), `producer/nest-cli.json`, `producer/src/tracing.ts` (F-08), `producer/src/config.ts` (F-09), `producer/src/rabbitmq.config.ts` (F-10), `producer/package-lock.json`.

**Passos:**
1. `package.json` — dependências **fixadas** (RFC D-003 / §4.3): `@nestjs/common@10.3.0`, `@nestjs/core@10.3.0`, `@nestjs/microservices@10.3.0`, `@nestjs/platform-express@10.3.0`, `class-validator@0.14.x`, `class-transformer@0.5.x`, `reflect-metadata@0.1.14`, `rxjs@7.8.x`; OTel: `@opentelemetry/sdk-node@0.50.0`, `@opentelemetry/api@1.9.0`, `@opentelemetry/exporter-trace-otlp-http@0.50.0`, `@opentelemetry/resources@1.x`, `@opentelemetry/semantic-conventions@1.x`, `@opentelemetry/auto-instrumentations-node@0.4x`; dev: `typescript@5.3.3`, `@types/node@20.x`, `@nestjs/cli@10.x`, `rimraf@5.x`. **Fixar `@opentelemetry/api` em 1.9.0 (NUNCA 2.x — R-01).**
2. Scripts (D-011): `dev: nest start --watch`, `build: nest build`, `start: node dist/main`, `typecheck: tsc --noEmit -p tsconfig.json`, `clean: rimraf dist`. Instalar com `npm install -E` (exact) e **commitar** o `package-lock.json`.
3. `tsconfig.json`: `strict: true`, `target: ES2021`, `module: commonjs`, `moduleResolution: node`, `emitDecoratorMetadata: true`, `experimentalDecorators: true`, `esModuleInterop: true`, `skipLibCheck: true`, `outDir: dist`, `sourceMap: true`, `incremental: true`; incluir `node_modules/@types`. `tsconfig.build.json` estende o anterior excluindo `**/*.spec.ts` e `test/`.
4. `nest-cli.json`: `{ "$schema": "https://json.schemastore.org/nest-cli", "collection": "@nestjs/schematics", "sourceRoot": "src" }`.
5. `src/config.ts`: objeto `config` tipado lendo envs do RFC §5.2 com defaults (`PORT=3001`, `RABBITMQ_URL`, `ORDER_QUEUE=orders_queue`, `OTEL_SERVICE_NAME=producer-service`, `SERVICE_VERSION=1.0.0`, `NODE_ENV=development`, `SIMULATE_FAILURE_RATE` só no consumer).
6. `src/rabbitmq.config.ts`: exportar `ORDER_QUEUE` e `rabbitmqConfig: ClientOptions` — `{ transport: Transport.RMQ, options: { urls: [config.rabbitmqUrl], queue: ORDER_QUEUE, queueOptions: { durable: true }, prefetchCount: 1 } }` (RFC D-009).
7. `src/tracing.ts`: implementar **exatamente** o esqueleto do RFC §7.1 (exporter com precedência D-010, `Resource` com 3 atributos, `getNodeAutoInstrumentations` com amqplib habilitado e `fs` desabilitado, `sdk.start()`, export `shutdownTracing()`, **sem** handlers de sinal).
8. `npm install -E` + `npm run typecheck` — deve passar (prova que `@opentelemetry/api` 1.9.0 é compatível com o SDK 0.50.0 → valida R-01 precocemente).
9. Subir infra (WP-02) e criar um `main.ts` temporário mínimo **somente** para provar o tracing: `import './tracing'; console.log('tracing up', process.env.OTEL_SERVICE_NAME)`. Executar 3s. Nos logs do Collector deve aparecer `traces` recebido (level info). Depois remover o temporário (WP-04 cria o `main.ts` real).

**DoD:**
- [ ] `npm run typecheck` e `npm run build` com exit 0 (NFR-003).
- [ ] `npm ls @opentelemetry/api` mostra `1.9.0` (nunca 2.x).
- [ ] `package-lock.json` existe e está commitado.
- [ ] `tracing.ts` segue RFC §7.1: sem handlers de sinal, `sdk.start()` síncrono, instrumentação amqplib única.
- [ ] (Provisório) O Collector registra receipt de spans do processo producer (evidência: `docker compose logs otel-collector` mostra export).
- [ ] Handoff §8 com as versões resolvidas (tabela do RFC §4.3 atualizada se algo resolver diferente).

**Riscos (R-01, R-02):** incompatibilidade api 2.x e ordem de import. Mitigações: passo 1 fixa 1.9.0; passo 8 valida cedo; passo 9 valida o receipt.

---

### WP-04 — Producer: bootstrap e módulos

| Campo | Valor |
|---|---|
| **Wave / Marco** | C / R2 |
| **Agente** | `agent-producer` |
| **Duração** | ~45min |
| **Depende de** | WP-03 |
| **Bloqueia** | WP-05, WP-09 |
| **Requisito servido** | FR-004 (parcial), FR-021, NFR-002, NFR-004 |

**Objetivo:** App HTTP Nest sobe com o módulo raiz, `ValidationPipe` global e shutdown gracioso; `GET /health` responde.

**Arquivos:** `producer/src/main.ts` (F-11), `producer/src/app.module.ts` (F-12), `producer/src/shutdown.ts` (F-13), `producer/src/order.interface.ts` (F-14), `producer/src/health.controller.ts` (F-18).

**Passos:**
1. `order.interface.ts`: `interface Order { id: string; customerId: string; amount: number; items: string[]; timestamp: string }` (timestamp string ISO — RFC §7.2/R-10).
2. `app.module.ts`: `@Module({ imports: [ClientsModule.register([{ name: 'ORDER_SERVICE', ...rabbitmqConfig }])], controllers: [HealthController], providers: [] })` — `OrderController`/`OrderService` entram no WP-05.
3. `main.ts`: `import './tracing';` **na primeira linha** (D-004, sem comentários antes); `NestFactory.create(AppModule)`; `app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))` (D-015); `app.listen(config.port)`; logs: `Tracing initialized for producer service`, `Producer service is running on http://localhost:3001`; **`sem** `enableShutdownHooks()` (D-017)`.
4. `shutdown.ts`: `installShutdownHooks(app, 'producer-service')` — `process.once('SIGTERM'|'SIGINT')` → `Logger.log('Received <signal>, shutting down')` → `await app.close()` (try/catch) → `await shutdownTracing()` → `process.exit(0)`; idempotente (D-017). Chamar em `main.ts` após `listen`.
5. `health.controller.ts`: `@Get('health')` → `{ status: 'ok', service: 'producer-service', version: config.serviceVersion, uptime: process.uptime() }` (RFC §7.5).
6. `npm run typecheck` + `npm run build` + `npm run dev`; validar `GET /health` → 200 com o corpo esperado; `Ctrl+C` → log de shutdown limpo, sem `UnhandledPromiseRejection`/stack.

**DoD:**
- [ ] `GET http://localhost:3001/health` → 200 com o JSON do RFC §7.5.
- [ ] `Ctrl+C` mostra `Received SIGINT, shutting down` e o processo sai com exit 0.
- [ ] `import './tracing'` é a primeira linha de `main.ts` (verificado por diff/histórico).
- [ ] `typecheck` + `build` limpos.
- [ ] Handoff §8.

**Riscos:** nenhum crítico. (Se `app.close()` demorar por causa da conexão AMQP, usar `client.close()` no `onModuleDestroy` do provider do `ORDER_SERVICE` — registrar em handoff.)

---

### WP-05 — Producer: domínio de pedidos + API

| Campo | Valor |
|---|---|
| **Wave / Marco** | C / R2 |
| **Agente** | `agent-producer` |
| **Duração** | ~1h15 |
| **Depende de** | WP-04 |
| **Bloqueia** | WP-09 |
| **Requisito servido** | FR-004, FR-005, FR-006, FR-007, FR-008, FR-015, FR-016 |

**Objetivo:** `POST /orders` cria o pedido com span manual `createOrder`, publica na fila com propagação automática, e a consulta (`GET /orders`, `GET /orders/:id`) funciona. Este é o WP que cria os spans do produtor.

**Arquivos:** `producer/src/order.dto.ts` (F-15), `producer/src/order.service.ts` (F-16), `producer/src/order.controller.ts` (F-17), e atualizar `app.module.ts` (registrar controller/service — já é seu, WP-04).

**Passos:**
1. `order.dto.ts`: `CreateOrderDto` com decorators do contrato RFC §7.2 (`@IsString() @IsNotEmpty() @Matches(/^CUST-.../) customerId`, `@IsNumber() @Min(0.01) @Max(1e6) @Type(() => Number) amount`, `@IsArray() @ArrayMinSize(1) @IsString({each:true}) items`).
2. `order.service.ts`:
   - `@Injectable()`, `constructor(@Inject('ORDER_SERVICE') private client: ClientProxy)`.
   - `tracer = trace.getTracer('producer-service')` (nome igual ao resource — RFC §7.3).
   - Store in-memory: `Map<string, Order>` + `evictIfNeeded()` mantendo ≤ 100 (D-014).
   - `createOrder(dto: CreateOrderDto): Promise<Order>`:
     1. `const span = this.tracer.startSpan('createOrder')`;
     2. `span.setAttributes({ 'order.id', 'order.customer_id', 'order.amount', 'messaging.system': 'rabbitmq', 'messaging.destination.name': ORDER_QUEUE })` (D-018);
     3. `span.addEvent('order_created', {...})`;
     4. montar `Order` com `id = ORD-${Date.now()}` e `timestamp = new Date().toISOString()` (D-016);
     5. `await this.client.emit('order.created', order).toPromise()`;
     6. `span.addEvent('order_sent_to_queue', { 'queue.name': ORDER_QUEUE })`;
     7. guardar no Map; `return order`;
     8. `catch (e) { span.recordException(e as Error); span.setStatus({ code: SpanStatusCode.ERROR }); throw e; }`;
     9. `finally { span.end(); }` (RFC §7.3).
   - `getOrders(): Order[]` (mais recente primeiro) e `getById(id): Order | undefined`.
3. `order.controller.ts`: `@Controller('orders')` com `@Post() create(@Body() dto: CreateOrderDto): Promise<Order>` (retorna `201` por padrão no Nest para `@Post`), `@Get() list()`, `@Get(':id') getOne(@Param('id') id: string)` → lança `NotFoundException('Order <id> not found')` se ausente.
4. Atualizar `app.module.ts`: `controllers: [OrderController, HealthController]`, `providers: [OrderService]`.
5. `typecheck` + `build`; `make dev-producer`; validar:
   - `POST /orders` válido → 201 + corpo com `ORD-...` e `timestamp` ISO;
   - payload inválido (`amount: -1`, `items: []`, campo extra `foo`) → 400 e **nenhum** span `createOrder`;
   - `GET /orders` → 200 com o criado; `GET /orders/ORD-x` → 404 com a mensagem do contrato;
   - UI do RabbitMQ: mensagem em `orders_queue` (será consumida quando o consumer subir) e, inspecionando a mensagem, header `traceparent` presente (FR-008) — inspecionar **antes** de subir o consumer (pausar a fila se necessário, ou rodar o teste WP-05 com o consumer ainda ausente).
6. (Opcional, mas recomendado) Inspecionar os spans no Jaeger: deve haver `POST /orders` (auto HTTP) + `createOrder` + span de `amqplib` publish. Registrar na evidência do handoff.

**DoD:**
- [ ] FR-004, FR-005, FR-006, FR-007 atendidos por curl (com prints/saídas no handoff).
- [ ] Header `traceparent` presente na mensagem (FR-008) — evidência registrada.
- [ ] Spans `createOrder` + eventos `order_created`/`order_sent_to_queue` no Jaeger (FR-015).
- [ ] `typecheck` + `build` limpos.
- [ ] Nenhum `console.log` de payload completo; logs via `Logger` (NFR-008/009).
- [ ] Handoff §8.

**Riscos (R-08):** atributos de alta cardinalidade → apenas IDs/valores (RFC D-018). (R-16: `emit` pode falhar se a conexão AMQP ainda não estiver pronta em dev — o Nest reconecta; não tratar como bug de código.)

---

### WP-06 — Consumer: skeleton + tracing

| Campo | Valor |
|---|---|
| **Wave / Marco** | D / R3 |
| **Agente** | `agent-consumer` |
| **Duração** | ~1h |
| **Depende de** | WP-02 |
| **Bloqueia** | WP-07 |
| **Requisito servido** | FR-013 (parcial), FR-018, NFR-003, NFR-006 |

**Objetivo:** Espelho do WP-03 para o consumer: compila e emite traces com `service.name=consumer-service`. Pode rodar **em paralelo** com WP-03..05.

**Arquivos:** `consumer/package.json` (F-19), `consumer/tsconfig.json` + `build` (F-20), `consumer/nest-cli.json`, `consumer/src/tracing.ts` (F-21), `consumer/src/config.ts` (F-22), `consumer/src/rabbitmq.config.ts` (F-23), `consumer/package-lock.json`.

**Passos:**
1. `package.json` — mesmas versões pinadas do WP-03 (D-003), mas com `service.name` default `consumer-service` e a env `SIMULATE_FAILURE_RATE` (D-021) no `config.ts`. Deps Nest iguais; sem `class-validator` (não há API HTTP).
2. `tsconfig.json` / `tsconfig.build.json` / `nest-cli.json` idênticos ao WP-03.
3. `src/config.ts`: `RABBITMQ_URL`, `ORDER_QUEUE`, `OTEL_SERVICE_NAME` (default `consumer-service`), `SERVICE_VERSION`, `NODE_ENV`, `SIMULATE_FAILURE_RATE` (default `0`, clamp 0..1).
4. `src/rabbitmq.config.ts`: igual ao do producer (mesma fila, `durable`, `prefetchCount: 1`).
5. `src/tracing.ts`: esqueleto do RFC §7.1 com `SERVICE_NAME` default `consumer-service`. **Não** importar o `tracing.ts` do producer (D-001: duplicação é intencional).
6. `npm install -E`, `typecheck`, `build` (limpos); `npm ls @opentelemetry/api` → 1.9.0.

**DoD:** [ ] `typecheck` + `build` exit 0. [ ] `api@1.9.0`. [ ] `tracing.ts` com `consumer-service`. [ ] Lockfile commitado. [ ] Handoff §8.

**Riscos:** R-01 (mesmo do WP-03). Mitigação: mesma estratégia de pin.

---

### WP-07 — Consumer: bootstrap e módulo

| Campo | Valor |
|---|---|
| **Wave / Marco** | D / R3 |
| **Agente** | `agent-consumer` |
| **Duração** | ~30min |
| **Depende de** | WP-06 |
| **Bloqueia** | WP-08 |
| **Requisito servido** | FR-021, NFR-002, NFR-004 |

**Objetivo:** Microservice Nest conecta na fila e aguarda mensagens; shutdown gracioso.

**Arquivos:** `consumer/src/main.ts` (F-24), `consumer/src/app.module.ts` (F-25), `consumer/src/shutdown.ts` (F-26), `consumer/src/order.interface.ts` (F-27).

**Passos:**
1. `order.interface.ts`: `interface Order` idêntica ao do producer (F-27, §7.2).
2. `app.module.ts`: `@Module({ controllers: [OrderConsumer], providers: [] })` (controller vazio até o WP-08; ou já com o `OrderConsumer` do WP-08 se os dois forem feitos juntos — manter arquivos separados por WP).
3. `main.ts`: `import './tracing';` primeira linha; `NestFactory.createMicroservice<MicroserviceOptions>(AppModule, { ...rabbitmqConfig })`; `await app.listen()`; log `Tracing initialized for consumer service` + `Consumer service is listening to RabbitMQ`; **`sem** porta HTTP** (D-002) e sem `enableShutdownHooks` (D-017).
4. `shutdown.ts`: `installShutdownHooks(app, 'consumer-service')` — mesma implementação do WP-04 (flush do SDK garante spans pendentes — FR-019/FR-025).
5. `typecheck` + `build`; `npm run dev` com a infra no ar → log de "listening" em ≤ 10s (NFR-004); a fila `orders_queue` aparece na UI do RabbitMQ (o declare/assert acontece no connect).

**DoD:** [ ] Log `Consumer service is listening to RabbitMQ` aparece. [ ] Fila `orders_queue` visível na UI com `durable=true`. [ ] `Ctrl+C` encerra limpo com log de shutdown. [ ] Nenhuma porta HTTP exposta. [ ] `typecheck`+`build` limpos. [ ] Handoff §8.

**Riscos:** se o `@EventPattern` não casar com o `emit` do Nest nesta versão (comportamento de roteamento RMQ), o sintoma é "consumer conecta mas não processa" → **sinal de alerta** para o WP-08 (verificar pattern no header da mensagem, RFC §7.2) e para o PRD §8 cenário A. Não improvisar roteamento customizado sem reportar.

---

### WP-08 — Consumer: handler com propagação de contexto e spans

| Campo | Valor |
|---|---|
| **Wave / Marco** | D / R3 |
| **Agente** | `agent-consumer` |
| **Duração** | ~1h15 |
| **Depende de** | WP-07 |
| **Bloqueia** | WP-09, WP-11 |
| **Requisito servido** | FR-009, FR-010, FR-011, FR-012, FR-013, FR-014, FR-015, FR-016, FR-017 |

**Objetivo:** O handler `@EventPattern('order.created')` processa o pedido, **extrai o contexto de trace dos headers** (D-007) e cria o span `handleOrderCreated` — este é o WP que fecha a continuidade do trace e materializa o coração do produto.

**Arquivos:** `consumer/src/tracing/extract-trace-context.ts` (F-29), `consumer/src/order.consumer.ts` (F-28), atualizar `consumer/src/app.module.ts` (registrar o `OrderConsumer` — já é seu).

**Passos:**
1. `extract-trace-context.ts` — função **pura** (sem Nest) conforme contrato RFC §7.6:
   ```ts
   export function extractTraceHeaders(source: unknown): Record<string, string>
   ```
   - Tentar `source.headers` → `source.properties?.headers` → `{}`.
   - Só valores `string`; chaves aceitas: `traceparent`, `tracestate`, `baggage`, `ot-tracer-*`.
   - Se não houver `traceparent`, `Logger.warn` **uma única vez** (flag de módulo) e retornar `{}` — o processamento segue (D-020).
2. `order.consumer.ts`:
   - `tracer = trace.getTracer('consumer-service')`; `Logger(OrderConsumer.name)`.
   - `@Controller()` + `@EventPattern('order.created')` com assinatura `handleOrderCreated(@Payload() order: Order, @Ctx() ctx: RmqContext)`.
   - Corpo: extrair headers de `ctx.getMessage()`; `const parent = propagation.extract(ROOT_CONTEXT, headers)`; `return context.with(parent, () => this.process(order))` (D-007).
   - `process(order)` (D-019): `const span = this.tracer.startSpan('handleOrderCreated')`; `span.setAttributes({ 'order.id', 'order.customer_id', 'order.amount', 'messaging.system': 'rabbitmq', 'messaging.operation.type': 'process' })`; `span.addEvent('order_received', {...})`; log `Processing order: <id>`; **`SIMULATE_FAILURE_RATE`** (D-021): se `Math.random() < rate`, lançar `Error('Falha simulada ao processar o pedido <id>')`; simular processamento `await sleep(500)`; `span.addEvent('order_processed', { 'processing.duration_ms': 500 })`; log `Order <id> processed successfully`; `catch` → `span.recordException`, `span.setStatus({ code: SpanStatusCode.ERROR })`, log `Error processing order <id>:` (**sem** requeue — D-019); `finally { span.end(); }`.
   - Consumir `order` do `@Payload()` (o `pattern` vem no header; o `data` é o `Order` — RFC §7.2).
3. `app.module.ts`: `controllers: [OrderConsumer]`.
4. `typecheck` + `build`.
5. **Teste integrado manual:** producer e consumer no ar → `POST /orders` → observar: (a) log `Processing order: ORD-...`; (b) na UI do Jaeger, o trace do pedido **inclui `handleOrderCreated` do consumer**; (c) `trace_id` **igual** ao do `createOrder` (forma A do RFC §7.4). Colar a evidência (trace id + captura) no handoff.
6. **Teste de erro:** subir o consumer com `SIMULATE_FAILURE_RATE=1` → `POST /orders` → span do consumer com `status=ERROR` + exceção registrada; enviar **outro** pedido e confirmar que o consumer segue vivo (FR-011 / cenário B).

**DoD:**
- [ ] FR-009, FR-010, FR-011, FR-012 verificados por execução.
- [ ] `handleOrderCreated` aparece no **mesmo** `trace_id` do `createOrder` (forma A) — evidência colada.
- [ ] Span com atributos `order.id` (pesquisável — FR-016) e eventos `order_received`/`order_processed`.
- [ ] Simulação de erro gera `recordException` + status ERROR sem derrubar o consumer.
- [ ] `typecheck` + `build` limpos.
- [ ] Handoff §8 com a evidência do trace (trace id, nº de spans, serviços).

**Riscos (R-03, R-04 — o principal):** se o `traceparent` não chegar ao helper (headers ausentes no `RmqRecord` desta versão do Nest):
1. Confirmar o sintoma: warning `headers não encontrados` no log do consumer.
2. **Não** mudar o contrato do RFC. Reportar (§8.1) e aplicar a **contingência** do plano de resgate (WP-09 §"Plano de Resgate", passo R2) — que já está pré-aprovada por este plano.
3. Registrar a contingência aplicada em RFC §12.1 (R-04) como nova decisão.

---

### WP-09 — Verificação E2E e plano de resgate (MARCO CRÍTICO)

| Campo | Valor |
|---|---|
| **Wave / Marco** | E / R3 |
| **Agente** | `agent-verify` |
| **Duração** | ~1h30 |
| **Depende de** | WP-05, WP-08 |
| **Bloqueia** | release |
| **Requisito servido** | FR-013, FR-020, FR-014, FR-016, FR-019, NFR-002, NFR-003 |

**Objetivo:** Transformar "parece que funciona" em **prova automatizada** de que o trace atravessa os dois serviços (aceite principal do produto, PRD §10.5), mais os cenários de resiliência.

**Arquivos:** `scripts/verify-trace.mjs` (F-30), e **correções** em `producer/src/*` e `consumer/src/*` **apenas se** o script revelar violação de contrato (com novo handoff).

**Passos — o script (`verify-trace.mjs`, D-022, contrato RFC §10):**
1. `POST http://localhost:3001/orders` com payload fixo válido; exigir `201`; extrair `id`.
2. Poll `GET http://localhost:16686/api/traces?service=consumer-service&lookback=2h&limit=50` a cada 2s, até 60s.
3. Encontrar o trace cujo algum span tenha atributo `order.id === id`; capturar `traceID`.
4. `GET http://localhost:16686/api/traces/<traceID>`: exigir presença de `producer-service` **e** `consumer-service` em `data[0].processes`.
5. Verificar presença dos spans `createOrder` e `handleOrderCreated` e dos spans de `amqplib` (FR-014/017).
6. Saída: resumo (trace id, nº de spans, serviços, duração) + `exit 0`; em falha: mensagem com **qual** checagem falhou + pista do runbook RFC §8.3 + `exit 1`.
7. `make verify` chama `node scripts/verify-trace.mjs`.

**Passos — cenários de validação (PRD §8), registrando evidências:**
- **Cenário A (sucesso):** `make verify` exit 0.
- **Cenário B (erro):** `SIMULATE_FAILURE_RATE=1` no consumer → span ERROR; consumer segue vivo (segundo pedido OK).
- **Cenário C (telemetria fora):** `docker compose stop otel-collector jaeger` → `POST /orders` 201 + `/health` 200 + consumidor processa → religar. (NFR-002)
- **Cenário D (fan-out):** 3 pedidos → 3 `trace_id` distintos, cada um com os 2 serviços.
- **Cenário F (shutdown com flush):** spans das últimas operações aparecem no Jaeger após `SIGINT`.
- **Gate de qualidade:** `make typecheck` + `make build` limpos (NFR-003); `npm ci` funciona nos 2 serviços (NFR-006).

**Plano de Resgate (se o trace não cruzar — R-03/R-04):**

| Passo | Ação | Quando |
|---|---|---|
| **R1 — Diagnóstico** | `docker compose logs otel-collector` mostra receipt? Exportador com erro (`OTEL_LOG_LEVEL=debug`)? Endpoint com `/v1/traces/v1/traces` (D-010)? Inspecionar a mensagem no RabbitMQ UI: `traceparent` presente? | Sempre, primeiro passo |
| **R2 — Extração manual (preferida)** | Se o header existe mas o helper não acha: em `extractTraceHeaders`, aceitar também a forma do `RmqRecord` desta versão do Nest (ex.: campos no topo do record) — **dentro do contrato da RFC §7.6**, que já prevê 3 formatos. | Header existe + contexto não aplicado |
| **R3 — Contorno no consumidor** | Se o `RmqRecord` realmente não expõe headers: injetar `RmqContext.getChannelRef()` e, em vez do roteamento padrão, usar `channel.consume` cru com `propagation.extract` sobre `msg.properties.headers` dentro do `context.with`. Atualizar RFC §7.6 e §3 (nova decisão) e o contrato do módulo. | Headers inacessíveis pelo `RmqRecord` |
| **R4 — Contorno no produtor** | Se o produtor não estiver injetando `traceparent` (instrumentação amqplib não hooking): injetar manualmente com `propagation.inject(context.active(), headers)` antes do `emit`, via um provider com acesso ao canal AMQP. Atualizar RFC §3. | `traceparent` ausente na mensagem |
| **R5 — Verificar ordem de import** | Confirmar `import './tracing'` como 1ª linha e `sdk.start()` antes de `@nestjs/microservices` ser carregado (D-004). | Nenhum span de amqplib |

> Regras do resgate: (a) sempre começar em R1; (b) cada R2..R5 só é aplicado se o anterior for insuficiente; (c) **toda** aplicação de R2..R5 exige atualização do RFC (nova linha em §3 ou §12.1) e novo handoff; (d) nunca reduzir o escopo do script de verificação para "passar".

**DoD:**
- [ ] `make verify` exit 0 do zero (cenário A), com saída legível.
- [ ] Cenários B, C, D, F executados e evidenciados.
- [ ] `make typecheck` + `make build` + `npm ci` OK.
- [ ] Se houve resgate: RFC atualizado e deviations registradas (não silenciosas).
- [ ] Handoff §8 (é o handoff mais importante da release: contém as evidências do aceite principal).

**Riscos:** é o WP onde os riscos R-02/R-03/R-04 se manifestam. O plano de resgate existe para isso — não entrar em pânico, seguir R1..R5 na ordem.

---

### WP-10 — Configuração documentada e documentação

| Campo | Valor |
|---|---|
| **Wave / Marco** | F / R4 |
| **Agente** | `agent-docs` |
| **Duração** | ~1h |
| **Depende de** | WP-09 |
| **Requisito servido** | FR-021, FR-023, NFR-005, NFR-007, NFR-009 |

**Objetivo:** Qualquer pessoa sai do zero até o trace no Jaeger lendo o README; todas as envs documentadas; nenhum segredo no repo.

**Arquivos:** `producer/.env.example` (F-31), `consumer/.env.example` (F-32), `producer/README.md` (F-33), `consumer/README.md` (F-34), `README.md` (F-35).

**Passos:**
1. `.env.example` (um por serviço): todas as envs do RFC §5.2 relevantes ao serviço, com valor de exemplo = default de dev e comentário de uma linha explicando o propósito.
2. `README.md` raiz: título + resumo; **pré-requisitos** (Node ≥ 18, Docker, Docker Compose v2); **quickstart em 5 passos** (`make infra-up`, `make install`, `make dev-producer`, `make dev-consumer`, `POST /orders` + abrir `http://localhost:16686`); **o que observar** (trace único, spans, latência); **arquitetura** (diagrama ASCII do RFC §4.1); **contrato da API** (tabela do RFC §7.5); **explicação da propagação de contexto** (`traceparent` W3C) em 1 parágrafo + bloco de exemplo; **comandos** (tabela do Makefile); **variáveis de ambiente** (tabela do RFC §5.2); **troubleshooting** (runbook RFC §8.3 + itens específicos de "traces não aparecem" e "spans não vinculados"); **desvios do material** (RFC §3.1) — Transparency.
3. READMEs de serviço: papel do serviço, envs, scripts, exemplo de request/response, troubleshooting próprio, como ver seus spans.
4. Passagem final de consistência (NFR-010): cada comando/porta/rota/env citado existe no código (conferir contra `Makefile`, `config.ts`, controllers).
5. `make help` conferido; nenhum comando "inventado" no README.

**DoD:**
- [ ] Seguindo **apenas** o README, do clone limpo até o trace na UI funciona (teste real, não revisão) — M6.
- [ ] Todas as envs dos serviços aparecem em `.env.example` e no README correspondente.
- [ ] Nenhum segredo no repo (NFR-005); `guest:guest` descrito como padrão de dev.
- [ ] Nenhuma instrução do README é inexistente no código.
- [ ] Desvios do material visíveis no README.
- [ ] Handoff §8.

**Riscos:** README que descreve uma versão anterior do código → mitigate com o teste do DoD (execução real, passo a passo).

---

### WP-11 — Testes unitários do helper (Should)

| Campo | Valor |
|---|---|
| **Wave / Marco** | F / R4 |
| **Agente** | `agent-tests` (paralelizável com WP-10) |
| **Duração** | ~45min |
| **Depende de** | WP-08 |
| **Requisito servido** | FR-024, NFR-003 |

**Objetivo:** Provar a lógica de extração de headers de forma determinística, sem subir broker/collector.

**Arquivos:** `consumer/test/trace-context.spec.ts` (F-36) + setup mínimo de teste no `consumer/package.json` (script `test`).

**Passos:**
1. Adicionar devDeps: `jest@29`, `ts-jest@29`, `@types/jest@29`; script `"test": "jest"`. Config Jest inline no `package.json` (roots `src`, `test`, preset `ts-jest`) ou `jest.config.js` — **1 arquivo novo apenas** (manter o inventário fechado; se criar `jest.config.js`, registrar como F-37 no RFC).
2. Testes de `extractTraceHeaders`: (a) `{ headers: { traceparent: '00-...' } }` → devolve `traceparent`; (b) `{ properties: { headers: {...} } }` → idem; (c) entrada sem headers → `{}` sem lançar; (d) valores não-string são ignorados; (e) `ot-tracer-*` e `baggage` preservados.
3. Rodar `npm test` (consumer) e `make test`.

**DoD:** [ ] `npm test` no consumer verde com ≥ 5 casos. [ ] `make test` verde. [ ] Nenhuma dependência de rede/broker nos testes. [ ] Handoff §8.

**Riscos:** nenhum. (Se `jest`/`ts-jest` conflitar com TS 5.3 → usar `ts-jest` ^29.1; registrar).

---

### WP-12 — Opcional: containerizar os serviços (Could)

| Campo | Valor |
|---|---|
| **Wave / Marco** | F (pós-release) |
| **Agente** | `agent-infra` |
| **Duração** | ~1h |
| **Depende de** | WP-09 |
| **Requisito servido** | B-5 (backlog) |

**Objetivo:** Opção de rodar producer/consumer em containers no mesmo Compose (paridade closer dev/prod).

**Passos:**
1. `Dockerfile` multi-stage por serviço (build com `node:20`, runtime `node:20-alpine`).
2. Serviços `producer`/`consumer` no Compose com `profiles: [app]`; envs com hosts de rede do Compose (`RABBITMQ_URL=amqp://guest:guest@rabbitmq:5672`, `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://otel-collector:4318/v1/traces` — RFC §12.4).
3. `make verify` passa em modo container.

**DoD:** [ ] `docker compose --profile app up` sobe tudo e `make verify` passa. [ ] Nenhuma mudança no modo host (padrão). [ ] RFC §12.4 atualizado. [ ] Handoff §8.

**Riscos:** muda a dinâmica de portas/rede; **fora** do aceite da v1. Não iniciar sem o aceite da release principal (PRD §10) fechado.

---

### WP-13 — v1.1: DLQ + retry com backoff + idempotência (backlog §12.2 #2, RFC D-026..D-031)

| Campo | Valor |
|---|---|
| **Wave / Marco** | G (pós-v1) |
| **Agente** | `agent-consumer` (topologia/retry), `agent-tests`, `agent-verify`, `agent-producer` (`noAssert`, D-031) |
| **Duração** | ~3h |
| **Depende de** | v1 fechada (M3) |
| **Requisito servido** | RFC §12.2 #2 (DLQ `orders_queue.dlq` + retry com backoff + idempotência) |

**Objetivo:** falha de processamento não é mais descartada: retries limitados (`MAX_RETRIES`, TTL multiplicativo) e após o teto a mensagem vai ao DLQ; `order.id` duplicado não re-executa.

**Passos:**
1. RFC: ADR D-026..D-031, envs `ORDER_QUEUE_DLQ`/`ORDER_QUEUE_RETRY`/`MAX_RETRIES`/`RETRY_TTL_MS`/`IDEMPOTENCY_TTL_MS`/`IDEMPOTENCY_MAX_ENTRIES`, inventário F-42..F-47, §7.2.1, backlog §12.2 #2 fechado.
2. `consumer/src/queue/dlq.setup.ts` (F-42): declara no boot `dlx` (direct), `orders_queue.dlq`, `orders_queue.retry` (TTL/DLX p/ `orders_queue`) e `orders_queue` com `arguments` de DLX — **owner** único da topologia (D-031).
3. `consumer/src/config.ts` + `rabbitmq.config.ts`: novas envs; `noAck: false`, `defaultRequeue: false`, `queueOptions.arguments` = args de DLX.
4. `consumer/src/retry-policy.ts` (F-44): `nextAttempt(headers)`, `isExhausted(headers, max)`, `retryTtlForAttempt(attempt, base)` — puros.
5. `consumer/src/idempotency.store.ts` (F-43): store in-memory com TTL + evicção FIFO (D-029).
6. `consumer/src/order.consumer.ts`: ack explícito em todos os caminhos (D-030) — sucesso/duplicata → ack; retryável → republish + ack; terminal → `nack(requeue=false)`.
7. `producer/src/rabbitmq.config.ts`: `noAssert: true` (D-031).
8. Testes: `consumer/test/idempotency.store.spec.ts` (F-45) + `consumer/test/retry-policy.spec.ts` (F-46).
9. `scripts/verify-dlq.mjs` (F-47) + alvo `make verify-dlq`: consumer de teste com `SIMULATE_FAILURE_RATE=1`/`MAX_RETRIES=2` → pedido cai em `orders_queue.dlq`; restaura consumer canônico no fim.
10. Docs/README/envs; release notes v1.1.0.

**DoD:** [x] `make typecheck`/`build`/`test` (incl. novos specs) verdes — typecheck/build exit 0; 15/15 testes. [x] `make verify` (M3) continua exit 0 sem mudança de comportamento no caminho feliz (trace `38077f8cf27d7e063a34e5e03d7f7dea`, 12 spans, 2 serviços). [x] `make verify-dlq` exit 0 com evidência de mensagem no DLQ (ORD-1791735784014 → dlq=1, `x-death` 2). [x] `SIMULATE_FAILURE_RATE=1` sem `MAX_RETRIES` (default 3) não derruba o consumer (processo vivo após DLQ — evidência no handoff §8). [x] RFC/RePL atualizados. [x] Handoff §8.

**Riscos:** semântica de TTL por-mensagem à cabeça da fila (uma retry só em dev); producer + consumer no mesmo host precisam do consumer no ar para topologia; duplicidade de `x-retry-count` entre mensagens reiniciadas — mitigado pela evicção FIFO/TTL do idempotency store.

---

### WP-14 — v1.2: Métricas e logs exporters (backlog §12.2 #3, RFC D-032..D-036)

| Campo | Valor |
|---|---|
| **Wave / Marco** | H (pós-v1.1) |
| **Agente** | `agent-producer` (F-08/F-48/F-50), `agent-consumer` (F-21/F-49/F-51), `agent-infra` (`docker/**` e collector D-035), `agent-verify` (`scripts/verify-observability.mjs` F-52), `lead` (RFC/RePL §7.9, §12.2 #3) |
| **Duração** | ~3h |
| **Depende de** | v1.1 fechada (WP-13) |
| **Requisito servido** | RFC §12.2 #3 (métricas `orders_created` + histograma de latência; logs → Loki) |

**Objetivo:** cada serviço passa a exportar **métricas** (`orders.created`, `orders.creation.duration`, `orders.consumed`, `orders.dead_lettered`) via OTLP/HTTP e **logs** (ponte do `LoggerService` do Nest) via OTLP/HTTP; o Collector envia métricas ao exporter prometheus (`:9464`) e logs ao Loki (`:3100`). Backend Prometheus/Grafana fica no backlog §12.2 #7.

**Passos:**
1. RFC/RePL: ADR D-032..D-036, envs `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`/`_LOGS_ENDPOINT`/`OTEL_METRIC_EXPORT_INTERVAL_MS`, inventário F-48..F-52, §6.1 (`loki`) + §6.2 (pipelines), §7.9, §12.2 #3 fechado, seção RePL WP-14.
2. Produtor (F-08): `tracing.ts` ganha `metricReader` (`PeriodicExportingMetricReader`, `OTLPMetricExporter`, interval `OTEL_METRIC_EXPORT_INTERVAL_MS`=3000) e `logRecordProcessor` (`BatchLogRecordProcessor` + `OTLPLogExporter`); endpoints por-sinal com resolução `env específico → base + path → default :4318` (D-032/D-034/D-010).
3. `producer/src/metrics.ts` (F-48): meter `orders.created` (counter) e `orders.creation.duration` (histogram ms) — registrados 1× (D-033); usados em `order.service.ts`.
4. `producer/src/otel-logger.ts` (F-50): `LoggerService` que imprime no console **e** emite `LogRecord` via `@opentelemetry/api-logs` (severidade mapeada, `trace_id`/`span_id` do span ativo); `Logger.overrideLogger` em `main.ts` antes de qualquer log de negócio.
5. Consumer (F-21/F-49/F-51): idem passos 2-4 com `orders.consumed` e `orders.dead_lettered` (em `order.consumer.ts`) e `otel-logger.ts`.
6. `docker/**` (F-04/F-05, D-035): serviço `loki` (`grafana/loki:2.9.6`, `:3100`) no Compose; porta `9464` no `otel-collector`; config com exporters `prometheus` e `loki` + pipelines `metrics`/`logs`.
7. `scripts/verify-observability.mjs` (F-52) + alvo `make verify-observability`: cria pedido, espera ≥2 janelas de export (~8s), asserta `orders_created_total`/histograma em `http://localhost:9464/metrics` e log no Loki (`{job="producer-service"}` — o receiver OTLP do collector 0.97 mapeia `service.name` → label `job`).
8. Docs: `.env.example`, READMEs, release notes v1.2.0.

**DoD:** [x] `make typecheck`/`build`/`test` verdes (sem regressão nos 15 specs). [x] `make verify` (M3) exit 0. [x] `make verify-dlq` exit 0 (regressão WP-13). [x] `make verify-observability` exit 0 com evidência: métrica `orders_created_total ≥ 1` em `:9464/metrics` **e** log do producer no Loki. [x] RFC/RePL atualizados (D-032..D-036, F-48..F-52, §7.9, §12.2 #3). [x] Handoff §8.

**Riscos:** `sdk-node@0.50.0` aceita **um** `metricReader` e **um** `logRecordProcessor` no `NodeSDK` (configuração de múltiplos exige `MeterProvider`/`LoggerProvider` próprios); registro duplicado de instrumento gera série duplicada no `/metrics`; Loki 2.9.6 sozinho **não** faz retenção multi-dia (config local padrão — suficiente p/ dev).

---

### WP-15 — v1.3: Baggage de exemplo (backlog §12.2 #4 / PRD B-4, RFC D-037 + §7.10)

| Campo | Valor |
|---|---|
| **Wave / Marco** | I (pós-v1.2) |
| **Agente** | `agent-producer` (F-53), `agent-consumer` (F-54), `agent-verify` (F-55), `lead` (RFC/RePL §7.10, §12.2 #4) |
| **Duração** | ~1,5h |
| **Depende de** | v1.2 fechada (WP-14) |
| **Requisito servido** | PRD B-4 / RFC §12.2 #4 (baggage `user.id`/`request.id` propagado) |

**Objetivo:** demonstrar o 3º mecanismo de propagação do OTel (W3C Baggage) num transporte **não-HTTP**. O producer injeta `user.id`/`request.id` no contexto do `emit` (a instrumentação de amqplib serializa como header `baggage`); o consumer restaura via `propagation.extract` (D-007) e expõe como atributos `user.id`/`request.id` no span `handleOrderCreated` (D-018 — pesquisável). Prova E2E dedicada.

**Passos:**
1. RFC/RePL: ADR D-037, inventário F-53..F-55, §7.10, §12.2 #4 fechado, PRD B-4 fechado, RePL WP-15 + wave I.
2. `producer/src/baggage.ts` (F-53): `createOrderBaggage(customerId, requestId)` via `propagation.createBaggage`; `newRequestId()` → `REQ-<ts>-<rand4>`.
3. `producer/src/order.service.ts`: cria baggage no `create` e executa o `emit` sob `context.with(setBaggage(...), emit)`.
4. `consumer/src/tracing/read-baggage.ts` (F-54): `readBaggage(ctx)` puro → `{ userId?, requestId? }`.
5. `consumer/src/order.consumer.ts`: lê `getBaggage(context.active())` e seta atributos `user.id`/`request.id` no span `handleOrderCreated` + log `Processing order:` com o usuário.
6. `scripts/verify-baggage.mjs` (F-55) + `make verify-baggage`: POST pedido (`CUST-BAGGAGE`), localiza por `order.id`, asserta `user.id`/`request.id` no span do consumer. Exit 0 = aceite.
7. Testes: `consumer/test/read-baggage.spec.ts` (função pura) + regressão dos 15 specs.
8. Docs: READMEs (baggage no "O que observar"), release notes v1.3.0.

**DoD:** [x] `make typecheck`/`build`/`test` verdes (regressão 15 specs + novo spec). [x] `make verify` (M3) exit 0. [x] `make verify-baggage` exit 0 com evidência: `user.id=CUST-BAGGAGE` e `request.id=REQ-*` no span do consumer. [x] RFC/RePL atualizados (D-037, F-53..F-55, §7.10, §12.2 #4). [x] Handoff §8.

**Riscos:** baggage é **in-memory no contexto** — se o `emit` escapar do `context.with` (ex.: callback divergente) o header não é injetado (mitigação: `emit` dentro do `with`); mensagens antigas na fila sem `baggage` são processadas normalmente (atributos omitidos).

---

## 5. Matriz de Ownership (sem conflitos)

| Arquivo/diretório | WP | Agente | Pode ler (livre) | Regra |
|---|---|---|---|---|
| `Makefile`, `.gitignore`, `.editorconfig` | WP-01 | `agent-setup` | tudo | Agents de outros WPs **sugerem**, não editam |
| `docker/**` | WP-02 | `agent-infra` | RFC §6 | WP-12 (opcional) só com coordenação |
| `producer/package*.json`, `tsconfig*`, `nest-cli.json` | WP-03 | `agent-producer` | RFC §4.3, §5.3 | `npm install` só pelo dono do serviço |
| `producer/src/tracing.ts`, `config.ts`, `rabbitmq.config.ts` | WP-03 | `agent-producer` | RFC §7.1, §7.2 | — |
| `producer/src/main.ts`, `app.module.ts`, `shutdown.ts`, `order.interface.ts`, `health.controller.ts` | WP-04 | `agent-producer` | RFC §7.5, §7.7 | — |
| `producer/src/order.dto.ts`, `order.service.ts`, `order.controller.ts` | WP-05 | `agent-producer` | RFC §7.2, §7.3 | — |
| `consumer/package*.json`, `tsconfig*`, `nest-cli.json` | WP-06 | `agent-consumer` | RFC §4.3, §5.3 | — |
| `consumer/src/tracing.ts`, `config.ts`, `rabbitmq.config.ts` | WP-06 | `agent-consumer` | RFC §7.1 | — |
| `consumer/src/main.ts`, `app.module.ts`, `shutdown.ts`, `order.interface.ts` | WP-07 | `agent-consumer` | RFC §7.7 | — |
| `consumer/src/tracing/extract-trace-context.ts`, `order.consumer.ts` | WP-08 | `agent-consumer` | RFC §7.3, §7.6 | Corregir em WP-09 só com novo handoff |
| `scripts/verify-trace.mjs` | WP-09 | `agent-verify` | PRD §8, RFC §10 | — |
| `producer/.env.example`, `consumer/.env.example`, `**/README.md` | WP-10 | `agent-docs` | RFC §5.2, §8.3 | — |
| `consumer/test/**`, jest config | WP-11 | `agent-tests` | RFC §7.6 | — |
| `PRD.md`, `RFC.md`, `RELEASE_PLAN.md` | (lead) | `lead` | — | **Nenhum** agente edita os 3 docs de contrato sem aprovação do lead |
| `consumer/src/config.ts`, `rabbitmq.config.ts`, `order.consumer.ts`, `consumer/src/queue/dlq.setup.ts`, `consumer/src/idempotency.store.ts`, `consumer/src/retry-policy.ts` | WP-13 | `agent-consumer` | RFC §7.2/§7.3, D-026..D-030 | — |
| `consumer/test/**` (specs de retry/idempotência) | WP-13 | `agent-tests` | RFC §10 | — |
| `scripts/verify-dlq.mjs`, `Makefile` (alvo `verify-dlq`) | WP-13 | `agent-verify`/`agent-setup` | PRD §8, RFC §10 | coordenado |
| `producer/src/rabbitmq.config.ts` (`noAssert`) | WP-13 | `agent-producer` | RFC §7 (D-031) | muda roteamento; handoff obrigatório |
| `producer/src/tracing.ts` (extensão: `metricReader`/`logRecordProcessor`) | WP-14 | `agent-producer` | RFC §7.1/§7.9 (D-032/D-034) | endpoints por-sinal (precedência D-010) |
| `consumer/src/tracing.ts` (extensão) | WP-14 | `agent-consumer` | RFC §7.1/§7.9 (D-032/D-034) | — |
| `producer/src/metrics.ts` (F-48), `producer/src/otel-logger.ts` (F-50) | WP-14 | `agent-producer` | RFC §7.9 (D-033/D-034) | instrumentos registrados 1× |
| `consumer/src/metrics.ts` (F-49), `consumer/src/otel-logger.ts` (F-51) | WP-14 | `agent-consumer` | RFC §7.9 (D-033/D-034) | — |
| `docker/**` (loki :3100, collector :9464, pipelines) | WP-14 | `agent-infra` | RFC §6.1/§6.2 (D-035) | — |
| `scripts/verify-observability.mjs` (F-52), `Makefile` (alvo `verify-observability`) | WP-14 | `agent-verify`/`agent-setup` | PRD §8, RFC §10, D-036 | coordenado |
| `producer/src/baggage.ts` (F-53), extensão de `producer/src/order.service.ts` | WP-15 | `agent-producer` | RFC §7.10 (D-037) | baggage no `emit` só dentro do `context.with` |
| `consumer/src/tracing/read-baggage.ts` (F-54), extensão de `order.consumer.ts` | WP-15 | `agent-consumer` | RFC §7.10 (D-037) | atributos de baixa cardinalidade |
| `scripts/verify-baggage.mjs` (F-55), `Makefile` (alvo `verify-baggage`) | WP-15 | `agent-verify`/`agent-setup` | PRD §8, RFC §10, D-037 | coordenado |
| `consumer/test/read-baggage.spec.ts` | WP-15 | `agent-tests` | RFC §10 | — |

Regras de conflito:
- **Um arquivo, um dono.** Editar arquivo de outro WP exige report (seção 8.1) + aprovação do dono.
- Agent que precisa de mudança fora do seu escopo **não edita**: escreve a solicitação no handoff.
- Os três documentos de contrato (PRD/RFC/RELEASE_PLAN) são **read-only** para os agentes de execução (ver §9).

---

## 6. Definição de Pronto / Pronto por WP

### 6.1 DoD universal (todo WP)

- [ ] Todos os itens do **DoD específico** do WP verificados.
- [ ] `npm run typecheck` e `npm run build` com exit 0 nos serviços tocados (ou `docker compose config` válido para WP-02).
- [ ] Nenhum arquivo fora do inventário canônico (RFC §5.3) sem registro.
- [ ] Nenhuma decisão nova tomada sem registro no RFC (§3) — quando aplicável, com justificativa.
- [ ] Logs follow a convenção do projeto (Logger Nest; sem `console.log` de payload; sem segredo).
- [ ] Handoff (§8) preenchido com evidência **executada** (comando + saída), não descrição.
- [ ] Riscos novos mountados: registrados no handoff e, se alterarem a v1, no RFC §12.1.

### 6.2 Gates por marco

| Marco | Conteúdo | Critério de saída (comprovável) |
|---|---|---|
| **M0** (fim WP-01) | Setup | `make help` funciona; pastas criadas |
| **M1** (fim WP-02) | Infra | 3 containers `Up`; `:15672`, `:16686`, `:13133`, `:4318` respondem (FR-001..003) |
| **M2** (fim WP-05) | Produtor | `POST /orders` 201; 400 em payload inválido; `createOrder` + span amqplib no Jaeger; `traceparent` na mensagem (FR-004..008, 015) |
| **M3** (fim WP-09) | E2E | `make verify` **exit 0** com 2 serviços no mesmo `trace_id`; cenários B, C, D, F evidenciados (PRD §8) — **aceite principal** |
| **M4** (fim WP-10/11) | Qualidade+docs | DoD global do PRD §10 fechado |

### 6.3 Definition of Ready (por WP, antes de iniciar)

- [ ] RFC §3 (decisões aplicáveis) e §7 (contratos) lidos.
- [ ] PRD: FR/NFR do WP conhecidos lidos; critérios de aceitação entendidos.
- [ ] Dependências (WPs anteriores) concluídas e verificadas.
- [ ] Ownership dos arquivos do WP confirmado (§5).
- [ ] Ambiente: Node ≥ 18, Docker, portas livres.

---

## 7. Matriz de Rastreabilidade Plan→Requisito

| WP | Requisitos atendidos | Marco | Wave |
|---|---|---|---|
| WP-01 | FR-022, NFR-005, NFR-010 | M0 | A |
| WP-02 | FR-001, FR-002, FR-003 | M1 | B |
| WP-03 | FR-018, NFR-003, NFR-006, NFR-008 (parcial) | M2 | C |
| WP-04 | FR-007, FR-021, NFR-002 (parcial), NFR-004 | M2 | C |
| WP-05 | FR-004, FR-005, FR-006, FR-008, FR-015, FR-016 | M2 | C |
| WP-06 | FR-018 (consumer), NFR-003, NFR-006 | M3 | D |
| WP-07 | FR-021, NFR-002 (parcial), NFR-004 | M3 | D |
| WP-08 | FR-009..FR-013, FR-014, FR-016, FR-017 | M3 | D |
| WP-09 | FR-013, FR-020, FR-019, NFR-002, NFR-003, NFR-006 | M3 | E |
| WP-10 | FR-021, FR-023, NFR-005, NFR-007, NFR-009, NFR-010 | M4 | F |
| WP-11 | FR-024, NFR-003 | M4 | F |
| WP-12 | (backlog B-5) | pós | F |
| WP-13 | (backlog §12.2 #2) DLQ + retry + idempotência — F-42..F-47 | pós | G |
| WP-14 | (backlog §12.2 #3) Métricas + logs exporters — F-48..F-52, D-032..D-036 | pós | H |
| WP-15 | (backlog §12.2 #4) Baggage de exemplo — F-53..F-55, D-037 | pós | I |

Cobertura: **todos** os FR/NFR Must (PRD §3, §4) estão cobertos por pelo menos um WP Must. Itens Should sem WP (NFR-001, NFR-004 parcial) são medidos no checklist de validação final (§8.2) ou ficam como backlog.

---

## 8. Processo de Trabalho dos Agentes

### 8.1 Template de handoff (obrigatório ao final de cada WP)

```markdown
## Handoff — <WP-id> (<nome>)
**Agente:** <id>  | **Data:** <YYYY-MM-DD>  | **Status:** ✅ concluído | ⚠️ concluído com ressalvas | ❌ bloqueado

### O que foi feito
- <resumo em ≤ 5 bullets, com caminhos de arquivo>

### Arquivos tocados (deve casar com a ownership da §5)
- `caminho/arquivo` — <o que mudou>

### Verificações executadas (comando + resultado real)
1. `<comando>` → exit 0 — <saída resumida>
2. ...

### Critérios de aceitação do PRD
- FR-00x: ✅ / ❌ / N/A — evidência: <...>

### Decisões/desvios
- Nenhum | Registrado em RFC §3 (ID novo: ...) | Registrado em RFC §12.1 (R-xx)

### Riscos / pendências / perguntas
- <riscos, o que ficou abierto, perguntas para o lead — se houver DÚVIDA DE SPEC, foi parar aqui em vez de improvisar>
```

## Handoff — WP-13 (v1.1: DLQ + retry com backoff + idempotência)
**Agente:** lead (coordena `agent-consumer`, `agent-tests`, `agent-verify`, `agent-producer`)  | **Data:** 2026-10-11  | **Status:** ✅ concluído (commit `46a48be`)

### O que foi feito
- `consumer/src/queue/dlq.setup.ts` (F-42): topologia DLX/DLQ/retry no boot (`dlx` direct, `orders_queue.dlq`, `orders_queue.retry`, `orders_queue` com args de DLX); `ensureQueue` recria a fila num canal **novo** quando o broker responde `406` (fila pré-existente sem args não pode ser alterada in-place; o 406 fecha o canal atual).
- `consumer/src/order.consumer.ts`: ack explícito em todos os caminhos (D-030) — sucesso/duplicata → ack; retryável → republica em `orders_queue.retry` (backoff multiplicativo `expiration = RETRY_TTL_MS × tentativa`, `traceparent` preservado) + ack; terminal → `nack(requeue=false)` → DLX/DLQ.
- `consumer/src/retry-policy.ts` (F-44) + `consumer/src/idempotency.store.ts` (F-43) + `consumer/src/config.ts` (envs `ORDER_QUEUE_DLQ`/`ORDER_QUEUE_RETRY`/`MAX_RETRIES`/`RETRY_TTL_MS`/`IDEMPOTENCY_TTL_MS`/`IDEMPOTENCY_MAX_ENTRIES`) + `consumer/src/rabbitmq.config.ts` (`noAck: false`).
- `producer/src/rabbitmq.config.ts`: `queueOptions: { noAssert: true }` (D-031 — produtor não declara fila; topologia é do consumer).
- `scripts/verify-dlq.mjs` (F-47) + alvo `make verify-dlq`; testes `consumer/test/idempotency.store.spec.ts` + `retry-policy.spec.ts`.
- Docs: RFC D-026..D-031 + §7.2.1 + inventário F-42..F-47 + backlog §12.2 #2 fechado; RELEASE_PLAN WP-13; READMEs; `.env.example`; RELEASE_NOTES v1.1.0.

### Arquivos tocados (casando com a ownership §5)
- `consumer/src/queue/dlq.setup.ts`, `idempotency.store.ts`, `retry-policy.ts`, `order.consumer.ts`, `config.ts`, `rabbitmq.config.ts`, `main.ts`, `consumer/test/*` — `agent-consumer`/`agent-tests`
- `scripts/verify-dlq.mjs`, `Makefile` — `agent-verify`/`agent-setup`
- `producer/src/rabbitmq.config.ts` — `agent-producer`
- `docs/RFC.md`, `docs/RELEASE_PLAN.md`, `README.md`, `consumer/README.md`, `producer/README.md`, `consumer/.env.example`, `RELEASE_NOTES.md` — lead/`agent-docs`

### Verificações executadas (comando + resultado real)
1. `make typecheck` → exit 0; `make build` → exit 0 (os 2 serviços)
2. `make test` → 15/15 passed (3 suites: idempotency, retry-policy, extração)
3. `make verify` → exit 0 — trace `38077f8cf27d7e063a34e5e03d7f7dea`, 12 spans, producer+consumer (M3 intacto)
4. `make verify-dlq` → exit 0 — ORD-1791735784014: tentativas 3 (retries 2), `orders_queue.dlq`=1, `x-death` 2, trace contínuo
5. DoD (default `MAX_RETRIES=3`): `SIMULATE_FAILURE_RATE=1 RETRY_TTL_MS=500`, POST 201 → `dlq=1` em ~1s; processo do consumer **vivo após o DLQ** (não derruba)
6. Topologia após redesign: `orders_queue` args=`{x-dead-letter-exchange:"dlx", x-dead-letter-routing-key:"orders_queue"}`, consumers=1

### Critérios de aceitação do PRD
- Backlog §12.2 #2 (pós-v1): ✅ — DLQ/retry/idempotência implementados e provados por `make verify-dlq` (F-47). FR existentes não regredidos (`make verify` exit 0).

### Decisões/desvios
- Registrado em RFC §3: D-026..D-031. **D-026 emendada em WP-13**: o `x-dead-letter-routing-key` da `orders_queue` foi corrigido de `orders_queue.dlq` para `orders_queue` (rk original) — a redação original descartava a mensagem em silêncio, pois `dlx` é `direct` e o rk do dead-letter não casava com o binding `dlq ← dlx (rk=orders_queue)`.
- Desvio operacional: `@types/amqplib@0.10.8` adicionado como devDep exata (amqplib não traz types; `connect()` tipa `ChannelModel`, `getChannelRef()` não é genérico).

### Riscos / pendências / perguntas
- TTL avaliado à cabeça da fila (prefetch 1) → somente uma retry em dev por vez (já previsto D-027).
- `orders_queue` pré-v1.1 (sem args) foi **recriada** no boot do WP-13; a mensagem presa de dev foi descartada (D-014 — dados de dev são efêmeros). Aceitável em dev, registrado para alertar em qualquer promoção.
- DLQ/idempotência são in-memory/single-instance; durabilidade multi-instância fica no backlog §12.2 (anotado na RELEASE_NOTES v1.1.0).

## Handoff — WP-14 (v1.2: Métricas + logs exporters)
**Agente:** lead (coordena `agent-producer`, `agent-consumer`, `agent-infra`, `agent-verify`)  | **Data:** 2026-10-11  | **Status:** ✅ concluído

### O que foi feito
- `tracing.ts` (F-08/F-21): `NodeSDK` agora recebe `metricReader` (`PeriodicExportingMetricReader` + `OTLPMetricExporter`, `OTEL_METRIC_EXPORT_INTERVAL_MS` default 3000) e `logRecordProcessor` (`BatchLogRecordProcessor` + `OTLPLogExporter`); resolver de endpoint único por sinal (`traces/metrics/logs`) com precedência D-010/D-032/D-034.
- `producer/src/metrics.ts` (F-48)/`consumer/src/metrics.ts` (F-49): `orders.created` + `orders.creation.duration` (ms) e `orders.consumed` + `orders.dead_lettered` (D-033), registrados 1×.
- `producer/src/otel-logger.ts` (F-50)/`consumer/src/otel-logger.ts` (F-51): `OtelLogger extends ConsoleLogger` — console + `LogRecord` via `@opentelemetry/api-logs`, severidade mapeada, `trace_id`/`span_id` do span ativo (preenchidos pelo sdk-logs). `Logger.overrideLogger(new OtelLogger())` no bootstrap (D-034).
- `docker/docker-compose.yml` + `docker/otel-collector-config.yml` (F-04/F-05, D-035): serviço `loki` (`grafana/loki:2.9.6`, `:3100`), porta `9464` no collector; pipelines `metrics`→prometheus e `logs`→loki.
- `scripts/verify-observability.mjs` (F-52) + alvo `make verify-observability` (D-036).
- `scripts/verify-dlq.mjs`: purga main/retry/dlq antes do teste + leitura resiliente pós-DLX (janela em que a fila reporta a mensagem mas o `/get` ainda devolve vazio).
- Docs: RFC D-032..D-036 + §4.3/§5.2/§5.3/§6.1/§6.2/§7.9/§12.2 #3; RePL WP-14 + ownership + rastreabilidade + §9; READMEs; `.env.example`; RELEASE_NOTES v1.2.0.

### Arquivos tocados (casando com a ownership §5)
- `producer/src/{tracing,metrics,otel-logger,main,order.service}.ts`, `producer/package.json` + lock — `agent-producer`
- `consumer/src/{tracing,metrics,otel-logger,main,order.consumer}.ts`, `consumer/package.json` + lock — `agent-consumer`
- `docker/**` — `agent-infra`
- `scripts/verify-observability.mjs`, `scripts/verify-dlq.mjs`, `Makefile` — `agent-verify`/`agent-setup`
- `docs/RFC.md`, `docs/RELEASE_PLAN.md`, `README.md`, `consumer/README.md`, `producer/README.md`, `.env.example`, `RELEASE_NOTES.md` — lead/`agent-docs`

### Verificações executadas (comando + resultado real)
1. `make typecheck`/`make build` → exit 0 (os 2 serviços); `make test` → 15/15
2. `docker compose config --quiet` → OK (loki + collector `:9464` + pipelines válidos)
3. `make verify` → exit 0 — trace `63b395de5fbf49e94cf804e1095ca434`, 12 spans, producer+consumer (regressão M3 OK)
4. `make verify-observability` → exit 0 — `otel_orders_created_total` ≥ 1 em `:9464/metrics`; histograma `otel_orders_creation_duration_milliseconds_*`; log `"Order <id> created and published"` no Loki `{job="producer-service"}` com `traceid`/`spanid`; também conferido `otel_orders_consumed_total{job="consumer-service"}`
5. `make verify-dlq` → exit 0 — ORD-1791741250461: tentativas 3 (retries 2), `orders_queue.dlq`=1, `x-death` 2; canônico restaurado no fim (pid 394033)

### Critérios de aceitação
- Backlog §12.2 #3 (pós-v1): ✅ — métricas (`orders.created` + histograma) via exporter prometheus do Collector e logs → Loki, provados por `make verify-observability` (D-036/§7.9).

### Decisões/desvios
- RFC §3: D-032..D-036 (novas). Aprendizado operacional em WP-14, registrado nas notas das RELEASE_NOTES v1.2.0: `sdk-metrics` é linha estável (`1.23.0`), demais sinais `0.50.0`; no collector `0.97.0` o `service.name` vira label `job` no Loki e os atributos do LogRecord ficam no corpo JSON da linha (LogQL não aceita `.` em label selector → `{job="..."}`).

### Riscos / pendências / perguntas
- `sdk-node@0.50.0` aceita apenas **um** `metricReader` e **um** `logRecordProcessor` — configurar múltiplos exige `MeterProvider`/`LoggerProvider` próprios (documentado em RePL WP-14. Riscos).
- Métricas são **in-memory no processo** (counter zera no restart — comportamento esperado para a v1.2; série persistente é papel do Prometheus, backlog #7).
- Loki 2.9.6 com config local (`local-config.yaml`) não impõe retenção multi-dia — suficiente para dev.
- `make verify-dlq` agora purga as filas no início (determinístico); o `-dlq` é o único alvo que altera o estado do broker.

## Handoff — WP-15 (v1.3: Baggage de exemplo `user.id`/`request.id`)
**Agente:** lead (coordena `agent-producer`, `agent-consumer`, `agent-tests`, `agent-verify`)  | **Data:** 2026-10-12  | **Status:** ✅ concluído

### O que foi feito
- `producer/src/baggage.ts` (F-53): `createOrderBaggage(customerId, requestId)` via `propagation.createBaggage` + `newRequestId()` (`REQ-<ts>-<rand4>`).
- `producer/src/order.service.ts`: o `emit` roda sob `context.with(propagation.setBaggage(context.active(), baggage), emit)` — a instrumentação de amqplib injeta o header `baggage` junto do `traceparent` (D-006, propagador composto default `OTEL_PROPAGATORS`).
- `consumer/src/tracing/read-baggage.ts` (F-54): função pura `readBaggage(ctx)` → `{ userId?, requestId? }` (mapeia `user.id`/`request.id`).
- `consumer/src/order.consumer.ts`: atributos `user.id`/`request.id` no span `handleOrderCreated` (D-018 — pesquisável) + log `Processing order: ... (user: ...)`. Mensagens sem baggage seguem normais (atributos omitidos).
- `consumer/test/read-baggage.spec.ts`: 3 testes (extração, sem baggage, entrada ausente).
- `scripts/verify-baggage.mjs` (F-55) + alvo `make verify-baggage` (D-037).
- Docs: RFC D-037 + §7.10 + F-53..F-55 + §12.2 #4 fechado; PRD B-4 fechado; RePL WP-15 + wave I + ownership + rastreabilidade + §9; READMEs; RELEASE_NOTES v1.3.0.

### Arquivos tocados (casando com a ownership §5)
- `producer/src/baggage.ts`, `producer/src/order.service.ts` — `agent-producer`
- `consumer/src/tracing/read-baggage.ts`, `consumer/src/order.consumer.ts` — `agent-consumer`
- `consumer/test/read-baggage.spec.ts` — `agent-tests`
- `scripts/verify-baggage.mjs`, `Makefile` — `agent-verify`/`agent-setup`
- `docs/RFC.md`, `docs/RELEASE_PLAN.md`, `docs/PRD.md`, `README.md`, `producer/README.md`, `consumer/README.md`, `RELEASE_NOTES.md` — lead/`agent-docs`

### Verificações executadas (comando + resultado real)
1. `make typecheck`/`make build` → exit 0 (os 2 serviços)
2. `make test` → **18/18** passed (15 existentes + 3 novos de `read-baggage`)
3. `make verify-baggage` → exit 0 — trace `0f608fdc504620b44d615224ec5fc7e2`: `user.id=CUST-BAGGAGE`, `request.id=REQ-1791804467103-275a` no span `handleOrderCreated` do consumer
4. `make verify` → exit 0 — trace `0c16ddbdf30d0a7e8e1824e2cae51d6f`, 13 spans, 2 serviços (M3 intacto)
5. `make verify-dlq` → exit 0 — ORD-1791804486541: 3 tentativas/2 retries, DLQ com `x-death`, canônico restaurado (pid 48550)
6. `make verify-observability` → exit 0 — `orders_created_total` ≥ 1 em `:9464` + log no Loki

### Critérios de aceitação
- Backlog §12.2 #4 (PRD B-4): ✅ — baggage `user.id`/`request.id` cruzou producer → consumer no transporte RabbitMQ, provado por `make verify-baggage` (D-037/F-55).

### Decisões/desvios
- RFC §3: **D-037** (nova). `@opentelemetry/api@1.9.0` expõe baggage apenas por `propagation.createBaggage`/`setBaggage`/`getBaggage` (não são exports de topo) — registrado nas RELEASE_NOTES v1.3.0.
- Sem novas envs: baggage é contexto in-memory, não configuração.

### Riscos / pendências / perguntas
- Baggage só é injetado se o `emit` rodar dentro do `context.with` (mitigação documentada em D-037).
- Baggage não aparece nos `LogRecord`s (atributos ausentes) — só nos traces; se o requisito evoluir para log enriquecido, exigirá novo consumo via `getBaggage` no `otel-logger.ts` (fora do escopo WP-15).

### 8.2 Checklist de validação final (executado pelo lead antes de fechar a release)

- [x] DoD global do PRD §10: 8/8 itens (63) — WPs Must com DoD executado; desvios formais D-024/D-025/F-37..41; docs coerentes com o código; sem pendência Must.
- [x] `make verify` exit 0 (aceite principal) — modo host, modo container (perfil `app`) e clean clone.
- [x] Cenários A, B, C, D, E, F, G (PRD §8) com evidência — A: `make verify`; B: `SIMULATE_FAILURE_RATE=1` (ERROR + `recordException`, consumer vivo); C: telemetria parada (201 + `/health` 200); D: fan-out (3 traces × 2 serviços); E: payload inválido → 400 sem publish; F: `SIGINT` com flush do trace; G: prova automatizada (`verify-trace.mjs`).
- [x] `make typecheck` + `make build` limpos; `npm ci` OK (os 2 serviços, com `legacy-peer-deps`).
- [x] Sobrevivência do clone limpo: seguir README do zero (M6) — `git clone` → `make install` → `make typecheck`/`make build` → `make verify` exit 0 (trace `c6b9d354a878888be48cd51475a50a72`, 13 spans, 2 serviços).
- [x] NFR-001 (overhead ≤ 5%): **diferido ao backlog B-6** (medição de carga não automatizada na v1).
- [x] Nenhuma "pendência Must" aberta; Shoulds abertos listados como dívida técnica (§9).

### 8.3 Regras de collaboration (não-negociáveis)

1. **Spec antes de código:** nenhum arquivo é escrito sem o contrato do RFC correspondente lido.
2. **Ownership rígido:** um arquivo, um dono (§5).
3. **Sem improviso em decisão:** dúvida → §8.1 "Perguntas", não invenção.
4. **Evidência executada:** nenhum item de DoD marcado sem comando executado e saída real.
5. **Contrato é lei:** se a implementação e o RFC divergirem, ganha o RFC — ou o RFC é atualizado **formalmente** (nova decisão com justificativa), nunca em silêncio.
6. **Sem secrets, sem PII, sem `console.log` de payload** (RFC §9, NFR-008).
7. **Portas/hostsAccording ao ambiente:** `localhost` (apps no host, infra em containers — C-03).
8. **Mensagem de shutdown sempre** (D-017): nenhum `process.exit` solto.
9. **Fim de WP = handoff.** Sem handoff, o WP não está concluído.

---

## 9. Dívida técnica e itens em aberto (registro vivo)

Ao fim da v1, TODOS os itens abaixo devem estar marcados `[x] fechado`, `[→] backlog` (com destino) ou `[!] bloqueado` (com motivo):

- [x] `[x fechado]` NFR-001 (overhead ≤ 5%): medição de carga não é automatizada; destino = backlog B-6 (viability não medida na v1).
- [x] `[x fechado]` R-05: tag do OTel Collector **validada como `0.97.0`** (WP-02) — nenhum erro de config; mantida no Compose e no RFC §4.3.
- [x] `[x fechado]` R-16: reconexão AMQP em dev pode causar `emit` falhar logo após boot; documentado no troubleshooting do `producer/README.md`.
- [→] `[→ backlog]` NFR-004 (boot ≤ 10s): medido informalmente (produtor ~2s e consumidor ~1s localmente); destino = opcional automatizar no `verify`.
- [x] `[x fechado]` Nenhum `⚠️` aberto nos handoffs da v1.
- [x] `[x fechado]` `jest.config.js`: **não criado** — config jest embutida no `consumer/package.json` (inventário fechado).
- [x] `[x fechado]` Resgate do WP-09 (R2..R5): **não aplicado** — o trace cruzou os 2 serviços em forma A (ver handoff WP-09); descobertas registradas como D-024/D-025 no RFC §3.
- [x] `[x fechado]` Backlog RFC §12.2 item 2 (DLQ + retry com backoff + idempotência): implementado em **WP-13/v1.1** (D-026..D-031) — `make verify-dlq` exit 0.
- [x] `[x fechado]` Backlog RFC §12.2 item 3 (métricas + logs exporters): implementado em **WP-14/v1.2** (D-032..D-036) — `make verify-observability` exit 0.
- [x] `[x fechado]` Backlog RFC §12.2 item 4 / PRD B-4 (baggage de exemplo `user.id`/`request.id`): implementado em **WP-15/v1.3** (D-037) — `make verify-baggage` exit 0.

---

## 10. Release Notes (modelo para a v1.0.0)

```markdown
# v1.0.0 — Rastreamento Distribuído (OpenTelemetry + RabbitMQ + NestJS)

## Incluído
- Producer NestJS (HTTP :3001) com POST/GET /orders e /health, publishes em orders_queue.
- Consumer NestJS (microservice) com propagação de contexto e spans de negócio.
- Infra: RabbitMQ 3.12 + OTel Collector (OTLP) + Jaeger via `docker compose`.
- Tracing: instrumentação automática (http, amqplib) + spans manuais (createOrder, handleOrderCreated).
- Verificação automatizada: `make verify` comprova trace único atravessando os 2 serviços.
- Documentação: README raiz + 2 READMEs de serviço + .env.example.

## Verificação (aceite principal)
- `make verify` → exit 0: trace <id> com producer-service e consumer-service.

## Limitações conhecidas (v1)
- Sem persistência, sem DLQ/retry, sem métricas/logs exporters, sem auth, sem CI/CD.
- IDs de pedido não são colision-safe sob alta concorrência.
- See RFC.md §12.2 (backlog) e RELEASE_PLAN.md §9 (dívida técnica).
```

---

**Fim do REL-001 v1.0.0.** Ordem canônica de execução: **WP-01 → WP-02 → (WP-03→04→05 ∥ WP-06→07→08) → WP-09 → (WP-10 ∥ WP-11) → release**.
O aceite do produto é o **M3** (`make verify` exit 0 com trace único nos 2 serviços). Se algo atrasar, preserve o M3: ele é o que prova o valor do projeto.
