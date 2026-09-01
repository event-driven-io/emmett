import {
  JSONSerializer,
  runSQLMigrations,
  SQL,
  sqlMigration,
  type SQLExecutor,
} from '@event-driven-io/dumbo';
import { sqliteTableName } from '@event-driven-io/dumbo/sqlite';
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
  type Event,
  type ReadEvent,
} from '@event-driven-io/emmett';
import { afterEach, beforeEach, describe, it } from 'vitest';
import { sqlite3EventStoreDriver } from '../../../../sqlite3';
import {
  getSQLiteEventStore,
  type SQLiteEventStore,
  type SQLiteReadEventMetadata,
} from '../../../SQLiteEventStore';
import { readProcessorCheckpoint } from '../../readProcessorCheckpoint';
import { schemaSQL } from '../../eventStoreSchemaSQL';
import { migrations_0_41_0 } from '../0_41_0';
import { migrations_0_42_0 } from '../0_42_0';
import { appendToStream } from '../0_42_0/legacyApi';
import { migrations_0_43_0 } from '../0_43_0';
import { schemaMigration, schemaMigrationFor } from '../index';

export type ProductItemAdded = Event<
  'ProductItemAdded',
  {
    shoppingCartId: string;
    productItem: { productId: string; quantity: number };
  }
>;

export type ShoppingCartConfirmed = Event<
  'ShoppingCartConfirmed',
  { shoppingCartId: string }
>;

export type ShoppingCartEvent = ProductItemAdded | ShoppingCartConfirmed;

export type OrderInitiated = Event<
  'OrderInitiated',
  { shoppingCartId: string; orderId: string }
>;

