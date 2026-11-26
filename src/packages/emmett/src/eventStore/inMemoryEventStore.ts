import { inMemoryMessageSource } from '../consumers/inMemoryMessageSource';
import {
  boundedMessageQueue,
  type BoundedMessageQueue,
  type MessageSource,
} from '../consumers/messageSources';
import {
  getInMemoryDatabase,
  type InMemoryDatabase,
} from '../database/inMemoryDatabase';
import { mergeObservability, withOperationScope } from '../observability';
import {
  bigIntProcessorCheckpoint,
  getCheckpoint,
  type InMemoryProjectorOptions,
} from '../processors';
import type {
  ProjectionHandlingType,
  ProjectionRegistration,
} from '../projections';
import type {
  AnyEvent,
  AnyMessage,
  CombinedReadEventMetadata,
  Event,
  Message,
  MessageHandlerContext,
  ReadEvent,
  ReadEventMetadataWithGlobalPosition,
} from '../typing';
import { tryPublishMessagesAfterCommit } from './afterCommit';
import {
  inMemoryEventStoreConsumer,
  type InMemoryEventStoreConsumer,
  type InMemoryEventStoreConsumerConfig,
} from './consumers';
import type {
  AggregateStreamOptions,
  AggregateStreamResult,
  AppendToStreamOptions,
  AppendToStreamResultWithGlobalPosition,
  DefaultEventStoreOptions,
  EventStore,
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
  downcastRecordedMessages,
  resolveSchemaVersion,
  upcastRecordedMessages,
  schemaVersionToAppend,
  withoutSchemaVersion,
} from './versioning';

export const InMemoryEventStoreDefaultStreamVersion = 0n;

export interface InMemoryEventStore extends EventStore<ReadEventMetadataWithGlobalPosition> {
  database: InMemoryDatabase;
  appendToStream<
    EventType extends Event,
    EventPayloadType extends Event = EventType,
  >(
    streamName: string,
    events: EventType[],
    options?: AppendToStreamOptions<EventType, EventPayloadType>,
  ): Promise<AppendToStreamResultWithGlobalPosition>;
  consumer<ConsumerMessageType extends Message = AnyMessage>(
    options?: InMemoryEventStoreConsumerConfig<ConsumerMessageType> & {
      includeAsyncProjections?: boolean;
    },
  ): InMemoryEventStoreConsumer<ConsumerMessageType>;
}

export type InMemoryReadEventMetadata = ReadEventMetadataWithGlobalPosition;

export type InMemoryProjectionHandlerContext = MessageHandlerContext<{
  database?: InMemoryDatabase;
}>;

