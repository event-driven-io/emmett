export type RecordFn = {
  (msg: string): void;
  (obj: Record<string, unknown> | Error, msg?: string): void;
};

export type SpanRecorder = {
  fatal: RecordFn;
  error: RecordFn;
  warn: RecordFn;
  info: RecordFn;
  debug: RecordFn;
  trace: RecordFn;
  silent: RecordFn;
};

export type Logger = SpanRecorder;

export type RecordMode = 'span-events' | 'logs';

export type RecordLevel =
  | 'silent'
  | 'trace'
  | 'debug'
  | 'info'
  | 'warn'
  | 'error'
  | 'fatal';

export type LogLevel = RecordLevel;

export const RecordLevel = {
  default: 'info' as RecordLevel,
  silent: 'silent' as RecordLevel,
  trace: 'trace' as RecordLevel,
  debug: 'debug' as RecordLevel,
  info: 'info' as RecordLevel,
  warn: 'warn' as RecordLevel,
  error: 'error' as RecordLevel,
  fatal: 'fatal' as RecordLevel,
};

export const LogLevel = RecordLevel;

export const shouldRecord = (
  logLevel: RecordLevel,
  definedRecordLevel: RecordLevel | undefined,
): boolean => {
  definedRecordLevel ??= definedRecordLevel ?? RecordLevel.default;

  switch (definedRecordLevel) {
    case 'fatal':
      return logLevel === RecordLevel.fatal;
    case 'error':
      return [RecordLevel.fatal, RecordLevel.error].includes(logLevel);
    case 'warn':
      return [RecordLevel.fatal, RecordLevel.error, RecordLevel.warn].includes(
        logLevel,
      );
    case 'info':
      return [
        RecordLevel.fatal,
        RecordLevel.error,
        RecordLevel.warn,
        RecordLevel.info,
      ].includes(logLevel);
    case 'debug':
      return [
        RecordLevel.fatal,
        RecordLevel.error,
        RecordLevel.warn,
        RecordLevel.info,
        RecordLevel.debug,
      ].includes(logLevel);
    case 'trace':
      return [
        RecordLevel.fatal,
        RecordLevel.error,
        RecordLevel.warn,
        RecordLevel.info,
        RecordLevel.debug,
        RecordLevel.trace,
      ].includes(logLevel);
    case 'silent':
      return false;
  }
};

export const noopRecorder: SpanRecorder = {
  fatal: () => {},
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  trace: () => {},
  silent: () => {},
};

export const consoleLogger: SpanRecorder = {
  fatal: (msgOrObj: string | Record<string, unknown> | Error, msg?: string) => {
    if (typeof msgOrObj === 'string') console.error(msgOrObj);
    else console.error(msg ?? '', msgOrObj);
  },
  error: (msgOrObj: string | Record<string, unknown> | Error, msg?: string) => {
    if (typeof msgOrObj === 'string') console.error(msgOrObj);
    else console.error(msg ?? '', msgOrObj);
  },
  warn: (msgOrObj: string | Record<string, unknown> | Error, msg?: string) => {
    if (typeof msgOrObj === 'string') console.warn(msgOrObj);
    else console.warn(msg ?? '', msgOrObj);
  },
  info: (msgOrObj: string | Record<string, unknown> | Error, msg?: string) => {
    if (typeof msgOrObj === 'string') console.log(msgOrObj);
    else console.log(msg ?? '', msgOrObj);
  },
  debug: (msgOrObj: string | Record<string, unknown> | Error, msg?: string) => {
    if (typeof msgOrObj === 'string') console.debug(msgOrObj);
    else console.debug(msg ?? '', msgOrObj);
  },
  trace: (msgOrObj: string | Record<string, unknown> | Error, msg?: string) => {
    if (typeof msgOrObj === 'string') console.trace(msgOrObj);
    else console.trace(msg ?? '', msgOrObj);
  },
  silent: () => {},
};
