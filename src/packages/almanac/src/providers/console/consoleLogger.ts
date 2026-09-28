import { logger, LogLevel, type Logger } from '../../loggers/logger';

export type ConsoleLoggerOptions = {
  destination?: 'stdout' | 'stderr';
  minLevel?: LogLevel;
};

export const consoleLogger = (options?: ConsoleLoggerOptions): Logger => {
  const write = options?.destination === 'stderr' ? console.error : console.log;

  return logger({
    minLevel: options?.minLevel ?? LogLevel.info,
    log: (event) => {
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
};
