import { globalStreamCaughtUp } from '../eventStore/events';
import type { ProcessorCheckpoint } from '../processors';
import type {
  AnyMessage,
  AnyReadEventMetadata,
  Message,
  RecordedMessage,
} from '../typing';
import { delayOrAbort } from '../utils';
import type {
  MessageSource,
  MessageSourceBatch,
  MessageSourceReadOptions,
} from './messageSource';

export const DefaultPollingBatchSize = 100;
export const DefaultPollingFrequencyInMs = 50;
export const DefaultPollingInitialBackoffInMs = 100;
export const DefaultPollingBackoffCeilingInMs = 1000;

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
  ) => Promise<PollingReadBatchResult<MessageType, MessageMetadataType>>;
  readLastCheckpoint: () => Promise<ProcessorCheckpoint | null>;
  readLastCommittedCheckpoint?: () => Promise<ProcessorCheckpoint | null>;
  compareCheckpoints?: (
    a: ProcessorCheckpoint,
    b: ProcessorCheckpoint,
  ) => number;
  batchSize?: number;
  pullingFrequencyInMs?: number;
  close?: () => Promise<void>;
};

/**
 * Backs off while the tail stays empty so an idle consumer stops hammering the
 * store, and snaps back to the configured frequency the moment messages flow
 * again.
 */
export const nextPollingWaitTime = (
  current: number,
  areMessagesLeft: boolean,
  pullingFrequencyInMs: number,
): number =>
  areMessagesLeft
    ? pullingFrequencyInMs
    : Math.min(current * 2, DefaultPollingBackoffCeilingInMs);

export const pollingMessageSource = <
  MessageType extends Message = AnyMessage,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
>(
  options: PollingMessageSourceOptions<MessageType, MessageMetadataType>,
): MessageSource<MessageType, MessageMetadataType> => {
  const {
    readBatch,
    readLastCheckpoint,
    readLastCommittedCheckpoint,
    compareCheckpoints,
    close,
  } = options;

  const pullingFrequencyInMs =
    options.pullingFrequencyInMs ?? DefaultPollingFrequencyInMs;

  const resolveAfter = async (
    from: MessageSourceReadOptions['from'],
  ): Promise<ProcessorCheckpoint | null> => {
    if (from === 'BEGINNING') return null;
    if (from === 'END') return readLastCheckpoint();
    return from.lastCheckpoint;
  };

  return {
    read: async function* (
      readOptions: MessageSourceReadOptions,
    ): AsyncGenerator<MessageSourceBatch<MessageType, MessageMetadataType>> {
      const { signal } = readOptions;
      const batchSize =
        readOptions.batchSize ?? options.batchSize ?? DefaultPollingBatchSize;

      let after = await resolveAfter(readOptions.from);
      let waitTime = DefaultPollingInitialBackoffInMs;

      while (!signal.aborted) {
        const { messages, currentCheckpoint, areMessagesLeft } =
          await readBatch({ after, batchSize, signal });

        if (messages.length > 0)
          yield { messages, lastCheckpoint: currentCheckpoint };

        after = currentCheckpoint ?? after;

        if (!areMessagesLeft)
          yield {
            messages: [globalStreamCaughtUp({ globalPosition: after ?? '0' })],
            lastCheckpoint: after,
          };

        waitTime = nextPollingWaitTime(
          waitTime,
          areMessagesLeft,
          pullingFrequencyInMs,
        );

        await delayOrAbort(waitTime, signal);
      }
    },
    readLastCheckpoint,
    ...(readLastCommittedCheckpoint ? { readLastCommittedCheckpoint } : {}),
    ...(compareCheckpoints ? { compareCheckpoints } : {}),
    ...(close ? { close } : {}),
  };
};
