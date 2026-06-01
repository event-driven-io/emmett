import type { RecordLevel } from '../../testing/collectedSpan';
import type { RecordFn, SpanRecorder } from '../../tracers/logger';
import { JSONSerializer } from '../../serialization/json';

export type ConsoleMode = 'ndjson' | 'pretty' | 'simple';

export type ConsoleSpanRecorderOptions = {
  mode?: ConsoleMode;
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
  const mode = options?.mode ?? 'ndjson';

  const makeRecordFn = (level: RecordLevel): RecordFn => {
    const fn = (
      msgOrObj: string | Record<string, unknown> | Error,
      msg?: string,
    ) => {
      if (level === 'silent') return;
      if (mode === 'simple') {
        console.log(formatSimple(level, msgOrObj, msg));
      } else {
        const entry = buildEntry(level, msgOrObj, msg);
        console.log(
          JSONSerializer.serialize(entry, {
            format: mode === 'pretty' ? 'pretty' : 'compact',
            safe: true,
          }),
        );
      }
    };
    return fn;
  };

  return {
    fatal: makeRecordFn('fatal'),
    error: makeRecordFn('error'),
    warn: makeRecordFn('warn'),
    info: makeRecordFn('info'),
    debug: makeRecordFn('debug'),
    trace: makeRecordFn('trace'),
    silent: makeRecordFn('silent'),
  };
};
