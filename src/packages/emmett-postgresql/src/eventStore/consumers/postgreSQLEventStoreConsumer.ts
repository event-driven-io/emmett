import { dumbo, type Dumbo } from '@event-driven-io/dumbo';
import {
  consumer,
  type AnyCommand,
  type AnyEvent,
  type AnyMessage,
  type AnyRecordedMessageMetadata,
  type JSONSerializationOptions,
  type Message,
  type MessageConsumer,
  type MessageConsumerOptions,
  type MessageSource,
  type RecordedMessageMetadataWithGlobalPosition,
  type WorkflowProcessorContext,
} from '@event-driven-io/emmett';
import {
  eventStoreDatabaseSchema,
  type EventStoreDatabaseSchemaOptions,
} from '../schema';
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
import { pgDumboDriver } from '@event-driven-io/dumbo/pg';

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
  schema?: EventStoreDatabaseSchemaOptions;
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

export type PostgreSQLProjectorFactory<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends AnyMessage = any,
> = <
  EventType extends ConsumerMessageType & AnyEvent = ConsumerMessageType &
    AnyEvent,
>(
  options: PostgreSQLProjectorOptions<EventType>,
) => PostgreSQLProcessor<EventType>;

export type PostgreSQLWorkflowProcessorFactory<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends AnyMessage = any,
> = <
  Input extends ConsumerMessageType,
  State,
  Output extends ConsumerMessageType,
  MetaDataType extends AnyRecordedMessageMetadata = AnyRecordedMessageMetadata,
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

export type PostgreSQLEventStoreConsumer<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends AnyMessage = any,
> = MessageConsumer<
  ConsumerMessageType,
  PostgreSQLReactorFactory<ConsumerMessageType>,
  PostgreSQLProjectorFactory<ConsumerMessageType>,
  PostgreSQLWorkflowProcessorFactory<ConsumerMessageType>
>;

export const postgreSQLEventStoreConsumer = <
  ConsumerMessageType extends Message = AnyMessage,
>(
  options: PostgreSQLEventStoreConsumerOptions<ConsumerMessageType>,
): PostgreSQLEventStoreConsumer<ConsumerMessageType> => {
  const databaseSchema = eventStoreDatabaseSchema(options.schema);
  const processorMetadataSchema = {
    ...options.schema,
    ...databaseSchema,
  };
  const isOwnPool = !options.pool;
  const pool = options.pool
    ? options.pool
    : dumbo({
        driver: pgDumboDriver,
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
        databaseSchemaName: databaseSchema.databaseSchemaName,
      });

  const processorContext = {
    execute: pool.execute,
    migrationOptions: processorMetadataSchema,
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
    PostgreSQLProcessorHandlerContext,
    PostgreSQLReactorFactory<ConsumerMessageType>,
    PostgreSQLProjectorFactory<ConsumerMessageType>,
    PostgreSQLWorkflowProcessorFactory<ConsumerMessageType>
  >({
    ...options,
    source,
    reactorFactory: (processorOptions) =>
      postgreSQLReactor({
        ...processorOptions,
        migrationOptions:
          processorOptions.migrationOptions ?? processorMetadataSchema,
      }),
    projectorFactory: (processorOptions) =>
      postgreSQLProjector({
        ...processorOptions,
        migrationOptions:
          processorOptions.migrationOptions ?? processorMetadataSchema,
      }),
    workflowProcessorFactory: (processorOptions) =>
      postgreSQLWorkflowProcessor({
        ...processorOptions,
        migrationOptions:
          processorOptions.migrationOptions ?? processorMetadataSchema,
      }),
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

  return messageConsumer;
};
