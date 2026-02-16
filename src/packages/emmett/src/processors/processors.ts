import { v7 as uuid } from 'uuid';
import type { EmmettError } from '../errors';
import { upcastRecordedMessage } from '../eventStore';
import type { ProjectionDefinition } from '../projections';
import {
  defaultTag,
  type AnyEvent,
  type AnyMessage,
  type AnyReadEventMetadata,
  type AnyRecordedMessageMetadata,
  type BatchRecordedMessageHandlerWithContext,
  type Brand,
  type CanHandle,
  type DefaultRecord,
  type Event,
  type Message,
  type MessageHandlerResult,
  type RecordedMessage,
  type SingleMessageHandlerWithContext,
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

export type MessageProcessingScope<
  HandlerContext extends DefaultRecord | undefined = undefined,
> = <Result = MessageHandlerResult>(
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
};

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
  Result = MessageHandlerResult,
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

  const eachMessage: SingleMessageHandlerWithContext<
    MessageType,
    MessageMetadataType,
    HandlerContext
  > =
    'eachMessage' in options && options.eachMessage
      ? options.eachMessage
      : () => Promise.resolve();

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
    init,
    start: async (
      startOptions: Partial<HandlerContext>,
    ): Promise<CurrentMessageProcessorPosition | undefined> => {
      if (isActive) return;

      await init(startOptions);

      isActive = true;

      closeSignal = onShutdown(() => close(startOptions));

      if (lastCheckpoint !== null)
        return {
          lastCheckpoint,
        };

      return await processingScope(async (context) => {
        if (hooks.onStart) {
          await hooks.onStart(context);
        }

        if (startFrom && startFrom !== 'CURRENT') return startFrom;

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

        if (lastCheckpoint === null) return 'BEGINNING';

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
    ): Promise<MessageHandlerResult> => {
      if (!isActive) return Promise.resolve();

      return await processingScope(async (context) => {
        let result: MessageHandlerResult = undefined;

        for (const message of messages) {
          if (wasMessageHandled(message, lastCheckpoint)) continue;

          const upcasted = upcastRecordedMessage(
            // TODO: Make it smarter
            message as unknown as RecordedMessage<
              MessagePayloadType,
              MessageMetadataType
            >,
            options.messageOptions?.schema?.versioning,
          );

          if (canHandle !== undefined && !canHandle.includes(upcasted.type))
            continue;

          const messageProcessingResult = await eachMessage(upcasted, context);

          if (checkpoints) {
            const storeCheckpointResult: StoreProcessorCheckpointResult =
              await checkpoints.store(
                {
                  processorId,
                  version,
                  message: upcasted,
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

          if (
            messageProcessingResult &&
            messageProcessingResult.type === 'STOP'
          ) {
            isActive = false;
            result = messageProcessingResult;
            break;
          }

          if (stopAfter && stopAfter(upcasted)) {
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
      }, partialContext);
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
    eachMessage: async (
      event: RecordedMessage<EventType, EventMetaDataType>,
      context: HandlerContext,
    ) => projection.handle([event], context),
  });
};
