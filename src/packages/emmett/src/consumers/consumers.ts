import type {
  MessageProcessor,
  ProcessorCheckpoint,
  WaitOptions,
} from '../processors';
import type { Message } from '../typing';
import type { ConsumerObservabilityConfig } from './observability';

/**
 * Condition that makes a running consumer stop on its own. Keys are OR-ed:
 * the consumer stops as soon as the first satisfied condition is met.
 *
 * - `noMessagesLeft` - stop once a poll finds nothing left to process, even
 *   while the tail keeps moving (drains a live stream, e.g. blue-green
 *   projection rebuilds).
 * - `caughtUp` - stop once every processor reaches the store tail as of the
 *   start call (a bounded snapshot).
 */
export type MessageConsumerUntilCondition = {
  noMessagesLeft?: boolean;
  caughtUp?: boolean;
};

export type MessageConsumerStartOptions = {
  until?: MessageConsumerUntilCondition;
  timeout?: number;
};

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
  whenStarted: () => Promise<void>;
  /**
   * Resolves once every processor has processed up to the given position,
   * typically an append result's `lastEventGlobalPosition`. Resolves
   * immediately when that point was already processed, so a test can append
   * and then wait without racing the poller. Rejects on
   * {@link WaitOptions.timeout}.
   *
   * Available on stores that expose an ordered global position (SQLite,
   * PostgreSQL). Stores without one (e.g. MongoDB change streams) may leave it
   * undefined.
   */
  whenProcessed?: (
    position: ProcessorCheckpoint,
    options?: WaitOptions,
  ) => Promise<void>;
  /**
   * Resolves once every processor has processed up to the store's tail as of
   * the call. The everyday test wait: start, append, `whenCaughtUp`, assert.
   * Rejects on {@link WaitOptions.timeout}.
   *
   * Available on stores that expose an ordered global position (SQLite,
   * PostgreSQL). Stores without one (e.g. MongoDB change streams) may leave it
   * undefined.
   */
  whenCaughtUp?: (options?: WaitOptions) => Promise<void>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  processors: ReadonlyArray<MessageProcessor<ConsumerMessageType, any, any>>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  close: () => Promise<void>;
}>;
