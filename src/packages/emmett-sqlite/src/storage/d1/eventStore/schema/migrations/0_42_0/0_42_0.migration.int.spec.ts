import type { D1Database } from '@cloudflare/workers-types';
import {
  JSONSerializer,
  runSQLMigrations,
  SQL,
  single,
} from '@event-driven-io/dumbo';
import {
  d1Connection,
  d1Pool,
  tableExists,
  type D1Connection,
  type D1ConnectionPool,
} from '@event-driven-io/dumbo/cloudflare';
import {
  assertDeepEqual,
  assertFalse,
  assertThatArray,
  assertTrue,
} from '@event-driven-io/emmett';
import { Miniflare } from 'miniflare';
import { afterEach, beforeEach, describe, it } from 'vitest';
import { defaultTag } from '../../../../../../eventStore/schema/typing';
import { migrations_0_41_0 } from '../../../../../../eventStore/schema/migrations/0_41_0';
import { migrations_0_42_0 } from '../../../../../../eventStore/schema/migrations/0_42_0';

void describe('Schema migrations tests', () => {
  let connection: D1Connection;
  let pool: D1ConnectionPool;
  let mf: Miniflare;
  let database: D1Database;

  beforeEach(async () => {
    mf = new Miniflare({
      modules: true,
      script: 'export default { fetch() { return new Response("ok"); } }',
      d1Databases: { DB: 'test-db-id' },
    });
    database = await mf.getD1Database('DB');
    connection = d1Connection({
      database,
      serializer: JSONSerializer,
      transactionOptions: {
        allowNestedTransactions: true,
        mode: 'session_based',
      },
    });

    pool = d1Pool({ database, connection });
  });

  afterEach(async () => {
    await connection.close();
    await mf.dispose();
  });

  void it('migrates from 0.41.0 schema', async () => {
    // Given
    await runSQLMigrations(pool, migrations_0_41_0);

    // When
    const { applied, skipped } = await runSQLMigrations(
      pool,
      migrations_0_42_0,
    );

    // Then
    assertDeepEqual(applied, migrations_0_42_0);
    assertThatArray(skipped).isEmpty();

    assertTrue(await tableExists(pool.execute, 'emt_processors'));
    assertTrue(await tableExists(pool.execute, 'emt_projections'));
    assertFalse(await tableExists(pool.execute, 'emt_subscriptions'));
  });

  void it('migrates from 0.42.0 schema', async () => {
    // Given
    await runSQLMigrations(pool, [...migrations_0_41_0, ...migrations_0_42_0]);

    // When
    const { applied, skipped } = await runSQLMigrations(
      pool,
      migrations_0_42_0,
    );

    // Then
    assertThatArray(applied).isEmpty();
    assertDeepEqual(skipped, migrations_0_42_0);
  });

  void it('migrates pre-existing subscription checkpoint to processor table', async () => {
    // Given
    await runSQLMigrations(pool, migrations_0_41_0);
    await pool.execute.command(SQL`
      INSERT INTO emt_subscriptions (subscription_id, version, partition, last_processed_position)
      VALUES ('legacy-processor-1', 1, ${defaultTag}, 42)
    `);

    // When
    await runSQLMigrations(pool, migrations_0_42_0);

    // Then
    const result = await single(
      pool.execute.query<{
        processor_id: string;
        last_processed_checkpoint: string;
      }>(SQL`
        SELECT processor_id, last_processed_checkpoint
        FROM emt_processors
        WHERE processor_id = 'legacy-processor-1' AND partition = ${defaultTag}
      `),
    );

    assertDeepEqual(result?.processor_id, 'legacy-processor-1');
    assertDeepEqual(result?.last_processed_checkpoint, '0000000000000000042');
  });
});
