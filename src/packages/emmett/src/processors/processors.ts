import {
  dumbo,
  type Dumbo,
  type NodePostgresClient,
  type NodePostgresClientConnection,
  type NodePostgresConnector,
  type NodePostgresPool,
  type NodePostgresPoolClientConnection,
  type SQLExecutor,
} from '@event-driven-io/dumbo';
import type { EmmettError } from '../errors';
import type { PostgreSQLProjectionDefinition } from '../projections';
import { readProcessorCheckpoint, storeProcessorCheckpoint } from '../schema';
import type {
  AnyEvent,
  AnyReadEventMetadata,
  MessageBatchHandlingResult,
  MessagesBatch,
  ReadEvent,
  ReadEventMetadataWithGlobalPosition,
} from '../typing';
import { type Event } from '../typing';

export type CurrentMessageProcessorPosition<
  Position = { globalPosition: bigint },
> = Position | 'BEGINNING' | 'END';

export type MessageProcessor<
  EventType extends Event = Event,
  EventMetaDataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  MessageProcessorStartOptions = unknown,
> = {
  id: string;
  start: (
    options: MessageProcessorStartOptions,
  ) => Promise<CurrentMessageProcessorPosition | undefined>;
  isActive: boolean;
  handle: (
    messagesBatch: MessagesBatch<EventType, EventMetaDataType>,
    context: { pool?: Dumbo; connectionString?: string },
  ) => Promise<MessageBatchHandlingResult>;
};

export const MessageProcessor = {
  result: {
    skip: (options?: { reason?: string }): MessageBatchHandlingResult => ({
      type: 'SKIP',
      ...(options ?? {}),
    }),
    stop: (options?: {
      reason?: string;
      error?: EmmettError;
    }): MessageBatchHandlingResult => ({
      type: 'STOP',
      ...(options ?? {}),
    }),
  },
};

export type PostgreSQLProcessorEachMessageHandler<
  EventType extends AnyEvent = AnyEvent,
> = (
  event: ReadEvent<EventType, ReadEventMetadataWithGlobalPosition>,
  context: PostgreSQLProcessorHandlerContext,
) =>
  | Promise<PostgreSQLProcessorMessageHandlerResult>
  | PostgreSQLProcessorMessageHandlerResult;

export type PostgreSQLProcessorEachBatchHandler<
  EventType extends AnyEvent = AnyEvent,
> = (
  event: ReadEvent<EventType, ReadEventMetadataWithGlobalPosition>[],
  context: PostgreSQLProcessorHandlerContext,
) =>
  | Promise<PostgreSQLProcessorMessageHandlerResult>
  | PostgreSQLProcessorMessageHandlerResult;

export type PostgreSQLProcessorStartFrom =
  | CurrentMessageProcessorPosition
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

export type GenericPostgreSQLProcessorOptions<EventType extends Event = Event> =
  {
    processorId: string;
    version?: number;
    partition?: string;
    startFrom?: PostgreSQLProcessorStartFrom;
    stopAfter?: (
      message: ReadEvent<EventType, ReadEventMetadataWithGlobalPosition>,
    ) => boolean;
    eachMessage: PostgreSQLProcessorEachMessageHandler<EventType>;
    connectionOptions?: PostgreSQLProcessorConnectionOptions;
    // TODO: Add eachBatch
  };

export type PostgreSQLProjectionProcessorOptions<
  EventType extends Event = Event,
> = {
  processorId?: string;
  version?: number;
  projection: PostgreSQLProjectionDefinition<EventType>;
  partition?: string;
  startFrom?: PostgreSQLProcessorStartFrom;
  stopAfter?: (
    message: ReadEvent<EventType, ReadEventMetadataWithGlobalPosition>,
  ) => boolean;
  connectionOptions?: PostgreSQLProcessorConnectionOptions;
};

export type PostgreSQLProcessorOptions<EventType extends Event = Event> =
  | GenericPostgreSQLProcessorOptions<EventType>
  | PostgreSQLProjectionProcessorOptions<EventType>;

const genericPostgreSQLProcessor = <EventType extends Event = Event>(
  options: GenericPostgreSQLProcessorOptions<EventType>,
): PostgreSQLProcessor => {
  const { eachMessage } = options;
  let isActive = true;
  //let lastProcessedPosition: bigint | null = null;

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

  const getPool = (context: {
    pool?: Dumbo;
    connectionString?: string;
  }): { pool: Dumbo; connectionString: string } => {
    const connectionString =
      processorConnectionString ?? context.connectionString;

    if (!connectionString)
      throw new EmmettError(
        `PostgreSQL processor '${options.processorId}' is missing connection string. Ensure that you passed it through options`,
      );

    const pool =
      (!processorConnectionString ||
      connectionString == processorConnectionString
        ? context?.pool
        : processorPool) ?? processorPool;

    if (!pool)
      throw new EmmettError(
        `PostgreSQL processor '${options.processorId}' is missing connection string. Ensure that you passed it through options`,
      );

    return {
      connectionString,
      pool: pool,
    };
  };

  return {
    id: options.processorId,
    start: async (
      execute: SQLExecutor,
    ): Promise<CurrentMessageProcessorPosition | undefined> => {
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

export const postgreSQLProcessor = <EventType extends Event = Event>(
  options: PostgreSQLProcessorOptions<EventType>,
): PostgreSQLProcessor => {
  if ('projection' in options) {
    return postgreSQLProjectionProcessor(options);
  }

  return genericPostgreSQLProcessor(options);
};
