import {
  ExpectedVersionConflictError,
  NO_CONCURRENCY_CHECK,
  STREAM_DOES_NOT_EXIST,
  STREAM_EXISTS,
  assertExpectedVersionMatchesCurrent,
  bigIntProcessorCheckpoint,
  downcastRecordedMessages,
  upcastRecordedMessage,
  type AggregateStreamOptions,
  type AggregateStreamResultWithGlobalPosition,
  type AnyMessage,
  type AppendToStreamOptions,
  type AppendToStreamResultWithGlobalPosition,
  type BigIntStreamPosition,
  type Event,
  type EventStore,
  type ExpectedStreamVersion,
  type ReadEvent,
  type ReadEventMetadataWithGlobalPosition,
  type ReadStreamOptions,
  type ReadStreamResult,
  type RecordedMessage,
  type StreamExistsResult,
} from '@event-driven-io/emmett';
import type { EventStoreDBClient } from '@eventstore/db-client';
import {
  ANY,
  STREAM_EXISTS as ESDB_STREAM_EXISTS,
  NO_STREAM,
  StreamNotFoundError,
  WrongExpectedVersionError,
  jsonEvent,
  type AppendExpectedRevision,
  type ReadStreamOptions as ESDBReadStreamOptions,
  type ResolvedEvent,
} from '@eventstore/db-client';
import {
  $all,
  eventStoreDBEventStoreConsumer,
  type EventStoreDBEventStoreConsumer,
  type EventStoreDBEventStoreConsumerConfig,
  type EventStoreDBEventStoreConsumerType,
} from './consumers';

const toEventStoreDBReadOptions = <
  EventType extends Event,
  EventPayloadType extends Event = EventType,
>(
  options:
    | ReadStreamOptions<BigIntStreamPosition, EventType, EventPayloadType>
    | undefined,
): ESDBReadStreamOptions | undefined => {
  return options
    ? {
        fromRevision: 'from' in options ? options.from : undefined,
        maxCount:
          'maxCount' in options
            ? options.maxCount
            : 'to' in options
              ? options.to
              : undefined,
      }
    : undefined;
};

export const EventStoreDBEventStoreDefaultStreamVersion = -1n;

export type EventStoreDBReadEventMetadata = ReadEventMetadataWithGlobalPosition;

export type EventStoreDBReadEvent<EventType extends Event = Event> = ReadEvent<
  EventType,
  EventStoreDBReadEventMetadata
>;

export interface EventStoreDBEventStore extends EventStore<EventStoreDBReadEventMetadata> {
  appendToStream<
    EventType extends Event,
    EventPayloadType extends Event = EventType,
  >(
    streamName: string,
    events: EventType[],
    options?: AppendToStreamOptions<
      BigIntStreamPosition,
      EventType,
      EventPayloadType
    >,
  ): Promise<AppendToStreamResultWithGlobalPosition>;
  consumer<ConsumerEventType extends Event = Event>(
    options?: EventStoreDBEventStoreConsumerConfig<ConsumerEventType>,
  ): EventStoreDBEventStoreConsumer<ConsumerEventType>;
}

