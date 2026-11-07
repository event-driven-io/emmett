import type {
  DefaultRecord,
  Event,
  EventDataOf,
  EventMetaDataOf,
  EventTypeOf,
  MessageSchemaVersionOf,
} from '@event-driven-io/emmett';
import type { D1, D2, Meta } from './domain';

const productItem = { productId: 'p', quantity: 1 };
type V1m = Event<'ProductItemAdded', D1, Meta>;
type UserMetaString = { meta: string; schemaVersion?: string };
type V1s = Event<'ProductItemAdded', D1, UserMetaString>;
type V2s = Event<'ProductItemAdded', D2, UserMetaString, 2>;
const wide: Meta & { schemaVersion: number } = { tenant: 't', schemaVersion: 2 };

// Option O1: the reserved key replaces any user key of the same name (Omit), and unversioned arguments forbid it (never)
type ArgO1<E extends Event<string, DefaultRecord, DefaultRecord, number>, M> =
  undefined extends E['schemaVersion']
    ? Omit<M, 'schemaVersion'> & { schemaVersion?: never }
    : Omit<M, 'schemaVersion'> & { schemaVersion: MessageSchemaVersionOf<E> };
declare const eventO1: <E extends Event<string, DefaultRecord, DefaultRecord, number>>(
  type: EventTypeOf<E>,
  data: EventDataOf<E>,
  metadata: ArgO1<E, EventMetaDataOf<E>>,
) => E;

// @ts-expect-error O1 rejects a wide variable with a version for V1m
eventO1<V1m>('ProductItemAdded', { productId: 'p' }, wide);
eventO1<V1m>('ProductItemAdded', { productId: 'p' }, { tenant: 't' });
// @ts-expect-error O1 rejects a user string schemaVersion for V1s
eventO1<V1s>('ProductItemAdded', { productId: 'p' }, { meta: 'm', schemaVersion: '2' });
eventO1<V1s>('ProductItemAdded', { productId: 'p' }, { meta: 'm' });
eventO1<V2s>('ProductItemAdded', { productItem }, { meta: 'm', schemaVersion: 2 });
