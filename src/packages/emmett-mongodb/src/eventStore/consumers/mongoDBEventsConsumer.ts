import {
  EmmettError,
  type AnyEvent,
  type AnyMessage,
  type AsyncRetryOptions,
  type CommonRecordedMessageMetadata,
  type Event,
  type GlobalPositionTypeOfRecordedMessageMetadata,
  type Message,
  type MessageConsumer,
  type ReadEvent,
  type RecordedMessage,
} from '@event-driven-io/emmett';
import { ChangeStream, MongoClient, type MongoClientOptions } from 'mongodb';
import { v4 as uuid } from 'uuid';
import type {
  MongoDBRecordedMessageMetadata,
  ReadEventMetadataWithGlobalPosition,
} from '../event';
import type {
  EventStream,
  MongoDBReadEventMetadata,
} from '../mongoDBEventStore';
import {
  changeStreamReactor,
  mongoDBProjector,
  type MongoDBProcessor,
  type MongoDBProcessorOptions,
  type MongoDBProjectorOptions,
} from './mongoDBProcessor';
import {
  subscribe as _subscribe,
  zipMongoDBMessageBatchPullerStartFrom,
  type ChangeStreamFullDocumentValuePolicy,
  type MongoDBSubscriptionDocument,
} from './subscriptions';

const noop = () => Promise.resolve();

export type MessageConsumerOptions<
  MessageType extends Message = AnyMessage,
  MessageMetadataType extends
    MongoDBRecordedMessageMetadata = MongoDBRecordedMessageMetadata,
  CheckpointType = GlobalPositionTypeOfRecordedMessageMetadata<MessageMetadataType>,
> = {
  consumerId?: string;

  processors?: MongoDBProcessor<MessageType>[];
};

export type EventStoreDBEventStoreConsumerConfig<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends Message = any,
> = MessageConsumerOptions<ConsumerMessageType> & {
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
> = EventStoreDBEventStoreConsumerConfig<ConsumerEventType> &
  (
    | {
        connectionString: string;
        clientOptions?: MongoClientOptions;
        client?: never;
        onHandleStart?: (
          messages: RecordedMessage<
            ConsumerEventType,
            ReadEventMetadataWithGlobalPosition
          >[],
        ) => Promise<void>;
        onHandleEnd?: (
          messages: RecordedMessage<
            ConsumerEventType,
            ReadEventMetadataWithGlobalPosition
          >[],
        ) => Promise<void>;
      }
    | {
        client: MongoClient;
        connectionString?: never;
        clientOptions?: never;
        onHandleStart?: (
          messages: RecordedMessage<
            ConsumerEventType,
            ReadEventMetadataWithGlobalPosition
          >[],
        ) => Promise<void>;
        onHandleEnd?: (
          messages: RecordedMessage<
            ConsumerEventType,
            ReadEventMetadataWithGlobalPosition
          >[],
        ) => Promise<void>;
      }
  );

export type EventStoreDBEventStoreConsumer<
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

type MessageArrayElement = `messages.${string}`;
type UpdateDescription<T> = {
  updateDescription: {
    updatedFields: Record<MessageArrayElement, T> & {
      'metadata.streamPosition': number;
      'metadata.updatedAt': Date;
    };
  };
};
type FullDocument<
  EventType extends Event = Event,
  EventMetaDataType extends MongoDBReadEventMetadata = MongoDBReadEventMetadata,
  T extends EventStream = EventStream<EventType, EventMetaDataType>,
> = {
  fullDocument: T;
};
type OplogChange<
  EventType extends Event = Event,
  EventMetaDataType extends MongoDBReadEventMetadata = MongoDBReadEventMetadata,
  T extends EventStream = EventStream<EventType, EventMetaDataType>,
> =
  | FullDocument<EventType, EventMetaDataType, T>
  | UpdateDescription<ReadEvent<EventType, EventMetaDataType>>;

export const mongoDBEventsConsumer = <
  ConsumerMessageType extends Message = AnyMessage,
>(
  options: MongoDBConsumerOptions<ConsumerMessageType>,
): EventStoreDBEventStoreConsumer<ConsumerMessageType> => {
  let start: Promise<void>;
  let stream: ChangeStream<
    EventStream<Event, CommonRecordedMessageMetadata>,
    MongoDBSubscriptionDocument<
      EventStream<Event, CommonRecordedMessageMetadata>
    >
  >;
  let isRunning = false;
  const client =
    'client' in options && options.client
      ? options.client
      : new MongoClient(options.connectionString, options.clientOptions);
  const processors = options.processors ?? [];
  const subscribe = _subscribe(
    options.changeStreamFullDocumentPolicy,
    client.db(),
  );
  const onHandleStart = options.onHandleStart || noop;
  const onHandleEnd = options.onHandleEnd || noop;

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

      processors.push(processor as unknown as MongoDBProcessor);

      return processor;
    },
    projector: <EventType extends AnyEvent = ConsumerMessageType & AnyEvent>(
      options: MongoDBProjectorOptions<EventType>,
    ): MongoDBProcessor<EventType> => {
      const processor = mongoDBProjector(options);

      processors.push(processor as unknown as MongoDBProcessor);

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

        const positions = await Promise.all(
          processors.map((o) => o.start(options)),
        );
        const startFrom = zipMongoDBMessageBatchPullerStartFrom(positions);

        stream = subscribe(
          typeof startFrom !== 'string' ? startFrom.lastCheckpoint : void 0,
        );
        stream.on('change', async (change) => {
          const resumeToken = change._id;
          const typedChange = change as OplogChange;
          const streamChange =
            'updateDescription' in typedChange
              ? {
                  messages: Object.entries(
                    typedChange.updateDescription.updatedFields,
                  )
                    .filter(([key]) => key.startsWith('messages.'))
                    .map(([, value]) => value as ReadEvent),
                }
              : typedChange.fullDocument;

          if (!streamChange) {
            return;
          }

          const messages = streamChange.messages.map((message) => {
            return {
              kind: message.kind,
              type: message.type,
              data: message.data,
              metadata: {
                ...message.metadata,
                streamPosition: resumeToken,
              },
            } as unknown as RecordedMessage<
              ConsumerMessageType,
              ReadEventMetadataWithGlobalPosition
            >;
          });

          await onHandleStart(messages);

          for (const processor of processors.filter(
            ({ isActive }) => isActive,
          )) {
            await processor.handle(messages, { client });
          }

          await onHandleEnd(messages);
        });
      })();

      return start;
    },
    stop: async () => {
      return Promise.resolve();
    },
    close: async () => {
      await stream.close();
    },
  };
};
