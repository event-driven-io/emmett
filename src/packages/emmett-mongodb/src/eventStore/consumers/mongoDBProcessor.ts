import type {
  MessageHandlerContext,
  MessageProcessor,
  ProcessorHooks,
} from '@event-driven-io/emmett';
import {
  defaultProcessorPartition,
  defaultProcessorVersion,
  type AnyEvent,
  type AnyMessage,
  type AnyCommand,
  type AnyRecordedMessageMetadata,
  type Checkpointer,
  type Event,
  type Message,
  type MessageProcessingScope,
  type ProjectorOptions,
  type ReactorOptions,
  type SingleMessageHandlerResult,
  type WorkflowProcessorContext,
  type WorkflowProcessorOptions,
  getProcessorInstanceId,
  getWorkflowId,
  noopScope,
  inMemoryCheckpointer,
  projector,
  reactor,
  workflowProcessor,
} from '@event-driven-io/emmett';
import { MongoClient } from 'mongodb';
import {
  getMongoDBEventStore,
  type MongoDBEventStore,
  type MongoDBEventStoreConnectionOptions,
} from '../mongoDBEventStore';
import { mongoDBCheckpointer } from './mongoDBCheckpointer';
import type { MongoDBChangeStreamMessageMetadata } from './mongoDBEventStoreConsumer';

type MongoDBConnectionOptions = {
  connectionOptions: MongoDBEventStoreConnectionOptions;
};

export type MongoDBProcessorHandlerContext = MessageHandlerContext<{
  client: MongoClient;
  connection?: {
    messageStore: MongoDBEventStore;
  };
}>;

export type MongoDBProcessor<MessageType extends Message = AnyMessage> =
  MessageProcessor<
    MessageType,
    MongoDBChangeStreamMessageMetadata,
    MongoDBProcessorHandlerContext
  >;

export type MongoDBProcessorOptions<MessageType extends Message = Message> =
  ReactorOptions<
    MessageType,
    MongoDBChangeStreamMessageMetadata,
    MongoDBProcessorHandlerContext
  > & { connectionOptions: MongoDBEventStoreConnectionOptions };

export type MongoDBCheckpointer<MessageType extends AnyMessage = AnyMessage> =
  Checkpointer<
    MessageType,
    MongoDBChangeStreamMessageMetadata,
    MongoDBProcessorHandlerContext
  >;

export type MongoDBProjectorOptions<EventType extends AnyEvent = AnyEvent> =
  ProjectorOptions<
    EventType,
    MongoDBChangeStreamMessageMetadata,
    MongoDBProcessorHandlerContext
  > &
    MongoDBConnectionOptions;

export type MongoDBWorkflowProcessorHandlerContext =
  MongoDBProcessorHandlerContext & WorkflowProcessorContext;

export type MongoDBWorkflowProcessorOptions<
  Input extends AnyEvent | AnyCommand,
  State,
  Output extends AnyEvent | AnyCommand,
  MetaDataType extends AnyRecordedMessageMetadata = AnyRecordedMessageMetadata,
  HandlerContext extends MongoDBWorkflowProcessorHandlerContext =
    MongoDBWorkflowProcessorHandlerContext,
  StoredMessage extends AnyEvent | AnyCommand = Output,
> = WorkflowProcessorOptions<
  Input,
  State,
  Output,
  MetaDataType,
  HandlerContext,
  StoredMessage
> &
  MongoDBConnectionOptions;

const mongoDBProcessingScope = (options: {
  client: MongoClient;
  processorId: string;
}): MessageProcessingScope<MongoDBProcessorHandlerContext> => {
  const processingScope: MessageProcessingScope<
    MongoDBProcessorHandlerContext
  > = async <Result = SingleMessageHandlerResult>(
    handler: (
      context: MongoDBProcessorHandlerContext,
    ) => Result | Promise<Result>,
    partialContext: Partial<MongoDBProcessorHandlerContext>,
  ) => {
    return handler({
      client: options.client,
      ...partialContext,
      observabilityScope: partialContext?.observabilityScope ?? noopScope,
    });
  };

  return processingScope;
};

const mongoDBWorkflowProcessingScope = (options: {
  client: MongoClient;
}): MessageProcessingScope<MongoDBWorkflowProcessorHandlerContext> => {
  const processingScope: MessageProcessingScope<
    MongoDBWorkflowProcessorHandlerContext
  > = async <Result = SingleMessageHandlerResult>(
    handler: (
      context: MongoDBWorkflowProcessorHandlerContext,
    ) => Result | Promise<Result>,
    partialContext: Partial<MongoDBWorkflowProcessorHandlerContext>,
  ) => {
    return handler({
      client: options.client,
      ...partialContext,
      connection: {
        ...partialContext.connection,
        messageStore: getMongoDBEventStore({ client: options.client }),
      },
      observabilityScope: partialContext?.observabilityScope ?? noopScope,
    });
  };

  return processingScope;
};

