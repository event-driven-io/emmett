import type {
  AnyReadEventMetadata,
  BigIntGlobalPosition,
  BigIntStreamPosition,
  CommonReadEventMetadata,
  DefaultRecord,
  Event,
  GlobalPositionTypeOfReadEventMetadata,
  ReadEvent,
  ReadEventMetadata,
  StreamPositionTypeOfReadEventMetadata,
  WithGlobalPosition,
} from '../typing';
import type { AfterEventStoreCommitHandler } from './afterCommit';
//import type { GlobalSubscriptionEvent } from './events';
import type { ExpectedStreamVersion } from './expectedVersion';

// #region event-store
export interface EventStore<
  ReadEventMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
> {
  aggregateStream<
    State,
    EventType extends Event,
    EventPayloadType extends Event = EventType,
  >(
    streamName: string,
    options: AggregateStreamOptions<
      State,
      EventType,
      ReadEventMetadataType,
      EventPayloadType
    >,
  ): Promise<
    AggregateStreamResult<
      State,
      StreamPositionTypeOfReadEventMetadata<ReadEventMetadataType>
    >
  >;

  readStream<
    EventType extends Event,
    EventPayloadType extends Event = EventType,
  >(
    streamName: string,
    options?: ReadStreamOptions<
      StreamPositionTypeOfReadEventMetadata<ReadEventMetadataType>,
      EventType,
      EventPayloadType
    >,
  ): Promise<ReadStreamResult<EventType, ReadEventMetadataType>>;

  appendToStream<
    EventType extends Event,
    EventPayloadType extends Event = EventType,
  >(
    streamName: string,
    events: EventType[],
    options?: AppendToStreamOptions<
      StreamPositionTypeOfReadEventMetadata<ReadEventMetadataType>,
      EventType,
      EventPayloadType
    >,
  ): Promise<
    AppendToStreamResult<
      StreamPositionTypeOfReadEventMetadata<ReadEventMetadataType>
    >
  >;

  streamExists(streamName: string): Promise<StreamExistsResult>;

  // streamEvents(): ReadableStream<
  //   ReadEvent<Event, ReadEventMetadataType> | GlobalSubscriptionEvent
  // >;
}

export type EventStoreReadEventMetadata<Store extends EventStore> =
  Store extends EventStore<infer T>
    ? T extends CommonReadEventMetadata<infer SP>
      ? T extends WithGlobalPosition<infer GP>
        ? ReadEventMetadata<GP, SP> & T
        : ReadEventMetadata<undefined, SP> & T
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
/// Schema Versioning types
////////////////////////////////////////////////////////////////////

export type EventStoreReadSchemaOptions<
  StreamEvent extends Event = Event,
  StoredEvent extends Event = StreamEvent,
> = {
  versioning?: {
    upcast?: (event: StoredEvent) => StreamEvent;
  };
};

export type EventStoreAppendSchemaOptions<
  StreamEvent extends Event = Event,
  StoredEvent extends Event = StreamEvent,
> = {
  versioning?: {
    downcast?: (event: StreamEvent) => StoredEvent;
  };
};

export type EventStoreSchemaOptions<
  StreamEvent extends Event = Event,
  StoredEvent extends Event = StreamEvent,
> = EventStoreReadSchemaOptions<StreamEvent, StoredEvent> &
  EventStoreAppendSchemaOptions<StreamEvent, StoredEvent>;

////////////////////////////////////////////////////////////////////
/// ReadStream types
////////////////////////////////////////////////////////////////////

export type ReadStreamOptions<
  StreamVersion = BigIntStreamPosition,
  EventType extends Event = Event,
  EventPayloadType extends Event = EventType,
> = {
  from?: StreamVersion;
  to?: StreamVersion;
  maxCount?: bigint;
  expectedStreamVersion?: ExpectedStreamVersion<StreamVersion>;
  schema?: EventStoreReadSchemaOptions<EventType, EventPayloadType>;
};

export type ReadStreamResult<
  EventType extends Event,
  ReadEventMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
> = {
  currentStreamVersion: StreamPositionTypeOfReadEventMetadata<ReadEventMetadataType>;
  events: ReadEvent<EventType, ReadEventMetadataType>[];
  streamExists: boolean;
};

////////////////////////////////////////////////////////////////////
/// AggregateStream types
////////////////////////////////////////////////////////////////////

type Evolve<
  State,
  EventType extends Event,
  ReadEventMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
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
  ReadEventMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  EventPayloadType extends Event = EventType,
> = {
  evolve: Evolve<State, EventType, ReadEventMetadataType>;
  initialState: () => State;
  read?: ReadStreamOptions<
    StreamPositionTypeOfReadEventMetadata<ReadEventMetadataType>,
    EventType,
    EventPayloadType
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

export type AppendToStreamOptions<
  StreamVersion = BigIntStreamPosition,
  EventType extends Event = Event,
  EventPayloadType extends Event = EventType,
> = {
  expectedStreamVersion?: ExpectedStreamVersion<StreamVersion>;
  schema?: EventStoreAppendSchemaOptions<EventType, EventPayloadType>;
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

////////////////////////////////////////////////////////////////////
/// StreamExists types
////////////////////////////////////////////////////////////////////

export type StreamExistsResult = boolean;

////////////////////////////////////////////////////////////////////
/// DefaultEventStoreOptions
////////////////////////////////////////////////////////////////////

export type DefaultEventStoreOptions<
  Store extends EventStore,
  HandlerContext extends DefaultRecord | undefined = undefined,
> = {
  /**
   * Pluggable set of hooks informing about the event store internal behaviour.
   */
  hooks?: {
    /**
     * This hook will be called **AFTER** events were stored in the event store.
     * It's designed to handle scenarios where delivery and ordering guarantees do not matter much.
     *
     * **WARNINGS:**
     *
     *  1. It will be called **EXACTLY ONCE** if append succeded.
     *  2. If the hook fails, its append **will still silently succeed**, and no error will be thrown.
     *  3. Wen process crashes after events were committed, but before the hook was called, delivery won't be retried.
     * That can lead to state inconsistencies.
     *  4. In the case of high concurrent traffic, **race conditions may cause ordering issues**.
     * For instance, where the second hook takes longer to process than the first one, ordering won't be guaranteed.
     *
     * @type {AfterEventStoreCommitHandler<Store, HandlerContext>}
     */
    onAfterCommit?: AfterEventStoreCommitHandler<Store, HandlerContext>;
  };
};
