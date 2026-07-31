import {
  getCheckpoint,
  type CurrentMessageProcessorPosition,
  type ProcessorCheckpoint,
} from '../../processors';
import type {
  AnyMessage,
  AnyReadEventMetadata,
  Message,
  RecordedMessage,
} from '../../typing';
import { delayOrAbort, type AsyncRetryOptions } from '../../utils';
import type {
  MessageSource,
  MessageSourceMessage,
  MessageSourceReadOptions,
} from './messageSource';
import { toBatchSize } from './messageSource';

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
      while (!signal.aborted) {
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
          const onAbort = () => resolve();
          waitingReader = () => {
            signal.removeEventListener('abort', onAbort);
            resolve();
          };
          signal.addEventListener('abort', onAbort, { once: true });
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

export type SubscriptionResilienceOptions = AsyncRetryOptions<void>;

export type SubscriptionMessageSourceOptions<
  MessageType extends Message = AnyMessage,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
> = {
  subscribe: (
    options: SubscribeOptions,
  ) => AsyncIterable<MessageSourceMessage<MessageType, MessageMetadataType>>;
  readLastMessageCheckpoint: () => Promise<ProcessorCheckpoint | null>;
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
  const { subscribe, readLastMessageCheckpoint, resilience, close } = options;

  const retryOptions: AsyncRetryOptions<void> = resilience ?? {
    forever: true,
    minTimeout: DefaultResubscribeDelayInMs,
    factor: 1,
    randomize: false,
  };
  const shouldRetryError = retryOptions.shouldRetryError ?? (() => true);

  return {
    read: async function* (readOptions: MessageSourceReadOptions) {
      const { signal } = readOptions;
      const batchSize = toBatchSize(
        readOptions.batchSize ?? options.batchSize,
        DefaultSubscriptionQueueCapacity,
      );

      let from = readOptions.from;
      let retries = 0;
      let retryStartedAt: number | undefined;

      while (!signal.aborted) {
        let retryReason: unknown;

        try {
          for await (const message of subscribe({ from, batchSize, signal })) {
            yield message;

            retries = 0;
            retryStartedAt = undefined;

            const checkpoint = getCheckpoint(
              message as RecordedMessage<MessageType, MessageMetadataType>,
            );

            if (checkpoint !== null) from = { lastCheckpoint: checkpoint };
          }

          if (signal.aborted || !retryOptions.shouldRetryResult?.(undefined))
            return;

          retryReason = new Error(
            'Subscription ended while the source was still active',
          );
        } catch (error) {
          if (signal.aborted) return;
          if (!shouldRetryError(error)) throw error;

          retryReason = error;
        }

        retryStartedAt ??= Date.now();

        if (!retryOptions.forever && retries >= (retryOptions.retries ?? 10))
          throw retryReason;

        if (
          retryOptions.maxRetryTime !== undefined &&
          Date.now() - retryStartedAt >= retryOptions.maxRetryTime
        )
          throw retryReason;

        retries++;
        retryOptions.onRetry?.(retryReason, retries);

        const minTimeout =
          retryOptions.minTimeout ?? DefaultResubscribeDelayInMs;
        const factor = retryOptions.factor ?? 2;
        const maxTimeout = retryOptions.maxTimeout ?? Number.POSITIVE_INFINITY;
        const randomize = retryOptions.randomize ?? true;
        const randomFactor = randomize ? 1 + Math.random() : 1;
        const resubscribeDelayInMs = Math.min(
          minTimeout * Math.pow(factor, retries - 1) * randomFactor,
          maxTimeout,
        );

        await delayOrAbort(resubscribeDelayInMs, signal, {
          unref: retryOptions.unref,
        });
      }
    },
    readLastMessageCheckpoint: readLastMessageCheckpoint,
    ...(close ? { close } : {}),
  };
};
