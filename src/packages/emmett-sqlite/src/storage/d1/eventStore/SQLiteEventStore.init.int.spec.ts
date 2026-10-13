import type { D1Database } from '@cloudflare/workers-types';
import {
  d1Pool,
  type D1ConnectionPool,
} from '@event-driven-io/dumbo/cloudflare';
import { Miniflare } from 'miniflare';
import { afterEach, beforeEach, describe } from 'vitest';
import { d1EventStoreDriver } from '..';
import { getSQLiteEventStore } from '../../../eventStore/SQLiteEventStore';
import { sqliteEventStoreInitTests } from '../../../eventStore/sqliteEventStoreInitTests';

void describe('SQLite event store init on D1', () => {
  let mf: Miniflare;
  let database: D1Database;
  let pool: D1ConnectionPool;

  beforeEach(async () => {
    mf = new Miniflare({
      modules: true,
      script: 'export default { fetch() { return new Response("ok"); } }',
      d1Databases: { DB: 'test-db-id' },
    });
    database = await mf.getD1Database('DB');
    pool = d1Pool({ database });
  });

  afterEach(async () => {
    await pool.close();
    await mf.dispose();
  });

  sqliteEventStoreInitTests({
    storeWith: ({ allowNestedTransactions, ...options }) =>
      getSQLiteEventStore({
        driver: d1EventStoreDriver,
        database,
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
    rollsBackTransactions: false,
  });
});
