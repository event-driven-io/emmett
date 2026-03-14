import { v4 as uuid } from 'uuid';
import {
  assertExpectedVersionMatchesCurrent,
  ExpectedVersionConflictError,
  type AggregateStreamOptions,
  type AggregateStreamResult,
  type AppendToStreamOptions,
  type AppendToStreamResult,
  type DefaultEventStoreOptions,
  type Event,
  type EventStore,
  type ReadEvent,
  type ReadEventMetadataWithGlobalPosition,
  type ReadStreamOptions,
  type ReadStreamResult,
  type StreamExistsResult,
  type CombinedReadEventMetadata,
  tryPublishMessagesAfterCommit,
  bigIntProcessorCheckpoint,
  upcastRecordedMessages,
  NO_CONCURRENCY_CHECK,
  STREAM_DOES_NOT_EXIST,
  STREAM_EXISTS,
} from '@event-driven-io/emmett';
import {
  createEventStore,
  Query,
  type NewEvent,
  type SequencedEvent,
  type DomainEvent,
  type AppendCondition,
  AppendConditionFailedError,
  type FullEventStore,
  type OpossumOptions,
} from 'opossum-js';

export const OpossumEventStoreDefaultStreamVersion = 0n;

export type OpossumReadEventMetadata = ReadEventMetadataWithGlobalPosition;

export type OpossumEventStore = EventStore<OpossumReadEventMetadata>;

export type OpossumEventStoreOptions = {
  storeName: string;
  rootPath?: string;
} & DefaultEventStoreOptions<OpossumEventStore>;

const STREAM_TAG_KEY = 'emt:streamName';

const streamQuery = (streamName: string): Query =>
  Query.fromTags({ key: STREAM_TAG_KEY, value: streamName });

