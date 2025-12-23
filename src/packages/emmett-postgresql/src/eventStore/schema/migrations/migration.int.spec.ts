import { dumbo, rawSql, type Dumbo } from '@event-driven-io/dumbo';
import {
  assertDeepEqual,
  assertMatches,
  assertTrue,
  type Event,
} from '@event-driven-io/emmett';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  getPostgreSQLEventStore,
  type PostgresEventStore,
} from '../../postgreSQLEventStore';
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
  };

  void it('can migrate from 0.36.0 schema', async () => {
    // Given
    await pool.execute.command(schema_0_36_0);

    // When
    await eventStore.schema.migrate();

    // Then
    await assertCanAppendAndRead(eventStore);
  });

  void it('can migrate from 0.38.7 schema', async () => {
    // Given
    await pool.execute.command(schema_0_38_7);

    // When
    await eventStore.schema.migrate();

    // Then
    await assertCanAppendAndRead(eventStore);
  });

  void it('can migrate from 0.38.7 schema with subscription cleanup', async () => {
    // Given
    await pool.execute.command(schema_0_38_7);
    await eventStore.schema.migrate();

    // When
    await cleanupLegacySubscriptionTables(connectionString);

    // Then
    await assertCanAppendAndRead(eventStore);
  });

  void it('can migrate from 0.42.0 schema', async () => {
    // Given
    await pool.execute.command(schema_0_42_0);

    // When
    await eventStore.schema.migrate();

    // Then
    await assertCanAppendAndRead(eventStore);
  });

  void it('can migrate from latest schema', async () => {
    // Given
    const latestSchemaSQL = eventStore.schema.sql();
    await pool.execute.command(rawSql(latestSchemaSQL));

    // When
    await eventStore.schema.migrate();

    // Then
    await assertCanAppendAndRead(eventStore);
  });
});
