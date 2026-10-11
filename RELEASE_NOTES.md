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

## Limitações conhecidas (v1)
- Sem persistência, sem DLQ/retry, sem métricas/logs exporters, sem auth, sem CI/CD.
- IDs de pedido não são collision-safe sob alta concorrência (D-016).
- Consulta ao Jaeger no `make verify` assume API estável e tolera eventual coalescing de spans.
- Ver `docs/RFC.md` §12.2 (backlog) e `docs/RELEASE_PLAN.md` §9 (dívida técnica).