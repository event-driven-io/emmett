import { filter } from './filter';
import { retry } from './retry';
import { stopAfter } from './stopAfter';
import { stopOn } from './stopOn';

export const streamTransformations = {
  filter,
  retry,
  stopAfter,
  stopOn,
};