export const getEventStoreDBEventStore = (
  eventStore: EventStoreDBClient,
): EventStoreDBEventStore => {
  return {
    async aggregateStream<
      State,
      EventType extends Event,
      EventPayloadType extends Event = EventType,
    >(
      streamName: string,
      options: AggregateStreamOptions<
        State,
        EventType,
        EventStoreDBReadEventMetadata,
        EventPayloadType
      >,
    ): Promise<AggregateStreamResultWithGlobalPosition<State>> {
      const { evolve, initialState, read } = options;

      const expectedStreamVersion = read?.expectedStreamVersion;

      let state = initialState();
      let currentStreamVersion: bigint =
        EventStoreDBEventStoreDefaultStreamVersion;
      let lastEventGlobalPosition: bigint | undefined = undefined;

      try {
        for await (const resolvedEvent of eventStore.readStream<EventPayloadType>(
          streamName,
          toEventStoreDBReadOptions(options.read),
        )) {
          const { event } = resolvedEvent;
          if (!event) continue;

          state = evolve(
            state,
            upcastRecordedMessage(
              mapFromESDBEvent<EventPayloadType>(resolvedEvent),
              options?.read?.schema?.versioning,
            ),
          );
          currentStreamVersion = event.revision;
          lastEventGlobalPosition = event.position?.commit;
        }

        assertExpectedVersionMatchesCurrent(
          currentStreamVersion,
          expectedStreamVersion,
          EventStoreDBEventStoreDefaultStreamVersion,
        );

        return lastEventGlobalPosition
          ? {
              currentStreamVersion,
              lastEventGlobalPosition,
              state,
              streamExists: true,
            }
          : {
              currentStreamVersion,
              state,
              streamExists: false,
            };
      } catch (error) {
        if (error instanceof StreamNotFoundError) {
          return {
            currentStreamVersion,
            state,
            streamExists: false,
          };
        }

        throw error;
      }
    },

    readStream: async <
      EventType extends Event,
      EventPayloadType extends Event = EventType,
    >(
      streamName: string,
      options?: ReadStreamOptions<
        BigIntStreamPosition,
        EventType,
        EventPayloadType
      >,
    ): Promise<ReadStreamResult<EventType, EventStoreDBReadEventMetadata>> => {
      const events: ReadEvent<EventType, EventStoreDBReadEventMetadata>[] = [];

      let currentStreamVersion: bigint =
        EventStoreDBEventStoreDefaultStreamVersion;

      try {
        for await (const resolvedEvent of eventStore.readStream<EventPayloadType>(
          streamName,
          toEventStoreDBReadOptions(options),
        )) {
          const { event } = resolvedEvent;
          if (!event) continue;
          events.push(
            upcastRecordedMessage(
              mapFromESDBEvent<EventPayloadType>(resolvedEvent),
              options?.schema?.versioning,
            ),
          );

          currentStreamVersion = event.revision;
        }
        return {
          currentStreamVersion,
          events,
          streamExists: true,
        };
      } catch (error) {
        if (error instanceof StreamNotFoundError) {
          return {
            currentStreamVersion,
            events: [],
            streamExists: false,
          };
        }

        throw error;
      }
    },

    appendToStream: async <
      EventType extends Event,
      EventPayloadType extends Event = EventType,
    >(
      streamName: string,
      events: EventType[],
      options?: AppendToStreamOptions<
        BigIntStreamPosition,
        EventType,
        EventPayloadType
      >,
    ): Promise<AppendToStreamResultWithGlobalPosition> => {
      try {
        const eventsToStore = downcastRecordedMessages(
          events,
          options?.schema?.versioning,
        );
        const serializedEvents = eventsToStore.map(jsonEvent);

        const expectedRevision = toExpectedRevision(
          options?.expectedStreamVersion,
        );

        const appendResult = await eventStore.appendToStream(
          streamName,
          serializedEvents,
          {
            expectedRevision,
          },
        );

        return {
          nextExpectedStreamVersion: appendResult.nextExpectedRevision,
          lastEventGlobalPosition: appendResult.position!.commit,
          createdNewStream:
            appendResult.nextExpectedRevision >=
            BigInt(serializedEvents.length),
        };
      } catch (error) {
        if (error instanceof WrongExpectedVersionError) {
          throw new ExpectedVersionConflictError(
            error.actualVersion,
            toExpectedVersion(error.expectedVersion),
          );
        }

        throw error;
      }
    },

    consumer: <ConsumerEventType extends Event = Event>(
      options?: EventStoreDBEventStoreConsumerConfig<ConsumerEventType>,
    ): EventStoreDBEventStoreConsumer<ConsumerEventType> =>
      eventStoreDBEventStoreConsumer<ConsumerEventType>({
        ...(options ?? {}),
        client: eventStore,
      }),

    streamExists: async (streamName: string): Promise<StreamExistsResult> => {
      try {
        for await (const resolvedEvent of eventStore.readStream(streamName)) {
          const { event } = resolvedEvent;

          if (!event) continue;

          return true;
        }

        return false;
      } catch (error) {
        if (error instanceof StreamNotFoundError) {
          return false;
        }

        throw error;
      }
    },

    //streamEvents: streamEvents(eventStore),
  };
};

