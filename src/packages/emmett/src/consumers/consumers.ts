import type { MessageProcessor } from '../processors';
import type { Message } from '../typing';
import type { ConsumerObservabilityConfig } from '../observability';

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  processors: ReadonlyArray<MessageProcessor<ConsumerMessageType, any, any>>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  close: () => Promise<void>;
}>;
