import {
  type Dumbo,
  type NodePostgresClient,
  type NodePostgresTransaction,
  type SQLExecutor,
} from '@event-driven-io/dumbo';
import {
  EmmettError,
  type Event,
  type ReadEvent,
  type ReadEventMetadataWithGlobalPosition,
} from '@event-driven-io/emmett';
import type { PostgreSQLProjectionDefinition } from '../projections';
import { readProcessorCheckpoint, storeProcessorCheckpoint } from '../schema';
import type { PostgreSQLEventStoreMessageBatchPullerStartFrom } from './messageBatchProcessing';

export type PostgreSQLProcessorEventsBatch<EventType extends Event = Event> = {
  messages: ReadEvent<EventType, ReadEventMetadataWithGlobalPosition>[];
};

export type PostgreSQLProcessorHandlerContext = {
  execute: SQLExecutor;
  connection: {
    connectionString: string;
    client: NodePostgresClient;
    transaction: NodePostgresTransaction;
    pool: Dumbo;
  };
};

export type PostgreSQLProcessor<EventType extends Event = Event> = {
  id: string;
  start: (
    execute: SQLExecutor,
  ) => Promise<PostgreSQLEventStoreMessageBatchPullerStartFrom | undefined>;
  isActive: boolean;
  handle: (
    messagesBatch: PostgreSQLProcessorEventsBatch<EventType>,
    context: { pool: Dumbo; connectionString: string },
  ) => Promise<PostgreSQLProcessorMessageHandlerResult>;
};

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

export type PostgreSQLProcessorStartFrom =
  | PostgreSQLEventStoreMessageBatchPullerStartFrom
  | 'CURRENT';

export type PostgreSQLProcessorOptions<EventType extends Event = Event> = {
  processorId: string;
  version?: number;
  partition?: string;
  startFrom?: PostgreSQLProcessorStartFrom;
  stopAfter?: (
    message: ReadEvent<EventType, ReadEventMetadataWithGlobalPosition>,
  ) => boolean;
  eachMessage: PostgreSQLProcessorEachMessageHandler<EventType>;
};

export const postgreSQLProjectionProcessor = <EventType extends Event = Event>(
  projection: PostgreSQLProjectionDefinition<EventType>,
): PostgreSQLProcessor => {
  return postgreSQLProcessor<EventType>({
    processorId: `projection:${projection.name}`,
    eachMessage: async (event, context) => {
      if (!projection.canHandle.includes(event.type)) return;

      await projection.handle([event], context);
    },
  });
};

export const postgreSQLProcessor = <EventType extends Event = Event>(
  options: PostgreSQLProcessorOptions<EventType>,
): PostgreSQLProcessor => {
  const { eachMessage } = options;
  let isActive = true;
  //let lastProcessedPosition: bigint | null = null;

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
      { pool, connectionString },
    ): Promise<PostgreSQLProcessorMessageHandlerResult> => {
      if (!isActive) return;

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
