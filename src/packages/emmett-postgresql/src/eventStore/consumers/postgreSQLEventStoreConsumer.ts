import { dumbo, JSONSerializer, type Dumbo } from '@event-driven-io/dumbo';
import type {
  AnyCommand,
  JSONSerializationOptions,
  MessageProcessor,
  WorkflowProcessorContext,
} from '@event-driven-io/emmett';
import {
  asyncAwaiter,
  EmmettError,
  type AnyEvent,
  type AnyMessage,
  type AnyRecordedMessageMetadata,
  type AsyncAwaiter,
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
  postgreSQLWorkflowProcessor,
  type PostgreSQLProcessor,
  type PostgreSQLProcessorHandlerContext,
  type PostgreSQLProjectorOptions,
  type PostgreSQLReactorOptions,
  type PostgreSQLWorkflowProcessorOptions,
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
} & JSONSerializationOptions;

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

    workflowProcessor: <
      Input extends AnyEvent | AnyCommand,
      State,
      Output extends AnyEvent | AnyCommand,
      MetaDataType extends AnyRecordedMessageMetadata =
        AnyRecordedMessageMetadata,
      HandlerContext extends PostgreSQLProcessorHandlerContext &
        WorkflowProcessorContext = PostgreSQLProcessorHandlerContext &
        WorkflowProcessorContext,
      StoredMessage extends AnyEvent | AnyCommand = Output,
    >(
      options: PostgreSQLWorkflowProcessorOptions<
        Input,
        State,
        Output,
        MetaDataType,
        HandlerContext,
        StoredMessage
      >,
    ) => PostgreSQLProcessor<Input | Output>;
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

  const startedAwaiter: AsyncAwaiter<void> = asyncAwaiter<void>();

  const isOwnPool = !options.pool;
  const pool = options.pool
    ? options.pool
    : dumbo({
        connectionString: options.connectionString,
        serialization: options.serialization,
      });

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
        try {
          // TODO: Add here filtering to only pass messages that can be handled by processor
          return await s.handle(messagesBatch, {
            connection: {
              connectionString: options.connectionString,
              pool,
            },
          });
        } catch (error) {
          console.log(
            `Error during message batch processing for processor: ${s.id}`,
            error,
          );
          throw error;
        }
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
    }
    try {
      await start;
    } catch (error) {
      console.log('Error during consumer stop:', error);
    }

    messagePuller = undefined;
    abortController = null;

    await stopProcessors();
  };

  const init = async (): Promise<void> => {
    if (isInitialized) return;

    const postgresProcessors = processors as unknown as PostgreSQLProcessor[];

    for (const processor of postgresProcessors) {
      if (processor.init) {
        try {
          await processor.init(processorContext);
        } catch (error) {
          console.log(
            `Error during processor initialization for processor: ${processor.id}. Stopping it.`,
            error,
          );
          await processor.close(processorContext).catch((closeError) => {
            console.log(
              `Error during processor cleanup after failed initialization for processor: ${processor.id}`,
              closeError,
            );
          });
          console.log(
            `Processor ${processor.id} stopped successfully after failed initialization.`,
          );
          throw error;
        }
      }
    }

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
    workflowProcessor: <
      Input extends AnyEvent | AnyCommand,
      State,
      Output extends AnyEvent | AnyCommand,
      MetaDataType extends AnyRecordedMessageMetadata =
        AnyRecordedMessageMetadata,
      HandlerContext extends PostgreSQLProcessorHandlerContext &
        WorkflowProcessorContext = PostgreSQLProcessorHandlerContext &
        WorkflowProcessorContext,
      StoredMessage extends AnyEvent | AnyCommand = Output,
    >(
      options: PostgreSQLWorkflowProcessorOptions<
        Input,
        State,
        Output,
        MetaDataType,
        HandlerContext,
        StoredMessage
      >,
    ): PostgreSQLProcessor<Input | Output> => {
      const processor = postgreSQLWorkflowProcessor(options);

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
      if (isRunning) {
        console.log(
          'Consumer is already running. Returning the existing start promise.',
        );
        return start;
      }

      startedAwaiter.reset();

      if (processors.length === 0) {
        console.log(
          'Cannot start consumer without at least a single processor',
        );
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

        try {
          messagePuller = postgreSQLEventStoreMessageBatchPuller({
            stopWhen: options.stopWhen,
            executor: pool.execute,
            eachBatch,
            batchSize:
              pulling?.batchSize ??
              DefaultPostgreSQLEventStoreProcessorBatchSize,
            pullingFrequencyInMs:
              pulling?.pullingFrequencyInMs ??
              DefaultPostgreSQLEventStoreProcessorPullingFrequencyInMs,
            signal: abortController.signal,
          });

          if (!isInitialized) {
            console.log(
              'Initializing consumer before starting message pulling.',
            );
            await init();
          }

          const startFrom = zipPostgreSQLEventStoreMessageBatchPullerStartFrom(
            await Promise.all(
              processors.map(async (o) => {
                try {
                  const result = await o.start({
                    execute: pool.execute,
                    connection: {
                      connectionString: options.connectionString,
                      pool,
                    },
                  });

                  return result;
                } catch (error) {
                  console.log(
                    `Error during processor start position retrieval for processor: ${o.id}. Stopping it.`,
                    error,
                  );
                  throw error;
                }
              }),
            ),
          );

          console.log(
            `Starting message pulling with start position: ${JSONSerializer.serialize(
              startFrom,
            )}. Waiting for messages...`,
          );

          await messagePuller.start({
            startFrom,
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
