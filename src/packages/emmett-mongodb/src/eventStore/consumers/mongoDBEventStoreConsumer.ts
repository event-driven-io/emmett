import {
  EmmettError,
  MessageProcessor,
  type AnyEvent,
  type AnyMessage,
  type AnyRecordedMessageMetadata,
  type AsyncRetryOptions,
  type BatchRecordedMessageHandlerWithoutContext,
  type DefaultRecord,
  type Message,
  type MessageConsumer,
  type MessageConsumerOptions,
  type RecordedMessageMetadataWithGlobalPosition,
} from '@event-driven-io/emmett';
import { MongoClient, type MongoClientOptions } from 'mongodb';
import { v4 as uuid } from 'uuid';
import {
  changeStreamReactor,
  mongoDBProjector,
  type MongoDBProcessor,
  type MongoDBProcessorOptions,
  type MongoDBProjectorOptions,
} from './mongoDBProcessor';
import {
  mongoDBSubscription,
  zipMongoDBMessageBatchPullerStartFrom,
  type MongoDBSubscription,
} from './subscriptions';
import type { MongoDBCheckpoint } from './subscriptions/mongoDBCheckpoint';

export type MongoDBChangeStreamMessageMetadata =
  RecordedMessageMetadataWithGlobalPosition<MongoDBCheckpoint>;

export type MongoDBEventStoreConsumerConfig<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends Message = any,
> = MessageConsumerOptions<ConsumerMessageType> & {
  resilience?: {
    resubscribeOptions?: AsyncRetryOptions;
  };
};

export type MongoDBConsumerOptions<
  ConsumerMessageType extends Message = Message,
> = MongoDBEventStoreConsumerConfig<ConsumerMessageType> &
  (
    | {
        connectionString: string;
        clientOptions?: MongoClientOptions;
        client?: never;
      }
    | {
        client: MongoClient;
        connectionString?: never;
        clientOptions?: never;
      }
  );

export type MongoDBEventStoreConsumer<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends AnyMessage = any,
> = MessageConsumer<ConsumerMessageType> &
  Readonly<{
    reactor: <MessageType extends AnyMessage = ConsumerMessageType>(
      options: MongoDBProcessorOptions<MessageType>,
    ) => MongoDBProcessor<MessageType>;
  }> &
  (AnyEvent extends ConsumerMessageType
    ? Readonly<{
        projector: <
          EventType extends AnyEvent = ConsumerMessageType & AnyEvent,
        >(
          options: MongoDBProjectorOptions<EventType>,
        ) => MongoDBProcessor<EventType>;
      }>
    : object);

export type MongoDBConsumerHandlerContext = {
  client?: MongoClient;
};

/**
 * Creates a MongoDB event store consumer that processes messages from a MongoDB change stream.
 *
 * This consumer implementation requires change streams to be enabled on the MongoDB collection
 * and cannot be used in single-instance environments. It allows for the registration of message
 * processors and projectors to handle incoming messages.
 *
 * @template ConsumerMessageType - The type of messages consumed.
 * @template MessageMetadataType - The type of metadata associated with the messages.
 * @template HandlerContext - The context type for the message handlers.
 * @template CheckpointType - The type used for resuming from checkpoints.
 *
 * @param options - The options for configuring the MongoDB consumer.
 * @returns A MongoDBEventStoreConsumer instance that can start and stop processing messages.
 */
export const mongoDBEventStoreConsumer = <
  ConsumerMessageType extends Message = AnyMessage,
>(
  options: MongoDBConsumerOptions<ConsumerMessageType>,
): MongoDBEventStoreConsumer<ConsumerMessageType> => {
  let start: Promise<void>;
  let stream: MongoDBSubscription | undefined;
  let isRunning = false;
  const client =
    'client' in options && options.client
      ? options.client
      : new MongoClient(options.connectionString, options.clientOptions);
  const processors = options.processors ?? [];

  const eachBatch: BatchRecordedMessageHandlerWithoutContext<
    ConsumerMessageType,
    MongoDBChangeStreamMessageMetadata
  > = async (messagesBatch) => {
    const activeProcessors = processors.filter((s) => s.isActive);

    if (activeProcessors.length === 0)
      return {
        type: 'STOP',
        reason: 'No active processors',
      };

    const result = await Promise.allSettled(
      activeProcessors.map(async (s) => {
        // TODO: Add here filtering to only pass messages that can be handled by
        return await s.handle(messagesBatch, { client });
      }),
    );

    const error = result.find((r) => r.status === 'rejected')?.reason as
      | Error
      | undefined;

    return result.some(
      (r) => r.status === 'fulfilled' && r.value?.type !== 'STOP',
    )
      ? undefined
      : {
          type: 'STOP',
          error: error ? EmmettError.mapFrom(error) : undefined,
        };
  };

  const stop = async () => {
    if (!isRunning) return;

    if (stream?.isRunning === true) await stream.stop();

    isRunning = false;
  };

  return {
    consumerId: options.consumerId ?? uuid(),
    get isRunning() {
      return isRunning;
    },
    processors,
    reactor: <MessageType extends AnyMessage = ConsumerMessageType>(
      options: MongoDBProcessorOptions<MessageType>,
    ): MongoDBProcessor<MessageType> => {
      const processor = changeStreamReactor(options);

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
      options: MongoDBProjectorOptions<EventType>,
    ): MongoDBProcessor<EventType> => {
      const processor = mongoDBProjector(options);

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

        const positions = await Promise.all(
          processors.map((o) => o.start({ client })),
        );
        const startFrom = zipMongoDBMessageBatchPullerStartFrom(positions);

        stream = mongoDBSubscription<ConsumerMessageType>({
          client,
          from: startFrom,
          eachBatch,
        });

        await stream.start({
          startFrom,
        });
      })();

      return start;
    },
    stop,
    close: async () => {
      try {
        await stop();
      } finally {
        if (!options.client) await client.close();
      }
    },
  };
};
