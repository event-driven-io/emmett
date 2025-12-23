import { dumbo, rawSql, sql, type Dumbo } from '@event-driven-io/dumbo';
import {
  assertDeepEqual,
  assertFalse,
  assertMatches,
  assertTrue,
  type Event,
  type ReadEvent,
} from '@event-driven-io/emmett';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { afterEach, beforeEach, describe, it } from 'node:test';
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
  let pool: Dumbo;
  let eventStore: PostgresEventStore;
  let connectionString: string;

  beforeEach(async () => {
    postgres = await new PostgreSqlContainer().start();
    connectionString = postgres.getConnectionUri();
    pool = dumbo({
      connectionString,
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
      await postgres.stop();
    } catch (error) {
      console.log(error);
    }
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
      sql(
        `SELECT last_processed_position, last_processed_transaction_id
         FROM emt_subscriptions
         WHERE subscription_id = %L AND partition = %L`,
        processorId,
        partition ?? 'emt:default',
      ),
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
      sql(
        `SELECT last_processed_checkpoint, last_processed_transaction_id
         FROM emt_processors
         WHERE processor_id = %L AND partition = %L`,
        processorId,
        partition ?? 'emt:default',
      ),
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
      rawSql(`
        INSERT INTO emt_subscriptions (subscription_id, version, partition, last_processed_position, last_processed_transaction_id)
        VALUES ('${processorId}', 1, '${defaultTag}', ${position !== null ? position : 'NULL'}, pg_current_xact_id())
      `),
    );

  const storeSubscriptionCheckpoint = (
    pool: Dumbo,
    processorId: string,
    position: bigint | null,
    checkPosition: bigint | null,
  ) =>
    pool.execute.command(
      rawSql(`
        SELECT store_subscription_checkpoint('${processorId}', 1, ${position !== null ? "'" + position + "'" : 'NULL'}, ${checkPosition !== null ? "'" + checkPosition + "'" : 'NULL'}, pg_current_xact_id(), 'emt:default')
      `),
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
  });

  void it('migrates from latest schema', async () => {
    // Given
    const latestSchemaSQL = eventStore.schema.sql();
    await pool.execute.command(rawSql(latestSchemaSQL));

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
      newApiResult.reason === 'IGNORED' || newApiResult.reason === 'MISMATCH',
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
      sql(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'emt_subscriptions'`,
      ),
    );
    assertDeepEqual(tablesResult.rows.length, 0);

    const functionsResult = await pool.execute.query<{ proname: string }>(
      sql(
        `SELECT proname FROM pg_proc WHERE proname = 'store_subscription_checkpoint'`,
      ),
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
});
