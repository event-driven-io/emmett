import type { EmmettError } from '../errors';
import type { ProjectionDefinition } from '../projections';
import {
  type AnyEvent,
  type AnyMessage,
  type AnyReadEventMetadata,
  type AnyRecordedMessageMetadata,
  type BatchRecordedMessageHandlerWithContext,
  type CanHandle,
  type DefaultRecord,
  type Event,
  type GlobalPositionTypeOfRecordedMessageMetadata,
  type Message,
  type MessageHandler,
  type MessageHandlerResult,
  type RecordedMessage,
  type SingleMessageHandlerWithContext,
} from '../typing';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CurrentMessageProcessorPosition<CheckpointType = any> =
  | { lastCheckpoint: CheckpointType }
  | 'BEGINNING'
  | 'END';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MessageProcessorStartFrom<CheckpointType = any> =
  | CurrentMessageProcessorPosition<CheckpointType>
  | 'CURRENT';

export type MessageProcessor<
  MessageType extends AnyMessage = AnyMessage,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  HandlerContext extends DefaultRecord | undefined = undefined,
  CheckpointType = GlobalPositionTypeOfRecordedMessageMetadata<MessageMetadataType>,
> = {
  id: string;
  start: (
    options: Partial<HandlerContext> & {
      startFrom: MessageProcessorStartFrom<CheckpointType>;
    },
  ) => Promise<CurrentMessageProcessorPosition<CheckpointType> | undefined>;
  isActive: boolean;
  handle: BatchRecordedMessageHandlerWithContext<
    MessageType,
    MessageMetadataType,
    Partial<HandlerContext>
  >;
};

export const MessageProcessor = {
  result: {
    skip: (options?: { reason?: string }): MessageHandlerResult => ({
      type: 'SKIP',
      ...(options ?? {}),
    }),
    stop: (options?: {
      reason?: string;
      error?: EmmettError;
    }): MessageHandlerResult => ({
      type: 'STOP',
      ...(options ?? {}),
    }),
  },
};

// export type MessageProcessingScope<HandlerContext = never> = (
//   partialContext: Partial<HandlerContext>,
// ) =>
//   | ((
//       handler: (context: HandlerContext) => MessageHandlerResult,
//     ) => MessageHandlerResult)
//   | ((
//       handler: (context: HandlerContext) => Promise<MessageHandlerResult>,
//     ) => Promise<MessageHandlerResult>);

export type MessageProcessingScope<
  HandlerContext extends DefaultRecord | undefined = undefined,
> = (
  partialContext: Partial<HandlerContext>,
) => (
  handler: (
    context: HandlerContext,
  ) => MessageHandlerResult | Promise<MessageHandlerResult>,
) => MessageHandlerResult | Promise<MessageHandlerResult>;

export type GenericMessageProcessorOptions<
  MessageType extends AnyMessage = AnyMessage,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  HandlerContext extends DefaultRecord = DefaultRecord,
  CheckpointType = GlobalPositionTypeOfRecordedMessageMetadata<MessageMetadataType>,
> = {
  processorId: string;
  version?: number;
  partition?: string;
  startFrom?: MessageProcessorStartFrom<CheckpointType>;
  stopAfter?: (
    message: RecordedMessage<MessageType, MessageMetadataType>,
  ) => boolean;
  processingScope?: MessageProcessingScope<HandlerContext>;
  checkpoints?: {
    read: ReadProcessorCheckpoint<CheckpointType, HandlerContext>;
    store: StoreProcessorCheckpoint<
      MessageType,
      CheckpointType,
      HandlerContext
    >;
  };
} & (
  | {
      eachMessage: SingleMessageHandlerWithContext<
        MessageType,
        MessageMetadataType,
        HandlerContext
      >;
      canHandle?: CanHandle<MessageType>;
    }
  | {
      eachBatch: MessageHandler<
        MessageType,
        MessageMetadataType,
        HandlerContext
      >;
      canHandle?: CanHandle<MessageType>;
    }
);

