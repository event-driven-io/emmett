//import type { ReadableStream } from 'web-streams-polyfill';
import type {
  BigIntGlobalPosition,
  BigIntStreamPosition,
  Event,
  EventMetaDataOf,
  GlobalPositionTypeOfReadEventMetadata,
  ReadEvent,
  ReadEventMetadata,
  StreamPositionTypeOfReadEventMetadata,
} from '../typing';
//import type { GlobalSubscriptionEvent } from './events';
import type { ExpectedStreamVersion } from './expectedVersion';

// #region event-store
export interface EventStore<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ReadEventMetadataType extends ReadEventMetadata<any, any> = ReadEventMetadata<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    any
  >,
> {
  aggregateStream<State, EventType extends Event>(
    streamName: string,
    options: AggregateStreamOptions<
      State,
      EventType,
      ReadEventMetadataType & EventMetaDataOf<EventType>
    >,
  ): Promise<
    AggregateStreamResult<
      State,
      StreamPositionTypeOfReadEventMetadata<ReadEventMetadataType>
    >
  >;

  readStream<EventType extends Event>(
    streamName: string,
    options?: ReadStreamOptions<
      StreamPositionTypeOfReadEventMetadata<ReadEventMetadataType>
    >,
  ): Promise<
    ReadStreamResult<
      EventType,
      ReadEventMetadataType & EventMetaDataOf<EventType>
    >
  >;

  appendToStream<EventType extends Event>(
    streamName: string,
    events: EventType[],
    options?: AppendToStreamOptions<
      StreamPositionTypeOfReadEventMetadata<ReadEventMetadataType>
    >,
  ): Promise<
    AppendToStreamResult<
      StreamPositionTypeOfReadEventMetadata<ReadEventMetadataType>
    >
  >;

  // streamEvents(): ReadableStream<
  //   ReadEvent<Event, ReadEventMetadataType> | GlobalSubscriptionEvent
  // >;
}

export type EventStoreReadEventMetadata<Store extends EventStore> =
  Store extends EventStore<infer ReadEventMetadataType>
    ? ReadEventMetadataType extends ReadEventMetadata<infer GV, infer SV>
      ? ReadEventMetadata<GV, SV> & ReadEventMetadataType
      : never
    : never;

export type GlobalPositionTypeOfEventStore<Store extends EventStore> =
  GlobalPositionTypeOfReadEventMetadata<EventStoreReadEventMetadata<Store>>;

export type StreamPositionTypeOfEventStore<Store extends EventStore> =
  StreamPositionTypeOfReadEventMetadata<EventStoreReadEventMetadata<Store>>;

export type EventStoreSession<EventStoreType extends EventStore> = {
  eventStore: EventStoreType;
  close: () => Promise<void>;
};

export interface EventStoreSessionFactory<EventStoreType extends EventStore> {
  withSession<T = unknown>(
    callback: (session: EventStoreSession<EventStoreType>) => Promise<T>,
  ): Promise<T>;
}
// #endregion event-store

export const canCreateEventStoreSession = <Store extends EventStore>(
  eventStore: Store | EventStoreSessionFactory<Store>,
): eventStore is EventStoreSessionFactory<Store> => 'withSession' in eventStore;

export const nulloSessionFactory = <EventStoreType extends EventStore>(
  eventStore: EventStoreType,
): EventStoreSessionFactory<EventStoreType> => ({
  withSession: (callback) => {
    const nulloSession: EventStoreSession<EventStoreType> = {
      eventStore,
      close: () => Promise.resolve(),
    };

    return callback(nulloSession);
  },
});

////////////////////////////////////////////////////////////////////
/// ReadStream types
////////////////////////////////////////////////////////////////////

export type ReadStreamOptions<StreamVersion = BigIntStreamPosition> = (
  | {
      from: StreamVersion;
    }
  | { to: StreamVersion }
  | { from: StreamVersion; maxCount?: bigint }
  | {
      expectedStreamVersion: ExpectedStreamVersion<StreamVersion>;
    }
) & {
  expectedStreamVersion?: ExpectedStreamVersion<StreamVersion>;
};

export type ReadStreamResult<
  EventType extends Event,
  ReadEventMetadataType extends EventMetaDataOf<EventType> &
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ReadEventMetadata<any, any> = EventMetaDataOf<EventType> &
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ReadEventMetadata<any, bigint>,
> = {
  currentStreamVersion: StreamPositionTypeOfReadEventMetadata<ReadEventMetadataType>;
  events: ReadEvent<
    EventType,
    ReadEventMetadataType & EventMetaDataOf<EventType>
  >[];
  streamExists: boolean;
};

////////////////////////////////////////////////////////////////////
/// AggregateStream types
////////////////////////////////////////////////////////////////////

type Evolve<
  State,
  EventType extends Event,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ReadEventMetadataType extends ReadEventMetadata<any, any> &
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    EventMetaDataOf<EventType> = ReadEventMetadata<any, any> &
    EventMetaDataOf<EventType>,
> =
  | ((currentState: State, event: EventType) => State)
  | ((
      currentState: State,
      event: ReadEvent<EventType, ReadEventMetadataType>,
    ) => State)
  | ((currentState: State, event: ReadEvent<EventType>) => State);

export type AggregateStreamOptions<
  State,
  EventType extends Event,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ReadEventMetadataType extends ReadEventMetadata<any, any> &
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    EventMetaDataOf<EventType> = ReadEventMetadata<any, any> &
    EventMetaDataOf<EventType>,
> = {
  evolve: Evolve<State, EventType, ReadEventMetadataType>;
  initialState: () => State;
  read?: ReadStreamOptions<
    StreamPositionTypeOfReadEventMetadata<ReadEventMetadataType>
  >;
};

export type AggregateStreamResult<
  State,
  StreamPosition = BigIntStreamPosition,
> = {
  currentStreamVersion: StreamPosition;
  state: State;
  streamExists: boolean;
};

export type AggregateStreamResultWithGlobalPosition<
  State,
  StreamPosition = BigIntStreamPosition,
  GlobalPosition = BigIntGlobalPosition,
> =
  | (AggregateStreamResult<State, StreamPosition> & {
      streamExists: true;
      lastEventGlobalPosition: GlobalPosition;
    })
  | (AggregateStreamResult<State, StreamPosition> & {
      streamExists: false;
    });

export type AggregateStreamResultOfEventStore<Store extends EventStore> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Store['aggregateStream'] extends (...args: any[]) => Promise<infer R>
    ? R
    : never;

////////////////////////////////////////////////////////////////////
/// AppendToStream types
////////////////////////////////////////////////////////////////////

export type AppendToStreamOptions<StreamVersion = BigIntStreamPosition> = {
  expectedStreamVersion?: ExpectedStreamVersion<StreamVersion>;
};

export type AppendToStreamResult<StreamVersion = BigIntStreamPosition> = {
  nextExpectedStreamVersion: StreamVersion;
  createdNewStream: boolean;
};

export type AppendToStreamResultWithGlobalPosition<
  StreamVersion = BigIntStreamPosition,
  GlobalPosition = BigIntGlobalPosition,
> = AppendToStreamResult<StreamVersion> & {
  lastEventGlobalPosition: GlobalPosition;
};

export type AppendStreamResultOfEventStore<Store extends EventStore> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Store['appendToStream'] extends (...args: any[]) => Promise<infer R>
    ? R
    : never;
