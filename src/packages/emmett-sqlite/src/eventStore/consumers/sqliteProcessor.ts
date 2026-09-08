import {
  dumbo,
  type AnyDatabaseTransaction,
  type DatabaseDriverType,
  type SQLExecutor,
} from '@event-driven-io/dumbo';
import type { AnySQLiteConnection } from '@event-driven-io/dumbo/sqlite';
import { sqliteAmbientConnectionPool } from '@event-driven-io/dumbo/sqlite';
import type {
  AnyCommand,
  AnyEvent,
  AnyMessage,
  AnyRecordedMessageMetadata,
  BatchRecordedMessageHandlerWithContext,
  Checkpointer,
  CurrentMessageProcessorPosition,
  JSONSerializationOptions,
  Message,
  MessageHandlerContext,
  MessageProcessingScope,
  PartialHandlerContext,
  MessageProcessor,
  ProcessorHooks,
  ProjectorOptions,
  ReactorOptions,
  ReadEventMetadataWithGlobalPosition,
  SingleMessageHandlerResult,
  SingleRecordedMessageHandlerWithContext,
  WorkflowProcessorContext,
  WorkflowProcessorOptions,
} from '@event-driven-io/emmett';
import {
  defaultProcessorPartition,
  defaultProcessorVersion,
  EmmettError,
  getProcessorInstanceId,
  getProjectorId,
  getWorkflowId,
  inMemoryCheckpointer,
  noopScope,
  projector,
  reactor,
  workflowProcessor,
  type Event,
  type ReadEvent,
} from '@event-driven-io/emmett';
import { eventStoreDriverOf } from '../eventStoreDriver';
import type {
  AnySQLiteEventStoreDriver,
  InferDumboConnectionFromEventStoreDriver,
  InferDumboOptionsFromEventStoreDriver,
  InferOptionsFromEventStoreDriver,
  InferPoolFromEventStoreDriver,
  InferTransactionFromEventStoreDriver,
} from '../eventStoreDriver';
import type { EventStoreSchemaMigrationOptions } from '../schema';
import {
  getSQLiteEventStore,
  type SQLiteEventStore,
} from '../SQLiteEventStore';
import { sqliteCheckpointer } from './sqliteCheckpointer';

export type SQLiteProcessorEventsBatch<EventType extends Event = Event> = {
  messages: ReadEvent<EventType, ReadEventMetadataWithGlobalPosition>[];
};

export type SQLiteProcessorHandlerContext<
  Driver extends AnySQLiteEventStoreDriver = AnySQLiteEventStoreDriver,
> = MessageHandlerContext<
  {
    partition: string;
    execute: SQLExecutor;
    driverType: DatabaseDriverType;
    driver?: Driver;
  } &
    // TODO: Reconsider if it should be for all processors
    EventStoreSchemaMigrationOptions,
  {
    connection: InferDumboConnectionFromEventStoreDriver<Driver>;
    transaction: InferTransactionFromEventStoreDriver<Driver>;
    pool: InferPoolFromEventStoreDriver<Driver>;
    messageStore: SQLiteEventStore;
    connectionOptions?: InferDumboOptionsFromEventStoreDriver<Driver>;
  }
>;

export type SQLiteProcessor<
  MessageType extends Message = AnyMessage,
  Driver extends AnySQLiteEventStoreDriver = AnySQLiteEventStoreDriver,
> = MessageProcessor<
  MessageType,
  ReadEventMetadataWithGlobalPosition,
  SQLiteProcessorHandlerContext<Driver>
>;

export type SQLiteProcessorEachMessageHandler<
  MessageType extends Message = Message,
  Driver extends AnySQLiteEventStoreDriver = AnySQLiteEventStoreDriver,
> = SingleRecordedMessageHandlerWithContext<
  MessageType,
  ReadEventMetadataWithGlobalPosition,
  SQLiteProcessorHandlerContext<Driver>
>;

