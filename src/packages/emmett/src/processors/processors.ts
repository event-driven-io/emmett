import { v7 as uuid } from 'uuid';
import type { EmmettError } from '../errors';
import { upcastRecordedMessage } from '../eventStore';
import type { ProjectionDefinition } from '../projections';
import {
  JSONSerializer,
  type JSONSerializationOptions,
} from '../serialization';
import {
  defaultTag,
  type AnyEvent,
  type AnyMessage,
  type AnyReadEventMetadata,
  type AnyRecordedMessageMetadata,
  type BatchMessageHandlerResult,
  type BatchRecordedMessageHandlerWithContext,
  type Brand,
  type CanHandle,
  type DefaultRecord,
  type Event,
  type Message,
  type RecordedMessage,
  type SingleMessageHandlerResult,
  type SingleRecordedMessageHandlerWithContext,
} from '../typing';
import { bigInt } from '../utils';
import { onShutdown } from '../utils/shutdown';

export type CurrentMessageProcessorPosition =
  | { lastCheckpoint: ProcessorCheckpoint }
  | 'BEGINNING'
  | 'END';

export type GetCheckpoint<
  MessageType extends AnyMessage = AnyMessage,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
> = (
  message: RecordedMessage<MessageType, MessageMetadataType>,
) => ProcessorCheckpoint | null;

export const getCheckpoint = <
  MessageType extends AnyMessage = AnyMessage,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
>(
  message: RecordedMessage<MessageType, MessageMetadataType>,
): ProcessorCheckpoint | null => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access
  return message.metadata.checkpoint;
};

export const wasMessageHandled = <
  MessageType extends AnyMessage = AnyMessage,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
>(
  message: RecordedMessage<MessageType, MessageMetadataType>,
  checkpoint: ProcessorCheckpoint | null,
): boolean => {
  //TODO Make it smarter
  const messageCheckpoint = getCheckpoint(message);

  return (
    messageCheckpoint !== null &&
    messageCheckpoint !== undefined &&
    checkpoint !== null &&
    checkpoint !== undefined &&
    messageCheckpoint <= checkpoint
  );
};

export type MessageProcessorStartFrom =
  | CurrentMessageProcessorPosition
  | 'CURRENT';

export type MessageProcessorType = 'projector' | 'reactor';
export const MessageProcessorType = {
  PROJECTOR: 'projector' as MessageProcessorType,
  REACTOR: 'reactor' as MessageProcessorType,
};

export type MessageProcessor<
  MessageType extends AnyMessage = AnyMessage,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  HandlerContext extends DefaultRecord | undefined = undefined,
> = {
  id: string;
  instanceId: string;
  type: string;
  canHandle?: string[];
  init: (options: Partial<HandlerContext>) => Promise<void>;
  start: (
    options: Partial<HandlerContext>,
  ) => Promise<CurrentMessageProcessorPosition | undefined>;
  close: (closeOptions: Partial<HandlerContext>) => Promise<void>;
  isActive: boolean;
  handle: BatchRecordedMessageHandlerWithContext<
    MessageType,
    MessageMetadataType,
    Partial<HandlerContext>
  >;
};

export const MessageProcessor = {
  result: {
    skip: (options?: { reason?: string }): SingleMessageHandlerResult => ({
      type: 'SKIP',
      ...(options ?? {}),
    }),
    stop: (options?: {
      reason?: string;
      error?: EmmettError;
    }): SingleMessageHandlerResult => ({
      type: 'STOP',
      ...(options ?? {}),
    }),
  },
};

export type MessageProcessingScope<
  HandlerContext extends DefaultRecord | undefined = undefined,
> = <Result = SingleMessageHandlerResult>(
  handler: (context: HandlerContext) => Result | Promise<Result>,
  partialContext: Partial<HandlerContext>,
) => Result | Promise<Result>;

export type Checkpointer<
  MessageType extends AnyMessage = AnyMessage,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  HandlerContext extends DefaultRecord = DefaultRecord,
> = {
  read: ReadProcessorCheckpoint<HandlerContext>;
  store: StoreProcessorCheckpoint<
    MessageType,
    MessageMetadataType,
    HandlerContext
  >;
};

export type ProcessorHooks<
  HandlerContext extends DefaultRecord = DefaultRecord,
> = {
  onInit?: OnReactorInitHook<HandlerContext>;
  onStart?: OnReactorStartHook<HandlerContext>;
  onClose?: OnReactorCloseHook<HandlerContext>;
};

export type BaseMessageProcessorOptions<
  MessageType extends AnyMessage = AnyMessage,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  HandlerContext extends DefaultRecord = DefaultRecord,
