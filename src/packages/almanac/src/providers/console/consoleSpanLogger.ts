import { OtelLogFormatter, SimpleLogFormatter } from '../../loggers';
import type { LogEvent, LogLevel } from '../../loggers/logger';
import { logger, type Logger } from '../../loggers/logger';

export type ConsoleFormat = 'compact' | 'pretty' | 'simple';

export const ConsoleFormat = {
  compact: 'compact' as ConsoleFormat,
  pretty: 'pretty' as ConsoleFormat,
  SIMPLE: 'simple' as ConsoleFormat,
};

export type ConsoleSpanLoggerOptions = {
  format?: ConsoleFormat;
  recordLevel?: LogLevel;
};

export const consoleSpanLogger = (
  options?: ConsoleSpanLoggerOptions,
): Logger => {
  const serializerOptions = {
    format:
      options?.format === 'simple' || undefined ? 'compact' : options?.format,
    safe: true,
  };

  const event =
    options?.format === 'simple'
      ? (event: LogEvent) =>
          console.log(SimpleLogFormatter.format(event, serializerOptions))
      : (event: LogEvent) =>
          console.log(OtelLogFormatter.format(event, serializerOptions));

  return logger({
    minLevel: options?.recordLevel,
    event,
  });
};
