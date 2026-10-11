# Makefile — entrada única de comandos operacionais (D-022 / F-01)
# Uso: `make help` lista os alvos disponíveis.

COMPOSE = docker compose -f docker/docker-compose.yml

.DEFAULT_GOAL := help
.PHONY: help infra-up infra-down infra-logs install build typecheck \
        dev-producer dev-consumer start-producer start-consumer \
        smoke verify verify-dlq verify-observability test clean

help: ## Lista os alvos disponíveis
	@echo "Alvos disponíveis:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

infra-up: ## Sobe RabbitMQ, Jaeger e OTel Collector
	$(COMPOSE) up -d

infra-down: ## Derruba a infraestrutura
	$(COMPOSE) down

infra-logs: ## Acompanha os logs da infraestrutura
	$(COMPOSE) logs -f

install: ## Instala as dependências dos serviços (npm ci / npm install)
	@if [ -f producer/package-lock.json ]; then cd producer && npm ci; else cd producer && npm install; fi
	@if [ -f consumer/package-lock.json ]; then cd consumer && npm ci; else cd consumer && npm install; fi

build: ## Compila os dois serviços
	cd producer && npm run build
	cd consumer && npm run build

typecheck: ## Checa tipos nos dois serviços
	cd producer && npm run typecheck
	cd consumer && npm run typecheck

dev-producer: ## Sobe o producer em modo watch
	cd producer && npm run dev

dev-consumer: ## Sobe o consumer em modo watch
	cd consumer && npm run dev

start-producer: ## Roda o producer compilado
	cd producer && npm run start

start-consumer: ## Roda o consumer compilado
	cd consumer && npm run start

smoke: ## Testa os endpoints HTTP do producer
	@echo "GET /health"; curl -s -o /dev/null -w '  status=%{http_code}\n' http://localhost:3001/health
	@echo "POST /orders"; curl -s -o /dev/null -w '  status=%{http_code}\n' -X POST http://localhost:3001/orders -H 'Content-Type: application/json' -d '{"customerId":"CUST-001","amount":100.50,"items":["item1","item2"]}'
	@echo "GET /orders"; curl -s -o /dev/null -w '  status=%{http_code}\n' http://localhost:3001/orders

verify: ## Prova que o trace cruza os dois serviços (E2E)
	node scripts/verify-trace.mjs

verify-dlq: ## Prova DLQ: falha -> retries com backoff -> mensagem em orders_queue.dlq (E2E)
	@echo "[verify-dlq] (1/5) pausando o consumer canônico..."
	@kill -INT $$(cat /tmp/consumer.pid 2>/dev/null) 2>/dev/null || true; sleep 2
	@echo "[verify-dlq] (2/5) subindo consumer de TESTE (SIMULATE_FAILURE_RATE=1, MAX_RETRIES=2, RETRY_TTL_MS=1000)..."
	@cd consumer && SIMULATE_FAILURE_RATE=1 MAX_RETRIES=2 RETRY_TTL_MS=1000 nohup node dist/main.js >> /tmp/verify-dlq-consumer.log 2>&1 & echo $$! > /tmp/verify-dlq-consumer.pid
	@sleep 6
	@node scripts/verify-dlq.mjs; status=$$?; \
		echo "[verify-dlq] (4/5) restaurando o consumer canônico..."; \
		kill -INT $$(cat /tmp/verify-dlq-consumer.pid 2>/dev/null) 2>/dev/null || true; rm -f /tmp/verify-dlq-consumer.pid; sleep 2; \
		cd consumer && nohup node dist/main.js >> /tmp/consumer.log 2>&1 & echo $$! > /tmp/consumer.pid; sleep 6; \
		echo "[verify-dlq] (5/5) consumer canônico de volta (pid $$(cat /tmp/consumer.pid))"; \
		exit $$status

verify-observability: ## Prova métricas (:9464) + logs (Loki :3100) — E2E
	node scripts/verify-observability.mjs

test: ## Roda os testes unitários disponíveis
	cd consumer && npm test

clean: ## Remove artefatos de build dos serviços
	cd producer && npm run clean
	cd consumer && npm run clean