export type ProjectionProcessorOptions<
  EventType extends AnyEvent = AnyEvent,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  HandlerContext extends DefaultRecord = DefaultRecord,
  CheckpointType = GlobalPositionTypeOfRecordedMessageMetadata<MessageMetadataType>,
> = {
  processorId?: string;
  version?: number;
  projection: ProjectionDefinition<
    EventType,
    MessageMetadataType,
    HandlerContext
  >;
  partition?: string;
  startFrom?: MessageProcessorStartFrom<CheckpointType>;
  stopAfter?: (
    message: RecordedMessage<EventType, MessageMetadataType>,
  ) => boolean;
  checkpoints?: {
    read: ReadProcessorCheckpoint<CheckpointType, HandlerContext>;
    store: StoreProcessorCheckpoint<EventType, CheckpointType, HandlerContext>;
  };
};

export type MessageProcessorOptions<
  MessageType extends AnyMessage = AnyMessage,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  HandlerContext extends DefaultRecord = DefaultRecord,
  CheckpointType = GlobalPositionTypeOfRecordedMessageMetadata<MessageMetadataType>,
> =
  | GenericMessageProcessorOptions<
      MessageType,
      MessageMetadataType,
      HandlerContext,
      CheckpointType
    >
  | (MessageType extends Event
      ? ProjectionProcessorOptions<
          MessageType,
          MessageMetadataType,
          HandlerContext,
          CheckpointType
        >
      : never);

// export const defaultProcessingMessageProcessingScope = <HandlerContext = never>(partialContext: Partial<HandlerContext>) => ((context: HandlerContext) => (MessageHandlerResult | Promise<MessageHandlerResult>));

export type ReadProcessorCheckpointResult<CheckpointType = unknown> = {
  lastCheckpoint: CheckpointType | null;
};

export type ReadProcessorCheckpoint<
  CheckpointType = unknown,
  HandlerContext extends DefaultRecord = DefaultRecord,
> = (
  options: { processorId: string; partition?: string },
  context: HandlerContext,
) => Promise<ReadProcessorCheckpointResult<CheckpointType>>;

export type StoreProcessorCheckpointResult<CheckpointType = unknown> =
  | {
      success: true;
      newCheckpoint: CheckpointType;
    }
  | { success: false; reason: 'IGNORED' | 'MISMATCH' };

export type StoreProcessorCheckpoint<
  MessageType extends Message = AnyMessage,
  CheckpointType = unknown,
  HandlerContext extends DefaultRecord | undefined = undefined,
> =
  | ((
      options: {
        message: MessageType;
        processorId: string;
        version: number | undefined;
        lastCheckpoint: CheckpointType | null;
        partition?: string;
      },
      context: HandlerContext,
    ) => Promise<StoreProcessorCheckpointResult<CheckpointType | null>>)
  | ((
      options: {
        message: MessageType;
        processorId: string;
        version: number | undefined;
        lastCheckpoint: CheckpointType | null;
        partition?: string;
      },
      context: HandlerContext,
    ) => Promise<StoreProcessorCheckpointResult<CheckpointType>>);

const genericMessageProcessor = <
  MessageType extends Message = AnyMessage,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  HandlerContext extends DefaultRecord = DefaultRecord,
  CheckpointType = GlobalPositionTypeOfRecordedMessageMetadata<MessageMetadataType>,
>(
  options: GenericMessageProcessorOptions<
    MessageType,
    MessageMetadataType,
    HandlerContext,
    CheckpointType
  >,
): MessageProcessor<
  MessageType,
  MessageMetadataType,
  HandlerContext,
  CheckpointType