export type InMemoryEventStoreOptions =
  DefaultEventStoreOptions<InMemoryEventStore> & {
    projections?: ProjectionRegistration<
      ProjectionHandlingType,
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
  const allEvents: InMemoryReadEvent[] = [];
  const subscriptions = new Set<BoundedMessageQueue<InMemoryReadEvent[]>>();

  const subscribeToAllEvents = () => {
    const appended = boundedMessageQueue<InMemoryReadEvent[]>();
    const closed = new AbortController();
    subscriptions.add(appended);

    return inMemoryMessageSource<Event, ReadEventMetadataWithGlobalPosition>({
      messages: (async function* () {
        yield allEvents;
        yield* appended.iterate(closed.signal);
      })(),
      readLastMessageCheckpoint: () =>
        allEvents.length > 0
          ? getCheckpoint(allEvents[allEvents.length - 1]!)
          : null,
      close: () => {
        subscriptions.delete(appended);
        closed.abort();
        return Promise.resolve();
      },
    });
  };

  const streamEvents = (streamName: string) =>
    allEvents.filter((event) => event.metadata.streamName === streamName);

  // Get the database instance to be used for projections
  const database = eventStoreOptions?.database || getInMemoryDatabase();

  // Extract inline projections from options
  const inlineProjections = (eventStoreOptions?.projections ?? [])
    .filter(({ type }) => type === 'inline')
    .map(({ projection }) => projection);
  const asyncProjections = (eventStoreOptions?.projections ?? [])
    .filter(({ type }) => type === 'async')
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
        const events = streamEvents(streamName);
        const currentStreamVersion = BigInt(events.length);

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
              : events.length),
        );

        const resultEvents = upcastRecordedMessages<
          EventType,
          EventPayloadType,
          ReadEventMetadataWithGlobalPosition
        >(
          events.slice(from, to).map((recorded) => ({
            ...recorded,
            metadata: { ...recorded.metadata },
          })) as ReadEvent<
            EventPayloadType,
            ReadEventMetadataWithGlobalPosition
          >[],
          readOptions?.schema?.versioning,
        );

        return Promise.resolve({
          currentStreamVersion,
          events: resultEvents,
          streamExists: events.length > 0,
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
    ): Promise<AppendToStreamResultWithGlobalPosition> => {
      const currentStreamVersion = BigInt(streamEvents(streamName).length);

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
          const allEventsCount = allEvents.length;
          const newEvents: ReadEvent<
            EventType,
            ReadEventMetadataWithGlobalPosition
          >[] = events.map((event, index) => {
            const globalPosition = BigInt(allEventsCount + index + 1);
            const messageId =
              observability.contextGenerator.generateMessageId();
            const metadata: ReadEventMetadataWithGlobalPosition = {
              streamName,
              messageId,
              streamPosition: currentStreamVersion + BigInt(index + 1),
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
              schemaVersion: schemaVersionToAppend(
                event.schemaVersion,
                'metadata' in event ? event.metadata : undefined,
              ),
              metadata: {
                ...('metadata' in event
                  ? withoutSchemaVersion(event.metadata ?? {})
                  : {}),
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

          const storedEvents = downcastRecordedMessages(
            newEvents,
            options?.schema?.versioning,
          ).map((recorded) => ({
            ...recorded,
            schemaVersion: resolveSchemaVersion(recorded.schemaVersion),
            metadata: withoutSchemaVersion(recorded.metadata),
          }));

          allEvents.push(...storedEvents);
          for (const subscription of subscriptions)
            void subscription.push(storedEvents);
          const lastEventGlobalPosition = bigIntProcessorCheckpoint(
            BigInt(allEvents.length),
          );

          // Process projections if there are any registered
          if (inlineProjections.length > 0) {
            await handleInMemoryProjections({
              projections: inlineProjections,
              events: newEvents,
              database: eventStore.database,
              startInlineProjectionScope: (fn) =>
                collector.instrumentInlineProjection(
                  streamName,
                  scope,
                  (child) => Promise.resolve(fn(child)),
                ),
            });
          }

          const result: AppendToStreamResultWithGlobalPosition = {
            nextExpectedStreamVersion: positionOfLastEventInTheStream,
            lastEventGlobalPosition,
            createdNewStream:
              currentStreamVersion === InMemoryEventStoreDefaultStreamVersion,
          };

          await tryPublishMessagesAfterCommit<InMemoryEventStore>(newEvents, {
            ...eventStoreOptions?.hooks,
            observabilityScope: scope,
          });

          return result;
        },
        options?.observability,
      );
    },

    streamExists: (streamName): Promise<StreamExistsResult> => {
      return Promise.resolve(
        allEvents.some((event) => event.metadata.streamName === streamName),
      );
    },

    consumer: <ConsumerMessageType extends Message = AnyMessage>(
      consumerOptions?: InMemoryEventStoreConsumerConfig<ConsumerMessageType> & {
        includeAsyncProjections?: boolean;
      },
    ): InMemoryEventStoreConsumer<ConsumerMessageType> => {
      const source = subscribeToAllEvents();
      const consumer = inMemoryEventStoreConsumer<ConsumerMessageType>({
        ...consumerOptions,
        observability: mergeObservability(
          eventStoreOptions?.observability,
          consumerOptions?.observability,
        ),
        source: source as MessageSource<
          ConsumerMessageType,
          ReadEventMetadataWithGlobalPosition
        >,
        messageStore: eventStore,
        hooks: { onClose: () => Promise.resolve(source.close()) },
      });

      if (consumerOptions?.includeAsyncProjections)
        for (const projection of asyncProjections)
          consumer.projector({
            // TODO: Fix this cast when projection registrations are typed with the consumer message type
            projection: projection as unknown as InMemoryProjectorOptions<
              ConsumerMessageType & AnyEvent
            >['projection'],
          });

      return consumer;
    },
  };

  return eventStore;
};
