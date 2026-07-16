import { v7 as uuid } from 'uuid';
import {
  canCreateEventStoreSession,
  isExpectedVersionConflictError,
  NO_CONCURRENCY_CHECK,
  nulloSessionFactory,
  STREAM_DOES_NOT_EXIST,
  type AppendStreamResultOfEventStore,
  type AppendToStreamOptions,
  type EventStore,
  type EventStoreSession,
  type ExpectedStreamVersion,
} from '../eventStore';
import type { JSONSerializationOptions } from '../serialization';
import type { Event } from '../typing';
import { asyncRetry, NoRetries, type AsyncRetryOptions } from '../utils';
import type { OperationObservabilityOptions } from '../observability';
import {
  commandHandlerCollector,
  commandObservability,
  type CommandObservabilityConfig,
} from './observability';

export const CommandHandlerStreamVersionConflictRetryOptions: AsyncRetryOptions =
  {
    retries: 3,
    minTimeout: 100,
    factor: 1.5,
    shouldRetryError: isExpectedVersionConflictError,
  };

export type CommandHandlerRetryOptions =
  AsyncRetryOptions | { onVersionConflict: true | number | AsyncRetryOptions };

export type CommandHandlerResult<
  State,
  StreamEvent extends Event,
  Store extends EventStore,
> = AppendStreamResultOfEventStore<Store> & {
  newState: State;
  newEvents: StreamEvent[];
};

export type CommandHandlerOptions<
  State,
  StreamEvent extends Event,
  StoredEvent extends Event = StreamEvent,
> = {
  evolve: (state: State, event: StreamEvent) => State;
  initialState: () => State;
  mapToStreamId?: (id: string) => string;
  retry?: CommandHandlerRetryOptions;
  schema?: {
    versioning?: {
      upcast?: (event: StoredEvent) => StreamEvent;
      downcast?: (event: StreamEvent) => StoredEvent;
    };
  };
  name?: string;
  commandType?: string | string[];
} & JSONSerializationOptions & {
    observability?: CommandObservabilityConfig;
  };

export type HandleOptions<Store extends EventStore> = Parameters<
  Store['appendToStream']
>[2] &
  (
    | {
        expectedStreamVersion?: ExpectedStreamVersion;
      }
    | {
        retry?: CommandHandlerRetryOptions;
      }
  ) & {
    commandType?: string | string[];
    observability?: OperationObservabilityOptions;
  };

type CommandHandlerFunction<State, StreamEvent extends Event> = (
  state: State,
) => StreamEvent | StreamEvent[] | Promise<StreamEvent | StreamEvent[]>;

