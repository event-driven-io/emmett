import { dumbo } from '@event-driven-io/dumbo';
import { EmmettError, type Event } from '@event-driven-io/emmett';
import {
  DefaultPostgreSQLEventStoreSubscriptionBatchSize,
  DefaultPostgreSQLEventStoreSubscriptionPullingFrequencyInMs,
  postgreSQLEventStoreMessageBatchPuller,
  zipPostgreSQLEventStoreMessageBatchPullerStartFrom,
  type PostgreSQLEventStoreMessageBatchPuller,
  type PostgreSQLEventStoreMessagesBatchHandler,
} from './messageBatchProcessing';
import {
  postgreSQLEventStoreSubscription,
  type PostgreSQLEventStoreSubscription,
  type PostgreSQLEventStoreSubscriptionOptions,
} from './postgreSQLEventStoreSubscription';

export type PostgreSQLEventStoreConsumerOptions = {
  connectionString: string;
  subscriptions?: PostgreSQLEventStoreSubscription[];
  pooling?: {
    batchSize?: number;
    pullingFrequencyInMs?: number;
  };
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
  close: () => Promise<void>;
}>;

export const postgreSQLEventStoreConsumer = (
  options: PostgreSQLEventStoreConsumerOptions,
): PostgreSQLEventStoreConsumer => {
  let isRunning = false;
  const { connectionString, pooling } = options;
  const subscriptions = options.subscriptions ?? [];

  let start: Promise<void>;

  let currentMessagePooler: PostgreSQLEventStoreMessageBatchPuller | undefined;

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
        return s.handle(messagesBatch, { pool });
      }),
    );

    return result.some(
      (r) => r.status === 'fulfilled' && r.value?.type !== 'STOP',
    )
      ? undefined
      : {
          type: 'STOP',
        };
  };

  const messagePooler = (currentMessagePooler =
    postgreSQLEventStoreMessageBatchPuller({
      executor: pool.execute,
      eachBatch,
      batchSize:
        pooling?.batchSize ?? DefaultPostgreSQLEventStoreSubscriptionBatchSize,
      pullingFrequencyInMs:
        pooling?.pullingFrequencyInMs ??
        DefaultPostgreSQLEventStoreSubscriptionPullingFrequencyInMs,
    }));

  const stop = async () => {
    if (!isRunning) return;
    isRunning = false;
    if (currentMessagePooler) {
      await currentMessagePooler.stop();
      currentMessagePooler = undefined;
    }
    await start;
  };

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
      if (isRunning) return start;

      start = (async () => {
        if (subscriptions.length === 0)
          return Promise.reject(
            new EmmettError(
              'Cannot start consumer without at least a single subscription',
            ),
          );

        isRunning = true;

        const startFrom = zipPostgreSQLEventStoreMessageBatchPullerStartFrom(
          await Promise.all(subscriptions.map((o) => o.start(pool.execute))),
        );

        return messagePooler.start({ startFrom });
      })();

      return start;
    },
    stop,
    close: async () => {
      await stop();
      await pool.close();
    },
  };
};
