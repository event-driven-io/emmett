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
  MessageProcessor,
  projector,
  reactor,
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
import { readProcessorCheckpoint, storeProcessorCheckpoint } from '../schema';
import type { PostgreSQLEventStoreMessageBatchPullerStartFrom } from './messageBatchProcessing';

export type PostgreSQLProcessorHandlerContext = {
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

    return { lastCheckpoint: result?.lastProcessedPosition };
  },
  store: async (options, context) => {
    const result = await storeProcessorCheckpoint(context.execute, {
      lastProcessedPosition: options.lastCheckpoint,
      newPosition: options.message.metadata.globalPosition,
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

type PostgreSQLReactorOptions<MessageType extends Message = Message> =
  ReactorOptions<
    MessageType,
    ReadEventMetadataWithGlobalPosition,
    PostgreSQLProcessorHandlerContext
  > &
    PostgreSQLConnectionOptions;

export type PostgreSQLProjectorOptions<EventType extends Event = Event> =
  ProjectorOptions<
    EventType,
    ReadEventMetadataWithGlobalPosition,
    PostgreSQLProcessorHandlerContext
  > &
    PostgreSQLConnectionOptions;

export type PostgreSQLProcessorOptions<MessageType extends Message = Message> =
  | PostgreSQLReactorOptions<MessageType>
  // @ts-expect-error I don't know how to fix it for  now
  | PostgreSQLProjectorOptions<MessageType>;

const postgreSQLProcessingScope = <MessageType extends Message = Message>(
  options: PostgreSQLProcessorOptions<MessageType>,
): MessageProcessingScope<PostgreSQLProcessorHandlerContext> => {
  const poolOptions = {
    ...(options.connectionOptions ? options.connectionOptions : {}),
  };
  const processorConnectionString =
    'connectionString' in poolOptions ? poolOptions.connectionString : null;

  const processorPool =
    'dumbo' in poolOptions
      ? (poolOptions.dumbo as NodePostgresPool)
      : processorConnectionString
        ? dumbo({
            connectionString: processorConnectionString,
            ...poolOptions,
          })
        : null;

  const processingScope: MessageProcessingScope<
    PostgreSQLProcessorHandlerContext
  > =
    (partialContext) =>
    async (
      handler: (
        context: PostgreSQLProcessorHandlerContext,
      ) => MessageHandlerResult | Promise<MessageHandlerResult>,
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

export const postgreSQLProjector = <EventType extends Event = Event>(
  options: PostgreSQLProjectorOptions<EventType>,
): PostgreSQLProcessor<EventType> =>
  projector<
    EventType,
    ReadEventMetadataWithGlobalPosition,
    PostgreSQLProcessorHandlerContext
  >({
    ...options,
    processingScope: postgreSQLProcessingScope(options),
    checkpoints: postgreSQLCheckpointer<EventType>(),
  });

export const postgreSQLReactor = <MessageType extends Message = Message>(
  options: PostgreSQLReactorOptions<MessageType>,
): PostgreSQLProcessor<MessageType> =>
  reactor({
    ...options,
    processingScope: postgreSQLProcessingScope(options),
    checkpoints: postgreSQLCheckpointer<MessageType>(),
  });

export const postgreSQLMessageProcessor = <
  MessageType extends Message = Message,
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
