import {
  EmmettError,
  type AsyncRetryOptions,
  type Event,
} from '@event-driven-io/emmett';
import {
  EventStoreDBClient,
  type SubscribeToAllOptions,
  type SubscribeToStreamOptions,
} from '@eventstore/db-client';
import {
  eventStoreDBEventStoreProcessor,
  type EventStoreDBEventStoreProcessor,
  type EventStoreDBEventStoreProcessorOptions,
} from './eventStoreDBEventStoreProcessor';
import {
  DefaultEventStoreDBEventStoreProcessorBatchSize,
  eventStoreDBSubscription,
  zipEventStoreDBEventStoreMessageBatchPullerStartFrom,
  type EventStoreDBEventStoreMessagesBatchHandler,
  type EventStoreDBSubscription,
} from './subscriptions';

export type EventStoreDBEventStoreConsumerConfig<
  ConsumerEventType extends Event = Event,
> = {
  from?: EventStoreDBEventStoreConsumerType;
  processors?: EventStoreDBEventStoreProcessor<ConsumerEventType>[];
  pulling?: {
    batchSize?: number;
  };
  resilience?: {
    resubscribeOptions?: AsyncRetryOptions;
  };
};

export type EventStoreDBEventStoreConsumerOptions<
  ConsumerEventType extends Event = Event,
> = EventStoreDBEventStoreConsumerConfig<ConsumerEventType> &
  (
    | {
        connectionString: string;
      }
    | { client: EventStoreDBClient }
  );

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

export type EventStoreDBEventStoreConsumer<
  ConsumerEventType extends Event = Event,
> = Readonly<{
  isRunning: boolean;
  processors: EventStoreDBEventStoreProcessor<ConsumerEventType>[];
  processor: <EventType extends ConsumerEventType = ConsumerEventType>(
    options: EventStoreDBEventStoreProcessorOptions<EventType>,
  ) => EventStoreDBEventStoreProcessor<EventType>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  close: () => Promise<void>;
}>;

export const eventStoreDBEventStoreConsumer = <
  ConsumerEventType extends Event = Event,
>(
  options: EventStoreDBEventStoreConsumerOptions<ConsumerEventType>,
): EventStoreDBEventStoreConsumer<ConsumerEventType> => {
  let isRunning = false;
  const { pulling } = options;
  const processors = options.processors ?? [];

  let start: Promise<void>;

  let currentSubscription: EventStoreDBSubscription | undefined;

  const client =
    'client' in options
      ? options.client
      : EventStoreDBClient.connectionString(options.connectionString);

  const eachBatch: EventStoreDBEventStoreMessagesBatchHandler<
    ConsumerEventType
  > = async (messagesBatch) => {
    const activeProcessors = processors.filter((s) => s.isActive);

    if (activeProcessors.length === 0)
      return {
        type: 'STOP',
        reason: 'No active processors',
      };

    const result = await Promise.allSettled(
      activeProcessors.map((s) => {
        // TODO: Add here filtering to only pass messages that can be handled by processor
        return s.handle(messagesBatch, { client });
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

  const subscription = (currentSubscription = eventStoreDBSubscription({
    client,
    from: options.from,
    eachBatch,
    batchSize:
      pulling?.batchSize ?? DefaultEventStoreDBEventStoreProcessorBatchSize,
    resilience: options.resilience,
  }));

  const stop = async () => {
    if (!isRunning) return;
    isRunning = false;
    if (currentSubscription) {
      await currentSubscription.stop();
      currentSubscription = undefined;
    }
    await start;
  };

  return {
    processors,
    get isRunning() {
      return isRunning;
    },
    processor: <EventType extends ConsumerEventType = ConsumerEventType>(
      options: EventStoreDBEventStoreProcessorOptions<EventType>,
    ): EventStoreDBEventStoreProcessor<EventType> => {
      const processor = eventStoreDBEventStoreProcessor<EventType>(options);

      processors.push(processor);

      return processor;
    },
    start: () => {
      if (isRunning) return start;

      start = (async () => {
        if (processors.length === 0)
          return Promise.reject(
            new EmmettError(
              'Cannot start consumer without at least a single processor',
            ),
          );

        isRunning = true;

        const startFrom = zipEventStoreDBEventStoreMessageBatchPullerStartFrom(
          await Promise.all(processors.map((o) => o.start(client))),
        );

        return subscription.start({ startFrom });
      })();

      return start;
    },
    stop,
    close: async () => {
      await stop();
    },
  };
};
