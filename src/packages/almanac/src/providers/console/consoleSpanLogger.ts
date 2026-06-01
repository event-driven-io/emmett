import type { LogLevel } from '../../loggers/logger';
import { logger, type Logger } from '../../loggers/logger';
import { createConsoleSpanLogSink } from './consoleSpanLogSink';

export type ConsoleFormat = 'compact' | 'pretty' | 'simple';

export const ConsoleFormat = {
  compact: 'compact' as ConsoleFormat,
  pretty: 'pretty' as ConsoleFormat,
  SIMPLE: 'simple' as ConsoleFormat,
};

export type ConsoleSpanLoggerOptions = {
  format?: ConsoleFormat;
  logLevel?: LogLevel;
};

export const consoleSpanLogger = (options?: ConsoleSpanLoggerOptions): Logger =>
  logger({
    minLevel: options?.logLevel,
    event: createConsoleSpanLogSink(options?.format),
  });