> = {
  type?: string;
  processorId: string;
  processorInstanceId?: string;
  version?: number;
  partition?: string;
  startFrom?: MessageProcessorStartFrom;
  stopAfter?: (
    message: RecordedMessage<MessageType, MessageMetadataType>,
  ) => boolean;
  processingScope?: MessageProcessingScope<HandlerContext>;
  checkpoints?: Checkpointer<MessageType, MessageMetadataType, HandlerContext>;
  canHandle?: CanHandle<MessageType>;
  hooks?: ProcessorHooks<HandlerContext>;
} & JSONSerializationOptions;

export type HandlerOptions<
  MessageType extends AnyMessage = AnyMessage,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  HandlerContext extends DefaultRecord = DefaultRecord,
> =
  | {
      eachMessage: SingleRecordedMessageHandlerWithContext<
        MessageType,
        MessageMetadataType,
        HandlerContext
      >;
      eachBatch?: never;
    }
  | {
      eachMessage?: never;
      eachBatch: BatchRecordedMessageHandlerWithContext<
        MessageType,
        MessageMetadataType,
        HandlerContext
      >;
    };

export type OnReactorInitHook<
  HandlerContext extends DefaultRecord = DefaultRecord,
> = (context: HandlerContext) => Promise<void>;

export type OnReactorStartHook<
  HandlerContext extends DefaultRecord = DefaultRecord,
> = (context: HandlerContext) => Promise<void>;

export type OnReactorCloseHook<
  HandlerContext extends DefaultRecord = DefaultRecord,
> = (context: HandlerContext) => Promise<void>;

export type ReactorOptions<
  MessageType extends AnyMessage = AnyMessage,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  HandlerContext extends DefaultRecord = DefaultRecord,
  MessagePayloadType extends AnyMessage = MessageType,
> = BaseMessageProcessorOptions<
  MessageType,
  MessageMetadataType,
  HandlerContext
> &
  HandlerOptions<MessageType, MessageMetadataType, HandlerContext> & {
    messageOptions?: {
      schema?: {
        versioning?: { upcast?: (event: MessagePayloadType) => MessageType };
      };
    };
  };

export type ProjectorOptions<
  EventType extends AnyEvent = AnyEvent,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  HandlerContext extends DefaultRecord = DefaultRecord,
  EventPayloadType extends Event = EventType,
> = Omit<
  BaseMessageProcessorOptions<EventType, MessageMetadataType, HandlerContext>,
  'type' | 'processorId'
> & { processorId?: string } & {
  truncateOnStart?: boolean;
  projection: ProjectionDefinition<
    EventType,
    MessageMetadataType,
    HandlerContext,
    EventPayloadType
  >;
};

export const defaultProcessingMessageProcessingScope = <
  HandlerContext = never,
  Result = SingleMessageHandlerResult,
>(
  handler: (context: HandlerContext) => Result | Promise<Result>,
  partialContext: Partial<HandlerContext>,
) => handler(partialContext as HandlerContext);

export type ProcessorCheckpoint = Brand<string, 'ProcessorCheckpoint'>;

export const bigIntProcessorCheckpoint = (value: bigint): ProcessorCheckpoint =>
  bigInt.toNormalizedString(value) as ProcessorCheckpoint;

export const parseBigIntProcessorCheckpoint = (
  value: ProcessorCheckpoint,
): bigint => BigInt(value);

export type ReadProcessorCheckpointResult = {
  lastCheckpoint: ProcessorCheckpoint | null;
};

export type ReadProcessorCheckpoint<
  HandlerContext extends DefaultRecord = DefaultRecord,
> = (
  options: { processorId: string; partition?: string },
  context: HandlerContext,
) => Promise<ReadProcessorCheckpointResult>;

export type StoreProcessorCheckpointResult =
  | {
      success: true;
      newCheckpoint: ProcessorCheckpoint | null;
    }
  | { success: false; reason: 'IGNORED' | 'MISMATCH' | 'CURRENT_AHEAD' };

export type StoreProcessorCheckpoint<
  MessageType extends Message = AnyMessage,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  HandlerContext extends DefaultRecord | undefined = undefined,
> = (
  options: {
    message: RecordedMessage<MessageType, MessageMetadataType>;
    processorId: string;
    version: number | undefined;
    lastCheckpoint: ProcessorCheckpoint | null;
    partition?: string;
  },
  context: HandlerContext,
) => Promise<StoreProcessorCheckpointResult>;

export const defaultProcessorVersion = 1;
export const defaultProcessorPartition = defaultTag;

export const getProcessorInstanceId = (processorId: string): string =>
  `${processorId}:${uuid()}`;

export const getProjectorId = (options: { projectionName: string }): string =>
  `emt:processor:projector:${options.projectionName}`;

