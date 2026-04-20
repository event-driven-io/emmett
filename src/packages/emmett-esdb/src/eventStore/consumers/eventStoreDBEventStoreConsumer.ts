import type { AsyncAwaiter, MessageProcessor } from '@event-driven-io/emmett';
import {
  asyncAwaiter,
  EmmettError,
  inMemoryProjector,
  inMemoryReactor,
  type AnyEvent,
  type AnyMessage,
  type AnyRecordedMessageMetadata,
  type AsyncRetryOptions,
  type BatchRecordedMessageHandlerWithoutContext,
  type DefaultRecord,
  type InMemoryProcessor,
  type InMemoryProjectorOptions,
  type InMemoryReactorOptions,
  type Message,
  type MessageConsumer,
  type MessageConsumerOptions,
} from '@event-driven-io/emmett';
import {
  EventStoreDBClient,
  type SubscribeToAllOptions,
  type SubscribeToStreamOptions,
} from '@eventstore/db-client';
import { v7 as uuid } from 'uuid';
import type { EventStoreDBReadEventMetadata } from '../eventstoreDBEventStore';
import {
  DefaultEventStoreDBEventStoreProcessorBatchSize,
  eventStoreDBSubscription,
  zipEventStoreDBEventStoreMessageBatchPullerStartFrom,
  type EventStoreDBSubscription,
} from './subscriptions';

export type EventStoreDBEventStoreConsumerConfig<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends Message = any,
> = MessageConsumerOptions<ConsumerMessageType> & {
  from?: EventStoreDBEventStoreConsumerType;
  pulling?: {
    batchSize?: number;
  };
  resilience?: {
    resubscribeOptions?: AsyncRetryOptions;
  };
};

export type EventStoreDBEventStoreConsumerOptions<
  ConsumerEventType extends Message = Message,
> = EventStoreDBEventStoreConsumerConfig<ConsumerEventType> &
  (
    | {
        connectionString: string;
        client?: never;
      }
    | { client: EventStoreDBClient; connectionString?: never }
  );

export type $all = '$all';
export const $all = '$all';

export type EventStoreDBEventStoreConsumerType =
  | {
      stream: $all;
      options?: Exclude<SubscribeToAllOptions, 'fromPosition'>;
    }
  | {
      stream: string;
      options?: Exclude<SubscribeToStreamOptions, 'fromRevision'>;
    };

export type EventStoreDBEventStoreConsumer<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends AnyMessage = any,
> = MessageConsumer<ConsumerMessageType> &
  Readonly<{
    reactor: <MessageType extends AnyMessage = ConsumerMessageType>(
      options: InMemoryReactorOptions<MessageType>,
    ) => InMemoryProcessor<MessageType>;
  }> &
  (AnyEvent extends ConsumerMessageType
    ? Readonly<{
        projector: <
          EventType extends AnyEvent = ConsumerMessageType & AnyEvent,
        >(
          options: InMemoryProjectorOptions<EventType>,
        ) => InMemoryProcessor<EventType>;
      }>
    : object);

export const eventStoreDBEventStoreConsumer = <
  ConsumerMessageType extends Message = AnyMessage,
>(
  options: EventStoreDBEventStoreConsumerOptions<ConsumerMessageType>,
): EventStoreDBEventStoreConsumer<ConsumerMessageType> => {
  let isRunning = false;
  let isInitialized = false;
  const { pulling } = options;
  const processors = options.processors ?? [];
  let abortController: AbortController | null = null;

  let start: Promise<void>;

  let currentSubscription: EventStoreDBSubscription | undefined;

  const startedAwaiter: AsyncAwaiter<void> = asyncAwaiter<void>();

  const client =
    'client' in options && options.client
      ? options.client
      : EventStoreDBClient.connectionString(options.connectionString);

  const eachBatch: BatchRecordedMessageHandlerWithoutContext<
    ConsumerMessageType,
    EventStoreDBReadEventMetadata
  > = async (messagesBatch) => {
    const activeProcessors = processors.filter((s) => s.isActive);

    if (activeProcessors.length === 0)
      return {
        type: 'STOP',
        reason: 'No active processors',
      };

    const result = await Promise.allSettled(
      activeProcessors.map(async (s) => {
        // TODO: Add here filtering to only pass messages that can be handled by
        return await s.handle(messagesBatch, { client });
      }),
    );

    const error = result.find((r) => r.status === 'rejected')?.reason as
      | Error
      | undefined;

    return result.some(
      (r) => r.status === 'fulfilled' && r.value?.type !== 'STOP',
    )
      ? undefined
      : {
          type: 'STOP',
          error: error ? EmmettError.mapFrom(error) : undefined,
        };
  };

  const subscription = (currentSubscription = eventStoreDBSubscription({
    client,
    from: options.from,
    eachBatch,
    batchSize:
      pulling?.batchSize ?? DefaultEventStoreDBEventStoreProcessorBatchSize,
    resilience: options.resilience,
  }));

  const stopProcessors = () => Promise.all(processors.map((p) => p.close({})));

  const init = async (): Promise<void> => {
    if (isInitialized) return;
    for (const processor of processors) {
      await processor.init({});
    }
    isInitialized = true;
  };

  const stop = async () => {
    if (!isRunning) return;
    isRunning = false;
    abortController?.abort();
    if (currentSubscription) {
      await currentSubscription.stop();
      currentSubscription = undefined;
    }
    await start;
    abortController = null;
    await stopProcessors();
  };

  return {
    consumerId: options.consumerId ?? uuid(),
    get isRunning() {
      return isRunning;
    },
    whenStarted: (): Promise<void> => startedAwaiter.wait,
    processors,
    reactor: <MessageType extends AnyMessage = ConsumerMessageType>(
      options: InMemoryReactorOptions<MessageType>,
    ): InMemoryProcessor<MessageType> => {
      const processor = inMemoryReactor(options);

      processors.push(
        // TODO: change that
        processor as unknown as MessageProcessor<
          ConsumerMessageType,
          AnyRecordedMessageMetadata,
          DefaultRecord
        >,
      );

      return processor;
    },
    projector: <EventType extends AnyEvent = ConsumerMessageType & AnyEvent>(
      options: InMemoryProjectorOptions<EventType>,
    ): InMemoryProcessor<EventType> => {
      const processor = inMemoryProjector(options);

      processors.push(
        // TODO: change that
        processor as unknown as MessageProcessor<
          ConsumerMessageType,
          AnyRecordedMessageMetadata,
          DefaultRecord
        >,
      );

      return processor;
    },
    start: () => {
      if (isRunning) return start;

      startedAwaiter.reset();

      if (processors.length === 0) {
        const error = new EmmettError(
          'Cannot start consumer without at least a single processor',
        );
        startedAwaiter.reject(error);
        throw error;
      }
      isRunning = true;
      abortController = new AbortController();

      start = (async () => {
        if (!isRunning) return;

        try {
          if (!isInitialized) {
            await init();
          }

          const startFrom =
            zipEventStoreDBEventStoreMessageBatchPullerStartFrom(
              await Promise.all(processors.map((o) => o.start(client))),
            );

          await subscription.start({ startFrom, started: startedAwaiter });
        } catch (error) {
          startedAwaiter.reject(error);
          throw error;
        }

        isRunning = false;
      })();

      return start;
    },
    stop,
    close: stop,
  };
};
