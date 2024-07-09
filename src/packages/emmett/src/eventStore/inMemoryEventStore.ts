import { v4 as uuid } from 'uuid';
import type {
  Event,
  ReadEvent,
  ReadEventMetadataWithGlobalPosition,
} from '../typing';
import {
  type AggregateStreamOptions,
  type AggregateStreamResult,
  type AppendToStreamOptions,
  type AppendToStreamResult,
  type DefaultStreamVersionType,
  type EventStore,
  type ReadStreamOptions,
  type ReadStreamResult,
} from './eventStore';
import { assertExpectedVersionMatchesCurrent } from './expectedVersion';
import { StreamingCoordinator } from './subscriptions';

export type EventHandler<E extends Event = Event> = (
  eventEnvelope: ReadEvent<E>,
) => void;

export const getInMemoryEventStore = (): EventStore<
  DefaultStreamVersionType,
  ReadEventMetadataWithGlobalPosition
> => {
  const streams = new Map<
    string,
    ReadEvent<Event, ReadEventMetadataWithGlobalPosition>[]
  >();
  const streamingCoordinator = StreamingCoordinator();

  const getAllEventsCount = () => {
    return Array.from<ReadEvent[]>(streams.values())
      .map((s) => s.length)
      .reduce((p, c) => p + c, 0);
  };

  return {
    async aggregateStream<State, EventType extends Event>(
      streamName: string,
      options: AggregateStreamOptions<State, EventType>,
    ): Promise<AggregateStreamResult<State> | null> {
      const { evolve, initialState, read } = options;

      const result = await this.readStream<EventType>(streamName, read);

      if (!result) return null;

      const events = result?.events ?? [];

      return {
        currentStreamVersion: BigInt(events.length),
        state: events.reduce(evolve, initialState()),
      };
    },

    readStream: <EventType extends Event>(
      streamName: string,
      options?: ReadStreamOptions,
    ): Promise<
      ReadStreamResult<
        EventType,
        DefaultStreamVersionType,
        ReadEventMetadataWithGlobalPosition
      >
    > => {
      const events = streams.get(streamName);
      const currentStreamVersion = events ? BigInt(events.length) : undefined;

      assertExpectedVersionMatchesCurrent(
        currentStreamVersion,
        options?.expectedStreamVersion,
      );

      const from = Number(options && 'from' in options ? options.from : 0);
      const to = Number(
        options && 'to' in options
          ? options.to
          : options && 'maxCount' in options && options.maxCount
            ? options.from + options.maxCount
            : events?.length ?? 1,
      );

      const resultEvents =
        events && events.length > 0
          ? events
              .map(
                (e) =>
                  e as ReadEvent<
                    EventType,
                    ReadEventMetadataWithGlobalPosition
                  >,
              )
              .slice(from, to)
          : [];

      const result: ReadStreamResult<
        EventType,
        DefaultStreamVersionType,
        ReadEventMetadataWithGlobalPosition
      > =
        events && events.length > 0
          ? {
              currentStreamVersion: currentStreamVersion!,
              events: resultEvents,
            }
          : null;

      return Promise.resolve(result);
    },

    appendToStream: async <EventType extends Event>(
      streamName: string,
      events: EventType[],
      options?: AppendToStreamOptions,
    ): Promise<AppendToStreamResult> => {
      const currentEvents = streams.get(streamName) ?? [];
      const currentStreamVersion =
        currentEvents.length > 0 ? BigInt(currentEvents.length) : undefined;

      assertExpectedVersionMatchesCurrent(
        currentStreamVersion,
        options?.expectedStreamVersion,
      );

      const newEvents: ReadEvent<
        EventType,
        ReadEventMetadataWithGlobalPosition
      >[] = events.map((event, index) => {
        return {
          ...event,
          metadata: {
            ...(event.metadata ?? {}),
            streamName,
            eventId: uuid(),
            streamPosition: BigInt(currentEvents.length + index + 1),
            globalPosition: BigInt(getAllEventsCount() + index + 1),
          },
        };
      });

      const positionOfLastEventInTheStream = BigInt(
        newEvents.slice(-1)[0]!.metadata.streamPosition,
      );

      streams.set(streamName, [...currentEvents, ...newEvents]);
      await streamingCoordinator.notify(newEvents);

      const result: AppendToStreamResult = {
        nextExpectedStreamVersion: positionOfLastEventInTheStream,
      };

      return result;
    },

    streamEvents: streamingCoordinator.stream,
  };
};