export const reactor = <
  MessageType extends Message = AnyMessage,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  HandlerContext extends DefaultRecord = DefaultRecord,
  MessagePayloadType extends Message = MessageType,
>(
  options: ReactorOptions<
    MessageType,
    MessageMetadataType,
    HandlerContext,
    MessagePayloadType
  >,
): MessageProcessor<MessageType, MessageMetadataType, HandlerContext> => {
  const {
    checkpoints,
    processorId,
    processorInstanceId: instanceId = getProcessorInstanceId(processorId),
    type = MessageProcessorType.REACTOR,
    version = defaultProcessorVersion,
    partition = defaultProcessorPartition,
    hooks = {},
    processingScope = defaultProcessingMessageProcessingScope,
    startFrom,
    canHandle,
    stopAfter,
  } = options;

  const isCustomBatch = 'eachBatch' in options && !!options.eachBatch;

  const eachBatch: BatchRecordedMessageHandlerWithContext<
    MessageType,
    MessageMetadataType,
    HandlerContext
  > = isCustomBatch
    ? options.eachBatch
    : async (
        messages: RecordedMessage<MessageType, MessageMetadataType>[],
        context: HandlerContext,
      ): Promise<BatchMessageHandlerResult> => {
        let result: BatchMessageHandlerResult = undefined;
        for (let i = 0; i < messages.length; i++) {
          const message = messages[i]!;
          const messageProcessingResult = await options.eachMessage(
            message,
            context,
          );

          if (
            messageProcessingResult &&
            messageProcessingResult.type === 'STOP'
          ) {
            result = {
              ...messageProcessingResult,
              lastSuccessfulMessage: messageProcessingResult.error
                ? messages[i - 1]
                : message,
            };
            break;
          }

          if (stopAfter && stopAfter(message)) {
            result = {
              type: 'STOP',
              reason: 'Stop condition reached',
              lastSuccessfulMessage: message,
            };
            break;
          }

          if (
            messageProcessingResult &&
            messageProcessingResult.type === 'SKIP'
          ) {
            result = {
              ...messageProcessingResult,
              lastSuccessfulMessage: message,
            };
            continue;
          }
        }
        return result;
      };

  let isInitiated = false;
  let isActive = false;

  let lastCheckpoint: ProcessorCheckpoint | null = null;
  let closeSignal: (() => void) | null = null;

  const init = async (initOptions: Partial<HandlerContext>): Promise<void> => {
    if (isInitiated) return;

    if (hooks.onInit === undefined) {
      isInitiated = true;
      return;
    }

    return await processingScope(async (context) => {
      await hooks.onInit!(context);
      isInitiated = true;
    }, initOptions);
  };

  const close = async (
    closeOptions: Partial<HandlerContext>,
  ): Promise<void> => {
    // TODO: Align when active is set to false
    // if (!isActive) return;

    isActive = false;

    if (closeSignal) {
      closeSignal();
      closeSignal = null;
    }

    if (hooks.onClose) {
      await processingScope(hooks.onClose, closeOptions);
    }
  };

  return {
    // TODO: Consider whether not make it optional or add URN prefix
    id: processorId,
    instanceId,
    type,
    canHandle,
    init,
    start: async (
      startOptions: Partial<HandlerContext>,
    ): Promise<CurrentMessageProcessorPosition | undefined> => {
      if (isActive) {
        console.log(
          `Processor ${processorId} with instance id ${instanceId} is already active. Start request ignored.`,
        );
        return;
      }

      console.log(
        `Starting processor ${processorId} with instance id ${instanceId}`,
      );

      await init(startOptions);

      isActive = true;

      closeSignal = onShutdown(() => close(startOptions));

      if (lastCheckpoint !== null) {
        console.log(
          `Processor ${processorId} started with instance id ${instanceId}, checkpoint: ${JSONSerializer.serialize(lastCheckpoint)}`,
        );
        return {
          lastCheckpoint,
        };
      }

      return await processingScope(async (context) => {
        if (hooks.onStart) {
          console.log(
            `Executing onStart hook for processor ${processorId} with instance id ${instanceId}`,
          );
          await hooks.onStart(context);
        }

        if (startFrom && startFrom !== 'CURRENT') {
          console.log(
            `Processor ${processorId} with instance id ${instanceId} starting from: ${JSONSerializer.serialize(startFrom)}`,
          );
          return startFrom;
        }

        if (checkpoints) {
          const readResult = await checkpoints?.read(
            {
              processorId: processorId,
              partition,
            },
            { ...startOptions, ...context },
          );
          lastCheckpoint = readResult.lastCheckpoint;
        }

        if (lastCheckpoint === null) {
          console.log(
            `Processor ${processorId} with instance id ${instanceId} starting from: BEGINNING`,
          );
          return 'BEGINNING';
        }
        console.log(
          `Checkpoint read for processor ${processorId} with instance id ${instanceId}: ${JSONSerializer.serialize(lastCheckpoint)}`,
        );

        return {
          lastCheckpoint,
        };
      }, startOptions);
    },
    close,
    get isActive() {
      return isActive;
    },
    handle: async (
      messages: RecordedMessage<MessageType, MessageMetadataType>[],
      partialContext: Partial<HandlerContext>,
    ): Promise<BatchMessageHandlerResult> => {
      if (!isActive) return Promise.resolve();

      try {
        return await processingScope(async (context) => {
          const messagesAboveCheckpoint = messages.filter(
            (message) => !wasMessageHandled(message, lastCheckpoint),
          );

          const upcastedMessages = messagesAboveCheckpoint
            .map((message) =>
              upcastRecordedMessage(
                // TODO: Make it smarter
                message as unknown as RecordedMessage<
                  MessagePayloadType,
                  MessageMetadataType
                >,
                options.messageOptions?.schema?.versioning,
              ),
            )
            .filter(
              (upcasted) => !canHandle || canHandle.includes(upcasted.type),
            );

          const stopMessageIndex =
            isCustomBatch && stopAfter
              ? upcastedMessages.findIndex(stopAfter)
              : -1;

          const unhandledMessages =
            stopMessageIndex !== -1
              ? upcastedMessages.slice(0, stopMessageIndex + 1)
              : upcastedMessages;

          const batchResult = await eachBatch(unhandledMessages, context);

          const messageProcessingResult: BatchMessageHandlerResult =
            batchResult?.type === 'STOP'
              ? batchResult
              : stopMessageIndex !== -1
                ? {
                    type: 'STOP',
                    reason: 'Stop condition reached',
                    lastSuccessfulMessage: unhandledMessages[stopMessageIndex],
                  }
                : batchResult;

          const isStop =
            messageProcessingResult && messageProcessingResult.type === 'STOP';

          const checkpointMessage =
            messageProcessingResult?.type === 'STOP'
              ? messageProcessingResult.lastSuccessfulMessage
              : messagesAboveCheckpoint[messagesAboveCheckpoint.length - 1];

          if (checkpointMessage && checkpoints) {
            const storeCheckpointResult: StoreProcessorCheckpointResult =
              await checkpoints.store(
                {
                  processorId,
                  version,
                  message: checkpointMessage as RecordedMessage<
                    MessageType,
                    MessageMetadataType
                  >,
                  lastCheckpoint,
                  partition,
                },
                context,
              );

            if (storeCheckpointResult.success) {
              // TODO: Add correct handling of the storing checkpoint
              lastCheckpoint = storeCheckpointResult.newCheckpoint;
            }
          }

          if (isStop) {
            isActive = false;
            return messageProcessingResult;
          }

          return undefined;
        }, partialContext);
      } catch (error) {
        console.log(
          `Error during message processing for processor ${processorId} with instance id ${instanceId}. Stopping the processor.`,
          error,
        );
        isActive = false;
        return {
          type: 'STOP',
          error: error as EmmettError,
          reason: 'Error during message processing',
        };
      }
    },
  };
};

