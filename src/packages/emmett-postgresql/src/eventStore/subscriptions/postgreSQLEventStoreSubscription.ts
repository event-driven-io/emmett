import { dumbo, type SQLExecutor } from '@event-driven-io/dumbo';
import {
  EmmettError,
  type Event,
  type ReadEvent,
  type ReadEventMetadataWithGlobalPosition,
} from '@event-driven-io/emmett';
import {
  readMessagesBatch,
  type ReadMessagesBatchOptions,
} from '../schema/readMessagesBatch';

export type PostgreSQLEventStoreSubscription = {
  isRunning: boolean;
  subscribe: () => Promise<void>;
  stop: () => Promise<void>;
};

export const PostgreSQLEventStoreSubscription = {
  result: {
    skip: (options?: {
      reason?: string;
    }): PostgreSQLEventStoreSubscriptionMessageHandlerResult => ({
      type: 'SKIP',
      ...(options ?? {}),
    }),
    stop: (options?: {
      reason?: string;
      error?: EmmettError;
    }): PostgreSQLEventStoreSubscriptionMessageHandlerResult => ({
      type: 'STOP',
      ...(options ?? {}),
    }),
  },
};

export type PostgreSQLEventStoreSubscriptionMessageHandlerResult =
  | void
  | { type: 'SKIP'; reason?: string }
  | { type: 'STOP'; reason?: string; error?: EmmettError };

export type PostgreSQLEventStoreSubscriptionEachMessageHandler<
  EventType extends Event = Event,
> = (
  event: ReadEvent<EventType, ReadEventMetadataWithGlobalPosition>,
) =>
  | Promise<PostgreSQLEventStoreSubscriptionMessageHandlerResult>
  | PostgreSQLEventStoreSubscriptionMessageHandlerResult;

export const DefaultPostgreSQLEventStoreSubscriptionBatchSize = 100;

export type PostgreSQLEventStoreSubscriptionOptions<
  EventType extends Event = Event,
> = {
  connectionString: string;
  eachMessage: PostgreSQLEventStoreSubscriptionEachMessageHandler<EventType>;
  batchSize?: number;
};

type MessageBatchPoolerOptions<EventType extends Event = Event> = {
  executor: SQLExecutor;
  batchSize: number;
  eachMessage: PostgreSQLEventStoreSubscriptionOptions<EventType>['eachMessage'];
};

const messageBatchPooler = <EventType extends Event = Event>({
  executor,
  batchSize,
  eachMessage,
}: MessageBatchPoolerOptions<EventType>) => {
  let isRunning = false;

  let start: Promise<void>;
  const pollMessages = async () => {
    const options: ReadMessagesBatchOptions = { from: 0n, batchSize };
    do {
      const { events } = await readMessagesBatch(executor, options);

      for (const message of events) {
        const result = await eachMessage(
          message as ReadEvent<EventType, ReadEventMetadataWithGlobalPosition>,
        );

        if (result) {
          if (result.type === 'SKIP') continue;
          else if (result.type === 'STOP') {
            isRunning = false;
            break;
          }
        }
      }
      options.from += BigInt(events.length);
    } while (isRunning);
  };

  return {
    get isRunning() {
      return isRunning;
    },
    start: () => {
      start = (async () => {
        isRunning = true;

        return pollMessages();
      })();

      return start;
    },
    stop: async () => {
      isRunning = false;
      await start;
    },
  };
};

export const postgreSQLEventStoreSubscription = <
  EventType extends Event = Event,
>(
  options: PostgreSQLEventStoreSubscriptionOptions<EventType>,
): PostgreSQLEventStoreSubscription => {
  let isRunning = false;

  const { connectionString } = options;
  const pool = dumbo({ connectionString });
  const messagePooler = messageBatchPooler({
    executor: pool.execute,
    eachMessage: options.eachMessage,
    batchSize:
      options.batchSize ?? DefaultPostgreSQLEventStoreSubscriptionBatchSize,
  });

  let subscribe: Promise<void>;

  return {
    get isRunning() {
      return isRunning;
    },
    subscribe: () => {
      subscribe = (() => {
        isRunning = true;

        return messagePooler.start();
      })();

      return subscribe;
    },
    stop: async () => {
      await messagePooler.stop();
      await subscribe;
      await pool.close();
      isRunning = false;
    },
  };
};
