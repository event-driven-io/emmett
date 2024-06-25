import { filter } from './filter';
import { map } from './map';
import {
  notifyAboutNoActiveReadersStream,
  NotifyAboutNoActiveReadersStream,
} from './notifyAboutNoActiveReaders';
import { reduce, ReduceTransformStream } from './reduce';
import { retry } from './retry';
import { skip, SkipTransformStream } from './skip';
import { stopAfter } from './stopAfter';
import { stopOn } from './stopOn';
import { take, TakeTransformStream } from './take';

export const streamTransformations = {
  filter,
  take,
  TakeTransformStream,
  skip,
  SkipTransformStream,
  map,
  notifyAboutNoActiveReadersStream,
  NotifyAboutNoActiveReadersStream,
  reduce,
  ReduceTransformStream,
  retry,
  stopAfter,
  stopOn,
};
