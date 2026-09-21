import type { DurableObjectStorage } from '@cloudflare/workers-types';
import { dumbo, SQL } from '@event-driven-io/dumbo';
import { cloudflareDurableObjectSQLiteDumboDriver } from '@event-driven-io/dumbo/cloudflare';
import { assertEqual } from '@event-driven-io/emmett';
import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { aroundEach, describe, it } from 'vitest';

void describe('Durable Object test runner', () => {
  let storage: DurableObjectStorage;

  aroundEach(async (runTest) => {
    const stub = env.TEST_OBJECT.get(env.TEST_OBJECT.newUniqueId());

    await runInDurableObject(stub, async (_instance, state) => {
      storage = state.storage;
      await runTest();
    });
  });

  void it('opens a pool on the storage handed out by runInDurableObject', async () => {
    const pool = dumbo({
      driver: cloudflareDurableObjectSQLiteDumboDriver,
      storage,
    });

    try {
      const result = await pool.execute.query<{ value: number }>(
        SQL`SELECT ${1} AS value`,
      );

      assertEqual(result.rowCount, 1);
      assertEqual(result.rows[0]?.value, 1);
    } finally {
      await pool.close();
    }
  });
});
