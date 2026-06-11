import type { JSONDeserializeOptions } from '../../serialization';
import type { LogEvent } from '../logger';

export type LogFormatter = {
  format: (event: LogEvent, options?: JSONDeserializeOptions) => string;
};
