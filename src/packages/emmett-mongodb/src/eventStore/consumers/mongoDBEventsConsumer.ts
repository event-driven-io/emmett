import {
  EmmettError,
  MessageProcessor,
  type AnyEvent,
  type AnyMessage,
  type AsyncRetryOptions,
  type DefaultRecord,
  type GlobalPositionTypeOfRecordedMessageMetadata,
  type Message,
  type MessageConsumer,
  type RecordedMessage,
  type RecordedMessageMetadataWithGlobalPosition,
} from '@event-driven-io/emmett';
import { MongoClient, type MongoClientOptions } from 'mongodb';
import { v4 as uuid } from 'uuid';
import { CancellationPromise } from './CancellablePromise';
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
import type { MongoDBResumeToken } from './subscriptions/mongoDbResumeToken';

export type MongoDBChangeStreamMessageMetadata =
  RecordedMessageMetadataWithGlobalPosition<MongoDBResumeToken['_data']>;

export type MessageConsumerOptions<
  MessageType extends Message = AnyMessage,
  MessageMetadataType extends
    MongoDBChangeStreamMessageMetadata = MongoDBChangeStreamMessageMetadata,
  HandlerContext extends DefaultRecord | undefined = undefined,
  CheckpointType = GlobalPositionTypeOfRecordedMessageMetadata<MessageMetadataType>,
> = {
  consumerId?: string;

  processors?: MessageProcessor<
    MessageType,
    MessageMetadataType,
    HandlerContext,
    CheckpointType
  >[];
};

export type MongoDBEventStoreConsumerConfig<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends Message = any,
  MessageMetadataType extends
    MongoDBChangeStreamMessageMetadata = MongoDBChangeStreamMessageMetadata,
  HandlerContext extends DefaultRecord | undefined = undefined,
  CheckpointType = GlobalPositionTypeOfRecordedMessageMetadata<MessageMetadataType>,
> = MessageConsumerOptions<
  ConsumerMessageType,
  MessageMetadataType,
  HandlerContext,
  CheckpointType
> & {
  resilience?: {
    resubscribeOptions?: AsyncRetryOptions;
  };
};

export type MongoDBConsumerOptions<
  ConsumerEventType extends Message = Message,
  MessageMetadataType extends
    MongoDBChangeStreamMessageMetadata = MongoDBChangeStreamMessageMetadata,
  HandlerContext extends DefaultRecord | undefined = undefined,
  CheckpointType = GlobalPositionTypeOfRecordedMessageMetadata<MessageMetadataType>,
> = MongoDBEventStoreConsumerConfig<
  ConsumerEventType,
  MessageMetadataType,
  HandlerContext,
  CheckpointType
> &
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
  MessageMetadataType extends
    MongoDBChangeStreamMessageMetadata = MongoDBChangeStreamMessageMetadata,
  HandlerContext extends
    MongoDBConsumerHandlerContext = MongoDBConsumerHandlerContext,
  CheckpointType = MongoDBResumeToken,
>(
  options: MongoDBConsumerOptions<
    ConsumerMessageType,
    MessageMetadataType,
    HandlerContext,
    CheckpointType
  >,
): MongoDBEventStoreConsumer<ConsumerMessageType> => {
  let start: Promise<void>;
  let stream: MongoDBSubscription<CheckpointType> | undefined;
  let isRunning = false;
  let runningPromise = new CancellationPromise<null>();
  const client =
    'client' in options && options.client
      ? options.client
      : new MongoClient(options.connectionString, options.clientOptions);
  const processors = options.processors ?? [];

  const stop = async () => {
    if (stream?.isRunning !== true) return;
    await stream.stop();
    isRunning = false;
    runningPromise.resolve(null);
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
        processor as unknown as MessageProcessor<
          ConsumerMessageType,
          MessageMetadataType,
          HandlerContext,
          CheckpointType
        >,
      );

      return processor;
    },
    projector: <EventType extends AnyEvent = ConsumerMessageType & AnyEvent>(
      options: MongoDBProjectorOptions<EventType>,
    ): MongoDBProcessor<EventType> => {
      const processor = mongoDBProjector(options);

      processors.push(
        processor as unknown as MessageProcessor<
          ConsumerMessageType,
          MessageMetadataType,
          HandlerContext,
          CheckpointType
        >,
      );

      return processor;
    },
    start: () => {
      start = (async () => {
        if (processors.length === 0)
          return Promise.reject(
            new EmmettError(
              'Cannot start consumer without at least a single processor',
            ),
          );

        isRunning = true;

        runningPromise = new CancellationPromise<null>();

        const positions = await Promise.all(
          processors.map((o) => o.start({ client } as Partial<HandlerContext>)),
        );
        const startFrom =
          zipMongoDBMessageBatchPullerStartFrom<CheckpointType>(positions);

        stream = mongoDBSubscription<
          ConsumerMessageType,
          MessageMetadataType,
          CheckpointType
        >({
          client,
          from: startFrom,
          eachBatch: async (
            messages: RecordedMessage<
              ConsumerMessageType,
              MessageMetadataType
            >[],
          ) => {
            for (const processor of processors.filter(
              ({ isActive }) => isActive,
            )) {
              await processor.handle(messages, {
                client,
              } as Partial<HandlerContext>);
            }
          },
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
