import {
  LogEvent,
  type ObservabilityScope,
  type SpanLink,
} from '@event-driven-io/almanac';
import { v7 as uuid } from 'uuid';
import { EmmettError } from '../errors';
import { MessageSourceControlMessage } from '../eventStore/events';
import {
  type AnyMessageProcessorFactory,
  ConsumerStartPositions,
  type MessageProcessor,
  type ProcessorCheckpoint,
  type RegisterMessageProcessor,
  type WaitOptions,
  withMessageProcessorFactory,
} from '../processors';
import {
  EmmettAttributes,
  EmmettSpans,
  mergeObservability,
  type EmmettObservabilityConfig,
} from '../observability';
import { FusionStreams } from '../streaming';
import type {
  AnyEvent,
  AnyReadEventMetadata,
  Message,
  AnyMessageHandlerContext,
  PartialHandlerContext,
  RecordedMessage,
} from '../typing';
import { asyncAwaiter, type AsyncAwaiter } from '../utils';
import type {
  MessageSource,
  MessageSourceMessage,
} from './messageSources/messageSource';
import {
  consumerCollector,
  consumerObservability,
  type ConsumerObservabilityConfig,
} from './observability';

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
  ReactorFactory extends AnyMessageProcessorFactory<ConsumerMessageType> =
    never,
  ProjectorFactory extends AnyMessageProcessorFactory<ConsumerMessageType> =
    never,
  WorkflowProcessorFactory extends
    AnyMessageProcessorFactory<ConsumerMessageType> = never,
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

  reactor: ([ReactorFactory] extends [never] ? unknown : ReactorFactory) &
    RegisterMessageProcessor<ConsumerMessageType>;
  projector: ([ProjectorFactory] extends [never] ? unknown : ProjectorFactory) &
    RegisterMessageProcessor<ConsumerMessageType & AnyEvent>;
  workflowProcessor: ([WorkflowProcessorFactory] extends [never]
    ? unknown
    : WorkflowProcessorFactory) &
    RegisterMessageProcessor<ConsumerMessageType>;
}>;

/**
 * Wraps everything the consumer does against the store, mirroring
 * {@link MessageProcessingScope} on the processor side. SQLite is the reason
 * this is a function rather than a static context object: it needs its work
 * wrapped in `pool.withConnection`.
 */
export type MessageConsumerScope<
  HandlerContext extends AnyMessageHandlerContext = AnyMessageHandlerContext,
