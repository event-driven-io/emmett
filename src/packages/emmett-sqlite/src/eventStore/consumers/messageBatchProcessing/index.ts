import type {
  EmmettError,
  Event,
  ReadEvent,
  ReadEventMetadataWithGlobalPosition,
} from '@event-driven-io/emmett';
import type { SQLiteConnection } from '../../../connection';
import { readLastMessageGlobalPosition } from '../../schema/readLastMessageGlobalPosition';
import {
  readMessagesBatch,
  type ReadMessagesBatchOptions,
} from '../../schema/readMessagesBatch';

export const DefaultSQLiteEventStoreProcessorBatchSize = 100;
export const DefaultSQLiteEventStoreProcessorPullingFrequencyInMs = 50;

export type SQLiteEventStoreMessagesBatch<EventType extends Event = Event> = {
  messages: ReadEvent<EventType, ReadEventMetadataWithGlobalPosition>[];
};

export type SQLiteEventStoreMessagesBatchHandlerResult = void | {
  type: 'STOP';
  reason?: string;
  error?: EmmettError;
};

export type SQLiteEventStoreMessagesBatchHandler<
  EventType extends Event = Event,
> = (
  messagesBatch: SQLiteEventStoreMessagesBatch<EventType>,
) =>
  | Promise<SQLiteEventStoreMessagesBatchHandlerResult>
  | SQLiteEventStoreMessagesBatchHandlerResult;

export type SQLiteEventStoreMessageBatchPullerOptions<
  EventType extends Event = Event,
> = {
  connection: SQLiteConnection;
  pullingFrequencyInMs: number;
  batchSize: number;
  eachBatch: SQLiteEventStoreMessagesBatchHandler<EventType>;
};

export type SQLiteEventStoreMessageBatchPullerStartFrom =
  | { globalPosition: bigint }
  | 'BEGINNING'
  | 'END';

export type SQLiteEventStoreMessageBatchPullerStartOptions = {
  startFrom: SQLiteEventStoreMessageBatchPullerStartFrom;
};

export type SQLiteEventStoreMessageBatchPuller = {
  isRunning: boolean;
  start(options: SQLiteEventStoreMessageBatchPullerStartOptions): Promise<void>;
  stop(): Promise<void>;
};

export const sqliteEventStoreMessageBatchPuller = <
  EventType extends Event = Event,
>({
  connection,
  batchSize,
  eachBatch,
  pullingFrequencyInMs,
}: SQLiteEventStoreMessageBatchPullerOptions<EventType>): SQLiteEventStoreMessageBatchPuller => {
  let isRunning = false;

  let start: Promise<void>;

  const pullMessages = async (
    options: SQLiteEventStoreMessageBatchPullerStartOptions,
  ) => {
    const after =
      options.startFrom === 'BEGINNING'
        ? 0n
        : options.startFrom === 'END'
          ? ((await readLastMessageGlobalPosition(connection))
              .currentGlobalPosition ?? 0n)
          : options.startFrom.globalPosition;

    const readMessagesOptions: ReadMessagesBatchOptions = {
      after,
      batchSize,
    };

    let waitTime = 100;

    do {
      const { messages, currentGlobalPosition, areEventsLeft } =
        await readMessagesBatch<EventType>(connection, readMessagesOptions);

      if (messages.length > 0) {
        const result = await eachBatch({ messages });

        if (result && result.type === 'STOP') {
          isRunning = false;
          break;
        }
      }

      readMessagesOptions.after = currentGlobalPosition;

      await new Promise((resolve) => setTimeout(resolve, waitTime));

      if (!areEventsLeft) {
        waitTime = Math.min(waitTime * 2, 1000);
      } else {
        waitTime = pullingFrequencyInMs;
      }
    } while (isRunning);
  };

  return {
    get isRunning() {
      return isRunning;
    },
    start: (options) => {
      if (isRunning) return start;

      start = (async () => {
        isRunning = true;

        return pullMessages(options);
      })();

      return start;
    },
    stop: async () => {
      if (!isRunning) return;
      isRunning = false;
      await start;
    },
  };
};

export const zipSQLiteEventStoreMessageBatchPullerStartFrom = (
  options: (SQLiteEventStoreMessageBatchPullerStartFrom | undefined)[],
): SQLiteEventStoreMessageBatchPullerStartFrom => {
  if (
    options.length === 0 ||
    options.some((o) => o === undefined || o === 'BEGINNING')
  )
    return 'BEGINNING';

  if (options.every((o) => o === 'END')) return 'END';

  return options
    .filter((o) => o !== undefined && o !== 'BEGINNING' && o !== 'END')
    .sort((a, b) => (a > b ? 1 : -1))[0]!;
};
