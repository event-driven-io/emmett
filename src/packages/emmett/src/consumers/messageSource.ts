import { EmmettError } from '../errors';
import type { MessageSourceControlMessage } from '../eventStore/events';
import type {
  CurrentMessageProcessorPosition,
  ProcessorCheckpoint,
} from '../processors';
import type {
  AnyMessage,
  AnyReadEventMetadata,
  Message,
  RecordedMessage,
} from '../typing';

export type MessageSourceReadOptions = {
  from: CurrentMessageProcessorPosition;
  batchSize?: number;
  signal: AbortSignal;
};

/**
 * What comes out of a source: your recorded messages, plus the occasional
 * {@link MessageSourceCaughtUp} it sends to say it has delivered everything it
 * has for now. Processors never see the latter, the consumer takes it out.
 */
export type MessageSourceMessage<
  MessageType extends Message = AnyMessage,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
> =
  | RecordedMessage<MessageType, MessageMetadataType>
  | MessageSourceControlMessage;

/**
 * Implement it to feed a consumer from your store, whether you poll it or
 * subscribe to it. Deliver messages one by one in checkpoint order and take
 * your time: nothing is read until the consumer asks for the next one, so a
 * slow processor slows the reading down instead of piling up in memory.
 * Batching, checkpointing and retries are the consumer's and the processors'
 * job, not yours. Use {@link pollingMessageSource} or
 * {@link subscriptionMessageSource} rather than writing one from scratch.
 */
export type MessageSource<
  MessageType extends Message = AnyMessage,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
> = {
  read(
    options: MessageSourceReadOptions,
  ): AsyncIterable<MessageSourceMessage<MessageType, MessageMetadataType>>;
  /**
   * Return how far your store goes, so a processor asking to start from `'END'`
   * skips what is already there. `null` for an empty store, which starts it from
   * the beginning.
   */
  readLastCheckpoint(): Promise<ProcessorCheckpoint | null>;
  /**
   * Return how far your store goes for readers other than the writer, which is
   * what `whenCaughtUp` waits for. Return {@link readLastCheckpoint} unless your
   * store can report a checkpoint that a read does not see yet, in which case a
   * caught up wait would resolve before the message shows up. PostgreSQL is the
   * one that can, because of in-flight transactions.
   */
  compareCheckpoints?: (
    a: ProcessorCheckpoint,
    b: ProcessorCheckpoint,
  ) => number;
  /**
   * Release what you own, e.g. a connection you opened. Skip it when the
   * lifetime of everything you use is somebody else's business.
   */
  close?(): Promise<void>;
};

/**
 * A read has to bring back at least one message. Anything smaller would leave
 * every message sitting in the store unread, so it fails loudly here instead of
 * stalling.
 */
export const toBatchSize = (
  requested: number | undefined,
  fallback: number,
): number => {
  if (requested === undefined) return fallback;

  if (!Number.isInteger(requested) || requested < 1)
    throw new EmmettError(
      `Batch size has to be an integer greater than 0, got: ${requested}`,
    );

  return requested;
};
