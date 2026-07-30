import { dumbo, type Dumbo } from '@event-driven-io/dumbo';
import {
  consumer,
  mergeObservability,
  type AnyCommand,
  type AnyEvent,
  type AnyMessage,
  type AnyRecordedMessageMetadata,
  type ConsumerObservabilityConfig,
  type JSONSerializationOptions,
  type Message,
  type MessageConsumer,
  type MessageConsumerOptions,
  type MessageSource,
  type RecordedMessageMetadataWithGlobalPosition,
  type WorkflowProcessorContext,
} from '@event-driven-io/emmett';
import { postgreSQLMessageSource } from './postgreSQLMessageSource';
import {
  postgreSQLProjector,
  postgreSQLReactor,
  postgreSQLWorkflowProcessor,
  type PostgreSQLProcessor,
  type PostgreSQLProcessorHandlerContext,
  type PostgreSQLProjectorOptions,
  type PostgreSQLReactorOptions,
  type PostgreSQLWorkflowProcessorOptions,
} from './postgreSQLProcessor';

export type PostgreSQLEventStoreConsumerConfig<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends Message = any,
> = MessageConsumerOptions<ConsumerMessageType> & {
  stopWhen?: {
    noMessagesLeft?: boolean;
  };
  pulling?: {
    batchSize?: number;
    batchDeadlineInMs?: number;
    pullingFrequencyInMs?: number;
  };
} & JSONSerializationOptions;

export type PostgreSQLEventStoreConsumerOptions<
  ConsumerMessageType extends Message = Message,
> = PostgreSQLEventStoreConsumerConfig<ConsumerMessageType> & {
  connectionString: string;
  pool?: Dumbo;
  source?: MessageSource<
    NoInfer<ConsumerMessageType>,
    RecordedMessageMetadataWithGlobalPosition
  >;
};

export type PostgreSQLEventStoreConsumer<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends AnyMessage = any,
> = MessageConsumer<ConsumerMessageType> &
  Readonly<{
    reactor: <MessageType extends AnyMessage = ConsumerMessageType>(
      options: PostgreSQLReactorOptions<MessageType>,
    ) => PostgreSQLProcessor<MessageType>;

    workflowProcessor: <
      Input extends AnyEvent | AnyCommand,
      State,
      Output extends AnyEvent | AnyCommand,
      MetaDataType extends AnyRecordedMessageMetadata =
        AnyRecordedMessageMetadata,
      HandlerContext extends PostgreSQLProcessorHandlerContext &
        WorkflowProcessorContext = PostgreSQLProcessorHandlerContext &
        WorkflowProcessorContext,
      StoredMessage extends AnyEvent | AnyCommand = Output,
    >(
      options: PostgreSQLWorkflowProcessorOptions<
        Input,
        State,
        Output,
        MetaDataType,
        HandlerContext,
        StoredMessage
      >,
    ) => PostgreSQLProcessor<Input | Output>;
  }> &
  (AnyEvent extends ConsumerMessageType
    ? Readonly<{
        projector: <
          EventType extends AnyEvent = ConsumerMessageType & AnyEvent,
        >(
          options: PostgreSQLProjectorOptions<EventType>,
        ) => PostgreSQLProcessor<EventType>;
      }>
    : object);

export const postgreSQLEventStoreConsumer = <
  ConsumerMessageType extends Message = AnyMessage,
>(
  options: PostgreSQLEventStoreConsumerOptions<ConsumerMessageType>,
): PostgreSQLEventStoreConsumer<ConsumerMessageType> => {
  const isOwnPool = !options.pool;
  const pool = options.pool
    ? options.pool
    : dumbo({
        connectionString: options.connectionString,
        serialization: options.serialization,
        transactionOptions: {
          allowNestedTransactions: true,
        },
      });

  // An injected source is borrowed, not owned, same as the pool above. Core
  // consumer closes the source it gets, so its close is stubbed out to leave
  // the lifecycle with whoever passed it.
  const source: MessageSource<
    ConsumerMessageType,
    RecordedMessageMetadataWithGlobalPosition
  > = options.source
    ? { ...options.source, close: () => Promise.resolve() }
    : postgreSQLMessageSource<ConsumerMessageType>({
        pool,
        batchSize: options.pulling?.batchSize,
        pullingFrequencyInMs: options.pulling?.pullingFrequencyInMs,
      });

  const processorContext = {
    execute: pool.execute,
    connection: {
      connectionString: options.connectionString,
      pool,
      client: undefined as never,
      transaction: undefined as never,
      messageStore: undefined as never,
    },
  } as unknown as PostgreSQLProcessorHandlerContext;

  const messageConsumer = consumer<
    ConsumerMessageType,
    RecordedMessageMetadataWithGlobalPosition,
    PostgreSQLProcessorHandlerContext
  >({
    ...options,
    source,
    batchSize: options.pulling?.batchSize,
    batchDeadlineInMs: options.pulling?.batchDeadlineInMs,
    scope: (handler) => handler(processorContext),
    until:
      options.until ??
      (options.stopWhen?.noMessagesLeft === true
        ? { noMessagesLeft: true }
        : undefined),
    hooks: {
      onClose: async () => {
        if (isOwnPool) await pool.close();
      },
    },
  });

  const withMergedObservability = <
    ProcessorOptionsType extends {
      observability?: ConsumerObservabilityConfig;
    },
  >(
    processorOptions: ProcessorOptionsType,
  ): ProcessorOptionsType => ({
    ...processorOptions,
    observability: mergeObservability(
      options.observability,
      processorOptions.observability,
    ),
  });

  return {
    ...messageConsumer,
    get isRunning() {
      return messageConsumer.isRunning;
    },
    reactor: <MessageType extends AnyMessage = ConsumerMessageType>(
      processorOptions: PostgreSQLReactorOptions<MessageType>,
    ): PostgreSQLProcessor<MessageType> =>
      messageConsumer.register(
        postgreSQLReactor(withMergedObservability(processorOptions)),
      ),
    projector: <EventType extends AnyEvent = ConsumerMessageType & AnyEvent>(
      processorOptions: PostgreSQLProjectorOptions<EventType>,
    ): PostgreSQLProcessor<EventType> =>
      messageConsumer.register(
        postgreSQLProjector(withMergedObservability(processorOptions)),
      ),
    workflowProcessor: <
      Input extends AnyEvent | AnyCommand,
      State,
      Output extends AnyEvent | AnyCommand,
      MetaDataType extends AnyRecordedMessageMetadata =
        AnyRecordedMessageMetadata,
      HandlerContext extends PostgreSQLProcessorHandlerContext &
        WorkflowProcessorContext = PostgreSQLProcessorHandlerContext &
        WorkflowProcessorContext,
      StoredMessage extends AnyEvent | AnyCommand = Output,
    >(
      processorOptions: PostgreSQLWorkflowProcessorOptions<
        Input,
        State,
        Output,
        MetaDataType,
        HandlerContext,
        StoredMessage
      >,
    ): PostgreSQLProcessor<Input | Output> =>
      messageConsumer.register(
        postgreSQLWorkflowProcessor(withMergedObservability(processorOptions)),
      ),
  };
};
