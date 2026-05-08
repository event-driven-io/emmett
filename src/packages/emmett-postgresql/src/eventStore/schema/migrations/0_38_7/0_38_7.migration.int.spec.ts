import {
  dumbo,
  runSQLMigrations,
  SQL,
  type Dumbo,
} from '@event-driven-io/dumbo';
import { pgDumboDriver, type PgPool } from '@event-driven-io/dumbo/pg';
import {
  assertDeepEqual,
  assertMatches,
  assertThatArray,
  assertTrue,
  type Event,
  type ReadEvent,
} from '@event-driven-io/emmett';
import { getPostgreSQLStartedContainer } from '@event-driven-io/emmett-testcontainers';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  it,
} from 'vitest';
import { migrations_0_38_7 } from '.';
import {
  getPostgreSQLEventStore,
  type PostgresEventStore,
  type PostgresReadEventMetadata,
} from '../../../postgreSQLEventStore';
import { schema_0_36_0 } from '../0_36_0';

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
  let postgres: StartedPostgreSqlContainer;
  let pool: PgPool;
  let eventStore: PostgresEventStore;
  let connectionString: string;

  beforeAll(async () => {
    postgres = await getPostgreSQLStartedContainer();
    connectionString = postgres.getConnectionUri();

    await postgres.snapshot();
  });

  beforeEach(async () => {
    await postgres.restoreSnapshot();

    pool = dumbo({
      connectionString,
      driver: pgDumboDriver,
    });

    // TODO: Change setup to schemas, when they're supported in Emmett instead of using separate containers
    eventStore = getPostgreSQLEventStore(connectionString, {
      connectionOptions: { dumbo: pool },
      schema: { autoMigration: 'None' },
    });
  });

  afterEach(async () => {
    try {
      await eventStore.close();
      await pool.close();
    } catch (error) {
      console.log(error);
    }
  });

  afterAll(async () => {
    try {
      await postgres.stop();
    } catch (error) {
      console.log(error);
    }
  });

  void it('migrates from 0.36.0 schema', async () => {
    // Given
    await pool.execute.command(schema_0_36_0);

    // When
    const { applied, skipped } = await runSQLMigrations(
      pool,
      migrations_0_38_7,
    );

    // Then
    assertDeepEqual(applied, migrations_0_38_7);
    assertThatArray(skipped).isEmpty();

    const result = await assertCanAppendAndRead(eventStore);
    await assertCanStoreAndReadCheckpoints(pool, result);
  });

  void it('migrates from 0.38.7 schema', async () => {
    // Given
    await pool.execute.command(schema_0_36_0);
    await runSQLMigrations(pool, migrations_0_38_7);

    // When
    const { applied, skipped } = await runSQLMigrations(
      pool,
      migrations_0_38_7,
    );

    // Then
    assertThatArray(applied).isEmpty();
    assertDeepEqual(skipped, migrations_0_38_7);

    const result = await assertCanAppendAndRead(eventStore);
    await assertCanStoreAndReadCheckpoints(pool, result);
  });

  const assertCanAppendAndRead = async (eventStore: PostgresEventStore) => {
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
    assertMatches(readShoppingCartResult.events[0], itemAdded);
    assertMatches(readShoppingCartResult.events[1], shoppingCartConfirmed);

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
    assertMatches(readOrderResult.events[0], orderInitiated);

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

  const assertCanStoreAndReadCheckpoints = async (
    pool: Dumbo,
    {
      shoppingCart,
      order,
    }: {
      shoppingCart: {
        streamId: string;
        lastEvent: ReadEvent<ShoppingCartEvent, PostgresReadEventMetadata>;
      };
      order: {
        streamId: string;
        lastEvent: ReadEvent<OrderInitiated, PostgresReadEventMetadata>;
      };
    },
  ) => {
    const shoppingCartProcessorId = `processor-shopping-cart-${shoppingCart.streamId}`;

    let storeResult = await storeSubscriptionCheckpoint(
      pool,
      shoppingCartProcessorId,
      1n,
      null,
    );

    assertTrue(storeResult);

    storeResult = await storeSubscriptionCheckpoint(
      pool,
      shoppingCartProcessorId,
      shoppingCart.lastEvent.metadata.globalPosition,
      1n,
    );

    assertTrue(storeResult);

    const shoppingCartCheckpoint = await readSubscriptionCheckpoint(
      pool,
      shoppingCartProcessorId,
    );

    assertDeepEqual(
      shoppingCartCheckpoint.position,
      shoppingCart.lastEvent.metadata.globalPosition,
    );

    const orderProcessorId = `processor-order-${order.streamId}`;

    let orderCheckpoint = await readSubscriptionCheckpoint(
      pool,
      orderProcessorId,
    );

    assertDeepEqual(orderCheckpoint.position, null);

    storeResult = await storeSubscriptionCheckpoint(
      pool,
      orderProcessorId,
      order.lastEvent.metadata.globalPosition,
      null,
    );

    assertTrue(storeResult);

    orderCheckpoint = await readSubscriptionCheckpoint(pool, orderProcessorId);
    assertDeepEqual(
      orderCheckpoint.position,
      order.lastEvent.metadata.globalPosition,
    );
  };
});

const readSubscriptionCheckpoint = async (
  pool: Dumbo,
  processorId: string,
): Promise<{ position: bigint | null; transactionId: string | null }> => {
  const result = await pool.execute.query<{
    last_processed_position: string | null;
    last_processed_transaction_id: string | null;
  }>(
    SQL`SELECT last_processed_position, last_processed_transaction_id
         FROM emt_subscriptions
         WHERE subscription_id = ${processorId} AND partition = ${'emt:default'}`,
  );

  const row = result.rows[0];
  return {
    position: row?.last_processed_position
      ? BigInt(row.last_processed_position)
      : null,
    transactionId: row?.last_processed_transaction_id ?? null,
  };
};

const storeSubscriptionCheckpoint = async (
  pool: Dumbo,
  processorId: string,
  position: bigint | null,
  checkPosition: bigint | null,
) => {
  const result = await pool.execute.command<{ result: number }>(
    SQL`SELECT store_subscription_checkpoint(${processorId}, 1, ${position}, ${checkPosition}, pg_current_xact_id(), 'emt:default') as result`,
  );

  return result.rows[0]!.result === 1;
};
