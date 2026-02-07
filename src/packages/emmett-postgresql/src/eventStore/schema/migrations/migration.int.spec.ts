import { dumbo, SQL, type Dumbo } from '@event-driven-io/dumbo';
import {
  functionExists,
  pgDatabaseDriver,
  type PgPool,
} from '@event-driven-io/dumbo/pg';
import {
  assertDeepEqual,
  assertFalse,
  assertMatches,
  assertTrue,
  type Event,
  type ReadEvent,
} from '@event-driven-io/emmett';
import { getPostgreSQLStartedContainer } from '@event-driven-io/emmett-testcontainers';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import {
  getPostgreSQLEventStore,
  type PostgresEventStore,
  type PostgresReadEventMetadata,
} from '../../postgreSQLEventStore';
import { readProcessorCheckpoint } from '../readProcessorCheckpoint';
import { storeProcessorCheckpoint } from '../storeProcessorCheckpoint';
import { defaultTag } from '../typing';
import { schema_0_36_0 } from './0_36_0';
import { schema_0_38_7 } from './0_38_7';
import { schema_0_42_0 } from './0_42_0';
import { cleanupLegacySubscriptionTables } from './0_43_0';

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

  before(async () => {
    postgres = await getPostgreSQLStartedContainer();
    connectionString = postgres.getConnectionUri();

    await postgres.snapshot();
  });

  beforeEach(async () => {
    await postgres.restoreSnapshot();

    pool = dumbo({
      connectionString,
      driver: pgDatabaseDriver,
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

  after(async () => {
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
    await eventStore.schema.migrate();

    // Then
    const result = await assertCanAppendAndRead(eventStore);
    await assertCanStoreAndReadCheckpoints(pool, result);
  });

  void it('migrates from 0.38.7 schema', async () => {
    // Given
    await pool.execute.command(schema_0_38_7);

    // When
    await eventStore.schema.migrate();

    // Then
    const result = await assertCanAppendAndRead(eventStore);
    await assertCanStoreAndReadCheckpoints(pool, result);

    // Then
    assertTrue(await functionExists(pool, 'emt_try_acquire_processor_lock'));
    assertTrue(await functionExists(pool, 'emt_release_processor_lock'));
    assertTrue(await functionExists(pool, 'emt_register_projection'));
    assertTrue(await functionExists(pool, 'emt_activate_projection'));
    assertTrue(await functionExists(pool, 'emt_deactivate_projection'));

    // Verify columns exist on emt_processors
    const processorsCreatedAtResult = await pool.execute.query<{
      column_name: string;
    }>(
      SQL`SELECT column_name FROM information_schema.columns WHERE table_name = 'emt_processors' AND column_name = 'created_at'`,
    );
    assertDeepEqual(processorsCreatedAtResult.rows.length, 1);

    const processorsLastUpdatedResult = await pool.execute.query<{
      column_name: string;
    }>(
      SQL`SELECT column_name FROM information_schema.columns WHERE table_name = 'emt_processors' AND column_name = 'last_updated'`,
    );
    assertDeepEqual(processorsLastUpdatedResult.rows.length, 1);

    // Verify columns exist on emt_projections
    const projectionsCreatedAtResult = await pool.execute.query<{
      column_name: string;
    }>(
      SQL`SELECT column_name FROM information_schema.columns WHERE table_name = 'emt_projections' AND column_name = 'created_at'`,
    );
    assertDeepEqual(projectionsCreatedAtResult.rows.length, 1);

    const projectionsLastUpdatedResult = await pool.execute.query<{
      column_name: string;
    }>(
      SQL`SELECT column_name FROM information_schema.columns WHERE table_name = 'emt_projections' AND column_name = 'last_updated'`,
    );
    assertDeepEqual(projectionsLastUpdatedResult.rows.length, 1);
  });

  void it('migrates from 0.38.7 schema with subscription cleanup', async () => {
    // Given
    await pool.execute.command(schema_0_38_7);
    await eventStore.schema.migrate();

    // When
    await cleanupLegacySubscriptionTables(connectionString);

    // Then
    const result = await assertCanAppendAndRead(eventStore);
    await assertCanStoreAndReadCheckpoints(pool, result);
  });

  void it('migrates from 0.42.0 schema', async () => {
    // Given
    await pool.execute.command(schema_0_42_0);

    // When
    await eventStore.schema.migrate();

    // Then
    const result = await assertCanAppendAndRead(eventStore);
    await assertCanStoreAndReadCheckpoints(pool, result);

    // Verify functions exist
    const tryAcquireResult = await pool.execute.query<{ proname: string }>(
      SQL`SELECT proname FROM pg_proc WHERE proname = 'emt_try_acquire_processor_lock'`,
    );
    assertDeepEqual(tryAcquireResult.rows.length, 1);

    const releaseResult = await pool.execute.query<{ proname: string }>(
      SQL`SELECT proname FROM pg_proc WHERE proname = 'emt_release_processor_lock'`,
    );
    assertDeepEqual(releaseResult.rows.length, 1);

    const registerResult = await pool.execute.query<{ proname: string }>(
      SQL`SELECT proname FROM pg_proc WHERE proname = 'emt_register_projection'`,
    );
    assertDeepEqual(registerResult.rows.length, 1);

    const activateResult = await pool.execute.query<{ proname: string }>(
      SQL`SELECT proname FROM pg_proc WHERE proname = 'emt_activate_projection'`,
    );
    assertDeepEqual(activateResult.rows.length, 1);

    const deactivateResult = await pool.execute.query<{ proname: string }>(
      SQL`SELECT proname FROM pg_proc WHERE proname = 'emt_deactivate_projection'`,
    );
    assertDeepEqual(deactivateResult.rows.length, 1);

    // Verify columns exist on emt_processors
    const processorsCreatedAtResult = await pool.execute.query<{
      column_name: string;
    }>(
      SQL`SELECT column_name FROM information_schema.columns WHERE table_name = 'emt_processors' AND column_name = 'created_at'`,
    );
    assertDeepEqual(processorsCreatedAtResult.rows.length, 1);

    const processorsLastUpdatedResult = await pool.execute.query<{
      column_name: string;
    }>(
      SQL`SELECT column_name FROM information_schema.columns WHERE table_name = 'emt_processors' AND column_name = 'last_updated'`,
    );
    assertDeepEqual(processorsLastUpdatedResult.rows.length, 1);

    // Verify columns exist on emt_projections
    const projectionsCreatedAtResult = await pool.execute.query<{
      column_name: string;
    }>(
      SQL`SELECT column_name FROM information_schema.columns WHERE table_name = 'emt_projections' AND column_name = 'created_at'`,
    );
    assertDeepEqual(projectionsCreatedAtResult.rows.length, 1);

    const projectionsLastUpdatedResult = await pool.execute.query<{
      column_name: string;
    }>(
      SQL`SELECT column_name FROM information_schema.columns WHERE table_name = 'emt_projections' AND column_name = 'last_updated'`,
    );
    assertDeepEqual(projectionsLastUpdatedResult.rows.length, 1);
  });

  void it('migrates from latest schema', async () => {
    // Given
    const latestSchemaSQL = eventStore.schema.sql();
    await pool.execute.command(SQL`${SQL.plain(latestSchemaSQL)}`);

    // When
    await eventStore.schema.migrate();

    // Then
    const result = await assertCanAppendAndRead(eventStore);
    await assertCanStoreAndReadCheckpoints(pool, result);
  });

  void it('migrates pre-existing subscription checkpoint to processor table', async () => {
    // Given
    await pool.execute.command(schema_0_38_7);
    await insertIntoSubscriptionCheckpoint(pool, 'legacy-processor-1', 42n);

    // When
    await eventStore.schema.migrate();

    // Then
    await assertDualWriteConsistency(pool, 'legacy-processor-1', 42n);
  });

  void it('old API insert propagates to new table', async () => {
    // Given
    await pool.execute.command(schema_0_38_7);
    await eventStore.schema.migrate();

    // When
    await storeSubscriptionCheckpoint(pool, 'dual-write-test-1', 50n, null);

    // Then
    await assertDualWriteConsistency(pool, 'dual-write-test-1', 50n);

    const checkpoint = await readProcessorCheckpoint(pool.execute, {
      processorId: 'dual-write-test-1',
      partition: undefined,
    });

    assertDeepEqual(checkpoint.lastProcessedCheckpoint, 50n);
  });

  void it('interleaved operations: old insert -> new read -> new update', async () => {
    // Given
    await pool.execute.command(schema_0_38_7);
    await eventStore.schema.migrate();

    const processorId = 'interleaved-old-new-test';

    // When
    await storeSubscriptionCheckpoint(pool, processorId, 5n, null);

    const readResult = await readProcessorCheckpoint(pool.execute, {
      processorId,
      partition: undefined,
    });
    assertDeepEqual(readResult.lastProcessedCheckpoint, 5n);

    const updateResult = await storeProcessorCheckpoint(pool.execute, {
      processorId,
      partition: undefined,
      version: 1,
      newCheckpoint: 10n,
      lastProcessedCheckpoint: 5n,
      processorInstanceId: processorId,
    });

    // Then
    assertTrue(updateResult.success);
    assertDeepEqual(updateResult.newCheckpoint, 10n);
    await assertDualWriteConsistency(pool, processorId, 10n);

    const finalRead = await readProcessorCheckpoint(pool.execute, {
      processorId,
      partition: undefined,
    });
    assertDeepEqual(finalRead.lastProcessedCheckpoint, 10n);
  });

  void it('interleaved operations: new insert -> old query -> old update', async () => {
    // Given
    await pool.execute.command(schema_0_38_7);
    await eventStore.schema.migrate();

    const processorId = 'interleaved-new-old-test';

    // When
    const insertResult = await storeProcessorCheckpoint(pool.execute, {
      processorId,
      partition: undefined,
      version: 1,
      newCheckpoint: 7n,
      lastProcessedCheckpoint: null,
      processorInstanceId: processorId,
    });

    assertTrue(insertResult.success);

    const subscriptionData = await querySubscriptionCheckpoint(
      pool,
      processorId,
    );
    assertDeepEqual(subscriptionData.position, 7n);

    await storeSubscriptionCheckpoint(pool, processorId, 14n, 7n);

    // Then
    await assertDualWriteConsistency(pool, processorId, 14n);
  });

  void it('concurrent inserts via different APIs handled safely', async () => {
    // Given
    await pool.execute.command(schema_0_38_7);
    await eventStore.schema.migrate();

    const processorId = 'concurrent-insert-test';

    // When
    await storeSubscriptionCheckpoint(pool, processorId, 15n, null);

    const newApiResult = await storeProcessorCheckpoint(pool.execute, {
      processorId,
      partition: undefined,
      version: 1,
      newCheckpoint: 20n,
      lastProcessedCheckpoint: null,
      processorInstanceId: processorId,
    });

    // Then
    assertFalse(newApiResult.success);
    assertTrue(
      newApiResult.reason === 'IGNORED' ||
        newApiResult.reason === 'MISMATCH' ||
        newApiResult.reason === 'CURRENT_AHEAD',
    );

    await assertDualWriteConsistency(pool, processorId, 15n);
  });

  void it('handles maximum safe bigint value', async () => {
    // Given
    await pool.execute.command(schema_0_38_7);
    await eventStore.schema.migrate();

    const processorId = 'max-bigint-test';
    const maxBigInt = 9223372036854775807n;

    // When
    const insertResult = await storeProcessorCheckpoint(pool.execute, {
      processorId,
      partition: undefined,
      version: 1,
      newCheckpoint: maxBigInt,
      lastProcessedCheckpoint: null,
      processorInstanceId: processorId,
    });

    // Then
    assertTrue(insertResult.success);
    assertDeepEqual(insertResult.newCheckpoint, maxBigInt);

    const processorData = await queryProcessorCheckpoint(pool, processorId);
    assertDeepEqual(
      processorData.lastProcessedCheckpoint,
      '9223372036854775807',
    );
    assertDeepEqual(processorData.lastProcessedCheckpoint?.length, 19);

    const readResult = await readProcessorCheckpoint(pool.execute, {
      processorId,
      partition: undefined,
    });
    assertDeepEqual(readResult.lastProcessedCheckpoint, maxBigInt);

    assertDeepEqual(BigInt(processorData.lastProcessedCheckpoint!), maxBigInt);
  });

  void it('new API works after legacy table cleanup', async () => {
    // Given
    await pool.execute.command(schema_0_38_7);
    await eventStore.schema.migrate();

    const processorId = 'cleanup-test-processor';

    const initialStore = await storeProcessorCheckpoint(pool.execute, {
      processorId,
      partition: undefined,
      version: 1,
      newCheckpoint: 50n,
      lastProcessedCheckpoint: null,
      processorInstanceId: processorId,
    });

    assertTrue(initialStore.success);
    assertDeepEqual(initialStore.newCheckpoint, 50n);

    // When
    await cleanupLegacySubscriptionTables(connectionString);

    const tablesResult = await pool.execute.query<{ tablename: string }>(
      SQL`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'emt_subscriptions'`,
    );
    assertDeepEqual(tablesResult.rows.length, 0);

    const functionsResult = await pool.execute.query<{ proname: string }>(
      SQL`SELECT proname FROM pg_proc WHERE proname = 'store_subscription_checkpoint'`,
    );
    assertDeepEqual(functionsResult.rows.length, 0);

    // Then
    const readResult = await readProcessorCheckpoint(pool.execute, {
      processorId,
      partition: undefined,
    });
    assertDeepEqual(readResult.lastProcessedCheckpoint, 50n);

    const updateResult = await storeProcessorCheckpoint(pool.execute, {
      processorId,
      partition: undefined,
      version: 1,
      newCheckpoint: 60n,
      lastProcessedCheckpoint: 50n,
      processorInstanceId: processorId,
    });

    assertTrue(updateResult.success);
    assertDeepEqual(updateResult.newCheckpoint, 60n);

    const finalRead = await readProcessorCheckpoint(pool.execute, {
      processorId,
      partition: undefined,
    });
    assertDeepEqual(finalRead.lastProcessedCheckpoint, 60n);
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
      newCheckpoint: 1n,
      lastProcessedCheckpoint: null,
      processorInstanceId: shoppingCartProcessorId,
    });

    assertTrue(storeResult.success);
    assertDeepEqual(storeResult.newCheckpoint, 1n);

    storeResult = await storeProcessorCheckpoint(pool.execute, {
      processorId: shoppingCartProcessorId,
      partition: undefined,
      version: 1,
      newCheckpoint: shoppingCart.lastEvent.metadata.globalPosition,
      lastProcessedCheckpoint: 1n,
      processorInstanceId: shoppingCartProcessorId,
    });

    assertTrue(storeResult.success);
    assertDeepEqual(
      storeResult.newCheckpoint,
      shoppingCart.lastEvent.metadata.globalPosition,
    );

    const shoppingCartCheckpoint = await readProcessorCheckpoint(pool.execute, {
      processorId: shoppingCartProcessorId,
      partition: undefined,
    });

    assertDeepEqual(
      shoppingCartCheckpoint.lastProcessedCheckpoint,
      shoppingCart.lastEvent.metadata.globalPosition,
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
      newCheckpoint: order.lastEvent.metadata.globalPosition,
      lastProcessedCheckpoint: null,
      processorInstanceId: orderProcessorId,
    });

    assertTrue(storeResult.success);
    assertDeepEqual(
      storeResult.newCheckpoint,
      order.lastEvent.metadata.globalPosition,
    );

    orderCheckpoint = await readProcessorCheckpoint(pool.execute, {
      processorId: orderProcessorId,
      partition: undefined,
    });

    assertDeepEqual(
      orderCheckpoint.lastProcessedCheckpoint,
      order.lastEvent.metadata.globalPosition,
    );
  };

  const querySubscriptionCheckpoint = async (
    pool: Dumbo,
    processorId: string,
    partition?: string,
  ): Promise<{ position: bigint | null; transactionId: string | null }> => {
    const result = await pool.execute.query<{
      last_processed_position: string | null;
      last_processed_transaction_id: string | null;
    }>(
      SQL`SELECT last_processed_position, last_processed_transaction_id
         FROM emt_subscriptions
         WHERE subscription_id = ${processorId} AND partition = ${partition ?? 'emt:default'}`,
    );

    const row = result.rows[0];
    return {
      position: row?.last_processed_position
        ? BigInt(row.last_processed_position)
        : null,
      transactionId: row?.last_processed_transaction_id ?? null,
    };
  };

  const queryProcessorCheckpoint = async (
    pool: Dumbo,
    processorId: string,
    partition?: string,
  ): Promise<{
    lastProcessedCheckpoint: string | null;
    transactionId: string | null;
  }> => {
    const result = await pool.execute.query<{
      last_processed_checkpoint: string | null;
      last_processed_transaction_id: string | null;
    }>(
      SQL`
        SELECT last_processed_checkpoint, last_processed_transaction_id
         FROM emt_processors
         WHERE processor_id = ${processorId} AND partition = ${partition ?? 'emt:default'}`,
    );

    const row = result.rows[0];
    return {
      lastProcessedCheckpoint: row?.last_processed_checkpoint ?? null,
      transactionId: row?.last_processed_transaction_id ?? null,
    };
  };

  const insertIntoSubscriptionCheckpoint = (
    pool: Dumbo,
    processorId: string,
    position: bigint | null,
  ) =>
    pool.execute.command(
      SQL`
        INSERT INTO emt_subscriptions (subscription_id, version, partition, last_processed_position, last_processed_transaction_id)
        VALUES (${processorId}, 1, ${defaultTag}, ${position}, pg_current_xact_id())
      `,
    );

  const storeSubscriptionCheckpoint = (
    pool: Dumbo,
    processorId: string,
    position: bigint | null,
    checkPosition: bigint | null,
  ) =>
    pool.execute.command(
      SQL`SELECT store_subscription_checkpoint(${processorId}, 1, ${position}, ${checkPosition}, pg_current_xact_id(), 'emt:default')`,
    );

  const assertDualWriteConsistency = async (
    pool: Dumbo,
    processorId: string,
    expectedPosition: bigint,
    partition?: string,
  ): Promise<void> => {
    const subscriptionData = await querySubscriptionCheckpoint(
      pool,
      processorId,
      partition,
    );
    const processorData = await queryProcessorCheckpoint(
      pool,
      processorId,
      partition,
    );

    assertDeepEqual(subscriptionData.position, expectedPosition);
    assertDeepEqual(
      processorData.lastProcessedCheckpoint,
      expectedPosition.toString().padStart(19, '0'),
    );
    assertDeepEqual(
      subscriptionData.transactionId,
      processorData.transactionId,
    );
  };
});
