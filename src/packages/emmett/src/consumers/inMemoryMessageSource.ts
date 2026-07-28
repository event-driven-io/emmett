import { getCheckpoint, ProcessorCheckpoint } from '../processors';
import type {
  AnyMessage,
  AnyReadEventMetadata,
  Message,
  RecordedMessage,
} from '../typing';
import type { MessageSource } from './messageSource';
import { pollingMessageSource } from './pollingMessageSource';

export type InMemoryMessageSourceOptions<
  MessageType extends Message = AnyMessage,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
> = {
  messages?: RecordedMessage<MessageType, MessageMetadataType>[];
  compareCheckpoints?: (
    a: ProcessorCheckpoint,
    b: ProcessorCheckpoint,
  ) => number;
  batchSize?: number;
  pullingFrequencyInMs?: number;
};

export type InMemoryMessageSource<
  MessageType extends Message = AnyMessage,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
> = MessageSource<MessageType, MessageMetadataType> & {
  append: (
    ...messages: RecordedMessage<MessageType, MessageMetadataType>[]
  ) => void;
};

export const inMemoryMessageSource = <
  MessageType extends Message = AnyMessage,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
>(
  options: InMemoryMessageSourceOptions<MessageType, MessageMetadataType> = {},
): InMemoryMessageSource<MessageType, MessageMetadataType> => {
  const messages = [...(options.messages ?? [])];
  const compareCheckpoints =
    options.compareCheckpoints ?? ProcessorCheckpoint.compare;

  const tail = (): ProcessorCheckpoint | null =>
    messages.length > 0 ? getCheckpoint(messages[messages.length - 1]!) : null;

  const source = pollingMessageSource<MessageType, MessageMetadataType>({
    ...options,
    // eslint-disable-next-line @typescript-eslint/require-await
    readBatch: async ({ after, batchSize }) => {
      const pending = messages.filter((message) => {
        const checkpoint = getCheckpoint(message);
        if (checkpoint === null) return false;
        return after === null || compareCheckpoints(checkpoint, after) > 0;
      });

      const batch = pending.slice(0, batchSize);
      const last = batch[batch.length - 1];

      return {
        messages: batch,
        currentCheckpoint: last !== undefined ? getCheckpoint(last) : after,
        areMessagesLeft: pending.length > batch.length,
      };
    },
    readLastCheckpoint: () => Promise.resolve(tail()),
    compareCheckpoints,
  });

  return {
    ...source,
    append: (...appended) => {
      messages.push(...appended);
    },
  };
};
