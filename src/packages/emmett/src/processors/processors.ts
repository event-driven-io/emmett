import { v7 as uuid } from 'uuid';
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
  type MessageHandlerResult,
  type RecordedMessage,
  type SingleMessageHandlerWithContext,
  type SingleRecordedMessageHandlerWithContext,
} from '../typing';
import { isBigint } from '../validation';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CurrentMessageProcessorPosition<CheckpointType = any> =
  | { lastCheckpoint: CheckpointType }
  | 'BEGINNING'
  | 'END';

export type GetCheckpoint<
  MessageType extends AnyMessage = AnyMessage,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  CheckpointType =
    GlobalPositionTypeOfRecordedMessageMetadata<MessageMetadataType>,
> = (
  message: RecordedMessage<MessageType, MessageMetadataType>,
) => CheckpointType | null;

export const getCheckpoint = <
  MessageType extends AnyMessage = AnyMessage,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  CheckpointType =
    GlobalPositionTypeOfRecordedMessageMetadata<MessageMetadataType>,
>(
  message: RecordedMessage<MessageType, MessageMetadataType>,
): CheckpointType | null => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return 'checkpoint' in message.metadata
    ? // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      message.metadata.checkpoint
    : 'globalPosition' in message.metadata &&
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        isBigint(message.metadata.globalPosition)
      ? // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        message.metadata.globalPosition
      : 'streamPosition' in message.metadata &&
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          isBigint(message.metadata.streamPosition)
        ? // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          message.metadata.streamPosition
        : null;
};

export const wasMessageHandled = <
  MessageType extends AnyMessage = AnyMessage,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  CheckpointType =
    GlobalPositionTypeOfRecordedMessageMetadata<MessageMetadataType>,
