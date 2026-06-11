import type { JSONSerializeOptions } from '../../serialization';
import type { LogEvent } from '../logger';

export const SimpleLogFormatter = {
  format: (event: LogEvent, _options?: JSONSerializeOptions): string =>
    `[${event.metadata.level}] ${event.name} - ${event.data.body}`,
};
