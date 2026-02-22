import type { EventStore } from '../eventStore';
import type { MessageProcessor } from '../processors';
import {
  MessageProcessorType,
  reactor,
  type BaseMessageProcessorOptions,
} from '../processors';
import type {
  AnyCommand,
  AnyEvent,
  AnyReadEventMetadata,
  AnyRecordedMessageMetadata,
  CanHandle,
  MessageTypeOf,
  RecordedMessage,
} from '../typing';
import {
  WorkflowHandler,
  type WorkflowHandlerRetryOptions,
} from './handleWorkflow';
import type { Workflow, WorkflowCommand, WorkflowEvent } from './workflow';

export type WorkflowOptions<
  Input extends AnyEvent | AnyCommand,
  State,
  Output extends AnyEvent | AnyCommand,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  StoredMessage extends AnyEvent | AnyCommand = Output,
> = {
  workflow: Workflow<Input, State, Output>;
  getWorkflowId: (
    input: Input | RecordedMessage<Input, MessageMetadataType>,
  ) => string | null;
  inputs: {
    commands: CanHandle<WorkflowCommand<Input>>;
    events: CanHandle<WorkflowEvent<Input>>;
  };
  outputs: {
    commands: MessageTypeOf<WorkflowCommand<Output>>[];
    events: MessageTypeOf<WorkflowEvent<Output>>[];
  };
  schema?: {
    versioning?: {
      upcast?: (event: StoredMessage) => Input;
      downcast?: (event: Output) => StoredMessage;
    };
  };
};

export type WorkflowProcessorContext = {
  connection: {
    messageStore: EventStore;
  };
};

export type WorkflowProcessorOptions<
  Input extends AnyEvent | AnyCommand,
  State,
  Output extends AnyEvent | AnyCommand,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  HandlerContext extends WorkflowProcessorContext = WorkflowProcessorContext,
  StoredMessage extends AnyEvent | AnyCommand = Output,
> = Omit<
  BaseMessageProcessorOptions<Input, MessageMetadataType, HandlerContext>,
  'type' | 'canHandle' | 'processorId'
> & { processorId?: string } & WorkflowOptions<
    Input,
    State,
    Output,
    MessageMetadataType,
    StoredMessage
  > & {
    retry?: WorkflowHandlerRetryOptions;
  };

export const getWorkflowId = (options: { workflowName: string }): string =>
  `emt:processor:workflow:${options.workflowName}`;

export const workflowProcessor = <
  Input extends AnyEvent | AnyCommand,
  State,
  Output extends AnyEvent | AnyCommand,
  MetaDataType extends AnyRecordedMessageMetadata = AnyRecordedMessageMetadata,
  HandlerContext extends WorkflowProcessorContext = WorkflowProcessorContext,
  StoredMessage extends AnyEvent | AnyCommand = Output,
>(
  options: WorkflowProcessorOptions<
    Input,
    State,
    Output,
    MetaDataType,
    HandlerContext,
    StoredMessage
  >,
): MessageProcessor<Input, MetaDataType, HandlerContext> => {
  const { workflow, ...rest } = options;
  const canHandle = [...options.inputs.commands, ...options.inputs.events];

  const handle = WorkflowHandler(options);

  return reactor<Input, MetaDataType, HandlerContext>({
    ...rest,
    processorId:
      options.processorId ?? getWorkflowId({ workflowName: workflow.name }),
    canHandle,
    type: MessageProcessorType.PROJECTOR,
    eachMessage: async (
      message: RecordedMessage<Input, MetaDataType>,
      context: HandlerContext,
    ) => {
      const messageType = message.type as string;
      if (!canHandle.includes(messageType)) return;

      await handle(context.connection.messageStore, message, context);
    },
  });
};
