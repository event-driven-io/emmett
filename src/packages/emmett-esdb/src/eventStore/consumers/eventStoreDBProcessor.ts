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
  workflowProcessor,
} from '@event-driven-io/emmett';
import {
  getEventStoreDBEventStore,
  type EventStoreDBEventStore,
} from '../eventstoreDBEventStore';

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

const eventStoreDBWorkflowProcessingScope = (options: {
  client: EventStoreDBClient;
}): MessageProcessingScope<EventStoreDBWorkflowProcessorHandlerContext> => {
  const processingScope: MessageProcessingScope<
    EventStoreDBWorkflowProcessorHandlerContext
  > = async <Result = SingleMessageHandlerResult>(
    handler: (
      context: EventStoreDBWorkflowProcessorHandlerContext,
    ) => Result | Promise<Result>,
    partialContext: Partial<EventStoreDBWorkflowProcessorHandlerContext>,
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
    processingScope: eventStoreDBWorkflowProcessingScope({
      client: options.client,
    }) as unknown as MessageProcessingScope<HandlerContext>,
    checkpoints: inMemoryCheckpointer<
      Input | Output,
      MetaDataType,
      HandlerContext
    >(),
  }) as EventStoreDBProcessor<Input | Output>;
};
