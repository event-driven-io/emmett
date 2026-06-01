import type { AnyValueMap, LogRecord } from '@opentelemetry/api-logs';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import { severityTextFor } from '../../loggers/formatters/otelLogFormatter';
import type { LogEvent, LogLevel, Logger } from '../../loggers/logger';
import { logger } from '../../loggers/logger';

const severityNumbers: Record<LogLevel, SeverityNumber> = {
  fatal: SeverityNumber.FATAL,
  error: SeverityNumber.ERROR,
  warn: SeverityNumber.WARN,
  info: SeverityNumber.INFO,
  debug: SeverityNumber.DEBUG,
  trace: SeverityNumber.TRACE,
  silent: SeverityNumber.UNSPECIFIED,
};

export type OtelLoggerOptions = {
  name?: string;
  minLevel?: LogLevel;
};

export const otelLogger = (options?: OtelLoggerOptions): Logger => {
  const otel = logs.getLogger(options?.name ?? 'almanac');

  const log = (e: LogEvent): void => {
    const data = e.data;
    const attributes =
      data.error === undefined
        ? ((data.attributes ?? {}) as AnyValueMap)
        : ({ ...(data.attributes ?? {}) } as AnyValueMap);
    if (data.error !== undefined) {
      attributes['exception.type'] = data.error.name;
      attributes['exception.message'] = data.error.message;
      if (data.error.stack !== undefined)
        attributes['exception.stacktrace'] = data.error.stack;
    }

    const log: LogRecord = {
      timestamp: e.metadata.timestamp,
      severityNumber: severityNumbers[e.metadata.level],
      severityText: severityTextFor(e.metadata.level),
      attributes,
    };
    if (e.name) log.eventName = e.name;
    if (data.body !== undefined) log.body = data.body;
    otel.emit(log);
  };

  return logger({ event: log, minLevel: options?.minLevel });
};
