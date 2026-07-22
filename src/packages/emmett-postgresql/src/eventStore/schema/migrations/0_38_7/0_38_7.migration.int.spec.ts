import { dumbo, runSQLMigrations, type Dumbo } from '@event-driven-io/dumbo';
import { pgDumboDriver, type PgPool } from '@event-driven-io/dumbo/pg';
import {
  assertDeepEqual,
  assertMatches,
  assertThatArray,
  assertTrue,
  type Event,
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
  appendToStream,
  readEvents,
  readSubscriptionCheckpoint,
  storeSubscriptionCheckpoint,
} from './legacyApi';
import {
  getPostgreSQLEventStore,
  type PostgresEventStore,
} from '../../../postgreSQLEventStore';
import { migrations_0_36_0 } from '../0_36_0';

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
      await eventStore?.close();
      await pool?.close();
    } catch (error) {
      console.log(error);
    }
  });

  afterAll(async () => {
    try {
      await postgres?.stop();
    } catch (error) {
      console.log(error);
    }
  });

  void it('migrates from 0.36.0 schema', async () => {
    // Given
    await runSQLMigrations(pool, migrations_0_36_0);

    // When
    const { applied, skipped } = await runSQLMigrations(
      pool,
      migrations_0_38_7,
    );

    // Then
    assertDeepEqual(applied, migrations_0_38_7);
    assertThatArray(skipped).isEmpty();

    const result = await assertCanAppendAndRead();
    await assertCanStoreAndReadCheckpoints(pool, result);
  });

  void it('migrates from 0.38.7 schema', async () => {
    // Given
    await runSQLMigrations(pool, [...migrations_0_36_0, ...migrations_0_38_7]);

    // When
    const { applied, skipped } = await runSQLMigrations(
      pool,
      migrations_0_38_7,
    );

    // Then
    assertThatArray(applied).isEmpty();
    assertDeepEqual(skipped, migrations_0_38_7);
  });

  const assertCanAppendAndRead = async () => {
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

    const shoppingCartAppendResult = await appendToStream(pool.execute, {
      streamId: shoppingCartId,
      streamType: 'cart',
      events: [itemAdded, shoppingCartConfirmed],
    });

    const readShoppingCartResult = await readEvents<ShoppingCartEvent>(
      pool.execute,
      { streamId: shoppingCartId },
    );

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
    const orderAppendResult = await appendToStream(pool.execute, {
      streamId: orderId,
      streamType: 'order',
      events: [orderInitiated],
    });

    const readOrderResult = await readEvents<OrderInitiated>(pool.execute, {
      streamId: orderId,
    });

    assertTrue(readOrderResult.streamExists);
    assertDeepEqual(readOrderResult.currentStreamVersion, 1n);
    assertDeepEqual(readOrderResult.events.length, 1);
    assertMatches(readOrderResult.events[0], orderInitiated);

    return {
      shoppingCart: {
        streamId: shoppingCartId,
        lastGlobalPosition:
          shoppingCartAppendResult.globalPositions[
            shoppingCartAppendResult.globalPositions.length - 1
          ]!,
      },
      order: {
        streamId: orderId,
        lastGlobalPosition: orderAppendResult.globalPositions[0]!,
      },
    };
  };

  const assertCanStoreAndReadCheckpoints = async (
    pool: Dumbo,
    {
      shoppingCart,
      order,
    }: {
      shoppingCart: { streamId: string; lastGlobalPosition: bigint };
      order: { streamId: string; lastGlobalPosition: bigint };
    },
  ) => {
    const shoppingCartProcessorId = `processor-shopping-cart-${shoppingCart.streamId}`;

    let storeResult = await storeSubscriptionCheckpoint(pool.execute, {
      subscriptionId: shoppingCartProcessorId,
      position: 1n,
      checkPosition: null,
    });

    assertDeepEqual(storeResult.result, 1);

    storeResult = await storeSubscriptionCheckpoint(pool.execute, {
      subscriptionId: shoppingCartProcessorId,
      position: shoppingCart.lastGlobalPosition,
      checkPosition: 1n,
    });

    assertDeepEqual(storeResult.result, 1);

    const shoppingCartCheckpoint = await readSubscriptionCheckpoint(
      pool.execute,
      { subscriptionId: shoppingCartProcessorId },
    );

    assertDeepEqual(
      shoppingCartCheckpoint.position,
      shoppingCart.lastGlobalPosition,
    );

    const orderProcessorId = `processor-order-${order.streamId}`;

    let orderCheckpoint = await readSubscriptionCheckpoint(pool.execute, {
      subscriptionId: orderProcessorId,
    });

    assertDeepEqual(orderCheckpoint.position, null);

    storeResult = await storeSubscriptionCheckpoint(pool.execute, {
      subscriptionId: orderProcessorId,
      position: order.lastGlobalPosition,
      checkPosition: null,
    });

    assertDeepEqual(storeResult.result, 1);

    orderCheckpoint = await readSubscriptionCheckpoint(pool.execute, {
      subscriptionId: orderProcessorId,
    });
    assertDeepEqual(orderCheckpoint.position, order.lastGlobalPosition);
  };
});
