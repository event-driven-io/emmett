import type { DurableObjectStorage } from '@cloudflare/workers-types';
import { count, SQL, SQLTableReference } from '@event-driven-io/dumbo';
import {
  cloudflareDurableObjectSQLitePool,
  tableExists,
  type CloudflareDurableObjectSQLiteConnectionPool,
} from '@event-driven-io/dumbo/cloudflare';
import { sqliteTableName } from '@event-driven-io/dumbo/sqlite';
import {
  assertDeepEqual,
  assertEqual,
  assertFalse,
  assertTrue,
} from '@event-driven-io/emmett';
import assert from 'assert';
import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { v4 as uuid } from 'uuid';
import { aroundEach, describe, it } from 'vitest';
import { durableObjectEventStoreDriver } from '../..';
import type { ProductItemAdded } from '../../../../testing/shoppingCart.domain';
import { getSQLiteEventStore } from '../../../../eventStore/SQLiteEventStore';
import { createEventStoreSchema } from '../../../../eventStore/schema';
import { schemaMigrationFor } from '../../../../eventStore/schema/migrations';

void describe('createEventStoreSchema', () => {
  let pool: CloudflareDurableObjectSQLiteConnectionPool;

  aroundEach(async (runTest) => {
    const stub = env.TEST_OBJECT.get(env.TEST_OBJECT.newUniqueId());

    await runInDurableObject(stub, async (_instance, state) => {
      pool = cloudflareDurableObjectSQLitePool({
        storage: state.storage,
        transactionOptions: {
          allowNestedTransactions: true,
        },
      });

      try {
        await createEventStoreSchema({
          pool,
        });
        await runTest();
      } finally {
        await pool.close();
      }
    });
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
  let storage: DurableObjectStorage;
  let pool: CloudflareDurableObjectSQLiteConnectionPool;

  aroundEach(async (runTest) => {
    const stub = env.TEST_OBJECT.get(env.TEST_OBJECT.newUniqueId());

    await runInDurableObject(stub, async (_instance, state) => {
      storage = state.storage;
      pool = cloudflareDurableObjectSQLitePool({
        storage,
        transactionOptions: {
          allowNestedTransactions: true,
        },
      });

      try {
        await runTest();
      } finally {
        await pool.close();
      }
    });
  });

  void it('creates the event store objects in the schema configured by the user', async () => {
    await createEventStoreSchema({
      pool,
      schema: {
        databaseSchemaName: 'events',
      },
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
    await createEventStoreSchema({
      pool,
      schema: {
        databaseSchemaName: 'store',
        migrationTable: {
          schemaName: 'infrastructure',
          tableName: 'emmett_migrations',
        },
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

    await createEventStoreSchema({
      pool,
      schema: schemaOptions,
    });

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
      driver: durableObjectEventStoreDriver,
      storage,
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

  void it('passes the configured schema names to schema creation hooks', async () => {
    let beforeMigrationTableSchemaName: string | undefined;
    let beforeProjectionsDatabaseSchemaName: string | undefined;
    let afterMigrationTableSchemaName: string | undefined;
    let afterProjectionsDatabaseSchemaName: string | undefined;

    await createEventStoreSchema({
      pool,
      hooks: {
        onBeforeSchemaCreated: (context) => {
          beforeMigrationTableSchemaName =
            context.migrationOptions?.migrationTable?.schemaName;
          beforeProjectionsDatabaseSchemaName =
            context.migrationOptions?.projectionsDatabaseSchemaName;
        },
        onAfterSchemaCreated: (context) => {
          afterMigrationTableSchemaName =
            context.migrationOptions?.migrationTable?.schemaName;
          afterProjectionsDatabaseSchemaName =
            context.migrationOptions?.projectionsDatabaseSchemaName;
        },
      },
      schema: {
        databaseSchemaName: 'events',
        migrationTable: { tableName: 'emmett_migrations' },
      },
    });

    assertEqual(beforeMigrationTableSchemaName, 'events');
    assertEqual(beforeProjectionsDatabaseSchemaName, 'events');
    assertEqual(afterMigrationTableSchemaName, 'events');
    assertEqual(afterProjectionsDatabaseSchemaName, 'events');
  });

  void it('stores and reads events from the schema configured by the user', async () => {
    const streamName = `shopping_cart-${uuid()}`;
    const eventStore = getSQLiteEventStore({
      driver: durableObjectEventStoreDriver,
      storage,
      pool,
      schema: { autoMigration: 'CreateOrUpdate', databaseSchemaName: 'events' },
    });

    const appendResult = await eventStore.appendToStream<ProductItemAdded>(
      streamName,
      [
        {
          type: 'ProductItemAdded',
          data: { productItem: { productId: 'sku-1', quantity: 1, price: 10 } },
        },
      ],
    );

    const readResult =
      await eventStore.readStream<ProductItemAdded>(streamName);

    assertEqual(appendResult.nextExpectedStreamVersion, 1n);
    assertTrue(readResult.streamExists);
    assertEqual(readResult.events.length, 1);
    assertEqual(readResult.events[0]?.data.productItem.productId, 'sku-1');
    assertTrue(await eventStore.streamExists(streamName));
    assertEqual(await messagesCountIn('events'), 1);
    assertFalse(await tableExists(pool.execute, 'emt_messages'));
  });

  void it('keeps streams with the same name isolated between schemas configured by the user', async () => {
    const streamName = `shopping_cart-${uuid()}`;
    const firstEventStore = getSQLiteEventStore({
      driver: durableObjectEventStoreDriver,
      storage,
      pool,
      schema: { autoMigration: 'CreateOrUpdate', databaseSchemaName: 'first' },
    });
    const secondEventStore = getSQLiteEventStore({
      driver: durableObjectEventStoreDriver,
      storage,
      pool,
      schema: { autoMigration: 'CreateOrUpdate', databaseSchemaName: 'second' },
    });

    await firstEventStore.appendToStream<ProductItemAdded>(streamName, [
      {
        type: 'ProductItemAdded',
        data: {
          productItem: { productId: 'sku-first', quantity: 1, price: 10 },
        },
      },
    ]);
    await secondEventStore.appendToStream<ProductItemAdded>(streamName, [
      {
        type: 'ProductItemAdded',
        data: {
          productItem: { productId: 'sku-second', quantity: 1, price: 20 },
        },
      },
    ]);

    const firstRead =
      await firstEventStore.readStream<ProductItemAdded>(streamName);
    const secondRead =
      await secondEventStore.readStream<ProductItemAdded>(streamName);

    assertEqual(firstRead.events.length, 1);
    assertEqual(secondRead.events.length, 1);
    assertEqual(firstRead.events[0]?.data.productItem.productId, 'sku-first');
    assertEqual(secondRead.events[0]?.data.productItem.productId, 'sku-second');
    assertEqual(await messagesCountIn('first'), 1);
    assertEqual(await messagesCountIn('second'), 1);
    assertFalse(await tableExists(pool.execute, 'emt_messages'));
  });

  void it('stores and reads events from the configured schema when the user turns auto migration off', async () => {
    const schemaOptions = { databaseSchemaName: 'events' };
    const streamName = `shopping_cart-${uuid()}`;
    await createEventStoreSchema({
      pool,
      schema: schemaOptions,
    });

    const eventStore = getSQLiteEventStore({
      driver: durableObjectEventStoreDriver,
      storage,
      pool,
      schema: { autoMigration: 'None', ...schemaOptions },
    });

    await eventStore.appendToStream<ProductItemAdded>(streamName, [
      {
        type: 'ProductItemAdded',
        data: { productItem: { productId: 'sku-1', quantity: 1, price: 10 } },
      },
    ]);

    const readResult =
      await eventStore.readStream<ProductItemAdded>(streamName);

    assertTrue(readResult.streamExists);
    assertEqual(readResult.events.length, 1);
    assertEqual(await messagesCountIn('events'), 1);
    assertFalse(await tableExists(pool.execute, 'emt_messages'));
  });

  const messagesCountIn = (databaseSchemaName: string): Promise<number> =>
    count(
      pool.execute.query<{ count: number }>(
        SQL`SELECT COUNT(*) AS count FROM ${SQLTableReference.from({
          databaseSchemaName,
          tableName: 'emt_messages',
        })}`,
      ),
    );

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
