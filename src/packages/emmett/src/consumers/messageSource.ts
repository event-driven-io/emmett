import type { GlobalSubscriptionEvent } from '../eventStore/events';
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
 * A message as delivered by a source: either a recorded message, or one of the
 * control messages (e.g. {@link GlobalStreamCaughtUp}) a source uses to report
 * its own state. The consumer strips control messages before fanning a batch
 * out, so no processor ever sees one.
 */
export type MessageSourceMessage<
  MessageType extends Message = AnyMessage,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
> = RecordedMessage<MessageType, MessageMetadataType> | GlobalSubscriptionEvent;

export type MessageSourceBatch<
  MessageType extends Message = AnyMessage,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
> = {
  messages: MessageSourceMessage<MessageType, MessageMetadataType>[];
  lastCheckpoint: ProcessorCheckpoint | null;
};

/**
 * The read side of a store, unified. Pull stores (PostgreSQL, SQLite) yield
 * from their poll loop, push stores (MongoDB, EventStoreDB) drain a bounded
 * queue their subscription feeds. Backpressure comes from the iterator
 * protocol: nothing is read until the consumer asks for the next batch.
 */
export type MessageSource<
  MessageType extends Message = AnyMessage,
  MessageMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
> = {
  read(
    options: MessageSourceReadOptions,
  ): AsyncIterable<MessageSourceBatch<MessageType, MessageMetadataType>>;
  /**
   * Tail of the store, used to resolve a processor starting from `'END'`.
   */
  readLastCheckpoint(): Promise<ProcessorCheckpoint | null>;
  /**
   * Tail of the store as committed and visible to everyone, used by
   * `whenCaughtUp`. Defaults to {@link readLastCheckpoint}. PostgreSQL is the
   * reason this exists separately: its read path filters on `pg_snapshot_xmin`
   * to avoid skipping messages from in-flight transactions, which would make a
   * caught-up wait resolve too early.
   */
  readLastCommittedCheckpoint?(): Promise<ProcessorCheckpoint | null>;
  /**
   * Set when the checkpoint format does not sort lexicographically, e.g.
   * MongoDB resume tokens. Propagated by the consumer to start position
   * resolution and to every registered processor.
   */
  compareCheckpoints?: (
    a: ProcessorCheckpoint,
    b: ProcessorCheckpoint,
  ) => number;
  close?(): Promise<void>;
};
