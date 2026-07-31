import { v7 as uuid } from 'uuid';
import { EmmettError } from '../errors';
import { MessageSourceControlMessage } from '../eventStore/events';
import {
  ConsumerStartPositions,
  type MessageProcessor,
  type ProcessorCheckpoint,
  type WaitOptions,
} from '../processors';
import { FusionStreams } from '../streaming';
import type {
  AnyReadEventMetadata,
  Message,
  MessageHandlerContext,
  RecordedMessage,
} from '../typing';
import { asyncAwaiter, type AsyncAwaiter } from '../utils';
import type {
  MessageSource,
  MessageSourceMessage,
} from './messageSources/messageSource';
import type { ConsumerObservabilityConfig } from './observability';

/**
 * Condition that makes a running consumer stop on its own. Either key stops it
 * as soon as the source reports it has nothing left to deliver, which is what
 * drains a live stream, e.g. a blue-green projection rebuild. A message
 * appended while the consumer runs may still be processed, since the source
 * delivers it before reporting that.
 */
export type MessageConsumerUntilCondition = {
  noMessagesLeft?: boolean;
  caughtUp?: boolean;
};

/**
 * What a store's user passes to get a consumer. The store adds the source and
 * the rest of the wiring itself, see {@link MessageConsumerSetup}.
 */
export type MessageConsumerOptions<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends Message = any,
> = {
  consumerId?: string;
  observability?: ConsumerObservabilityConfig;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  processors?: Array<MessageProcessor<ConsumerMessageType, any, any>>;
  until?: MessageConsumerUntilCondition;
  defaultTimeout?: number;
};

export type MessageConsumer<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends Message = any,
> = Readonly<{
  consumerId: string;
  isRunning: boolean;
  init: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  close: () => Promise<void>;
  whenStarted: () => Promise<void>;
  /**
   * Resolves once every processor has processed up to the given position,
   * typically an append result's `lastEventGlobalPosition`. Resolves
   * immediately when that point was already processed, so a test can append
   * and then wait without racing the poller. Rejects on
   * {@link WaitOptions.timeout}.
   */
  whenProcessed: (
    position: ProcessorCheckpoint,
    options?: WaitOptions,
  ) => Promise<void>;
  /**
   * Resolves once every processor has processed up to the store's last
   * committed checkpoint as of the call. The everyday test wait: start, append,
   * `whenCaughtUp`, assert. Rejects on {@link WaitOptions.timeout}.
   */
  whenCaughtUp: (options?: WaitOptions) => Promise<void>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  processors: ReadonlyArray<MessageProcessor<ConsumerMessageType, any, any>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  processor: <ProcessorType extends MessageProcessor<any, any, any>>(
    processor: ProcessorType,
  ) => ProcessorType;
}>;

/**
 * Wraps everything the consumer does against the store, mirroring
 * {@link MessageProcessingScope} on the processor side. SQLite is the reason
 * this is a function rather than a static context object: it needs its work
 * wrapped in `pool.withConnection`.
 */
export type MessageConsumerScope<
  HandlerContext extends MessageHandlerContext | undefined = undefined,
> = <Result>(
  handler: (context: Partial<HandlerContext>) => Promise<Result>,
) => Promise<Result>;

export const DefaultConsumerBatchSize = 100;
export const DefaultConsumerBatchDeadlineInMs = 50;

export type ConsumerHooks = {
  onClose?: () => Promise<void>;
};

/**
 * Everything {@link consumer} needs to wire a source to processors, which is
 * what a store fills in around the {@link MessageConsumerOptions} it was given.
 */
export type MessageConsumerSetup<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends Message = any,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  HandlerContext extends MessageHandlerContext | undefined = undefined,
> = MessageConsumerOptions<ConsumerMessageType> & {
  source: MessageSource<ConsumerMessageType, MessageMetadataType>;
  scope?: MessageConsumerScope<HandlerContext>;
  batchSize?: number;
  /**
   * How long a partial batch may wait for more messages before the processors
   * get it anyway. Keeps a slow trickle of messages moving instead of holding
   * them until enough of them arrive to fill a batch.
   */
  batchDeadlineInMs?: number;
  hooks?: ConsumerHooks;
};

type SplitBatch<
  ConsumerMessageType extends Message,
  MessageMetadataType extends AnyReadEventMetadata,
> = {
  messages: RecordedMessage<ConsumerMessageType, MessageMetadataType>[];
  caughtUp: boolean;
};

const splitControlMessages = <
  ConsumerMessageType extends Message,
  MessageMetadataType extends AnyReadEventMetadata,
>(
  messages: MessageSourceMessage<ConsumerMessageType, MessageMetadataType>[],
): SplitBatch<ConsumerMessageType, MessageMetadataType> => {
  const result: RecordedMessage<ConsumerMessageType, MessageMetadataType>[] =
    [];
  let caughtUp = false;

  for (const message of messages) {
    if (MessageSourceControlMessage.is(message)) {
      caughtUp = true;
      continue;
    }
    result.push(message);
  }

  return { messages: result, caughtUp };
};