const getESDBCheckpoint = <MessageType extends AnyMessage = AnyMessage>(
  resolvedEvent: ResolvedEvent<MessageType>,
  from?: EventStoreDBEventStoreConsumerType,
): bigint => {
  return !from || from?.stream === $all
    ? (resolvedEvent.link?.position?.commit ??
        resolvedEvent.event?.position?.commit)!
    : (resolvedEvent.link?.revision ?? resolvedEvent.event!.revision);
};

export const mapFromESDBEvent = <MessageType extends AnyMessage = AnyMessage>(
  resolvedEvent: ResolvedEvent<MessageType>,
  from?: EventStoreDBEventStoreConsumerType,
): RecordedMessage<MessageType, EventStoreDBReadEventMetadata> => {
  const event = resolvedEvent.event!;
  return <RecordedMessage<MessageType, EventStoreDBReadEventMetadata>>{
    type: event.type,
    data: event.data,
    metadata: {
      ...((event.metadata as EventStoreDBReadEventMetadata) ??
        ({} as EventStoreDBReadEventMetadata)),
      eventId: event.id,
      streamName: event.streamId,
      streamPosition: event.revision,
      globalPosition: event.position!.commit,
      checkpoint: bigIntProcessorCheckpoint(
        getESDBCheckpoint(resolvedEvent, from),
      ),
    },
  };
};

const toExpectedRevision = (
  expected: ExpectedStreamVersion | undefined,
): AppendExpectedRevision => {
  if (expected === undefined) return ANY;

  if (expected === NO_CONCURRENCY_CHECK) return ANY;

  if (expected == STREAM_DOES_NOT_EXIST) return NO_STREAM;

  if (expected == STREAM_EXISTS) return ESDB_STREAM_EXISTS;

  return expected as bigint;
};

const toExpectedVersion = (
  expected: AppendExpectedRevision | undefined,
): ExpectedStreamVersion => {
  if (expected === undefined) return NO_CONCURRENCY_CHECK;

  if (expected === ANY) return NO_CONCURRENCY_CHECK;

  if (expected == NO_STREAM) return STREAM_DOES_NOT_EXIST;

  if (expected == ESDB_STREAM_EXISTS) return STREAM_EXISTS;

  return expected;
};

// const { map } = streamTransformations;
//
// // eslint-disable-next-line @typescript-eslint/no-unused-vars
// const convertToWebReadableStream = (
//   allStreamSubscription: AllStreamSubscription,
// ): ReadableStream<AllStreamResolvedEvent | GlobalStreamCaughtUp> => {
//   // Validate the input type
//   if (!(allStreamSubscription instanceof Readable)) {
//     throw new Error('Provided stream is not a Node.js Readable stream.');
//   }

//   let globalPosition = 0n;

//   const stream = Readable.toWeb(
//     allStreamSubscription,
//   ) as ReadableStream<AllStreamResolvedEvent>;

//   const writable = new WritableStream<
//     AllStreamResolvedEvent | GlobalStreamCaughtUp
//   >();

//   allStreamSubscription.on('caughtUp', async () => {
//     console.log(globalPosition);
//     await writable.getWriter().write(globalStreamCaughtUp({ globalPosition }));
//   });

//   const transform = map<
//     AllStreamResolvedEvent,
//     AllStreamResolvedEvent | GlobalStreamCaughtUp
//   >((event) => {
//     if (event?.event?.position.commit)
//       globalPosition = event.event?.position.commit;

//     return event;
//   });

//   return stream.pipeThrough<AllStreamResolvedEvent | GlobalStreamCaughtUp>(
//     transform,
//   );
// };

// const streamEvents = (eventStore: EventStoreDBClient) => () => {
//   return restream<
//     AllStreamResolvedEvent | GlobalSubscriptionEvent,
//     | ReadEvent<Event, EventStoreDBReadEventMetadata>
//     | GlobalSubscriptionEvent
//   >(
//     (): ReadableStream<AllStreamResolvedEvent | GlobalSubscriptionEvent> =>
//       convertToWebReadableStream(
//         eventStore.subscribeToAll({
//           fromPosition: START,
//           filter: excludeSystemEvents(),
//         }),
//       ),
//     (
//       resolvedEvent: AllStreamResolvedEvent | GlobalSubscriptionEvent,
//     ): ReadEvent<Event, EventStoreDBReadEventMetadata> =>
//       mapFromESDBEvent(resolvedEvent.event as JSONRecordedEvent<Event>),
//   );
// };
