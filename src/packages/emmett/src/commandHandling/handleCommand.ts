import {
  canCreateEventStoreSession,
  isExpectedVersionConflictError,
  NO_CONCURRENCY_CHECK,
  nulloSessionFactory,
  STREAM_DOES_NOT_EXIST,
  type AppendToStreamResult,
  type EventStore,
  type EventStoreSession,
  type ExpectedStreamVersion,
  type StreamPositionTypeOfEventStore,
} from '../eventStore';
import type { BigIntStreamPosition, Event } from '../typing';
import { asyncRetry, NoRetries, type AsyncRetryOptions } from '../utils';

export const CommandHandlerStreamVersionConflictRetryOptions: AsyncRetryOptions =
  {
    retries: 3,
    minTimeout: 100,
    factor: 1.5,
    shouldRetryError: isExpectedVersionConflictError,
  };

export type CommandHandlerRetryOptions =
  | AsyncRetryOptions
  | { onVersionConflict: true | number | AsyncRetryOptions };

const fromCommandHandlerRetryOptions = (
  retryOptions: CommandHandlerRetryOptions | undefined,
): AsyncRetryOptions => {
  if (retryOptions === undefined) return NoRetries;

  if ('onVersionConflict' in retryOptions) {
    if (typeof retryOptions.onVersionConflict === 'boolean')
      return CommandHandlerStreamVersionConflictRetryOptions;
    else if (typeof retryOptions.onVersionConflict === 'number')
      return {
        ...CommandHandlerStreamVersionConflictRetryOptions,
        retries: retryOptions.onVersionConflict,
      };
    else return retryOptions.onVersionConflict;
  }

  return retryOptions;
};

// #region command-handler
export type CommandHandlerResult<
  State,
  StreamEvent extends Event,
  StreamVersion = BigIntStreamPosition,
> = AppendToStreamResult<StreamVersion> & {
  newState: State;
  newEvents: StreamEvent[];
};

export type CommandHandlerOptions<State, StreamEvent extends Event> = {
  evolve: (state: State, event: StreamEvent) => State;
  initialState: () => State;
  mapToStreamId?: (id: string) => string;
  retry?: CommandHandlerRetryOptions;
};

export type HandleOptions<Store extends EventStore> = Parameters<
  Store['appendToStream']
>[2] &
  (
    | {
        expectedStreamVersion?: ExpectedStreamVersion<
          StreamPositionTypeOfEventStore<Store>
        >;
      }
    | {
        retry?: CommandHandlerRetryOptions;
      }
  );

export const CommandHandler =
  <State, StreamEvent extends Event>(
    options: CommandHandlerOptions<State, StreamEvent>,
  ) =>
  async <Store extends EventStore>(
    store: Store,
    id: string,
    handle: (
      state: State,
    ) =>
      | StreamEvent
      | StreamEvent[]
      | Promise<StreamEvent>
      | Promise<StreamEvent[]>,
    handleOptions?: HandleOptions<Store>,
  ): Promise<
    CommandHandlerResult<
      State,
      StreamEvent,
      StreamPositionTypeOfEventStore<Store>
    >
  > =>
    asyncRetry(
      async () => {
        const result = await withSession<
          Store,
          CommandHandlerResult<
            State,
            StreamEvent,
            StreamPositionTypeOfEventStore<Store>
          >
        >(store, async ({ eventStore }) => {
          const { evolve, initialState } = options;
          const mapToStreamId = options.mapToStreamId ?? ((id) => id);

          const streamName = mapToStreamId(id);

          // 1. Aggregate the stream
          const aggregationResult = await eventStore.aggregateStream<
            State,
            StreamEvent
          >(streamName, {
            evolve,
            initialState,
            read: {
              // expected stream version is passed to fail fast
              // if stream is in the wrong state
              // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
              expectedStreamVersion:
                handleOptions?.expectedStreamVersion ?? NO_CONCURRENCY_CHECK,
            },
          });

          // 2. Use the aggregate state
          const state = aggregationResult.state;
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          const currentStreamVersion = aggregationResult.currentStreamVersion;

          // 3. Run business logic
          const result = await handle(state);

          const newEvents = Array.isArray(result) ? result : [result];

          if (newEvents.length === 0) {
            return {
              newEvents: [],
              newState: state,
              // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
              nextExpectedStreamVersion: currentStreamVersion,
              createdNewStream: false,
            };
          }

          // Either use:
          // - provided expected stream version,
          // - current stream version got from stream aggregation,
          // - or expect stream not to exists otherwise.
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          const expectedStreamVersion: ExpectedStreamVersion<
            StreamPositionTypeOfEventStore<Store>
          > =
            handleOptions?.expectedStreamVersion ??
            (aggregationResult.streamExists
              ? (currentStreamVersion as ExpectedStreamVersion<
                  StreamPositionTypeOfEventStore<Store>
                >)
              : STREAM_DOES_NOT_EXIST);

          // 4. Append result to the stream
          const appendResult = await eventStore.appendToStream(
            streamName,
            newEvents,
            {
              ...handleOptions,
              expectedStreamVersion,
            },
          );

          // 5. Return result with updated state
          return {
            ...appendResult,
            newEvents,
            newState: newEvents.reduce(evolve, state),
          };
        });

        return result;
      },
      fromCommandHandlerRetryOptions(
        handleOptions && 'retry' in handleOptions
          ? handleOptions.retry
          : options.retry,
      ),
    );
// #endregion command-handler

const withSession = <EventStoreType extends EventStore, T = unknown>(
  eventStore: EventStoreType,
  callback: (session: EventStoreSession<EventStoreType>) => Promise<T>,
) => {
  const sessionFactory = canCreateEventStoreSession<EventStoreType>(eventStore)
    ? eventStore
    : nulloSessionFactory<EventStoreType>(eventStore);

  return sessionFactory.withSession(callback);
};
