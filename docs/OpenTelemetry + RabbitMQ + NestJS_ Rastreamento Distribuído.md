# OpenTelemetry + RabbitMQ + NestJS: Rastreamento Distribuído

Este repositório contém um exemplo prático completo de como instrumentar dois microserviços NestJS (produtor e consumidor) para monitorar a comunicação via RabbitMQ usando OpenTelemetry e Jaeger.

## 📋 Conteúdo

- **producer/** - Serviço produtor que cria pedidos e os envia para o RabbitMQ
- **consumer/** - Serviço consumidor que processa pedidos da fila
- **docker/** - Configuração Docker para RabbitMQ, Jaeger e OpenTelemetry Collector
- **MATERIAL.md** - Guia técnico completo com conceitos e implementação passo a passo

## 🚀 Quick Start

### 1. Iniciar Infraestrutura

```bash
cd docker
docker-compose up -d
```

Isso inicia:
- **RabbitMQ** em http://localhost:15672 (guest:guest)
- **Jaeger** em http://localhost:16686
- **OpenTelemetry Collector** em http://localhost:4318

### 2. Instalar Dependências

```bash
# Produtor
cd producer
npm install

# Consumidor (novo terminal)
cd consumer
npm install
```

### 3. Executar Serviços

```bash
# Terminal 1 - Produtor
cd producer
npm run dev

# Terminal 2 - Consumidor
cd consumer
npm run dev
```

### 4. Testar

```bash
# Criar um pedido
curl -X POST http://localhost:3001/orders \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "CUST-001",
    "amount": 100.50,
    "items": ["item1", "item2"]
  }'
```

### 5. Visualizar Traces

Acesse http://localhost:16686 e busque por `producer-service` ou `consumer-service`.

## 📚 Documentação

Veja [MATERIAL.md](./MATERIAL.md) para um guia completo sobre:

- Conceitos de observabilidade e rastreamento distribuído
- Arquitetura da solução
- Implementação passo a passo
- Visualização de traces no Jaeger
- Troubleshooting
- Boas práticas

## 🏗️ Arquitetura

```
┌─────────────────────────────────────────────────────────────┐
│                    Aplicação Produtor                        │
│  POST /orders → OrderService → RabbitMQ                      │
│  (com contexto de trace nos headers)                         │
└─────────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│                      RabbitMQ Queue                           │
│  Mensagem com headers de trace (traceparent, tracestate)     │
└─────────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│                   Aplicação Consumidor                        │
│  Recebe mensagem → Extrai contexto → Processa pedido         │
│  (continua o trace com o mesmo Trace ID)                     │
└─────────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│              OpenTelemetry Collector + Jaeger                │
│  Visualiza toda a jornada da mensagem em um único trace      │
└─────────────────────────────────────────────────────────────┘
```

## 🔑 Conceitos-Chave

### Traces e Spans

- **Trace**: Jornada completa de uma requisição através de múltiplos serviços
- **Span**: Unidade individual de trabalho dentro de um trace

### Propagação de Contexto

O OpenTelemetry injeta automaticamente o contexto nos headers do RabbitMQ:

```
traceparent: 00-abc123def456-def456abc123-01
```

Isso permite que o consumidor continue o trace com o mesmo Trace ID.

### Instrumentação Automática

O `@opentelemetry/instrumentation-amqplib` detecta automaticamente:
- Envio de mensagens
- Recebimento de mensagens
- Conexões com RabbitMQ

Você não precisa modificar o código do RabbitMQ!

## 📊 Estrutura de Dados

### Order (Pedido)

```typescript
interface Order {
  id: string;              // ORD-1710073800000
  customerId: string;      // CUST-001
  amount: number;          // 100.50
  items: string[];         // ["item1", "item2"]
  timestamp: Date;         // 2026-03-10T13:30:00.000Z
}
```

## 🛠️ Tecnologias

| Tecnologia | Versão | Propósito |
|-----------|--------|----------|
| NestJS | 10.3.0 | Framework para microsserviços |
| RabbitMQ | 3.12 | Message broker |
| OpenTelemetry | 0.50.0 | Instrumentação e coleta de traces |
| Jaeger | latest | Visualização de traces |
| TypeScript | 5.3.3 | Linguagem |

## 📝 Scripts

### Produtor

```bash
npm run dev      # Desenvolvimento com ts-node
npm run build    # Compilar TypeScript
npm start        # Executar em produção
npm run clean    # Limpar dist/
```

### Consumidor

```bash
npm run dev      # Desenvolvimento com ts-node
npm run build    # Compilar TypeScript
npm start        # Executar em produção
npm run clean    # Limpar dist/
```

## 🐛 Troubleshooting

### Traces não aparecem no Jaeger

1. Verifique se o Collector está rodando:
   ```bash
   docker-compose ps
   ```

2. Verifique os logs:
   ```bash
   docker-compose logs otel-collector
   ```

3. Certifique-se de que a variável de ambiente está correta:
   ```bash
   echo $OTEL_EXPORTER_OTLP_ENDPOINT
   # Deve ser: http://localhost:4318/v1/traces
   ```

### Erro "Cannot find module '@opentelemetry/...'"

```bash
npm install
npm run build
```

### RabbitMQ não conecta

```bash
docker-compose logs rabbitmq
docker-compose restart rabbitmq
```

## 📖 Aprendizado

Este projeto é ideal para aprender:

- Como OpenTelemetry funciona
- Propagação de contexto em microsserviços
- Rastreamento distribuído
- Integração com RabbitMQ
- Visualização de traces no Jaeger
- Boas práticas de observabilidade

## 🤝 Contribuições

Sinta-se livre para fazer fork, abrir issues ou enviar pull requests!

## 📄 Licença

MIT

## 👨‍💻 Autor

Geovane ARaujo - Março de 2026

---

**Próximos passos:** Leia [MATERIAL.md](./MATERIAL.md) para um guia completo!
