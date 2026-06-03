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

export const shouldLog = (
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

export const shouldRecord = shouldLog;

export type Attributes = Record<string, unknown>;

// Reserved attribute key that promotes a property to the OTel EventName field.
// Named `eventName` so an ordinary attribute is unlikely to collide with it.
export const EVENT_NAME_KEY = 'eventName';

const SEVERITY_NUMBER: Record<RecordLevel, number> = {
  silent: 0,
  trace: 1,
  debug: 5,
  info: 9,
  warn: 13,
  error: 17,
  fatal: 21,
};

export const severityNumberFor = (level: RecordLevel): number =>
  SEVERITY_NUMBER[level];

export const severityTextFor = (level: RecordLevel): string =>
  level.toUpperCase();

export type LogEvent = {
  level: RecordLevel;
  severityNumber: number;
  severityText: string;
  timestamp: number;
  body?: string;
  eventName?: string;
  attributes?: Attributes;
  error?: Error;
  traceId?: string;
  spanId?: string;
};

export const logEvent = (
  level: RecordLevel,
  fields: {
    body?: string;
    eventName?: string;
    attributes?: Attributes;
    error?: Error;
  } = {},
): LogEvent => ({
  level,
  severityNumber: severityNumberFor(level),
  severityText: severityTextFor(level),
  timestamp: Date.now(),
  ...fields,
});

export type LogFn = {
  (msg: string): void;
  (attributes: Attributes | Error, msg?: string): void;
};

export type Logger = SpanRecorder & {
  event(record: LogEvent): void;
};

const toFields = (
  msgOrObj: string | Attributes | Error,
  msg?: string,
): {
  body?: string;
  eventName?: string;
  attributes?: Attributes;
  error?: Error;
} => {
  if (typeof msgOrObj === 'string') return { body: msgOrObj };
  if (msgOrObj instanceof Error) return { error: msgOrObj, body: msg };
  const { [EVENT_NAME_KEY]: eventName, ...attributes } = msgOrObj;
  return {
    body: msg,
    eventName: typeof eventName === 'string' ? eventName : undefined,
    attributes,
  };
};

export const logger = (options: {
  event: (record: LogEvent) => void;
  minLevel?: RecordLevel;
}): Logger => {
  const { event: sink, minLevel } = options;
  const event = (record: LogEvent): void => {
    if (record.level === 'silent' || !shouldLog(record.level, minLevel)) return;
    sink(record);
  };
  const make =
    (level: RecordLevel): LogFn =>
    (msgOrObj: string | Attributes | Error, msg?: string) =>
      event(logEvent(level, toFields(msgOrObj, msg)));
  return {
    event,
    fatal: make('fatal'),
    error: make('error'),
    warn: make('warn'),
    info: make('info'),
    debug: make('debug'),
    trace: make('trace'),
    silent: make('silent'),
  };
};

export const noopLogger: Logger = logger({ event: () => {} });

export const noopRecorder: SpanRecorder = noopLogger;

const consoleMethodFor = (
  level: RecordLevel,
): ((...args: unknown[]) => void) => {
  switch (level) {
    case 'fatal':
    case 'error':
      return console.error;
    case 'warn':
      return console.warn;
    case 'debug':
      return console.debug;
    case 'trace':
      return console.trace;
    default:
      return console.log;
  }
};

export const consoleLogger: Logger = logger({
  event: (event) => {
    const write = consoleMethodFor(event.level);
    const extra =
      event.error ??
      (event.attributes && Object.keys(event.attributes).length
        ? event.attributes
        : undefined);
    if (event.body !== undefined && extra !== undefined)
      write(event.body, extra);
    else if (event.body !== undefined) write(event.body);
    else if (extra !== undefined) write(extra);
    else write('');
  },
});
