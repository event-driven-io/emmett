import {
  event,
  message,
  upcastRecordedMessage,
  type Message,
  type RecordedMessage,
  type RecordedMessageMetadataWithGlobalPosition,
  type SchemaVersionProperty,
  type WithSchemaVersionArgument,
} from '@event-driven-io/emmett';
import { assertType, type D2, type Equals, type Stored, type V2 } from './domain';

const productItem = { productId: 'p', quantity: 1 };

// j1: a union as the helper's type argument takes no version, so V2-shaped data is accepted without one
export const j1 = event<Stored>('ProductItemAdded', { productItem });
export const j1b = message<Stored>('Event', 'ProductItemAdded', { productItem });

// j2: a cast hides a missing schemaVersion on a recorded message
export const j2 = {
  type: 'ProductItemAdded',
  data: { productItem },
  kind: 'Event',
  metadata: {} as RecordedMessageMetadataWithGlobalPosition,
} as RecordedMessage<V2, RecordedMessageMetadataWithGlobalPosition>;
// the same literal without the cast is rejected
// @ts-expect-error schemaVersion missing
export const j2b: RecordedMessage<V2, RecordedMessageMetadataWithGlobalPosition> =
  { type: 'ProductItemAdded', data: { productItem }, kind: 'Event', metadata: {} as RecordedMessageMetadataWithGlobalPosition };

// j3: upcastRecordedMessage accepts a plain payload (no metadata, no kind) and returns a recorded type; readStream in PostgreSQL and SQLite relies on this branch
export const j3 = upcastRecordedMessage<V2, V2>({
  type: 'ProductItemAdded',
  data: { productItem },
  schemaVersion: 2,
});
assertType<Equals<(typeof j3)['schemaVersion'], 2>>();

// j4: Message passes the version to both kinds
type M2 = Message<'ProductItemAdded', D2, undefined, 2>;
assertType<Equals<M2['schemaVersion'], 2>>();
// @ts-expect-error kind Command, version missing
export const j4: M2 = { kind: 'Command', type: 'ProductItemAdded', data: { productItem } };

// j5: the added helper types are public
assertType<Equals<SchemaVersionProperty<'X', 2>, { readonly schemaVersion: 2 }>>();
assertType<Equals<WithSchemaVersionArgument<V2, [a: string]>, [a: string, schemaVersion: 2]>>();
