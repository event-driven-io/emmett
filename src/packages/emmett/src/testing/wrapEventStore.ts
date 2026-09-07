import {
  canCreateEventStoreSession,
  type AggregateStreamOptions,
  type AggregateStreamResult,
  type AppendToStreamOptions,
  type AppendToStreamResult,
  type EventStore,
  type EventStoreReadEventMetadata,
  type EventStoreSession,
  type EventStoreSessionFactory,
  type ReadStreamOptions,
  type ReadStreamResult,
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
): EventStoreWrapper<Store> =>
  wrapEventStore(eventStore, new Map<string, TestEventStream>());

const wrapEventStore = <Store extends EventStore>(
  eventStore: Store,
  appendedEvents: Map<string, TestEventStream>,
): EventStoreWrapper<Store> => {
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
  };

  if (canCreateEventStoreSession(eventStore))
    Object.assign(
      wrapped,
      sessionsRecordingAppendedEvents(eventStore, appendedEvents),
    );

  return wrapped;
};

const sessionsRecordingAppendedEvents = <Store extends EventStore>(
  sessionFactory: EventStoreSessionFactory<Store>,
  appendedEvents: Map<string, TestEventStream>,
): EventStoreSessionFactory<Store> => ({
  withSession: <T = unknown>(
    callback: (session: EventStoreSession<Store>) => Promise<T>,
  ): Promise<T> =>
    sessionFactory.withSession((session) =>
      callback({
        ...session,
        eventStore: wrapEventStore(session.eventStore, appendedEvents),
      }),
    ),
});
