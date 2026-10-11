# Makefile — entrada única de comandos operacionais (D-022 / F-01)
# Uso: `make help` lista os alvos disponíveis.

COMPOSE = docker compose -f docker/docker-compose.yml

.DEFAULT_GOAL := help
.PHONY: help infra-up infra-down infra-logs install build typecheck \
        dev-producer dev-consumer start-producer start-consumer \
        smoke verify test clean

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

test: ## Roda os testes unitários disponíveis
	cd consumer && npm test

clean: ## Remove artefatos de build dos serviços
	cd producer && npm run clean
	cd consumer && npm run clean
