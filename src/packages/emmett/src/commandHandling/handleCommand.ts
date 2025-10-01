import {
  canCreateEventStoreSession,
  isExpectedVersionConflictError,
  NO_CONCURRENCY_CHECK,
  nulloSessionFactory,
  STREAM_DOES_NOT_EXIST,
  type AppendStreamResultOfEventStore,
  type EventStore,
  type EventStoreSession,
  type ExpectedStreamVersion,
  type StreamPositionTypeOfEventStore,
} from '../eventStore';
import type { Event } from '../typing';
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
  Store extends EventStore,
> = AppendStreamResultOfEventStore<Store> & {
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

type CommandHandlerFunction<State, StreamEvent extends Event> = (
  state: State,
) => StreamEvent | StreamEvent[] | Promise<StreamEvent | StreamEvent[]>;

export const CommandHandler =
  <State, StreamEvent extends Event>(
    options: CommandHandlerOptions<State, StreamEvent>,
  ) =>
  async <Store extends EventStore>(
    store: Store,
    id: string,
    handle:
      | CommandHandlerFunction<State, StreamEvent>
      | CommandHandlerFunction<State, StreamEvent>[],
    handleOptions?: HandleOptions<Store>,
  ): Promise<CommandHandlerResult<State, StreamEvent, Store>> =>
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
              ...(handleOptions ? handleOptions : {}),
              // expected stream version is passed to fail fast
              // if stream is in the wrong state
              expectedStreamVersion:
                handleOptions?.expectedStreamVersion ?? NO_CONCURRENCY_CHECK,
            },
          });

          // 2. Use the aggregate state

          const {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            currentStreamVersion,
            streamExists: _streamExists,
            ...restOfAggregationResult
          } = aggregationResult;

          let state = aggregationResult.state;

          const handlers = Array.isArray(handle) ? handle : [handle];
          let eventsToAppend: StreamEvent[] = [];

          // 3. Run business logic
          for (const handler of handlers) {
            const result = await handler(state);

            const newEvents = Array.isArray(result) ? result : [result];

            if (newEvents.length > 0) {
              state = newEvents.reduce(evolve, state);
            }

            eventsToAppend = [...eventsToAppend, ...newEvents];
          }

          //const newEvents = Array.isArray(result) ? result : [result];

          if (eventsToAppend.length === 0) {
            return {
              ...restOfAggregationResult,
              newEvents: [],
              newState: state,
              // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
              nextExpectedStreamVersion: currentStreamVersion,
              createdNewStream: false,
            } as unknown as CommandHandlerResult<State, StreamEvent, Store>;
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
            eventsToAppend,
            {
              ...handleOptions,
              expectedStreamVersion,
            },
          );

          // 5. Return result with updated state
          return {
            ...appendResult,
            newEvents: eventsToAppend,
            newState: state,
          } as unknown as CommandHandlerResult<State, StreamEvent, Store>;
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
