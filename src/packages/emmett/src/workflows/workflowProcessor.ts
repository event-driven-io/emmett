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
  DefaultRecord,
  MessageTypeOf,
  RecordedMessage,
} from '../typing';
import type { Workflow, WorkflowCommand, WorkflowEvent } from './workflow';

export type WorkflowOptions<
  Input extends AnyEvent | AnyCommand,
  State,
  Output extends AnyEvent | AnyCommand,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  HandlerContext extends DefaultRecord = DefaultRecord,
> = Omit<
  BaseMessageProcessorOptions<Input, MessageMetadataType, HandlerContext>,
  'type' | 'canHandle' | 'processorId'
> & { processorId?: string } & {
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

export const getWorkflowId = (options: { workflowName: string }): string =>
  `emt:processor:workflow:${options.workflowName}`;

export const workflowProcessor = <
  Input extends AnyEvent | AnyCommand,
  State,
  Output extends AnyEvent | AnyCommand,
  MetaDataType extends AnyRecordedMessageMetadata = AnyRecordedMessageMetadata,
  HandlerContext extends DefaultRecord = DefaultRecord,
>(
  options: WorkflowOptions<Input, State, Output, MetaDataType, HandlerContext>,
): MessageProcessor<Input, MetaDataType, HandlerContext> => {
  const { workflow: _workflow, ...rest } = options;

  return reactor<Input, MetaDataType, HandlerContext>({
    ...rest,
    processorId:
      options.processorId ??
      getWorkflowId({ workflowName: options.workflow.name }),
    canHandle: [...options.inputs.commands, ...options.inputs.events],
    type: MessageProcessorType.PROJECTOR,
    eachMessage: async (
      _message: RecordedMessage<Input, MetaDataType>,
      _context: HandlerContext,
    ) => {
      // if (!options.input.includes(message.type)) return;
      // await projection.handle([message], context);
    },
  });
};
