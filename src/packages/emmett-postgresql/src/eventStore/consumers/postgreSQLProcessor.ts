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
  EmmettError,
  getCheckpoint,
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
  type ProjectorOptions,
  type ReactorOptions,
  type ReadEventMetadataWithGlobalPosition,
  type SingleRecordedMessageHandlerWithContext,
} from '@event-driven-io/emmett';
import pg from 'pg';
import {
  getPostgreSQLEventStore,
  type PostgresEventStore,
} from '../postgreSQLEventStore';
import { readProcessorCheckpoint, storeProcessorCheckpoint } from '../schema';
import type { PostgreSQLEventStoreMessageBatchPullerStartFrom } from './messageBatchProcessing';

export type PostgreSQLProcessorHandlerContext = {
  execute: SQLExecutor;
  connection: {
    connectionString: string;
    client: NodePostgresClient;
    transaction: NodePostgresTransaction;
    pool: Dumbo;
    eventStore: PostgresEventStore;
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

    return { lastCheckpoint: result?.lastProcessedPosition };
  },
  store: async (options, context) => {
    const newPosition: bigint | null = getCheckpoint(options.message);

    const result = await storeProcessorCheckpoint(context.execute, {
      lastProcessedPosition: options.lastCheckpoint,
      newPosition,
      processorId: options.processorId,
      partition: options.partition,
      version: options.version,
    });

    return result.success
      ? { success: true, newCheckpoint: result.newPosition }
      : result;
  },
});

type PostgreSQLConnectionOptions = {
  connectionOptions?: PostgreSQLProcessorConnectionOptions;
};

export type PostgreSQLReactorOptions<MessageType extends Message = Message> =
  ReactorOptions<
    MessageType,
    ReadEventMetadataWithGlobalPosition,
    PostgreSQLProcessorHandlerContext
  > &
    PostgreSQLConnectionOptions;

export type PostgreSQLProjectorOptions<EventType extends AnyEvent = AnyEvent> =
  ProjectorOptions<
    EventType,
    ReadEventMetadataWithGlobalPosition,
    PostgreSQLProcessorHandlerContext
  > &
    PostgreSQLConnectionOptions;

export type PostgreSQLProcessorOptions<
  MessageType extends AnyMessage = AnyMessage,
> =
  | PostgreSQLReactorOptions<MessageType>
  | PostgreSQLProjectorOptions<MessageType & AnyEvent>;

const postgreSQLProcessingScope = (options: {
  pool: Dumbo | null;
  connectionString: string | null;
  processorId: string;
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
        execute: transaction.execute,
        connection: {
          connectionString,
          pool,
          client,
          transaction,
          eventStore: getPostgreSQLEventStore(connectionString, {
            connectionOptions: { client },
            schema: { autoMigration: 'None' },
          }),
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

export const postgreSQLProjector = <EventType extends Event = Event>(
  options: PostgreSQLProjectorOptions<EventType>,
): PostgreSQLProcessor<EventType> => {
  const { pool, connectionString, close } = getProcessorPool(options);

  const hooks = {
    onStart: options.hooks?.onStart,
    onClose:
      options.hooks?.onClose || close
        ? async () => {
            if (options.hooks?.onClose) await options.hooks?.onClose();
            if (close) await close();
          }
        : undefined,
  };

  return projector<
    EventType,
    ReadEventMetadataWithGlobalPosition,
    PostgreSQLProcessorHandlerContext
  >({
    ...options,
    hooks,
    processingScope: postgreSQLProcessingScope({
      pool,
      connectionString,
      processorId:
        options.processorId ?? `projection:${options.projection.name}`,
    }),
    checkpoints: postgreSQLCheckpointer<EventType>(),
  });
};

export const postgreSQLReactor = <MessageType extends Message = Message>(
  options: PostgreSQLReactorOptions<MessageType>,
): PostgreSQLProcessor<MessageType> => {
  const { pool, connectionString, close } = getProcessorPool(options);

  const hooks = {
    onStart: options.hooks?.onStart,
    onClose:
      options.hooks?.onClose || close
        ? async () => {
            if (options.hooks?.onClose) await options.hooks?.onClose();
            if (close) await close();
          }
        : undefined,
  };

  return reactor({
    ...options,
    hooks,
    processingScope: postgreSQLProcessingScope({
      pool,
      connectionString,
      processorId: options.processorId,
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