export type SQLiteProcessorEachBatchHandler<
  MessageType extends Message = Message,
  Driver extends AnySQLiteEventStoreDriver = AnySQLiteEventStoreDriver,
> = BatchRecordedMessageHandlerWithContext<
  MessageType,
  ReadEventMetadataWithGlobalPosition,
  SQLiteProcessorHandlerContext<Driver>
>;

export type SQLiteProcessorStartFrom =
  CurrentMessageProcessorPosition | 'CURRENT';

export type SQLiteProcessorConnectionOptions<
  Driver extends AnySQLiteEventStoreDriver = AnySQLiteEventStoreDriver,
> = {
  connection?: AnySQLiteConnection;
  pool?: InferPoolFromEventStoreDriver<Driver>;
} & Partial<InferOptionsFromEventStoreDriver<Driver>>;

type SQLiteConnectionOptions<
  Driver extends AnySQLiteEventStoreDriver = AnySQLiteEventStoreDriver,
> = {
  connectionOptions?: SQLiteProcessorConnectionOptions<Driver>;
  driver?: Driver;
} & JSONSerializationOptions;

type SQLiteProcessorOptionsBase<
  Driver extends AnySQLiteEventStoreDriver = AnySQLiteEventStoreDriver,
> = SQLiteConnectionOptions<Driver> & EventStoreSchemaMigrationOptions;

export type SQLiteReactorOptions<
  MessageType extends Message = Message,
  MessagePayloadType extends AnyMessage = MessageType,
  Driver extends AnySQLiteEventStoreDriver = AnySQLiteEventStoreDriver,
> = ReactorOptions<
  MessageType,
  ReadEventMetadataWithGlobalPosition,
  SQLiteProcessorHandlerContext<Driver>,
  MessagePayloadType
> &
  SQLiteProcessorOptionsBase<Driver>;

export type SQLiteProjectorOptions<
  EventType extends AnyEvent = AnyEvent,
  EventPayloadType extends Event = EventType,
  Driver extends AnySQLiteEventStoreDriver = AnySQLiteEventStoreDriver,
> = ProjectorOptions<
  EventType,
  ReadEventMetadataWithGlobalPosition,
  SQLiteProcessorHandlerContext<Driver>,
  EventPayloadType
> &
  SQLiteProcessorOptionsBase<Driver>;

export type SQLiteWorkflowProcessorOptions<
  Input extends AnyEvent | AnyCommand,
  State,
  Output extends AnyEvent | AnyCommand,
  MetaDataType extends AnyRecordedMessageMetadata = AnyRecordedMessageMetadata,
  HandlerContext extends WorkflowProcessorContext = WorkflowProcessorContext,
  StoredMessage extends AnyEvent | AnyCommand = Output,
  Driver extends AnySQLiteEventStoreDriver = AnySQLiteEventStoreDriver,
> = WorkflowProcessorOptions<
  Input,
  State,
  Output,
  MetaDataType,
  HandlerContext,
  StoredMessage
> &
  SQLiteProcessorOptionsBase<Driver>;

const sqliteProcessingScope = <
  Driver extends AnySQLiteEventStoreDriver = AnySQLiteEventStoreDriver,
