import { type SQLExecutor } from '@event-driven-io/dumbo';
import type {
  EmmettError,
  Event,
  ReadEvent,
  ReadEventMetadataWithGlobalPosition,
} from '@event-driven-io/emmett';
import {
  readMessagesBatch,
  type ReadMessagesBatchOptions,
} from '../../schema/readMessagesBatch';

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
  batchSize: number;
  eachBatch: PostgreSQLEventStoreMessagesBatchHandler<EventType>;
};

export const postgreSQLEventStoreMessageBatchPuller = <
  EventType extends Event = Event,
>({
  executor,
  batchSize,
  eachBatch,
}: PostgreSQLEventStoreMessageBatchPullerOptions<EventType>) => {
  let isRunning = false;

  let start: Promise<void>;

  const pullMessages = async () => {
    const options: ReadMessagesBatchOptions = { from: 0n, batchSize };

    let waitTime = 100;

    do {
      const { messages, currentGlobalPosition, areEventsLeft } =
        await readMessagesBatch<EventType>(executor, options);

      const result = await eachBatch({ messages });

      if (result && result.type === 'STOP') {
        isRunning = false;
        break;
      }

      options.from = currentGlobalPosition;

      if (!areEventsLeft) {
        waitTime = Math.min(waitTime * 2, 5000);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      } else {
        waitTime = 0;
      }
    } while (isRunning);
  };

  return {
    get isRunning() {
      return isRunning;
    },
    start: () => {
      start = (async () => {
        isRunning = true;

        return pullMessages();
      })();

      return start;
    },
    stop: async () => {
      isRunning = false;
      await start;
    },
  };
};
