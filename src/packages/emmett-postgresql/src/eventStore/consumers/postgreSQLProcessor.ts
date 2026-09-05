import {
  dumbo,
  type DatabaseDriverType,
  type SQLExecutor,
} from '@event-driven-io/dumbo';
import type {
  PgClientConnection,
  PgDriverType,
  PgPool,
  PgPoolClientConnection,
} from '@event-driven-io/dumbo/pg';
import type {
  AnyCommand,
  AnyEvent,
  AnyMessage,
  AnyRecordedMessageMetadata,
  BatchRecordedMessageHandlerWithContext,
  Checkpointer,
  CurrentMessageProcessorPosition,
  Event,
  JSONSerializationOptions,
  Message,
  MessageHandlerContext,
  MessageProcessingScope,
  MessageProcessor,
  ProcessorHooks,
  ProcessorLock,
  ProcessorLockOptions,
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
  getCheckpoint,
  getProcessorInstanceId,
  getProjectorId,
  getWorkflowId,
  inMemoryCheckpointer,
  noopScope,
  projector,
  reactor,
  unknownTag,
  workflowProcessor,
} from '@event-driven-io/emmett';
import type pg from 'pg';
import {
  getPostgreSQLEventStore,
  type PostgresEventStore,
} from '../postgreSQLEventStore';
import {
  DefaultPostgreSQLProcessorLockPolicy,
  postgreSQLProcessorLock,
  type LockAcquisitionPolicy,
  type PostgreSQLProcessorLock,
} from '../projections';
import {
  readProcessorCheckpoint,
  storeProcessorCheckpoint,
  type EventStoreSchemaMigrationOptions,
} from '../schema';
import { pgEventStoreDriver, type PgEventStoreDriver } from '../../pg';
import type {
  AnyEventStoreDriver,
  InferDbClientFromEventStoreDriver,
  InferDumboOptionsFromEventStoreDriver,
  InferPoolFromEventStoreDriver,
  InferTransactionFromEventStoreDriver,
} from '../eventStoreDriver';

export type PostgreSQLProcessorHandlerContext<
  Driver extends AnyEventStoreDriver = PgEventStoreDriver,
> = MessageHandlerContext<
  {
    partition: string;
    execute: SQLExecutor;
    driverType: DatabaseDriverType;
    connection: {
      client: InferDbClientFromEventStoreDriver<Driver>;
      transaction: InferTransactionFromEventStoreDriver<Driver>;
      pool: InferPoolFromEventStoreDriver<Driver>;
      messageStore: PostgresEventStore;
      options: InferDumboOptionsFromEventStoreDriver<Driver>;
    };
  } &
    // TODO: Reconsider if it should be for all processors
    EventStoreSchemaMigrationOptions
>;

export type PostgreSQLProcessor<
  MessageType extends Message = AnyMessage,
  Driver extends AnyEventStoreDriver = PgEventStoreDriver,
> = MessageProcessor<
  MessageType,
  ReadEventMetadataWithGlobalPosition,
  PostgreSQLProcessorHandlerContext<Driver>
>;

export type PostgreSQLProcessorEachMessageHandler<
  MessageType extends Message = Message,
  Driver extends AnyEventStoreDriver = PgEventStoreDriver,
> = SingleRecordedMessageHandlerWithContext<
  MessageType,
  ReadEventMetadataWithGlobalPosition,
  PostgreSQLProcessorHandlerContext<Driver>
>;

export type PostgreSQLProcessorEachBatchHandler<
  MessageType extends Message = Message,
  Driver extends AnyEventStoreDriver = PgEventStoreDriver,
> = BatchRecordedMessageHandlerWithContext<
  MessageType,
  ReadEventMetadataWithGlobalPosition,
  PostgreSQLProcessorHandlerContext<Driver>
>;

export type PostgreSQLProcessorStartFrom =
  CurrentMessageProcessorPosition | 'CURRENT';

