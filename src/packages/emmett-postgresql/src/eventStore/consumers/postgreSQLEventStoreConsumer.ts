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
import { postgreSQLMessageSource } from './messageSource';
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

export type PostgreSQLReactorFactory<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends AnyMessage = any,
> = <MessageType extends ConsumerMessageType = ConsumerMessageType>(
  options: PostgreSQLReactorOptions<MessageType>,
) => PostgreSQLProcessor<MessageType>;

export type PostgreSQLEventStoreConsumer<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends AnyMessage = any,
> = MessageConsumer<
  ConsumerMessageType,
  PostgreSQLReactorFactory<ConsumerMessageType>
> &
  Readonly<{
    workflowProcessor: <
      Input extends ConsumerMessageType,
      State,
      Output extends ConsumerMessageType,
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
          EventType extends ConsumerMessageType & AnyEvent =
            ConsumerMessageType & AnyEvent,
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

  const messageConsumer = consumer<
    ConsumerMessageType,
    RecordedMessageMetadataWithGlobalPosition,
    PostgreSQLProcessorHandlerContext,
    PostgreSQLReactorFactory<ConsumerMessageType>
  >({
    ...options,
    source,
    reactorFactory: postgreSQLReactor,
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

  return {
    ...messageConsumer,
    get isRunning() {
      return messageConsumer.isRunning;
    },
    projector: <
      EventType extends ConsumerMessageType & AnyEvent = ConsumerMessageType &
        AnyEvent,
    >(
      processorOptions: PostgreSQLProjectorOptions<EventType>,
    ): PostgreSQLProcessor<EventType> =>
      messageConsumer.reactor(
        postgreSQLProjector(withMergedObservability(processorOptions)),
      ),
    workflowProcessor: <
      Input extends ConsumerMessageType,
      State,
      Output extends ConsumerMessageType,
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
      messageConsumer.reactor(
        postgreSQLWorkflowProcessor(withMergedObservability(processorOptions)),
      ),
  };
};
