import { dumbo, runSQLMigrations, type Dumbo } from '@event-driven-io/dumbo';
import { pgDumboDriver, type PgPool } from '@event-driven-io/dumbo/pg';
import {
  assertDeepEqual,
  assertMatches,
  assertThatArray,
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
import { schemaMigration } from '..';
import {
  getPostgreSQLEventStore,
  type PostgresEventStore,
  type PostgresReadEventMetadata,
} from '../../../postgreSQLEventStore';
import { readProcessorCheckpoint } from '../../readProcessorCheckpoint';
import { storeProcessorCheckpoint } from '../../storeProcessorCheckpoint';
import { migrations_0_36_0 } from '../0_36_0';
import { migrations_0_38_7 } from '../0_38_7';
import { migrations_0_42_0 } from '../0_42_0';
import { migrations_0_43_0 } from '../0_43_0';

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

  void it('migrates from fresh schema', async () => {
    // Given

    // When
    const { applied, skipped } = await eventStore.schema.migrate();

    // Then
    assertDeepEqual(applied, [
      ...migrations_0_38_7,
      ...migrations_0_42_0,
      ...migrations_0_43_0,
      schemaMigration,
    ]);
    assertThatArray(skipped).isEmpty();

    const result = await assertCanAppendAndRead(eventStore);
    await assertCanStoreAndReadCheckpoints(pool, result);
  });

  void it('migrates from 0.36.0 schema', async () => {
    // Given
    await runSQLMigrations(pool, migrations_0_36_0);

    // When
    const { applied, skipped } = await eventStore.schema.migrate();

    // Then
    assertDeepEqual(applied, [
      ...migrations_0_38_7,
      ...migrations_0_42_0,
      ...migrations_0_43_0,
      schemaMigration,
    ]);
    assertThatArray(skipped).isEmpty();

    const result = await assertCanAppendAndRead(eventStore);
    await assertCanStoreAndReadCheckpoints(pool, result);
  });

  void it('migrates from 0.38.7 schema', async () => {
    // Given
    await runSQLMigrations(pool, [...migrations_0_36_0, ...migrations_0_38_7]);

    // When
    const { applied, skipped } = await eventStore.schema.migrate();

    // Then
    assertDeepEqual(applied, [
      ...migrations_0_42_0,
      ...migrations_0_43_0,
      schemaMigration,
    ]);
    assertDeepEqual(skipped, [...migrations_0_38_7]);

    const result = await assertCanAppendAndRead(eventStore);
    await assertCanStoreAndReadCheckpoints(pool, result);
  });

  void it('migrates from 0.42.0 schema', async () => {
    // Given
    await runSQLMigrations(pool, [
      ...migrations_0_36_0,
      ...migrations_0_38_7,
      ...migrations_0_42_0,
    ]);

    // When
    const { applied, skipped } = await eventStore.schema.migrate();

    // Then
    assertDeepEqual(applied, [...migrations_0_43_0, schemaMigration]);
    assertDeepEqual(skipped, [...migrations_0_38_7, ...migrations_0_42_0]);

    const result = await assertCanAppendAndRead(eventStore);
    await assertCanStoreAndReadCheckpoints(pool, result);
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
    const { applied, skipped } = await eventStore.schema.migrate();

    // Then
    assertDeepEqual(applied, [schemaMigration]);
    assertDeepEqual(skipped, [
      ...migrations_0_38_7,
      ...migrations_0_42_0,
      ...migrations_0_43_0,
    ]);

    const result = await assertCanAppendAndRead(eventStore);
    await assertCanStoreAndReadCheckpoints(pool, result);
  });

  void it('migrates from latest schema', async () => {
    // Given
    await eventStore.schema.migrate();

    // When
    const { applied, skipped } = await eventStore.schema.migrate();

    // Then
    assertThatArray(applied).isEmpty();
    assertDeepEqual(skipped, [
      ...migrations_0_38_7,
      ...migrations_0_42_0,
      ...migrations_0_43_0,
      schemaMigration,
    ]);
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
});
