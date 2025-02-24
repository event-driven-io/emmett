import { dumbo, type Dumbo } from '@event-driven-io/dumbo';
import { EmmettError, type Event } from '@event-driven-io/emmett';
import {
  DefaultPostgreSQLEventStoreProcessorBatchSize,
  DefaultPostgreSQLEventStoreProcessorPullingFrequencyInMs,
  postgreSQLEventStoreMessageBatchPuller,
  zipPostgreSQLEventStoreMessageBatchPullerStartFrom,
  type PostgreSQLEventStoreMessageBatchPuller,
  type PostgreSQLEventStoreMessagesBatchHandler,
} from './messageBatchProcessing';
import {
  postgreSQLProcessor,
  type PostgreSQLProcessor,
  type PostgreSQLProcessorOptions,
} from './postgreSQLProcessor';

export type PostgreSQLEventStoreConsumerConfig<
  ConsumerEventType extends Event = Event,
> = {
  processors?: PostgreSQLProcessor<ConsumerEventType>[];
  pulling?: {
    batchSize?: number;
    pullingFrequencyInMs?: number;
  };
};
export type PostgreSQLEventStoreConsumerOptions<
  ConsumerEventType extends Event = Event,
> = PostgreSQLEventStoreConsumerConfig<ConsumerEventType> & {
  connectionString: string;
  pool?: Dumbo;
};

export type PostgreSQLEventStoreConsumer<
  ConsumerEventType extends Event = Event,
> = Readonly<{
  isRunning: boolean;
  processors: PostgreSQLProcessor<ConsumerEventType>[];
  processor: <EventType extends ConsumerEventType = ConsumerEventType>(
    options: PostgreSQLProcessorOptions<EventType>,
  ) => PostgreSQLProcessor<EventType>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  close: () => Promise<void>;
}>;

export const postgreSQLEventStoreConsumer = <
  ConsumerEventType extends Event = Event,
>(
  options: PostgreSQLEventStoreConsumerOptions<ConsumerEventType>,
): PostgreSQLEventStoreConsumer<ConsumerEventType> => {
  let isRunning = false;
  const { pulling } = options;
  const processors = options.processors ?? [];

  let start: Promise<void>;

  let currentMessagePuller: PostgreSQLEventStoreMessageBatchPuller | undefined;

  const pool = options.pool
    ? options.pool
    : dumbo({ connectionString: options.connectionString });

  const eachBatch: PostgreSQLEventStoreMessagesBatchHandler<
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
        return s.handle(messagesBatch, {
          pool,
          connectionString: options.connectionString,
        });
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

  const messagePooler = (currentMessagePuller =
    postgreSQLEventStoreMessageBatchPuller({
      executor: pool.execute,
      eachBatch,
      batchSize:
        pulling?.batchSize ?? DefaultPostgreSQLEventStoreProcessorBatchSize,
      pullingFrequencyInMs:
        pulling?.pullingFrequencyInMs ??
        DefaultPostgreSQLEventStoreProcessorPullingFrequencyInMs,
    }));

  const stop = async () => {
    if (!isRunning) return;
    isRunning = false;
    if (currentMessagePuller) {
      await currentMessagePuller.stop();
      currentMessagePuller = undefined;
    }
    await start;
  };

  return {
    processors,
    get isRunning() {
      return isRunning;
    },
    processor: <EventType extends ConsumerEventType = ConsumerEventType>(
      options: PostgreSQLProcessorOptions<EventType>,
    ): PostgreSQLProcessor<EventType> => {
      const processor = postgreSQLProcessor<EventType>(options);

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

        const startFrom = zipPostgreSQLEventStoreMessageBatchPullerStartFrom(
          await Promise.all(processors.map((o) => o.start(pool.execute))),
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
