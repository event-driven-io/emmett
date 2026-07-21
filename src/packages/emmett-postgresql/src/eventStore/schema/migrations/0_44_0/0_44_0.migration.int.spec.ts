import { dumbo, runSQLMigrations, type Dumbo } from '@event-driven-io/dumbo';
import { pgDumboDriver, type PgPool } from '@event-driven-io/dumbo/pg';
import {
  assertDeepEqual,
  assertMatches,
  assertThatArray,
  assertTrue,
  bigIntProcessorCheckpoint,
  type Event,
  type ProcessorCheckpoint,
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
import {
  getPostgreSQLEventStore,
  type PostgresEventStore,
} from '../../../postgreSQLEventStore';
import { PostgreSQLEventStoreCheckpoint } from '../../readMessagesBatch';
import { readProcessorCheckpoint } from '../../readProcessorCheckpoint';
import { storeProcessorCheckpoint } from '../../storeProcessorCheckpoint';
import { migrations_0_36_0 } from '../0_36_0';
import { migrations_0_38_7 } from '../0_38_7';
import { migrations_0_42_0 } from '../0_42_0';
import { migrations_0_43_0 } from '../0_43_0';
import { appendToStream, readEvents } from '../0_43_0/legacyApi';
import { migrations_0_44_0 } from './';

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
      transactionOptions: {
        allowNestedTransactions: true,
      },
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

  void it('migrates from 0.43.0 schema and removes obsolete checkpoint compat', async () => {
    // Given
    await runSQLMigrations(pool, [
      ...migrations_0_36_0,
      ...migrations_0_38_7,
      ...migrations_0_42_0,
      ...migrations_0_43_0,
    ]);

    // When
    const { applied, skipped } = await runSQLMigrations(
      pool,
      migrations_0_44_0,
    );

    // Then
    assertDeepEqual(applied, migrations_0_44_0);
    assertThatArray(skipped).isEmpty();

    const result = await assertCanAppendAndRead();
    await assertCanStoreAndReadCheckpoints(pool, result);
  });

  void it('migrates from 0.44.0 schema', async () => {
    // Given
    await runSQLMigrations(pool, [
      ...migrations_0_36_0,
      ...migrations_0_38_7,
      ...migrations_0_42_0,
      ...migrations_0_43_0,
      ...migrations_0_44_0,
    ]);

    // When
    const { applied, skipped } = await runSQLMigrations(
      pool,
      migrations_0_44_0,
    );

    // Then
    assertThatArray(applied).isEmpty();
    assertDeepEqual(skipped, migrations_0_44_0);
  });

  void it('checkpoints stored before 0.44.0 still work after migration', async () => {
    // Given
    await runSQLMigrations(pool, [
      ...migrations_0_36_0,
      ...migrations_0_38_7,
      ...migrations_0_42_0,
      ...migrations_0_43_0,
    ]);
    const result = await assertCanAppendAndRead();

    const processorId = `processor-compat-${result.shoppingCart.streamId}`;
    const storeResult = await storeProcessorCheckpoint(pool.execute, {
      processorId,
      newCheckpoint: result.shoppingCart.lastCheckpoint,
      lastProcessedCheckpoint: null,
      version: 1,
    });
    assertTrue(storeResult.success);

    // When
    await runSQLMigrations(pool, migrations_0_44_0);

    const { lastProcessedCheckpoint } = await readProcessorCheckpoint(
      pool.execute,
      { processorId, partition: undefined },
    );

    // Then
    assertDeepEqual(
      lastProcessedCheckpoint,
      result.shoppingCart.lastCheckpoint,
    );
  });

  type AppendedStream = {
    streamId: string;
    lastGlobalPosition: bigint;
    lastCheckpoint: ProcessorCheckpoint;
  };

  const assertCanAppendAndRead = async (): Promise<{
    shoppingCart: AppendedStream;
    order: AppendedStream;
  }> => {
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

    const shoppingCartAppend = await appendToStream(pool.execute, {
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
    const orderAppend = await appendToStream(pool.execute, {
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

    const shoppingCartLastGlobalPosition =
      shoppingCartAppend.globalPositions[
        shoppingCartAppend.globalPositions.length - 1
      ]!;
    const orderLastGlobalPosition = orderAppend.globalPositions[0]!;

    return {
      shoppingCart: {
        streamId: shoppingCartId,
        lastGlobalPosition: shoppingCartLastGlobalPosition,
        lastCheckpoint: PostgreSQLEventStoreCheckpoint.toProcessorCheckpoint({
          transactionId: shoppingCartAppend.transactionId,
          globalPosition: shoppingCartLastGlobalPosition,
        }),
      },
      order: {
        streamId: orderId,
        lastGlobalPosition: orderLastGlobalPosition,
        lastCheckpoint: PostgreSQLEventStoreCheckpoint.toProcessorCheckpoint({
          transactionId: orderAppend.transactionId,
          globalPosition: orderLastGlobalPosition,
        }),
      },
    };
  };

  const assertCanStoreAndReadCheckpoints = async (
    pool: Dumbo,
    {
      shoppingCart,
      order,
    }: {
      shoppingCart: AppendedStream;
      order: AppendedStream;
    },
  ) => {
    const shoppingCartProcessorId = `processor-shopping-cart-${shoppingCart.streamId}`;

    let storeResult = await storeProcessorCheckpoint(pool.execute, {
      processorId: shoppingCartProcessorId,
      partition: undefined,
      version: 1,
      newCheckpoint: bigIntProcessorCheckpoint(1n),
      lastProcessedCheckpoint: null,
      processorInstanceId: shoppingCartProcessorId,
    });

    assertTrue(storeResult.success);
    assertDeepEqual(storeResult.newCheckpoint, bigIntProcessorCheckpoint(1n));

    storeResult = await storeProcessorCheckpoint(pool.execute, {
      processorId: shoppingCartProcessorId,
      partition: undefined,
      version: 1,
      newCheckpoint: shoppingCart.lastCheckpoint,
      lastProcessedCheckpoint: bigIntProcessorCheckpoint(1n),
      processorInstanceId: shoppingCartProcessorId,
    });

    assertTrue(storeResult.success);
    assertDeepEqual(storeResult.newCheckpoint, shoppingCart.lastCheckpoint);

    const shoppingCartCheckpoint = await readProcessorCheckpoint(pool.execute, {
      processorId: shoppingCartProcessorId,
      partition: undefined,
    });

    assertDeepEqual(
      shoppingCartCheckpoint.lastProcessedCheckpoint,
      shoppingCart.lastCheckpoint,
    );

    const orderProcessorId = `processor-order-${order.streamId}`;

    let orderCheckpoint = await readProcessorCheckpoint(pool.execute, {
      processorId: orderProcessorId,
      partition: undefined,
    });

    assertDeepEqual(orderCheckpoint, { lastProcessedCheckpoint: null });

    storeResult = await storeProcessorCheckpoint(pool.execute, {
      processorId: orderProcessorId,
      partition: undefined,
      version: 1,
      newCheckpoint: order.lastCheckpoint,
      lastProcessedCheckpoint: null,
      processorInstanceId: orderProcessorId,
    });

    assertTrue(storeResult.success);
    assertDeepEqual(storeResult.newCheckpoint, order.lastCheckpoint);

    orderCheckpoint = await readProcessorCheckpoint(pool.execute, {
      processorId: orderProcessorId,
      partition: undefined,
    });

    assertDeepEqual(
      orderCheckpoint.lastProcessedCheckpoint,
      order.lastCheckpoint,
    );
  };
});
