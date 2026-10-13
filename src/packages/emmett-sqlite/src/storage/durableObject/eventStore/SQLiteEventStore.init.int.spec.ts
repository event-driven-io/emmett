import type { DurableObjectStorage } from '@cloudflare/workers-types';
import {
  cloudflareDurableObjectSQLitePool,
  type CloudflareDurableObjectSQLiteConnectionPool,
} from '@event-driven-io/dumbo/cloudflare';
import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { aroundEach, describe } from 'vitest';
import { durableObjectEventStoreDriver } from '..';
import { getSQLiteEventStore } from '../../../eventStore/SQLiteEventStore';
import { sqliteEventStoreInitTests } from '../../../eventStore/sqliteEventStoreInitTests';

void describe('SQLite event store init on Durable Objects', () => {
  let storage: DurableObjectStorage;
  let pool: CloudflareDurableObjectSQLiteConnectionPool;

  aroundEach(async (runTest) => {
    const stub = env.TEST_OBJECT.get(env.TEST_OBJECT.newUniqueId());

    await runInDurableObject(stub, async (_instance, state) => {
      storage = state.storage;
      pool = cloudflareDurableObjectSQLitePool({ storage });
      try {
        await runTest();
      } finally {
        await pool.close();
      }
    });
  });

  sqliteEventStoreInitTests({
    storeWith: ({ allowNestedTransactions, ...options }) =>
      getSQLiteEventStore({
        driver: durableObjectEventStoreDriver,
        storage,
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
