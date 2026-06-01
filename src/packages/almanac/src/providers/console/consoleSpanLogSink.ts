import { OtelLogFormatter, SimpleLogFormatter } from '../../loggers';
import type { LogEvent } from '../../loggers/logger';
import type { ConsoleFormat } from './consoleSpanLogger';

export const createConsoleSpanLogSink = (
  format?: ConsoleFormat,
): ((event: LogEvent) => void) => {
  const serializerOptions = {
    format: format === 'simple' || undefined ? 'compact' : format,
    safe: true,
  };

  return format === 'simple'
    ? (event: LogEvent) =>
        console.log(SimpleLogFormatter.format(event, serializerOptions))
    : (event: LogEvent) =>
        console.log(OtelLogFormatter.format(event, serializerOptions));
};
