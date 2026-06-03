export type LogLevel =
  | 'silent'
  | 'trace'
  | 'debug'
  | 'info'
  | 'warn'
  | 'error'
  | 'fatal';

export const LogLevel = {
  default: 'info' as LogLevel,
  silent: 'silent' as LogLevel,
  trace: 'trace' as LogLevel,
  debug: 'debug' as LogLevel,
  info: 'info' as LogLevel,
  warn: 'warn' as LogLevel,
  error: 'error' as LogLevel,
  fatal: 'fatal' as LogLevel,
};

export const shouldLog = (
  logLevel: LogLevel,
  definedLogLevel: LogLevel | undefined,
): boolean => {
  definedLogLevel ??= definedLogLevel ?? LogLevel.default;

  switch (definedLogLevel) {
    case 'fatal':
      return logLevel === LogLevel.fatal;
    case 'error':
      return [LogLevel.fatal, LogLevel.error].includes(logLevel);
    case 'warn':
      return [LogLevel.fatal, LogLevel.error, LogLevel.warn].includes(logLevel);
    case 'info':
      return [
        LogLevel.fatal,
        LogLevel.error,
        LogLevel.warn,
        LogLevel.info,
      ].includes(logLevel);
    case 'debug':
      return [
        LogLevel.fatal,
        LogLevel.error,
        LogLevel.warn,
        LogLevel.info,
        LogLevel.debug,
      ].includes(logLevel);
    case 'trace':
      return [
        LogLevel.fatal,
        LogLevel.error,
        LogLevel.warn,
        LogLevel.info,
        LogLevel.debug,
        LogLevel.trace,
      ].includes(logLevel);
    case 'silent':
      return false;
  }
};

export type Attributes = Record<string, unknown>;

// Reserved attribute key that promotes a property to the OTel EventName field.
// Named `eventName` so an ordinary attribute is unlikely to collide with it.
export const EVENT_NAME_KEY = 'eventName';

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

export type LogEvent = {
  level: LogLevel;
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
  level: LogLevel,
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

export type Logger = {
  fatal: LogFn;
  error: LogFn;
  warn: LogFn;
  info: LogFn;
  debug: LogFn;
  trace: LogFn;
  silent: LogFn;
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
  minLevel?: LogLevel;
}): Logger => {
  const { event: sink, minLevel } = options;
  const event = (record: LogEvent): void => {
    if (record.level === 'silent' || !shouldLog(record.level, minLevel)) return;
    sink(record);
  };
  const make =
    (level: LogLevel): LogFn =>
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

const consoleMethodFor = (level: LogLevel): ((...args: unknown[]) => void) => {
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
