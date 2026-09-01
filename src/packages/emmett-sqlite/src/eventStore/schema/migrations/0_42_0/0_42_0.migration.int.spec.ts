import {
  JSONSerializer,
  runSQLMigrations,
  SQL,
  single,
} from '@event-driven-io/dumbo';
import {
  InMemorySQLiteDatabase,
  sqlite3Connection,
  sqlite3Pool,
  tableExists,
  type SQLite3Connection,
  type Sqlite3Pool,
} from '@event-driven-io/dumbo/sqlite3';
import {
  assertDeepEqual,
  assertFalse,
  assertThatArray,
  assertTrue,
} from '@event-driven-io/emmett';
import { afterEach, beforeEach, describe, it } from 'vitest';
import { defaultTag } from '../../typing';
import { migrations_0_41_0 } from '../0_41_0';
import { migrations_0_42_0 } from '../0_42_0';

void describe('Schema migrations tests', () => {
  let connection: SQLite3Connection;
  let pool: Sqlite3Pool;

  beforeEach(() => {
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

  afterEach(async () => {
    await connection.close();
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
