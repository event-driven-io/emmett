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
import {
  withOperationScope,
  type OperationObservabilityOptions,
} from '../observability';
import {
  commandHandlerCollector,
  commandObservability,
  type CommandObservabilityConfig,
} from './observability';
import {
  append,
  composeMiddleware,
  resolveMiddleware,
  type DecisionHandlingResult,
  type MiddlewareOptions,
} from './middleware';

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
  events: StreamEvent[];
  appendedEvents: StreamEvent[];
  /** @deprecated Use appendedEvents. */
  newEvents: StreamEvent[];
};

export type CommandMiddlewareContext = undefined;

export type BeforeAllContext<Store extends EventStore = EventStore> = {
  streamName: string;
  handleOptions: HandleOptions<Store> | undefined;
};

export type CommandHandlerMiddlewareOptions<
  State,
  StreamEvent extends Event,
> = MiddlewareOptions<
  State,
  CommandMiddlewareContext,
  StreamEvent,
  (
    handle:
      | CommandHandlerFunction<State, StreamEvent>
      | CommandHandlerFunction<State, StreamEvent>[],
    context: BeforeAllContext,
  ) => void | Promise<void>,
  <Store extends EventStore>(
    result: CommandHandlerResult<State, StreamEvent, Store>,
    context: BeforeAllContext<Store>,
  ) => void | Promise<void>
>;

export type CommandHandlerOptions<
  State,
  StreamEvent extends Event,
  EventPayloadType extends Event = StreamEvent,
> = {
  evolve: (state: State, event: StreamEvent) => State;
  initialState: () => State;
  mapToStreamId?: (id: string) => string;
  retry?: CommandHandlerRetryOptions;
  schema?: {
    versioning?: {
      upcast?: (event: EventPayloadType) => StreamEvent;
      downcast?: (event: StreamEvent) => EventPayloadType;
    };
  };
  name?: string;
  commandType?: string | string[];
  middleware?: CommandHandlerMiddlewareOptions<State, StreamEvent>;
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

export type CommandHandlerFunction<State, StreamEvent extends Event> = (
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
    const observability = commandObservability(options);
    const collector = commandHandlerCollector(observability);
    const streamName = (options.mapToStreamId ?? ((id: string) => id))(id);

    const {
      decision: decisionMiddleware,
      beforeAll,
      afterAll,
    } = resolveMiddleware(options.middleware);

    await beforeAll?.(handle, { streamName, handleOptions });

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
    const correlationId =
      handleOptions?.correlationId ??
      observability.contextGenerator.generateCorrelationId();
    const causationId = handleOptions?.causationId;
    const commandScopeOptions = handleOptions?.observability;
    const appendOptionsFromHandle = toAppendOptions<
      Store,
      StreamEvent,
      EventPayloadType
    >(handleOptions);
    const appendSchema = appendOptionsFromHandle?.schema ?? options.schema;

    const result = await collector.startScope(
      {
        streamName,
        commandType,
        correlationId,
        causationId,
      },
      async (scope) =>
        asyncRetry(
          () =>
            withSession<Store, CommandHandlerResult<State, StreamEvent, Store>>(
              store,
              async ({ eventStore }) => {
                const { evolve, initialState } = options;

                // 1. Aggregate the stream
                const aggregationResult = await eventStore.aggregateStream<
                  State,
                  StreamEvent,
                  EventPayloadType
                >(streamName, {
                  evolve,
                  initialState,
                  observability: withOperationScope(scope),
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

                const stateBeforeBatch = aggregationResult.state;
                let state = stateBeforeBatch;

                const handlers = Array.isArray(handle) ? handle : [handle];
                let eventsToAppend: StreamEvent[] = [];
                let events: StreamEvent[] = [];

                // 3. Run business logic
                for (const handler of handlers) {
                  const decision = composeMiddleware<
                    State,
                    CommandMiddlewareContext,
                    StreamEvent
                  >(async (decisionState) => {
                    const result = await handler(decisionState);
                    return isDecisionHandlingResult<StreamEvent>(result)
                      ? result
                      : append(Array.isArray(result) ? result : [result]);
                  }, decisionMiddleware);
                  const result = await decision(state, undefined);
                  events = [...events, ...result.outputs];

                  if (
                    result.type === 'APPEND' ||
                    result.type === 'APPEND_AND_STOP'
                  ) {
                    state = result.outputs.reduce(evolve, state);
                    eventsToAppend = [...eventsToAppend, ...result.outputs];
                  }
                  if (result.type === 'REJECT') {
                    eventsToAppend = [];
                    state = stateBeforeBatch;
                    break;
                  }
                  if (
                    result.type === 'STOP' ||
                    result.type === 'APPEND_AND_STOP'
                  )
                    break;
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
                    events,
                    appendedEvents: [],
                    newEvents: [],
                    newState: state,

                    nextExpectedStreamVersion: currentStreamVersion,
                    createdNewStream: false,
                  } as unknown as CommandHandlerResult<
                    State,
                    StreamEvent,
                    Store
                  >;
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
                    ...(appendOptionsFromHandle ?? {}),
                    ...(appendSchema ? { schema: appendSchema } : {}),
                    expectedStreamVersion,
                    correlationId,
                    ...(causationId ? { causationId } : {}),
                    traceId,
                    spanId,
                    observability: withOperationScope(
                      scope,
                      appendOptionsFromHandle?.observability,
                    ),
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
                  events,
                  appendedEvents: eventsToAppend,
                  newEvents: eventsToAppend,
                  newState: state,
                } as unknown as CommandHandlerResult<State, StreamEvent, Store>;
              },
            ),
          fromCommandHandlerRetryOptions(
            handleOptions && 'retry' in handleOptions
              ? handleOptions.retry
              : options.retry,
          ),
        ),
      commandScopeOptions,
    );

    await afterAll?.(result, { streamName, handleOptions });
    return result;
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

const toAppendOptions = <
  Store extends EventStore,
  StreamEvent extends Event,
  EventPayloadType extends Event,
>(
  options: HandleOptions<Store> | undefined,
): AppendToStreamOptions<StreamEvent, EventPayloadType> | undefined => {
  if (!options) return undefined;

  return {
    ...(options.expectedStreamVersion !== undefined
      ? { expectedStreamVersion: options.expectedStreamVersion }
      : {}),
    ...(options.schema
      ? {
          schema: options.schema as AppendToStreamOptions<
            StreamEvent,
            EventPayloadType
          >['schema'],
        }
      : {}),
    ...(options.correlationId ? { correlationId: options.correlationId } : {}),
    ...(options.causationId ? { causationId: options.causationId } : {}),
    ...(options.traceId ? { traceId: options.traceId } : {}),
    ...(options.spanId ? { spanId: options.spanId } : {}),
    ...(options.observability ? { observability: options.observability } : {}),
  };
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

const isDecisionHandlingResult = <Output>(
  value: unknown,
): value is DecisionHandlingResult<Output> =>
  typeof value === 'object' &&
  value !== null &&
  'type' in value &&
  ['APPEND', 'SKIP', 'STOP', 'REJECT', 'APPEND_AND_STOP'].includes(
    (value as { type: string }).type,
  ) &&
  'outputs' in value &&
  Array.isArray((value as { outputs: unknown }).outputs);
