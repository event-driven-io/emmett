import { EmmettError, type Event } from '@event-driven-io/emmett';
import {
  EventStoreDBClient,
  type SubscribeToAllOptions,
  type SubscribeToStreamOptions,
} from '@eventstore/db-client';
import {
  eventStoreDBEventStoreSubscription,
  type EventStoreDBEventStoreSubscription,
  type EventStoreDBEventStoreSubscriptionOptions,
} from './eventStoreDBEventStoreSubscription';
import {
  DefaultEventStoreDBEventStoreSubscriptionBatchSize,
  eventStoreDBEventStoreMessageBatchPuller,
  zipEventStoreDBEventStoreMessageBatchPullerStartFrom,
  type EventStoreDBEventStoreMessageBatchPuller,
  type EventStoreDBEventStoreMessagesBatchHandler,
} from './messageBatchProcessing';

export type EventStoreDBEventStoreConsumerOptions = {
  connectionString: string;
  from?: EventStoreDBEventStoreConsumerType;
  subscriptions?: EventStoreDBEventStoreSubscription[];
  pulling?: {
    batchSize?: number;
  };
};

export type $all = '$all';
export const $all = '$all';

export type EventStoreDBEventStoreConsumerType =
  | {
      stream: $all;
      options?: Exclude<SubscribeToAllOptions, 'fromPosition'>;
    }
  | {
      stream: string;
      options?: Exclude<SubscribeToStreamOptions, 'fromRevision'>;
    };

export type EventStoreDBEventStoreConsumer = Readonly<{
  connectionString: string;
  isRunning: boolean;
  subscriptions: EventStoreDBEventStoreSubscription[];
  subscribe: <EventType extends Event = Event>(
    options: EventStoreDBEventStoreSubscriptionOptions<EventType>,
  ) => EventStoreDBEventStoreSubscription<EventType>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  close: () => Promise<void>;
}>;

export const eventStoreDBEventStoreConsumer = (
  options: EventStoreDBEventStoreConsumerOptions,
): EventStoreDBEventStoreConsumer => {
  let isRunning = false;
  const { connectionString, pulling } = options;
  const subscriptions = options.subscriptions ?? [];

  let start: Promise<void>;

  let currentMessagePooler:
    | EventStoreDBEventStoreMessageBatchPuller
    | undefined;

  const eventStoreDBClient =
    EventStoreDBClient.connectionString(connectionString);

  const eachBatch: EventStoreDBEventStoreMessagesBatchHandler = async (
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
        return s.handle(messagesBatch, { eventStoreDBClient });
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

  const messagePuller = (currentMessagePooler =
    eventStoreDBEventStoreMessageBatchPuller({
      eventStoreDBClient,
      eachBatch,
      batchSize:
        pulling?.batchSize ??
        DefaultEventStoreDBEventStoreSubscriptionBatchSize,
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
      options: EventStoreDBEventStoreSubscriptionOptions<EventType>,
    ): EventStoreDBEventStoreSubscription<EventType> => {
      const subscription =
        eventStoreDBEventStoreSubscription<EventType>(options);

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

        const startFrom = zipEventStoreDBEventStoreMessageBatchPullerStartFrom(
          await Promise.all(
            subscriptions.map((o) => o.start(eventStoreDBClient)),
          ),
        );

        return messagePuller.start({ startFrom });
      })();

      return start;
    },
    stop,
    close: async () => {
      await stop();
    },
  };
};
