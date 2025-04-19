import assert from 'assert';
import { afterAll, beforeAll, describe, it } from 'vitest';
import {
  InMemorySQLiteDatabase,
  sqliteConnection,
  type SQLiteConnection,
} from '../../connection';
import { createEventStoreSchema } from '../schema';

type TableExists = {
  name: string;
};

const tableExists = async (
  db: SQLiteConnection,
  tableName: string,
): Promise<boolean> => {
  const result = await db.querySingle<TableExists>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='${tableName}';`,
  );

  return result?.name ? true : false;
};

void describe('createEventStoreSchema', () => {
  let db: SQLiteConnection;

  beforeAll(async () => {
    db = sqliteConnection({ fileName: InMemorySQLiteDatabase });

    await createEventStoreSchema(db);
  });

  afterAll(() => {
    db.close();
  });

  void describe('creates tables', () => {
    void it('creates the streams table', async () => {
      assert.ok(await tableExists(db, 'emt_streams'));
    });

    void it('creates the events table', async () => {
      assert.ok(await tableExists(db, 'emt_messages'));
    });
  });
});
