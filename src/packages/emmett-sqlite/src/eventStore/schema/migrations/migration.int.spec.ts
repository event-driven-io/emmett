import {
  JSONSerializer,
  single,
  SQL,
  type SQLExecutor,
} from '@event-driven-io/dumbo';
import {
  InMemorySQLiteDatabase,
  sqlite3Connection,
  sqlite3Pool,
  type SQLite3Connection,
} from '@event-driven-io/dumbo/sqlite3';
import {
  assertDeepEqual,
  assertTrue,
  type Event,
  type ReadEvent,
} from '@event-driven-io/emmett';
import { afterEach, beforeEach, describe, it } from 'vitest';
import { sqlite3EventStoreDriver } from '../../../sqlite3';
import {
  getSQLiteEventStore,
  type SQLiteEventStore,
  type SQLiteReadEventMetadata,
} from '../../SQLiteEventStore';
import { readProcessorCheckpoint } from '../readProcessorCheckpoint';
import { schemaSQL } from '../tables';
import { defaultTag } from '../typing';
import { schema_0_41_0 } from './0_41_0';
import { schema_0_42_0 } from './0_42_0';

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
  let eventStore: SQLiteEventStore;

  beforeEach(() => {
    connection = sqlite3Connection({
      fileName: InMemorySQLiteDatabase,
      serializer: JSONSerializer,
    });

    const pool = sqlite3Pool({
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

  void it('migrates from 0.41.0 schema', async () => {
    await connection.execute.batchCommand(schema_0_41_0);

    await eventStore.schema.migrate();

    const result = await assertCanAppendAndRead(eventStore);
    await assertCanStoreAndReadCheckpoints(connection.execute, result);
    await assertProjectionsTableExists(connection.execute);
  });

  void it('migrates from 0.42.0 schema', async () => {
    await connection.execute.batchCommand(schema_0_42_0);

    await eventStore.schema.migrate();

    const result = await assertCanAppendAndRead(eventStore);
    await assertCanStoreAndReadCheckpoints(connection.execute, result);
    await assertProjectionsTableExists(connection.execute);
  });

  void it('migrates from latest schema', async () => {
    await connection.execute.batchCommand(schemaSQL);

    await eventStore.schema.migrate();

    const result = await assertCanAppendAndRead(eventStore);
    await assertCanStoreAndReadCheckpoints(connection.execute, result);
    await assertProjectionsTableExists(connection.execute);
  });

  void it('migrates pre-existing subscription checkpoint', async () => {
    await connection.execute.batchCommand(schema_0_41_0);

    await connection.execute.command(SQL`
      INSERT INTO emt_subscriptions (subscription_id, version, partition, last_processed_position)
      VALUES ('legacy-processor-1', 1, ${defaultTag}, 42)
    `);

    await eventStore.schema.migrate();

    const result = await single(
      connection.execute.query<{
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

  const assertProjectionsTableExists = async (execute: SQLExecutor) => {
    const tableExists = await single(
      execute.query<{ name: string }>(
        SQL`SELECT name FROM sqlite_master WHERE type='table' AND name='emt_projections'`,
      ),
    );
    assertTrue(tableExists !== null);
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

    assertDeepEqual(shoppingCartCheckpoint.lastProcessedPosition, null);

    const orderProcessorId = `processor-order-${order.streamId}`;

    const orderCheckpoint = await readProcessorCheckpoint(execute, {
      processorId: orderProcessorId,
      partition: undefined,
    });

    assertDeepEqual(orderCheckpoint, { lastProcessedPosition: null });
  };
});
