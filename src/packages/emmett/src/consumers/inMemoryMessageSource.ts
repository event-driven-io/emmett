import { MessageSourceCaughtUp } from '../eventStore/events';
import {
  getCheckpoint,
  ProcessorCheckpoint,
  type CurrentMessageProcessorPosition,
} from '../processors';
import type {
  AnyMessage,
  AnyReadEventMetadata,
  Message,
  RecordedMessage,
} from '../typing';
import { Aborted, orAborted } from '../utils/promises';
import type { MessageSource } from './messageSources/messageSource';
import { subscriptionMessageSource } from './messageSources/subscriptionMessageSource';

export type InMemoryMessageSourceOptions<
  MessageType extends Message = AnyMessage,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
> = { batchSize?: number } & (
  | {
      messages?: RecordedMessage<MessageType, MessageMetadataType>[];
      readLastMessageCheckpoint?: never;
      close?: never;
    }
  | {
      messages: AsyncIterable<
        RecordedMessage<MessageType, MessageMetadataType>[]
      >;
      readLastMessageCheckpoint: () => ProcessorCheckpoint | null;
      close?: () => Promise<void>;
    }
);

export const inMemoryMessageSource = <
  MessageType extends Message = AnyMessage,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
>(
  options: InMemoryMessageSourceOptions<MessageType, MessageMetadataType> = {},
): MessageSource<MessageType, MessageMetadataType> => {
  type Recorded = RecordedMessage<MessageType, MessageMetadataType>;

  const lastCheckpointOf = (messages: Recorded[]) =>
    messages.length > 0 ? getCheckpoint(messages[messages.length - 1]!) : null;

  const messagesAfter = (
    messages: Recorded[],
    after: ProcessorCheckpoint | null,
  ) =>
    messages.filter((message) => {
      const checkpoint = getCheckpoint(message);
      if (checkpoint === null) return false;
      return (
        after === null || ProcessorCheckpoint.compare(checkpoint, after) > 0
      );
    });

  const startAfter = (
    from: CurrentMessageProcessorPosition,
    readLastMessageCheckpoint: () => ProcessorCheckpoint | null,
  ) =>
    from === 'BEGINNING'
      ? null
      : from === 'END'
        ? readLastMessageCheckpoint()
        : from.lastCheckpoint;

  if (options.readLastMessageCheckpoint === undefined) {
    const messages = options.messages ?? [];
    const readLastMessageCheckpoint = () => lastCheckpointOf(messages);

    return subscriptionMessageSource<MessageType, MessageMetadataType>({
      subscribe: async function* ({ from, signal }) {
        const after = startAfter(from, readLastMessageCheckpoint);
        const read = messagesAfter(messages, after);

        for (const message of read)
          yield { ...message, metadata: { ...message.metadata } };

        yield MessageSourceCaughtUp(
          lastCheckpointOf(read) ?? after ?? ProcessorCheckpoint('0'),
        );

        await orAborted(new Promise<never>(() => {}), signal);
      },
      readLastMessageCheckpoint: () =>
        Promise.resolve(readLastMessageCheckpoint()),
      batchSize: options.batchSize,
    });
  }

  const { readLastMessageCheckpoint } = options;
  const batches = options.messages[Symbol.asyncIterator]();
  let pending: Promise<IteratorResult<Recorded[]>> | undefined;

  return subscriptionMessageSource<MessageType, MessageMetadataType>({
    subscribe: async function* ({ from, signal }) {
      let after = startAfter(from, readLastMessageCheckpoint);

      while (!signal.aborted) {
        pending ??= batches.next();
        const batch = await orAborted(pending, signal);

        if (batch === Aborted) return;
        pending = undefined;
        if (batch.done) return;

        const read = messagesAfter(batch.value, after);

        for (const message of read)
          yield { ...message, metadata: { ...message.metadata } };

        after = lastCheckpointOf(read) ?? after;

        yield MessageSourceCaughtUp(after ?? ProcessorCheckpoint('0'));
      }
    },
    readLastMessageCheckpoint: () =>
      Promise.resolve(readLastMessageCheckpoint()),
    batchSize: options.batchSize,
    close: options.close,
  });
};
