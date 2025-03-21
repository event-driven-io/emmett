import { type SQLExecutor } from '@event-driven-io/dumbo';
import type {
  BatchRecordedMessageHandlerWithoutContext,
  EmmettError,
  Message,
  ReadEventMetadataWithGlobalPosition,
} from '@event-driven-io/emmett';
import { readLastMessageGlobalPosition } from '../../schema/readLastMessageGlobalPosition';
import {
  readMessagesBatch,
  type ReadMessagesBatchOptions,
} from '../../schema/readMessagesBatch';

export const DefaultPostgreSQLEventStoreProcessorBatchSize = 100;
export const DefaultPostgreSQLEventStoreProcessorPullingFrequencyInMs = 50;

export type PostgreSQLEventStoreMessagesBatchHandlerResult = void | {
  type: 'STOP';
  reason?: string;
  error?: EmmettError;
};

export type PostgreSQLEventStoreMessageBatchPullerOptions<
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
};

export type PostgreSQLEventStoreMessageBatchPullerStartFrom =
  | { lastCheckpoint: bigint }
  | 'BEGINNING'
  | 'END';

export type PostgreSQLEventStoreMessageBatchPullerStartOptions = {
  startFrom: PostgreSQLEventStoreMessageBatchPullerStartFrom;
};

export type PostgreSQLEventStoreMessageBatchPuller = {
  isRunning: boolean;
  start(
    options: PostgreSQLEventStoreMessageBatchPullerStartOptions,
  ): Promise<void>;
  stop(): Promise<void>;
};

export const postgreSQLEventStoreMessageBatchPuller = <
  MessageType extends Message = Message,
>({
  executor,
  batchSize,
  eachBatch,
  pullingFrequencyInMs,
  stopWhen,
}: PostgreSQLEventStoreMessageBatchPullerOptions<MessageType>): PostgreSQLEventStoreMessageBatchPuller => {
  let isRunning = false;

  let start: Promise<void>;

  const pullMessages = async (
    options: PostgreSQLEventStoreMessageBatchPullerStartOptions,
  ) => {
    const after =
      options.startFrom === 'BEGINNING'
        ? 0n
        : options.startFrom === 'END'
          ? ((await readLastMessageGlobalPosition(executor))
              .currentGlobalPosition ?? 0n)
          : options.startFrom.lastCheckpoint;

    const readMessagesOptions: ReadMessagesBatchOptions = {
      after,
      batchSize,
    };

    let waitTime = 100;

    do {
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

export const zipPostgreSQLEventStoreMessageBatchPullerStartFrom = (
  options: (PostgreSQLEventStoreMessageBatchPullerStartFrom | undefined)[],
): PostgreSQLEventStoreMessageBatchPullerStartFrom => {
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