export const projector = <
  EventType extends Event = Event,
  EventMetaDataType extends AnyRecordedMessageMetadata =
    AnyRecordedMessageMetadata,
  HandlerContext extends DefaultRecord = DefaultRecord,
  EventPayloadType extends Event = EventType,
>(
  options: ProjectorOptions<
    EventType,
    EventMetaDataType,
    HandlerContext,
    EventPayloadType
  >,
): MessageProcessor<EventType, EventMetaDataType, HandlerContext> => {
  const {
    projection,
    processorId = getProjectorId({
      projectionName: projection.name ?? 'unknown',
    }),
    ...rest
  } = options;

  return reactor<
    EventType,
    EventMetaDataType,
    HandlerContext,
    EventPayloadType
  >({
    ...rest,
    type: MessageProcessorType.PROJECTOR,
    canHandle: projection.canHandle,
    processorId,
    messageOptions: options.projection.eventsOptions,
    hooks: {
      onInit: options.hooks?.onInit,
      onStart:
        (options.truncateOnStart && options.projection.truncate) ||
        options.hooks?.onStart
          ? async (context: HandlerContext) => {
              if (options.truncateOnStart && options.projection.truncate)
                await options.projection.truncate(context);

              if (options.hooks?.onStart) await options.hooks?.onStart(context);
            }
          : undefined,
      onClose: options.hooks?.onClose,
    },
    eachBatch: async (
      events: RecordedMessage<EventType, EventMetaDataType>[],
      context: HandlerContext,
    ) => projection.handle(events, context),
  });
};
