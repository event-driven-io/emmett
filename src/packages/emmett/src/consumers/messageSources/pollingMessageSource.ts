import { MessageSourceCaughtUp } from '../../eventStore/events';
import { ProcessorCheckpoint } from '../../processors';
import type {
  AnyMessage,
  AnyReadEventMetadata,
  Message,
  RecordedMessage,
} from '../../typing';
import { delayOrAbort, type MaybePromise } from '../../utils';
import type {
  MessageSource,
  MessageSourceMessage,
  MessageSourceReadOptions,
} from './messageSource';
import { toBatchSize } from './messageSource';

export const DefaultPollingBatchSize = 100;
export const DefaultPollingFrequencyInMs = 50;
export const DefaultPollingBackoffCeilingInMs = 250;
export const DefaultPollingBackoffMultiplier = 2;

export type PollingBackoffOptions = {
  initialInMs?: number;
  maxInMs?: number;
  multiplier?: number;
};

export type PollingReadBatchOptions = {
  after: ProcessorCheckpoint | null;
  batchSize: number;
  signal: AbortSignal;
};

export type PollingReadBatchResult<
  MessageType extends Message = AnyMessage,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
> = {
  messages: RecordedMessage<MessageType, MessageMetadataType>[];
  currentCheckpoint: ProcessorCheckpoint | null;
  areMessagesLeft: boolean;
};

export type PollingMessageSourceOptions<
  MessageType extends Message = AnyMessage,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
> = {
  readBatch: (
    options: PollingReadBatchOptions,
  ) => MaybePromise<PollingReadBatchResult<MessageType, MessageMetadataType>>;
  readLastMessageCheckpoint: () => MaybePromise<ProcessorCheckpoint | null>;
  batchSize?: number;
  pullingFrequencyInMs?: number;
  backoff?: PollingBackoffOptions;
  close?: () => MaybePromise<void>;
};

/**
 * Backs off while reads find nothing so an idle consumer stops hammering the
 * store, and snaps back to the configured frequency as soon as a read finds
 * messages, even fewer than the batch size.
 */
export const nextPollingWaitTime = (
  consecutiveEmptyReads: number,
  pullingFrequencyInMs: number,
  backoff: PollingBackoffOptions = {},
): number =>
  consecutiveEmptyReads === 0
    ? pullingFrequencyInMs
    : Math.min(
        (backoff.initialInMs ?? pullingFrequencyInMs) *
          (backoff.multiplier ?? DefaultPollingBackoffMultiplier) **
            (consecutiveEmptyReads - 1),
        backoff.maxInMs ?? DefaultPollingBackoffCeilingInMs,
      );

export const pollingMessageSource = <
  MessageType extends Message = AnyMessage,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
>(
  options: PollingMessageSourceOptions<MessageType, MessageMetadataType>,
): MessageSource<MessageType, MessageMetadataType> => {
  const {
    readBatch,
    readLastMessageCheckpoint,
    close = () => Promise.resolve(),
  } = options;

  const pullingFrequencyInMs =
    options.pullingFrequencyInMs ?? DefaultPollingFrequencyInMs;
  const backoff = options.backoff ?? {};

  const resolveAfter = async (
    from: MessageSourceReadOptions['from'],
  ): Promise<ProcessorCheckpoint | null> => {
    if (from === 'BEGINNING') return null;
    if (from === 'END') return readLastMessageCheckpoint();
    return from.lastCheckpoint;
  };

  return {
    read: async function* (
      readOptions: MessageSourceReadOptions,
    ): AsyncGenerator<MessageSourceMessage<MessageType, MessageMetadataType>> {
      const { signal } = readOptions;
      const batchSize = toBatchSize(
        readOptions.batchSize ?? options.batchSize,
        DefaultPollingBatchSize,
      );

      let after = await resolveAfter(readOptions.from);
      let consecutiveEmptyReads = 0;

      while (!signal.aborted) {
        const { messages, currentCheckpoint, areMessagesLeft } =
          await readBatch({ after, batchSize, signal });

        yield* messages;

        after = currentCheckpoint ?? after;

        if (!areMessagesLeft)
          yield MessageSourceCaughtUp(after ?? ProcessorCheckpoint('0'));

        consecutiveEmptyReads =
          messages.length > 0 ? 0 : consecutiveEmptyReads + 1;

        await delayOrAbort(
          nextPollingWaitTime(
            consecutiveEmptyReads,
            pullingFrequencyInMs,
            backoff,
          ),
          signal,
        );
      }
    },
    readLastMessageCheckpoint,
    close,
  };
};
