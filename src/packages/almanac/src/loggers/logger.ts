export type LogLevel =
  'silent' | 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

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
  definedLogLevel ??= LogLevel.default;

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
  traceId?: string;
  spanId?: string;
};

export type LogEventMetadataInput = {
  level: LogLevel;
  timestamp?: number;
  traceId?: string;
  spanId?: string;
};

type LogEventMetadataOverrides = Omit<LogEventMetadataInput, 'level'>;

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
}>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyLogEvent = LogEvent<any, any>;

const logEvent = <
  Attributes extends LogAttributes = LogAttributes,
  EventName extends string = string,
>(
  eventName: EventName,
  data: LogEventData<Attributes>,
  eventMetadata: LogEventMetadataInput,
): LogEvent<EventName, Attributes> => {
  return {
    name: eventName,
    data,
    metadata: {
      ...eventMetadata,
      timestamp: eventMetadata.timestamp ?? Date.now(),
    },
  };
};

const message = <
  Attributes extends LogAttributes = LogAttributes,
  EventName extends string = string,
>(
  level: LogLevel,
  body: EventName,
  data?: Omit<LogEventData<Attributes>, 'body'>,
  eventMetadata?: LogEventMetadataOverrides,
): LogEvent<EventName, Attributes> => {
  if (data === undefined)
    return logEvent<Attributes, EventName>(
      body,
      { body },
      { level, ...eventMetadata },
    );

  const eventData: LogEventData<Attributes> = {
    body,
  };
  if (data.error !== undefined) eventData.error = data.error;
  if (data.attributes !== undefined) eventData.attributes = data.attributes;
  return logEvent<Attributes, EventName>(body, eventData, {
    level,
    ...eventMetadata,
  });
};

const forLevel =
  (level: LogLevel) =>
  (
    msgOrObj: string | LogAttributes | Error,
    msgOrMetadata?: string | LogEventMetadataOverrides,
    eventMetadata?: LogEventMetadataOverrides,
  ): LogEvent => {
    if (typeof msgOrObj === 'string') {
      const overrides =
        typeof msgOrMetadata === 'string' ? eventMetadata : msgOrMetadata;
      return logEvent(msgOrObj, { body: msgOrObj }, { level, ...overrides });
    }

    const msg = typeof msgOrMetadata === 'string' ? msgOrMetadata : undefined;
    const overrides =
      eventMetadata ??
      (typeof msgOrMetadata === 'string' ? undefined : msgOrMetadata);

    if (msgOrObj instanceof Error)
      return logEvent(
        msg ?? '',
        {
          error: msgOrObj,
          body: msg,
        },
        { level, ...overrides },
      );

    const { eventName, ...attributes } = msgOrObj;
    return logEvent(
      typeof eventName === 'string' ? eventName : (msg ?? ''),
      {
        attributes,
        body: msg,
      },
      { level, ...overrides },
    );
  };

export const LogEvent = Object.assign(logEvent, {
  message,
  fatal: forLevel('fatal'),
  error: forLevel('error'),
  warn: forLevel('warn'),
  info: forLevel('info'),
  debug: forLevel('debug'),
  trace: forLevel('trace'),
  silent: forLevel('silent'),
});

export type Logger = (event: LogEvent) => void;

export const logger = (options: {
  event: (event: LogEvent) => void;
  minLevel?: LogLevel;
}): Logger => {
  const { event: sink, minLevel } = options;
  return (event: LogEvent): void => {
    if (
      event.metadata.level === 'silent' ||
      !shouldLog(event.metadata.level, minLevel)
    )
      return;
    sink(event);
  };
};

export const noopLogger: Logger = logger({ event: () => {} });
