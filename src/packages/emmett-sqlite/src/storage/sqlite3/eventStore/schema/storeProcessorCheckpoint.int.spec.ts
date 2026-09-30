import { JSONSerializer } from '@event-driven-io/dumbo';
import {
  InMemorySQLiteDatabase,
  sqlite3Connection,
  sqlite3Pool,
  type AnySQLiteConnection,
  type Sqlite3Pool,
} from '@event-driven-io/dumbo/sqlite3';
import {
  assertEqual,
  assertThrowsAsync,
  bigIntProcessorCheckpoint,
} from '@event-driven-io/emmett';
import { afterAll, beforeAll, describe, it, vi } from 'vitest';
import { storeProcessorCheckpoint } from '../../../../eventStore/schema/storeProcessorCheckpoint';

void describe('storeProcessorCheckpoint', () => {
  let connection: AnySQLiteConnection;
  let pool: Sqlite3Pool;

  beforeAll(() => {
    connection = sqlite3Connection({
      fileName: InMemorySQLiteDatabase,
      serializer: JSONSerializer,
    });
    pool = sqlite3Pool({
      fileName: InMemorySQLiteDatabase,
      singleton: true,
      connection,
    });
  });

  afterAll(async () => {
    await pool.close();
  });

  void it('a failing checkpoint store rethrows and logs nothing', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    let calls: number | undefined;

    try {
      await assertThrowsAsync(() =>
        storeProcessorCheckpoint(pool.execute, {
          processorId: 'processor-failing-store',
          lastProcessedCheckpoint: null,
          newCheckpoint: bigIntProcessorCheckpoint(1n),
          version: 1,
        }),
      );
      calls = consoleLog.mock.calls.length;
    } finally {
      consoleLog.mockRestore();
    }

    assertEqual(calls, 0);
  });
});
