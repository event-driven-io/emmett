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

export type LogAttributes = Record<string, unknown>;

// Reserved attribute key that promotes a property to the OTel EventName field.
// Named `eventName` so an ordinary attribute is unlikely to collide with it.
export const EVENT_NAME_KEY = 'eventName';

// export type LogEvent = {
//   level: LogLevel;
//   timestamp: number;
//   body?: string;
//   eventName?: string;
//   attributes?: LogAttributes;
//   error?: Error;
//   traceId?: string;
//   spanId?: string;
// };

type RequireAtLeastOne<T> = {
  [K in keyof T]-?: Required<Pick<T, K>> &
    Partial<Pick<T, Exclude<keyof T, K>>>;
}[keyof T];

export type LogEventData<Attributes extends LogAttributes = LogAttributes> =
  RequireAtLeastOne<{
    error?: Error;
    body?: string;
    attributes?: Attributes;
  }>;

export type LogEventMetadata = {
  level: LogLevel;
  timestamp: number;
  traceId: string;
  spanId: string;
};

export type LogInput<
  EventName extends string = string,
  Attributes extends LogAttributes = LogAttributes,
> = {
  name: EventName;
  data: LogEventData<Attributes>;
  metadata: LogEventMetadata;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyLogInput = LogEvent<any, any>;

export type LogEvent<
  EventName extends string = string,
  Attributes extends LogAttributes = LogAttributes,
> = Readonly<{
  name: EventName;
  data: LogEventData<Attributes>;
  metadata: LogEventMetadata;
}> & { readonly kind?: 'LogEvent' };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyLogEventRecord = LogEvent<any, any>;

export const logEvent = <
  Attributes extends LogAttributes = LogAttributes,
  EventName extends string = string,
>(
  level: LogLevel,
  eventName: EventName,
  data: LogEventData<Attributes>,
): LogEvent<EventName, Attributes> => ({
  name: eventName,
  metadata: {
    level,
    spanId: 'TODO',
    traceId: 'TODO',
    timestamp: Date.now(),
  },
  data,
});

const LogEvent = { unknownEventName: 'unknown' };

export const logMessage = <
  Attributes extends LogAttributes = LogAttributes,
  EventName extends string = string,
>(
  level: LogLevel,
  body: EventName,
  data?: Omit<LogEventData<Attributes>, 'body'>,
): LogEvent<EventName, Attributes> => ({
  name: body,
  metadata: {
    level,
    spanId: 'TODO',
    traceId: 'TODO',
    timestamp: Date.now(),
  },
  data: {
    ...data,
    body,
  },
});

export type LogFn = {
  (msg: string): void;
  (attributes: LogAttributes | Error, msg?: string): void;
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
  logLevel: LogLevel,
  msgOrObj: string | LogAttributes | Error,
  msg?: string,
): LogEvent => {
  if (typeof msgOrObj === 'string')
    return logEvent(logLevel, msgOrObj, { body: msgOrObj });

  if (msgOrObj instanceof Error)
    return logEvent(logLevel, msg ?? LogEvent.unknownEventName, {
      error: msgOrObj,
      body: msg,
    });

  const { [EVENT_NAME_KEY]: eventName, ...attributes } = msgOrObj;
  return logEvent(
    logLevel,
    typeof eventName === 'string'
      ? eventName
      : (msg ?? LogEvent.unknownEventName),
    {
      attributes,
      body: msg,
    },
  );
};

export const logger = (options: {
  event: (record: LogEvent) => void;
  minLevel?: LogLevel;
}): Logger => {
  const { event: sink, minLevel } = options;
  const event = (record: LogEvent): void => {
    if (
      record.metadata.level === 'silent' ||
      !shouldLog(record.metadata.level, minLevel)
    )
      return;
    sink(record);
  };
  const make =
    (level: LogLevel): LogFn =>
    (msgOrObj: string | LogAttributes | Error, msg?: string) =>
      event(toFields(level, msgOrObj, msg));
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
    const write = consoleMethodFor(event.metadata.level);
    const extra =
      event.data.error ??
      (event.data.attributes && Object.keys(event.data.attributes).length
        ? event.data.attributes
        : undefined);
    if (event.data.body !== undefined && extra !== undefined)
      write(event.data.body, extra);
    else if (event.data.body !== undefined) write(event.data.body);
    else if (extra !== undefined) write(extra);
    else write('');
  },
});