export const getOpossumEventStore = async (
  options: OpossumEventStoreOptions,
): Promise<OpossumEventStore> => {
  const store = await createEventStore({
    storeName: options.storeName,
    ...(options.rootPath !== undefined ? { rootPath: options.rootPath } : {}),
  });

  const eventStore: OpossumEventStore = {
    async aggregateStream<
      State,
      EventType extends Event,
      EventPayloadType extends Event = EventType,
    >(
      streamName: string,
      aggregateOptions: AggregateStreamOptions<
        State,
        EventType,
        OpossumReadEventMetadata,
        EventPayloadType
      >,
    ): Promise<AggregateStreamResult<State>> {
      const { evolve, initialState, read } = aggregateOptions;

      const result = await this.readStream<EventType, EventPayloadType>(
        streamName,
        read,
      );

      const events = result?.events ?? [];

      const state = events.reduce((s, e) => evolve(s, e), initialState());

      return {
        currentStreamVersion: result.currentStreamVersion,
        state,
        streamExists: result.streamExists,
      };
    },

    async readStream<
      EventType extends Event,
      EventPayloadType extends Event = EventType,
    >(
      streamName: string,
      readOptions?: ReadStreamOptions<EventType, EventPayloadType>,
    ): Promise<
      ReadStreamResult<EventType, ReadEventMetadataWithGlobalPosition>
    > {
      const allEvents = await store.read(streamQuery(streamName));

      const currentStreamVersion =
        allEvents.length > 0
          ? BigInt(allEvents.length)
          : OpossumEventStoreDefaultStreamVersion;

      assertExpectedVersionMatchesCurrent(
        currentStreamVersion,
        readOptions?.expectedStreamVersion,
        OpossumEventStoreDefaultStreamVersion,
      );

      const from = Number(readOptions?.from ?? 0);
      const to = Number(
        readOptions?.to ??
          (readOptions?.maxCount
            ? (readOptions.from ?? 0n) + readOptions.maxCount
            : allEvents.length || 1),
      );

      const sliced = allEvents.slice(from, to);

      const mappedEvents = sliced.map((sequencedEvent, index) => {
        const streamPosition = BigInt(from + index + 1);
        const globalPosition = BigInt(sequencedEvent.position);

        const metadata: ReadEventMetadataWithGlobalPosition = {
          streamName,
          messageId: uuid(),
          streamPosition,
          globalPosition,
          checkpoint: bigIntProcessorCheckpoint(globalPosition),
        };

        return {
          type: sequencedEvent.event.eventType,
          data: sequencedEvent.event.event as EventType['data'],
          kind: 'Event' as const,
          metadata,
        } as ReadEvent<EventType, ReadEventMetadataWithGlobalPosition>;
      });

      const resultEvents =
        mappedEvents.length > 0
          ? upcastRecordedMessages<
              EventType,
              EventPayloadType,
              ReadEventMetadataWithGlobalPosition
            >(
              mappedEvents as unknown as ReadEvent<
                EventPayloadType,
                ReadEventMetadataWithGlobalPosition
              >[],
              readOptions?.schema?.versioning,
            )
          : [];

      return {
        currentStreamVersion,
        events: resultEvents,
        streamExists: allEvents.length > 0,
      };
    },

    async appendToStream<
      EventType extends Event,
      EventPayloadType extends Event = EventType,
    >(
      streamName: string,
      events: EventType[],
      appendOptions?: AppendToStreamOptions<EventType, EventPayloadType>,
    ): Promise<AppendToStreamResult> {
      const allEvents = await store.read(streamQuery(streamName));

      const currentStreamVersion =
        allEvents.length > 0
          ? BigInt(allEvents.length)
          : OpossumEventStoreDefaultStreamVersion;

      assertExpectedVersionMatchesCurrent(
        currentStreamVersion,
        appendOptions?.expectedStreamVersion,
        OpossumEventStoreDefaultStreamVersion,
      );

      const lastGlobalPosition =
        allEvents.length > 0
          ? allEvents[allEvents.length - 1]!.position
          : undefined;

      const newEvents: NewEvent[] = events.map((event) => {
        const domainEvent: DomainEvent = {
          eventType: event.type,
          event: event.data as Record<string, unknown>,
          tags: [{ key: STREAM_TAG_KEY, value: streamName }],
        };

        const metadata =
          'metadata' in event && event.metadata
            ? {
                ...(typeof (event.metadata as Record<string, unknown>)
                  .correlationId === 'string'
                  ? {
                      correlationId: (
                        event.metadata as Record<string, unknown>
                      ).correlationId as string,
                    }
                  : {}),
                ...(typeof (event.metadata as Record<string, unknown>)
                  .causationId === 'string'
                  ? {
                      causationId: (event.metadata as Record<string, unknown>)
                        .causationId as string,
                    }
                  : {}),
              }
            : undefined;

        return {
          event: domainEvent,
          ...(metadata !== undefined ? { metadata } : {}),
        };
      });

      const expectedVersion = appendOptions?.expectedStreamVersion;
      let condition: AppendCondition | undefined;

      if (
        expectedVersion !== undefined &&
        expectedVersion !== NO_CONCURRENCY_CHECK
      ) {
        const query = streamQuery(streamName);

        if (expectedVersion === STREAM_DOES_NOT_EXIST) {
          condition = { failIfEventsMatch: query };
        } else if (
          expectedVersion === STREAM_EXISTS ||
          typeof expectedVersion === 'bigint'
        ) {
          condition = {
            failIfEventsMatch: query,
            ...(lastGlobalPosition !== undefined
              ? { afterSequencePosition: lastGlobalPosition }
              : {}),
          };
        }
      }

      try {
        await store.append(newEvents, condition);
      } catch (error) {
        if (error instanceof AppendConditionFailedError) {
          throw new ExpectedVersionConflictError(
            currentStreamVersion,
            appendOptions?.expectedStreamVersion!,
          );
        }
        throw error;
      }

      const nextExpectedStreamVersion =
        currentStreamVersion + BigInt(events.length);
      const createdNewStream =
        currentStreamVersion === OpossumEventStoreDefaultStreamVersion;

      const readEvents: ReadEvent<
        EventType,
        ReadEventMetadataWithGlobalPosition
      >[] = events.map((event, index) => {
        const streamPosition = BigInt(
          Number(currentStreamVersion) + index + 1,
        );
        const metadata: ReadEventMetadataWithGlobalPosition = {
          streamName,
          messageId: uuid(),
          streamPosition,
          globalPosition: streamPosition, // approximate; exact position is internal to opossum
          checkpoint: bigIntProcessorCheckpoint(streamPosition),
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

      await tryPublishMessagesAfterCommit<OpossumEventStore>(
        readEvents,
        options?.hooks,
      );

      return {
        nextExpectedStreamVersion,
        createdNewStream,
      };
    },

    async streamExists(streamName: string): Promise<StreamExistsResult> {
      const events = await store.read(streamQuery(streamName), {
        maxCount: 1,
      });
      return events.length > 0;
    },
  };

  return eventStore;
};
