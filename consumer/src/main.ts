import './tracing';
// Bootstrap do consumer — microservice puro, SEM porta HTTP (D-002 / F-24).
// A primeira linha acima é OBRIGATÓRIA (D-004).
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions } from '@nestjs/microservices';
import { AppModule } from './app.module';
import { rabbitmqConfig } from './rabbitmq.config';
import { DlxTopology } from './queue/dlq.setup';
import { OtelLogger } from './otel-logger';
import { installShutdownHooks } from './shutdown';

async function bootstrap(): Promise<void> {
  // D-034: todos os logs do serviço (incl. de libs, via Logger global do Nest)
  // passam pela ponte console + OTel a partir daqui.
  Logger.overrideLogger(new OtelLogger());

  const logger = new Logger('Bootstrap');
  logger.log('Tracing initialized for consumer service');

  // v1.1 (D-031): a topologia DLX/DLQ/retry é declarada pelo consumer (owner
  // único) antes do Nest conectar/subescrever — evita 406 por mismatch de args.
  await new DlxTopology().setup();
  logger.log('DLQ/retry topology ensured (dlx, .dlq, .retry)');

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    rabbitmqConfig,
  );

  await app.listen();
  logger.log('Consumer service is listening to RabbitMQ');

  installShutdownHooks(app, 'consumer-service');
}

void bootstrap();