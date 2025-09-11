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
} from '@event-driven-io/emmett';
import { MongoClient, type MongoClientOptions } from 'mongodb';
import { v4 as uuid } from 'uuid';
import type { MongoDBRecordedMessageMetadata } from '../event';
import type { MongoDBReadEventMetadata } from '../mongoDBEventStore';
import { CancellationPromise } from './CancellablePromise';
import {
  changeStreamReactor,
  mongoDBProjector,
  type MongoDBProcessor,
  type MongoDBProcessorOptions,
  type MongoDBProjectorOptions,
} from './mongoDBProcessor';
import {
  generateVersionPolicies,
  mongoDBSubscription,
  zipMongoDBMessageBatchPullerStartFrom,
  type ChangeStreamFullDocumentValuePolicy,
  type MongoDBSubscription,
} from './subscriptions';
import type { MongoDBResumeToken } from './subscriptions/types';

export type MessageConsumerOptions<
  MessageType extends Message = AnyMessage,
  MessageMetadataType extends
    MongoDBReadEventMetadata = MongoDBRecordedMessageMetadata,
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
    MongoDBReadEventMetadata = MongoDBRecordedMessageMetadata,
  HandlerContext extends DefaultRecord | undefined = undefined,
  CheckpointType = GlobalPositionTypeOfRecordedMessageMetadata<MessageMetadataType>,
> = MessageConsumerOptions<
  ConsumerMessageType,
  MessageMetadataType,
  HandlerContext,
  CheckpointType
> & {
  // from?: any;
  pulling?: {
    batchSize?: number;
  };
  resilience?: {
    resubscribeOptions?: AsyncRetryOptions;
  };
  changeStreamFullDocumentPolicy: ChangeStreamFullDocumentValuePolicy;
};

export type MongoDBConsumerOptions<
  ConsumerEventType extends Message = Message,
  MessageMetadataType extends
    MongoDBReadEventMetadata = MongoDBRecordedMessageMetadata,
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

export const mongoDBMessagesConsumer = <
  ConsumerMessageType extends Message = AnyMessage,
  MessageMetadataType extends
    MongoDBReadEventMetadata = MongoDBRecordedMessageMetadata,
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
  let stream: MongoDBSubscription<CheckpointType>;
  let isRunning = false;
  let runningPromise = new CancellationPromise<null>();
  const client =
    'client' in options && options.client
      ? options.client
      : new MongoClient(options.connectionString, options.clientOptions);
  const processors = options.processors ?? [];

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

        // TODO: Remember to fix.
        const policy = (await generateVersionPolicies(options.client?.db()!))
          .changeStreamFullDocumentValuePolicy;

        await stream.start({
          getFullDocumentValue: policy,
          startFrom,
        });
      })();

      return start;
    },
    stop: async () => {
      if (stream.isRunning) {
        await stream.stop();
        isRunning = false;
        runningPromise.resolve(null);
      }
    },
    close: async () => {
      if (stream.isRunning) {
        await stream.stop();
        isRunning = false;
        runningPromise.resolve(null);
      }
    },
  };
};

export const mongoDBChangeStreamMessagesConsumer = <
  ConsumerMessageType extends Message = AnyMessage,
  MessageMetadataType extends
    MongoDBReadEventMetadata = MongoDBRecordedMessageMetadata,
  HandlerContext extends
    MongoDBConsumerHandlerContext = MongoDBConsumerHandlerContext,
  CheckpointType = GlobalPositionTypeOfRecordedMessageMetadata<MessageMetadataType>,
>(
  options: MongoDBConsumerOptions<
    ConsumerMessageType,
    MessageMetadataType,
    HandlerContext,
    CheckpointType
  >,
): MongoDBEventStoreConsumer<ConsumerMessageType> =>
  mongoDBMessagesConsumer<
    ConsumerMessageType,
    MessageMetadataType,
    HandlerContext,
    CheckpointType
  >(options);
