import {
  consoleLogger,
  noopScope,
  type Logger,
} from '@event-driven-io/almanac';
import { v7 as uuid } from 'uuid';
import type { EmmettError } from '../errors';
import { upcastRecordedMessage } from '../eventStore';
import type { WithObservabilityScope } from '../observability';
import { EmmettAttributes } from '../observability';
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
  type CanHandle,
  type Event,
  type Message,
  type MessageHandlerContext,
  type RecordedMessage,
  type SingleMessageHandlerResult,
  type SingleRecordedMessageHandlerWithContext,
} from '../typing';
import { onShutdown } from '../utils/shutdown';
import {
  getCheckpoint,
  type Checkpointer,
  type ProcessorCheckpoint,
  type StoreProcessorCheckpointResult,
} from './checkpoints';
import {
  processorCollector,
  resolveProcessorObservability,
  type ProcessorObservabilityConfig,
} from './observability';

export type CurrentMessageProcessorPosition =
  | { lastCheckpoint: ProcessorCheckpoint }
  | 'BEGINNING'
  | 'END';

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
  HandlerContext extends MessageHandlerContext | undefined = undefined,
> = {
  id: string;
  instanceId: string;
  type: string;
  canHandle?: string[];
  init: (options?: Partial<HandlerContext>) => Promise<void>;
  start: (
    options?: Partial<HandlerContext>,
  ) => Promise<CurrentMessageProcessorPosition | undefined>;
  close: (closeOptions?: Partial<HandlerContext>) => Promise<void>;
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
  HandlerContext extends MessageHandlerContext | undefined = undefined,
> = <Result = SingleMessageHandlerResult>(
  handler: (context: HandlerContext) => Result | Promise<Result>,
  partialContext: WithObservabilityScope<Partial<HandlerContext>>,
) => Result | Promise<Result>;

export type ProcessorHooks<
  HandlerContext extends MessageHandlerContext = MessageHandlerContext,
> = {
  onInit?: OnReactorInitHook<HandlerContext>;
  onStart?: OnReactorStartHook<HandlerContext>;
  onClose?: OnReactorCloseHook<HandlerContext>;
};

export type BaseMessageProcessorOptions<
  MessageType extends AnyMessage = AnyMessage,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  HandlerContext extends MessageHandlerContext = MessageHandlerContext,
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
  logger?: Logger;
} & JSONSerializationOptions & {
    observability?: ProcessorObservabilityConfig;
  };

export type HandlerOptions<
  MessageType extends AnyMessage = AnyMessage,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  HandlerContext extends MessageHandlerContext = MessageHandlerContext,
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
  HandlerContext extends MessageHandlerContext = MessageHandlerContext,
> = (context: HandlerContext) => Promise<void>;

export type OnReactorStartHook<
  HandlerContext extends MessageHandlerContext = MessageHandlerContext,
> = (context: HandlerContext) => Promise<void>;

export type OnReactorCloseHook<
  HandlerContext extends MessageHandlerContext = MessageHandlerContext,
> = (context: HandlerContext) => Promise<void>;

export type ReactorOptions<
  MessageType extends AnyMessage = AnyMessage,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  HandlerContext extends MessageHandlerContext = MessageHandlerContext,
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
  HandlerContext extends MessageHandlerContext = MessageHandlerContext,
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
  handler: (
    context: WithObservabilityScope<HandlerContext>,
  ) => Result | Promise<Result>,
  partialContext: WithObservabilityScope<Partial<HandlerContext>>,
) =>
  handler({
    ...partialContext,
    observabilityScope: partialContext.observabilityScope ?? noopScope,
  } as WithObservabilityScope<HandlerContext>);

export const defaultProcessorVersion = 1;
export const defaultProcessorPartition = defaultTag;

export const getProcessorInstanceId = (processorId: string): string =>
  `${processorId}:${uuid()}`;

export const getProjectorId = (options: { projectionName: string }): string =>
  `emt:processor:projector:${options.projectionName}`;

