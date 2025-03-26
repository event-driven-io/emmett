import type { MessageProcessor } from '../processors';
import type { Message } from '../typing';

export type MessageConsumerOptions<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends Message = any,
> = {
  consumerId?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  processors?: Array<MessageProcessor<ConsumerMessageType, any, any, bigint>>;
};

export type MessageConsumer<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends Message = any,
> = Readonly<{
  consumerId: string;
  isRunning: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  processors: ReadonlyArray<MessageProcessor<ConsumerMessageType, any, any>>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  close: () => Promise<void>;
}>;
