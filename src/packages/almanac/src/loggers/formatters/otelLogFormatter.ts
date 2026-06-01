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
    JSONSerializer.serialize(OtelLogFormatter.toOtelLog(event), options),

  toOtelLog: ({
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

    const log: Record<string, unknown> = {
      timestamp: metadata.timestamp,
      severityNumber: severityNumberFor(metadata.level),
      severityText: severityTextFor(metadata.level),
    };
    if (eventName) log.eventName = eventName;
    if (metadata.traceId !== undefined) log.traceId = metadata.traceId;
    if (metadata.spanId !== undefined) log.spanId = metadata.spanId;
    if (data.body !== undefined) log.body = data.body;
    if (Object.keys(attributes).length) log.attributes = attributes;
    return log;
  },
};