type PostgreSQLProcessorPooledOptions =
  | {
      connector?: PgDriverType;
      database?: string;
      pooled: true;
      pool: pg.Pool;
    }
  | {
      connector?: PgDriverType;
      database?: string;
      pool: pg.Pool;
    }
  | {
      connector?: PgDriverType;
      database?: string;
      pooled: true;
    }
  | {
      connector?: PgDriverType;
      database?: string;
    };

type PostgreSQLProcessorNotPooledOptions =
  | {
      connector?: PgDriverType;
      database?: string;
      pooled: false;
      client: pg.Client;
    }
  | {
      connector?: PgDriverType;
      database?: string;
      client: pg.Client;
    }
  | {
      connector?: PgDriverType;
      database?: string;
      pooled: false;
    }
  | {
      connector?: PgDriverType;
      database?: string;
      connection: PgPoolClientConnection | PgClientConnection;
      pooled?: false;
    }
  | {
      connector?: PgDriverType;
      database?: string;
      dumbo: PgPool;
      pooled?: false;
    };

export type PostgreSQLProcessorConnectionOptions = {
  connectionString: string;
} & (PostgreSQLProcessorPooledOptions | PostgreSQLProcessorNotPooledOptions);

export type PostgreSQLCheckpointer<
  MessageType extends AnyMessage = AnyMessage,
  Driver extends AnyEventStoreDriver = PgEventStoreDriver,
> = Checkpointer<
  MessageType,
  ReadEventMetadataWithGlobalPosition,
  PostgreSQLProcessorHandlerContext<Driver>
>;

export const postgreSQLCheckpointer = <
  MessageType extends Message = Message,
  Driver extends AnyEventStoreDriver = PgEventStoreDriver,
>(): PostgreSQLCheckpointer<MessageType, Driver> => ({
  read: async (options, context) => {
    const result = await readProcessorCheckpoint(context.execute, {
      ...options,
      databaseSchemaName: context.migrationOptions?.databaseSchemaName,
    });

    return { lastCheckpoint: result?.lastProcessedCheckpoint };
  },
  store: async (options, context) => {
    const newCheckpoint = getCheckpoint(options.message);

    const result = await storeProcessorCheckpoint(context.execute, {
      lastProcessedCheckpoint: options.lastCheckpoint,
      newCheckpoint,
      processorId: options.processorId,
      partition: options.partition,
      version: options.version,
      databaseSchemaName: context.migrationOptions?.databaseSchemaName,
    });

    return result.success
      ? { success: true, newCheckpoint: result.newCheckpoint }
      : result;
  },
});

type PostgreSQLConnectionOptions<
  Driver extends AnyEventStoreDriver = PgEventStoreDriver,
> = {
  connectionOptions?: PostgreSQLProcessorConnectionOptions;
  driver?: Driver;
} & JSONSerializationOptions;

type PostgreSQLProcessorOptionsBase<
  Driver extends AnyEventStoreDriver = PgEventStoreDriver,
> = PostgreSQLConnectionOptions<Driver> & {
  lock?: {
    /** Defaults to the PostgreSQL processor lock backed by the message store */
    lock?: ProcessorLock<PostgreSQLProcessorHandlerContext<Driver>>;
    acquisitionPolicy?: LockAcquisitionPolicy;
    timeoutSeconds?: number;
  };
  partition?: string;
} & EventStoreSchemaMigrationOptions;
export type PostgreSQLReactorOptions<
  MessageType extends Message = Message,
  MessagePayloadType extends AnyMessage = MessageType,
  Driver extends AnyEventStoreDriver = PgEventStoreDriver,
> = ReactorOptions<
  MessageType,
  ReadEventMetadataWithGlobalPosition,
  PostgreSQLProcessorHandlerContext<Driver>,
  MessagePayloadType
> &
  PostgreSQLProcessorOptionsBase<Driver>;

export type PostgreSQLProjectorOptions<
  EventType extends AnyEvent = AnyEvent,
  EventPayloadType extends Event = EventType,
  Driver extends AnyEventStoreDriver = PgEventStoreDriver,
