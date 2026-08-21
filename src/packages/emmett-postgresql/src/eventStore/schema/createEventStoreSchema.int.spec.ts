import { dumbo, SQL } from '@event-driven-io/dumbo';
import {
  functionExists,
  pgDumboDriver,
  tableExists,
  type PgPool,
} from '@event-driven-io/dumbo/pg';
import {
  assertEqual,
  assertFalse,
  assertTrue,
  type Event,
} from '@event-driven-io/emmett';
import { v4 as uuid } from 'uuid';
import { afterAll, beforeAll, describe, it } from 'vitest';
import {
  sharedPostgreSQLDatabase,
  type PostgreSQLTestDatabase,
} from '../../testing/postgreSQLTestDatabase';
import {
  getPostgreSQLEventStore,
  type PostgresEventStore,
} from '../postgreSQLEventStore';
import { createEventStoreSchema } from '../schema';

type ProductItemAdded = Event<
  'ProductItemAdded',
  {
    productItem: {
      productId: string;
      quantity: number;
      price: number;
    };
  }
>;

void describe('createEventStoreSchema', () => {
  let database: PostgreSQLTestDatabase;
  let pool: PgPool;

  beforeAll(async () => {
    database = await sharedPostgreSQLDatabase();
    const connectionString = database.connectionString;
    pool = dumbo({
      connectionString,
      driver: pgDumboDriver,
      transactionOptions: {
        allowNestedTransactions: true,
      },
    });
    await createEventStoreSchema(connectionString, pool);
  });

  afterAll(async () => {
    try {
      await pool?.close();
      await database?.close();
    } catch (error) {
      console.log(error);
    }
  });

  void describe('creates tables', () => {
    void it('creates the streams table', async () => {
      assertTrue(await tableExists(pool.execute, 'emt_streams'));
    });

    void it('creates the events table', async () => {
      assertTrue(await tableExists(pool.execute, 'emt_messages'));
    });

    void it('creates the processors table', async () => {
      assertTrue(await tableExists(pool.execute, 'emt_processors'));
    });

    void it('creates the events default partition', async () => {
      assertTrue(await tableExists(pool.execute, 'emt_messages_emt_default'));
    });

    void it('creates the events secondary level active partition', async () => {
      assertTrue(
        await tableExists(pool.execute, 'emt_messages_emt_default_active'),
      );
    });

    void it('creates the events secondary level archived partition', async () => {
      assertTrue(
        await tableExists(pool.execute, 'emt_messages_emt_default_archived'),
      );
    });
  });

  void describe('creates functions', () => {
    void it('creates the append_event function', async () => {
      assertTrue(await functionExists(pool.execute, 'emt_append_to_stream'));
    });

    void it('creates the emt_add_partition function', async () => {
      assertTrue(await functionExists(pool.execute, 'emt_add_partition'));
    });

    void it('does not create the add_module function', async () => {
      assertFalse(await functionExists(pool.execute, 'add_module'));
    });

    void it('does not create the add_tenant function', async () => {
      assertFalse(await functionExists(pool.execute, 'add_tenant'));
    });

    void it('does not create the add_module_for_all_tenants function', async () => {
      assertFalse(
        await functionExists(pool.execute, 'add_module_for_all_tenants'),
      );
    });

    void it('does not create the add_tenant_for_all_modules function', async () => {
      assertFalse(
        await functionExists(pool.execute, 'add_tenant_for_all_modules'),
      );
    });
  });

  // void it('allows adding a module', async () => {
  //   await pool.execute.query(rawSql(`SELECT add_module('test_module')`));

  //   const res = await exists(
  //     pool.execute.query(
  //       rawSql(`
  //     SELECT EXISTS (
  //       SELECT FROM pg_tables
  //       WHERE tablename = 'emt_messages_test_module__global'
  //     ) AS exists;
  //   `),
  //     ),
  //   );

  //   assertTrue(res, 'Module partition was not created');
  // });

  // void it('should allow adding a tenant', async () => {
  //   await pool.execute.query(
  //     rawSql(`SELECT add_tenant('test_module', 'test_tenant')`),
  //   );

  //   const res = await exists(
  //     pool.execute.query(
  //       rawSql(`
  //         SELECT EXISTS (
  //           SELECT FROM pg_tables
  //           WHERE tablename = 'emt_messages_test_module__test_tenant'
  //         ) AS exists;`),
  //     ),
  //   );

  //   assertTrue(res, 'Tenant partition was not created');
  // });

  // void it('should allow adding a module for all tenants', async () => {
  //   await createEventStoreSchema(pool);

  //   await pool.query(`INSERT INTO emt_messages (stream_id, stream_position, partition, message_data, message_metadata, message_schema_version, message_type, message_id, transaction_id)
  //                     VALUES ('test_stream', 0, 'global__global', '{}', '{}', '1.0', 'test', '${uuid()}', pg_current_xact_id())`);

  //   await pool.query(`SELECT add_module_for_all_tenants('new_module')`);

  //   const res = await pool.query(`
  //     SELECT EXISTS (
  //       SELECT FROM pg_tables
  //       WHERE tablename = 'emt_messages_new_module__existing_tenant'
  //     ) AS exists;
  //   `);

  //   assert.strictEqual(
  //     // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  //     res.rows[0].exists,
  //     true,
  //     'Module for all tenants was not created',
  //   );
  // });

  // void it('should allow adding a tenant for all modules', async () => {
  //   await createEventStoreSchema(pool);

  //   await pool.query(`INSERT INTO emt_messages (stream_id, stream_position, partition, message_data, message_metadata, message_schema_version, message_type, message_id, transaction_id)
  //                     VALUES ('test_stream', 0, '${emmettPrefix}:partition:existing_module:existing_tenant', '{}', '{}', '1.0', 'test', '${uuid()}', 0)`);

  //   await pool.query(`SELECT add_tenant_for_all_modules('new_tenant')`);

  //   const res = await pool.query(`
  //     SELECT EXISTS (
  //       SELECT FROM pg_tables
  //       WHERE tablename = 'emt_messages_existing_module_new_tenant'
  //     ) AS exists;
  //   `);

  //   assert.strictEqual(
  //     // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  //     res.rows[0].exists,
  //     true,
  //     'Tenant for all modules was not created',
  //   );
  // });
});

