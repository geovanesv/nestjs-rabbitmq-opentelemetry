import './tracing';
// Bootstrap do consumer — microservice puro, SEM porta HTTP (D-002 / F-24).
// A primeira linha acima é OBRIGATÓRIA (D-004).
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions } from '@nestjs/microservices';
import { AppModule } from './app.module';
import { rabbitmqConfig } from './rabbitmq.config';
import { installShutdownHooks } from './shutdown';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  logger.log('Tracing initialized for consumer service');

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    rabbitmqConfig,
  );

  await app.listen();
  logger.log('Consumer service is listening to RabbitMQ');

  installShutdownHooks(app, 'consumer-service');
}

void bootstrap();