> = ProjectorOptions<
  EventType,
  ReadEventMetadataWithGlobalPosition,
  PostgreSQLProcessorHandlerContext<Driver>,
  EventPayloadType
> &
  PostgreSQLProcessorOptionsBase<Driver> &
  EventStoreSchemaMigrationOptions;

export type PostgreSQLWorkflowProcessorOptions<
  Input extends AnyEvent | AnyCommand,
  State,
  Output extends AnyEvent | AnyCommand,
  MetaDataType extends AnyRecordedMessageMetadata = AnyRecordedMessageMetadata,
  HandlerContext extends WorkflowProcessorContext = WorkflowProcessorContext,
  StoredMessage extends AnyEvent | AnyCommand = Output,
  Driver extends AnyEventStoreDriver = PgEventStoreDriver,
> = WorkflowProcessorOptions<
  Input,
  State,
  Output,
  MetaDataType,
  HandlerContext,
  StoredMessage
> &
  PostgreSQLProcessorOptionsBase<Driver>;

const postgreSQLProcessingScope = <
  Driver extends AnyEventStoreDriver = PgEventStoreDriver,
>(options: {
  pool: PgPool | null;
  connectionString: string | null;
  driver?: Driver;
  processorId: string;
  partition: string;
  migrationOptions?: EventStoreSchemaMigrationOptions['migrationOptions'];
}): MessageProcessingScope<PostgreSQLProcessorHandlerContext<Driver>> => {
  const processorConnectionString = options.connectionString;

  const processorPool = options.pool;

  const processingScope: MessageProcessingScope<
    PostgreSQLProcessorHandlerContext<Driver>
  > = async <Result = SingleMessageHandlerResult>(
    handler: (
      context: PostgreSQLProcessorHandlerContext<Driver>,
    ) => Result | Promise<Result>,
    partialContext: Partial<PostgreSQLProcessorHandlerContext<Driver>>,
  ) => {
    const connection = partialContext?.connection;
    /**
     * `getProcessorPool` is still pg specific, so the connection string it
     * carries is read back out of the driver's own pool options.
     */
    const connectionString: string | null | undefined =
      processorConnectionString ??
      (connection?.options as { connectionString?: string } | undefined)
        ?.connectionString;

    const pool: PgPool | null =
      ((!processorConnectionString ||
      connectionString == processorConnectionString
        ? connection?.pool
        : processorPool) as PgPool | null) ?? processorPool;

    if (!pool)
      throw new EmmettError(
        `PostgreSQL processor '${options.processorId}' is missing a connection pool. Ensure that you passed connection options through options`,
      );

    return pool.withTransaction(async (transaction) => {
      const client = await transaction.connection.open();
      /**
       * The context type follows the driver, while `getProcessorPool` still
       * builds a pg pool. The two only meet through this cast until the pool
       * plumbing is driver-generic too.
       */
      return handler({
        ...partialContext,
        partition: options.partition,
        execute: transaction.execute,
        driverType: pool.driverType,
        connection: {
          connectionString,
          pool,
          client,
          transaction: transaction,
          messageStore: getPostgreSQLEventStore({
            driver: options.driver ?? pgEventStoreDriver,
            connectionOptions: {
              connection: transaction.connection as PgPoolClientConnection,
            },
            schema: {
              autoMigration: 'None',
              ...options.migrationOptions,
            },
          }),
        },
        migrationOptions: options.migrationOptions,
        observabilityScope: partialContext?.observabilityScope ?? noopScope,
      } as unknown as PostgreSQLProcessorHandlerContext<Driver>);
    });
  };

  return processingScope;
};

const getProcessorPool = <
  Driver extends AnyEventStoreDriver = PgEventStoreDriver,
