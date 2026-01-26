import {
  dumbo,
  type Dumbo,
  type NodePostgresClient,
  type NodePostgresClientConnection,
  type NodePostgresConnector,
  type NodePostgresPool,
  type NodePostgresPoolClientConnection,
  type NodePostgresTransaction,
  type SQLExecutor,
} from '@event-driven-io/dumbo';
import {
  defaultProcessorPartition,
  defaultProcessorVersion,
  EmmettError,
  getCheckpoint,
  getProcessorInstanceId,
  getProjectorId,
  MessageProcessor,
  projector,
  reactor,
  type AnyEvent,
  type AnyMessage,
  type BatchRecordedMessageHandlerWithContext,
  type Checkpointer,
  type Event,
  type Message,
  type MessageHandlerResult,
  type MessageProcessingScope,
  type ProcessorHooks,
  type ProjectorOptions,
  type ReactorOptions,
  type ReadEventMetadataWithGlobalPosition,
  type SingleRecordedMessageHandlerWithContext,
} from '@event-driven-io/emmett';
import pg from 'pg';
import {
  DefaultPostgreSQLProcessorLockPolicy,
  postgreSQLProcessorLock,
  type LockAcquisitionPolicy,
} from '../projections';
import { readProcessorCheckpoint, storeProcessorCheckpoint } from '../schema';
import type { PostgreSQLEventStoreMessageBatchPullerStartFrom } from './messageBatchProcessing';

export type PostgreSQLProcessorHandlerContext = {
  partition: string;
  execute: SQLExecutor;
  connection: {
    connectionString: string;
    client: NodePostgresClient;
    transaction: NodePostgresTransaction;
    pool: Dumbo;
  };
};

export type PostgreSQLProcessor<MessageType extends Message = AnyMessage> =
  MessageProcessor<
    MessageType,
    ReadEventMetadataWithGlobalPosition,
    PostgreSQLProcessorHandlerContext
  >;

export type PostgreSQLProcessorEachMessageHandler<
  MessageType extends Message = Message,
> = SingleRecordedMessageHandlerWithContext<
  MessageType,
  ReadEventMetadataWithGlobalPosition,
  PostgreSQLProcessorHandlerContext
>;

export type PostgreSQLProcessorEachBatchHandler<
  MessageType extends Message = Message,
> = BatchRecordedMessageHandlerWithContext<
  MessageType,
  ReadEventMetadataWithGlobalPosition,
  PostgreSQLProcessorHandlerContext
>;

export type PostgreSQLProcessorStartFrom =
  | PostgreSQLEventStoreMessageBatchPullerStartFrom
  | 'CURRENT';

type PostgreSQLProcessorPooledOptions =
  | {
      connector?: NodePostgresConnector;
      database?: string;
      pooled: true;
      pool: pg.Pool;
    }
  | {
      connector?: NodePostgresConnector;
      database?: string;
      pool: pg.Pool;
    }
  | {
      connector?: NodePostgresConnector;
      database?: string;
      pooled: true;
    }
  | {
      connector?: NodePostgresConnector;
      database?: string;
    };

type PostgreSQLProcessorNotPooledOptions =
  | {
      connector?: NodePostgresConnector;
      database?: string;
      pooled: false;
      client: pg.Client;
    }
  | {
      connector?: NodePostgresConnector;
      database?: string;
      client: pg.Client;
    }
  | {
      connector?: NodePostgresConnector;
      database?: string;
      pooled: false;
    }
  | {
      connector?: NodePostgresConnector;
      database?: string;
      connection:
        | NodePostgresPoolClientConnection
        | NodePostgresClientConnection;
      pooled?: false;
    }
  | {
      connector?: NodePostgresConnector;
      database?: string;
      dumbo: NodePostgresPool;
      pooled?: false;
    };

export type PostgreSQLProcessorConnectionOptions = {
  connectionString: string;
} & (PostgreSQLProcessorPooledOptions | PostgreSQLProcessorNotPooledOptions);

export type PostgreSQLCheckpointer<
  MessageType extends AnyMessage = AnyMessage,
> = Checkpointer<
  MessageType,
  ReadEventMetadataWithGlobalPosition,
  PostgreSQLProcessorHandlerContext
>;

export const postgreSQLCheckpointer = <
  MessageType extends Message = Message,