> = <Result>(
  handler: (context: PartialHandlerContext<HandlerContext>) => Promise<Result>,
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
  HandlerContext extends AnyMessageHandlerContext = AnyMessageHandlerContext,
  ReactorFactory extends AnyMessageProcessorFactory<ConsumerMessageType> =
    never,
  ProjectorFactory extends AnyMessageProcessorFactory<ConsumerMessageType> =
    never,
  WorkflowProcessorFactory extends
    AnyMessageProcessorFactory<ConsumerMessageType> = never,
> = MessageConsumerOptions<ConsumerMessageType> & {
  source: MessageSource<ConsumerMessageType, MessageMetadataType>;
  reactorFactory: ReactorFactory;
  projectorFactory: ProjectorFactory;
  workflowProcessorFactory: WorkflowProcessorFactory;
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
  HandlerContext extends AnyMessageHandlerContext = AnyMessageHandlerContext,
  ReactorFactory extends AnyMessageProcessorFactory<ConsumerMessageType> =
    never,
  ProjectorFactory extends AnyMessageProcessorFactory<ConsumerMessageType> =
    never,
  WorkflowProcessorFactory extends
    AnyMessageProcessorFactory<ConsumerMessageType> = never,
>(
  options: MessageConsumerSetup<
    ConsumerMessageType,
    MessageMetadataType,
    HandlerContext,
    ReactorFactory,
    ProjectorFactory,
    WorkflowProcessorFactory
  >,
): MessageConsumer<
  ConsumerMessageType,
  ReactorFactory,
  ProjectorFactory,
  WorkflowProcessorFactory
> => {
  const { source, batchSize, batchDeadlineInMs, hooks, until } = options;

  const processors = options.processors ?? [];

  const scope: MessageConsumerScope<HandlerContext> =
    options.scope ?? ((handler) => handler({}));

  const consumerId = options.consumerId ?? uuid();
  const collector = consumerCollector(consumerObservability(options));
  const lifecycleContext = () => ({
    consumerId,
    processorCount: processors.length,
  });

  const withObservabilityScope =
    (
      observabilityScope: ObservabilityScope,
    ): MessageConsumerScope<HandlerContext> =>
    (handler) =>
      scope((context) => handler({ ...context, observabilityScope }));

  let isRunning = false;
  let isInitialized = false;
  let abortController: AbortController | null = null;
  let start: Promise<void>;

  const startedAwaiter: AsyncAwaiter<void> = asyncAwaiter<void>();

  const register: RegisterMessageProcessor<ConsumerMessageType> = (
    processor,
  ) => {
    if (!processors.includes(processor)) processors.push(processor);

    return processor;
  };

  const withMergedObservability = (processorOptions: unknown): unknown => {
    if (typeof processorOptions !== 'object' || processorOptions === null)
      return processorOptions;

    const optionsWithObservability = processorOptions as {
      observability?: EmmettObservabilityConfig;
    };

    return {
      ...processorOptions,
      observability: mergeObservability(
        options.observability,
        optionsWithObservability.observability,
      ),
    };
  };

  // A processor that fails to initialise is closed there and then, so the
  // teardown that follows the failed start must not close it a second time and
  // run its onClose hook twice.
  const closedDuringInit = new Set<string>();

  const stopProcessors = (observabilityScope: ObservabilityScope) =>
    withObservabilityScope(observabilityScope)(async (context) => {
      const toClose = processors.filter((p) => !closedDuringInit.has(p.id));
      closedDuringInit.clear();

      await Promise.all(toClose.map((p) => p.close(context)));
    });

  let failedProcessorId: string | undefined;

  const init = (observabilityScope?: ObservabilityScope): Promise<void> =>
    (observabilityScope ? withObservabilityScope(observabilityScope) : scope)(
      async (context) => {
        if (isInitialized) return;

        for (const processor of processors) {
          try {
            await processor.init(context);
          } catch (error) {
            failedProcessorId = processor.id;
            closedDuringInit.add(processor.id);
            await processor.close(context).catch((closeError: unknown) => {
              context.observabilityScope?.log(
                LogEvent(
                  'Processor cleanup after failed init failed',
                  {
                    body: 'Processor cleanup after failed init failed',
                    error: closeError as Error,
                    attributes: {
                      [EmmettAttributes.processor.id]: processor.id,
                    },
                  },
                  { level: 'warn' },
                ),
              );
            });
            throw error;
          }
        }

        isInitialized = true;
      },
    );

  const stop = async () => {
    if (!isRunning) return;
    isRunning = false;

    abortController?.abort();

    // a failed run was already logged as "Consumer stopped"
    await start.catch(() => {});

    abortController = null;
  };

  return {
    consumerId,
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
    init: () => init(),
    reactor: withMessageProcessorFactory(
      register,
      options.reactorFactory,
      withMergedObservability,
    ),
    projector: withMessageProcessorFactory(
      register,
      options.projectorFactory,
      withMergedObservability,
    ),
    workflowProcessor: withMessageProcessorFactory(
      register,
      options.workflowProcessorFactory,
      withMergedObservability,
    ),
    start: () => {
      if (isRunning) {
        void collector.lifecycleScope(
          EmmettSpans.consumer.start,
          lifecycleContext(),
          (startScope) => {
            startScope.log(
              LogEvent.debug(
                { [EmmettAttributes.consumer.id]: consumerId },
                'Consumer already running',
              ),
            );
            return Promise.resolve();
          },
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

      failedProcessorId = undefined;

      start = (async () => {
        let startLink: SpanLink | undefined;
        let failure: unknown;
        try {
          const startPositions = await collector.lifecycleScope(
            EmmettSpans.consumer.start,
            lifecycleContext(),
            async (startScope) => {
              startLink = {
                traceId: startScope.context.traceId,
                spanId: startScope.context.spanId,
              };

              if (!isInitialized) await init(startScope);

              return ConsumerStartPositions.resolve({
                processors,
                handlerContext: {},
                scope: withObservabilityScope(startScope),
                readLastMessageCheckpoint: () =>
                  source.readLastMessageCheckpoint(),
              });
            },
          );

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
                active.map(async (p) =>
                  p.handle(
                    startPositions.afterStartPosition(p.id, messages),
                    context,
                  ),
                ),
              );

              const failedIndex = results.findIndex(
                (r) => r.status === 'rejected',
              );
              const failure = results[failedIndex];

              if (failure?.status === 'rejected') {
                failedProcessorId = active[failedIndex]!.id;
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
          failure = error;
          startedAwaiter.reject(error);
          throw error;
        } finally {
          isRunning = false;
          await collector.lifecycleScope(
            EmmettSpans.consumer.stop,
            lifecycleContext(),
            async (stopScope) => {
              await stopProcessors(stopScope);

              if (failure !== undefined)
                stopScope.log(
                  LogEvent(
                    'emmett.consumer.exception',
                    {
                      body: 'Consumer stopped',
                      error: failure as Error,
                      attributes: {
                        [EmmettAttributes.consumer.id]: consumerId,
                        ...(failedProcessorId !== undefined
                          ? {
                              [EmmettAttributes.processor.id]:
                                failedProcessorId,
                            }
                          : {}),
                      },
                    },
                    { level: 'error' },
                  ),
                );
            },
            startLink ? { links: [startLink] } : undefined,
          );
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
