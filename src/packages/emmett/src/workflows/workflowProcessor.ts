import { EmmettError } from '../errors';
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
  Event,
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
  mapWorkflowId?: (workflowId: string) => string;
  separateInputInboxFromProcessing?: boolean;
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

export type WorkflowOutputRouter<
  Input extends AnyEvent | AnyCommand,
  Output extends AnyEvent | AnyCommand,
  MessageMetaDataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  HandlerContext extends WorkflowProcessorContext = WorkflowProcessorContext,
> = (
  messages:
    | RecordedMessage<Output, MessageMetaDataType>
    | RecordedMessage<Output, MessageMetaDataType>[],
  context: HandlerContext,
) =>
  | Promise<Input | Output | (Input | Output)[] | EmmettError | []>
  | Input
  | Output
  | (Input | Output)[]
  | EmmettError
  | [];

export type WorkflowProcessorOptions<
  Input extends AnyEvent | AnyCommand,
  State,
  Output extends AnyEvent | AnyCommand,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  HandlerContext extends WorkflowProcessorContext = WorkflowProcessorContext,
  StoredMessage extends AnyEvent | AnyCommand = Output,
> = Omit<
  BaseMessageProcessorOptions<
    Input | Output,
    MessageMetadataType,
    HandlerContext
  >,
  'type' | 'canHandle' | 'processorId'
> & { processorId?: string } & WorkflowOptions<
    Input,
    State,
    Output,
    MessageMetadataType,
    StoredMessage
  > & {
    retry?: WorkflowHandlerRetryOptions;
    router?: {
      handle: WorkflowOutputRouter<
        Input,
        Output,
        MessageMetadataType,
        HandlerContext
      >;
      canHandle: CanHandle<Output>;
    };
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

  const inputs = [...options.inputs.commands, ...options.inputs.events];
  let canHandle = inputs;

  if (options.separateInputInboxFromProcessing)
    canHandle = [
      ...canHandle,
      ...options.inputs.commands.map((t) => `${workflow.name}:${t}`),
      ...options.inputs.events.map((t) => `${workflow.name}:${t}`),
    ];

  if (options.router) canHandle = [...canHandle, ...options.router.canHandle];

  const handle = WorkflowHandler(options);

  return reactor<Input | Output, MetaDataType, HandlerContext>({
    ...rest,
    processorId:
      options.processorId ?? getWorkflowId({ workflowName: workflow.name }),
    canHandle,
    type: MessageProcessorType.PROJECTOR,
    eachMessage: async (
      message: RecordedMessage<Input | Output, MetaDataType>,
      context: HandlerContext,
    ) => {
      const messageType = message.type as string;

      if (inputs.includes(messageType)) {
        const result = await handle(
          context.connection.messageStore,
          message as RecordedMessage<Input, MetaDataType>,
          context,
        );

        // Check stopAfter on output messages
        if (options.stopAfter && result.newMessages.length > 0) {
          for (const outputMessage of result.newMessages) {
            if (
              options.stopAfter(
                outputMessage as RecordedMessage<Output, MetaDataType>,
              )
            ) {
              return { type: 'STOP', reason: 'Stop condition reached' };
            }
          }
        }
      }

      // TODO: I don't like entirely that, it's a bit hackish
      // Especially the streamName part, but it works, so let's be it for now.
      // Question: What if someone put message both as input and output?
      if (options.router?.canHandle.includes(messageType) === true) {
        const routedMessages = await options.router.handle(
          message as RecordedMessage<Output, MetaDataType>,
          context,
        );

        if (routedMessages instanceof EmmettError) {
          return {
            type: 'STOP',
            reason: 'Routing error',
            error: routedMessages,
          };
        }

        const messagesToAppend = Array.isArray(routedMessages)
          ? routedMessages
          : routedMessages
            ? [routedMessages]
            : [];

        if (messagesToAppend.length === 0) {
          return;
        }

        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        const streamName = message.metadata.streamName as string;

        await context.connection.messageStore.appendToStream(
          streamName,
          messagesToAppend as unknown as Event[],
        );

        return;
      }

      return;
    },
  });
};
