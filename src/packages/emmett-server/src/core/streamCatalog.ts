import {
  ValidationError,
  type AnyReadEventMetadata,
  type Event,
  type ReadEvent,
  type StreamPosition,
} from '@event-driven-io/emmett';
import {
  typeIdStreamIdentityCodec,
  type StreamIdentityCodec,
} from './streamIdentity';

export type StreamCatalogEntry = {
  streamName: string;
  /** Included when the backend can provide it efficiently. */
  currentStreamVersion?: StreamPosition;
};

export type ListStreamsOptions = {
  limit: number;
  /** Opaque cursor returned in a previous page. */
  cursor?: string;
  /** Text search over stream names. */
  q?: string;
  /** Structured stream-type filter. */
  streamType?: string;
};

export type ListStreamsResult = {
  streams: StreamCatalogEntry[];
  nextCursor?: string;
};

/**
 * Optional backend capability listing streams for the operational catalog.
 * Ordering must be deterministic. Invalid cursors throw `ValidationError`.
 */
export type StreamCatalog = {
  /** Human-readable ordering semantics, advertised in capabilities. */
  ordering: string;
  /** Human-readable search semantics, advertised in capabilities. */
  search: string;
  listStreams: (options: ListStreamsOptions) => Promise<ListStreamsResult>;
};

const encodeCursor = (streamName: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(streamName)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');

const decodeCursor = (cursor: string): string | undefined => {
  try {
    const binary = atob(cursor.replaceAll('-', '+').replaceAll('_', '/'));

    return new TextDecoder('utf-8', { fatal: true }).decode(
      Uint8Array.from(binary, (char) => char.charCodeAt(0)),
    );
  } catch {
    return undefined;
  }
};

export type InMemoryStreamCatalog = StreamCatalog & {
  /**
   * Tracks appended messages. Pass it as the in-memory event store `onAfterCommit` hook:
   *
   * ```ts
   * const catalog = inMemoryStreamCatalog();
   * const eventStore = getInMemoryEventStore({
   *   hooks: { onAfterCommit: catalog.onAfterCommit },
   * });
   * ```
   */
  onAfterCommit: (
    messages: ReadEvent<Event, AnyReadEventMetadata>[],
  ) => Promise<void>;
};

/**
 * Stream catalog kept in memory, ordered by stream name (UTF-16 code units, ascending).
 * The cursor is the last returned stream name, so it stays valid while streams are added.
 */
export const inMemoryStreamCatalog = (options?: {
  streamIdentityCodec?: StreamIdentityCodec;
}): InMemoryStreamCatalog => {
  const codec = options?.streamIdentityCodec ?? typeIdStreamIdentityCodec;
  const versions = new Map<string, StreamPosition>();

  return {
    ordering: 'Stream name ascending, compared by UTF-16 code units.',
    search: 'Case-insensitive substring match on the stream name.',
    onAfterCommit: (messages) => {
      for (const message of messages)
        versions.set(
          message.metadata.streamName,
          message.metadata.streamPosition,
        );

      return Promise.resolve();
    },
    listStreams: ({ limit, cursor, q, streamType }) => {
      const after = cursor !== undefined ? decodeCursor(cursor) : undefined;
      if (cursor !== undefined && after === undefined)
        return Promise.reject(new ValidationError('Cursor is invalid'));

      const query = q?.toLowerCase();

      const matching = [...versions.keys()]
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
        .filter((name) => after === undefined || name > after)
        .filter((name) => !query || name.toLowerCase().includes(query))
        .filter(
          (name) =>
            streamType === undefined ||
            codec.parse(name)?.streamType === streamType,
        );

      const page = matching.slice(0, limit);
      const last = page[page.length - 1];

      return Promise.resolve({
        streams: page.map((streamName) => ({
          streamName,
          currentStreamVersion: versions.get(streamName)!,
        })),
        ...(matching.length > limit && last !== undefined
          ? { nextCursor: encodeCursor(last) }
          : {}),
      });
    },
  };
};
