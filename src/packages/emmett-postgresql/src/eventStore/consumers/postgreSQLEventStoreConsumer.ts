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
  pgEventStoreDriver,
  type PgEventStoreDriver,
  type PgEventStoreDriverOptions,
} from '../../pg';
import type {
  AnyEventStoreDriver,
  InferOptionsFromEventStoreDriver,
} from '../eventStoreDriver';
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

export type PostgreSQLEventStoreConsumerConnectionOptions<
  ConsumerMessageType extends Message = Message,
  Driver extends AnyEventStoreDriver = PgEventStoreDriver,
> = {
  pool?: Dumbo;
  source?: MessageSource<
    NoInfer<ConsumerMessageType>,
    RecordedMessageMetadataWithGlobalPosition
  >;
} & {
  /**
   * @deprecated pass `driver` instead; this form is removed in the next major.
   */
  connectionString?: string;
  driver?: Driver;
} & Partial<InferOptionsFromEventStoreDriver<Driver>>;

export type PostgreSQLEventStoreConsumerOptions<
  ConsumerMessageType extends Message = Message,
  Driver extends AnyEventStoreDriver = PgEventStoreDriver,
> = PostgreSQLEventStoreConsumerConfig<ConsumerMessageType> &
  PostgreSQLEventStoreConsumerConnectionOptions<ConsumerMessageType, Driver>;

export type PostgreSQLReactorFactory<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends AnyMessage = any,
  Driver extends AnyEventStoreDriver = PgEventStoreDriver,
> = <MessageType extends ConsumerMessageType = ConsumerMessageType>(
  options: PostgreSQLReactorOptions<MessageType, MessageType, Driver>,
) => PostgreSQLProcessor<MessageType, Driver>;

export type PostgreSQLProjectorFactory<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends AnyMessage = any,
  Driver extends AnyEventStoreDriver = PgEventStoreDriver,
> = <
  EventType extends ConsumerMessageType & AnyEvent = ConsumerMessageType &
    AnyEvent,
>(
  options: PostgreSQLProjectorOptions<EventType, EventType, Driver>,
) => PostgreSQLProcessor<EventType, Driver>;

export type PostgreSQLWorkflowProcessorFactory<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends AnyMessage = any,
  Driver extends AnyEventStoreDriver = PgEventStoreDriver,
> = <
  Input extends ConsumerMessageType,
  State,
  Output extends ConsumerMessageType,
  MetaDataType extends AnyRecordedMessageMetadata = AnyRecordedMessageMetadata,
  HandlerContext extends PostgreSQLProcessorHandlerContext<Driver> &
    WorkflowProcessorContext = PostgreSQLProcessorHandlerContext<Driver> &
    WorkflowProcessorContext,
  StoredMessage extends AnyEvent | AnyCommand = Output,
>(
  options: PostgreSQLWorkflowProcessorOptions<
    Input,
    State,
    Output,
    MetaDataType,
    HandlerContext,
    StoredMessage,
    Driver
  >,
) => PostgreSQLProcessor<Input | Output, Driver>;

export type PostgreSQLEventStoreConsumer<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends AnyMessage = any,
  Driver extends AnyEventStoreDriver = PgEventStoreDriver,
> = MessageConsumer<
  ConsumerMessageType,
  PostgreSQLReactorFactory<ConsumerMessageType, Driver>,
  PostgreSQLProjectorFactory<ConsumerMessageType, Driver>,
  PostgreSQLWorkflowProcessorFactory<ConsumerMessageType, Driver>
>;

export const postgreSQLEventStoreConsumer = <
  ConsumerMessageType extends Message = AnyMessage,
  Driver extends AnyEventStoreDriver = PgEventStoreDriver,
>(
  options: PostgreSQLEventStoreConsumerOptions<ConsumerMessageType, Driver>,
): PostgreSQLEventStoreConsumer<ConsumerMessageType, Driver> => {
  const databaseSchema = eventStoreDatabaseSchema(options.schema);
  const processorMetadataSchema = {
    ...options.schema,
    ...databaseSchema,
  };
  const isOwnPool = !options.pool;
  const pool =
    options.pool ??
    dumbo({
      serialization: options.serialization,
      transactionOptions: {
        allowNestedTransactions: true,
      },
      ...(options.driver ?? pgEventStoreDriver).mapToDumboOptions(
        options as PgEventStoreDriverOptions,
      ),
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
  } as unknown as PostgreSQLProcessorHandlerContext<Driver>;

  const messageConsumer = consumer<
    ConsumerMessageType,
    RecordedMessageMetadataWithGlobalPosition,
    PostgreSQLProcessorHandlerContext<Driver>,
    PostgreSQLReactorFactory<ConsumerMessageType, Driver>,
    PostgreSQLProjectorFactory<ConsumerMessageType, Driver>,
    PostgreSQLWorkflowProcessorFactory<ConsumerMessageType, Driver>
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
