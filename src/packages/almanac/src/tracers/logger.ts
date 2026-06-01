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
