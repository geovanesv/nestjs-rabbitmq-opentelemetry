# producer-service

Serviço **NestJS HTTP** que cria pedidos e publica o evento `order.created` na fila `orders_queue` do RabbitMQ. Totalmente instrumentado com OpenTelemetry (span manual `createOrder` + instrumentação automática de HTTP e `amqplib`).

Papel na arquitetura: ver [`README.md`](../README.md) e [`docs/RFC.md`](../docs/RFC.md).

## Requisitos

- Node.js >= 18
- Infra no ar: `make infra-up` (na raiz do repositório)

## Variáveis de ambiente

Todas opcionais (defaults de dev). Ver `.env.example`:

| Variável | Default | Uso |
|---|---|---|
| `PORT` | `3001` | Porta HTTP |
| `RABBITMQ_URL` | `amqp://guest:guest@localhost:5672` | Conexão AMQP |
| `ORDER_QUEUE` | `orders_queue` | Nome da fila |
| `OTEL_SERVICE_NAME` | `producer-service` | `service.name` no OTel |
| `SERVICE_VERSION` | `1.0.0` | `service.version` |
| `NODE_ENV` | `development` | `deployment.environment` |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | — | Endpoint OTLP de traces (prev. 1 — D-010) |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | — | Endpoint OTLP de métricas (prev. 1 — D-032) |
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | — | Endpoint OTLP de logs (prev. 1 — D-034) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — | Endpoint base OTLP (prev. 2 — anexa `/v1/{traces,metrics,logs}`) |
| `OTEL_METRIC_EXPORT_INTERVAL_MS` | `3000` | Intervalo de exportação de métricas (D-032) |
| `OTEL_TRACES_SAMPLER` | `always_on` | Amostragem |
| `LOG_LEVEL` | `log` | Nível de log do app |
| `OTEL_LOG_LEVEL` | `info` | Nível de log do SDK OTel |

## Scripts

| Comando | Ação |
|---|---|
| `npm run dev` | Sobe em watch (`nest start --watch`) |
| `npm run build` | Compila para `dist/` |
| `npm run start` | Roda o compilado (`node dist/main`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run clean` | Remove `dist/` |

## API

| Método | Rota | Request | Sucesso | Erros |
|---|---|---|---|---|
| `POST` | `/orders` | `CreateOrderDto` | `201` + `Order` | `400` validação |
| `GET` | `/orders` | — | `200` + `Order[]` (mais recente primeiro, máx. 100) | — |
| `GET` | `/orders/:id` | — | `200` + `Order` | `404` `Order <id> not found` |
| `GET` | `/health` | — | `200` `{ status, service, version, uptime }` | — |

### Exemplo de request/response

```bash
curl -X POST http://localhost:3001/orders \
  -H 'Content-Type: application/json' \
  -d '{"customerId":"CUST-001","amount":100.50,"items":["item1","item2"]}'
```

```json
{
  "id": "ORD-1710073800000",
  "customerId": "CUST-001",
  "amount": 100.5,
  "items": ["item1", "item2"],
  "timestamp": "2024-03-10T12:30:00.000Z"
}
```

## Nota sobre a topologia (v1.1)

Desde a v1.1 o producer usa `queueOptions: { noAssert: true }` (D-031): ele **não declara** `orders_queue`. A topologia inteira (a `orders_queue` com args de DLX, o exchange `dlx`, `orders_queue.dlq` e `orders_queue.retry`) é propriedade exclusiva do consumer, criada no seu boot (F-42). Consequência: publicar antes de o consumer estar no ar descarta a mensagem silenciosamente (mesmo comportamento pré-existente da default exchange).

## Como ver os spans deste serviço

1. Abra `http://localhost:16686` (Jaeger).
2. Busque por `service=producer-service`.
3. Abra um trace de `createOrder`: verá o span `POST /orders` (auto), o span manual `createOrder` com eventos `order_created`/`order_sent_to_queue` e o span de publish `orders_queue send` (auto, `amqplib`).

## Métricas e logs (v1.2)

- **Métricas**: `orders.created` (counter) e `orders.creation.duration` (histograma em ms) são exportadas por OTLP para o Collector, que as expõe em `http://localhost:9464/metrics` (prefixo `otel_`, ex. `otel_orders_created_total`). Intervalo de exportação: `OTEL_METRIC_EXPORT_INTERVAL_MS` (default 3000ms).
- **Logs**: a ponte `OtelLogger` (RFC §7.9) imprime no console **e** emite `LogRecord`s via OTLP para o Collector → **Loki** (`http://localhost:3100`). Cada log herdou o `trace_id`/`span_id` do span ativo (evidente na linha JSON do Loki).
- Verificação: `make verify-observability` (raiz do repositório).

## Troubleshooting

| Sintoma | Causa | Ação |
|---|---|---|
| Traces não aparecem | Endpoint OTLP errado (D-010) | `echo $OTEL_EXPORTER_OTLP_ENDPOINT`; conferir `/v1/traces` uma única vez |
| Métricas não aparecem em `:9464` | Endpoint `/v1/metrics` errado ou Collector antigo | `curl http://localhost:9464/metrics`; conferir `/v1/metrics` no `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`; `docker compose up -d` (loki/9464) |
| Logs não chegam no Loki | Endpoint `/v1/logs` errado ou loki fora | `curl http://localhost:3100/ready`; consultar `{job="producer-service"}` no Loki |
| `POST /orders` 500 no primeiro envio em dev | Conexão AMQP ainda conectando (R-16) | O Nest reconecta; repita o request em ~2s |
| `Cannot find module '@opentelemetry/...'` | Deps não instaladas | `npm ci` + `npm run build` |
| Traces não exportados com Collector fora | Infra de telemetria parada | Validação manual: `curl :13133`; aguardar religar |

Detalhes: runbook completo em [`docs/RFC.md` §8.3](../docs/RFC.md).