export const mongoDBWorkflowProcessor = <
  Input extends AnyEvent | AnyCommand,
  State,
  Output extends AnyEvent | AnyCommand,
  MetaDataType extends AnyRecordedMessageMetadata = AnyRecordedMessageMetadata,
  HandlerContext extends MongoDBWorkflowProcessorHandlerContext =
    MongoDBWorkflowProcessorHandlerContext,
  StoredMessage extends AnyEvent | AnyCommand = Output,
>(
  options: MongoDBWorkflowProcessorOptions<
    Input,
    State,
    Output,
    MetaDataType,
    HandlerContext,
    StoredMessage
  >,
): MongoDBProcessor<Input | Output> => {
  const connectionOptions = options.connectionOptions || {};
  const isOwnClient = !(
    'client' in connectionOptions && connectionOptions.client
  );
  const client =
    'client' in connectionOptions && connectionOptions.client
      ? connectionOptions.client
      : new MongoClient(
          connectionOptions.connectionString,
          connectionOptions.clientOptions,
        );

  const {
    processorId = getWorkflowId({
      workflowName: options.workflow.name ?? 'unknown',
    }),
    processorInstanceId = getProcessorInstanceId(processorId),
    version = defaultProcessorVersion,
    partition = defaultProcessorPartition,
  } = options;

  const hooks: ProcessorHooks<HandlerContext> = {
    ...(options.hooks ?? {}),
    onClose: isOwnClient
      ? async (context) => {
          try {
            if (options.hooks?.onClose) await options.hooks.onClose(context);
          } finally {
            await client.close();
          }
        }
      : options.hooks?.onClose,
  };

  return workflowProcessor({
    ...options,
    processorId,
    processorInstanceId,
    version,
    partition,
    hooks,
    processingScope: mongoDBWorkflowProcessingScope({
      client,
    }) as unknown as MessageProcessingScope<HandlerContext>,
    checkpoints:
      options.checkpoints === 'DISABLED'
        ? inMemoryCheckpointer<Input | Output, MetaDataType, HandlerContext>()
        : (mongoDBCheckpointer<Input | Output>() as Checkpointer<
            Input | Output,
            MetaDataType,
            HandlerContext
          >),
  }) as MongoDBProcessor<Input | Output>;
};

export const mongoDBProjector = <EventType extends Event = Event>(
  options: MongoDBProjectorOptions<EventType>,
): MongoDBProcessor<EventType> => {
  const { connectionOptions } = options;
  const hooks = {
    onInit: options.hooks?.onInit,
    onStart: options.hooks?.onStart,
    onClose: options.hooks?.onClose,
  };
  // TODO: This should be eventually moved to the mongoDBProcessingScope
  // In the similar way as it's made in the postgresql processor
  // So creating client only if it's needed and different than consumer is passing
  // through handler context
  const client =
    'client' in connectionOptions && connectionOptions.client
      ? connectionOptions.client
      : new MongoClient(
          connectionOptions.connectionString,
          connectionOptions.clientOptions,
        );

  return projector<
    EventType,
    MongoDBChangeStreamMessageMetadata,
    MongoDBProcessorHandlerContext
  >({
    ...options,
    hooks,
    processingScope: mongoDBProcessingScope({
      client,
      processorId:
        options.processorId ?? `projection:${options.projection.name}`,
    }),

    checkpoints:
      options.checkpoints === 'DISABLED'
        ? inMemoryCheckpointer<EventType>()
        : mongoDBCheckpointer<EventType>(),
  });
};

export const changeStreamReactor = <
  MessageType extends AnyMessage = AnyMessage,
>(
  options: MongoDBProcessorOptions<MessageType>,
): MongoDBProcessor<MessageType> => {
  const connectionOptions = options.connectionOptions || {};
  const client =
    'client' in connectionOptions && connectionOptions.client
      ? connectionOptions.client
      : new MongoClient(
          connectionOptions.connectionString,
          connectionOptions.clientOptions,
        );

  const hooks = {
    onStart: options.hooks?.onStart,
    onClose: options.hooks?.onClose,
  };

  return reactor({
    ...options,
    hooks,
    processingScope: mongoDBProcessingScope({
      client,
      processorId: options.processorId,
    }),
    checkpoints:
      options.checkpoints === 'DISABLED'
        ? inMemoryCheckpointer<MessageType>()
        : mongoDBCheckpointer<MessageType>(),
  });
};