>(
  message: RecordedMessage<MessageType, MessageMetadataType>,
  checkpoint: CheckpointType | null,
): boolean => {
  //TODO Make it smarter
  const messageCheckpoint = getCheckpoint(message);
  const checkpointBigint = checkpoint as bigint | null;

  return (
    messageCheckpoint !== null &&
    messageCheckpoint !== undefined &&
    checkpointBigint !== null &&
    checkpointBigint !== undefined &&
    messageCheckpoint <= checkpointBigint
  );
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MessageProcessorStartFrom<CheckpointType = any> =
  | CurrentMessageProcessorPosition<CheckpointType>
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
  CheckpointType =
    GlobalPositionTypeOfRecordedMessageMetadata<MessageMetadataType>,
> = {
  id: string;
  instanceId: string;
  type: string;
  init: (options: Partial<HandlerContext>) => Promise<void>;
  start: (
    options: Partial<HandlerContext>,
  ) => Promise<CurrentMessageProcessorPosition<CheckpointType> | undefined>;
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
  CheckpointType =
    GlobalPositionTypeOfRecordedMessageMetadata<MessageMetadataType>,
> = {
  read: ReadProcessorCheckpoint<CheckpointType, HandlerContext>;
  store: StoreProcessorCheckpoint<
    MessageType,
    MessageMetadataType,
    CheckpointType,
    HandlerContext
  >;
};

export type BaseMessageProcessorOptions<
  MessageType extends AnyMessage = AnyMessage,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  HandlerContext extends DefaultRecord = DefaultRecord,
  CheckpointType =
    GlobalPositionTypeOfRecordedMessageMetadata<MessageMetadataType>,
> = {
  type?: string;
  processorId: string;
  processorInstanceId?: string;
  version?: number;
  partition?: string;
  startFrom?: MessageProcessorStartFrom<CheckpointType>;
  stopAfter?: (
    message: RecordedMessage<MessageType, MessageMetadataType>,
  ) => boolean;
  processingScope?: MessageProcessingScope<HandlerContext>;
  checkpoints?: Checkpointer<
    MessageType,
    MessageMetadataType,
    HandlerContext,
    CheckpointType
  >;
  canHandle?: CanHandle<MessageType>;
  hooks?: {
    onInit?: OnReactorInitHook<HandlerContext>;
    onStart?: OnReactorStartHook<HandlerContext>;
    onClose?: OnReactorCloseHook<HandlerContext>;
  };
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
  CheckpointType =
    GlobalPositionTypeOfRecordedMessageMetadata<MessageMetadataType>,
> = BaseMessageProcessorOptions<
  MessageType,
  MessageMetadataType,
  HandlerContext,
  CheckpointType
> &
  HandlerOptions<MessageType, MessageMetadataType, HandlerContext>;

export type ProjectorOptions<
  EventType extends AnyEvent = AnyEvent,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  HandlerContext extends DefaultRecord = DefaultRecord,
  CheckpointType =
    GlobalPositionTypeOfRecordedMessageMetadata<MessageMetadataType>,
> = Omit<
  BaseMessageProcessorOptions<
    EventType,
    MessageMetadataType,
    HandlerContext,
    CheckpointType
  >,
  'type' | 'processorId'
> & { processorId?: string } & {
  truncateOnStart?: boolean;
  projection: ProjectionDefinition<
    EventType,
    MessageMetadataType,
    HandlerContext
  >;
};

export const defaultProcessingMessageProcessingScope = <
  HandlerContext = never,
  Result = MessageHandlerResult,
>(
  handler: (context: HandlerContext) => Result | Promise<Result>,
  partialContext: Partial<HandlerContext>,
) => handler(partialContext as HandlerContext);

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
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  CheckpointType = unknown,
  HandlerContext extends DefaultRecord | undefined = undefined,
> =
  | ((
      options: {
        message: RecordedMessage<MessageType, MessageMetadataType>;
        processorId: string;
        version: number | undefined;
        lastCheckpoint: CheckpointType | null;
        partition?: string;
      },
      context: HandlerContext,
    ) => Promise<StoreProcessorCheckpointResult<CheckpointType | null>>)
  | ((
      options: {
        message: RecordedMessage<MessageType, MessageMetadataType>;
        processorId: string;
        version: number | undefined;
        lastCheckpoint: CheckpointType | null;
        partition?: string;
      },
      context: HandlerContext,
    ) => Promise<StoreProcessorCheckpointResult<CheckpointType>>);

export const reactor = <
  MessageType extends Message = AnyMessage,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  HandlerContext extends DefaultRecord = DefaultRecord,
  CheckpointType =
    GlobalPositionTypeOfRecordedMessageMetadata<MessageMetadataType>,
>(
  options: ReactorOptions<
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
  > =
    'eachMessage' in options && options.eachMessage
      ? options.eachMessage
      : () => Promise.resolve();

  let isInitiated = false;
  let isActive = true;

  const { checkpoints, processorId, partition } = options;

  const processingScope =
    options.processingScope ?? defaultProcessingMessageProcessingScope;

  let lastCheckpoint: CheckpointType | null = null;

  const init = async (initOptions: Partial<HandlerContext>): Promise<void> => {
    if (isInitiated) return;

    if (!options.hooks?.onInit) {
      isInitiated = true;
      return;
    }

    return await processingScope(async (context) => {
      await options.hooks?.onInit!(context);
      isInitiated = true;
    }, initOptions);
  };

  return {
    // TODO: Consider whether not make it optional or add URN prefix
    id: options.processorId,
    instanceId: options.processorInstanceId ?? `${processorId}:${uuid()}`,
    type: options.type ?? MessageProcessorType.REACTOR,
    init,
    start: async (
      startOptions: Partial<HandlerContext>,
    ): Promise<CurrentMessageProcessorPosition<CheckpointType> | undefined> => {
      if (isActive) return;

      await init(startOptions);

      isActive = true;

      if (lastCheckpoint !== null)
        return {
          lastCheckpoint,
        };

      return await processingScope(async (context) => {
        if (options.hooks?.onStart) {
          await options.hooks?.onStart(context);
        }

        if (options.startFrom !== 'CURRENT' && options.startFrom)
          return options.startFrom;

        if (checkpoints) {
          const readResult = await checkpoints?.read(
            {
              processorId: processorId,
              partition: partition,
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
    close: async (closeOptions) => {
      return await processingScope(
        async (context) =>
          options.hooks?.onClose
            ? options.hooks?.onClose(context)
            : Promise.resolve(),
        closeOptions,
      );
    },
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
      }, partialContext);
    },
  };
};

export const projector = <
  EventType extends Event = Event,
  EventMetaDataType extends AnyRecordedMessageMetadata =
    AnyRecordedMessageMetadata,
  HandlerContext extends DefaultRecord = DefaultRecord,
  CheckpointType =
    GlobalPositionTypeOfRecordedMessageMetadata<EventMetaDataType>,
>(
  options: ProjectorOptions<
    EventType,
    EventMetaDataType,
    HandlerContext,
    CheckpointType
  >,
): MessageProcessor<
  EventType,
  EventMetaDataType,
  HandlerContext,
  CheckpointType
> => {
  const { projection, ...rest } = options;

  return reactor<EventType, EventMetaDataType, HandlerContext, CheckpointType>({
    ...rest,
    type: MessageProcessorType.PROJECTOR,
    processorId:
      options.processorId ?? `emt:processor:projector:${projection.name}`,
    hooks: {
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
    ) => {
      if (!projection.canHandle.includes(event.type)) return;

      await projection.handle([event], context);
    },
  });
};
