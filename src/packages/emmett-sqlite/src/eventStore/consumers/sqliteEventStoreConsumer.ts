import { dumbo } from '@event-driven-io/dumbo';
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
  type ReadEventMetadataWithGlobalPosition,
  type WorkflowProcessorContext,
} from '@event-driven-io/emmett';
import type {
  AnySQLiteEventStoreDriver,
  InferDumboOptionsFromEventStoreDriver,
  PoolOrConnectionOptions,
  InferPoolFromEventStoreDriver,
} from '../eventStoreDriver';
import {
  eventStoreDatabaseSchema,
  type EventStoreDatabaseSchemaOptions,
} from '../schema';
import { sqliteMessageSource } from './messageSource';
import {
  sqliteProjector,
  sqliteReactor,
  sqliteWorkflowProcessor,
  type SQLiteProcessor,
  type SQLiteProcessorHandlerContext,
  type SQLiteProjectorOptions,
  type SQLiteReactorOptions,
  type SQLiteWorkflowProcessorOptions,
} from './sqliteProcessor';

export type SQLiteEventStoreConsumerConfig<
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

export type SQLiteEventStoreConsumerConnectionOptions<
  ConsumerMessageType extends Message = Message,
  Driver extends AnySQLiteEventStoreDriver = AnySQLiteEventStoreDriver,
> = {
  driver: Driver;
  source?: MessageSource<
    ConsumerMessageType,
    ReadEventMetadataWithGlobalPosition
  >;
} & PoolOrConnectionOptions<Driver>;

export type SQLiteEventStoreConsumerOptions<
  ConsumerMessageType extends Message = Message,
  Driver extends AnySQLiteEventStoreDriver = AnySQLiteEventStoreDriver,
> = SQLiteEventStoreConsumerConfig<ConsumerMessageType> &
  SQLiteEventStoreConsumerConnectionOptions<ConsumerMessageType, Driver>;

export type SQLiteReactorFactory<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends AnyMessage = any,
  Driver extends AnySQLiteEventStoreDriver = AnySQLiteEventStoreDriver,
> = <MessageType extends ConsumerMessageType = ConsumerMessageType>(
  options: SQLiteReactorOptions<MessageType, MessageType, Driver>,
) => SQLiteProcessor<MessageType, Driver>;

export type SQLiteProjectorFactory<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends AnyMessage = any,
  Driver extends AnySQLiteEventStoreDriver = AnySQLiteEventStoreDriver,
> = <
  EventType extends ConsumerMessageType & AnyEvent = ConsumerMessageType &
    AnyEvent,
>(
  options: SQLiteProjectorOptions<EventType, EventType, Driver>,
) => SQLiteProcessor<EventType, Driver>;

export type SQLiteWorkflowProcessorFactory<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends AnyMessage = any,
  Driver extends AnySQLiteEventStoreDriver = AnySQLiteEventStoreDriver,
> = <
  Input extends ConsumerMessageType,
  State,
  Output extends ConsumerMessageType,
  MetaDataType extends AnyRecordedMessageMetadata = AnyRecordedMessageMetadata,
  HandlerContext extends SQLiteProcessorHandlerContext<Driver> &
    WorkflowProcessorContext = SQLiteProcessorHandlerContext<Driver> &
    WorkflowProcessorContext,
  StoredMessage extends AnyEvent | AnyCommand = Output,
>(
  options: Omit<
    SQLiteWorkflowProcessorOptions<
      Input,
      State,
      Output,
      MetaDataType,
      HandlerContext,
      StoredMessage
    >,
    'messageStore'
  >,
) => SQLiteProcessor<Input | Output, Driver>;

export type SQLiteEventStoreConsumer<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends AnyMessage = any,
  Driver extends AnySQLiteEventStoreDriver = AnySQLiteEventStoreDriver,
> = MessageConsumer<
  ConsumerMessageType,
  SQLiteReactorFactory<ConsumerMessageType, Driver>,
  SQLiteProjectorFactory<ConsumerMessageType, Driver>,
  SQLiteWorkflowProcessorFactory<ConsumerMessageType, Driver>
>;

export const sqliteEventStoreConsumer = <
  ConsumerMessageType extends Message = AnyMessage,
  Driver extends AnySQLiteEventStoreDriver = AnySQLiteEventStoreDriver,
>(
  options: SQLiteEventStoreConsumerOptions<ConsumerMessageType, Driver>,
): SQLiteEventStoreConsumer<ConsumerMessageType, Driver> => {
  const databaseSchema = eventStoreDatabaseSchema(options.schema);
  const processorMetadataSchema = {
    ...options.schema,
    ...databaseSchema,
  };
  const isOwnPool = !options.pool;
  const dumboOptions = {
    serialization: options.serialization,
    ...options.driver.mapToDumboOptions(options),
  } as InferDumboOptionsFromEventStoreDriver<Driver>;

  const pool = options.pool ?? dumbo(dumboOptions);

  const source = options.source
    ? { ...options.source, close: () => Promise.resolve() }
    : sqliteMessageSource<ConsumerMessageType>({
        pool,
        batchSize: options.pulling?.batchSize,
        pullingFrequencyInMs: options.pulling?.pullingFrequencyInMs,
        serialization: options.serialization,
        databaseSchemaName: databaseSchema.databaseSchemaName,
      });

  const workflowProcessorFactory: SQLiteWorkflowProcessorFactory<
    ConsumerMessageType
  > = (processorOptions) =>
    sqliteWorkflowProcessor({
      ...processorOptions,
      driver: options.driver,
      migrationOptions:
        processorOptions.migrationOptions ?? processorMetadataSchema,
    });

  const messageConsumer = consumer<
    ConsumerMessageType,
    ReadEventMetadataWithGlobalPosition,
    SQLiteProcessorHandlerContext<Driver>,
    SQLiteReactorFactory<ConsumerMessageType, Driver>,
    SQLiteProjectorFactory<ConsumerMessageType, Driver>,
    SQLiteWorkflowProcessorFactory<ConsumerMessageType, Driver>
  >({
    ...options,
    source,
    reactorFactory: (processorOptions) =>
      sqliteReactor({
        ...processorOptions,
        driver: options.driver,
        migrationOptions:
          processorOptions.migrationOptions ?? processorMetadataSchema,
      }),
    projectorFactory: (processorOptions) =>
      sqliteProjector({
        ...processorOptions,
        driver: options.driver,
        migrationOptions:
          processorOptions.migrationOptions ?? processorMetadataSchema,
      }),
    workflowProcessorFactory,
    batchSize: options.pulling?.batchSize,
    batchDeadlineInMs: options.pulling?.batchDeadlineInMs,
    scope: (handler) =>
      handler({
        // TODO: Fix this cast when the pool plumbing is driver-generic
        session: {
          pool: pool as InferPoolFromEventStoreDriver<Driver>,
          connectionOptions: dumboOptions,
        },
        execute: pool.execute,
      }),
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
