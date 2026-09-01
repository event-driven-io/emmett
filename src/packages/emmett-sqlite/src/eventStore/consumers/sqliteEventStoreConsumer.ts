import { dumbo, type Dumbo } from '@event-driven-io/dumbo';
import { sqliteAmbientConnectionPool } from '@event-driven-io/dumbo/sqlite';
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
  AnyEventStoreDriver,
  InferOptionsFromEventStoreDriver,
} from '../eventStoreDriver';
import {
  eventStoreDatabaseSchema,
  type EventStoreDatabaseSchemaOptions,
} from '../schema';
import { getSQLiteEventStore } from '../SQLiteEventStore';
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
};

export type SQLiteEventStoreConsumerOptions<
  ConsumerMessageType extends Message = Message,
  Driver extends AnyEventStoreDriver = AnyEventStoreDriver,
> = SQLiteEventStoreConsumerConfig<ConsumerMessageType> & {
  driver: Driver;
  pool?: Dumbo;
  source?: MessageSource<
    ConsumerMessageType,
    ReadEventMetadataWithGlobalPosition
  >;
} & InferOptionsFromEventStoreDriver<Driver> &
  JSONSerializationOptions;

export type SQLiteReactorFactory<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends AnyMessage = any,
> = <MessageType extends ConsumerMessageType = ConsumerMessageType>(
  options: SQLiteReactorOptions<MessageType>,
) => SQLiteProcessor<MessageType>;

export type SQLiteProjectorFactory<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends AnyMessage = any,
> = <
  EventType extends ConsumerMessageType & AnyEvent = ConsumerMessageType &
    AnyEvent,
>(
  options: SQLiteProjectorOptions<EventType>,
) => SQLiteProcessor<EventType>;

export type SQLiteWorkflowProcessorFactory<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends AnyMessage = any,
> = <
  Input extends ConsumerMessageType,
  State,
  Output extends ConsumerMessageType,
  MetaDataType extends AnyRecordedMessageMetadata = AnyRecordedMessageMetadata,
  HandlerContext extends SQLiteProcessorHandlerContext &
    WorkflowProcessorContext = SQLiteProcessorHandlerContext &
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
) => SQLiteProcessor<Input | Output>;

export type SQLiteEventStoreConsumer<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends AnyMessage = any,
> = MessageConsumer<
  ConsumerMessageType,
  SQLiteReactorFactory<ConsumerMessageType>,
  SQLiteProjectorFactory<ConsumerMessageType>,
  SQLiteWorkflowProcessorFactory<ConsumerMessageType>
>;

export const sqliteEventStoreConsumer = <
  ConsumerMessageType extends Message = AnyMessage,
  Driver extends AnyEventStoreDriver = AnyEventStoreDriver,
>(
  options: SQLiteEventStoreConsumerOptions<ConsumerMessageType, Driver>,
): SQLiteEventStoreConsumer<ConsumerMessageType> => {
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
        mode: 'session_based',
      },
      ...options.driver.mapToDumboOptions(options),
    });

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
      migrationOptions:
        processorOptions.migrationOptions ?? processorMetadataSchema,
      messageStore: (connection) =>
        getSQLiteEventStore({
          ...options,
          pool: sqliteAmbientConnectionPool({
            driverType: options.driver.driverType,
            connection,
          }),
          schema: { autoMigration: 'None', ...databaseSchema },
        }),
    });

  const messageConsumer = consumer<
    ConsumerMessageType,
    ReadEventMetadataWithGlobalPosition,
    SQLiteProcessorHandlerContext,
    SQLiteReactorFactory<ConsumerMessageType>,
    SQLiteProjectorFactory<ConsumerMessageType>,
    SQLiteWorkflowProcessorFactory<ConsumerMessageType>
  >({
    ...options,
    source,
    reactorFactory: (processorOptions) =>
      sqliteReactor({
        ...processorOptions,
        migrationOptions:
          processorOptions.migrationOptions ?? processorMetadataSchema,
      }),
    projectorFactory: (processorOptions) =>
      sqliteProjector({
        ...processorOptions,
        migrationOptions:
          processorOptions.migrationOptions ?? processorMetadataSchema,
      }),
    workflowProcessorFactory,
    batchSize: options.pulling?.batchSize,
    batchDeadlineInMs: options.pulling?.batchDeadlineInMs,
    scope: (handler) =>
      pool.withConnection((connection) =>
        handler({
          connection,
          execute: connection.execute,
        }),
      ),
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
