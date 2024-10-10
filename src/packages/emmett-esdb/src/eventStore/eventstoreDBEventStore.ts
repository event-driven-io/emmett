import {
  ExpectedVersionConflictError,
  NO_CONCURRENCY_CHECK,
  STREAM_DOES_NOT_EXIST,
  STREAM_EXISTS,
  assertExpectedVersionMatchesCurrent,
  globalStreamCaughtUp,
  streamTransformations,
  type AggregateStreamOptions,
  type AggregateStreamResult,
  type AppendToStreamOptions,
  type AppendToStreamResult,
  type DefaultStreamVersionType,
  type Event,
  type EventStore,
  type ExpectedStreamVersion,
  type GlobalStreamCaughtUp,
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
  type AllStreamResolvedEvent,
  type AllStreamSubscription,
  type AppendExpectedRevision,
  type ReadStreamOptions as ESDBReadStreamOptions,
  type JSONRecordedEvent,
} from '@eventstore/db-client';
import { WritableStream, type ReadableStream } from 'node:stream/web';
import { Readable } from 'stream';

const { map } = streamTransformations;

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

export const getEventStoreDBEventStore = (
  eventStore: EventStoreDBClient,
): EventStore<
  DefaultStreamVersionType,
  ReadEventMetadataWithGlobalPosition
> => {
  return {
    async aggregateStream<State, EventType extends Event>(
      streamName: string,
      options: AggregateStreamOptions<State, EventType>,
    ): Promise<AggregateStreamResult<State>> {
      const { evolve, initialState, read } = options;

      const expectedStreamVersion = read?.expectedStreamVersion;

      let state = initialState();
      let currentStreamVersion: bigint =
        EventStoreDBEventStoreDefaultStreamVersion;

      try {
        for await (const { event } of eventStore.readStream<EventType>(
          streamName,
          toEventStoreDBReadOptions(options.read),
        )) {
          if (!event) continue;

          state = evolve(state, mapFromESDBEvent<EventType>(event));
          currentStreamVersion = event.revision;
        }

        assertExpectedVersionMatchesCurrent(
          currentStreamVersion,
          expectedStreamVersion,
          EventStoreDBEventStoreDefaultStreamVersion,
        );

        return {
          currentStreamVersion,
          state,
          streamExists: true,
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
    ): Promise<
      ReadStreamResult<
        EventType,
        DefaultStreamVersionType,
        ReadEventMetadataWithGlobalPosition
      >
    > => {
      const events: ReadEvent<
        EventType,
        ReadEventMetadataWithGlobalPosition
      >[] = [];

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
    ): Promise<AppendToStreamResult> => {
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

    //streamEvents: streamEvents(eventStore),
  };
};

const mapFromESDBEvent = <EventType extends Event = Event>(
  event: JSONRecordedEvent<EventType>,
): ReadEvent<EventType, ReadEventMetadataWithGlobalPosition> => {
  return <ReadEvent<EventType, ReadEventMetadataWithGlobalPosition>>{
    type: event.type,
    data: event.data,
    metadata: {
      ...((event.metadata as ReadEventMetadataWithGlobalPosition) ??
        ({} as ReadEventMetadataWithGlobalPosition)),
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const convertToWebReadableStream = (
  allStreamSubscription: AllStreamSubscription,
): ReadableStream<AllStreamResolvedEvent | GlobalStreamCaughtUp> => {
  // Validate the input type
  if (!(allStreamSubscription instanceof Readable)) {
    throw new Error('Provided stream is not a Node.js Readable stream.');
  }

  let globalPosition = 0n;

  const stream = Readable.toWeb(
    allStreamSubscription,
  ) as ReadableStream<AllStreamResolvedEvent>;

  const writable = new WritableStream<
    AllStreamResolvedEvent | GlobalStreamCaughtUp
  >();

  allStreamSubscription.on('caughtUp', async () => {
    console.log(globalPosition);
    await writable.getWriter().write(globalStreamCaughtUp({ globalPosition }));
  });

  const transform = map<
    AllStreamResolvedEvent,
    AllStreamResolvedEvent | GlobalStreamCaughtUp
  >((event) => {
    if (event?.event?.position.commit)
      globalPosition = event.event?.position.commit;

    return event;
  });

  return stream.pipeThrough<AllStreamResolvedEvent | GlobalStreamCaughtUp>(
    transform,
  );
};

// const streamEvents = (eventStore: EventStoreDBClient) => () => {
//   return restream<
//     AllStreamResolvedEvent | GlobalSubscriptionEvent,
//     | ReadEvent<Event, ReadEventMetadataWithGlobalPosition>
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
//     ): ReadEvent<Event, ReadEventMetadataWithGlobalPosition> =>
//       mapFromESDBEvent(resolvedEvent.event as JSONRecordedEvent<Event>),
//   );
// };