>(): PostgreSQLCheckpointer<MessageType> => ({
  read: async (options, context) => {
    const result = await readProcessorCheckpoint(context.execute, options);

    return { lastCheckpoint: result?.lastProcessedCheckpoint };
  },
  store: async (options, context) => {
    const newPosition: bigint | null = getCheckpoint(options.message);

    const result = await storeProcessorCheckpoint(context.execute, {
      lastProcessedCheckpoint: options.lastCheckpoint,
      newCheckpoint: newPosition,
      processorId: options.processorId,
      partition: options.partition,
      version: options.version,
    });

    return result.success
      ? { success: true, newCheckpoint: result.newCheckpoint }
      : result;
  },
});

type PostgreSQLConnectionOptions = {
  connectionOptions?: PostgreSQLProcessorConnectionOptions;
};

type PostgreSQLProcessorOptionsBase = PostgreSQLConnectionOptions & {
  lockPolicy?: LockAcquisitionPolicy;
  partition?: string;
};
export type PostgreSQLReactorOptions<MessageType extends Message = Message> =
  ReactorOptions<
    MessageType,
    ReadEventMetadataWithGlobalPosition,
    PostgreSQLProcessorHandlerContext
  > &
    PostgreSQLProcessorOptionsBase;

export type PostgreSQLProjectorOptions<EventType extends AnyEvent = AnyEvent> =
  ProjectorOptions<
    EventType,
    ReadEventMetadataWithGlobalPosition,
    PostgreSQLProcessorHandlerContext
  > &
    PostgreSQLProcessorOptionsBase;

export type PostgreSQLProcessorOptions<
  MessageType extends AnyMessage = AnyMessage,
> =
  | PostgreSQLReactorOptions<MessageType>
  | PostgreSQLProjectorOptions<MessageType & AnyEvent>;

const postgreSQLProcessingScope = (options: {
  pool: Dumbo | null;
  connectionString: string | null;
  processorId: string;
  partition: string;
}): MessageProcessingScope<PostgreSQLProcessorHandlerContext> => {
  const processorConnectionString = options.connectionString;

  const processorPool = options.pool;

  const processingScope: MessageProcessingScope<
    PostgreSQLProcessorHandlerContext
  > = async <Result = MessageHandlerResult>(
    handler: (
      context: PostgreSQLProcessorHandlerContext,
    ) => Result | Promise<Result>,
    partialContext: Partial<PostgreSQLProcessorHandlerContext>,
  ) => {
    const connection = partialContext?.connection;
    const connectionString =
      processorConnectionString ?? connection?.connectionString;

    if (!connectionString)
      throw new EmmettError(
        `PostgreSQL processor '${options.processorId}' is missing connection string. Ensure that you passed it through options`,
      );

    const pool =
      (!processorConnectionString ||
      connectionString == processorConnectionString
        ? connection?.pool
        : processorPool) ?? processorPool;

    if (!pool)
      throw new EmmettError(
        `PostgreSQL processor '${options.processorId}' is missing connection string. Ensure that you passed it through options`,
      );

    return pool.withTransaction(async (transaction) => {
      const client =
        (await transaction.connection.open()) as NodePostgresClient;
      return handler({
        ...partialContext,
        partition: options.partition,
        execute: transaction.execute,
        connection: {
          connectionString,
          pool,
          client,
          transaction,
        },
      });
    });
  };

  return processingScope;
};

