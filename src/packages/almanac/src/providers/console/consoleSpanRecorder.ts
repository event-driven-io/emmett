import { JSONSerializer } from '../../serialization/json';
import type { RecordLevel } from '../../tracers/logger';
import {
  shouldRecord,
  type RecordFn,
  type SpanRecorder,
} from '../../tracers/logger';

export type ConsoleFormat = 'compact' | 'pretty' | 'simple';

export const ConsoleFormat = {
  compact: 'compact' as ConsoleFormat,
  pretty: 'pretty' as ConsoleFormat,
  SIMPLE: 'simple' as ConsoleFormat,
};

export type ConsoleSpanRecorderOptions = {
  format?: ConsoleFormat;
  recordLevel?: RecordLevel;
};

const buildEntry = (
  level: RecordLevel,
  msgOrObj: string | Record<string, unknown> | Error,
  msg?: string,
): Record<string, unknown> => {
  if (typeof msgOrObj === 'string') {
    return { level, msg: msgOrObj };
  }
  const entry: Record<string, unknown> = { level };

  if (msg !== undefined) entry.msg = msg;

  if (msgOrObj instanceof Error) {
    entry.error = msgOrObj;
  } else {
    Object.assign(entry, msgOrObj);
  }
  return entry;
};

const formatSimple = (
  level: RecordLevel,
  msgOrObj: string | Record<string, unknown> | Error,
  msg?: string,
): string => {
  if (typeof msgOrObj === 'string') {
    return `[${level}] ${msgOrObj}`;
  }
  return msg !== undefined ? `[${level}] ${msg}` : `[${level}]`;
};

export const consoleSpanRecorder = (
  options?: ConsoleSpanRecorderOptions,
): SpanRecorder => {
  const format: ConsoleFormat = options?.format ?? 'compact';

  const logRecord = (level: RecordLevel): RecordFn => {
    if (level === 'silent' || !shouldRecord(level, options?.recordLevel))
      return () => {};

    if (format === 'simple')
      return (
        msgOrObj: string | Record<string, unknown> | Error,
        msg?: string,
      ) => console.log(formatSimple(level, msgOrObj, msg));

    return (msgOrObj: string | Record<string, unknown> | Error, msg?: string) =>
      console.log(
        JSONSerializer.serialize(buildEntry(level, msgOrObj, msg), {
          format,
          safe: true,
        }),
      );
  };

  return {
    fatal: logRecord('fatal'),
    error: logRecord('error'),
    warn: logRecord('warn'),
    info: logRecord('info'),
    debug: logRecord('debug'),
    trace: logRecord('trace'),
    silent: logRecord('silent'),
  };
};