export const CommandHandler =
  <
    State,
    StreamEvent extends Event,
    EventPayloadType extends Event = StreamEvent,
  >(
    options: CommandHandlerOptions<State, StreamEvent, EventPayloadType>,
  ) =>
  async <Store extends EventStore>(
    store: Store,
    id: string,
    handle:
      | CommandHandlerFunction<State, StreamEvent>
      | CommandHandlerFunction<State, StreamEvent>[],
    handleOptions?: HandleOptions<Store>,
  ): Promise<CommandHandlerResult<State, StreamEvent, Store>> => {
    const collector = commandHandlerCollector(commandObservability(options));
    const streamName = (options.mapToStreamId ?? ((id: string) => id))(id);

    // TODO: for array-of-handlers we record all types as an
    // `emmett.command.type` array attribute on the parent span and drop the
    // type label from the handling-duration histogram (OTel metric labels
    // must be scalar). An alternative is a child scope per handler with its
    // own type: revisit when per-command metrics become important.
    const commandType: string | string[] | undefined =
      handleOptions?.commandType ??
      options.commandType ??
      options.name ??
      handlerNames(handle);
    const correlationId = handleOptions?.correlationId ?? uuid();
    const causationId = handleOptions?.causationId;
    const commandScopeOptions = handleOptions?.observability;
    const appendOptionsFromHandle = (() => {
      if (!handleOptions) return undefined;

      const {
        commandType: _commandType,
        observability: _operationObservability,
        ...optionsWithoutCommandFields
      } = handleOptions;

      if ('retry' in optionsWithoutCommandFields) {
        const { retry: _retry, ...appendOptions } = optionsWithoutCommandFields;
        return appendOptions;
      }

      return optionsWithoutCommandFields;
    })();

    return asyncRetry(
      () =>
        collector.startScope(
          {
            streamName,
            commandType,
            correlationId,
            causationId,
          },
          async (scope) => {
            const result = await withSession<
              Store,
              CommandHandlerResult<State, StreamEvent, Store>
            >(store, async ({ eventStore }) => {
              const { evolve, initialState } = options;

              // 1. Aggregate the stream
              const aggregationResult = await eventStore.aggregateStream<
                State,
                StreamEvent,
                EventPayloadType
              >(streamName, {
                evolve,
                initialState,
                observability: { scope },
                read: {
                  schema: options.schema,
                  serialization: options.serialization,
                  // expected stream version is passed to fail fast
                  // if stream is in the wrong state
                  expectedStreamVersion:
                    handleOptions?.expectedStreamVersion ??
                    NO_CONCURRENCY_CHECK,
                },
              });

              // 2. Use the aggregate state

              const {
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
                collector.recordVersions(
                  scope,
                  currentStreamVersion,
                  currentStreamVersion,
                );
                return {
                  ...restOfAggregationResult,
                  newEvents: [],
                  newState: state,

                  nextExpectedStreamVersion: currentStreamVersion,
                  createdNewStream: false,
                } as unknown as CommandHandlerResult<State, StreamEvent, Store>;
              }

              // Either use:
              // - provided expected stream version,
              // - current stream version got from stream aggregation,
              // - or expect stream not to exists otherwise.

              const expectedStreamVersion: ExpectedStreamVersion =
                handleOptions?.expectedStreamVersion ??
                (aggregationResult.streamExists
                  ? currentStreamVersion
                  : STREAM_DOES_NOT_EXIST);

              // 4. Append result to the stream
              const { traceId, spanId } = scope.spanContext();
              const appendResult = await eventStore.appendToStream(
                streamName,
                eventsToAppend,
                {
                  ...(appendOptionsFromHandle as AppendToStreamOptions<
                    StreamEvent,
                    EventPayloadType
                  >),
                  expectedStreamVersion,
                  correlationId,
                  ...(causationId ? { causationId } : {}),
                  traceId,
                  spanId,
                  observability: { scope },
                },
              );

              collector.recordEvents(scope, eventsToAppend, 'success');
              collector.recordVersions(
                scope,
                currentStreamVersion,
                appendResult.nextExpectedStreamVersion,
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
          commandScopeOptions,
        ),
      fromCommandHandlerRetryOptions(
        handleOptions && 'retry' in handleOptions
          ? handleOptions.retry
          : options.retry,
      ),
    );
  };

const withSession = <EventStoreType extends EventStore, T = unknown>(
  eventStore: EventStoreType,
  callback: (session: EventStoreSession<EventStoreType>) => Promise<T>,
) => {
  const sessionFactory = canCreateEventStoreSession<EventStoreType>(eventStore)
    ? eventStore
    : nulloSessionFactory<EventStoreType>(eventStore);

  return sessionFactory.withSession(callback);
};

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

const handlerNames = <State, StreamEvent extends Event>(
  handle:
    | CommandHandlerFunction<State, StreamEvent>
    | CommandHandlerFunction<State, StreamEvent>[],
): string | string[] | undefined => {
  if (Array.isArray(handle)) {
    const names = handle.map((h) => h.name).filter((n): n is string => !!n);
    return names.length > 0 ? names : undefined;
  }
  return handle.name || undefined;
};
