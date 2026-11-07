import {
  command,
  event,
  message,
  type Command,
  type DefaultRecord,
  type Event,
  type EventDataOf,
  type EventMetaDataOf,
  type EventTypeOf,
  type Message,
} from '@event-driven-io/emmett';
import type { D1, D2, Meta, Stored, V2 } from './domain';

const productItem = { productId: 'p', quantity: 1 };
type V1m = Event<'ProductItemAdded', D1, Meta>;

// d1: a variable typed with an extra schemaVersion key, passed for V1 with metadata
const wide: Meta & { schemaVersion: number } = { tenant: 't', schemaVersion: 2 };
export const d1 = event<V1m>('ProductItemAdded', { productId: 'p' }, wide);
// d1b: the same for an unversioned command with default metadata
const wideNow = { now: new Date(), schemaVersion: 2 };
export const d1b = command<Command<'AddProductItem', D1>>('AddProductItem', { productId: 'p' }, wideNow);

// d2: user metadata types that declare their own schemaVersion key
type UserMetaString = { meta: string; schemaVersion?: string };
type V1s = Event<'ProductItemAdded', D1, UserMetaString>;
export const d2 = event<V1s>('ProductItemAdded', { productId: 'p' }, { meta: 'm', schemaVersion: '2' });
type V2s = Event<'ProductItemAdded', D2, UserMetaString, 2>;
export const d2b = event<V2s>('ProductItemAdded', { productItem }, { meta: 'm', schemaVersion: 2 });
type UserMetaNumber = { meta: string; schemaVersion: number };
type V2n = Event<'ProductItemAdded', D2, UserMetaNumber, 2>;
export const d2c = event<V2n>('ProductItemAdded', { productItem }, { meta: 'm', schemaVersion: 2 });

// d3: a union as the type argument
export const d3 = event<Stored>('ProductItemAdded', { productItem });
export const d3b = event<Stored>('ProductItemAdded', { productId: 'p' });
export const d3c = message<Stored>('Event', 'ProductItemAdded', { productItem });

// d4: generic callers
export const g1 = <E extends Event>(type: EventTypeOf<E>, data: EventDataOf<E>): E =>
  event<E>(type, data);
export const g2 = <E extends Event<string, DefaultRecord, DefaultRecord>>(
  type: EventTypeOf<E>,
  data: EventDataOf<E>,
  metadata: EventMetaDataOf<E>,
): E => event<E>(type, data, metadata);
export const g3 = <E extends Event>(...args: Parameters<typeof event<E>>): E => event<E>(...args);
export const g4 = <C extends Command>(type: C['type'], data: C['data']): C => command<C>(type, data);
export const g5 = <M extends Message>(kind: M['kind'], type: M['type'], data: M['data']): M =>
  message<M>(kind, type, data);
export const g6 = <E extends V2>(): E => event<E>('ProductItemAdded', { productItem }, { schemaVersion: 2 });