export const reactor = <
  MessageType extends Message = AnyMessage,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  HandlerContext extends MessageHandlerContext = MessageHandlerContext,
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
    logger = consoleLogger,
  } = options;

  const collector = processorCollector(resolveProcessorObservability(options));

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
        const batchCtx = context.observabilityScope.spanContext();

        let result: BatchMessageHandlerResult = undefined;
        for (let i = 0; i < messages.length; i++) {
          const message = messages[i]!;
          const messageProcessingResult = await collector.startMessageScope(
            {
              processorId,
              type,
              checkpoint: lastCheckpoint,
              archetypeType: type,
            },
            message,
            batchCtx,
            (messageScope) =>
              Promise.resolve(
                options.eachMessage(message, {
                  ...context,
                  observabilityScope: messageScope,
                }),
              ),
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

  const init = async (
    initOptions: WithObservabilityScope<Partial<HandlerContext>>,
  ): Promise<void> => {
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
    closeOptions: WithObservabilityScope<Partial<HandlerContext>>,
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
    init: async (partialOptions) => {
      partialOptions ??= {};
      const options: WithObservabilityScope<Partial<HandlerContext>> = {
        ...partialOptions,
        // TODO: Consider adding explicit init scope
        observabilityScope:
          ('observabilityScope' in partialOptions
            ? (partialOptions.observabilityScope ?? noopScope)
            : noopScope) ?? noopScope,
      };

      await init(options);
    },
    start: async (
      partialOptions?: Partial<HandlerContext>,
    ): Promise<CurrentMessageProcessorPosition | undefined> => {
      partialOptions ??= {};

      const startOptions: WithObservabilityScope<Partial<HandlerContext>> = {
        ...partialOptions,
        // TODO: Consider adding explicit start scope
        observabilityScope:
          ('observabilityScope' in partialOptions
            ? (partialOptions.observabilityScope ?? noopScope)
            : noopScope) ?? noopScope,
      };

      if (isActive) {
        logger.info(
          `Processor ${processorId} with instance id ${instanceId} is already active. Start request ignored.`,
        );
        return;
      }

      logger.info(
        `Starting processor ${processorId} with instance id ${instanceId}`,
      );

      await init(startOptions);

      isActive = true;

      closeSignal = onShutdown(() => close(startOptions));

      if (lastCheckpoint !== null) {
        logger.info(
          `Processor ${processorId} started with instance id ${instanceId}, checkpoint: ${JSONSerializer.serialize(lastCheckpoint)}`,
        );
        return {
          lastCheckpoint,
        };
      }

      return await processingScope(async (context) => {
        if (hooks.onStart) {
          logger.info(
            `Executing onStart hook for processor ${processorId} with instance id ${instanceId}`,
          );
          await hooks.onStart(context);
        }

        if (startFrom && startFrom !== 'CURRENT') {
          logger.info(
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
          logger.info(
            `Processor ${processorId} with instance id ${instanceId} starting from: BEGINNING`,
          );
          return 'BEGINNING';
        }
        logger.info(
          `Checkpoint read for processor ${processorId} with instance id ${instanceId}: ${JSONSerializer.serialize(lastCheckpoint)}`,
        );

        return {
          lastCheckpoint,
        };
      }, startOptions);
    },
    close: async (partialOptions) => {
      partialOptions ??= {};
      const options: WithObservabilityScope<Partial<HandlerContext>> = {
        ...partialOptions,
        // TODO: Consider adding explicit close scope
        observabilityScope:
          ('observabilityScope' in partialOptions
            ? (partialOptions.observabilityScope ?? noopScope)
            : noopScope) ?? noopScope,
      };
      await close(options);
    },
    get isActive() {
      return isActive;
    },
    handle: async (
      messages: RecordedMessage<MessageType, MessageMetadataType>[],
      partialContext: Partial<HandlerContext>,
    ): Promise<BatchMessageHandlerResult> => {
      if (!isActive) return Promise.resolve();

      return collector.startScope(
        { processorId, type, checkpoint: lastCheckpoint },
        messages,
        async (scope) => {
          try {
            return await processingScope(
              async (context) => {
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
                    (upcasted) =>
                      !canHandle || canHandle.includes(upcasted.type),
                  );

                const stopMessageIndex =
                  isCustomBatch && stopAfter
                    ? upcastedMessages.findIndex(stopAfter)
                    : -1;

                const unhandledMessages =
                  stopMessageIndex !== -1
                    ? upcastedMessages.slice(0, stopMessageIndex + 1)
                    : upcastedMessages;

                const batchResult = await eachBatch(unhandledMessages, {
                  ...context,
                  observabilityScope: scope,
                });

                const messageProcessingResult: BatchMessageHandlerResult =
                  batchResult?.type === 'STOP'
                    ? batchResult
                    : stopMessageIndex !== -1
                      ? {
                          type: 'STOP',
                          reason: 'Stop condition reached',
                          lastSuccessfulMessage:
                            unhandledMessages[stopMessageIndex],
                        }
                      : batchResult;

                const isStop =
                  messageProcessingResult &&
                  messageProcessingResult.type === 'STOP';

                const checkpointMessage =
                  messageProcessingResult?.type === 'STOP'
                    ? messageProcessingResult.lastSuccessfulMessage
                    : messagesAboveCheckpoint[
                        messagesAboveCheckpoint.length - 1
                      ];

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

                scope.setAttributes({
                  [EmmettAttributes.processor.status]:
                    messageProcessingResult?.type ?? 'ack',
                });

                if (isStop) {
                  isActive = false;
                  return messageProcessingResult;
                }

                return undefined;
              },
              { ...partialContext, observabilityScope: scope },
            );
          } catch (error) {
            logger.error(
              { err: error },
              `Error during message processing for processor ${processorId} with instance id ${instanceId}. Stopping the processor.`,
            );
            isActive = false;
            return {
              type: 'STOP',
              error: error as EmmettError,
              reason: 'Error during message processing',
            };
          }
        },
      );
    },
  };
};

export const projector = <
  EventType extends Event = Event,
  EventMetaDataType extends AnyRecordedMessageMetadata =
    AnyRecordedMessageMetadata,
  HandlerContext extends MessageHandlerContext = MessageHandlerContext,
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
          ? async (context) => {
              if (options.truncateOnStart && options.projection.truncate)
                await options.projection.truncate(context);

              if (options.hooks?.onStart) await options.hooks?.onStart(context);
            }
          : undefined,
      onClose: options.hooks?.onClose,
    },
    eachBatch: (events, context) => projection.handle(events, context),
  });
};
