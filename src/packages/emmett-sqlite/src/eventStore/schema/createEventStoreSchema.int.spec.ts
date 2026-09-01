import { SQL, SQLTableReference } from '@event-driven-io/dumbo';
import { sqliteTableName } from '@event-driven-io/dumbo/sqlite';
import {
  InMemorySQLiteDatabase,
  sqlite3Pool,
  tableExists,
  type Sqlite3Pool,
} from '@event-driven-io/dumbo/sqlite3';
import {
  assertDeepEqual,
  assertFalse,
  assertTrue,
} from '@event-driven-io/emmett';
import assert from 'assert';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  it,
} from 'vitest';
import { sqlite3EventStoreDriver } from '../../sqlite3';
import { getSQLiteEventStore } from '../SQLiteEventStore';
import { createEventStoreSchema } from '../schema';
import { schemaMigrationFor } from './migrations';

void describe('createEventStoreSchema', () => {
  let pool: Sqlite3Pool;

  beforeAll(async () => {
    pool = sqlite3Pool({
      fileName: InMemorySQLiteDatabase,
      transactionOptions: {
        allowNestedTransactions: true,
      },
    });

    await createEventStoreSchema(pool);
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

void describe('createEventStoreSchema with configured database schemas', () => {
  let pool: Sqlite3Pool;

  beforeEach(() => {
    pool = sqlite3Pool({
      fileName: InMemorySQLiteDatabase,
      transactionOptions: {
        allowNestedTransactions: true,
      },
    });
  });

  afterEach(async () => {
    await pool.close();
  });

  void it('creates the event store objects in the schema configured by the user', async () => {
    await createEventStoreSchema(pool, undefined, {
      databaseSchemaName: 'events',
    });

    assertTrue(await configuredTableExists('events', 'emt_streams'));
    assertTrue(await configuredTableExists('events', 'emt_messages'));
    assertTrue(await configuredTableExists('events', 'emt_processors'));
    assertTrue(await configuredTableExists('events', 'emt_projections'));
    assertTrue(await configuredTableExists('events', 'dmb_migrations'));

    assertFalse(await tableExists(pool.execute, 'emt_streams'));
    assertFalse(await tableExists(pool.execute, 'emt_messages'));
    assertFalse(await tableExists(pool.execute, 'dmb_migrations'));
  });

  void it('uses the migration table schema and name configured by the user', async () => {
    await createEventStoreSchema(pool, undefined, {
      databaseSchemaName: 'store',
      migrationTable: {
        schemaName: 'infrastructure',
        tableName: 'emmett_migrations',
      },
    });

    assertTrue(await configuredTableExists('store', 'emt_streams'));
    assertTrue(
      await configuredTableExists('infrastructure', 'emmett_migrations'),
    );

    assertFalse(await configuredTableExists('store', 'dmb_migrations'));
    assertFalse(await tableExists(pool.execute, 'emmett_migrations'));
  });

  void it('records no migrations from before schema support in the schema configured by the user', async () => {
    const schemaOptions = { databaseSchemaName: 'events' };

    await createEventStoreSchema(pool, undefined, schemaOptions);

    assertDeepEqual(
      await migrationNames({
        databaseSchemaName: 'events',
        tableName: 'dmb_migrations',
      }),
      [schemaMigrationFor(schemaOptions).name],
    );
  });

  void it('applies the configured migration after the user dry-runs it first', async () => {
    const schemaOptions = {
      databaseSchemaName: 'events',
      migrationTable: {
        schemaName: 'infrastructure',
        tableName: 'emmett_migrations',
      },
    };
    const eventStore = getSQLiteEventStore({
      driver: sqlite3EventStoreDriver,
      fileName: InMemorySQLiteDatabase,
      pool,
      schema: {
        autoMigration: 'None',
        ...schemaOptions,
      },
    });

    const dryRun = await eventStore.schema.migrate({ dryRun: true });

    assertDeepEqual(dryRun.applied, [schemaMigrationFor(schemaOptions)]);
    assertFalse(await configuredTableExists('events', 'emt_streams'));
    assertFalse(
      await configuredTableExists('infrastructure', 'emmett_migrations'),
    );

    const { applied } = await eventStore.schema.migrate();

    assertDeepEqual(applied, [schemaMigrationFor(schemaOptions)]);
    assertTrue(await configuredTableExists('events', 'emt_streams'));
    assertDeepEqual(
      await migrationNames({
        databaseSchemaName: 'infrastructure',
        tableName: 'emmett_migrations',
      }),
      [schemaMigrationFor(schemaOptions).name],
    );
  });

  const configuredTableExists = (
    databaseSchemaName: string,
    tableName: string,
  ): Promise<boolean> =>
    tableExists(
      pool.execute,
      sqliteTableName({ databaseSchemaName, tableName }),
    );

  const migrationNames = async (identifier: {
    databaseSchemaName: string;
    tableName: string;
  }): Promise<string[]> => {
    const result = await pool.execute.query<{ name: string }>(
      SQL`SELECT name FROM ${SQLTableReference.from(identifier)} ORDER BY name`,
    );

    return result.rows.map((row) => row.name);
  };
});
