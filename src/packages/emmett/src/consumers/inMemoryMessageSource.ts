import { getCheckpoint, ProcessorCheckpoint } from '../processors';
import type {
  AnyMessage,
  AnyReadEventMetadata,
  Message,
  RecordedMessage,
} from '../typing';
import type { MessageSource } from './messageSources/messageSource';
import { pollingMessageSource } from './messageSources/pollingMessageSource';

export type InMemoryMessageSourceOptions<
  MessageType extends Message = AnyMessage,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
> = {
  messages?: RecordedMessage<MessageType, MessageMetadataType>[];
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

  const lastCheckpoint = (): ProcessorCheckpoint | null =>
    messages.length > 0 ? getCheckpoint(messages[messages.length - 1]!) : null;

  const source = pollingMessageSource<MessageType, MessageMetadataType>({
    ...options,
    // eslint-disable-next-line @typescript-eslint/require-await
    readBatch: async ({ after, batchSize }) => {
      const pending = messages.filter((message) => {
        const checkpoint = getCheckpoint(message);
        if (checkpoint === null) return false;
        return (
          after === null || ProcessorCheckpoint.compare(checkpoint, after) > 0
        );
      });

      const batch = pending.slice(0, batchSize);
      const last = batch[batch.length - 1];

      return {
        messages: batch,
        currentCheckpoint: last !== undefined ? getCheckpoint(last) : after,
        areMessagesLeft: pending.length > batch.length,
      };
    },
    readLastMessageCheckpoint: () => Promise.resolve(lastCheckpoint()),
  });

  return {
    ...source,
    append: (...appended) => {
      messages.push(...appended);
    },
  };
};
