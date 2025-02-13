import { v4 as uuid } from 'uuid';
import type {
  BigIntStreamPosition,
  CombinedReadEventMetadata,
  Event,
  ReadEvent,
  ReadEventMetadataWithGlobalPosition,
} from '../typing';
import { tryPublishMessagesAfterCommit } from './afterCommit';
import {
  type AggregateStreamOptions,
  type AggregateStreamResult,
  type AppendToStreamOptions,
  type AppendToStreamResult,
  type DefaultEventStoreOptions,
  type EventStore,
  type ReadStreamOptions,
  type ReadStreamResult,
} from './eventStore';
import { assertExpectedVersionMatchesCurrent } from './expectedVersion';
import { StreamingCoordinator } from './subscriptions';
import type { ProjectionRegistration } from '../projections';

export const InMemoryEventStoreDefaultStreamVersion = 0n;

export type InMemoryEventStore =
  EventStore<ReadEventMetadataWithGlobalPosition>;

export type InMemoryReadEventMetadata = ReadEventMetadataWithGlobalPosition;

export type InMemoryProjectionHandlerContext = {
  eventStore: InMemoryEventStore;
};

export type InMemoryEventStoreOptions =
  DefaultEventStoreOptions<InMemoryEventStore> & {
    projections?: ProjectionRegistration<
      'inline',
      InMemoryReadEventMetadata,
      InMemoryProjectionHandlerContext
    >[];
  };

export type InMemoryReadEvent<EventType extends Event = Event> = ReadEvent<
  EventType,
  ReadEventMetadataWithGlobalPosition
>;

export const getInMemoryEventStore = (
  eventStoreOptions?: InMemoryEventStoreOptions,
): InMemoryEventStore => {
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

  const _inlineProjections = (eventStoreOptions?.projections ?? [])
    .filter(({ type }) => type === 'inline')
    .map(({ projection }) => projection);

  return {
    async aggregateStream<State, EventType extends Event>(
      streamName: string,
      options: AggregateStreamOptions<
        State,
        EventType,
        ReadEventMetadataWithGlobalPosition
      >,
    ): Promise<AggregateStreamResult<State>> {
      const { evolve, initialState, read } = options;

      const result = await this.readStream<EventType>(streamName, read);

      const events = result?.events ?? [];

      return {
        currentStreamVersion: BigInt(events.length),
        state: events.reduce(evolve, initialState()),
        streamExists: result.streamExists,
      };
    },

    readStream: <EventType extends Event>(
      streamName: string,
      options?: ReadStreamOptions<BigIntStreamPosition>,
    ): Promise<
      ReadStreamResult<EventType, ReadEventMetadataWithGlobalPosition>
    > => {
      const events = streams.get(streamName);
      const currentStreamVersion = events
        ? BigInt(events.length)
        : InMemoryEventStoreDefaultStreamVersion;

      assertExpectedVersionMatchesCurrent(
        currentStreamVersion,
        options?.expectedStreamVersion,
        InMemoryEventStoreDefaultStreamVersion,
      );

      const from = Number(options && 'from' in options ? options.from : 0);
      const to = Number(
        options && 'to' in options
          ? options.to
          : options && 'maxCount' in options && options.maxCount
            ? options.from + options.maxCount
            : (events?.length ?? 1),
      );

      const resultEvents =
        events !== undefined && events.length > 0
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
        ReadEventMetadataWithGlobalPosition
      > = {
        currentStreamVersion,
        events: resultEvents,
        streamExists: events !== undefined && events.length > 0,
      };

      return Promise.resolve(result);
    },

    appendToStream: async <EventType extends Event>(
      streamName: string,
      events: EventType[],
      options?: AppendToStreamOptions,
    ): Promise<AppendToStreamResult> => {
      const currentEvents = streams.get(streamName) ?? [];
      const currentStreamVersion =
        currentEvents.length > 0
          ? BigInt(currentEvents.length)
          : InMemoryEventStoreDefaultStreamVersion;

      assertExpectedVersionMatchesCurrent(
        currentStreamVersion,
        options?.expectedStreamVersion,
        InMemoryEventStoreDefaultStreamVersion,
      );

      const newEvents: ReadEvent<
        EventType,
        ReadEventMetadataWithGlobalPosition
      >[] = events.map((event, index) => {
        const metadata: ReadEventMetadataWithGlobalPosition = {
          streamName,
          messageId: uuid(),
          streamPosition: BigInt(currentEvents.length + index + 1),
          globalPosition: BigInt(getAllEventsCount() + index + 1),
        };
        return {
          ...event,
          kind: event.kind ?? 'Event',
          metadata: {
            ...('metadata' in event ? (event.metadata ?? {}) : {}),
            ...metadata,
          } as CombinedReadEventMetadata<
            EventType,
            ReadEventMetadataWithGlobalPosition
          >,
        };
      });

      const positionOfLastEventInTheStream = BigInt(
        newEvents.slice(-1)[0]!.metadata.streamPosition,
      );

      streams.set(streamName, [...currentEvents, ...newEvents]);
      await streamingCoordinator.notify(newEvents);

      const result: AppendToStreamResult = {
        nextExpectedStreamVersion: positionOfLastEventInTheStream,
        createdNewStream:
          currentStreamVersion === InMemoryEventStoreDefaultStreamVersion,
      };

      await tryPublishMessagesAfterCommit<InMemoryEventStore>(
        newEvents,
        eventStoreOptions?.hooks,
      );

      return result;
    },

    //streamEvents: streamingCoordinator.stream,
  };
};
