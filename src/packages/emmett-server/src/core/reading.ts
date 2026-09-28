import type {
  AnyReadEventMetadata,
  Event,
  EventStore,
  ReadEvent,
  StreamPosition,
} from '@event-driven-io/emmett';

export type StreamVersion = {
  streamExists: boolean;
  currentStreamVersion: StreamPosition;
};

/**
 * Reads whether a stream exists and its current version without reading its messages.
 */
export type StreamVersionReader = (
  streamName: string,
) => Promise<StreamVersion>;

/**
 * Portable fallback reading the whole stream to learn its version.
 * It is correct for every backend, but costs a full stream read, so backends
 * should provide a dedicated reader.
 */
export const fullReadStreamVersionReader =
  (eventStore: EventStore): StreamVersionReader =>
  async (streamName) => {
    const { streamExists, currentStreamVersion } =
      await eventStore.readStream(streamName);

    return { streamExists, currentStreamVersion };
  };

type RecordedMessage = ReadEvent<Event, AnyReadEventMetadata>;

const positionOf = (message: RecordedMessage): StreamPosition =>
  BigInt(message.metadata.streamPosition);

const min = (a: bigint, b: bigint) => (a < b ? a : b);

/**
 * Reads messages with stream positions in `[from, to]`.
 *
 * Backends interpret `readStream`'s `from` differently (inclusive position or
 * zero-based index), so it asks for a slightly wider range and filters by
 * stream position. That keeps pages free of skipped or repeated messages.
 */
const readRange = async (
  eventStore: EventStore,
  streamName: string,
  from: StreamPosition,
  to: StreamPosition,
): Promise<RecordedMessage[]> => {
  const { events } = await eventStore.readStream(streamName, {
    from: from > 0n ? from - 1n : 0n,
    to,
  });

  return events
    .filter((message) => {
      const position = positionOf(message);
      return position >= from && position <= to;
    })
    .sort((a, b) => (positionOf(a) < positionOf(b) ? -1 : 1));
};

export type MessagesRange = {
  from: StreamPosition;
  to?: StreamPosition | undefined;
};

export type MessagesPage = {
  messages: RecordedMessage[];
  /** Position to continue reading from, when the range has more messages. */
  nextFrom?: StreamPosition;
};

/**
 * Reads a single forward page, bounded by `limit`.
 */
export const readMessagesPage = async (
  eventStore: EventStore,
  streamName: string,
  version: StreamVersion,
  range: MessagesRange & { limit: number },
): Promise<MessagesPage> => {
  const end =
    range.to !== undefined
      ? min(range.to, version.currentStreamVersion)
      : version.currentStreamVersion;

  if (range.from > end) return { messages: [] };

  const upper = min(range.from + BigInt(range.limit), end);
  const messages = (
    await readRange(eventStore, streamName, range.from, upper)
  ).slice(0, range.limit);

  const lastRead =
    messages.length > 0 ? positionOf(messages[messages.length - 1]!) : upper;

  return lastRead < end ? { messages, nextFrom: lastRead + 1n } : { messages };
};

/**
 * Streams the finite range as it was when reading started, one page at a time,
 * so only a single page is held in memory.
 */
export async function* streamMessages(
  eventStore: EventStore,
  streamName: string,
  version: StreamVersion,
  range: MessagesRange & {
    limit?: number | undefined;
    pageSize: number;
    signal: AbortSignal;
  },
): AsyncGenerator<RecordedMessage> {
  let remaining = range.limit ?? Number.POSITIVE_INFINITY;
  let from: StreamPosition | undefined = range.from;

  while (from !== undefined && remaining > 0 && !range.signal.aborted) {
    const page = await readMessagesPage(eventStore, streamName, version, {
      from,
      to: range.to,
      limit: Math.min(range.pageSize, remaining),
    });

    for (const message of page.messages) {
      if (range.signal.aborted) return;
      remaining--;
      yield message;
    }

    from = page.nextFrom;
  }
}
