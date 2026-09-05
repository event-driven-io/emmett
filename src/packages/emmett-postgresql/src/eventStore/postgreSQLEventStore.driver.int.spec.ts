import { assertEqual, assertTrue } from '@event-driven-io/emmett';
import pg from 'pg';
import { v4 as uuid } from 'uuid';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { unresolvableConnectionString } from '../testing/dumboDriverIsolation';
import {
  sharedPostgreSQLDatabase,
  type PostgreSQLTestDatabase,
} from '../testing/postgreSQLTestDatabase';
import {
  evolve,
  initialState,
  type PricedProductItem,
  type ShoppingCart,
  type ShoppingCartEvent,
} from '../testing/shoppingCart.domain';
import {
  getPostgreSQLEventStore,
  type PostgresEventStore,
} from './postgreSQLEventStore';
import { pgEventStoreDriver } from '../pg';

void describe('PostgreSQL event store driver resolution', () => {
  let database: PostgreSQLTestDatabase;

  const productItem: PricedProductItem = {
    productId: '123',
    quantity: 10,
    price: 3,
  };

  beforeAll(async () => {
    database = await sharedPostgreSQLDatabase();
  });

  afterAll(async () => {
    try {
      await database?.close();
    } catch (error) {
      console.log(error);
    }
  });

  const withEventStore = async <Result>(
    handle: (eventStore: PostgresEventStore) => Promise<Result>,
  ): Promise<Result> => {
    const nativePool = new pg.Pool({
      connectionString: database.connectionString,
    });
    let eventStore: PostgresEventStore | undefined;

    try {
      eventStore = getPostgreSQLEventStore({
        driver: pgEventStoreDriver,
        connectionString: unresolvableConnectionString,
        connectionOptions: {
          pooled: true,
          pool: nativePool,
        },
      });

      return await handle(eventStore);
    } finally {
      await eventStore?.close();
      await nativePool.end();
    }
  };

  void it('should migrate schema with a driver taken from options', async () => {
    await withEventStore(async (eventStore) => {
      const result = await eventStore.schema.migrate();

      assertTrue(result.applied.length > 0);
    });
  });

  void it('should append to stream with a driver taken from options', async () => {
    await withEventStore(async (eventStore) => {
      const shoppingCartId = `shopping_cart-${uuid()}`;

      const result = await eventStore.appendToStream<ShoppingCartEvent>(
        shoppingCartId,
        [{ type: 'ProductItemAdded', data: { productItem } }],
      );

      assertEqual(1n, result.nextExpectedStreamVersion);
    });
  });

  void it('should read stream with a driver taken from options', async () => {
    await withEventStore(async (eventStore) => {
      const shoppingCartId = `shopping_cart-${uuid()}`;

      await eventStore.appendToStream<ShoppingCartEvent>(shoppingCartId, [
        { type: 'ProductItemAdded', data: { productItem } },
        { type: 'DiscountApplied', data: { percent: 10, couponId: uuid() } },
      ]);

      const { events, currentStreamVersion } =
        await eventStore.readStream<ShoppingCartEvent>(shoppingCartId);

      assertEqual(2n, currentStreamVersion);
      assertEqual(2, events.length);
      assertEqual('ProductItemAdded', events[0]!.type);
      assertEqual('DiscountApplied', events[1]!.type);
    });
  });

  void it('should aggregate stream with a driver taken from options', async () => {
    await withEventStore(async (eventStore) => {
      const shoppingCartId = `shopping_cart-${uuid()}`;

      await eventStore.appendToStream<ShoppingCartEvent>(shoppingCartId, [
        { type: 'ProductItemAdded', data: { productItem } },
        { type: 'DiscountApplied', data: { percent: 10, couponId: uuid() } },
      ]);

      const { state, currentStreamVersion } = await eventStore.aggregateStream<
        ShoppingCart,
        ShoppingCartEvent
      >(shoppingCartId, { evolve, initialState });

      assertEqual(2n, currentStreamVersion);
      assertEqual(1, state.productItems.length);
      assertEqual(27, state.totalAmount);
    });
  });
});
