import {
  consumer,
  type AnyCommand,
  type AnyEvent,
  type AnyMessage,
  type AnyRecordedMessageMetadata,
  type AsyncRetryOptions,
  type Message,
  type MessageConsumer,
  type MessageConsumerOptions,
  type MessageSource,
  type RecordedMessageMetadataWithoutGlobalPosition,
  type WorkflowProcessorContext,
} from '@event-driven-io/emmett';
import { MongoClient, type MongoClientOptions } from 'mongodb';
import { mongoDBMessageSource } from './messageSource';
import {
  changeStreamReactor,
  mongoDBProjector,
  type MongoDBProcessor,
  type MongoDBProcessorHandlerContext,
  type MongoDBProcessorOptions,
  type MongoDBProjectorOptions,
  type MongoDBWorkflowProcessorHandlerContext,
  mongoDBWorkflowProcessor,
  type MongoDBWorkflowProcessorOptions,
} from './mongoDBProcessor';

export type MongoDBChangeStreamMessageMetadata =
  RecordedMessageMetadataWithoutGlobalPosition;

export type MongoDBEventStoreConsumerConfig<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends Message = any,
> = MessageConsumerOptions<ConsumerMessageType> & {
  resilience?: {
    resubscribeOptions?: AsyncRetryOptions;
  };
  pulling?: {
    batchSize?: number;
    batchDeadlineInMs?: number;
    pullingFrequencyInMs?: number;
  };
};

export type MongoDBConsumerOptions<
  ConsumerMessageType extends Message = Message,
> = MongoDBEventStoreConsumerConfig<ConsumerMessageType> & {
  source?: MessageSource<
    ConsumerMessageType,
    MongoDBChangeStreamMessageMetadata
  >;
} & (
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

export type MongoDBReactorFactory<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends AnyMessage = any,
> = <MessageType extends ConsumerMessageType = ConsumerMessageType>(
  options: MongoDBProcessorOptions<MessageType>,
) => MongoDBProcessor<MessageType>;

export type MongoDBProjectorFactory<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends AnyMessage = any,
> = <
  EventType extends ConsumerMessageType & AnyEvent = ConsumerMessageType &
    AnyEvent,
>(
  options: MongoDBProjectorOptions<EventType>,
) => MongoDBProcessor<EventType>;

export type MongoDBEventStoreConsumer<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends AnyMessage = any,
> = MessageConsumer<
  ConsumerMessageType,
  MongoDBReactorFactory<ConsumerMessageType>,
  MongoDBProjectorFactory<ConsumerMessageType>,
  MongoDBWorkflowProcessorFactory<ConsumerMessageType>
>;

export type MongoDBWorkflowProcessorFactory<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends AnyMessage = any,
> = <
  Input extends ConsumerMessageType,
  State,
  Output extends ConsumerMessageType,
  MetaDataType extends AnyRecordedMessageMetadata = AnyRecordedMessageMetadata,
  HandlerContext extends MongoDBProcessorHandlerContext &
    WorkflowProcessorContext = MongoDBProcessorHandlerContext &
    WorkflowProcessorContext,
  StoredMessage extends AnyEvent | AnyCommand = Output,
>(
  options: Omit<
    MongoDBWorkflowProcessorOptions<
      Input,
      State,
      Output,
      MetaDataType,
      HandlerContext,
      StoredMessage
    >,
    'connectionOptions'
  >,
) => MongoDBProcessor<Input | Output>;

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
  const isOwnClient = !options.client;
  const client =
    options.client ??
    new MongoClient(options.connectionString, options.clientOptions);

  // A provided source is borrowed, the same way a provided client is. As the
  // consumer closes the source it reads from, the borrowed one gets a no-op close.
  const source: MessageSource<
    ConsumerMessageType,
    MongoDBChangeStreamMessageMetadata
  > = options.source
    ? { ...options.source, close: () => Promise.resolve() }
    : mongoDBMessageSource<ConsumerMessageType>({
        client,
        batchSize: options.pulling?.batchSize,
        pullingFrequencyInMs: options.pulling?.pullingFrequencyInMs,
        resilience: options.resilience,
      });

  const workflowProcessorFactory: MongoDBWorkflowProcessorFactory<
    ConsumerMessageType
  > = <
    Input extends ConsumerMessageType,
    State,
    Output extends ConsumerMessageType,
    MetaDataType extends AnyRecordedMessageMetadata =
      AnyRecordedMessageMetadata,
    HandlerContext extends MongoDBWorkflowProcessorHandlerContext =
      MongoDBWorkflowProcessorHandlerContext,
    StoredMessage extends AnyEvent | AnyCommand = Output,
  >(
    processorOptions: Omit<
      MongoDBWorkflowProcessorOptions<
        Input,
        State,
        Output,
        MetaDataType,
        HandlerContext,
        StoredMessage
      >,
      'connectionOptions'
    >,
  ) =>
    mongoDBWorkflowProcessor<
      Input,
      State,
      Output,
      MetaDataType,
      HandlerContext,
      StoredMessage
    >({
      ...processorOptions,
      connectionOptions:
        'client' in options
          ? { client: options.client }
          : {
              connectionString: options.connectionString,
              clientOptions: options.clientOptions,
            },
    });

  const messageConsumer = consumer<
    ConsumerMessageType,
    MongoDBChangeStreamMessageMetadata,
    MongoDBProcessorHandlerContext,
    MongoDBReactorFactory<ConsumerMessageType>,
    MongoDBProjectorFactory<ConsumerMessageType>,
    MongoDBEventStoreConsumer<ConsumerMessageType>['workflowProcessor']
  >({
    ...options,
    source,
    reactorFactory: changeStreamReactor,
    projectorFactory: mongoDBProjector,
    workflowProcessorFactory,
    batchSize: options.pulling?.batchSize,
    batchDeadlineInMs: options.pulling?.batchDeadlineInMs,
    scope: (handler) => handler({ client }),
    hooks: {
      onClose: async () => {
        if (isOwnClient) await client.close();
      },
    },
  });

  return messageConsumer;
};
