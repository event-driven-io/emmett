import assert from 'assert';
import { after, before, describe, it } from 'node:test';
import sqlite3 from 'sqlite3';
import {
  sqliteConnection,
  type SQLiteConnection,
} from '../../sqliteConnection';
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
  let conn: sqlite3.Database;
  let db: SQLiteConnection;

  before(async () => {
    conn = new sqlite3.Database(':memory:');

    db = sqliteConnection(conn);

    await createEventStoreSchema(db);
  });

  after(() => {
    conn.close();
  });

  void describe('creates tables', () => {
    void it('creates the streams table', async () => {
      assert.ok(await tableExists(db, 'emt_streams'));
    });

    void it('creates the events table', async () => {
      assert.ok(await tableExists(db, 'emt_events'));
    });
  });
});