void describe('Schema migrations tests', () => {
  let connection: SQLite3Connection;
  let pool: Sqlite3Pool;
  let eventStore: SQLiteEventStore;

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

    // TODO: Just let Dumbo handle automatically singleton based on fileName
    eventStore = getSQLiteEventStore({
      driver: sqlite3EventStoreDriver,
      fileName: InMemorySQLiteDatabase,
      pool,
      schema: { autoMigration: 'None' },
    });
  });

  afterEach(async () => {
    await connection.close();
  });

  void it('migrates from fresh schema', async () => {
    // Given

    // When
    const { applied, skipped } = await eventStore.schema.migrate();

    // Then
    assertDeepEqual(applied, [
      ...migrations_0_42_0,
      ...migrations_0_43_0,
      schemaMigration,
    ]);
    assertThatArray(skipped).isEmpty();

    assertTrue(await tableExists(connection.execute, 'dmb_migrations'));

    const result = await assertCanAppendAndRead(eventStore);
    await assertCanStoreAndReadCheckpoints(connection.execute, result);
    await assertProjectionsTableExists(connection.execute);
  });

  void it('migrates fresh schema into the mixed database schemas configured by the user', async () => {
    // Given
    const schemaOptions = {
      databaseSchemaName: 'events',
      projectionsDatabaseSchemaName: 'read_models',
      migrationTable: {
        schemaName: 'infrastructure',
        tableName: 'emmett_migrations',
      },
    };
    eventStore = getSQLiteEventStore({
      driver: sqlite3EventStoreDriver,
      fileName: InMemorySQLiteDatabase,
      pool,
      schema: {
        autoMigration: 'None',
        ...schemaOptions,
      },
    });

    // When
    const { applied, skipped } = await eventStore.schema.migrate();

    // Then
    assertDeepEqual(applied, [schemaMigrationFor(schemaOptions)]);
    assertThatArray(skipped).isEmpty();

    assertTrue(await configuredTableExists('events', 'emt_streams'));
    assertTrue(await configuredTableExists('events', 'emt_messages'));
    assertTrue(await configuredTableExists('events', 'emt_processors'));
    assertTrue(await configuredTableExists('events', 'emt_projections'));
    assertTrue(
      await configuredTableExists('infrastructure', 'emmett_migrations'),
    );

    assertFalse(await tableExists(connection.execute, 'emt_streams'));
    assertFalse(await tableExists(connection.execute, 'emmett_migrations'));
    assertFalse(await configuredTableExists('read_models', 'emt_streams'));
    assertFalse(await configuredTableExists('events', 'emmett_migrations'));
    assertFalse(
      await configuredTableExists('infrastructure', 'dmb_migrations'),
    );

    await assertCanAppendAndRead(eventStore);
  });

  void it('migrates from 0.41.0 schema', async () => {
    // Given
    await runSQLMigrations(pool, migrations_0_41_0);

    // When
    const { applied, skipped } = await eventStore.schema.migrate();

    // Then
    assertDeepEqual(applied, [
      ...migrations_0_42_0,
      ...migrations_0_43_0,
      schemaMigration,
    ]);
    assertThatArray(skipped).isEmpty();

    const result = await assertCanAppendAndRead(eventStore);
    await assertCanStoreAndReadCheckpoints(connection.execute, result);
    await assertProjectionsTableExists(connection.execute);
  });

  void it('migrates from 0.42.0 schema', async () => {
    // Given
    await runSQLMigrations(pool, [...migrations_0_41_0, ...migrations_0_42_0]);

    // When
    const { applied, skipped } = await eventStore.schema.migrate();

    // Then
    assertDeepEqual(applied, [...migrations_0_43_0, schemaMigration]);
    assertDeepEqual(skipped, [...migrations_0_42_0]);

    const result = await assertCanAppendAndRead(eventStore);
    await assertCanStoreAndReadCheckpoints(connection.execute, result);
    await assertProjectionsTableExists(connection.execute);
  });

  void it('migrates from latest schema', async () => {
    // Given
    await eventStore.schema.migrate();

    // When
    const { applied, skipped } = await eventStore.schema.migrate();

    // Then
    assertThatArray(applied).isEmpty();
    assertDeepEqual(skipped, [
      ...migrations_0_42_0,
      ...migrations_0_43_0,
      schemaMigration,
    ]);
  });

  void it('migrates from the schema created before migrations were introduced', async () => {
    // Given
    await connection.execute.batchCommand(schemaSQL);
    const existingStreamId = 'cart-before-migrations';
    await eventStore.appendToStream(existingStreamId, [
      {
        type: 'ProductItemAdded',
        data: {
          shoppingCartId: existingStreamId,
          productItem: { productId: 'product-456', quantity: 2 },
        },
      } satisfies ProductItemAdded,
    ]);

    // When
    const { applied, skipped } = await eventStore.schema.migrate();

    // Then
    assertDeepEqual(applied, [
      ...migrations_0_42_0,
      ...migrations_0_43_0,
      schemaMigration,
    ]);
    assertThatArray(skipped).isEmpty();

    const existingStream =
      await eventStore.readStream<ShoppingCartEvent>(existingStreamId);

    assertTrue(existingStream.streamExists);
    assertDeepEqual(existingStream.currentStreamVersion, 1n);
    assertDeepEqual(existingStream.events.length, 1);

    const result = await assertCanAppendAndRead(eventStore);
    await assertCanStoreAndReadCheckpoints(connection.execute, result);
    await assertProjectionsTableExists(connection.execute);
  });

  void it('appends to a stream created by 0.42.0', async () => {
    // Given
    await runSQLMigrations(pool, [...migrations_0_41_0, ...migrations_0_42_0]);
    const legacyStreamId = 'cart-legacy-partition';
    await appendToStream(connection.execute, {
      streamId: legacyStreamId,
      streamType: 'cart',
      events: [
        {
          type: 'ProductItemAdded',
          data: {
            shoppingCartId: legacyStreamId,
            productItem: { productId: 'product-456', quantity: 2 },
          },
        } satisfies ProductItemAdded,
      ],
    });

    // When
    await eventStore.schema.migrate();

    // Then
    await eventStore.appendToStream(
      legacyStreamId,
      [
        {
          type: 'ShoppingCartConfirmed',
          data: { shoppingCartId: legacyStreamId },
        } satisfies ShoppingCartConfirmed,
      ],
      { expectedStreamVersion: 1n },
    );

    const stream =
      await eventStore.readStream<ShoppingCartEvent>(legacyStreamId);

    assertTrue(stream.streamExists);
    assertDeepEqual(stream.currentStreamVersion, 2n);
    assertDeepEqual(stream.events.length, 2);
    assertTrue(await eventStore.streamExists(legacyStreamId));
  });

  void it('skips the current schema migration when its SQL changed but the user already applied it', async () => {
    await runSQLMigrations(pool, [schemaMigration]);
    const sameMigrationChangedSQL = sqlMigration(
      schemaMigration.name,
      [SQL`SELECT 1`],
      { ignoreHashMismatch: true },
    );

    const { applied, skipped } = await runSQLMigrations(pool, [
      sameMigrationChangedSQL,
    ]);

    assertThatArray(applied).isEmpty();
    assertDeepEqual(skipped, [sameMigrationChangedSQL]);
  });

  void it('applies the migration after the user dry-runs it first', async () => {
    // Given
    const dryRun = await eventStore.schema.migrate({ dryRun: true });

    assertDeepEqual(dryRun.applied, [
      ...migrations_0_42_0,
      ...migrations_0_43_0,
      schemaMigration,
    ]);
    assertFalse(await tableExists(connection.execute, 'dmb_migrations'));
    assertFalse(await tableExists(connection.execute, 'emt_streams'));

    // When
    const { applied, skipped } = await eventStore.schema.migrate();

    // Then
    assertDeepEqual(applied, [
      ...migrations_0_42_0,
      ...migrations_0_43_0,
      schemaMigration,
    ]);
    assertThatArray(skipped).isEmpty();

    assertTrue(await tableExists(connection.execute, 'dmb_migrations'));

    const result = await assertCanAppendAndRead(eventStore);
    await assertCanStoreAndReadCheckpoints(connection.execute, result);
    await assertProjectionsTableExists(connection.execute);
  });

  const assertCanAppendAndRead = async (eventStore: SQLiteEventStore) => {
    const shoppingCartId = 'cart-123';
    const itemAdded: ProductItemAdded = {
      type: 'ProductItemAdded',
      data: {
        shoppingCartId,
        productItem: { productId: 'product-456', quantity: 2 },
      },
    };
    const shoppingCartConfirmed: ShoppingCartConfirmed = {
      type: 'ShoppingCartConfirmed',
      data: {
        shoppingCartId,
      },
    };

    await eventStore.appendToStream(shoppingCartId, [
      itemAdded,
      shoppingCartConfirmed,
    ]);

    const readShoppingCartResult =
      await eventStore.readStream<ShoppingCartEvent>(shoppingCartId);

    assertTrue(readShoppingCartResult.streamExists);
    assertDeepEqual(readShoppingCartResult.currentStreamVersion, 2n);
    assertDeepEqual(readShoppingCartResult.events.length, 2);

    const orderId = `order-${shoppingCartId}`;

    const orderInitiated: OrderInitiated = {
      type: 'OrderInitiated',
      data: {
        shoppingCartId: 'cart-123',
        orderId,
      },
    };
    await eventStore.appendToStream(orderId, [orderInitiated]);

    const readOrderResult =
      await eventStore.readStream<OrderInitiated>(orderId);

    assertTrue(readOrderResult.streamExists);
    assertDeepEqual(readOrderResult.currentStreamVersion, 1n);
    assertDeepEqual(readOrderResult.events.length, 1);

    return {
      shoppingCart: {
        streamId: shoppingCartId,
        lastEvent: readShoppingCartResult.events[1]!,
      },
      order: {
        streamId: orderId,
        lastEvent: readOrderResult.events[0]!,
      },
    };
  };

  const configuredTableExists = (
    databaseSchemaName: string,
    tableName: string,
  ): Promise<boolean> =>
    tableExists(
      connection.execute,
      sqliteTableName({ databaseSchemaName, tableName }),
    );

  const assertProjectionsTableExists = async (execute: SQLExecutor) => {
    assertTrue(await tableExists(execute, 'emt_projections'));
  };

  const assertCanStoreAndReadCheckpoints = async (
    execute: SQLExecutor,
    {
      shoppingCart,
      order,
    }: {
      shoppingCart: {
        streamId: string;
        lastEvent: ReadEvent<ShoppingCartEvent, SQLiteReadEventMetadata>;
      };
      order: {
        streamId: string;
        lastEvent: ReadEvent<OrderInitiated, SQLiteReadEventMetadata>;
      };
    },
  ) => {
    const shoppingCartProcessorId = `processor-shopping-cart-${shoppingCart.streamId}`;

    const shoppingCartCheckpoint = await readProcessorCheckpoint(execute, {
      processorId: shoppingCartProcessorId,
      partition: undefined,
    });

    assertDeepEqual(shoppingCartCheckpoint.lastProcessedCheckpoint, null);

    const orderProcessorId = `processor-order-${order.streamId}`;

    const orderCheckpoint = await readProcessorCheckpoint(execute, {
      processorId: orderProcessorId,
      partition: undefined,
    });

    assertDeepEqual(orderCheckpoint, { lastProcessedCheckpoint: null });
  };
});
