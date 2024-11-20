import { dumbo } from '@event-driven-io/dumbo';
import { EmmettError, type Event } from '@event-driven-io/emmett';
import {
  postgreSQLEventStoreMessageBatchPuller,
  type PostgreSQLEventStoreMessagesBatchHandler,
} from './messageBatchProcessing';
import {
  DefaultPostgreSQLEventStoreSubscriptionBatchSize,
  postgreSQLEventStoreSubscription,
  type PostgreSQLEventStoreSubscription,
  type PostgreSQLEventStoreSubscriptionOptions,
} from './postgreSQLEventStoreSubscription';

export type PostgreSQLEventStoreConsumerOptions = {
  connectionString: string;
  subscriptions?: PostgreSQLEventStoreSubscription[];
  batchSize?: number;
};

export type PostgreSQLEventStoreConsumer = Readonly<{
  connectionString: string;
  isRunning: boolean;
  subscriptions: PostgreSQLEventStoreSubscription[];
  subscribe: <EventType extends Event = Event>(
    options: PostgreSQLEventStoreSubscriptionOptions<EventType>,
  ) => PostgreSQLEventStoreSubscription<EventType>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}>;

export const postgreSQLEventStoreConsumer = (
  options: PostgreSQLEventStoreConsumerOptions,
): PostgreSQLEventStoreConsumer => {
  let isRunning = false;
  const { connectionString, batchSize } = options;
  const subscriptions = options.subscriptions ?? [];

  const pool = dumbo({ connectionString });

  const eachBatch: PostgreSQLEventStoreMessagesBatchHandler = async (
    messagesBatch,
  ) => {
    const activeSubscriptions = subscriptions.filter((s) => s.isActive);

    if (activeSubscriptions.length === 0)
      return {
        type: 'STOP',
        reason: 'No active subscriptions',
      };

    const result = await Promise.allSettled(
      activeSubscriptions.map((s) => {
        // TODO: Add here filtering to only pass messages that can be handled by subscription
        return s.handle(messagesBatch);
      }),
    );

    return result.some((r) => r.status === 'fulfilled')
      ? undefined
      : {
          type: 'STOP',
        };
  };

  const messagePooler = postgreSQLEventStoreMessageBatchPuller({
    executor: pool.execute,
    eachBatch,
    batchSize: batchSize ?? DefaultPostgreSQLEventStoreSubscriptionBatchSize,
  });

  let start: Promise<void>;

  return {
    connectionString,
    subscriptions,
    get isRunning() {
      return isRunning;
    },
    subscribe: <EventType extends Event = Event>(
      options: PostgreSQLEventStoreSubscriptionOptions<EventType>,
    ): PostgreSQLEventStoreSubscription<EventType> => {
      const subscription = postgreSQLEventStoreSubscription<EventType>(options);

      subscriptions.push(subscription);

      return subscription;
    },
    start: () => {
      start = (() => {
        if (subscriptions.length === 0)
          return Promise.reject(
            new EmmettError(
              'Cannot start consumer without at least a single subscription',
            ),
          );

        isRunning = true;

        return messagePooler.start();
      })();

      return start;
    },
    stop: async () => {
      await messagePooler.stop();
      await start;
      await pool.close();
      isRunning = false;
    },
  };
};