>(
  options: PostgreSQLConnectionOptions<Driver>,
) => {
  const poolOptions = {
    ...(options.connectionOptions ? options.connectionOptions : {}),
  };
  const processorConnectionString =
    'connectionString' in poolOptions
      ? (poolOptions.connectionString ?? null)
      : null;

  const processorPool =
    'dumbo' in poolOptions
      ? (poolOptions.dumbo as PgPool)
      : processorConnectionString
        ? (dumbo({
            ...poolOptions,
            serialization: options.serialization,
            transactionOptions: {
              allowNestedTransactions: true,
            },
            ...(options.driver ?? pgEventStoreDriver).mapToDumboOptions({
              connectionString: processorConnectionString,
            }),
          }) as PgPool)
        : null;

  return {
    pool: processorPool,
    connectionString: processorConnectionString,
    close:
      processorPool != null && !('dumbo' in poolOptions)
        ? processorPool.close
        : undefined,
  };
};

const toProcessorLockOptions = <
  Driver extends AnyEventStoreDriver = PgEventStoreDriver,
>(
  processorLock: PostgreSQLProcessorLock,
  lock: PostgreSQLProcessorOptionsBase<Driver>['lock'],
): ProcessorLockOptions<PostgreSQLProcessorHandlerContext<Driver>> => ({
  lock: lock?.lock ?? processorLock,
  acquisitionPolicy:
    lock?.acquisitionPolicy ?? DefaultPostgreSQLProcessorLockPolicy,
});

export const postgreSQLProjector = <
  EventType extends Event = Event,
  EventPayloadType extends Event = EventType,
  Driver extends AnyEventStoreDriver = PgEventStoreDriver,
>(
  options: PostgreSQLProjectorOptions<EventType, EventPayloadType, Driver>,
): PostgreSQLProcessor<EventType, Driver> => {
  const {
    processorId = getProjectorId({
      projectionName: options.projection.name ?? 'unknown',
    }),
    processorInstanceId = getProcessorInstanceId(processorId),
    version = defaultProcessorVersion,
    partition = defaultProcessorPartition,
    lock,
  } = options;

  const { pool, connectionString, close } = getProcessorPool(options);

  const processorLock = postgreSQLProcessorLock({
    databaseSchemaName: options.migrationOptions?.databaseSchemaName,
    processorId,
    version,
    partition,
    processorInstanceId,
    projection: options.projection
      ? {
          name: options.projection.name ?? unknownTag,
          kind: options.projection.kind ?? unknownTag,
          version: options.projection.version ?? version,
          handlingType: 'async' as const,
        }
      : undefined,
    lockTimeoutSeconds: lock?.timeoutSeconds,
  });

  const hooks: ProcessorHooks<PostgreSQLProcessorHandlerContext<Driver>> = {
    ...(options.hooks ?? {}),
    onInit:
      options.projection.init !== undefined || options.hooks?.onInit
        ? async (context) => {
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
    onClose: close
      ? async (context) => {
          if (options.hooks?.onClose) await options.hooks?.onClose(context);
          if (close) await close();
        }
      : options.hooks?.onClose,
  };

  const processor = projector<
    EventType,
    ReadEventMetadataWithGlobalPosition,
    PostgreSQLProcessorHandlerContext<Driver>,
    EventPayloadType
  >({
    ...options,
    processorId,
    processorInstanceId,
    version,
    partition,
    hooks,
    lock: toProcessorLockOptions(processorLock, lock),
    processingScope: postgreSQLProcessingScope<Driver>({
      pool,
      connectionString,
      driver: options.driver,
      processorId,
      partition,
      migrationOptions: options.migrationOptions,
    }),
    checkpoints:
      options.checkpoints === 'DISABLED'
        ? inMemoryCheckpointer<EventType>()
        : postgreSQLCheckpointer<EventType, Driver>(),
  });

  return processor;
};

export const postgreSQLWorkflowProcessor = <
  Input extends AnyEvent | AnyCommand,
  State,
  Output extends AnyEvent | AnyCommand,
  MetaDataType extends AnyRecordedMessageMetadata = AnyRecordedMessageMetadata,
  Driver extends AnyEventStoreDriver = PgEventStoreDriver,
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
): PostgreSQLProcessor<Input | Output, Driver> => {
  const {
    processorId = options.processorId ??
      getWorkflowId({
        workflowName: options.workflow.name ?? 'unknown',
      }),
    processorInstanceId = getProcessorInstanceId(processorId),
    version = defaultProcessorVersion,
    partition = defaultProcessorPartition,
    lock,
  } = options;

  const { pool, connectionString, close } = getProcessorPool(options);

  const processorLock = postgreSQLProcessorLock({
    databaseSchemaName: options.migrationOptions?.databaseSchemaName,
    processorId,
    version,
    partition,
    processorInstanceId,
    projection: undefined,
    lockTimeoutSeconds: lock?.timeoutSeconds,
  });

  const hooks: ProcessorHooks<HandlerContext> = {
    ...(options.hooks ?? {}),
    onClose: close
      ? async (
          context: PostgreSQLProcessorHandlerContext<AnyEventStoreDriver>,
        ) => {
          if (options.hooks?.onClose)
            await options.hooks?.onClose(context as HandlerContext);
          if (close) await close();
        }
      : options.hooks?.onClose,
  };

  return workflowProcessor({
    ...options,
    processorId,
    processorInstanceId,
    version,
    partition,
    hooks,
    lock: toProcessorLockOptions(processorLock, lock),
    processingScope: postgreSQLProcessingScope<Driver>({
      pool,
      connectionString,
      driver: options.driver,
      processorId,
      partition,
      migrationOptions: options.migrationOptions,
    }) as unknown as MessageProcessingScope<HandlerContext>,
    checkpoints:
      options.checkpoints === 'DISABLED'
        ? inMemoryCheckpointer<Input | Output, MetaDataType, HandlerContext>()
        : (postgreSQLCheckpointer<Input | Output>() as unknown as Checkpointer<
            Input | Output,
            MetaDataType,
            HandlerContext
          >),
  }) as PostgreSQLProcessor<Input | Output, Driver>;
};

