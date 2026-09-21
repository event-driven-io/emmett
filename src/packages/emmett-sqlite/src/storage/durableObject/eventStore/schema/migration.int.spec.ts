import type { DurableObjectStorage } from '@cloudflare/workers-types';
import {
  cloudflareDurableObjectSQLitePool,
  tableExists,
} from '@event-driven-io/dumbo/cloudflare';
import {
  assertDeepEqual,
  assertEqual,
  assertFalse,
  assertTrue,
} from '@event-driven-io/emmett';
import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { v4 as uuid } from 'uuid';
import { aroundEach, describe, it } from 'vitest';
import { durableObjectEventStoreDriver } from '../..';
import {
  getSQLiteEventStore,
  type SQLiteEventStore,
} from '../../../../eventStore/SQLiteEventStore';
import type {
  PricedProductItem,
  ShoppingCartEvent,
} from '../../../../testing/shoppingCart.domain';

void describe('Durable Object event store schema migration', () => {
  let blockConcurrencyWhile: <T>(callback: () => Promise<T>) => Promise<T>;
  let storage: DurableObjectStorage;

  aroundEach(async (runTest) => {
    const stub = env.TEST_OBJECT.get(env.TEST_OBJECT.newUniqueId());

    await runInDurableObject(stub, async (_instance, durableObjectState) => {
      blockConcurrencyWhile = (callback) =>
        durableObjectState.blockConcurrencyWhile(callback);
      storage = durableObjectState.storage;
      await runTest();
    });
  });

  const productItem: PricedProductItem = {
    productId: '123',
    quantity: 10,
    price: 3,
  };

  void it('creates the schema under blockConcurrencyWhile before the first append', async () => {
    const eventStore = getSQLiteEventStore({
      driver: durableObjectEventStoreDriver,
      storage,
      schema: { autoMigration: 'None' },
    });

    try {
      await blockConcurrencyWhile(() => eventStore.schema.migrate());

      assertTrue(await messagesTableExists());

      const shoppingCartId = `shopping_cart-${uuid()}`;
      await eventStore.appendToStream<ShoppingCartEvent>(shoppingCartId, [
        { type: 'ProductItemAdded', data: { productItem } },
      ]);

      await assertStreamHoldsOnly(eventStore, shoppingCartId);
    } finally {
      await eventStore.close();
    }
  });

  void it('creates the schema lazily on the first append by default', async () => {
    const eventStore = getSQLiteEventStore({
      driver: durableObjectEventStoreDriver,
      storage,
    });

    try {
      assertFalse(await messagesTableExists());

      const shoppingCartId = `shopping_cart-${uuid()}`;
      await eventStore.appendToStream<ShoppingCartEvent>(shoppingCartId, [
        { type: 'ProductItemAdded', data: { productItem } },
      ]);

      assertTrue(await messagesTableExists());
      await assertStreamHoldsOnly(eventStore, shoppingCartId);
    } finally {
      await eventStore.close();
    }
  });

  void it('runs a single lazy migration for concurrent first appends', async () => {
    const eventStore = getSQLiteEventStore({
      driver: durableObjectEventStoreDriver,
      storage,
    });

    try {
      const firstCartId = `shopping_cart-${uuid()}`;
      const secondCartId = `shopping_cart-${uuid()}`;

      await Promise.all([
        eventStore.appendToStream<ShoppingCartEvent>(firstCartId, [
          { type: 'ProductItemAdded', data: { productItem } },
        ]),
        eventStore.appendToStream<ShoppingCartEvent>(secondCartId, [
          { type: 'ProductItemAdded', data: { productItem } },
        ]),
      ]);

      await assertStreamHoldsOnly(eventStore, firstCartId);
      await assertStreamHoldsOnly(eventStore, secondCartId);
    } finally {
      await eventStore.close();
    }
  });

  const messagesTableExists = async (): Promise<boolean> => {
    const pool = cloudflareDurableObjectSQLitePool({ storage });

    try {
      return await tableExists(pool.execute, 'emt_messages');
    } finally {
      await pool.close();
    }
  };

  const assertStreamHoldsOnly = async (
    eventStore: SQLiteEventStore,
    shoppingCartId: string,
  ) => {
    const { events } =
      await eventStore.readStream<ShoppingCartEvent>(shoppingCartId);

    assertEqual(1, events.length);

    const [event] = events;
    assertDeepEqual(
      {
        type: event!.type,
        data: event!.data,
        streamName: event!.metadata.streamName,
        streamPosition: event!.metadata.streamPosition,
      },
      {
        type: 'ProductItemAdded',
        data: { productItem },
        streamName: shoppingCartId,
        streamPosition: 1n,
      },
    );
  };
});
