import { dumbo, type Dumbo, type SQLExecutor } from '@event-driven-io/dumbo';
import {
  EmmettError,
  MessageProcessor,
  type AnyMessage,
  type AnyRecordedMessageMetadata,
  type BatchRecordedMessageHandlerWithoutContext,
  type DefaultRecord,
  type Message,
  type MessageConsumer,
  type MessageConsumerOptions,
  type ReadEventMetadataWithGlobalPosition,
} from '@event-driven-io/emmett';
import { v7 as uuid } from 'uuid';
import {
  DefaultPostgreSQLEventStoreProcessorBatchSize,
  DefaultPostgreSQLEventStoreProcessorPullingFrequencyInMs,
  postgreSQLEventStoreMessageBatchPuller,
  zipPostgreSQLEventStoreMessageBatchPullerStartFrom,
  type PostgreSQLEventStoreMessageBatchPuller,
} from './messageBatchProcessing';
import {
  postgreSQLMessageProcessor,
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends Message = any,
> = MessageConsumerOptions<ConsumerMessageType> & {
  stopWhen?: {
    noMessagesLeft?: boolean;
  };
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends Message = any,
> = MessageConsumer<ConsumerMessageType> &
  Readonly<{
    processor: <MessageType extends Message = ConsumerMessageType>(
      options: PostgreSQLProcessorOptions<MessageType>,
    ) => PostgreSQLProcessor<MessageType>;
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
      stopWhen: options.stopWhen,
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

    await Promise.all(processors.map((p) => p.close()));
  };

  return {
    consumerId: options.consumerId ?? uuid(),
    get isRunning() {
      return isRunning;
    },
    processors,
    processor: <MessageType extends Message = ConsumerMessageType>(
      options: PostgreSQLProcessorOptions<MessageType>,
    ): PostgreSQLProcessor<MessageType> => {
      const processor = postgreSQLMessageProcessor(options);

      processors.push(
        // TODO: change that
        processor as unknown as MessageProcessor<
          ConsumerMessageType,
          AnyRecordedMessageMetadata,
          DefaultRecord
        >,
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
            processors.map(async (o) => {
              const result = await o.start({
                execute: pool.execute,
                connection: {
                  connectionString: options.connectionString,
                  pool,
                },
              });

              return result;
            }),
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
