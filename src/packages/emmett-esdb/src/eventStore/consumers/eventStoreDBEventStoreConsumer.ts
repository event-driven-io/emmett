import { EmmettError, type Event } from '@event-driven-io/emmett';
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
  type EventStoreDBEventStoreMessageBatchPuller,
  type EventStoreDBEventStoreMessagesBatchHandler,
} from './subscriptions';

export type EventStoreDBEventStoreConsumerOptions = {
  connectionString: string;
  from?: EventStoreDBEventStoreConsumerType;
  processors?: EventStoreDBEventStoreProcessor[];
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
  processors: EventStoreDBEventStoreProcessor[];
  processor: <EventType extends Event = Event>(
    options: EventStoreDBEventStoreProcessorOptions<EventType>,
  ) => EventStoreDBEventStoreProcessor<EventType>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  close: () => Promise<void>;
}>;

export const eventStoreDBEventStoreConsumer = (
  options: EventStoreDBEventStoreConsumerOptions,
): EventStoreDBEventStoreConsumer => {
  let isRunning = false;
  const { connectionString, pulling } = options;
  const processors = options.processors ?? [];

  let start: Promise<void>;

  let currentMessagePooler:
    | EventStoreDBEventStoreMessageBatchPuller
    | undefined;

  const eventStoreDBClient =
    EventStoreDBClient.connectionString(connectionString);

  const eachBatch: EventStoreDBEventStoreMessagesBatchHandler = async (
    messagesBatch,
  ) => {
    const activeProcessors = processors.filter((s) => s.isActive);

    if (activeProcessors.length === 0)
      return {
        type: 'STOP',
        reason: 'No active processors',
      };

    const result = await Promise.allSettled(
      activeProcessors.map((s) => {
        // TODO: Add here filtering to only pass messages that can be handled by processor
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

  const messagePuller = (currentMessagePooler = eventStoreDBSubscription({
    eventStoreDBClient,
    eachBatch,
    batchSize:
      pulling?.batchSize ?? DefaultEventStoreDBEventStoreProcessorBatchSize,
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
    processors,
    get isRunning() {
      return isRunning;
    },
    processor: <EventType extends Event = Event>(
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
          await Promise.all(processors.map((o) => o.start(eventStoreDBClient))),
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