>(options: {
  pool: InferPoolFromEventStoreDriver<Driver> | null;
  connectionOptions: InferDumboOptionsFromEventStoreDriver<Driver> | null;
  processorId: string;
  partition: string;
  migrationOptions?: EventStoreSchemaMigrationOptions['migrationOptions'];
  driver?: Driver;
}): MessageProcessingScope<SQLiteProcessorHandlerContext<Driver>> => {
  const processorConnectionOptions = options.connectionOptions;

  const processorPool = options.pool;

  const processingScope: MessageProcessingScope<
    SQLiteProcessorHandlerContext<Driver>
  > = async <Result = SingleMessageHandlerResult>(
    handler: (
      context: SQLiteProcessorHandlerContext<Driver>,
    ) => Result | Promise<Result>,
    partialContext: PartialHandlerContext<
      SQLiteProcessorHandlerContext<Driver>
    >,
  ) => {
    const session = partialContext?.session;

    const { pool, connectionOptions } = processorPool
      ? {
          pool: processorPool,
          connectionOptions: processorConnectionOptions ?? undefined,
        }
      : { pool: session?.pool, connectionOptions: session?.connectionOptions };

    if (!pool)
      throw new EmmettError(
        `SQLite processor '${options.processorId}' is missing a connection pool. Ensure that you passed connection options through options`,
      );

    const driver = eventStoreDriverOf<Driver>(
      options.driver ?? partialContext?.driver,
    );

    return pool.withTransaction(async (transaction: AnyDatabaseTransaction) => {
      const sqliteTransaction =
        transaction as InferTransactionFromEventStoreDriver<Driver>;
      const connection =
        transaction.connection as InferDumboConnectionFromEventStoreDriver<Driver>;

      return handler({
        ...partialContext,
        partition: options.partition,
        execute: sqliteTransaction.execute,
        driver,
        driverType: connection.driverType,
        session: {
          ...partialContext?.session,
          pool,
          connectionOptions,
          connection,
          transaction: sqliteTransaction,
          messageStore: getSQLiteEventStore({
            driver,
            pool: sqliteAmbientConnectionPool({
              driverType: connection.driverType,
              connection,
            }),
            schema: {
              autoMigration: 'None',
              ...options.migrationOptions,
            },
          }),
        },
        migrationOptions: options.migrationOptions,
        observabilityScope: partialContext?.observabilityScope ?? noopScope,
      });
    });
  };

  return processingScope;
};

const getProcessorPool = <
  Driver extends AnySQLiteEventStoreDriver = AnySQLiteEventStoreDriver,
>(
  options: SQLiteConnectionOptions<Driver>,
) => {
  const poolOptions = options.connectionOptions;

  if (!poolOptions) return { pool: null, connectionOptions: null };

  if (poolOptions.pool)
    return { pool: poolOptions.pool, connectionOptions: null };

  if (poolOptions.connection)
    return {
      pool: sqliteAmbientConnectionPool({
        driverType: poolOptions.connection.driverType,
        connection: poolOptions.connection,
      }) as InferPoolFromEventStoreDriver<Driver>,
      connectionOptions: null,
    };

  const driver = eventStoreDriverOf<Driver>(options.driver);

  const connectionOptions = {
    serialization: options.serialization,
    ...driver.mapToDumboOptions(poolOptions),
  } as InferDumboOptionsFromEventStoreDriver<Driver>;

  return {
    pool: dumbo(connectionOptions) as InferPoolFromEventStoreDriver<Driver>,
    connectionOptions,
  };
};

export const sqliteWorkflowProcessor = <
  Input extends AnyEvent | AnyCommand,
  State,
  Output extends AnyEvent | AnyCommand,
  MetaDataType extends AnyRecordedMessageMetadata = AnyRecordedMessageMetadata,
  HandlerContext extends SQLiteProcessorHandlerContext &
    WorkflowProcessorContext = SQLiteProcessorHandlerContext &
    WorkflowProcessorContext,
  StoredMessage extends AnyEvent | AnyCommand = Output,
