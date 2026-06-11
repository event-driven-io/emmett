import { JSONSerializer, type JSONSerializeOptions } from '../../serialization';
import type { LogAttributes, LogEvent, LogLevel } from '../logger';

const SEVERITY_NUMBER: Record<LogLevel, number> = {
  silent: 0,
  trace: 1,
  debug: 5,
  info: 9,
  warn: 13,
  error: 17,
  fatal: 21,
};

export const severityNumberFor = (level: LogLevel): number =>
  SEVERITY_NUMBER[level];

export const severityTextFor = (level: LogLevel): string => level.toUpperCase();

export const OtelLogFormatter = {
  format: (event: LogEvent, options?: JSONSerializeOptions): string =>
    JSONSerializer.serialize(OtelLogFormatter.toOtelRecord(event), options),

  toOtelRecord: ({
    name: eventName,
    data,
    metadata,
  }: LogEvent): Record<string, unknown> => {
    const attributes: LogAttributes = { ...(data.attributes ?? {}) };
    if (data.error) {
      attributes['exception.type'] = data.error.name;
      attributes['exception.message'] = data.error.message;
      if (data.error.stack)
        attributes['exception.stacktrace'] = data.error.stack;
    }

    return {
      eventName,
      timestamp: metadata.timestamp,
      traceId: metadata.traceId,
      spanId: metadata.spanId,
      severityNumber: severityNumberFor(metadata.level),
      severityText: severityTextFor(metadata.level),
      ...(data.body !== undefined ? { body: data.body } : {}),
      ...(Object.keys(attributes).length ? { attributes } : {}),
    };
  },
};
