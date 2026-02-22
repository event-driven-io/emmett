import { dumbo, type Dumbo } from '@event-driven-io/dumbo';
import type { MessageProcessor } from '@event-driven-io/emmett';
import {
  EmmettError,
  type AnyEvent,
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
  postgreSQLProjector,
  postgreSQLReactor,
  type PostgreSQLProcessor,
  type PostgreSQLProjectorOptions,
  type PostgreSQLReactorOptions,
} from './postgreSQLProcessor';

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
  ConsumerMessageType extends AnyMessage = any,
> = MessageConsumer<ConsumerMessageType> &
  Readonly<{
    reactor: <MessageType extends AnyMessage = ConsumerMessageType>(
      options: PostgreSQLReactorOptions<MessageType>,
    ) => PostgreSQLProcessor<MessageType>;
  }> &
  (AnyEvent extends ConsumerMessageType
    ? Readonly<{
        projector: <
          EventType extends AnyEvent = ConsumerMessageType & AnyEvent,
        >(
          options: PostgreSQLProjectorOptions<EventType>,
        ) => PostgreSQLProcessor<EventType>;
      }>
    : object);

export const postgreSQLEventStoreConsumer = <
  ConsumerMessageType extends Message = AnyMessage,
>(
  options: PostgreSQLEventStoreConsumerOptions<ConsumerMessageType>,
): PostgreSQLEventStoreConsumer<ConsumerMessageType> => {
  let isRunning = false;
  let isInitialized = false;
  const { pulling } = options;
  const processors = options.processors ?? [];
  let abortController: AbortController | null = null;

  let start: Promise<void>;

  let messagePuller: PostgreSQLEventStoreMessageBatchPuller | undefined;

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
      activeProcessors.map(async (s) => {
        // TODO: Add here filtering to only pass messages that can be handled by processor
        return await s.handle(messagesBatch, {
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

  const processorContext = {
    execute: pool.execute,
    connection: {
      connectionString: options.connectionString,
      pool,
      client: undefined as never,
      transaction: undefined as never,
      messageStore: undefined as never,
    },
  };

  const stopProcessors = () =>
    Promise.all(processors.map((p) => p.close(processorContext)));

  const stop = async () => {
    if (!isRunning) return;
    isRunning = false;
    if (messagePuller) {
      abortController?.abort();
      await messagePuller.stop();
      messagePuller = undefined;
      abortController = null;
    }
    await start;

    await stopProcessors();
  };

  const init = async (): Promise<void> => {
    if (isInitialized) return;

    const postgresProcessors = processors as unknown as PostgreSQLProcessor[];

    for (const processor of postgresProcessors) {
      if (processor.init) {
        await processor.init(processorContext);
      }
    }

    isInitialized = true;
  };

  return {
    consumerId: options.consumerId ?? uuid(),
    get isRunning() {
      return isRunning;
    },
    processors,
    init,
    reactor: <MessageType extends AnyMessage = ConsumerMessageType>(
      options: PostgreSQLReactorOptions<MessageType>,
    ): PostgreSQLProcessor<MessageType> => {
      const processor = postgreSQLReactor(options);

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
    projector: <EventType extends AnyEvent = ConsumerMessageType & AnyEvent>(
      options: PostgreSQLProjectorOptions<EventType>,
    ): PostgreSQLProcessor<EventType> => {
      const processor = postgreSQLProjector(options);

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

      if (processors.length === 0)
        throw new EmmettError(
          'Cannot start consumer without at least a single processor',
        );

      isRunning = true;
      abortController = new AbortController();

      messagePuller = postgreSQLEventStoreMessageBatchPuller({
        stopWhen: options.stopWhen,
        executor: pool.execute,
        eachBatch,
        batchSize:
          pulling?.batchSize ?? DefaultPostgreSQLEventStoreProcessorBatchSize,
        pullingFrequencyInMs:
          pulling?.pullingFrequencyInMs ??
          DefaultPostgreSQLEventStoreProcessorPullingFrequencyInMs,
        signal: abortController.signal,
      });

      start = (async () => {
        if (!isRunning) return;

        if (!isInitialized) {
          await init();
        }

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

        await messagePuller.start({ startFrom });

        await stopProcessors();

        isRunning = false;
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
