import { type SQLExecutor } from '@event-driven-io/dumbo';
import type {
  EmmettError,
  Event,
  ReadEvent,
  ReadEventMetadataWithGlobalPosition,
} from '@event-driven-io/emmett';
import { readLastMessageGlobalPosition } from '../../schema/readLastMessageGlobalPosition';
import {
  readMessagesBatch,
  type ReadMessagesBatchOptions,
} from '../../schema/readMessagesBatch';

export const DefaultPostgreSQLEventStoreProcessorBatchSize = 100;
export const DefaultPostgreSQLEventStoreProcessorPullingFrequencyInMs = 50;

export type PostgreSQLEventStoreMessagesBatch<EventType extends Event = Event> =
  {
    messages: ReadEvent<EventType, ReadEventMetadataWithGlobalPosition>[];
  };

export type PostgreSQLEventStoreMessagesBatchHandlerResult = void | {
  type: 'STOP';
  reason?: string;
  error?: EmmettError;
};

export type PostgreSQLEventStoreMessagesBatchHandler<
  EventType extends Event = Event,
> = (
  messagesBatch: PostgreSQLEventStoreMessagesBatch<EventType>,
) =>
  | Promise<PostgreSQLEventStoreMessagesBatchHandlerResult>
  | PostgreSQLEventStoreMessagesBatchHandlerResult;

export type PostgreSQLEventStoreMessageBatchPullerOptions<
  EventType extends Event = Event,
> = {
  executor: SQLExecutor;
  pullingFrequencyInMs: number;
  batchSize: number;
  eachBatch: PostgreSQLEventStoreMessagesBatchHandler<EventType>;
};

export type PostgreSQLEventStoreMessageBatchPullerStartFrom =
  | { globalPosition: bigint }
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
  EventType extends Event = Event,
>({
  executor,
  batchSize,
  eachBatch,
  pullingFrequencyInMs,
}: PostgreSQLEventStoreMessageBatchPullerOptions<EventType>): PostgreSQLEventStoreMessageBatchPuller => {
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
          : options.startFrom.globalPosition;

    const readMessagesOptions: ReadMessagesBatchOptions = {
      after,
      batchSize,
    };

    let waitTime = 100;

    do {
      const { messages, currentGlobalPosition, areEventsLeft } =
        await readMessagesBatch<EventType>(executor, readMessagesOptions);

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
