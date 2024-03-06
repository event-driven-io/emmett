import {
  ExpectedVersionConflictError,
  NO_CONCURRENCY_CHECK,
  STREAM_DOES_NOT_EXIST,
  STREAM_EXISTS,
  type AggregateStreamOptions,
  type AggregateStreamResult,
  type AppendToStreamOptions,
  type AppendToStreamResult,
  type Event,
  type EventStore,
  type ExpectedStreamVersion,
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
} from '@eventstore/db-client';

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

export const getEventStoreDBEventStore = (
  eventStore: EventStoreDBClient,
): EventStore => {
  return {
    async aggregateStream<State, EventType extends Event>(
      streamName: string,
      options: AggregateStreamOptions<State, EventType>,
    ): Promise<AggregateStreamResult<State> | null> {
      try {
        const { evolve, getInitialState, read } = options;

        const expectedStreamVersion = read?.expectedStreamVersion;

        let state = getInitialState();
        let currentStreamVersion: bigint | undefined = undefined;

        for await (const { event } of eventStore.readStream(
          streamName,
          toEventStoreDBReadOptions(options.read),
        )) {
          if (!event) continue;

          state = evolve(state, <EventType>{
            type: event.type,
            data: event.data,
          });
          currentStreamVersion = event.revision;
        }

        assertExpectedVersionMatchesCurrent(
          currentStreamVersion,
          expectedStreamVersion,
        );

        return {
          currentStreamVersion: currentStreamVersion ?? 0n,
          state,
        };
      } catch (error) {
        if (error instanceof StreamNotFoundError) {
          return null;
        }

        throw error;
      }
    },

    readStream: async <EventType extends Event>(
      streamName: string,
      options?: ReadStreamOptions,
    ): Promise<ReadStreamResult<EventType>> => {
      const events: EventType[] = [];

      let currentStreamVersion: bigint | undefined = undefined;

      try {
        for await (const { event } of eventStore.readStream(
          streamName,
          toEventStoreDBReadOptions(options),
        )) {
          if (!event) continue;
          events.push(<EventType>{
            type: event.type,
            data: event.data,
          });
          currentStreamVersion = event.revision;
        }
        return currentStreamVersion
          ? {
              currentStreamVersion,
              events,
            }
          : null;
      } catch (error) {
        if (error instanceof StreamNotFoundError) {
          return null;
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

        return { nextExpectedStreamVersion: appendResult.nextExpectedRevision };
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

const matchesExpectedVersion = (
  current: bigint | undefined,
  expected: ExpectedStreamVersion,
): boolean => {
  if (expected === NO_CONCURRENCY_CHECK) return true;

  if (expected == STREAM_DOES_NOT_EXIST) return current === undefined;

  if (expected == STREAM_EXISTS) return current !== undefined;

  return current === expected;
};

const assertExpectedVersionMatchesCurrent = (
  current: bigint | undefined,
  expected: ExpectedStreamVersion | undefined,
): void => {
  expected ??= NO_CONCURRENCY_CHECK;

  if (!matchesExpectedVersion(current, expected))
    throw new ExpectedVersionConflictError(current, expected);
};
