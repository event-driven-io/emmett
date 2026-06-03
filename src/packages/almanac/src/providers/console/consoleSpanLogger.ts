import { JSONSerializer } from '../../serialization/json';
import type { Attributes, LogEvent, LogLevel } from '../../tracers/logger';
import { logger, type Logger } from '../../tracers/logger';

export type ConsoleFormat = 'compact' | 'pretty' | 'simple';

export const ConsoleFormat = {
  compact: 'compact' as ConsoleFormat,
  pretty: 'pretty' as ConsoleFormat,
  SIMPLE: 'simple' as ConsoleFormat,
};

export type ConsoleSpanLoggerOptions = {
  format?: ConsoleFormat;
  recordLevel?: LogLevel;
  traceId?: string;
  spanId?: string;
};

const toOtelRecord = (
  event: LogEvent,
  span: { traceId?: string; spanId?: string },
): Record<string, unknown> => {
  const attributes: Attributes = { ...(event.attributes ?? {}) };
  if (event.error) {
    attributes['exception.type'] = event.error.name;
    attributes['exception.message'] = event.error.message;
    if (event.error.stack)
      attributes['exception.stacktrace'] = event.error.stack;
  }

  return {
    timestamp: event.timestamp,
    severityNumber: event.severityNumber,
    severityText: event.severityText,
    ...(event.body !== undefined ? { body: event.body } : {}),
    ...(event.eventName !== undefined ? { eventName: event.eventName } : {}),
    ...(span.traceId ? { trace_id: span.traceId } : {}),
    ...(span.spanId ? { span_id: span.spanId } : {}),
    ...(Object.keys(attributes).length ? { attributes } : {}),
  };
};

export const consoleSpanLogger = (
  options?: ConsoleSpanLoggerOptions,
): Logger => {
  const format: ConsoleFormat = options?.format ?? 'compact';
  const span = { traceId: options?.traceId, spanId: options?.spanId };

  const event =
    format === 'simple'
      ? (event: LogEvent) => {
          const text = event.body ?? event.eventName;
          console.log(
            text !== undefined
              ? `[${event.level}] ${text}`
              : `[${event.level}]`,
          );
          return;
        }
      : (event: LogEvent) => {
          console.log(
            JSONSerializer.serialize(toOtelRecord(event, span), {
              format,
              safe: true,
            }),
          );
        };

  return logger({
    minLevel: options?.recordLevel,
    event,
  });
};
