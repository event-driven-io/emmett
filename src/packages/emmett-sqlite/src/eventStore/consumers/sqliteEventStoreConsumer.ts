import { dumbo, type Dumbo } from '@event-driven-io/dumbo';
import {
  asyncAwaiter,
  bigIntProcessorCheckpoint,
  ConsumerStartPositions,
  EmmettError,
  mergeObservabilityOptions,
  type AnyCommand,
  type AnyEvent,
  type AnyMessage,
  type AnyRecordedMessageMetadata,
  type AsyncAwaiter,
  type BatchRecordedMessageHandlerWithoutContext,
  type JSONSerializationOptions,
  type Message,
  type MessageConsumer,
  type MessageConsumerOptions,
  type MessageHandlerContext,
  type MessageProcessor,
  type ReadEventMetadataWithGlobalPosition,
  type WorkflowProcessorContext,
} from '@event-driven-io/emmett';
import { v7 as uuid } from 'uuid';
import type {
  AnyEventStoreDriver,
  InferOptionsFromEventStoreDriver,
} from '../eventStoreDriver';
import { readLastMessageGlobalPosition } from '../schema';
import { getSQLiteEventStore } from '../SQLiteEventStore';
import {
  DefaultSQLiteEventStoreProcessorBatchSize,
  DefaultSQLiteEventStoreProcessorPullingFrequencyInMs,
  sqliteEventStoreMessageBatchPuller,
  type SQLiteEventStoreMessageBatchPuller,
} from './messageBatchProcessing';
import {
  sqliteProjector,
  sqliteReactor,
  sqliteWorkflowProcessor,
  type SQLiteProcessor,
  type SQLiteProcessorHandlerContext,
  type SQLiteProjectorOptions,
  type SQLiteReactorOptions,
  type SQLiteWorkflowProcessorOptions,
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
} & InferOptionsFromEventStoreDriver<Driver> &
  JSONSerializationOptions;

export type SQLiteEventStoreConsumer<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends AnyMessage = any,
> = MessageConsumer<ConsumerMessageType> &
  Readonly<{
    reactor: <MessageType extends AnyMessage = ConsumerMessageType>(
      options: SQLiteReactorOptions<MessageType>,
    ) => SQLiteProcessor<MessageType>;

    workflowProcessor: <
      Input extends AnyEvent | AnyCommand,
      State,
      Output extends AnyEvent | AnyCommand,
      MetaDataType extends AnyRecordedMessageMetadata =
        AnyRecordedMessageMetadata,
      HandlerContext extends SQLiteProcessorHandlerContext &
        WorkflowProcessorContext = SQLiteProcessorHandlerContext &
        WorkflowProcessorContext,
      StoredMessage extends AnyEvent | AnyCommand = Output,
    >(
      options: Omit<
        SQLiteWorkflowProcessorOptions<
          Input,
          State,
          Output,
          MetaDataType,
          HandlerContext,
          StoredMessage
        >,
        'messageStore'
      >,
    ) => SQLiteProcessor<Input | Output>;
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

  const startedAwaiter: AsyncAwaiter<void> = asyncAwaiter<void>();

  const isOwnPool = !options.pool;
  const pool =
    options.pool ??
    dumbo({
      serialization: options.serialization,
      transactionOptions: {
        allowNestedTransactions: true,
        mode: 'session_based',
      },
      ...options.driver.mapToDumboOptions(options),
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
    }
    await start;

    messagePuller = undefined;
    abortController = null;

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
    whenStarted: (): Promise<void> => startedAwaiter.wait,
    processors,
    init,
    reactor: <MessageType extends AnyMessage = ConsumerMessageType>(
      processorOptions: SQLiteReactorOptions<MessageType>,
    ): SQLiteProcessor<MessageType> => {
      const processor = sqliteReactor(
        mergeObservabilityOptions(processorOptions, options.observability),
      );

      processors.push(
        // TODO: change that
        processor as unknown as MessageProcessor<
          ConsumerMessageType,
          AnyRecordedMessageMetadata,
          MessageHandlerContext
        >,
      );

      return processor;
    },
    projector: <EventType extends AnyEvent = ConsumerMessageType & AnyEvent>(
      processorOptions: SQLiteProjectorOptions<EventType>,
    ): SQLiteProcessor<EventType> => {
      const processor = sqliteProjector(
        mergeObservabilityOptions(processorOptions, options.observability),
      );

      processors.push(
        // TODO: change that
        processor as unknown as MessageProcessor<
          ConsumerMessageType,
          AnyRecordedMessageMetadata,
          MessageHandlerContext
        >,
      );

      return processor;
    },
    workflowProcessor: <
      Input extends AnyEvent | AnyCommand,
      State,
      Output extends AnyEvent | AnyCommand,
      MetaDataType extends AnyRecordedMessageMetadata =
        AnyRecordedMessageMetadata,
      HandlerContext extends SQLiteProcessorHandlerContext &
        WorkflowProcessorContext = SQLiteProcessorHandlerContext &
        WorkflowProcessorContext,
      StoredMessage extends AnyEvent | AnyCommand = Output,
    >(
      processorOptions: Omit<
        SQLiteWorkflowProcessorOptions<
          Input,
          State,
          Output,
          MetaDataType,
          HandlerContext,
          StoredMessage
        >,
        'messageStore'
      >,
    ): SQLiteProcessor<Input | Output> => {
      const messageStore = getSQLiteEventStore({
        ...options,
        pool,
        schema: { autoMigration: 'None' },
      });

      const processor = sqliteWorkflowProcessor(
        mergeObservabilityOptions(
          {
            ...processorOptions,
            messageStore,
          },
          options.observability,
        ),
      );

      processors.push(
        // TODO: change that
        processor as unknown as MessageProcessor<
          ConsumerMessageType,
          AnyRecordedMessageMetadata,
          MessageHandlerContext
        >,
      );

      return processor;
    },
    start: () => {
      if (isRunning) return start;

      startedAwaiter.reset();

      if (processors.length === 0) {
        const error = new EmmettError(
          'Cannot start consumer without at least a single processor',
        );
        startedAwaiter.reject(error);
        return Promise.reject(error);
      }

      isRunning = true;
      abortController = new AbortController();

      start = (async () => {
        if (!isRunning) return;

        let startPositions: ConsumerStartPositions = undefined!;

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
                const batch = startPositions.afterStartPosition(
                  s.id,
                  messagesBatch,
                );
                return await s.handle(batch, {
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

        try {
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

          if (!isInitialized) {
            await init();
          }

          startPositions = await pool.withConnection((connection) =>
            ConsumerStartPositions.resolve({
              processors,
              handlerContext: {
                execute: connection.execute,
                connection,
              },
              readLastMessageCheckpoint: async () => {
                const { currentGlobalPosition } =
                  await readLastMessageGlobalPosition(connection.execute);
                return currentGlobalPosition !== null
                  ? bigIntProcessorCheckpoint(currentGlobalPosition)
                  : null;
              },
            }),
          );

          await messagePuller.start({
            startFrom: startPositions.earliestPosition,
            started: startedAwaiter,
          });
        } catch (error) {
          isRunning = false;
          startedAwaiter.reject(error);
          throw error;
        } finally {
          await stopProcessors();
        }
      })();

      return start;
    },
    stop,
    close: async () => {
      await stop();
      if (isOwnPool) await pool.close();
    },
  };
};
