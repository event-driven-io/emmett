import {
  MessageProcessorType,
  reactor,
  type BaseMessageProcessorOptions,
  type MessageProcessor,
} from '../processors';
import type { EventStore } from '../eventStore';
import type {
  AnyCommand,
  AnyEvent,
  AnyReadEventMetadata,
  AnyRecordedMessageMetadata,
  CanHandle,
  DefaultRecord,
  Event,
  GlobalPositionTypeOfRecordedMessageMetadata,
  MessageTypeOf,
  RecordedMessage,
} from '../typing';
import type { Workflow, WorkflowCommand, WorkflowEvent } from './workflow';

export type WorkflowHandlerContext = DefaultRecord & {
  eventStore: EventStore;
};

export type WorkflowOptions<
  Input extends AnyEvent | AnyCommand,
  State,
  Output extends AnyEvent | AnyCommand,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  HandlerContext extends WorkflowHandlerContext = WorkflowHandlerContext,
  CheckpointType = GlobalPositionTypeOfRecordedMessageMetadata<MessageMetadataType>,
> = Omit<
  BaseMessageProcessorOptions<
    Input,
    MessageMetadataType,
    HandlerContext,
    CheckpointType
  >,
  'type' | 'canHandle'
> & {
  workflow: Workflow<Input, State, Output>;
  getWorkflowId: (
    input: RecordedMessage<Input, MessageMetadataType>,
  ) => string | null;
  inputs: {
    commands: CanHandle<WorkflowCommand<Input>>;
    events: CanHandle<WorkflowEvent<Input>>;
  };
  outputs: {
    commands: MessageTypeOf<WorkflowCommand<Output>>[];
    events: MessageTypeOf<WorkflowEvent<Output>>[];
  };
};

export const workflowProcessor = <
  Input extends AnyEvent | AnyCommand,
  State,
  Output extends AnyEvent | AnyCommand,
  MetaDataType extends AnyRecordedMessageMetadata = AnyRecordedMessageMetadata,
  HandlerContext extends WorkflowHandlerContext = WorkflowHandlerContext,
  CheckpointType = GlobalPositionTypeOfRecordedMessageMetadata<MetaDataType>,
>(
  options: WorkflowOptions<
    Input,
    State,
    Output,
    MetaDataType,
    HandlerContext,
    CheckpointType
  >,
): MessageProcessor<Input, MetaDataType, HandlerContext, CheckpointType> => {
  const { workflow: _workflow, ...rest } = options;

  return reactor<Input, MetaDataType, HandlerContext, CheckpointType>({
    ...rest,
    canHandle: [...options.inputs.commands, ...options.inputs.events],
    type: MessageProcessorType.REACTOR,
    eachMessage: async (
      message: RecordedMessage<Input, MetaDataType>,
      context: HandlerContext,
    ) => {
      const workflowId = options.getWorkflowId(message);
      if (workflowId === null) return;

      const streamName = `workflow-${options.processorId}-${workflowId}`;

      const { state } = await context.eventStore.aggregateStream(streamName, {
        evolve: options.workflow.evolve,
        initialState: options.workflow.initialState,
      });

      const rawOutputs = options.workflow.decide(message, state);
      const outputs = Array.isArray(rawOutputs) ? rawOutputs : [rawOutputs];

      const eventsToStore: Event[] = [
        { type: message.type, data: message.data },
        ...outputs.map((o) => ({ type: o.type, data: o.data })),
      ];
      await context.eventStore.appendToStream(streamName, eventsToStore);
    },
  });
};
