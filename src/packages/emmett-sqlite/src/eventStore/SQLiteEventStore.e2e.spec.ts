import {
  assertDeepEqual,
  assertEqual,
  assertIsNotNull,
  assertThrowsAsync,
  ExpectedVersionConflictError,
} from '@event-driven-io/emmett';
import fs from 'fs';
import { afterEach, describe, it } from 'node:test';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';
import { sqliteConnection, type AbsolutePath } from '../sqliteConnection';
import {
  type DiscountApplied,
  type PricedProductItem,
  type ProductItemAdded,
  type ShoppingCartEvent,
} from '../testing/shoppingCart.domain';
import { createEventStoreSchema } from './schema';
import { getSQLiteEventStore } from './SQLiteEventStore';

const __dirname = dirname(fileURLToPath(import.meta.url)) as AbsolutePath;

void describe('SQLiteEventStore', () => {
  const testDatabasePath: AbsolutePath = __dirname + '/../testing/database/';

  afterEach(() => {
    fs.unlink(`${testDatabasePath}/test.db`, (err) => {
      if (err) console.error('Error deleting file:', err);
    });
  });

  void it('should append events', async () => {
    await createEventStoreSchema(
      sqliteConnection({ location: `/${testDatabasePath}/test.db` }),
    );
    const eventStore = getSQLiteEventStore({
      databaseLocation: `${testDatabasePath}/test.db`,
    });

    const productItem: PricedProductItem = {
      productId: '123',
      quantity: 10,
      price: 3,
    };
    const discount = 10;
    const shoppingCartId = `shopping_cart-${uuid()}`;

    const result = await eventStore.appendToStream<ShoppingCartEvent>(
      shoppingCartId,
      [{ type: 'ProductItemAdded', data: { productItem } }],
    );

    const result2 = await eventStore.appendToStream<ShoppingCartEvent>(
      shoppingCartId,
      [{ type: 'ProductItemAdded', data: { productItem } }],
      { expectedStreamVersion: result.nextExpectedStreamVersion },
    );

    await eventStore.appendToStream<ShoppingCartEvent>(
      shoppingCartId,
      [
        {
          type: 'DiscountApplied',
          data: { percent: discount, couponId: uuid() },
        },
      ],
      { expectedStreamVersion: result2.nextExpectedStreamVersion },
    );

    const { events } = await eventStore.readStream(shoppingCartId);

    assertIsNotNull(events);
    assertEqual(3, events.length);
  });

  void it('should aggregate stream', async () => {
    await createEventStoreSchema(
      sqliteConnection({ location: `${testDatabasePath}/test.db` }),
    );
    const eventStore = getSQLiteEventStore({
      databaseLocation: `${testDatabasePath}/test.db`,
    });

    const productItem: PricedProductItem = {
      productId: '123',
      quantity: 10,
      price: 3,
    };
    const discount = 10;
    const shoppingCartId = `shopping_cart-${uuid()}`;

    const result = await eventStore.appendToStream<ShoppingCartEvent>(
      shoppingCartId,
      [{ type: 'ProductItemAdded', data: { productItem } }],
    );

    const result2 = await eventStore.appendToStream<ShoppingCartEvent>(
      shoppingCartId,
      [{ type: 'ProductItemAdded', data: { productItem } }],
      { expectedStreamVersion: result.nextExpectedStreamVersion },
    );

    await eventStore.appendToStream<ShoppingCartEvent>(
      shoppingCartId,
      [
        {
          type: 'DiscountApplied',
          data: { percent: discount, couponId: uuid() },
        },
      ],
      { expectedStreamVersion: result2.nextExpectedStreamVersion },
    );

    const aggregation = await eventStore.aggregateStream(shoppingCartId, {
      evolve,
      initialState: () => null,
    });

    assertDeepEqual(
      { totalAmount: 54, productItemsCount: 20 },
      aggregation.state,
    );
  });

  void it('should automatically create schema', async () => {
    const eventStore = getSQLiteEventStore({
      schema: {
        autoMigration: 'CreateOrUpdate',
      },
      databaseLocation: `${testDatabasePath}/test.db`,
    });

    const productItem: PricedProductItem = {
      productId: '123',
      quantity: 10,
      price: 3,
    };

    const shoppingCartId = `shopping_cart-${uuid()}`;

    await eventStore.appendToStream<ShoppingCartEvent>(shoppingCartId, [
      { type: 'ProductItemAdded', data: { productItem } },
    ]);

    const { events } = await eventStore.readStream(shoppingCartId);

    assertIsNotNull(events);
    assertEqual(1, events.length);
  });

  void it('should create the sqlite connection in memory, and not close the connection', async () => {
    const eventStore = getSQLiteEventStore({
      schema: {
        autoMigration: 'CreateOrUpdate',
      },
      databaseLocation: ':memory:',
    });
    const productItem: PricedProductItem = {
      productId: '123',
      quantity: 10,
      price: 3,
    };

    const shoppingCartId = `shopping_cart-${uuid()}`;

    await eventStore.appendToStream<ShoppingCartEvent>(shoppingCartId, [
      { type: 'ProductItemAdded', data: { productItem } },
    ]);

    const { events } = await eventStore.readStream(shoppingCartId);

    assertIsNotNull(events);
    assertEqual(1, events.length);
  });

  void it('should not overwrite event store if it exists', async () => {
    const eventStore = getSQLiteEventStore({
      schema: {
        autoMigration: 'CreateOrUpdate',
      },
      databaseLocation: `${testDatabasePath}/test.db`,
    });

    const productItem: PricedProductItem = {
      productId: '123',
      quantity: 10,
      price: 3,
    };

    const shoppingCartId = `shopping_cart-${uuid()}`;

    await eventStore.appendToStream<ShoppingCartEvent>(shoppingCartId, [
      { type: 'ProductItemAdded', data: { productItem } },
    ]);

    const { events } = await eventStore.readStream(shoppingCartId);

    assertIsNotNull(events);
    assertEqual(1, events.length);
    const sameEventStore = getSQLiteEventStore({
      schema: {
        autoMigration: 'CreateOrUpdate',
      },
      databaseLocation: `${testDatabasePath}/test.db`,
    });

    const stream = await sameEventStore.readStream(shoppingCartId);

    assertIsNotNull(stream.events);
    assertEqual(1, stream.events.length);
  });

  void it('should throw an error if concurrency check has failed when appending stream', async () => {
    const eventStore = getSQLiteEventStore({
      schema: {
        autoMigration: 'CreateOrUpdate',
      },
      databaseLocation: `${testDatabasePath}/test.db`,
    });

    const productItem: PricedProductItem = {
      productId: '123',
      quantity: 10,
      price: 3,
    };

    const shoppingCartId = `shopping_cart-${uuid()}`;

    await assertThrowsAsync<ExpectedVersionConflictError<bigint>>(async () => {
      await eventStore.appendToStream<ShoppingCartEvent>(
        shoppingCartId,
        [
          {
            type: 'ProductItemAdded',
            data: { productItem },
          },
        ],
        {
          expectedStreamVersion: 5n,
        },
      );
    });
  });
});

type ShoppingCartShortInfo = {
  productItemsCount: number;
  totalAmount: number;
};

const evolve = (
  document: ShoppingCartShortInfo | null,
  { type, data: event }: ProductItemAdded | DiscountApplied,
): ShoppingCartShortInfo => {
  document = document ?? { productItemsCount: 0, totalAmount: 0 };

  switch (type) {
    case 'ProductItemAdded':
      return {
        totalAmount:
          document.totalAmount +
          event.productItem.price * event.productItem.quantity,
        productItemsCount:
          document.productItemsCount + event.productItem.quantity,
      };
    case 'DiscountApplied':
      return {
        ...document,
        totalAmount: (document.totalAmount * (100 - event.percent)) / 100,
      };
    default:
      return document;
  }
};
