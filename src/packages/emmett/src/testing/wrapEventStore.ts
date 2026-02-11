import type {
  AggregateStreamOptions,
  AggregateStreamResult,
  AppendToStreamOptions,
  AppendToStreamResult,
  EventStore,
  EventStoreReadEventMetadata,
  ReadStreamOptions,
  ReadStreamResult,
} from '../eventStore';
import type { Event, EventMetaDataOf } from '../typing';

export type TestEventStream<EventType extends Event = Event> = [
  string,
  EventType[],
];

export type EventStoreWrapper<Store extends EventStore> = Store & {
  appendedEvents: Map<string, TestEventStream>;
  setup<EventType extends Event>(
    streamName: string,
    events: EventType[],
  ): Promise<AppendToStreamResult>;
};

export const WrapEventStore = <Store extends EventStore>(
  eventStore: Store,
): EventStoreWrapper<Store> => {
  const appendedEvents = new Map<string, TestEventStream>();

  const wrapped = {
    ...eventStore,
    aggregateStream<State, EventType extends Event>(
      streamName: string,
      options: AggregateStreamOptions<State, EventType>,
    ): Promise<AggregateStreamResult<State>> {
      return eventStore.aggregateStream(streamName, options);
    },

    async readStream<EventType extends Event>(
      streamName: string,
      options?: ReadStreamOptions<EventType>,
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

    appendToStream: async <EventType extends Event>(
      streamName: string,
      events: EventType[],
      options?: AppendToStreamOptions<EventType>,
    ): Promise<AppendToStreamResult> => {
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

    setup: async <EventType extends Event>(
      streamName: string,
      events: EventType[],
    ): Promise<AppendToStreamResult> => {
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
