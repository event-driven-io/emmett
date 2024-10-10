//import type { ReadableStream } from '@event-driven-io/emmett-shims';
import type { Event, ReadEvent, ReadEventMetadata } from '../typing';
//import type { GlobalSubscriptionEvent } from './events';
import type { ExpectedStreamVersion } from './expectedVersion';

// #region event-store
export interface EventStore<
  StreamVersion = DefaultStreamVersionType,
  ReadEventMetadataType extends ReadEventMetadata = ReadEventMetadata,
> {
  aggregateStream<State, EventType extends Event>(
    streamName: string,
    options: AggregateStreamOptions<
      State,
      EventType,
      StreamVersion,
      ReadEventMetadataType
    >,
  ): Promise<AggregateStreamResult<State, StreamVersion>>;

  readStream<EventType extends Event>(
    streamName: string,
    options?: ReadStreamOptions<StreamVersion>,
  ): Promise<ReadStreamResult<EventType, StreamVersion, ReadEventMetadataType>>;

  appendToStream<EventType extends Event>(
    streamName: string,
    events: EventType[],
    options?: AppendToStreamOptions<StreamVersion>,
  ): Promise<AppendToStreamResult<StreamVersion>>;

  // streamEvents(): ReadableStream<
  //   ReadEvent<Event, ReadEventMetadataType> | GlobalSubscriptionEvent
  // >;
}

export type EventStoreSession<
  EventStoreType extends EventStore<StreamVersion>,
  StreamVersion = DefaultStreamVersionType,
> = {
  eventStore: EventStoreType;
  close: () => Promise<void>;
};

export interface EventStoreSessionFactory<
  EventStoreType extends EventStore<StreamVersion>,
  StreamVersion = DefaultStreamVersionType,
> {
  withSession<T = unknown>(
    callback: (
      session: EventStoreSession<EventStoreType, StreamVersion>,
    ) => Promise<T>,
  ): Promise<T>;
}

export type DefaultStreamVersionType = bigint;
// #endregion event-store

export const canCreateEventStoreSession = <
  Store extends EventStore<StreamVersion>,
  StreamVersion = DefaultStreamVersionType,
>(
  eventStore: Store | EventStoreSessionFactory<Store, StreamVersion>,
): eventStore is EventStoreSessionFactory<Store, StreamVersion> =>
  'withSession' in eventStore;

export const nulloSessionFactory = <
  EventStoreType extends EventStore<StreamVersion>,
  StreamVersion = DefaultStreamVersionType,
>(
  eventStore: EventStoreType,
): EventStoreSessionFactory<EventStoreType, StreamVersion> => ({
  withSession: (callback) => {
    const nulloSession: EventStoreSession<EventStoreType, StreamVersion> = {
      eventStore,
      close: () => Promise.resolve(),
    };

    return callback(nulloSession);
  },
});

////////////////////////////////////////////////////////////////////
/// ReadStream types
////////////////////////////////////////////////////////////////////

export type ReadStreamOptions<StreamVersion = DefaultStreamVersionType> = (
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
  StreamVersion = DefaultStreamVersionType,
  ReadEventMetadataType extends ReadEventMetadata = ReadEventMetadata,
> = {
  currentStreamVersion: StreamVersion;
  events: ReadEvent<EventType, ReadEventMetadataType>[];
  streamExists: boolean;
};

////////////////////////////////////////////////////////////////////
/// AggregateStream types
////////////////////////////////////////////////////////////////////

type Evolve<
  State,
  EventType extends Event,
  ReadEventMetadataType extends ReadEventMetadata = ReadEventMetadata,
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
  StreamVersion = DefaultStreamVersionType,
  ReadEventMetadataType extends ReadEventMetadata = ReadEventMetadata,
> = {
  evolve: Evolve<State, EventType, ReadEventMetadataType>;
  initialState: () => State;
  read?: ReadStreamOptions<StreamVersion>;
};

export type AggregateStreamResult<
  State,
  StreamVersion = DefaultStreamVersionType,
> = {
  currentStreamVersion: StreamVersion;
  state: State;
  streamExists: boolean;
};

////////////////////////////////////////////////////////////////////
/// AppendToStream types
////////////////////////////////////////////////////////////////////

export type AppendToStreamOptions<StreamVersion = DefaultStreamVersionType> = {
  expectedStreamVersion?: ExpectedStreamVersion<StreamVersion>;
};

export type AppendToStreamResult<StreamVersion = DefaultStreamVersionType> = {
  nextExpectedStreamVersion: StreamVersion;
  createdNewStream: boolean;
};
