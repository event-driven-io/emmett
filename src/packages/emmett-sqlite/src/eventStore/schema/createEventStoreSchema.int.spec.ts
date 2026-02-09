import {
  InMemorySQLiteDatabase,
  sqlite3Pool,
  tableExists,
  type Sqlite3Pool,
} from '@event-driven-io/dumbo/sqlite3';
import assert from 'assert';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { createEventStoreSchema } from '../schema';

void describe('createEventStoreSchema', () => {
  let pool: Sqlite3Pool;

  beforeAll(async () => {
    pool = sqlite3Pool({
      fileName: InMemorySQLiteDatabase,
      transactionOptions: {
        allowNestedTransactions: true,
        mode: 'session_based',
      },
    });

    await pool.withConnection((connection) =>
      createEventStoreSchema(connection),
    );
  });

  afterAll(async () => {
    await pool.close();
  });

  void describe('creates tables', () => {
    void it('creates the streams table', async () => {
      assert.ok(await tableExists(pool.execute, 'emt_streams'));
    });

    void it('creates the events table', async () => {
      assert.ok(await tableExists(pool.execute, 'emt_messages'));
    });
  });
});
