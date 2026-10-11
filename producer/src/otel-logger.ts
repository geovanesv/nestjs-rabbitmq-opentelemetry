// Ponte Logger → OTel logs (RFC §7.9 / D-034 / F-50).
// Implementa LoggerService do Nest: imprime no console (formato padrão do
// ConsoleLogger, convenção §7.8 preservada) E emite LogRecord via api-logs.
// O sdk-logs preenche trace_id/span_id a partir do span ativo do contexto
// de execução — por isso a ponte não precisa lê-los manualmente.
import { ConsoleLogger, LoggerService } from '@nestjs/common';
import { SeverityNumber, logs } from '@opentelemetry/api-logs';

const SERVICE_NAME = process.env.OTEL_SERVICE_NAME || 'producer-service';
const SERVICE_VERSION = process.env.SERVICE_VERSION || '1.0.0';
const ENVIRONMENT = process.env.NODE_ENV || 'development';

export class OtelLogger extends ConsoleLogger implements LoggerService {
  private readonly otel = logs.getLogger(SERVICE_NAME);

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.emit(SeverityNumber.INFO, message, optionalParams[0]);
    super.log(message, ...optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.emit(SeverityNumber.ERROR, message, optionalParams[1]);
    super.error(message, ...optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.emit(SeverityNumber.WARN, message, optionalParams[0]);
    super.warn(message, ...optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.emit(SeverityNumber.DEBUG, message, optionalParams[0]);
    super.debug(message, ...optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.emit(SeverityNumber.TRACE, message, optionalParams[0]);
    super.verbose(message, ...optionalParams);
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.emit(SeverityNumber.FATAL, message, optionalParams[1]);
    super.fatal(message, ...optionalParams);
  }

  private emit(
    severityNumber: SeverityNumber,
    message: unknown,
    context?: unknown,
  ): void {
    try {
      const json = JSON.stringify(message);
      const body = json !== undefined ? json : String(message);
      this.otel.emit({
        severityNumber,
        severityText: SeverityNumber[severityNumber],
        body,
        timestamp: Date.now(),
        attributes: {
          'log.logger':
            typeof context === 'string' && context.length > 0
              ? context
              : (this.context ?? 'unknown'),
          'service.name': SERVICE_NAME,
          'service.version': SERVICE_VERSION,
          'deployment.environment': ENVIRONMENT,
        },
      });
    } catch {
      // Telemetria fora do caminho crítico (D-020): nunca derruba o app.
    }
  }
}