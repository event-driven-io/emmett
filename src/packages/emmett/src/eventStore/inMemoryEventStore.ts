import { v4 as uuid } from 'uuid';
import {
  getInMemoryDatabase,
  type InMemoryDatabase,
} from '../database/inMemoryDatabase';
import { bigIntProcessorCheckpoint } from '../processors';
import type { ProjectionRegistration } from '../projections';
import type {
  CombinedReadEventMetadata,
  Event,
  ReadEvent,
  ReadEventMetadataWithGlobalPosition,
} from '../typing';
import { tryPublishMessagesAfterCommit } from './afterCommit';
import type {
  AggregateStreamOptions,
  AggregateStreamResult,
  AppendToStreamOptions,
  AppendToStreamResult,
  DefaultEventStoreOptions,
  EventStore,
  ReadStreamOptions,
  ReadStreamResult,
  StreamExistsResult,
} from './eventStore';
import { assertExpectedVersionMatchesCurrent } from './expectedVersion';
import { handleInMemoryProjections } from './projections/inMemory';
import { downcastRecordedMessages, upcastRecordedMessages } from './versioning';
import type { EventStoreObservabilityConfig } from '../observability';
import {
  eventStoreCollector,
  resolveEventStoreObservability,
} from '../observability';

export const InMemoryEventStoreDefaultStreamVersion = 0n;

export type InMemoryEventStore =
  EventStore<ReadEventMetadataWithGlobalPosition> & {
    database: InMemoryDatabase;
  };

export type InMemoryReadEventMetadata = ReadEventMetadataWithGlobalPosition;

export type InMemoryProjectionHandlerContext = {
  eventStore?: InMemoryEventStore;
  database?: InMemoryDatabase;
};

export type InMemoryEventStoreOptions =
  DefaultEventStoreOptions<InMemoryEventStore> & {
    projections?: ProjectionRegistration<
      'inline',
      InMemoryReadEventMetadata,
      InMemoryProjectionHandlerContext
    >[];
    database?: InMemoryDatabase;
    observability?: EventStoreObservabilityConfig;
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

  const getAllEventsCount = () => {
    return Array.from<ReadEvent[]>(streams.values())
      .map((s) => s.length)
      .reduce((p, c) => p + c, 0);
  };

  // Get the database instance to be used for projections
  const database = eventStoreOptions?.database || getInMemoryDatabase();

  // Extract inline projections from options
  const inlineProjections = (eventStoreOptions?.projections ?? [])
    .filter(({ type }) => type === 'inline')
    .map(({ projection }) => projection);

  const collector = eventStoreCollector(
    resolveEventStoreObservability(eventStoreOptions),
  );

  // Create the event store object
  const eventStore: InMemoryEventStore = {
    database,
    async aggregateStream<
      State,
      EventType extends Event,
      EventPayloadType extends Event = EventType,
    >(
      streamName: string,
      options: AggregateStreamOptions<
        State,
        EventType,
        ReadEventMetadataWithGlobalPosition,
        EventPayloadType
      >,
    ): Promise<AggregateStreamResult<State>> {
      const { evolve, initialState, read } = options;

      const result = await this.readStream<EventType, EventPayloadType>(
        streamName,
        read,
      );

      const events = result?.events ?? [];

      const state = events.reduce((s, e) => evolve(s, e), initialState());

      return {
        currentStreamVersion: BigInt(events.length),
        state,
        streamExists: result.streamExists,
      };
    },

    readStream: <
      EventType extends Event,
      EventPayloadType extends Event = EventType,
    >(
      streamName: string,
      readOptions?: ReadStreamOptions<EventType, EventPayloadType>,
    ): Promise<
      ReadStreamResult<EventType, ReadEventMetadataWithGlobalPosition>
    > =>
      collector.instrumentRead(streamName, () => {
        const events = streams.get(streamName);
        const currentStreamVersion = events
          ? BigInt(events.length)
          : InMemoryEventStoreDefaultStreamVersion;

        assertExpectedVersionMatchesCurrent(
          currentStreamVersion,
          readOptions?.expectedStreamVersion,
          InMemoryEventStoreDefaultStreamVersion,
        );

        const from = Number(readOptions?.from ?? 0);
        const to = Number(
          readOptions?.to ??
            (readOptions?.maxCount
              ? (readOptions.from ?? 0n) + readOptions.maxCount
              : (events?.length ?? 1)),
        );

        const resultEvents =
          events !== undefined && events.length > 0
            ? upcastRecordedMessages<
                EventType,
                EventPayloadType,
                ReadEventMetadataWithGlobalPosition
              >(
                events.slice(from, to) as ReadEvent<
                  EventPayloadType,
                  ReadEventMetadataWithGlobalPosition
                >[],
                readOptions?.schema?.versioning,
              )
            : [];

        return Promise.resolve({
          currentStreamVersion,
          events: resultEvents,
          streamExists: events !== undefined && events.length > 0,
        });
      }),

    appendToStream: <
      EventType extends Event,
      EventPayloadType extends Event = EventType,
    >(
      streamName: string,
      events: EventType[],
      options?: AppendToStreamOptions<EventType, EventPayloadType>,
    ): Promise<AppendToStreamResult> => {
      const currentEvents = streams.get(streamName) ?? [];
      const currentStreamVersion =
        currentEvents.length > 0
          ? BigInt(currentEvents.length)
          : InMemoryEventStoreDefaultStreamVersion;

      return collector.instrumentAppend(
        streamName,
        events,
        currentStreamVersion,
        async () => {
          assertExpectedVersionMatchesCurrent(
            currentStreamVersion,
            options?.expectedStreamVersion,
            InMemoryEventStoreDefaultStreamVersion,
          );

          const newEvents: ReadEvent<
            EventType,
            ReadEventMetadataWithGlobalPosition
          >[] = events.map((event, index) => {
            const globalPosition = BigInt(getAllEventsCount() + index + 1);
            const metadata: ReadEventMetadataWithGlobalPosition = {
              streamName,
              messageId: uuid(),
              streamPosition: BigInt(currentEvents.length + index + 1),
              globalPosition,
              checkpoint: bigIntProcessorCheckpoint(globalPosition),
              ...(options?.correlationId
                ? { correlationId: options.correlationId }
                : {}),
              ...(options?.causationId
                ? { causationId: options.causationId }
                : {}),
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

          streams.set(streamName, [
            ...currentEvents,
            ...downcastRecordedMessages(newEvents, options?.schema?.versioning),
          ]);

          // Process projections if there are any registered
          if (inlineProjections.length > 0) {
            await handleInMemoryProjections({
              projections: inlineProjections,
              events: newEvents,
              database: eventStore.database,
              eventStore,
            });
          }

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
      );
    },

    streamExists: (streamName): Promise<StreamExistsResult> => {
      const events = streams.get(streamName);

      return Promise.resolve(events !== undefined && events.length > 0);
    },
  };

  return eventStore;
};
