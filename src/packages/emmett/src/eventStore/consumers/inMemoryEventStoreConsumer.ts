import {
  consumer,
  type ConsumerHooks,
  type MessageConsumer,
  type MessageConsumerOptions,
} from '../../consumers/consumers';
import type { MessageSource } from '../../consumers/messageSources';
import type { InMemoryDatabase } from '../../database';
import {
  inMemoryProjector,
  inMemoryReactor,
  inMemoryWorkflowProcessor,
  type InMemoryProcessor,
  type InMemoryProcessorConnectionOptions,
  type InMemoryProcessorHandlerContext,
  type InMemoryProjectorOptions,
  type InMemoryReactorOptions,
  type InMemoryWorkflowProcessorOptions,
} from '../../processors';
import type {
  AnyCommand,
  AnyEvent,
  AnyMessage,
  AnyRecordedMessageMetadata,
  Message,
  ReadEventMetadataWithGlobalPosition,
} from '../../typing';
import type { WorkflowProcessorContext } from '../../workflows/workflowProcessor';
import type { EventStore } from '../eventStore';

export type InMemoryEventStoreConsumerConfig<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends Message = any,
> = MessageConsumerOptions<ConsumerMessageType> & {
  stopWhen?: {
    noMessagesLeft?: boolean;
  };
  pulling?: {
    batchSize?: number;
    batchDeadlineInMs?: number;
  };
};

export type InMemoryEventStoreConsumerOptions<
  ConsumerMessageType extends Message = Message,
> = InMemoryEventStoreConsumerConfig<ConsumerMessageType> & {
  source: MessageSource<
    ConsumerMessageType,
    ReadEventMetadataWithGlobalPosition
  >;
  messageStore: EventStore;
  hooks?: ConsumerHooks;
};

export type InMemoryReactorFactory<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends AnyMessage = any,
> = <MessageType extends ConsumerMessageType = ConsumerMessageType>(
  options: InMemoryReactorOptions<MessageType>,
) => InMemoryProcessor<MessageType>;

export type InMemoryProjectorFactory<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends AnyMessage = any,
> = <
  EventType extends ConsumerMessageType & AnyEvent = ConsumerMessageType &
    AnyEvent,
>(
  options: InMemoryProjectorOptions<EventType>,
) => InMemoryProcessor<EventType>;

export type InMemoryWorkflowProcessorFactory<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends AnyMessage = any,
> = <
  Input extends ConsumerMessageType,
  State,
  Output extends ConsumerMessageType,
  MetaDataType extends AnyRecordedMessageMetadata = AnyRecordedMessageMetadata,
  HandlerContext extends InMemoryProcessorHandlerContext &
    WorkflowProcessorContext = InMemoryProcessorHandlerContext &
    WorkflowProcessorContext,
  StoredMessage extends AnyEvent | AnyCommand = Output,
>(
  options: InMemoryWorkflowProcessorOptions<
    Input,
    State,
    Output,
    MetaDataType,
    HandlerContext,
    StoredMessage
  >,
) => InMemoryProcessor<Input | Output>;

export type InMemoryEventStoreConsumer<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends AnyMessage = any,
> = MessageConsumer<
  ConsumerMessageType,
  InMemoryReactorFactory<ConsumerMessageType>,
  InMemoryProjectorFactory<ConsumerMessageType>,
  InMemoryWorkflowProcessorFactory<ConsumerMessageType>
>;

const databaseOf = (messageStore: EventStore): InMemoryDatabase | undefined =>
  'database' in messageStore
    ? (messageStore as { database: InMemoryDatabase }).database
    : undefined;

export const inMemoryEventStoreConsumer = <
  ConsumerMessageType extends Message = AnyMessage,
>(
  options: InMemoryEventStoreConsumerOptions<ConsumerMessageType>,
): InMemoryEventStoreConsumer<ConsumerMessageType> => {
  const { messageStore } = options;
  const messageStoreDatabase = databaseOf(messageStore);

  const withMessageStoreDatabase = <
    ProcessorOptions extends {
      connectionOptions?: InMemoryProcessorConnectionOptions;
    },
  >(
    processorOptions: ProcessorOptions,
  ): ProcessorOptions =>
    messageStoreDatabase === undefined ||
    processorOptions.connectionOptions?.database !== undefined
      ? processorOptions
      : {
          ...processorOptions,
          connectionOptions: {
            ...processorOptions.connectionOptions,
            database: messageStoreDatabase,
          },
        };

  return consumer<
    ConsumerMessageType,
    ReadEventMetadataWithGlobalPosition,
    InMemoryProcessorHandlerContext,
    InMemoryReactorFactory<ConsumerMessageType>,
    InMemoryProjectorFactory<ConsumerMessageType>,
    InMemoryWorkflowProcessorFactory<ConsumerMessageType>
  >({
    ...options,
    source: { ...options.source, close: () => Promise.resolve() },
    reactorFactory: (processorOptions) =>
      inMemoryReactor(withMessageStoreDatabase(processorOptions)),
    projectorFactory: (processorOptions) =>
      inMemoryProjector(withMessageStoreDatabase(processorOptions)),
    workflowProcessorFactory: (processorOptions) =>
      inMemoryWorkflowProcessor(withMessageStoreDatabase(processorOptions)),
    batchSize: options.pulling?.batchSize,
    batchDeadlineInMs: options.pulling?.batchDeadlineInMs,
    scope: (handler) => handler({ session: { messageStore } }),
    until:
      options.until ??
      (options.stopWhen?.noMessagesLeft === true
        ? { noMessagesLeft: true }
        : undefined),
  });
};
