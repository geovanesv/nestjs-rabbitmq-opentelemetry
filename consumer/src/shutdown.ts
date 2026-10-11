// Shutdown gracioso com handler único de sinais (RFC §7.7 / D-017 / F-26).
// app.close() → flush do tracing → exit 0. Idempotente.
import { INestApplication, INestMicroservice, Logger } from '@nestjs/common';
import { shutdownTracing } from './tracing';

let shuttingDown = false;

export function installShutdownHooks(
  app: INestApplication | INestMicroservice,
  name: string,
): void {
  const handle = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    Logger.log(`Received ${signal}, shutting down`, name);
    void (async () => {
      try {
        await app.close();
      } catch (error) {
        Logger.error(
          `Erro ao fechar a aplicação: ${(error as Error).message}`,
          undefined,
          name,
        );
      }
      await shutdownTracing();
      process.exit(0);
    })();
  };

  process.once('SIGTERM', handle);
  process.once('SIGINT', handle);
}