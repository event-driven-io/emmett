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
  type ReadStreamOptions,
} from '../eventStore';
import type {
  AnyCommand,
  AnyEvent,
  AnyReadEventMetadata,
  Event,
  RecordedMessage,
} from '../typing';
import { asyncRetry, NoRetries, type AsyncRetryOptions } from '../utils';
import type {
  WorkflowEvent,
  WorkflowInputMessageMetadata,
  WorkflowMessageAction,
} from './workflow';
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

export type WorkflowHandleOptions<Store extends EventStore> = Parameters<
  Store['appendToStream']
>[2] & {
  expectedStreamVersion?: ExpectedStreamVersion;
  retry?: WorkflowHandlerRetryOptions;
};

type WorkflowInternalState<State> = {
  userState: State;
  processedInputIds: Set<string>;
};

const emptyHandlerResult = <
  Output extends AnyEvent | AnyCommand,
  Store extends EventStore,
>(
  nextExpectedStreamVersion: bigint = 0n,
): WorkflowHandlerResult<Output, Store> =>
  ({
    newMessages: [] as Output[],
    createdNewStream: false,
    nextExpectedStreamVersion,
  }) as unknown as WorkflowHandlerResult<Output, Store>;

const createInputMetadata = (
  originalMessageId: string,
  action: Extract<WorkflowMessageAction, 'InitiatedBy' | 'Received'>,
): WorkflowInputMessageMetadata => ({
  originalMessageId,
  input: true,
  action,
});

const tagOutputMessage = <Output extends AnyEvent | AnyCommand>(
  msg: Output,
  action: Extract<WorkflowMessageAction, 'Sent' | 'Published' | 'Scheduled'>,
): Output => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const existingMetadata =
    'metadata' in msg && msg.metadata ? msg.metadata : {};
  return {
    ...msg,
    metadata: {
      ...existingMetadata,
      action,
    },
  } as Output;
};

const createWrappedInitialState = <State>(initialState: () => State) => {
  return (): WorkflowInternalState<State> => ({
    userState: initialState(),
    processedInputIds: new Set(),
  });
};

const createWrappedEvolve = <
  Input extends AnyEvent | AnyCommand,
  Output extends AnyEvent | AnyCommand,
  State,
>(
  evolve: (state: State, event: WorkflowEvent<Input | Output>) => State,
  workflowName: string,
  separateInputInboxFromProcessing: boolean,
) => {
  return (
    state: WorkflowInternalState<State>,
    event: WorkflowEvent<Input | Output>,
  ): WorkflowInternalState<State> => {
    const metadata = (event as Record<string, unknown>).metadata as
      | Record<string, unknown>
      | undefined;

    // Track processed inputs for idempotency
    let processedInputIds = state.processedInputIds;
    if (
      metadata?.input === true &&
      typeof metadata?.originalMessageId === 'string'
    ) {
      processedInputIds = new Set(state.processedInputIds);
      processedInputIds.add(metadata.originalMessageId);
    }

    // In separated inbox mode, don't apply inputs to state - they're just sitting in inbox
    // Only outputs (from processing) should update state
    if (separateInputInboxFromProcessing && metadata?.input === true) {
      return {
        userState: state.userState,
        processedInputIds,
      };
    }

    // Strip workflow prefix from input event types
    const eventType = event.type as string;
    const eventForEvolve = eventType.startsWith(`${workflowName}:`)
      ? ({
          ...event,
          type: eventType.replace(`${workflowName}:`, ''),
        } as WorkflowEvent<Input | Output>)
      : event;

    return {
      userState: evolve(state.userState, eventForEvolve),
      processedInputIds,
    };
  };
};

export const workflowStreamName = ({
  workflowName,
  workflowId,
}: {
  workflowName: string;
  workflowId: string;
}) => `emt:workflow:${workflowName}:${workflowId}`;

