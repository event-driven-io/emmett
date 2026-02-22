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
            workflow: { evolve, initialState, decide, name: workflowName },
            getWorkflowId,
          } = options;

          const workflowId = getWorkflowId(message);

          if (!workflowId) {
            return {
              newMessages: [],
              createdNewStream: false,
              nextExpectedStreamVersion: 0n,
            } as unknown as WorkflowHandlerResult<Output, Store>;
          }

          const streamName = options.mapWorkflowId
            ? options.mapWorkflowId(workflowId)
            : `emt:workflow:${workflowId}`;

          // 1. Aggregate the stream
          const aggregationResult = await eventStore.aggregateStream<
            State,
            WorkflowEvent<Input | Output>,
            StoredMessage & Event
          >(streamName, {
            evolve,
            initialState,
            read: {
              schema: {
                ...options.schema,
                // TODO: fix this any
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                versioning: {
                  upcast: (event: StoredMessage) => {
                    const eventType = event.type as string;

                    const mappedInput = eventType.startsWith(`${workflowName}:`)
                      ? ({
                          ...event,

                          type: eventType.replace(`${workflowName}:`, ''),
                        } as unknown as StoredMessage)
                      : event;

                    if (options.schema?.versioning?.upcast) {
                      return options.schema.versioning.upcast(mappedInput);
                    }

                    return mappedInput as unknown as Input;
                  },
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                } as any,
              },
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

          const { currentStreamVersion } = aggregationResult;

          const state = aggregationResult.state;

          // 3. Run business logic
          const result = decide(message as Input, state);

          const inputToStore = {
            type: `${workflowName}:${message.type}`,
            data: message.data,
            kind: message.kind,

            metadata: {
              // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
              originalMessageId: message.metadata.messageId,
              input: true,
            },
          } as StoredMessage;

          const outputMessages = Array.isArray(result) ? result : [result];
          const messagesToAppend = [inputToStore, ...outputMessages];

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

          // 5. Return result with output messages only
          return {
            ...appendResult,
            newMessages: outputMessages,
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
