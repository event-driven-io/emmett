import { EmmettError, type Event } from '@event-driven-io/emmett';
import { sqliteConnection, type SQLiteConnection } from '../../connection';
import {
  DefaultSQLiteEventStoreProcessorBatchSize,
  DefaultSQLiteEventStoreProcessorPullingFrequencyInMs,
  sqliteEventStoreMessageBatchPuller,
  zipSQLiteEventStoreMessageBatchPullerStartFrom,
  type SQLiteEventStoreMessageBatchPuller,
  type SQLiteEventStoreMessagesBatchHandler,
} from './messageBatchProcessing';
import {
  sqliteProcessor,
  type SQLiteProcessor,
  type SQLiteProcessorOptions,
} from './sqliteProcessor';

export type SQLiteEventStoreConsumerConfig<
  ConsumerEventType extends Event = Event,
> = {
  processors?: SQLiteProcessor<ConsumerEventType>[];
  pulling?: {
    batchSize?: number;
    pullingFrequencyInMs?: number;
  };
};
export type SQLiteEventStoreConsumerOptions<
  ConsumerEventType extends Event = Event,
> = SQLiteEventStoreConsumerConfig<ConsumerEventType> & {
  fileName: string;
  connection?: SQLiteConnection;
};

export type SQLiteEventStoreConsumer<ConsumerEventType extends Event = Event> =
  Readonly<{
    isRunning: boolean;
    processors: SQLiteProcessor<ConsumerEventType>[];
    processor: <EventType extends ConsumerEventType = ConsumerEventType>(
      options: SQLiteProcessorOptions<EventType>,
    ) => SQLiteProcessor<EventType>;
    start: () => Promise<void>;
    stop: () => Promise<void>;
    close: () => Promise<void>;
  }>;

export const sqliteEventStoreConsumer = <
  ConsumerEventType extends Event = Event,
>(
  options: SQLiteEventStoreConsumerOptions<ConsumerEventType>,
): SQLiteEventStoreConsumer<ConsumerEventType> => {
  let isRunning = false;
  const { pulling } = options;
  const processors = options.processors ?? [];

  let start: Promise<void>;

  let currentMessagePuller: SQLiteEventStoreMessageBatchPuller | undefined;

  const connection =
    options.connection ?? sqliteConnection({ fileName: options.fileName });

  const eachBatch: SQLiteEventStoreMessagesBatchHandler<
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
          connection,
          fileName: options.fileName,
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
    sqliteEventStoreMessageBatchPuller({
      connection,
      eachBatch,
      batchSize:
        pulling?.batchSize ?? DefaultSQLiteEventStoreProcessorBatchSize,
      pullingFrequencyInMs:
        pulling?.pullingFrequencyInMs ??
        DefaultSQLiteEventStoreProcessorPullingFrequencyInMs,
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
      options: SQLiteProcessorOptions<EventType>,
    ): SQLiteProcessor<EventType> => {
      const processor = sqliteProcessor<EventType>(options);

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

        const startFrom = zipSQLiteEventStoreMessageBatchPullerStartFrom(
          await Promise.all(processors.map((o) => o.start(connection))),
        );

        return messagePooler.start({ startFrom });
      })();

      return start;
    },
    stop,
    close: async () => {
      await stop();

      connection.close();

      await new Promise((resolve) => setTimeout(resolve, 250));
    },
  };
};
