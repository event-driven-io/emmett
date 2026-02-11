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
import type {
  AnyEventStoreDriver,
  InferOptionsFromEventStoreDriver,
} from '../eventStoreDriver';
import {
  DefaultSQLiteEventStoreProcessorBatchSize,
  DefaultSQLiteEventStoreProcessorPullingFrequencyInMs,
  sqliteEventStoreMessageBatchPuller,
  zipSQLiteEventStoreMessageBatchPullerStartFrom,
  type SQLiteEventStoreMessageBatchPuller,
} from './messageBatchProcessing';
import {
  sqliteProjector,
  sqliteReactor,
  type SQLiteProcessor,
  type SQLiteProjectorOptions,
  type SQLiteReactorOptions,
} from './sqliteProcessor';

export type SQLiteEventStoreConsumerConfig<
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

export type SQLiteEventStoreConsumerOptions<
  ConsumerMessageType extends Message = Message,
  Driver extends AnyEventStoreDriver = AnyEventStoreDriver,
> = SQLiteEventStoreConsumerConfig<ConsumerMessageType> & {
  driver: Driver;
  pool?: Dumbo;
} & InferOptionsFromEventStoreDriver<Driver>;

export type SQLiteEventStoreConsumer<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends AnyMessage = any,
> = MessageConsumer<ConsumerMessageType> &
  Readonly<{
    reactor: <MessageType extends AnyMessage = ConsumerMessageType>(
      options: SQLiteReactorOptions<MessageType>,
    ) => SQLiteProcessor<MessageType>;
  }> &
  (AnyEvent extends ConsumerMessageType
    ? Readonly<{
        projector: <
          EventType extends AnyEvent = ConsumerMessageType & AnyEvent,
        >(
          options: SQLiteProjectorOptions<EventType>,
        ) => SQLiteProcessor<EventType>;
      }>
    : object);

export const sqliteEventStoreConsumer = <
  ConsumerMessageType extends Message = AnyMessage,
  Driver extends AnyEventStoreDriver = AnyEventStoreDriver,
>(
  options: SQLiteEventStoreConsumerOptions<ConsumerMessageType, Driver>,
): SQLiteEventStoreConsumer<ConsumerMessageType> => {
  let isRunning = false;
  let isInitialized = false;
  const { pulling } = options;
  const processors = options.processors ?? [];
  let abortController: AbortController | null = null;

  let start: Promise<void>;

  let messagePuller: SQLiteEventStoreMessageBatchPuller | undefined;

  const pool =
    options.pool ??
    dumbo({
      ...options.driver.mapToDumboOptions(options),
      transactionOptions: {
        allowNestedTransactions: true,
        mode: 'session_based',
      },
    });

  const eachBatch: BatchRecordedMessageHandlerWithoutContext<
    ConsumerMessageType,
    ReadEventMetadataWithGlobalPosition
  > = (messagesBatch) =>
    pool.withConnection(async (connection) => {
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
            connection,
            execute: connection.execute,
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
    });

  const processorContext = {
    execute: undefined,
    connection: undefined,
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

    const sqliteProcessors = processors as unknown as SQLiteProcessor[];

    await pool.withConnection(async (connection) => {
      for (const processor of sqliteProcessors) {
        if (processor.init) {
          await processor.init({
            ...processorContext,
            connection,
            execute: connection.execute,
          });
        }
      }
    });
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
      options: SQLiteReactorOptions<MessageType>,
    ): SQLiteProcessor<MessageType> => {
      const processor = sqliteReactor(options);

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
      options: SQLiteProjectorOptions<EventType>,
    ): SQLiteProcessor<EventType> => {
      const processor = sqliteProjector(options);

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

      messagePuller = sqliteEventStoreMessageBatchPuller({
        stopWhen: options.stopWhen,
        executor: pool.execute,
        eachBatch,
        batchSize:
          pulling?.batchSize ?? DefaultSQLiteEventStoreProcessorBatchSize,
        pullingFrequencyInMs:
          pulling?.pullingFrequencyInMs ??
          DefaultSQLiteEventStoreProcessorPullingFrequencyInMs,
        signal: abortController.signal,
      });

      start = (async () => {
        if (!isRunning) return;

        if (!isInitialized) {
          await init();
        }

        const startFrom = await pool.withConnection(async (connection) =>
          zipSQLiteEventStoreMessageBatchPullerStartFrom(
            await Promise.all(
              processors.map(async (o) => {
                const result = await o.start({
                  execute: connection.execute,
                  connection,
                });

                return result;
              }),
            ),
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
