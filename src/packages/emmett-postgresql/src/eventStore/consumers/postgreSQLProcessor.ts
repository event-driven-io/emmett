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
  type AnyMessage,
  type Checkpointer,
  type CreateGenericMessageProcessorOptions,
  type Event,
  type Message,
  type MessageHandlerResult,
  type MessageProcessingScope,
  type ProjectionProcessorOptions,
  type ReadEvent,
  type ReadEventMetadataWithGlobalPosition,
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

export type PostgreSQLProcessor<MessageType extends Message = Message> =
  MessageProcessor<
    MessageType,
    ReadEventMetadataWithGlobalPosition,
    PostgreSQLProcessorHandlerContext
  >;

export const PostgreSQLProcessor = {
  result: {
    skip: (options?: {
      reason?: string;
    }): PostgreSQLProcessorMessageHandlerResult => ({
      type: 'SKIP',
      ...(options ?? {}),
    }),
    stop: (options?: {
      reason?: string;
      error?: EmmettError;
    }): PostgreSQLProcessorMessageHandlerResult => ({
      type: 'STOP',
      ...(options ?? {}),
    }),
  },
};

export type PostgreSQLProcessorMessageHandlerResult =
  | void
  | { type: 'SKIP'; reason?: string }
  | { type: 'STOP'; reason?: string; error?: EmmettError };

export type PostgreSQLProcessorEachMessageHandler<
  EventType extends Event = Event,
> = (
  event: ReadEvent<EventType, ReadEventMetadataWithGlobalPosition>,
  context: PostgreSQLProcessorHandlerContext,
) =>
  | Promise<PostgreSQLProcessorMessageHandlerResult>
  | PostgreSQLProcessorMessageHandlerResult;

export type PostgreSQLProcessorEachBatchHandler<
  EventType extends Event = Event,
> = (
  event: ReadEvent<EventType, ReadEventMetadataWithGlobalPosition>[],
  context: PostgreSQLProcessorHandlerContext,
) =>
  | Promise<PostgreSQLProcessorMessageHandlerResult>
  | PostgreSQLProcessorMessageHandlerResult;

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

export type PostgreSQLCheckpoint = bigint;

export type PostgreSQLCheckpointer<
  MessageType extends AnyMessage = AnyMessage,
> = Checkpointer<
  MessageType,
  ReadEventMetadataWithGlobalPosition,
  PostgreSQLProcessorHandlerContext,
  PostgreSQLCheckpoint
>;

export const PostgreSQLCheckpointer: PostgreSQLCheckpointer = {
  read: async (options, context) => {
    const result = await readProcessorCheckpoint(context.execute, options);

    return result?.lastProcessedPosition;
  },
  store: async (options, context) => {
    const result = await storeProcessorCheckpoint(context.execute, options);

    return result.success ? result.newPosition : null;
  },
};

type GenericPostgreSQLProcessorOptions<MessageType extends Message = Message> =
  CreateGenericMessageProcessorOptions<
    MessageType,
    ReadEventMetadataWithGlobalPosition,
    PostgreSQLProcessorHandlerContext,
    {
      connectionOptions?: PostgreSQLProcessorConnectionOptions;
    },
    PostgreSQLCheckpoint
  >;

export type PostgreSQLProjectionProcessorOptions<
  EventType extends Event = Event,
> = ProjectionProcessorOptions<
  EventType,
  ReadEventMetadataWithGlobalPosition,
  PostgreSQLProcessorHandlerContext,
  PostgreSQLCheckpoint
> & {
  connectionOptions?: PostgreSQLProcessorConnectionOptions;
};

export type PostgreSQLProcessorOptions<EventType extends Event = Event> =
  | GenericPostgreSQLProcessorOptions<EventType>
  | PostgreSQLProjectionProcessorOptions<EventType>;

const genericPostgreSQLProcessor = <EventType extends Event = Event>(
  options: GenericPostgreSQLProcessorOptions<EventType>,
): PostgreSQLProcessor => {
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
            client,
            connectionString,
            transaction,
            pool,
          },
        });
      });
    };

  return genericPostgreSQLProcessor({
    ...options,
    processingScope,
    checkpoints: {},
  });

  const getPool = (context: {
    pool?: Dumbo;
    connectionString?: string;
  }): { pool: Dumbo; connectionString: string } => {};

  return {
    id: options.processorId,
    start: async (
      execute: SQLExecutor,
    ): Promise<PostgreSQLEventStoreMessageBatchPullerStartFrom | undefined> => {
      isActive = true;
      if (options.startFrom !== 'CURRENT') return options.startFrom;

      const { lastProcessedPosition } = await readProcessorCheckpoint(execute, {
        processorId: options.processorId,
        partition: options.partition,
      });

      if (lastProcessedPosition === null) return 'BEGINNING';

      return { globalPosition: lastProcessedPosition };
    },
    get isActive() {
      return isActive;
    },
    handle: async (
      { messages },
      context,
    ): Promise<PostgreSQLProcessorMessageHandlerResult> => {
      if (!isActive) return;

      const { pool, connectionString } = getPool(context);

      return pool.withTransaction(async (transaction) => {
        let result: PostgreSQLProcessorMessageHandlerResult | undefined =
          undefined;

        let lastProcessedPosition: bigint | null = null;

        for (const message of messages) {
          const typedMessage = message as ReadEvent<
            EventType,
            ReadEventMetadataWithGlobalPosition
          >;

          const client =
            (await transaction.connection.open()) as NodePostgresClient;

          const messageProcessingResult = await eachMessage(typedMessage, {
            execute: transaction.execute,
            connection: {
              connectionString,
              pool,
              transaction: transaction,
              client,
            },
          });

          // TODO: Add correct handling of the storing checkpoint
          await storeProcessorCheckpoint(transaction.execute, {
            processorId: options.processorId,
            version: options.version,
            lastProcessedPosition,
            newPosition: typedMessage.metadata.globalPosition,
            partition: options.partition,
          });

          lastProcessedPosition = typedMessage.metadata.globalPosition;

          if (
            messageProcessingResult &&
            messageProcessingResult.type === 'STOP'
          ) {
            isActive = false;
            result = messageProcessingResult;
            break;
          }

          if (options.stopAfter && options.stopAfter(typedMessage)) {
            isActive = false;
            result = { type: 'STOP', reason: 'Stop condition reached' };
            break;
          }

          if (
            messageProcessingResult &&
            messageProcessingResult.type === 'SKIP'
          )
            continue;
        }

        return result;
      });
    },
  };
};

export const postgreSQLProjectionProcessor = <EventType extends Event = Event>(
  options: PostgreSQLProjectionProcessorOptions<EventType>,
): PostgreSQLProcessor => {
  const projection = options.projection;

  return genericPostgreSQLProcessor<EventType>({
    processorId: options.processorId ?? `projection:${projection.name}`,
    eachMessage: async (event, context) => {
      if (!projection.canHandle.includes(event.type)) return;

      await projection.handle([event], context);
    },
    ...options,
  });
};

export const postgreSQLProcessor = <MessageType extends Message = Message>(
  options: PostgreSQLProcessorOptions<MessageType>,
): PostgreSQLProcessor<MessageType> => {
  if ('projection' in options) {
    return postgreSQLProjectionProcessor(options);
  }

  return genericPostgreSQLProcessor(options);
};
