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
> = Omit<
  BaseMessageProcessorOptions<Input, MessageMetadataType, HandlerContext>,
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
  onCommand?: (command: Output) => Promise<void>;
  onEvent?: (event: Output) => Promise<void>;
};

export const workflowProcessor = <
  Input extends AnyEvent | AnyCommand,
  State,
  Output extends AnyEvent | AnyCommand,
  MetaDataType extends AnyRecordedMessageMetadata = AnyRecordedMessageMetadata,
  HandlerContext extends WorkflowHandlerContext = WorkflowHandlerContext,
>(
  options: WorkflowOptions<Input, State, Output, MetaDataType, HandlerContext>,
): MessageProcessor<Input, MetaDataType, HandlerContext> => {
  const { workflow: _workflow, onCommand, onEvent, ...rest } = options;

  const commandTypes = new Set<string>(options.outputs.commands);
  const eventTypes = new Set<string>(options.outputs.events);

  return reactor<Input, MetaDataType, HandlerContext>({
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

      for (const output of outputs) {
        if (commandTypes.has(output.type) && onCommand) {
          await onCommand(output);
        } else if (eventTypes.has(output.type) && onEvent) {
          await onEvent(output);
        }
      }
    },
  });
};
