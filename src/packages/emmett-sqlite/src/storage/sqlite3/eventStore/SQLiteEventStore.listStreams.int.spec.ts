import { InMemorySQLiteDatabase } from '@event-driven-io/dumbo/sqlite3';
import { ValidationError } from '@event-driven-io/emmett';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sqlite3EventStoreDriver } from '..';
import {
  getSQLiteEventStore,
  type SQLiteEventStore,
} from '../../../eventStore/SQLiteEventStore';

const event = { type: 'OrderPlaced', data: { id: 1 } };

void describe('SQLiteEventStore listStreams', () => {
  let eventStore: SQLiteEventStore;

  beforeEach(() => {
    eventStore = getSQLiteEventStore({
      driver: sqlite3EventStoreDriver,
      schema: { autoMigration: 'CreateOrUpdate' },
      fileName: InMemorySQLiteDatabase,
    });
  });

  afterEach(() => eventStore.close());

  void it('lists streams ordered by name with their current versions', async () => {
    await eventStore.appendToStream('order-2', [event]);
    await eventStore.appendToStream('order-1', [event, event]);

    const result = await eventStore.listStreams({ limit: 10 });

    expect(result).toEqual({
      streams: [
        { streamName: 'order-1', currentStreamVersion: 2n },
        { streamName: 'order-2', currentStreamVersion: 1n },
      ],
    });
  });

  void it('pages with an opaque cursor', async () => {
    for (const name of ['c', 'żółw', 'a', 'b'])
      await eventStore.appendToStream(name, [event]);

    const names: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await eventStore.listStreams({
        limit: 1,
        ...(cursor ? { cursor } : {}),
      });
      names.push(...page.streams.map((s) => s.streamName));
      cursor = page.nextCursor;
    } while (cursor);

    expect(names).toEqual(['a', 'b', 'c', 'żółw']);
  });

  void it('filters by name substring and by the stored stream type', async () => {
    for (const name of ['order-1', 'cart-1', 'cart-order', 'cart'])
      await eventStore.appendToStream(name, [event]);

    const bySearch = await eventStore.listStreams({ limit: 10, q: 'order' });
    const byType = await eventStore.listStreams({
      limit: 10,
      streamType: 'cart',
    });

    expect(bySearch.streams.map((s) => s.streamName)).toEqual([
      'cart-order',
      'order-1',
    ]);
    expect(byType.streams.map((s) => s.streamName)).toEqual([
      'cart-1',
      'cart-order',
    ]);
  });

  void it('rejects a malformed cursor', async () => {
    await expect(
      eventStore.listStreams({ limit: 1, cursor: '%%%' }),
    ).rejects.toThrow(ValidationError);
  });
});
