import type { JSONSerializeOptions } from '../../serialization';
import type { LogEvent } from '../logger';

export const SimpleLogFormatter = {
  format: (event: LogEvent, _options?: JSONSerializeOptions): string => {
    const message = event.data.body ?? (event.name ? event.name : undefined);
    return message !== undefined
      ? `[${event.metadata.level}] ${message}`
      : `[${event.metadata.level}]`;
  },
};
