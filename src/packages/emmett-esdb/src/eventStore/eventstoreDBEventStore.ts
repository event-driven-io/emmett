import {
  ExpectedVersionConflictError,
  NO_CONCURRENCY_CHECK,
  STREAM_DOES_NOT_EXIST,
  STREAM_EXISTS,
  assertExpectedVersionMatchesCurrent,
  type AggregateStreamOptions,
  type AggregateStreamResultWithGlobalPosition,
  type AnyEvent,
  type AppendToStreamOptions,
  type AppendToStreamResultWithGlobalPosition,
  type Event,
  type EventStore,
  type ExpectedStreamVersion,
  type ReadEvent,
  type ReadEventMetadataWithGlobalPosition,
  type ReadStreamOptions,
  type ReadStreamResult,
} from '@event-driven-io/emmett';
import {
  ANY,
  STREAM_EXISTS as ESDB_STREAM_EXISTS,
  EventStoreDBClient,
  NO_STREAM,
  StreamNotFoundError,
  WrongExpectedVersionError,
  jsonEvent,
  type AppendExpectedRevision,
  type ReadStreamOptions as ESDBReadStreamOptions,
  type JSONRecordedEvent,
} from '@eventstore/db-client';
import {
  eventStoreDBEventStoreConsumer,
  type EventStoreDBEventStoreConsumer,
  type EventStoreDBEventStoreConsumerConfig,
} from './consumers';

const toEventStoreDBReadOptions = (
  options: ReadStreamOptions | undefined,
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

export interface EventStoreDBEventStore
  extends EventStore<EventStoreDBReadEventMetadata> {
  appendToStream<EventType extends Event>(
    streamName: string,
    events: EventType[],
    options?: AppendToStreamOptions,
  ): Promise<AppendToStreamResultWithGlobalPosition>;
  consumer<ConsumerEventType extends Event = Event>(
    options?: EventStoreDBEventStoreConsumerConfig<ConsumerEventType>,
  ): EventStoreDBEventStoreConsumer<ConsumerEventType>;
}

export const getEventStoreDBEventStore = (
  eventStore: EventStoreDBClient,
): EventStoreDBEventStore => {
  return {
    async aggregateStream<State, EventType extends Event>(
      streamName: string,
      options: AggregateStreamOptions<
        State,
        EventType,
        EventStoreDBReadEventMetadata
      >,
    ): Promise<AggregateStreamResultWithGlobalPosition<State>> {
      const { evolve, initialState, read } = options;

      const expectedStreamVersion = read?.expectedStreamVersion;

      let state = initialState();
      let currentStreamVersion: bigint =
        EventStoreDBEventStoreDefaultStreamVersion;
      let lastEventGlobalPosition: bigint | undefined = undefined;

      try {
        for await (const { event } of eventStore.readStream<EventType>(
          streamName,
          toEventStoreDBReadOptions(options.read),
        )) {
          if (!event) continue;

          state = evolve(state, mapFromESDBEvent<EventType>(event));
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

    readStream: async <EventType extends Event>(
      streamName: string,
      options?: ReadStreamOptions,
    ): Promise<ReadStreamResult<EventType, EventStoreDBReadEventMetadata>> => {
      const events: ReadEvent<EventType, EventStoreDBReadEventMetadata>[] = [];

      let currentStreamVersion: bigint =
        EventStoreDBEventStoreDefaultStreamVersion;

      try {
        for await (const { event } of eventStore.readStream<EventType>(
          streamName,
          toEventStoreDBReadOptions(options),
        )) {
          if (!event) continue;
          events.push(mapFromESDBEvent(event));
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

    appendToStream: async <EventType extends Event>(
      streamName: string,
      events: EventType[],
      options?: AppendToStreamOptions,
    ): Promise<AppendToStreamResultWithGlobalPosition> => {
      try {
        const serializedEvents = events.map(jsonEvent);

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

    //streamEvents: streamEvents(eventStore),
  };
};

export const mapFromESDBEvent = <EventType extends AnyEvent = AnyEvent>(
  event: JSONRecordedEvent<EventType>,
): ReadEvent<EventType, EventStoreDBReadEventMetadata> => {
  return <ReadEvent<EventType, EventStoreDBReadEventMetadata>>{
    type: event.type,
    data: event.data,
    metadata: {
      ...((event.metadata as EventStoreDBReadEventMetadata) ??
        ({} as EventStoreDBReadEventMetadata)),
      eventId: event.id,
      streamName: event.streamId,
      streamPosition: event.revision,
      globalPosition: event.position!.commit,
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
