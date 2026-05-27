import type { InvalidOperationError } from '@event-driven-io/dumbo';
import {
  dumbo,
  runSQLMigrations,
  SQL,
  type Dumbo,
} from '@event-driven-io/dumbo';
import {
  functionExists,
  pgDumboDriver,
  tableExists,
  type PgPool,
} from '@event-driven-io/dumbo/pg';
import {
  assertDeepEqual,
  assertFalse,
  assertMatches,
  assertThatArray,
  assertThrowsAsync,
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
import { defaultTag } from '../../typing';
import { migrations_0_36_0 } from '../0_36_0';
import { migrations_0_38_7 } from '../0_38_7';
import { storeSubscriptionCheckpoint } from '../0_38_7/legacyApi';
import { migrations_0_42_0 } from '../0_42_0';
import {
  appendToStream,
  readEvents,
  readProcessorCheckpoint as readProcessorCheckpointV042,
  storeProcessorCheckpoint as storeProcessorCheckpointV042,
} from '../0_42_0/legacyApi';
import { migrations_0_43_0 } from './';

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

  void it('migrates from 0.42.0 schema and drops old subscriptions API', async () => {
    // Given
    await runSQLMigrations(pool, [
      ...migrations_0_36_0,
      ...migrations_0_38_7,
      ...migrations_0_42_0,
    ]);

    // When
    const { applied, skipped } = await runSQLMigrations(
      pool,
      migrations_0_43_0,
    );

    // Then
    assertDeepEqual(applied, migrations_0_43_0);
    assertThatArray(skipped).isEmpty();

    // Then
    const result = await assertCanAppendAndRead();
    await assertCanStoreAndReadCheckpoints(pool, result);

    assertFalse(
      await functionExists(pool.execute, 'store_subscription_checkpoint'),
    );
    assertFalse(await tableExists(pool.execute, 'emt_subscriptions'));
  });

  void it('migrates from 0.43.0 schema', async () => {
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
      migrations_0_43_0,
    );

    // Then
    assertThatArray(applied).isEmpty();
    assertDeepEqual(skipped, migrations_0_43_0);
  });

  void it('old storeSubscriptionCheckpoint FAILS with not existing procedure', async () => {
    // Given
    // When
    await runSQLMigrations(pool, [
      ...migrations_0_36_0,
      ...migrations_0_38_7,
      ...migrations_0_42_0,
      ...migrations_0_43_0,
    ]);

    // Then
    await assertThrowsAsync<InvalidOperationError>(
      () =>
        // When
        storeSubscriptionCheckpoint(pool.execute, {
          subscriptionId: 'test-processor',
          position: 10n,
          checkPosition: null,
        }),
      (error: InvalidOperationError) => {
        return (
          error.message.startsWith('function store_subscription_checkpoint') &&
          error.message.endsWith('does not exist') &&
          error.innerError instanceof Error &&
          'code' in error.innerError &&
          error.innerError.code === '42883'
        );
      },
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

  void it('new code reads old-format checkpoint and resolves transaction id', async () => {
    // Given
    await runSQLMigrations(pool, [
      ...migrations_0_36_0,
      ...migrations_0_38_7,
      ...migrations_0_42_0,
    ]);
    const result = await assertCanAppendAndRead();

    const processorId = `processor-compat-${result.shoppingCart.streamId}`;
    await storeProcessorCheckpointV042(pool.execute, {
      processorId,
      newCheckpoint: bigIntProcessorCheckpoint(
        result.shoppingCart.lastGlobalPosition,
      ),
      lastProcessedCheckpoint: null,
    });

    // When
    await runSQLMigrations(pool, migrations_0_43_0);

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

  void it('new code stores checkpoint when old-format is in DB (blue-green: new→old)', async () => {
    // Given
    await runSQLMigrations(pool, [
      ...migrations_0_36_0,
      ...migrations_0_38_7,
      ...migrations_0_42_0,
      ...migrations_0_43_0,
    ]);
    const result = await assertCanAppendAndRead();

    const processorId = `processor-compat-bg-${result.shoppingCart.streamId}`;
    await insertProcessorCheckpointDirectly(pool, {
      processorId,
      lastProcessedCheckpoint: bigIntProcessorCheckpoint(
        result.shoppingCart.lastGlobalPosition,
      ),
    });

    // When
    const storeResult = await storeProcessorCheckpoint(pool.execute, {
      processorId,
      partition: undefined,
      version: 1,
      newCheckpoint: result.order.lastCheckpoint,
      lastProcessedCheckpoint: result.shoppingCart.lastCheckpoint,
      processorInstanceId: processorId,
    });

    // Then
    assertTrue(storeResult.success);
    assertDeepEqual(storeResult.newCheckpoint, result.order.lastCheckpoint);
  });

  void it('old code stores checkpoint when new-format is in DB (blue-green: old→new)', async () => {
    // Given
    await runSQLMigrations(pool, [
      ...migrations_0_36_0,
      ...migrations_0_38_7,
      ...migrations_0_42_0,
      ...migrations_0_43_0,
    ]);
    const result = await assertCanAppendAndRead();
    await assertCanStoreAndReadCheckpoints(pool, result);

    const processorId = `processor-compat-old-${result.shoppingCart.streamId}`;

    await storeProcessorCheckpoint(pool.execute, {
      processorId,
      partition: undefined,
      version: 1,
      newCheckpoint: result.shoppingCart.lastCheckpoint,
      lastProcessedCheckpoint: null,
      processorInstanceId: processorId,
    });

    const rawCheckpoint = await queryRawProcessorCheckpoint(pool, processorId);
    assertTrue(
      rawCheckpoint !== null && rawCheckpoint.includes(':'),
      `Expected new-format checkpoint in DB, got: ${rawCheckpoint}`,
    );

    // When
    const storeResult = await storeProcessorCheckpointV042(pool.execute, {
      processorId,
      newCheckpoint: bigIntProcessorCheckpoint(result.order.lastGlobalPosition),
      lastProcessedCheckpoint: bigIntProcessorCheckpoint(
        result.shoppingCart.lastGlobalPosition,
      ),
    });

    // Then
    assertTrue(storeResult.success);
  });

  void it('old consumer round-trip continues to work after 0.43.0 migration upgrades stored checkpoint to new format', async () => {
    // Given: 0.42.0 schema with an old-format checkpoint already stored by old code
    await runSQLMigrations(pool, [
      ...migrations_0_36_0,
      ...migrations_0_38_7,
      ...migrations_0_42_0,
    ]);
    const result = await assertCanAppendAndRead();

    const processorId = `processor-old-roundtrip-${result.shoppingCart.streamId}`;
    await storeProcessorCheckpointV042(pool.execute, {
      processorId,
      newCheckpoint: bigIntProcessorCheckpoint(
        result.shoppingCart.lastGlobalPosition,
      ),
      lastProcessedCheckpoint: null,
    });

    // When
    await runSQLMigrations(pool, migrations_0_43_0);

    // Then
    const { lastProcessedCheckpoint: afterMigration } =
      await readProcessorCheckpointV042(pool.execute, {
        processorId,
        partition: undefined,
      });

    assertTrue(afterMigration !== null);
    assertTrue(
      afterMigration!.includes(':'),
      `Expected new-format checkpoint after migration, got: ${afterMigration}`,
    );

    // And
    const advanced = await storeProcessorCheckpointV042(pool.execute, {
      processorId,
      newCheckpoint: bigIntProcessorCheckpoint(result.order.lastGlobalPosition),
      lastProcessedCheckpoint: afterMigration,
    });

    assertTrue(advanced.success);

    // And
    const { lastProcessedCheckpoint: afterAdvance } =
      await readProcessorCheckpointV042(pool.execute, {
        processorId,
        partition: undefined,
      });

    assertDeepEqual(
      afterAdvance,
      bigIntProcessorCheckpoint(result.order.lastGlobalPosition),
    );

    // And: the round-trip keeps working on subsequent cycles
    const shoppingCartConfirmedAgain: ShoppingCartConfirmed = {
      type: 'ShoppingCartConfirmed',
      data: { shoppingCartId: result.shoppingCart.streamId },
    };
    const nextAppend = await appendToStream(pool.execute, {
      streamId: `cart-next-${result.shoppingCart.streamId}`,
      streamType: 'cart',
      events: [shoppingCartConfirmedAgain],
    });
    const nextGlobalPosition = nextAppend.globalPositions[0]!;

    const advancedAgain = await storeProcessorCheckpointV042(pool.execute, {
      processorId,
      newCheckpoint: bigIntProcessorCheckpoint(nextGlobalPosition),
      lastProcessedCheckpoint: afterAdvance,
    });

    assertTrue(advancedAgain.success);

    const { lastProcessedCheckpoint: final } =
      await readProcessorCheckpointV042(pool.execute, {
        processorId,
        partition: undefined,
      });

    assertDeepEqual(final, bigIntProcessorCheckpoint(nextGlobalPosition));
  });

  void it('legacy reader returns new-format checkpoint verbatim without throwing', async () => {
    // Given
    await runSQLMigrations(pool, [
      ...migrations_0_36_0,
      ...migrations_0_38_7,
      ...migrations_0_42_0,
      ...migrations_0_43_0,
    ]);
    const result = await assertCanAppendAndRead();

    const processorId = `processor-legacy-read-${result.shoppingCart.streamId}`;
    await insertProcessorCheckpointDirectly(pool, {
      processorId,
      lastProcessedCheckpoint: result.shoppingCart.lastCheckpoint,
    });

    // When
    const { lastProcessedCheckpoint } = await readProcessorCheckpointV042(
      pool.execute,
      { processorId, partition: undefined },
    );

    // Then
    assertDeepEqual(
      lastProcessedCheckpoint,
      result.shoppingCart.lastCheckpoint,
    );
  });

  const insertProcessorCheckpointDirectly = (
    pool: Dumbo,
    {
      processorId,
      lastProcessedCheckpoint,
    }: { processorId: string; lastProcessedCheckpoint: string },
  ) =>
    pool.execute.command(
      SQL`INSERT INTO emt_processors (processor_id, version, last_processed_checkpoint, last_processed_transaction_id, partition, created_at, last_updated)
          VALUES (${processorId}, 1, ${lastProcessedCheckpoint}, pg_current_xact_id(), ${defaultTag}, now(), now())`,
    );

  const queryRawProcessorCheckpoint = async (
    pool: Dumbo,
    processorId: string,
  ): Promise<string | null> => {
    const result = await pool.execute.query<{
      last_processed_checkpoint: string;
    }>(
      SQL`SELECT last_processed_checkpoint FROM emt_processors WHERE processor_id = ${processorId} LIMIT 1`,
    );
    return result.rows[0]?.last_processed_checkpoint ?? null;
  };
});
