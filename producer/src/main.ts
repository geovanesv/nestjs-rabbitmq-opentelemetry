import './tracing';
// Bootstrap HTTP do producer (RFC §7 / F-11).
// A primeira linha acima (import './tracing') é OBRIGATÓRIA e não pode ter
// nenhum import/comentário antes (D-004): garante o patch de amqplib.
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { config } from './config';
import { installShutdownHooks } from './shutdown';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  logger.log('Tracing initialized for producer service');

  const app = await NestFactory.create(AppModule);

  // Validação global de entrada (D-015).
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.listen(config.port);
  logger.log(
    `Producer service is running on http://localhost:${config.port}`,
  );

  installShutdownHooks(app, 'producer-service');
}

void bootstrap();
