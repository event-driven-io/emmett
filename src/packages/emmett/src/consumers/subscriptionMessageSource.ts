import type {
  CurrentMessageProcessorPosition,
  ProcessorCheckpoint,
} from '../processors';
import type { AnyMessage, AnyReadEventMetadata, Message } from '../typing';
import { delayOrAbort } from '../utils';
import type {
  MessageSource,
  MessageSourceBatch,
  MessageSourceReadOptions,
} from './messageSource';

export const DefaultResubscribeDelayInMs = 100;
export const DefaultSubscriptionQueueCapacity = 100;

export type BoundedMessageQueueOptions = {
  capacity?: number;
};

/**
 * Adapts a push subscription to the pull side of an async iterable. `push`
 * resolves only once there is room, which is how backpressure reaches a change
 * stream that would otherwise run ahead of the processors.
 */
export type BoundedMessageQueue<T> = {
  push: (item: T) => Promise<void>;
  complete: () => void;
  fail: (error: unknown) => void;
  iterate: (signal: AbortSignal) => AsyncIterable<T>;
};

export const boundedMessageQueue = <T>(
  options: BoundedMessageQueueOptions = {},
): BoundedMessageQueue<T> => {
  const capacity = options.capacity ?? DefaultSubscriptionQueueCapacity;

  const items: T[] = [];
  const waitingWriters: (() => void)[] = [];
  let waitingReader: (() => void) | null = null;
  let completed = false;
  let failure: unknown = undefined;

  const notifyReader = () => {
    const reader = waitingReader;
    waitingReader = null;
    reader?.();
  };

  return {
    push: (item) => {
      if (completed || failure !== undefined) return Promise.resolve();

      items.push(item);
      notifyReader();

      if (items.length <= capacity) return Promise.resolve();

      return new Promise<void>((resolve) => waitingWriters.push(resolve));
    },
    complete: () => {
      completed = true;
      notifyReader();
      waitingWriters.splice(0).forEach((resolve) => resolve());
    },
    fail: (error) => {
      failure = error;
      notifyReader();
      waitingWriters.splice(0).forEach((resolve) => resolve());
    },
    iterate: async function* (signal: AbortSignal) {
      while (true) {
        while (items.length > 0) {
          if (signal.aborted) return;

          const item = items.shift()!;
          waitingWriters.shift()?.();
          yield item;
        }

        // eslint-disable-next-line @typescript-eslint/only-throw-error -- the subscription's failure is rethrown as-is so callers keep the driver's error type
        if (failure !== undefined) throw failure;
        if (completed || signal.aborted) return;

        await new Promise<void>((resolve) => {
          waitingReader = resolve;
          signal.addEventListener('abort', () => resolve(), { once: true });
        });
      }
    },
  };
};

export type SubscribeOptions = {
  from: CurrentMessageProcessorPosition;
  batchSize: number;
  signal: AbortSignal;
};

export type SubscriptionResilienceOptions = {
  shouldRetryError?: (error: unknown) => boolean;
  resubscribeDelayInMs?: number;
};

export type SubscriptionMessageSourceOptions<
  MessageType extends Message = AnyMessage,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
> = {
  subscribe: (
    options: SubscribeOptions,
  ) => AsyncIterable<MessageSourceBatch<MessageType, MessageMetadataType>>;
  readLastCheckpoint: () => Promise<ProcessorCheckpoint | null>;
  readLastCommittedCheckpoint?: () => Promise<ProcessorCheckpoint | null>;
  compareCheckpoints?: (
    a: ProcessorCheckpoint,
    b: ProcessorCheckpoint,
  ) => number;
  batchSize?: number;
  resilience?: SubscriptionResilienceOptions;
  close?: () => Promise<void>;
};

export const subscriptionMessageSource = <
  MessageType extends Message = AnyMessage,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
>(
  options: SubscriptionMessageSourceOptions<MessageType, MessageMetadataType>,
): MessageSource<MessageType, MessageMetadataType> => {
  const {
    subscribe,
    readLastCheckpoint,
    readLastCommittedCheckpoint,
    compareCheckpoints,
    resilience,
    close,
  } = options;

  const shouldRetryError = resilience?.shouldRetryError ?? (() => true);
  const resubscribeDelayInMs =
    resilience?.resubscribeDelayInMs ?? DefaultResubscribeDelayInMs;

  return {
    read: async function* (readOptions: MessageSourceReadOptions) {
      const { signal } = readOptions;
      const batchSize =
        readOptions.batchSize ??
        options.batchSize ??
        DefaultSubscriptionQueueCapacity;

      let from = readOptions.from;

      while (!signal.aborted) {
        try {
          for await (const batch of subscribe({ from, batchSize, signal })) {
            yield batch;

            if (batch.lastCheckpoint !== null)
              from = { lastCheckpoint: batch.lastCheckpoint };
          }
          return;
        } catch (error) {
          if (signal.aborted) return;
          if (!shouldRetryError(error)) throw error;

          console.log('Subscription dropped, resubscribing.', error);
          await delayOrAbort(resubscribeDelayInMs, signal);
        }
      }
    },
    readLastCheckpoint,
    ...(readLastCommittedCheckpoint ? { readLastCommittedCheckpoint } : {}),
    ...(compareCheckpoints ? { compareCheckpoints } : {}),
    ...(close ? { close } : {}),
  };
};