void describe('createEventStoreSchema with configured database schemas', () => {
  let database: PostgreSQLTestDatabase;
  let pool: PgPool;
  let connectionString: string;
  let eventStore: PostgresEventStore | undefined;

  beforeAll(async () => {
    database = await sharedPostgreSQLDatabase();
    connectionString = database.connectionString;
    pool = dumbo({
      connectionString,
      driver: pgDumboDriver,
      transactionOptions: {
        allowNestedTransactions: true,
      },
    });
  });

  afterAll(async () => {
    try {
      await eventStore?.close();
      await pool?.close();
      await database?.close();
    } catch (error) {
      console.log(error);
    }
  });

  void it('creates the event store objects in the schema configured by the user', async () => {
    await createEventStoreSchema(connectionString, pool, undefined, {
      databaseSchemaName: 'events',
    });

    assertTrue(await schemaExists('events'));
    assertTrue(await tableExistsInSchema('events', 'emt_streams'));
    assertTrue(await tableExistsInSchema('events', 'emt_messages'));
    assertTrue(await tableExistsInSchema('events', 'emt_messages_emt_default'));
    assertTrue(
      await tableExistsInSchema('events', 'emt_messages_emt_default_active'),
    );
    assertTrue(await tableExistsInSchema('events', 'dmb_migrations'));
    assertTrue(await functionExistsInSchema('events', 'emt_append_to_stream'));
    assertTrue(await functionExistsInSchema('events', 'emt_add_partition'));

    assertFalse(await tableExistsInSchema('public', 'emt_streams'));
    assertFalse(await tableExistsInSchema('public', 'dmb_migrations'));
    assertFalse(await functionExistsInSchema('public', 'emt_append_to_stream'));
  });

  void it('uses the migration table schema and name configured by the user', async () => {
    await createEventStoreSchema(connectionString, pool, undefined, {
      databaseSchemaName: 'store',
      migrationTable: {
        schemaName: 'infrastructure',
        tableName: 'emmett_migrations',
      },
    });

    assertTrue(await schemaExists('store'));
    assertTrue(await schemaExists('infrastructure'));
    assertTrue(await tableExistsInSchema('store', 'emt_streams'));
    assertTrue(
      await tableExistsInSchema('infrastructure', 'emmett_migrations'),
    );

    assertFalse(await tableExistsInSchema('store', 'dmb_migrations'));
    assertFalse(await tableExistsInSchema('public', 'emmett_migrations'));
  });

  void it('passes the configured schema names to schema creation hooks', async () => {
    const eventSchemaName = schemaName('events');
    let beforeMigrationTableSchemaName: string | undefined;
    let beforeProjectionsDatabaseSchemaName: string | undefined;
    let afterMigrationTableSchemaName: string | undefined;
    let afterProjectionsDatabaseSchemaName: string | undefined;

    await createEventStoreSchema(
      connectionString,
      pool,
      {
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
      {
        databaseSchemaName: eventSchemaName,
        migrationTable: {
          tableName: 'custom_migrations',
        },
      },
    );

    assertEqual(beforeMigrationTableSchemaName, eventSchemaName);
    assertEqual(beforeProjectionsDatabaseSchemaName, eventSchemaName);
    assertEqual(afterMigrationTableSchemaName, eventSchemaName);
    assertEqual(afterProjectionsDatabaseSchemaName, eventSchemaName);
  });

  void it('stores and reads events from the schema configured by the user', async () => {
    const configuredSchemaName = 'configured_runtime';
    const streamName = `shopping_cart-${Date.now()}`;
    eventStore = getPostgreSQLEventStore(connectionString, {
      schema: {
        autoMigration: 'CreateOrUpdate',
        databaseSchemaName: configuredSchemaName,
      },
    });

    const appendResult = await eventStore.appendToStream(streamName, [
      {
        type: 'ProductItemAdded',
        data: { productItem: { productId: 'sku-1', quantity: 1, price: 10 } },
      },
    ]);

    const readResult = await eventStore.readStream(streamName);
    const exists = await eventStore.streamExists(streamName);

    assertEqual(appendResult.nextExpectedStreamVersion, 1n);
    assertTrue(readResult.streamExists);
    assertEqual(readResult.events.length, 1);
    assertTrue(exists);
    assertTrue(await tableExistsInSchema(configuredSchemaName, 'emt_messages'));
    assertFalse(await tableExistsInSchema('public', 'emt_messages'));
  });

  void it('keeps streams with the same name isolated between schemas configured by the user', async () => {
    const firstSchemaName = 'configured_runtime_first';
    const secondSchemaName = 'configured_runtime_second';
    const streamName = `shopping_cart-${Date.now()}`;
    const firstEventStore = getPostgreSQLEventStore(connectionString, {
      schema: {
        autoMigration: 'CreateOrUpdate',
        databaseSchemaName: firstSchemaName,
      },
    });
    const secondEventStore = getPostgreSQLEventStore(connectionString, {
      schema: {
        autoMigration: 'CreateOrUpdate',
        databaseSchemaName: secondSchemaName,
      },
    });

    try {
      await firstEventStore.appendToStream(streamName, [
        {
          type: 'ProductItemAdded',
          data: {
            productItem: { productId: 'sku-first', quantity: 1, price: 10 },
          },
        },
      ]);
      await secondEventStore.appendToStream(streamName, [
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

      assertTrue(firstRead.streamExists);
      assertTrue(secondRead.streamExists);
      assertEqual(firstRead.events.length, 1);
      assertEqual(secondRead.events.length, 1);
      assertEqual(firstRead.events[0]?.data.productItem.productId, 'sku-first');
      assertEqual(
        secondRead.events[0]?.data.productItem.productId,
        'sku-second',
      );
      assertEqual(await messagesCountInSchema(firstSchemaName), 1);
      assertEqual(await messagesCountInSchema(secondSchemaName), 1);
      assertFalse(await tableExistsInSchema('public', 'emt_messages'));
    } finally {
      await firstEventStore.close();
      await secondEventStore.close();
    }
  });

  const schemaExists = async (schemaName: string): Promise<boolean> => {
    const result = await pool.execute.query<{ exists: boolean }>(SQL`
      SELECT EXISTS (
        SELECT FROM information_schema.schemata
        WHERE schema_name = ${schemaName}
      ) AS exists`);

    return result.rows[0]?.exists === true;
  };

  const tableExistsInSchema = async (
    schemaName: string,
    tableName: string,
  ): Promise<boolean> => {
    const result = await pool.execute.query<{ exists: boolean }>(SQL`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = ${schemaName}
          AND table_name = ${tableName}
      ) AS exists`);

    return result.rows[0]?.exists === true;
  };

  const functionExistsInSchema = async (
    schemaName: string,
    functionName: string,
  ): Promise<boolean> => {
    const result = await pool.execute.query<{ exists: boolean }>(SQL`
      SELECT EXISTS (
        SELECT FROM pg_proc
        JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
        WHERE pg_namespace.nspname = ${schemaName}
          AND pg_proc.proname = ${functionName}
      ) AS exists`);

    return result.rows[0]?.exists === true;
  };

  const messagesCountInSchema = async (schemaName: string): Promise<number> => {
    const result = await pool.execute.query<{ count: string }>(SQL`
      SELECT COUNT(*)::text AS count
      FROM ${SQL.identifier(schemaName)}.${SQL.identifier('emt_messages')}`);

    return Number(result.rows[0]?.count ?? 0);
  };
});

const schemaName = (prefix: string): string =>
  `${prefix}_${uuid().replaceAll('-', '_')}`;
