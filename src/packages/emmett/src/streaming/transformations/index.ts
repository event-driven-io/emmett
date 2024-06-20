import { filter } from './filter';
import {
  notifyAboutNoActiveReadersStream,
  NotifyAboutNoActiveReadersStream,
} from './notifyAboutNoActiveReaders';
import { reduce, ReduceTransformStream } from './reduce';
import { retry } from './retry';
import { stopAfter } from './stopAfter';
import { stopOn } from './stopOn';

export const streamTransformations = {
  filter,
  notifyAboutNoActiveReadersStream,
  NotifyAboutNoActiveReadersStream,
  reduce,
  ReduceTransformStream,
  retry,
  stopAfter,
  stopOn,
};
