import {
  ValidationError,
  type Event,
  type ReadEvent,
} from '@event-driven-io/emmett';
import { describe, expect, it } from 'vitest';
import { inMemoryStreamCatalog } from './streamCatalog';

const recorded = (streamName: string, streamPosition: bigint) =>
  ({
    type: 'E',
    data: {},
    kind: 'Event',
    metadata: { streamName, streamPosition, messageId: '1' },
  }) as ReadEvent<Event>;

void describe('inMemoryStreamCatalog', () => {
  void it('keeps a cursor valid while new streams are added', async () => {
    const catalog = inMemoryStreamCatalog();
    await catalog.onAfterCommit([recorded('b', 1n), recorded('d', 1n)]);

    const first = await catalog.listStreams({ limit: 1 });
    await catalog.onAfterCommit([recorded('a', 1n), recorded('c', 1n)]);
    const second = await catalog.listStreams({
      limit: 10,
      cursor: first.nextCursor!,
    });

    expect(first.streams.map((s) => s.streamName)).toEqual(['b']);
    expect(second.streams.map((s) => s.streamName)).toEqual(['c', 'd']);
    expect(second.nextCursor).toBeUndefined();
  });

  void it('tracks the latest version of each stream', async () => {
    const catalog = inMemoryStreamCatalog();
    await catalog.onAfterCommit([recorded('s', 1n), recorded('s', 2n)]);

    expect((await catalog.listStreams({ limit: 10 })).streams).toEqual([
      { streamName: 's', currentStreamVersion: 2n },
    ]);
  });

  void it('supports cursors after non-ASCII stream names', async () => {
    const catalog = inMemoryStreamCatalog();
    await catalog.onAfterCommit([recorded('żółw', 1n), recorded('źrebię', 1n)]);

    const first = await catalog.listStreams({ limit: 1 });
    const second = await catalog.listStreams({
      limit: 1,
      cursor: first.nextCursor!,
    });

    expect(
      [...first.streams, ...second.streams].map((s) => s.streamName),
    ).toEqual(['źrebię', 'żółw']);
  });

  void it('rejects malformed cursors', async () => {
    const catalog = inMemoryStreamCatalog();

    await expect(
      catalog.listStreams({ limit: 1, cursor: '%%%' }),
    ).rejects.toThrow(ValidationError);
  });
});
