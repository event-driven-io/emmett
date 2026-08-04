import type { EventStoreDBClient } from '@eventstore/db-client';
import type {
  AnyCommand,
  AnyEvent,
  AnyMessage,
  AnyRecordedMessageMetadata,
  Message,
  MessageHandlerContext,
  MessageProcessingScope,
  MessageProcessor,
  ReactorOptions,
  ReadEventMetadataWithGlobalPosition,
  SingleMessageHandlerResult,
  WorkflowProcessorContext,
  WorkflowProcessorOptions,
} from '@event-driven-io/emmett';
import {
  defaultProcessorPartition,
  defaultProcessorVersion,
  getProcessorInstanceId,
  getWorkflowId,
  inMemoryCheckpointer,
  noopScope,
  reactor,
  workflowProcessor,
} from '@event-driven-io/emmett';
import {
  getEventStoreDBEventStore,
  type EventStoreDBEventStore,
} from '../eventstoreDBEventStore';
import { eventStoreDBCheckpointer } from './eventStoreDBCheckpointer';

export type EventStoreDBProcessorHandlerContext = MessageHandlerContext<{
  client: EventStoreDBClient;
  connection?: {
    messageStore: EventStoreDBEventStore;
  };
}>;

export type EventStoreDBWorkflowProcessorHandlerContext =
  EventStoreDBProcessorHandlerContext & WorkflowProcessorContext;

export type EventStoreDBProcessor<MessageType extends Message = AnyMessage> =
  MessageProcessor<
    MessageType,
    ReadEventMetadataWithGlobalPosition,
    EventStoreDBProcessorHandlerContext
  >;

export type EventStoreDBWorkflowProcessorOptions<
  Input extends AnyEvent | AnyCommand,
  State,
  Output extends AnyEvent | AnyCommand,
  MetaDataType extends AnyRecordedMessageMetadata = AnyRecordedMessageMetadata,
  HandlerContext extends EventStoreDBWorkflowProcessorHandlerContext =
    EventStoreDBWorkflowProcessorHandlerContext,
  StoredMessage extends AnyEvent | AnyCommand = Output,
> = WorkflowProcessorOptions<
  Input,
  State,
  Output,
  MetaDataType,
  HandlerContext,
  StoredMessage
> & {
  client: EventStoreDBClient;
};

export type EventStoreDBReactorOptions<
  MessageType extends Message = Message,
  MessagePayloadType extends AnyMessage = MessageType,
> = ReactorOptions<
  MessageType,
  ReadEventMetadataWithGlobalPosition,
  EventStoreDBProcessorHandlerContext,
  MessagePayloadType
> & {
  client: EventStoreDBClient;
};

const eventStoreDBProcessingScope = (options: {
  client: EventStoreDBClient;
}): MessageProcessingScope<EventStoreDBProcessorHandlerContext> => {
  const processingScope: MessageProcessingScope<
    EventStoreDBProcessorHandlerContext
  > = async <Result = SingleMessageHandlerResult>(
    handler: (
      context: EventStoreDBProcessorHandlerContext,
    ) => Result | Promise<Result>,
    partialContext: Partial<EventStoreDBProcessorHandlerContext>,
  ) => {
    return handler({
      client: options.client,
      ...partialContext,
      connection: {
        ...partialContext.connection,
        messageStore: getEventStoreDBEventStore(options.client),
      },
      observabilityScope: partialContext?.observabilityScope ?? noopScope,
    });
  };

  return processingScope;
};

export const eventStoreDBWorkflowProcessor = <
  Input extends AnyEvent | AnyCommand,
  State,
  Output extends AnyEvent | AnyCommand,
  MetaDataType extends AnyRecordedMessageMetadata = AnyRecordedMessageMetadata,
  HandlerContext extends EventStoreDBWorkflowProcessorHandlerContext =
    EventStoreDBWorkflowProcessorHandlerContext,
  StoredMessage extends AnyEvent | AnyCommand = Output,
>(
  options: EventStoreDBWorkflowProcessorOptions<
    Input,
    State,
    Output,
    MetaDataType,
    HandlerContext,
    StoredMessage
  >,
): EventStoreDBProcessor<Input | Output> => {
  const {
    processorId = getWorkflowId({
      workflowName: options.workflow.name ?? 'unknown',
    }),
    processorInstanceId = getProcessorInstanceId(processorId),
    version = defaultProcessorVersion,
    partition = defaultProcessorPartition,
  } = options;

  return workflowProcessor({
    ...options,
    processorId,
    processorInstanceId,
    version,
    partition,
    processingScope: eventStoreDBProcessingScope({
      client: options.client,
    }) as unknown as MessageProcessingScope<HandlerContext>,
    checkpoints:
      options.checkpoints === 'DISABLED'
        ? inMemoryCheckpointer<Input | Output, MetaDataType, HandlerContext>()
        : eventStoreDBCheckpointer<
            Input | Output,
            MetaDataType,
            HandlerContext
          >(),
  }) as EventStoreDBProcessor<Input | Output>;
};

export const eventStoreDBReactor = <
  MessageType extends Message = Message,
  MessagePayloadType extends AnyMessage = MessageType,
>(
  options: EventStoreDBReactorOptions<MessageType, MessagePayloadType>,
): EventStoreDBProcessor<MessageType> => {
  const {
    processorId,
    processorInstanceId = getProcessorInstanceId(processorId),
    version = defaultProcessorVersion,
    partition = defaultProcessorPartition,
  } = options;

  return reactor<
    MessageType,
    ReadEventMetadataWithGlobalPosition,
    EventStoreDBProcessorHandlerContext,
    MessagePayloadType
  >({
    ...options,
    processorId,
    processorInstanceId,
    version,
    partition,
    processingScope: eventStoreDBProcessingScope({ client: options.client }),
    checkpoints:
      options.checkpoints === 'DISABLED'
        ? inMemoryCheckpointer<
            MessageType,
            ReadEventMetadataWithGlobalPosition,
            EventStoreDBProcessorHandlerContext
          >()
        : eventStoreDBCheckpointer<
            MessageType,
            ReadEventMetadataWithGlobalPosition,
            EventStoreDBProcessorHandlerContext
          >(),
  });
};