export const consumer = <
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends Message = any,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  HandlerContext extends MessageHandlerContext | undefined = undefined,
>(
  options: MessageConsumerSetup<
    ConsumerMessageType,
    MessageMetadataType,
    HandlerContext
  >,
): MessageConsumer<ConsumerMessageType> => {
  const { source, batchSize, batchDeadlineInMs, hooks, until } = options;

  const processors = options.processors ?? [];

  const scope: MessageConsumerScope<HandlerContext> =
    options.scope ?? ((handler) => handler({}));

  let isRunning = false;
  let isInitialized = false;
  let abortController: AbortController | null = null;
  let start: Promise<void>;

  const startedAwaiter: AsyncAwaiter<void> = asyncAwaiter<void>();

  // A processor that fails to initialise is closed there and then, so the
  // teardown that follows the failed start must not close it a second time and
  // run its onClose hook twice.
  const closedDuringInit = new Set<string>();

  const stopProcessors = () =>
    scope(async (context) => {
      const toClose = processors.filter((p) => !closedDuringInit.has(p.id));
      closedDuringInit.clear();

      await Promise.all(toClose.map((p) => p.close(context)));
    });

  const init = (): Promise<void> =>
    scope(async (context) => {
      if (isInitialized) return;

      for (const processor of processors) {
        try {
          await processor.init(context);
        } catch (error) {
          console.log(
            `Error during processor initialization for processor: ${processor.id}. Stopping it.`,
            error,
          );
          closedDuringInit.add(processor.id);
          await processor.close(context).catch((closeError) => {
            console.log(
              `Error during processor cleanup after failed initialization for processor: ${processor.id}`,
              closeError,
            );
          });
          console.log(
            `Processor ${processor.id} stopped successfully after failed initialization.`,
          );
          throw error;
        }
      }

      isInitialized = true;
    });

  const stop = async () => {
    if (!isRunning) return;
    isRunning = false;

    abortController?.abort();

    try {
      await start;
    } catch (error) {
      console.log('Error during consumer stop:', error);
    }

    abortController = null;
  };

  return {
    consumerId: options.consumerId ?? uuid(),
    get isRunning() {
      return isRunning;
    },
    processors,
    whenStarted: (): Promise<void> => startedAwaiter.wait,
    whenProcessed: (position, waitOptions): Promise<void> =>
      Promise.all(
        processors.map((p) => p.whenProcessed(position, waitOptions)),
      ).then(() => undefined),
    whenCaughtUp: async (waitOptions): Promise<void> => {
      const lastCheckpoint = await source.readLastMessageCheckpoint();

      if (lastCheckpoint === null) return;

      await Promise.all(
        processors.map((p) => p.whenProcessed(lastCheckpoint, waitOptions)),
      );
    },
    init,
    processor: (processor) => {
      processors.push(processor);

      return processor;
    },
    start: () => {
      if (isRunning) {
        console.log(
          'Consumer is already running. Returning the existing start promise.',
        );
        return start;
      }

      startedAwaiter.reset();

      if (processors.length === 0) {
        const error = new EmmettError(
          'Cannot start consumer without at least a single processor',
        );
        startedAwaiter.reject(error);
        return Promise.reject(error);
      }

      isRunning = true;
      const controller = new AbortController();
      abortController = controller;

      start = (async () => {
        try {
          if (!isInitialized) await init();

          const startPositions = await ConsumerStartPositions.resolve({
            processors,
            handlerContext: {},
            scope,
            readLastMessageCheckpoint: () => source.readLastMessageCheckpoint(),
          });

          const handleBatch = (
            messages: RecordedMessage<
              ConsumerMessageType,
              MessageMetadataType
            >[],
          ) =>
            scope(async (context) => {
              const active = processors.filter((p) => p.isActive);
              if (active.length === 0) return 'STOP' as const;

              const results = await Promise.allSettled(
                active.map(async (p) => {
                  try {
                    return await p.handle(
                      startPositions.afterStartPosition(p.id, messages),
                      context,
                    );
                  } catch (error) {
                    console.log(
                      `Error during message batch processing for processor: ${p.id}`,
                      error,
                    );
                    throw error;
                  }
                }),
              );

              const failure = results.find((r) => r.status === 'rejected');

              if (failure) {
                throw EmmettError.mapFrom(
                  failure.reason as Error | { message?: string },
                );
              }

              const allSucceeded = results.some(
                (r) => r.status === 'fulfilled' && r.value?.type !== 'STOP',
              );

              return allSucceeded ? 'CONTINUE' : 'STOP';
            });

          startedAwaiter.resolve();

          const batches = FusionStreams.from(
            source.read({
              from: startPositions.earliestPosition,
              batchSize,
              signal: controller.signal,
            }),
            { signal: controller.signal },
          ).chunk({
            size: batchSize ?? DefaultConsumerBatchSize,
            deadlineInMs: batchDeadlineInMs ?? DefaultConsumerBatchDeadlineInMs,
          });

          for await (const batch of batches) {
            const { messages, caughtUp } = splitControlMessages(batch);

            if (messages.length > 0) {
              const result = await handleBatch(messages);

              if (result === 'STOP') {
                controller.abort();
                break;
              }
            }

            if (
              caughtUp &&
              (until?.noMessagesLeft === true || until?.caughtUp === true)
            ) {
              controller.abort();
              break;
            }
          }
        } catch (error) {
          startedAwaiter.reject(error);
          throw error;
        } finally {
          isRunning = false;
          await stopProcessors();
        }
      })();

      return start;
    },
    stop,
    close: async () => {
      await stop();
      if (source.close) await source.close();
      if (hooks?.onClose) await hooks.onClose();
    },
  };
};