>(
  options: SQLiteWorkflowProcessorOptions<
    Input,
    State,
    Output,
    MetaDataType,
    HandlerContext,
    StoredMessage
  >,
): SQLiteProcessor<Input | Output> => {
  const {
    processorId = options.processorId ??
      getWorkflowId({
        workflowName: options.workflow.name ?? 'unknown',
      }),
    processorInstanceId = getProcessorInstanceId(processorId),
    version = defaultProcessorVersion,
    partition = defaultProcessorPartition,
  } = options;

  const hooks: ProcessorHooks<HandlerContext> = {
    ...(options.hooks ?? {}),
    onClose: options.hooks?.onClose,
  };

  return workflowProcessor({
    ...options,
    processorId,
    processorInstanceId,
    version,
    partition,
    hooks,
    processingScope: sqliteProcessingScope({
      ...getProcessorPool(options),
      processorId,
      partition,
      migrationOptions: options.migrationOptions,
      driver: options.driver,
    }) as unknown as MessageProcessingScope<HandlerContext>,
    checkpoints:
      options.checkpoints === 'DISABLED'
        ? inMemoryCheckpointer<Input | Output, MetaDataType, HandlerContext>()
        : (sqliteCheckpointer<Input | Output>() as Checkpointer<
            Input | Output,
            MetaDataType,
            HandlerContext
          >),
  }) as SQLiteProcessor<Input | Output>;
};

export const sqliteReactor = <
  MessageType extends Message = Message,
  MessagePayloadType extends AnyMessage = MessageType,
  Driver extends AnySQLiteEventStoreDriver = AnySQLiteEventStoreDriver,
>(
  options: SQLiteReactorOptions<MessageType, MessagePayloadType, Driver>,
): SQLiteProcessor<MessageType, Driver> => {
  const {
    processorId = options.processorId,
    processorInstanceId = getProcessorInstanceId(processorId),
    version = defaultProcessorVersion,
    partition = defaultProcessorPartition,
    hooks,
  } = options;

  return reactor({
    ...options,
    processorId,
    processorInstanceId,
    version,
    partition,
    hooks,
    processingScope: sqliteProcessingScope<Driver>({
      ...getProcessorPool<Driver>(options),
      processorId,
      partition,
      migrationOptions: options.migrationOptions,
      driver: options.driver,
    }),

    checkpoints:
      options.checkpoints === 'DISABLED'
        ? inMemoryCheckpointer<MessageType>()
        : sqliteCheckpointer<MessageType, Driver>(),
  });
};

export const sqliteProjector = <
  EventType extends Event = Event,
  EventPayloadType extends Event = EventType,
  Driver extends AnySQLiteEventStoreDriver = AnySQLiteEventStoreDriver,
>(
  options: SQLiteProjectorOptions<EventType, EventPayloadType, Driver>,
): SQLiteProcessor<EventType, Driver> => {
  const {
    processorId = getProjectorId({
      projectionName: options.projection.name ?? 'unknown',
    }),
    processorInstanceId = getProcessorInstanceId(processorId),
    version = defaultProcessorVersion,
    partition = defaultProcessorPartition,
  } = options;

  const hooks: ProcessorHooks<SQLiteProcessorHandlerContext<Driver>> = {
    ...(options.hooks ?? {}),
    onInit:
      options.projection.init !== undefined || options.hooks?.onInit
        ? async (context: SQLiteProcessorHandlerContext<Driver>) => {
            if (options.projection.init)
              await options.projection.init({
                version: options.projection.version ?? version,
                status: 'active',
                registrationType: 'async',
                context: {
                  ...context,
                  migrationOptions: options.migrationOptions,
                },
              });
            if (options.hooks?.onInit)
              await options.hooks.onInit({
                ...context,
                migrationOptions: options.migrationOptions,
              });
          }
        : options.hooks?.onInit,
    onClose: options.hooks?.onClose,
  };

  const processor = projector<
    EventType,
    ReadEventMetadataWithGlobalPosition,
    SQLiteProcessorHandlerContext<Driver>,
    EventPayloadType
  >({
    ...options,
    processorId,
    processorInstanceId,
    version,
    partition,
    hooks,
    processingScope: sqliteProcessingScope<Driver>({
      ...getProcessorPool<Driver>(options),
      processorId,
      partition,
      migrationOptions: options.migrationOptions,
      driver: options.driver,
    }),
    checkpoints:
      options.checkpoints === 'DISABLED'
        ? inMemoryCheckpointer<EventType>()
        : sqliteCheckpointer<EventType, Driver>(),
  });

  return processor;
};
