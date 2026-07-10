import type { SQLExecutor } from '@event-driven-io/dumbo';
import type { CurrentMessageProcessorPosition } from '@event-driven-io/emmett';
import {
  JSONSerializer,
  parseBigIntProcessorCheckpoint,
  type AsyncAwaiter,
  type BatchRecordedMessageHandlerWithoutContext,
  type EmmettError,
  type Event,
  type JSONSerializationOptions,
  type Message,
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
} & JSONSerializationOptions;

export type SQLiteEventStoreMessageBatchPullerStartFrom =
  CurrentMessageProcessorPosition;

export type SQLiteEventStoreMessageBatchPullerStartOptions = {
  startFrom: SQLiteEventStoreMessageBatchPullerStartFrom;
  signal?: AbortSignal;
  started?: AsyncAwaiter<void>;
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
  serialization,
}: SQLiteEventStoreMessageBatchPullerOptions<MessageType>): SQLiteEventStoreMessageBatchPuller => {
  let isRunning = false;

  let start: Promise<void>;
  const serializer = JSONSerializer.from({ serialization });

  const pullMessages = async (
    options: SQLiteEventStoreMessageBatchPullerStartOptions,
  ) => {
    let after: bigint;
    try {
      after =
        options.startFrom === 'BEGINNING'
          ? 0n
          : options.startFrom === 'END'
            ? ((await readLastMessageGlobalPosition(executor))
                .currentGlobalPosition ?? 0n)
            : parseBigIntProcessorCheckpoint(options.startFrom.lastCheckpoint);
    } catch (error) {
      options.started?.reject(error);
      throw error;
    }

    options.started?.resolve();

    const readMessagesOptions: ReadMessagesBatchOptions = {
      after,
      batchSize,
      serializer,
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