export const WorkflowHandler =
  <
    Input extends AnyEvent | AnyCommand,
    State,
    Output extends AnyEvent | AnyCommand,
    MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
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
    message: Input | RecordedMessage<Input, MessageMetadataType>,
    handleOptions?: WorkflowHandleOptions<Store>,
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

          const inputMessageId =
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            ('metadata' in message && message.metadata?.messageId
              ? // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                (message.metadata.messageId as string | undefined)
              : undefined) ?? uuid();

          const messageWithMetadata: RecordedMessage<
            Input,
            MessageMetadataType
          > = {
            ...message,
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            metadata: {
              messageId: inputMessageId,
              ...(message as RecordedMessage<Input, MessageMetadataType>)
                .metadata,
            },
          } as RecordedMessage<Input, MessageMetadataType>;

          const workflowId = getWorkflowId(messageWithMetadata);

          if (!workflowId) {
            return emptyHandlerResult<Output, Store>();
          }

          const streamName = options.mapWorkflowId
            ? options.mapWorkflowId(workflowId)
            : workflowStreamName({ workflowName, workflowId });

          const messageType = messageWithMetadata.type as string;
          const hasWorkflowPrefix = messageType.startsWith(`${workflowName}:`);

          // Separated inbox mode: store-only path (no prefix = external input)
          if (options.separateInputInboxFromProcessing && !hasWorkflowPrefix) {
            const inputMetadata = createInputMetadata(
              inputMessageId,
              'InitiatedBy',
            );

            const inputToStore = {
              type: `${workflowName}:${messageWithMetadata.type}`,
              data: messageWithMetadata.data,
              kind: messageWithMetadata.kind,
              metadata: inputMetadata,
            } as StoredMessage;

            const appendResult = await eventStore.appendToStream(
              streamName,
              [inputToStore] as unknown as Event[],
              {
                ...(handleOptions as AppendToStreamOptions<
                  Event,
                  StoredMessage & Event
                >),
                expectedStreamVersion:
                  handleOptions?.expectedStreamVersion ?? NO_CONCURRENCY_CHECK,
              },
            );

            return {
              ...appendResult,
              newMessages: [] as Output[],
            } as unknown as WorkflowHandlerResult<Output, Store>;
          }

          // Wrap the evolve and initialState for idempotency tracking
          const wrappedInitialState = createWrappedInitialState(initialState);
          const wrappedEvolve = createWrappedEvolve(
            evolve,
            workflowName,
            options.separateInputInboxFromProcessing ?? false,
          ) as (
            state: WorkflowInternalState<State>,
            event: WorkflowEvent<Input | Output>,
          ) => WorkflowInternalState<State>;

          // 1. Aggregate the stream
          const aggregationResult = await eventStore.aggregateStream<
            WorkflowInternalState<State>,
            WorkflowEvent<Input | Output>,
            StoredMessage & Event
          >(streamName, {
            evolve: wrappedEvolve,
            initialState: wrappedInitialState,
            read: {
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

          const { userState: state, processedInputIds } =
            aggregationResult.state;

          // Idempotency: skip if this input was already processed

          if (processedInputIds.has(inputMessageId)) {
            return emptyHandlerResult<Output, Store>(currentStreamVersion);
          }

          // 3. Run business logic
          // Strip workflow prefix from message type if present (for separated inbox processing)
          const messageForDecide = hasWorkflowPrefix
            ? ({
                ...messageWithMetadata,
                type: messageType.replace(`${workflowName}:`, ''),
              } as Input)
            : (messageWithMetadata as Input);

          const result = decide(messageForDecide, state);

          const inputMetadata = createInputMetadata(
            inputMessageId,
            aggregationResult.streamExists ? 'Received' : 'InitiatedBy',
          );

          const inputToStore = {
            type: `${workflowName}:${messageWithMetadata.type}`,
            data: messageWithMetadata.data,
            kind: messageWithMetadata.kind,
            metadata: inputMetadata,
          } as StoredMessage;

          const outputMessages = (
            Array.isArray(result) ? result : [result]
          ).filter((msg): msg is Output => msg !== undefined && msg !== null);

          const outputCommandTypes = options.outputs?.commands ?? [];
          const taggedOutputMessages = outputMessages.map((msg) => {
            const action: WorkflowMessageAction = outputCommandTypes.includes(
              msg.type as string,
            )
              ? 'Sent'
              : 'Published';
            return tagOutputMessage(msg, action);
          });

          const messagesToAppend =
            options.separateInputInboxFromProcessing && hasWorkflowPrefix
              ? [...taggedOutputMessages] // input already in stream
              : [inputToStore, ...taggedOutputMessages]; // normal: store input + outputs

          // If there are no messages to append, return early with current state
          if (messagesToAppend.length === 0) {
            return emptyHandlerResult<Output, Store>(currentStreamVersion);
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
