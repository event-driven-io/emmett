import { logger, type LogLevel, type Logger } from '../../loggers/logger';

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
