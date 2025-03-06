import { dumbo, type Dumbo, type SQLExecutor } from '@event-driven-io/dumbo';
import {
  EmmettError,
  MessageProcessor,
  type AnyMessage,
  type BatchRecordedMessageHandlerWithoutContext,
  type DefaultRecord,
  type Message,
  type ReadEventMetadataWithGlobalPosition,
} from '@event-driven-io/emmett';
import {
  DefaultPostgreSQLEventStoreProcessorBatchSize,
  DefaultPostgreSQLEventStoreProcessorPullingFrequencyInMs,
  postgreSQLEventStoreMessageBatchPuller,
  zipPostgreSQLEventStoreMessageBatchPullerStartFrom,
  type PostgreSQLEventStoreMessageBatchPuller,
} from './messageBatchProcessing';
import {
  postgreSQLProcessor,
  type PostgreSQLProcessor,
  type PostgreSQLProcessorOptions,
} from './postgreSQLProcessor';

export type PostgreSQLConsumerContext = {
  execute: SQLExecutor;
  connection: {
    connectionString: string;
    pool: Dumbo;
  };
};

export type ExtendableContext = Partial<PostgreSQLConsumerContext> &
  DefaultRecord;

export type PostgreSQLEventStoreConsumerConfig<
  ConsumerMessageType extends Message = Message,
> = {
  processors?: Array<
    MessageProcessor<
      ConsumerMessageType,
      ReadEventMetadataWithGlobalPosition,
      ExtendableContext
    >
  >;
  pulling?: {
    batchSize?: number;
    pullingFrequencyInMs?: number;
  };
};
export type PostgreSQLEventStoreConsumerOptions<
  ConsumerMessageType extends Message = Message,
> = PostgreSQLEventStoreConsumerConfig<ConsumerMessageType> & {
  connectionString: string;
  pool?: Dumbo;
};

export type PostgreSQLEventStoreConsumer<
  ConsumerMessageType extends Message = Message,
> = Readonly<{
  isRunning: boolean;
  processors: PostgreSQLProcessor<ConsumerMessageType>[];
  processor: <MessageType extends Message = ConsumerMessageType>(
    options: PostgreSQLProcessorOptions<MessageType>,
  ) => PostgreSQLProcessor<MessageType>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  close: () => Promise<void>;
}>;

export const postgreSQLEventStoreConsumer = <
  ConsumerMessageType extends Message = AnyMessage,
>(
  options: PostgreSQLEventStoreConsumerOptions<ConsumerMessageType>,
): PostgreSQLEventStoreConsumer<ConsumerMessageType> => {
  let isRunning = false;
  const { pulling } = options;
  const processors = options.processors ?? [];

  let start: Promise<void>;

  let currentMessagePuller: PostgreSQLEventStoreMessageBatchPuller | undefined;

  const pool = options.pool
    ? options.pool
    : dumbo({ connectionString: options.connectionString });

  const eachBatch: BatchRecordedMessageHandlerWithoutContext<
    ConsumerMessageType,
    ReadEventMetadataWithGlobalPosition
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
          connection: {
            connectionString: options.connectionString,
            pool,
          },
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
    processor: <MessageType extends Message = ConsumerMessageType>(
      options: PostgreSQLProcessorOptions<MessageType>,
    ): PostgreSQLProcessor<MessageType> => {
      const processor = postgreSQLProcessor(options);

      processors.push(
        // TODO: change that
        processor as unknown as PostgreSQLProcessor<ConsumerMessageType>,
      );

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
          await Promise.all(
            processors.map((o) =>
              o.start({
                execute: pool.execute,
                connection: {
                  connectionString: options.connectionString,
                  pool,
                },
              }),
            ),
          ),
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
