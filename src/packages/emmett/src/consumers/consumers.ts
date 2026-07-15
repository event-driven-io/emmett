import type {
  MessageProcessor,
  ProcessorCheckpoint,
  WaitOptions,
} from '../processors';
import type { Message } from '../typing';
import type { ConsumerObservabilityConfig } from './observability';

export type MessageConsumerOptions<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends Message = any,
> = {
  consumerId?: string;
  observability?: ConsumerObservabilityConfig;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  processors?: Array<MessageProcessor<ConsumerMessageType, any, any>>;
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