> => {
  const eachMessage: SingleMessageHandlerWithContext<
    MessageType,
    MessageMetadataType,
    HandlerContext
  > = 'eachMessage' in options ? options.eachMessage : () => Promise.resolve();
  let isActive = true;

  const { checkpoints, processorId, partition } = options;

  return {
    id: options.processorId,
    start: async (
      startOptions: Partial<HandlerContext> & {
        startFrom: MessageProcessorStartFrom<CheckpointType>;
      },
    ): Promise<CurrentMessageProcessorPosition<CheckpointType> | undefined> => {
      isActive = true;
      if (startOptions.startFrom !== 'CURRENT') return startOptions.startFrom;

      let lastCheckpoint: CheckpointType | null = null;

      if (checkpoints) {
        const readResult = await checkpoints?.read(
          {
            processorId: processorId,
            partition: partition,
          },
          startOptions as HandlerContext & {
            startFrom: MessageProcessorStartFrom<CheckpointType>;
          },
        );
        lastCheckpoint = readResult.lastCheckpoint;
      }

      if (lastCheckpoint === null) return 'BEGINNING';

      return {
        lastCheckpoint,
      } as CurrentMessageProcessorPosition<CheckpointType>;
    },
    get isActive() {
      return isActive;
    },
    handle: async (
      messages: RecordedMessage<MessageType, MessageMetadataType>[],
      partialContext: Partial<HandlerContext>,
    ): Promise<MessageHandlerResult> => {
      if (!isActive) return;

      const scope = options.processingScope!(partialContext);

      return scope(async (context) => {
        let result: MessageHandlerResult = undefined;

        let lastCheckpoint: CheckpointType | null = null;

        for (const message of messages) {
          const messageProcessingResult = await eachMessage(message, context);

          if (checkpoints) {
            const storeCheckpointResult: StoreProcessorCheckpointResult<CheckpointType | null> =
              await checkpoints.store(
                {
                  processorId: options.processorId,
                  version: options.version,
                  message,
                  lastCheckpoint,
                  partition: options.partition,
                },
                context,
              );

            if (storeCheckpointResult && storeCheckpointResult.success) {
              // TODO: Add correct handling of the storing checkpoint
              lastCheckpoint = storeCheckpointResult.newCheckpoint;
            }
          }

          if (
            messageProcessingResult &&
            messageProcessingResult.type === 'STOP'
          ) {
            isActive = false;
            result = messageProcessingResult;
            break;
          }

          if (options.stopAfter && options.stopAfter(message)) {
            isActive = false;
            result = { type: 'STOP', reason: 'Stop condition reached' };
            break;
          }

          if (
            messageProcessingResult &&
            messageProcessingResult.type === 'SKIP'
          )
            continue;
        }

        return result;
      });
    },
  };
};

export const projectionProcessor = <
  EventType extends Event = Event,
  EventMetaDataType extends
    AnyRecordedMessageMetadata = AnyRecordedMessageMetadata,
  HandlerContext extends DefaultRecord = DefaultRecord,
  CheckpointType = GlobalPositionTypeOfRecordedMessageMetadata<EventMetaDataType>,
>(
  options: ProjectionProcessorOptions<EventType>,
): MessageProcessor<
  EventType,
  EventMetaDataType,
  HandlerContext,
  CheckpointType
> => {
  const projection = options.projection;

  return genericMessageProcessor<
    EventType,
    EventMetaDataType,
    HandlerContext,
    CheckpointType
  >({
    processorId: options.processorId ?? `projection:${projection.name}`,
    eachMessage: async (
      event: RecordedMessage<EventType, EventMetaDataType>,
      context: HandlerContext,
    ) => {
      if (!projection.canHandle.includes(event.type)) return;

      await projection.handle([event], context);
    },
    ...options,
  });
};

export const messageProcessor = <
  MessageType extends Message = AnyMessage,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  HandlerContext extends DefaultRecord = DefaultRecord,
  CheckpointType = GlobalPositionTypeOfRecordedMessageMetadata<MessageMetadataType>,
>(
  options: MessageProcessorOptions<
    MessageType,
    MessageMetadataType,
    HandlerContext,
    CheckpointType
  >,
): MessageProcessor<
  MessageType,
  MessageMetadataType,
  HandlerContext,
  CheckpointType
> => {
  if ('projection' in options) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
    return projectionProcessor(options as any) as MessageProcessor<
      MessageType,
      MessageMetadataType,
      HandlerContext,
      CheckpointType
    >;
  }

  return genericMessageProcessor(options);
};
