import {
  MessageProcessor,
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
  GlobalPositionTypeOfRecordedMessageMetadata,
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
  HandlerContext extends DefaultRecord = DefaultRecord,
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