const getProcessorPool = (options: PostgreSQLConnectionOptions) => {
  const poolOptions = {
    ...(options.connectionOptions ? options.connectionOptions : {}),
  };
  const processorConnectionString =
    'connectionString' in poolOptions
      ? (poolOptions.connectionString ?? null)
      : null;

  const processorPool =
    'dumbo' in poolOptions
      ? (poolOptions.dumbo as NodePostgresPool)
      : processorConnectionString
        ? dumbo({
            connectionString: processorConnectionString,
            ...poolOptions,
          })
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

const wrapHooksWithProcessorLocks = (
  hooks: ProcessorHooks<PostgreSQLProcessorHandlerContext> | undefined,
  processorLock: ReturnType<typeof postgreSQLProcessorLock>,
): ProcessorHooks<PostgreSQLProcessorHandlerContext> => ({
  ...(hooks ?? {}),
  onStart: async (context: PostgreSQLProcessorHandlerContext) => {
    await processorLock.tryAcquire({ execute: context.execute });

    if (hooks?.onStart) await hooks.onStart(context);
  },
  onClose:
    hooks?.onClose || processorLock
      ? async (context: PostgreSQLProcessorHandlerContext) => {
          await processorLock.release({ execute: context.execute });

          if (hooks?.onClose) await hooks.onClose(context);
        }
      : undefined,
});

export const postgreSQLProjector = <EventType extends Event = Event>(
  options: PostgreSQLProjectorOptions<EventType>,
): PostgreSQLProcessor<EventType> => {
  const {
    processorId = getProjectorId({
      projectionName: options.projection.name ?? 'unknown',
    }),
    processorInstanceId = getProcessorInstanceId(processorId),
    version = defaultProcessorVersion,
    partition = defaultProcessorPartition,
    lockPolicy = DefaultPostgreSQLProcessorLockPolicy,
  } = options;

  const { pool, connectionString, close } = getProcessorPool(options);

  const projectionInfo = options.projection.name
    ? {
        name: options.projection.name,
        type: 'a' as const,
        kind: options.projection.kind ?? 'postgresql',
        version: options.projection.version ?? version,
      }
    : undefined;

  const processorLock = postgreSQLProcessorLock({
    processorId,
    version,
    partition,
    processorInstanceId,
    projection: projectionInfo,
    lockPolicy,
  });

  const hooks: ProcessorHooks<PostgreSQLProcessorHandlerContext> =
    wrapHooksWithProcessorLocks(
      {
        ...(options.hooks ?? {}),
        onInit:
          options.projection.init !== undefined || options.hooks?.onInit
            ? async (context: PostgreSQLProcessorHandlerContext) => {
                if (options.projection.init)
                  await options.projection.init({
                    status: 'active',
                    registrationType: 'async',
                    context,
                  });
                if (options.hooks?.onInit) await options.hooks.onInit(context);
              }
            : options.hooks?.onInit,
        onClose: close
          ? async (context: PostgreSQLProcessorHandlerContext) => {
              if (options.hooks?.onClose) await options.hooks?.onClose(context);
              if (close) await close();
            }
          : options.hooks?.onClose,
      },
      processorLock,
    );

  const processor = projector<
    EventType,
    ReadEventMetadataWithGlobalPosition,
    PostgreSQLProcessorHandlerContext
  >({
    ...options,
    processorId,
    processorInstanceId,
    version,
    partition,
    hooks,
    processingScope: postgreSQLProcessingScope({
      pool,
      connectionString,
      processorId,
      partition,
    }),
    checkpoints: postgreSQLCheckpointer<EventType>(),
  });

  return processor;
};

export const postgreSQLReactor = <MessageType extends Message = Message>(
  options: PostgreSQLReactorOptions<MessageType>,
): PostgreSQLProcessor<MessageType> => {
  const {
    processorId = options.processorId,
    processorInstanceId = getProcessorInstanceId(processorId),
    version = defaultProcessorVersion,
    partition = defaultProcessorPartition,
    lockPolicy = DefaultPostgreSQLProcessorLockPolicy,
  } = options;

  const { pool, connectionString, close } = getProcessorPool(options);

  const processorLock = postgreSQLProcessorLock({
    processorId,
    version,
    partition,
    processorInstanceId,
    projection: undefined,
    lockPolicy,
  });

  const hooks: ProcessorHooks<PostgreSQLProcessorHandlerContext> =
    wrapHooksWithProcessorLocks(
      {
        ...(options.hooks ?? {}),
        onClose: close
          ? async (context: PostgreSQLProcessorHandlerContext) => {
              if (options.hooks?.onClose) await options.hooks?.onClose(context);
              if (close) await close();
            }
          : options.hooks?.onClose,
      },
      processorLock,
    );

  return reactor({
    ...options,
    processorId,
    processorInstanceId,
    version,
    partition,
    hooks,
    processingScope: postgreSQLProcessingScope({
      pool,
      connectionString,
      processorId,
      partition,
    }),
    checkpoints: postgreSQLCheckpointer<MessageType>(),
  });
};

export const postgreSQLMessageProcessor = <
  MessageType extends AnyMessage = AnyMessage,
>(
  options: PostgreSQLProcessorOptions<MessageType>,
): PostgreSQLProcessor<MessageType> => {
  if ('projection' in options) {
    return postgreSQLProjector(
      options as unknown as PostgreSQLProjectorOptions<Event>,
    ) as PostgreSQLProcessor<MessageType>;
  }

  return postgreSQLReactor(options);
};
