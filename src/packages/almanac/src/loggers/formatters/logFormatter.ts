import type { JSONSerializeOptions } from '../../serialization';
import type { LogEvent } from '../logger';

export type LogFormatter = {
  format: (event: LogEvent, options?: JSONSerializeOptions) => string;
};
