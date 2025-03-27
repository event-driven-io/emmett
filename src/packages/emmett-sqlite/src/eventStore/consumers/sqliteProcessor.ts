import {
  EmmettError,
  type Event,
  type ReadEvent,
  type ReadEventMetadataWithGlobalPosition,
} from '@event-driven-io/emmett';
import { sqliteConnection, type SQLiteConnection } from '../../connection';
import type { SQLiteProjectionDefinition } from '../projections';
import { readProcessorCheckpoint, storeProcessorCheckpoint } from '../schema';
import type { SQLiteEventStoreMessageBatchPullerStartFrom } from './messageBatchProcessing';

export type SQLiteProcessorEventsBatch<EventType extends Event = Event> = {
  messages: ReadEvent<EventType, ReadEventMetadataWithGlobalPosition>[];
};

export type SQLiteProcessorHandlerContext = {
  connection: SQLiteConnection;
  fileName: string;
};

export type SQLiteProcessor<EventType extends Event = Event> = {
  id: string;
  start: (
    connection: SQLiteConnection,
  ) => Promise<SQLiteEventStoreMessageBatchPullerStartFrom | undefined>;
  isActive: boolean;
  handle: (
    messagesBatch: SQLiteProcessorEventsBatch<EventType>,
    context: { connection?: SQLiteConnection; fileName?: string },
  ) => Promise<SQLiteProcessorMessageHandlerResult>;
};

export const SQLiteProcessor = {
  result: {
    skip: (options?: {
      reason?: string;
    }): SQLiteProcessorMessageHandlerResult => ({
      type: 'SKIP',
      ...(options ?? {}),
    }),
    stop: (options?: {
      reason?: string;
      error?: EmmettError;
    }): SQLiteProcessorMessageHandlerResult => ({
      type: 'STOP',
      ...(options ?? {}),
    }),
  },
};

export type SQLiteProcessorMessageHandlerResult =
  | void
  | { type: 'SKIP'; reason?: string }
  | { type: 'STOP'; reason?: string; error?: EmmettError };

export type SQLiteProcessorEachMessageHandler<EventType extends Event = Event> =
  (
    event: ReadEvent<EventType, ReadEventMetadataWithGlobalPosition>,
    context: SQLiteProcessorHandlerContext,
  ) =>
    | Promise<SQLiteProcessorMessageHandlerResult>
    | SQLiteProcessorMessageHandlerResult;

export type SQLiteProcessorEachBatchHandler<EventType extends Event = Event> = (
  event: ReadEvent<EventType, ReadEventMetadataWithGlobalPosition>[],
  context: SQLiteProcessorHandlerContext,
) =>
  | Promise<SQLiteProcessorMessageHandlerResult>
  | SQLiteProcessorMessageHandlerResult;

export type SQLiteProcessorStartFrom =
  | SQLiteEventStoreMessageBatchPullerStartFrom
  | 'CURRENT';

export type SQLiteProcessorConnectionOptions = {
  fileName: string;
  connection?: SQLiteConnection;
};

export type GenericSQLiteProcessorOptions<EventType extends Event = Event> = {
  processorId: string;
  version?: number;
  partition?: string;
  startFrom?: SQLiteProcessorStartFrom;
  stopAfter?: (
    message: ReadEvent<EventType, ReadEventMetadataWithGlobalPosition>,
  ) => boolean;
  eachMessage: SQLiteProcessorEachMessageHandler<EventType>;
  connectionOptions?: SQLiteProcessorConnectionOptions;
  // TODO: Add eachBatch
};

export type SQLiteProjectionProcessorOptions<EventType extends Event = Event> =
  {
    processorId?: string;
    version?: number;
    projection: SQLiteProjectionDefinition<EventType>;
    partition?: string;
    startFrom?: SQLiteProcessorStartFrom;
    stopAfter?: (
      message: ReadEvent<EventType, ReadEventMetadataWithGlobalPosition>,
    ) => boolean;
  };

export type SQLiteProcessorOptions<EventType extends Event = Event> =
  | GenericSQLiteProcessorOptions<EventType>
  | SQLiteProjectionProcessorOptions<EventType>;

const genericSQLiteProcessor = <EventType extends Event = Event>(
  options: GenericSQLiteProcessorOptions<EventType>,
): SQLiteProcessor => {
  const { eachMessage } = options;
  let isActive = true;
  //let lastProcessedPosition: number | null = null;

  const getDb = (context: {
    connection?: SQLiteConnection;
    fileName?: string;
  }): { connection: SQLiteConnection; fileName: string } => {
    const fileName = context.fileName ?? options.connectionOptions?.fileName;
    if (!fileName)
      throw new EmmettError(
        `SQLite processor '${options.processorId}' is missing file name. Ensure that you passed it through options`,
      );

    const connection =
      context.connection ??
      options.connectionOptions?.connection ??
      sqliteConnection({ fileName });

    return { connection, fileName };
  };

  return {
    id: options.processorId,
    start: async (
      connection: SQLiteConnection,
    ): Promise<SQLiteEventStoreMessageBatchPullerStartFrom | undefined> => {
      isActive = true;
      if (options.startFrom !== 'CURRENT') return options.startFrom;

      const { lastProcessedPosition } = await readProcessorCheckpoint(
        connection,
        {
          processorId: options.processorId,
          partition: options.partition,
        },
      );

      if (lastProcessedPosition === null) return 'BEGINNING';

      return { globalPosition: lastProcessedPosition };
    },
    get isActive() {
      return isActive;
    },
    handle: async (
      { messages },
      context,
    ): Promise<SQLiteProcessorMessageHandlerResult> => {
      if (!isActive) return;

      const { connection, fileName } = getDb(context);

      return connection.withTransaction(async () => {
        let result: SQLiteProcessorMessageHandlerResult | undefined = undefined;

        let lastProcessedPosition: bigint | null = null;

        for (const message of messages) {
          const typedMessage = message as ReadEvent<
            EventType,
            ReadEventMetadataWithGlobalPosition
          >;

          const messageProcessingResult = await eachMessage(typedMessage, {
            connection,
            fileName,
          });

          // TODO: Add correct handling of the storing checkpoint
          await storeProcessorCheckpoint(connection, {
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

export const sqliteProjectionProcessor = <EventType extends Event = Event>(
  options: SQLiteProjectionProcessorOptions<EventType>,
): SQLiteProcessor => {
  const projection = options.projection;

  return genericSQLiteProcessor<EventType>({
    processorId: options.processorId ?? `projection:${projection.name}`,
    eachMessage: async (event, context) => {
      if (!projection.canHandle.includes(event.type)) return;

      await projection.handle([event], { connection: context.connection });
    },
    ...options,
  });
};

export const sqliteProcessor = <EventType extends Event = Event>(
  options: SQLiteProcessorOptions<EventType>,
): SQLiteProcessor => {
  if ('projection' in options) {
    return sqliteProjectionProcessor(options);
  }

  return genericSQLiteProcessor(options);
};