export const postgreSQLReactor = <
  MessageType extends AnyMessage = AnyMessage,
  MessagePayloadType extends AnyMessage = MessageType,
  Driver extends AnyEventStoreDriver = PgEventStoreDriver,
>(
  options: PostgreSQLReactorOptions<MessageType, MessagePayloadType, Driver>,
): PostgreSQLProcessor<MessageType, Driver> => {
  const {
    processorId = options.processorId,
    processorInstanceId = getProcessorInstanceId(processorId),
    version = defaultProcessorVersion,
    partition = defaultProcessorPartition,
    lock,
  } = options;

  const { pool, connectionString, close } = getProcessorPool(options);

  const processorLock = postgreSQLProcessorLock({
    databaseSchemaName: options.migrationOptions?.databaseSchemaName,
    processorId,
    version,
    partition,
    processorInstanceId,
    projection: undefined,
    lockTimeoutSeconds: lock?.timeoutSeconds,
  });

  const hooks: ProcessorHooks<PostgreSQLProcessorHandlerContext<Driver>> = {
    ...(options.hooks ?? {}),
    onClose: close
      ? async (context) => {
          if (options.hooks?.onClose) await options.hooks?.onClose(context);
          if (close) await close();
        }
      : options.hooks?.onClose,
  };

  return reactor({
    ...options,
    processorId,
    processorInstanceId,
    version,
    partition,
    hooks,
    lock: toProcessorLockOptions(processorLock, lock),
    processingScope: postgreSQLProcessingScope<Driver>({
      pool,
      connectionString,
      driver: options.driver,
      processorId,
      partition,
      migrationOptions: options.migrationOptions,
    }),
    checkpoints:
      options.checkpoints === 'DISABLED'
        ? inMemoryCheckpointer<MessageType>()
        : postgreSQLCheckpointer<MessageType, Driver>(),
  });
};
