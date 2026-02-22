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
  type ReadStreamOptions,
} from '../eventStore';
import type {
  AnyCommand,
  AnyEvent,
  AnyReadEventMetadata,
  DefaultRecord,
  Event,
  RecordedMessage,
} from '../typing';
import { asyncRetry, NoRetries, type AsyncRetryOptions } from '../utils';
import type { WorkflowEvent } from './workflow';
import type { WorkflowOptions } from './workflowProcessor';

export const WorkflowHandlerStreamVersionConflictRetryOptions: AsyncRetryOptions =
  {
    retries: 3,
    minTimeout: 100,
    factor: 1.5,
    shouldRetryError: isExpectedVersionConflictError,
  };

export type WorkflowHandlerRetryOptions =
  | AsyncRetryOptions
  | { onVersionConflict: true | number | AsyncRetryOptions };

const fromWorkflowHandlerRetryOptions = (
  retryOptions: WorkflowHandlerRetryOptions | undefined,
): AsyncRetryOptions => {
  if (retryOptions === undefined) return NoRetries;

  if ('onVersionConflict' in retryOptions) {
    if (typeof retryOptions.onVersionConflict === 'boolean')
      return WorkflowHandlerStreamVersionConflictRetryOptions;
    else if (typeof retryOptions.onVersionConflict === 'number')
      return {
        ...WorkflowHandlerStreamVersionConflictRetryOptions,
        retries: retryOptions.onVersionConflict,
      };
    else return retryOptions.onVersionConflict;
  }

  return retryOptions;
};

// #region workflow-handler
export type WorkflowHandlerResult<
  Output extends AnyEvent | AnyCommand,
  Store extends EventStore,
> = AppendStreamResultOfEventStore<Store> & {
  newMessages: Output[];
};

export type HandleOptions<Store extends EventStore> = Parameters<
  Store['appendToStream']
>[2] &
  (
    | {
        expectedStreamVersion?: ExpectedStreamVersion;
      }
    | {
        retry?: WorkflowHandlerRetryOptions;
      }
  );

export const WorkflowHandler =
  <
    Input extends AnyEvent | AnyCommand,
    State,
    Output extends AnyEvent | AnyCommand,
    MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
    HandlerContext extends DefaultRecord = DefaultRecord,
    StoredMessage extends AnyEvent | AnyCommand = Output,
  >(
    options: WorkflowOptions<
      Input,
      State,
      Output,
      MessageMetadataType,
      StoredMessage
    > & {
      retry?: WorkflowHandlerRetryOptions;
    },
  ) =>
  async <Store extends EventStore>(
    store: Store,
    message: RecordedMessage<Input, MessageMetadataType>,
    _context: HandlerContext,
    handleOptions?: HandleOptions<Store>,
  ): Promise<WorkflowHandlerResult<Output, Store>> =>
    asyncRetry(
      async () => {
        const result = await withSession<
          Store,
          WorkflowHandlerResult<Output, Store>
        >(store, async ({ eventStore }) => {
          const {
            workflow: { evolve, initialState, decide },
            getWorkflowId,
          } = options;

          const streamName = getWorkflowId(message);

          if (!streamName) {
            return {
              newMessages: [],
              createdNewStream: false,
              nextExpectedStreamVersion: 0n,
            } as unknown as WorkflowHandlerResult<Output, Store>;
          }

          // 1. Aggregate the stream
          const aggregationResult = await eventStore.aggregateStream<
            State,
            WorkflowEvent<Input | Output>,
            StoredMessage & Event
          >(streamName, {
            evolve,
            initialState,
            read: {
              // TODO: Fix this any
              // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
              schema: options.schema as any,
              ...(handleOptions as ReadStreamOptions<
                WorkflowEvent<Input | Output>,
                StoredMessage & Event
              >),
              // expected stream version is passed to fail fast
              // if stream is in the wrong state

              expectedStreamVersion:
                handleOptions?.expectedStreamVersion ?? NO_CONCURRENCY_CHECK,
            },
          });

          // 2. Use the aggregate state

          const {
            currentStreamVersion,
            streamExists: _streamExists,
            ...restOfAggregationResult
          } = aggregationResult;

          const state = aggregationResult.state;

          // 3. Run business logic
          const result = decide(message as Input, state);

          const messagesToAppend = Array.isArray(result) ? result : [result];

          //const newEvents = Array.isArray(result) ? result : [result];

          if (messagesToAppend.length === 0) {
            return {
              ...restOfAggregationResult,
              newMessages: [],

              nextExpectedStreamVersion: currentStreamVersion,
              createdNewStream: false,
            } as unknown as WorkflowHandlerResult<Output, Store>;
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
          const appendResult = await eventStore.appendToStream(
            streamName,
            // TODO: Fix this cast
            messagesToAppend as unknown as Event[],
            {
              ...(handleOptions as AppendToStreamOptions<
                Event,
                StoredMessage & Event
              >),
              expectedStreamVersion,
            },
          );

          // 5. Return result with updated state
          return {
            ...appendResult,
            newMessages: messagesToAppend,
          } as unknown as WorkflowHandlerResult<Output, Store>;
        });

        return result;
      },
      fromWorkflowHandlerRetryOptions(
        handleOptions && 'retry' in handleOptions
          ? handleOptions.retry
          : options.retry,
      ),
    );
// #endregion stream-handler

const withSession = <EventStoreType extends EventStore, T = unknown>(
  eventStore: EventStoreType,
  callback: (session: EventStoreSession<EventStoreType>) => Promise<T>,
) => {
  const sessionFactory = canCreateEventStoreSession<EventStoreType>(eventStore)
    ? eventStore
    : nulloSessionFactory<EventStoreType>(eventStore);

  return sessionFactory.withSession(callback);
};
