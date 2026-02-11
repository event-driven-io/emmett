import type { SQLExecutor } from '@event-driven-io/dumbo';
import {
  parseBigIntProcessorCheckpoint,
  type BatchRecordedMessageHandlerWithoutContext,
  type EmmettError,
  type Event,
  type Message,
  type ProcessorCheckpoint,
  type ReadEvent,
  type ReadEventMetadataWithGlobalPosition,
} from '@event-driven-io/emmett';
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

export type SQLiteEventStoreMessageBatchPullerOptions<
  MessageType extends Message = Message,
> = {
  executor: SQLExecutor;
  pullingFrequencyInMs: number;
  batchSize: number;
  eachBatch: BatchRecordedMessageHandlerWithoutContext<
    MessageType,
    ReadEventMetadataWithGlobalPosition
  >;
  stopWhen?: {
    noMessagesLeft?: boolean;
  };
  signal: AbortSignal;
};

export type SQLiteEventStoreMessageBatchPullerStartFrom =
  | { lastCheckpoint: ProcessorCheckpoint }
  | 'BEGINNING'
  | 'END';

export type SQLiteEventStoreMessageBatchPullerStartOptions = {
  startFrom: SQLiteEventStoreMessageBatchPullerStartFrom;
  signal?: AbortSignal;
};

export type SQLiteEventStoreMessageBatchPuller = {
  isRunning: boolean;
  start(options: SQLiteEventStoreMessageBatchPullerStartOptions): Promise<void>;
  stop(): Promise<void>;
};

export const sqliteEventStoreMessageBatchPuller = <
  MessageType extends Message = Message,
>({
  executor,
  batchSize,
  eachBatch,
  pullingFrequencyInMs,
  stopWhen,
  signal,
}: SQLiteEventStoreMessageBatchPullerOptions<MessageType>): SQLiteEventStoreMessageBatchPuller => {
  let isRunning = false;

  let start: Promise<void>;

  const pullMessages = async (
    options: SQLiteEventStoreMessageBatchPullerStartOptions,
  ) => {
    const after =
      options.startFrom === 'BEGINNING'
        ? 0n
        : options.startFrom === 'END'
          ? ((await readLastMessageGlobalPosition(executor))
              .currentGlobalPosition ?? 0n)
          : parseBigIntProcessorCheckpoint(options.startFrom.lastCheckpoint);

    const readMessagesOptions: ReadMessagesBatchOptions = {
      after,
      batchSize,
    };

    let waitTime = 100;

    while (isRunning && !signal?.aborted) {
      const { messages, currentGlobalPosition, areMessagesLeft } =
        await readMessagesBatch<MessageType>(executor, readMessagesOptions);

      if (messages.length > 0) {
        const result = await eachBatch(messages);

        if (result && result.type === 'STOP') {
          isRunning = false;
          break;
        }
      }

      readMessagesOptions.after = currentGlobalPosition;

      await new Promise((resolve) => setTimeout(resolve, waitTime));

      if (stopWhen?.noMessagesLeft === true && !areMessagesLeft) {
        isRunning = false;
        break;
      }

      if (!areMessagesLeft) {
        waitTime = Math.min(waitTime * 2, 1000);
      } else {
        waitTime = pullingFrequencyInMs;
      }
    }
  };

  return {
    get isRunning() {
      return isRunning;
    },
    start: (options) => {
      if (isRunning) return start;
      isRunning = true;

      start = (async () => {
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
