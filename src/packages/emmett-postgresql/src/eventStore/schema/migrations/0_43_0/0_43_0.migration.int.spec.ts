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
import {
  getPostgreSQLEventStore,
  type PostgresEventStore,
  type PostgresReadEventMetadata,
} from '../../../postgreSQLEventStore';
import { readProcessorCheckpoint } from '../../readProcessorCheckpoint';
import { storeProcessorCheckpoint } from '../../storeProcessorCheckpoint';
import { defaultTag } from '../../typing';
import { migrations_0_36_0 } from '../0_36_0';
import { migrations_0_38_7 } from '../0_38_7';
import { migrations_0_42_0 } from '../0_42_0';
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
    const result = await assertCanAppendAndRead(eventStore);
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
        storeSubscriptionCheckpoint(pool, 'test-processor', 10n, null),
      (error: InvalidOperationError) => {
        return (
          error.message ===
            'function store_subscription_checkpoint(unknown, integer, unknown, unknown, xid8, unknown) does not exist' &&
          error.innerError instanceof Error &&
          'code' in error.innerError &&
          error.innerError.code === '42883'
        );
      },
    );
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
      newCheckpoint: shoppingCart.lastEvent.metadata.checkpoint!,
      lastProcessedCheckpoint: bigIntProcessorCheckpoint(1n),
      processorInstanceId: shoppingCartProcessorId,
    });

    assertTrue(storeResult.success);
    assertDeepEqual(
      storeResult.newCheckpoint,
      shoppingCart.lastEvent.metadata.checkpoint!,
    );

    const shoppingCartCheckpoint = await readProcessorCheckpoint(pool.execute, {
      processorId: shoppingCartProcessorId,
      partition: undefined,
    });

    assertDeepEqual(
      shoppingCartCheckpoint.lastProcessedCheckpoint,
      shoppingCart.lastEvent.metadata.checkpoint!,
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
      newCheckpoint: order.lastEvent.metadata.checkpoint!,
      lastProcessedCheckpoint: null,
      processorInstanceId: orderProcessorId,
    });

    assertTrue(storeResult.success);
    assertDeepEqual(
      storeResult.newCheckpoint,
      order.lastEvent.metadata.checkpoint!,
    );

    orderCheckpoint = await readProcessorCheckpoint(pool.execute, {
      processorId: orderProcessorId,
      partition: undefined,
    });

    assertDeepEqual(
      orderCheckpoint.lastProcessedCheckpoint,
      order.lastEvent.metadata.checkpoint!,
    );
  };

  void it('new code reads old-format checkpoint and resolves transaction id', async () => {
    // Given
    await runSQLMigrations(pool, [
      ...migrations_0_36_0,
      ...migrations_0_38_7,
      ...migrations_0_42_0,
    ]);
    const result = await assertCanAppendAndRead(eventStore);

    // Simulate old-format checkpoint still stored (plain globalpos, no ':')
    const processorId = `processor-compat-${result.shoppingCart.streamId}`;
    const globalPosition =
      result.shoppingCart.lastEvent.metadata.globalPosition;
    const paddedPosition = globalPosition.toString().padStart(20, '0');

    await insertProcessorCheckpointDirectly(pool, {
      processorId,
      lastProcessedCheckpoint: paddedPosition,
    });

    // When
    await runSQLMigrations(pool, migrations_0_43_0);

    const { lastProcessedCheckpoint } = await readProcessorCheckpoint(
      pool.execute,
      { processorId, partition: undefined },
    );

    // Then: resolved to new format (txid:globalpos)
    assertTrue(
      lastProcessedCheckpoint !== null && lastProcessedCheckpoint.includes(':'),
      `Expected new-format checkpoint (txid:globalpos), got: ${lastProcessedCheckpoint}`,
    );
  });

  void it('new code stores checkpoint when old-format is in DB (blue-green: new→old)', async () => {
    // Given
    await runSQLMigrations(pool, [
      ...migrations_0_36_0,
      ...migrations_0_38_7,
      ...migrations_0_42_0,
    ]);
    const result = await assertCanAppendAndRead(eventStore);

    const processorId = `processor-compat-bg-${result.shoppingCart.streamId}`;
    const globalPosition =
      result.shoppingCart.lastEvent.metadata.globalPosition;
    const paddedPosition = globalPosition.toString().padStart(20, '0');

    // Old-format checkpoint in DB, no migration yet
    await insertProcessorCheckpointDirectly(pool, {
      processorId,
      lastProcessedCheckpoint: paddedPosition,
    });

    // When: new code runs store with new-format p_check_position (txid:globalpos)
    await runSQLMigrations(pool, migrations_0_43_0);

    const { lastProcessedCheckpoint } = await readProcessorCheckpoint(
      pool.execute,
      { processorId, partition: undefined },
    );

    assertTrue(
      lastProcessedCheckpoint !== null && lastProcessedCheckpoint.includes(':'),
    );

    const nextEvent = result.order.lastEvent;
    const storeResult = await storeProcessorCheckpoint(pool.execute, {
      processorId,
      partition: undefined,
      version: 1,
      newCheckpoint: nextEvent.metadata.checkpoint!,
      lastProcessedCheckpoint,
      processorInstanceId: processorId,
    });

    // Then: store succeeds via mixed-format fallback
    assertTrue(storeResult.success);
  });

  void it('old code stores checkpoint when new-format is in DB (blue-green: old→new)', async () => {
    // Given
    await runSQLMigrations(pool, [
      ...migrations_0_36_0,
      ...migrations_0_38_7,
      ...migrations_0_42_0,
      ...migrations_0_43_0,
    ]);
    const result = await assertCanAppendAndRead(eventStore);
    await assertCanStoreAndReadCheckpoints(pool, result);

    const processorId = `processor-compat-old-${result.shoppingCart.streamId}`;
    const checkpoint = result.shoppingCart.lastEvent.metadata.checkpoint!;

    // Store new-format checkpoint via new code
    await storeProcessorCheckpoint(pool.execute, {
      processorId,
      partition: undefined,
      version: 1,
      newCheckpoint: checkpoint,
      lastProcessedCheckpoint: null,
      processorInstanceId: processorId,
    });

    // Verify it's stored in new format
    const rawCheckpoint = await queryRawProcessorCheckpoint(pool, processorId);
    assertTrue(
      rawCheckpoint !== null && rawCheckpoint.includes(':'),
      `Expected new-format checkpoint in DB, got: ${rawCheckpoint}`,
    );

    // When: old code sends plain globalpos as p_check_position
    const globalPosition =
      result.shoppingCart.lastEvent.metadata.globalPosition;
    const paddedPosition = globalPosition.toString().padStart(20, '0');

    const storeResult = await pool.execute.command(
      SQL`SELECT store_processor_checkpoint(
        ${processorId}, 1,
        ${result.order.lastEvent.metadata.checkpoint},
        ${paddedPosition},
        pg_current_xact_id(),
        ${defaultTag}
      )`,
    );

    // Then: succeeds via mixed-format fallback (returns 1)
    assertDeepEqual(storeResult.rowCount, 1);
  });

  const insertProcessorCheckpointDirectly = (
    pool: Dumbo,
    {
      processorId,
      lastProcessedCheckpoint,
    }: { processorId: string; lastProcessedCheckpoint: string },
  ) =>
    pool.execute.command(
      SQL`INSERT INTO emt_processors (processor_id, version, last_processed_checkpoint, partition, created_at, last_updated)
          VALUES (${processorId}, 1, ${lastProcessedCheckpoint}, ${defaultTag}, now(), now())`,
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

  const storeSubscriptionCheckpoint = (
    pool: Dumbo,
    processorId: string,
    position: bigint | null,
    checkPosition: bigint | null,
  ) =>
    pool.execute.command(
      SQL`SELECT store_subscription_checkpoint(${processorId}, 1, ${position}, ${checkPosition}, pg_current_xact_id(), 'emt:default')`,
    );
});
