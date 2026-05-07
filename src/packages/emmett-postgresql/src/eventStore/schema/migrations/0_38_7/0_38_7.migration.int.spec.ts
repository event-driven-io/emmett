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
import { PostgreSQLEventStoreCheckpoint } from '../../readMessagesBatch';
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

    const shoppingCartAppendResult = await appendToStream(
      pool,
      shoppingCartId,
      'cart',
      [itemAdded, shoppingCartConfirmed],
    );

    const readShoppingCartResult = await readEvents<ShoppingCartEvent>(
      pool,
      shoppingCartId,
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
    const orderAppendResult = await appendToStream(pool, orderId, 'order', [
      orderInitiated,
    ]);

    const readOrderResult = await readEvents<OrderInitiated>(pool, orderId);

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
      shoppingCart.lastGlobalPosition,
      1n,
    );

    assertTrue(storeResult);

    const shoppingCartCheckpoint = await readSubscriptionCheckpoint(
      pool,
      shoppingCartProcessorId,
    );

    assertDeepEqual(
      shoppingCartCheckpoint.position,
      shoppingCart.lastGlobalPosition,
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
      order.lastGlobalPosition,
      null,
    );

    assertTrue(storeResult);

    orderCheckpoint = await readSubscriptionCheckpoint(pool, orderProcessorId);
    assertDeepEqual(orderCheckpoint.position, order.lastGlobalPosition);
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

const appendToStream = async <E extends Event>(
  pool: Dumbo,
  streamId: string,
  streamType: string,
  events: E[],
  options?: { expectedStreamPosition?: bigint | null },
): Promise<{
  success: boolean;
  nextStreamPosition: bigint;
  globalPositions: bigint[];
  transactionId: bigint;
}> => {
  const messageIds = events.map(() => crypto.randomUUID());

  const result = await pool.execute.command<{
    success: boolean;
    next_stream_position: string;
    global_positions: string[];
    transaction_id: string;
  }>(
    SQL`SELECT * FROM emt_append_to_stream(
      ${messageIds},
      ${events.map((e) => e.data)},
      ${events.map(() => ({}))},
      ${events.map(() => '1')},
      ${events.map((e) => e.type)},
      ${events.map(() => 'E')},
      ${streamId}::text,
      ${streamType}::text,
      ${options?.expectedStreamPosition ?? null},
      ${'emt:default'}::text
    )`,
  );

  const row = result.rows[0]!;
  return {
    success: row.success,
    nextStreamPosition: BigInt(row.next_stream_position),
    globalPositions: row.global_positions.map(BigInt),
    transactionId: BigInt(row.transaction_id),
  };
};

const readEvents = async <E extends Event>(
  pool: Dumbo,
  streamId: string,
): Promise<{
  events: ReadEvent<E, PostgresReadEventMetadata>[];
  currentStreamVersion: bigint;
  streamExists: boolean;
}> => {
  const result = await pool.execute.query<{
    message_type: string;
    message_data: Record<string, unknown>;
    message_metadata: Record<string, unknown>;
    stream_position: string;
    global_position: string;
    transaction_id: string;
    message_id: string;
  }>(
    SQL`SELECT message_type, message_data, message_metadata, stream_position, global_position, transaction_id, message_id
         FROM emt_messages
         WHERE stream_id = ${streamId} AND partition = ${'emt:default'} AND is_archived = FALSE
         ORDER BY stream_position ASC`,
  );

  if (result.rows.length === 0) {
    return { events: [], currentStreamVersion: 0n, streamExists: false };
  }

  const events = result.rows.map((row) => {
    const checkpoint = PostgreSQLEventStoreCheckpoint.toProcessorCheckpoint({
      transactionId: BigInt(row.transaction_id),
      globalPosition: BigInt(row.global_position),
    });
    return {
      type: row.message_type,
      data: row.message_data,
      kind: 'Event' as const,
      metadata: {
        ...row.message_metadata,
        messageId: row.message_id,
        streamName: streamId,
        streamPosition: BigInt(row.stream_position),
        globalPosition: checkpoint,
        checkpoint,
      },
    } as ReadEvent<E, PostgresReadEventMetadata>;
  });

  return {
    events,
    currentStreamVersion: BigInt(
      result.rows[result.rows.length - 1]!.stream_position,
    ),
    streamExists: true,
  };
};
