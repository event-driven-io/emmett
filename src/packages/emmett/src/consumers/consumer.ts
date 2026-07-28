import { v7 as uuid } from 'uuid';
import { EmmettError } from '../errors';
import { isSubscriptionEvent } from '../eventStore/events';
import {
  ConsumerStartPositions,
  ProcessorCheckpoint,
  type MessageProcessor,
  type WaitOptions,
} from '../processors';
import type {
  AnyMessage,
  AnyReadEventMetadata,
  Event,
  Message,
  MessageHandlerContext,
  RecordedMessage,
} from '../typing';
import { asyncAwaiter, type AsyncAwaiter } from '../utils';
import type { MessageConsumer, MessageConsumerOptions } from './consumers';
import type { MessageSource, MessageSourceMessage } from './messageSource';

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

export type ConsumerHooks = {
  onClose?: () => Promise<void>;
};

export type ConsumerOptions<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends Message = any,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  HandlerContext extends MessageHandlerContext | undefined = undefined,
> = MessageConsumerOptions<ConsumerMessageType> & {
  source: MessageSource<ConsumerMessageType, MessageMetadataType>;
  scope?: MessageConsumerScope<HandlerContext>;
  batchSize?: number;
  hooks?: ConsumerHooks;
};

export type Consumer<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends AnyMessage = any,
> = MessageConsumer<ConsumerMessageType> &
  Readonly<{
    whenProcessed: (
      position: ProcessorCheckpoint,
      options?: WaitOptions,
    ) => Promise<void>;
    whenCaughtUp: (options?: WaitOptions) => Promise<void>;
    init: () => Promise<void>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    register: <ProcessorType extends MessageProcessor<any, any, any>>(
      processor: ProcessorType,
    ) => ProcessorType;
  }>;

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
    if (isSubscriptionEvent(message as Event)) {
      caughtUp = true;
      continue;
    }
    result.push(
      message as RecordedMessage<ConsumerMessageType, MessageMetadataType>,
    );
  }

  return { messages: result, caughtUp };
};

export const consumer = <
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends Message = any,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  HandlerContext extends MessageHandlerContext | undefined = undefined,
>(
  options: ConsumerOptions<
    ConsumerMessageType,
    MessageMetadataType,
    HandlerContext
  >,
): Consumer<ConsumerMessageType> => {
  const { source, batchSize, hooks, until } = options;

  const processors = options.processors ?? [];

  const scope: MessageConsumerScope<HandlerContext> =
    options.scope ?? ((handler) => handler({}));

  const compareCheckpoints =
    source.compareCheckpoints ?? ProcessorCheckpoint.compare;

  const readTail = () =>
    source.readLastCommittedCheckpoint
      ? source.readLastCommittedCheckpoint()
      : source.readLastCheckpoint();

  let isRunning = false;
  let isInitialized = false;
  let abortController: AbortController | null = null;
  let start: Promise<void>;

  const startedAwaiter: AsyncAwaiter<void> = asyncAwaiter<void>();

  const stopProcessors = () =>
    scope((context) =>
      Promise.all(processors.map((p) => p.close(context))).then(
        () => undefined,
      ),
    );

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
      const tail = await readTail();

      if (tail === null) return;

      await Promise.all(
        processors.map((p) => p.whenProcessed(tail, waitOptions)),
      );
    },
    init,
    register: (processor) => {
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
        console.log(
          'Cannot start consumer without at least a single processor',
        );
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

          // Read outside the scope: a scope can hold an exclusive store
          // resource (SQLite's is a single pooled connection), and reading the
          // tail from within it would deadlock waiting for itself.
          const lastCheckpoint = await source.readLastCheckpoint();

          const startPositions = await scope((context) =>
            ConsumerStartPositions.resolve({
              processors,
              handlerContext: context,
              readLastMessageCheckpoint: () => Promise.resolve(lastCheckpoint),
              compareCheckpoints: source.compareCheckpoints,
            }),
          );

          const startTail = until?.caughtUp ? await readTail() : null;

          startedAwaiter.resolve();

          if (until?.caughtUp && startTail === null) return;

          const handleBatch = (
            messages: RecordedMessage<
              ConsumerMessageType,
              MessageMetadataType
            >[],
          ) =>
            scope(async (context) => {
              const activeProcessors = processors.filter((p) => p.isActive);

              if (activeProcessors.length === 0) return 'STOP' as const;

              const results = await Promise.allSettled(
                activeProcessors.map(async (p) => {
                  const batch = startPositions.afterStartPosition(
                    p.id,
                    messages,
                  );
                  try {
                    return await p.handle(batch, context);
                  } catch (error) {
                    console.log(
                      `Error during message batch processing for processor: ${p.id}`,
                      error,
                    );
                    throw error;
                  }
                }),
              );

              const kept = results.some(
                (r) => r.status === 'fulfilled' && r.value?.type !== 'STOP',
              );

              if (kept) return 'CONTINUE' as const;

              const rejected = results.find((r) => r.status === 'rejected');

              if (rejected)
                throw EmmettError.mapFrom(
                  rejected.reason as Error | { message?: string },
                );

              return 'STOP' as const;
            });

          for await (const sourceBatch of source.read({
            from: startPositions.earliestPosition,
            batchSize,
            signal: controller.signal,
          })) {
            const { messages, caughtUp } = splitControlMessages(
              sourceBatch.messages,
            );

            if (messages.length > 0 && (await handleBatch(messages)) === 'STOP')
              break;

            if (caughtUp && until?.noMessagesLeft) break;

            if (
              until?.caughtUp &&
              startTail !== null &&
              sourceBatch.lastCheckpoint !== null &&
              compareCheckpoints(sourceBatch.lastCheckpoint, startTail) >= 0
            )
              break;
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
