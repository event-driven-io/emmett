import type {
  AggregateStreamOptions,
  AggregateStreamResult,
  AppendToStreamOptions,
  AppendToStreamResult,
  DefaultStreamVersionType,
  Event,
  EventStore,
  ReadStreamOptions,
  ReadStreamResult,
} from '@event-driven-io/emmett';

export type TestEventStream<EventType extends Event = Event> = [
  string,
  EventType[],
];

export const WrapEventStore = <StreamVersion = DefaultStreamVersionType>(
  eventStore: EventStore<StreamVersion>,
): EventStore<StreamVersion> & {
  appendedEvents: Map<string, TestEventStream>;
  setup<EventType extends Event>(
    streamName: string,
    events: EventType[],
  ): Promise<AppendToStreamResult<StreamVersion>>;
} => {
  const appendedEvents = new Map<string, TestEventStream>();

  return {
    async aggregateStream<State, EventType extends Event>(
      streamName: string,
      options: AggregateStreamOptions<State, EventType, StreamVersion>,
    ): Promise<AggregateStreamResult<State, StreamVersion> | null> {
      return eventStore.aggregateStream(streamName, options);
    },

    readStream<EventType extends Event>(
      streamName: string,
      options?: ReadStreamOptions<StreamVersion>,
    ): Promise<ReadStreamResult<EventType, StreamVersion>> {
      return eventStore.readStream(streamName, options);
    },

    appendToStream: async <EventType extends Event>(
      streamName: string,
      events: EventType[],
      options?: AppendToStreamOptions<StreamVersion>,
    ): Promise<AppendToStreamResult<StreamVersion>> => {
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
    ): Promise<AppendToStreamResult<StreamVersion>> => {
      return eventStore.appendToStream(streamName, events);
    },
  };
};
