import type {
  AggregateStreamOptions,
  AggregateStreamResult,
  AppendToStreamOptions,
  AppendToStreamResult,
  EventStore,
  EventStoreReadEventMetadata,
  ReadStreamOptions,
  ReadStreamResult,
  StreamPositionTypeOfEventStore,
} from '../eventStore';
import { type AnyEvent, type Event, type EventMetaDataOf } from '../typing';

export type TestEventStream<EventType extends AnyEvent = Event> = [
  string,
  EventType[],
];

export type EventStoreWrapper<Store extends EventStore> = Store & {
  appendedEvents: Map<string, TestEventStream>;
  setup<EventType extends AnyEvent>(
    streamName: string,
    events: EventType[],
  ): Promise<AppendToStreamResult<StreamPositionTypeOfEventStore<Store>>>;
};

export const WrapEventStore = <Store extends EventStore>(
  eventStore: Store,
): EventStoreWrapper<Store> => {
  const appendedEvents = new Map<string, TestEventStream>();

  const wrapped = {
    ...eventStore,
    aggregateStream<State, EventType extends AnyEvent>(
      streamName: string,
      options: AggregateStreamOptions<State, EventType>,
    ): Promise<
      AggregateStreamResult<State, StreamPositionTypeOfEventStore<Store>>
    > {
      return eventStore.aggregateStream(streamName, options);
    },

    async readStream<EventType extends AnyEvent>(
      streamName: string,
      options?: ReadStreamOptions<StreamPositionTypeOfEventStore<Store>>,
    ): Promise<
      ReadStreamResult<
        EventType,
        EventStoreReadEventMetadata<Store> & EventMetaDataOf<EventType>
      >
    > {
      return (await eventStore.readStream(
        streamName,
        options,
      )) as ReadStreamResult<
        EventType,
        EventStoreReadEventMetadata<Store> & EventMetaDataOf<EventType>
      >;
    },

    appendToStream: async <EventType extends AnyEvent>(
      streamName: string,
      events: EventType[],
      options?: AppendToStreamOptions<StreamPositionTypeOfEventStore<Store>>,
    ): Promise<AppendToStreamResult<StreamPositionTypeOfEventStore<Store>>> => {
      const result = await eventStore.appendToStream(
        streamName,
        events,
        options,
      );

      const currentStream = appendedEvents.get(streamName) ?? [streamName, []];

      appendedEvents.set(streamName, [
        streamName,
        [...currentStream[1], ...events],
      ]);

      return result;
    },

    appendedEvents,

    setup: async <EventType extends AnyEvent>(
      streamName: string,
      events: EventType[],
    ): Promise<AppendToStreamResult<StreamPositionTypeOfEventStore<Store>>> => {
      return eventStore.appendToStream(streamName, events);
    },

    // streamEvents: (): ReadableStream<
    //   // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
    //   ReadEvent<Event, ReadEventMetadataType> | GlobalSubscriptionEvent
    // > => {
    //   return eventStore.streamEvents();
    // },
  };

  return wrapped as EventStoreWrapper<Store>;
};
