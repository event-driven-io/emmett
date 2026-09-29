import {
  getInMemoryDatabase,
  type InMemoryDatabase,
} from '../database/inMemoryDatabase';
import { ValidationError } from '../errors';
import { withOperationScope } from '../observability';
import { bigIntProcessorCheckpoint } from '../processors';
import type { ProjectionRegistration } from '../projections';
import type {
  CombinedReadEventMetadata,
  Event,
  MessageHandlerContext,
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
  ListStreamsOptions,
  ListStreamsResult,
  ReadStreamOptions,
  ReadStreamResult,
  StreamExistsResult,
} from './eventStore';
import { assertExpectedVersionMatchesCurrent } from './expectedVersion';
import {
  eventStoreCollector,
  eventStoreObservability,
  type EventStoreObservabilityConfig,
} from './observability';
import { handleInMemoryProjections } from './projections/inMemory';
import {
  decodeStreamNameCursor,
  encodeStreamNameCursor,
} from './listStreamsCursor';
import { fromStreamName, type StreamName } from './streamName';
import { downcastRecordedMessages, upcastRecordedMessages } from './versioning';

export const InMemoryEventStoreDefaultStreamVersion = 0n;

export type InMemoryEventStore =
  EventStore<ReadEventMetadataWithGlobalPosition> & {
    database: InMemoryDatabase;
    listStreams: NonNullable<EventStore['listStreams']>;
  };

export type InMemoryReadEventMetadata = ReadEventMetadataWithGlobalPosition;

export type InMemoryProjectionHandlerContext = MessageHandlerContext<{
  eventStore?: InMemoryEventStore;
  database?: InMemoryDatabase;
}>;

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

  const observability = eventStoreObservability(eventStoreOptions);
  const collector = eventStoreCollector(observability);
  const readStreamFromMemory = <
    EventType extends Event,
    EventPayloadType extends Event = EventType,
  >(
    streamName: string,
    readOptions?: ReadStreamOptions<EventType, EventPayloadType>,
  ): Promise<
    ReadStreamResult<EventType, ReadEventMetadataWithGlobalPosition>
  > =>
    collector.instrumentRead(
      streamName,
      () => {
        const events = streams.get(streamName);
        const currentStreamVersion = events
          ? BigInt(events.length)
          : InMemoryEventStoreDefaultStreamVersion;

        assertExpectedVersionMatchesCurrent(
          currentStreamVersion,
          readOptions?.expectedStreamVersion,
          InMemoryEventStoreDefaultStreamVersion,
        );

        const from = readOptions?.from;
        const to = readOptions?.to;
        const maxCount = readOptions?.maxCount;

        const inRange = (events ?? [])
          .filter(
            (event) =>
              (from === undefined || event.metadata.streamPosition >= from) &&
              (to === undefined || event.metadata.streamPosition <= to),
          )
          .slice(0, maxCount !== undefined ? Number(maxCount) : undefined);

        const resultEvents =
          inRange.length > 0
            ? upcastRecordedMessages<
                EventType,
                EventPayloadType,
                ReadEventMetadataWithGlobalPosition
              >(
                inRange as ReadEvent<
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
      },
      readOptions?.observability,
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
      return collector.instrumentAggregate(
        streamName,
        async (scope) => {
          const { evolve, initialState, read } = options;

          const result = await readStreamFromMemory<
            EventType,
            EventPayloadType
          >(streamName, {
            ...(read ?? {}),
            observability: withOperationScope(scope, read?.observability),
          });

          const events = result?.events ?? [];

          const state = events.reduce((s, e) => evolve(s, e), initialState());

          return {
            currentStreamVersion: BigInt(events.length),
            state,
            streamExists: result.streamExists,
          };
        },
        options.observability,
      );
    },

    readStream: <
      EventType extends Event,
      EventPayloadType extends Event = EventType,
    >(
      streamName: string,
      readOptions?: ReadStreamOptions<EventType, EventPayloadType>,
    ): Promise<
      ReadStreamResult<EventType, ReadEventMetadataWithGlobalPosition>
    > => readStreamFromMemory(streamName, readOptions),

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
        async (scope) => {
          assertExpectedVersionMatchesCurrent(
            currentStreamVersion,
            options?.expectedStreamVersion,
            InMemoryEventStoreDefaultStreamVersion,
          );

          const context = scope.context;
          const newEvents: ReadEvent<
            EventType,
            ReadEventMetadataWithGlobalPosition
          >[] = events.map((event, index) => {
            const globalPosition = BigInt(getAllEventsCount() + index + 1);
            const messageId =
              observability.contextGenerator.generateMessageId();
            const metadata: ReadEventMetadataWithGlobalPosition = {
              streamName,
              messageId,
              streamPosition: BigInt(currentEvents.length + index + 1),
              globalPosition: bigIntProcessorCheckpoint(globalPosition),
              checkpoint: bigIntProcessorCheckpoint(globalPosition),
              correlationId: context.correlationId,
              causationId: context.causationId,
              traceId: context.traceId,
              spanId: context.spanId,
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
              startInlineProjectionScope: (fn) =>
                collector.instrumentInlineProjection(
                  streamName,
                  scope,
                  (child) => Promise.resolve(fn(child)),
                ),
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
        options?.observability,
      );
    },

    streamExists: (streamName): Promise<StreamExistsResult> => {
      const events = streams.get(streamName);

      return Promise.resolve(events !== undefined && events.length > 0);
    },

    /**
     * Lists streams ordered by name. `q` matches a case-sensitive substring of the name.
     * `streamType` matches the type of `type:id` stream names.
     */
    listStreams: ({
      limit,
      cursor,
      q,
      streamType,
    }: ListStreamsOptions): Promise<ListStreamsResult> => {
      const after =
        cursor !== undefined ? decodeStreamNameCursor(cursor) : undefined;

      if (cursor !== undefined && after === undefined)
        return Promise.reject(new ValidationError('Invalid cursor'));

      const matching = [...streams.entries()]
        .filter(([, events]) => events.length > 0)
        .map(([streamName]) => streamName)
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
        .filter((streamName) => after === undefined || streamName > after)
        .filter((streamName) => q === undefined || streamName.includes(q))
        .filter(
          (streamName) =>
            streamType === undefined ||
            (streamName.includes(':') &&
              fromStreamName(streamName as StreamName).streamType ===
                streamType),
        );

      const page = matching.slice(0, limit);
      const last = page[page.length - 1];

      return Promise.resolve({
        streams: page.map((streamName) => ({
          streamName,
          currentStreamVersion: BigInt(streams.get(streamName)!.length),
        })),
        ...(matching.length > limit && last !== undefined
          ? { nextCursor: encodeStreamNameCursor(last) }
          : {}),
      });
    },
  };

  return eventStore;
};
