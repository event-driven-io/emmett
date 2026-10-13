import {
  sqlite3Pool,
  type SQLite3Connection,
} from '@event-driven-io/dumbo/sqlite3';
import type { SQLitePool } from '@event-driven-io/dumbo/sqlite';
import { v4 as uuid } from 'uuid';
import { afterEach, beforeEach, describe } from 'vitest';
import { sqlite3EventStoreDriver } from '..';
import { getSQLiteEventStore } from '../../../eventStore/SQLiteEventStore';
import { sqliteEventStoreInitTests } from '../../../eventStore/sqliteEventStoreInitTests';
import { deleteSQLiteDatabaseFiles } from '../testing/sqliteTestDatabase';

void describe('SQLite event store init on sqlite3', () => {
  let fileName: string;
  let pool: SQLitePool<SQLite3Connection>;

  beforeEach(() => {
    fileName = `./test-init-${uuid()}.db`;
    pool = sqlite3Pool({ fileName });
  });

  afterEach(async () => {
    await pool.close();
    deleteSQLiteDatabaseFiles(fileName);
  });

  sqliteEventStoreInitTests({
    storeWith: ({ allowNestedTransactions, ...options }) =>
      getSQLiteEventStore({
        driver: sqlite3EventStoreDriver,
        fileName,
        ...(allowNestedTransactions === undefined
          ? {}
          : {
              connectionOptions: {
                transactionOptions: { allowNestedTransactions },
              },
            }),
        ...options,
      }),
    execute: () => pool.execute,
    rollsBackTransactions: true,
  });
});
