import type {
  AnyEvent,
  AnyMessage,
  AnyRecordedMessage,
  Command,
  CommonRecordedMessageMetadata,
  Event,
  Message,
  ReadEvent,
  ReadEventMetadataWithGlobalPosition,
  RecordedMessage,
} from '@event-driven-io/emmett';
import { DefaultMessageSchemaVersion } from '@event-driven-io/emmett';
import {
  assertType,
  type C1,
  type C3,
  type Equals,
  type Stored,
  type V1,
  type V2,
} from './domain';

// c1
assertType<Equals<RecordedMessage<V2>['schemaVersion'], 2>>();
assertType<Equals<RecordedMessage<V1>['schemaVersion'], 1>>();
assertType<Equals<RecordedMessage<Event>['schemaVersion'], number>>();
assertType<Equals<RecordedMessage['schemaVersion'], number>>();
assertType<Equals<RecordedMessage<Message>['schemaVersion'], number>>();
assertType<Equals<RecordedMessage<Command>['schemaVersion'], number>>();
assertType<Equals<RecordedMessage<C3>['schemaVersion'], 3>>();
assertType<Equals<RecordedMessage<C1>['schemaVersion'], 1>>();
assertType<Equals<RecordedMessage<Stored>['schemaVersion'], 1 | 2>>();
assertType<Equals<ReadEvent<V2, ReadEventMetadataWithGlobalPosition>['schemaVersion'], 2>>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
assertType<Equals<RecordedMessage<AnyEvent>['schemaVersion'], any>>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
assertType<Equals<RecordedMessage<AnyMessage>['schemaVersion'], any>>();

// c2: narrowing on recorded unions
export const c2 = (e: RecordedMessage<Stored>) => {
  switch (e.schemaVersion) {
    case 2:
      return e.data.productItem;
    default:
      return e.data.productId;
  }
};
export const c2b = (e: RecordedMessage<Stored>) => {
  if (e.schemaVersion === 1) return e.data.productId;
  return e.data.productItem;
};

// c3: spec 3.1 not optional
export const c3 = (e: RecordedMessage) => {
  const n: number = e.schemaVersion;
  return n;
};

// c4: spec 3.2
// @ts-expect-error not part of the metadata type
export const c4 = (e: RecordedMessage) => e.metadata.schemaVersion;
// @ts-expect-error not part of the common metadata type
export const c4b = (m: CommonRecordedMessageMetadata) => m.schemaVersion;

// c5: the constant
assertType<Equals<typeof DefaultMessageSchemaVersion, 1>>();

// c6: AnyRecordedMessage keeps Message<any, any, any>
assertType<Equals<AnyRecordedMessage['schemaVersion'], number | undefined>>();

// c7: a recorded V1 value must carry schemaVersion 1, a recorded V2 value 2
export const c7 = (
  base: Omit<RecordedMessage<V1>, 'schemaVersion'>,
): RecordedMessage<V1> => ({ ...base, schemaVersion: 1 });
export const c7b = (
  base: Omit<RecordedMessage<V1>, 'schemaVersion'>,
  // @ts-expect-error a version other than 1 is not a recorded V1
): RecordedMessage<V1> => ({ ...base, schemaVersion: 2 });
