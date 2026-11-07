import type {
  AnyEvent,
  CombinedReadEventMetadata,
  CombineMetadata,
  Event,
  EventDataOf,
  EventMetaDataOf,
  EventTypeOf,
  MessageKindOf,
  MessageSchemaVersionOf,
  ReadEvent,
  ReadEventMetadataWithGlobalPosition,
  RecordedMessage,
  RecordedMessageMetadataWithGlobalPosition,
} from '@event-driven-io/emmett';
import {
  assertType,
  v2,
  type D1,
  type D2,
  type Equals,
  type Meta,
  type Stored,
  type V2,
  type V2m,
} from './domain';

// b1: concrete spread keeps the literal
const b1 = { ...v2, kind: 'Event' as const };
assertType<Equals<typeof b1.schemaVersion, 2>>();

// b2: spread of a union keeps narrowing
export const b2 = (e: Stored) => {
  const r = { ...e, kind: 'Event' as const };
  switch (r.schemaVersion) {
    case 2:
      return r.data.productItem;
    default:
      return r.data.productId;
  }
};

// b3: generic spread into a recorded message without setting the version
export const b3 = <E extends Event>(
  e: E,
  metadata: RecordedMessageMetadataWithGlobalPosition,
): RecordedMessage<E, RecordedMessageMetadataWithGlobalPosition> => ({
  ...e,
  kind: 'Event',
  metadata: metadata as CombinedReadEventMetadata<
    E,
    RecordedMessageMetadataWithGlobalPosition
  >,
});

// b3b: same, with the version set
export const b3b = <E extends Event>(
  e: E,
  metadata: RecordedMessageMetadataWithGlobalPosition,
): RecordedMessage<E, RecordedMessageMetadataWithGlobalPosition> => ({
  ...e,
  kind: 'Event',
  schemaVersion: e.schemaVersion ?? 1,
  metadata: metadata as CombinedReadEventMetadata<
    E,
    RecordedMessageMetadataWithGlobalPosition
  >,
});

// b4: Omit over the union
export const b4 = (e: Omit<Stored, 'kind'>) => {
  switch (e.schemaVersion) {
    case 2:
      return e.data.productItem;
    default:
      return e.data.productId;
  }
};

// b5: Pick over the union
export const b5 = (e: Pick<Stored, 'type' | 'data' | 'schemaVersion'>) => {
  switch (e.schemaVersion) {
    case 2:
      return e.data.productItem;
    default:
      return e.data.productId;
  }
};

// b6: Readonly over the union
export const b6 = (e: Readonly<Stored>) => {
  switch (e.schemaVersion) {
    case 2:
      return e.data.productItem;
    default:
      return e.data.productId;
  }
};

// b7: a homomorphic mapped type over the union
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
export const b7 = (e: Mutable<Stored>) => {
  switch (e.schemaVersion) {
    case 2:
      return e.data.productItem;
    default:
      return e.data.productId;
  }
};

// b8: Partial keeps the literal, as optional
assertType<Equals<Partial<V2>['schemaVersion'], 2 | undefined>>();
// b8b: Required on V1
assertType<Equals<Required<Stored>['schemaVersion'], 1 | 2>>();

// b9: extractors
assertType<Equals<EventTypeOf<Stored>, 'ProductItemAdded'>>();
assertType<Equals<EventDataOf<Stored>, D1 | D2>>();
assertType<Equals<EventMetaDataOf<V2m>, Meta>>();
assertType<Equals<EventMetaDataOf<V2>, undefined>>();
assertType<Equals<MessageKindOf<V2>, 'Event' | undefined>>();
assertType<Equals<MessageSchemaVersionOf<V2>, 2>>();
assertType<Equals<MessageSchemaVersionOf<Stored>, 1 | 2>>();
assertType<Equals<MessageSchemaVersionOf<Event>, number>>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
assertType<Equals<MessageSchemaVersionOf<AnyEvent>, any>>();

// b10: metadata combinators
assertType<Equals<CombineMetadata<V2, { a: 1 }>['schemaVersion'], 2>>();
type CRM = CombinedReadEventMetadata<V2m, ReadEventMetadataWithGlobalPosition>;
// @ts-expect-error metadata has no schemaVersion
export const b10 = (m: CRM) => m.schemaVersion;

// b11: ReadEvent over the union narrows
export const b11 = (e: ReadEvent<Stored>) => {
  switch (e.schemaVersion) {
    case 2:
      return e.data.productItem;
    default:
      return e.data.productId;
  }
};

// b12: Extract by version
assertType<Equals<Extract<Stored, { schemaVersion: 2 }>, V2>>();
