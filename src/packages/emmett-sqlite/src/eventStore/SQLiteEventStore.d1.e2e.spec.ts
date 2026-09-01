import type { D1Database } from '@cloudflare/workers-types';
import type { ExpectedVersionConflictError } from '@event-driven-io/emmett';
import {
  assertDeepEqual,
  assertEqual,
  assertFalse,
  assertIsNotNull,
  assertThrowsAsync,
  assertTrue,
  type Event,
} from '@event-driven-io/emmett';
import { Miniflare } from 'miniflare';
import { v4 as uuid } from 'uuid';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  it,
} from 'vitest';
import {
  d1Pool,
  sqliteTableName,
  tableExists,
} from '@event-driven-io/dumbo/cloudflare';
import { d1EventStoreDriver, type D1EventStoreDriver } from '../cloudflare';
import type {
  DiscountApplied,
  PricedProductItem,
  ProductItemAdded,
  ShoppingCartEvent,
} from '../testing/shoppingCart.domain';
import { readProcessorCheckpoint } from './schema';
import {
  getSQLiteEventStore,
  type SQLiteEventStore,
  type SQLiteEventStoreOptions,
} from './SQLiteEventStore';

void describe('SQLiteEventStore', () => {
  let mf: Miniflare;
  let database: D1Database;
  let eventStore: SQLiteEventStore;
  let config: SQLiteEventStoreOptions<D1EventStoreDriver>;

  beforeAll(async () => {
    mf = new Miniflare({
      modules: true,
      script: 'export default { fetch() { return new Response("ok"); } }',
      d1Databases: { DB: 'test-db-id' },
    });
    database = await mf.getD1Database('DB');
    config = {
      driver: d1EventStoreDriver,
      schema: {
        autoMigration: 'None',
      },
      database,
    };
  });

  afterAll(async () => {
    await mf.dispose();
  });

  void describe('With manual Schema Creation', () => {
    beforeEach(async () => {
      eventStore = getSQLiteEventStore(config);
      await eventStore.schema.migrate();
    });

    afterEach(async () => {
      await eventStore.close();
    });

    void it('should append events', async () => {
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

    void it('should throw an error if concurrency check has failed when appending stream', async () => {
      const productItem: PricedProductItem = {
        productId: '123',
        quantity: 10,
        price: 3,
      };

      const shoppingCartId = `shopping_cart-${uuid()}`;

      await assertThrowsAsync<ExpectedVersionConflictError>(async () => {
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

  void it('should automatically create schema', async () => {
    const eventStore = getSQLiteEventStore({
      driver: d1EventStoreDriver,
      schema: {
        autoMigration: 'CreateOrUpdate',
      },
      database,
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
      driver: d1EventStoreDriver,
      database,
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
      driver: d1EventStoreDriver,
      schema: {
        autoMigration: 'CreateOrUpdate',
      },
      database,
    });

    const stream = await sameEventStore.readStream(shoppingCartId);

    assertIsNotNull(stream.events);
    assertEqual(1, stream.events.length);
  });

  void it('should allow events to be processed in the onBeforeCommit hook', async () => {
    const savedEvents = [];
    const eventStore = getSQLiteEventStore({
      driver: d1EventStoreDriver,
      schema: {
        autoMigration: 'CreateOrUpdate',
      },
      database,
      hooks: {
        onBeforeCommit: (messages): void => {
          savedEvents.push(...messages);
        },
      },
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

    assertEqual(savedEvents.length, 1);
  });
});

void describe('SQLiteEventStore with a database schema configured by the user', () => {
  let mf: Miniflare;
  let database: D1Database;
  let eventStore: SQLiteEventStore;

  beforeAll(async () => {
    mf = new Miniflare({
      modules: true,
      script: 'export default { fetch() { return new Response("ok"); } }',
      d1Databases: { DB: 'test-db-id' },
    });
    database = await mf.getD1Database('DB');
  });

  afterAll(async () => {
    await mf.dispose();
  });

  beforeEach(() => {
    eventStore = getSQLiteEventStore({
      driver: d1EventStoreDriver,
      schema: {
        autoMigration: 'CreateOrUpdate',
        databaseSchemaName: 'events',
      },
      database,
    });
  });

  afterEach(async () => {
    await eventStore.close();
  });

  void it('should append and read events from the configured schema', async () => {
    const productItem: PricedProductItem = {
      productId: '123',
      quantity: 10,
      price: 3,
    };
    const shoppingCartId = `shopping_cart-${uuid()}`;

    const appendResult = await eventStore.appendToStream<ShoppingCartEvent>(
      shoppingCartId,
      [{ type: 'ProductItemAdded', data: { productItem } }],
    );

    const { events, streamExists } =
      await eventStore.readStream<ShoppingCartEvent>(shoppingCartId);

    assertEqual(appendResult.nextExpectedStreamVersion, 1n);
    assertTrue(streamExists);
    assertEqual(1, events.length);
    assertTrue(await eventStore.streamExists(shoppingCartId));
  });

  void it('should keep processor checkpoints in the configured schema', async () => {
    const productItem: PricedProductItem = {
      productId: '123',
      quantity: 10,
      price: 3,
    };
    const shoppingCartId = `shopping_cart-${uuid()}`;
    const processorId = `processor:${uuid()}`;

    await eventStore.appendToStream<ShoppingCartEvent>(shoppingCartId, [
      { type: 'ProductItemAdded', data: { productItem } },
    ]);

    const consumer = eventStore.consumer<ShoppingCartEvent>({
      stopWhen: { noMessagesLeft: true },
    });
    consumer.reactor({
      processorId,
      canHandle: ['ProductItemAdded'],
      eachMessage: () => {},
    });

    try {
      await consumer.start();
    } finally {
      await consumer.close();
    }

    const pool = d1Pool({ database });

    try {
      const { lastProcessedCheckpoint } = await readProcessorCheckpoint(
        pool.execute,
        { processorId, databaseSchemaName: 'events' },
      );

      assertIsNotNull(lastProcessedCheckpoint);
      assertFalse(await tableExists(pool.execute, 'emt_processors'));
    } finally {
      await pool.close();
    }
  });

  void it('should keep the default schema tables uncreated', async () => {
    const productItem: PricedProductItem = {
      productId: '123',
      quantity: 10,
      price: 3,
    };
    const shoppingCartId = `shopping_cart-${uuid()}`;

    await eventStore.appendToStream<ShoppingCartEvent>(shoppingCartId, [
      { type: 'ProductItemAdded', data: { productItem } },
    ]);

    const pool = d1Pool({ database });

    try {
      assertTrue(
        await tableExists(
          pool.execute,
          sqliteTableName({
            databaseSchemaName: 'events',
            tableName: 'emt_messages',
          }),
        ),
      );
      assertFalse(await tableExists(pool.execute, 'emt_messages'));
    } finally {
      await pool.close();
    }
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

void describe('SQLiteEventStore upcasting', () => {
  let mf: Miniflare;
  let database: D1Database;

  beforeAll(async () => {
    mf = new Miniflare({
      modules: true,
      script: 'export default { fetch() { return new Response("ok"); } }',
      d1Databases: { DB: 'test-db-id' },
    });
    database = await mf.getD1Database('DB');
  });

  afterAll(async () => {
    await mf.dispose();
  });

  type ShoppingCartOpenedFromDB = Event<
    'ShoppingCartOpened',
    { openedAt: string; loyaltyPoints: string }
  >;

  type ShoppingCartOpened = Event<
    'ShoppingCartOpened',
    { openedAt: Date; loyaltyPoints: bigint }
  >;

  type ShoppingCartEventFromDB =
    ProductItemAdded | DiscountApplied | ShoppingCartOpenedFromDB;

  type ShoppingCartEventWithDatesAndBigInt =
    ProductItemAdded | DiscountApplied | ShoppingCartOpened;

  type ShoppingCartState = {
    productItems: PricedProductItem[];
    totalAmount: number;
    openedAt: Date | null;
    loyaltyPoints: bigint;
  };

  const upcast = (event: Event): ShoppingCartEventWithDatesAndBigInt => {
    switch (event.type) {
      case 'ShoppingCartOpened': {
        const e = event as ShoppingCartOpenedFromDB;
        return {
          ...e,
          data: {
            openedAt: new Date(e.data.openedAt),
            loyaltyPoints: BigInt(e.data.loyaltyPoints),
          },
        };
      }
      default:
        return event as ShoppingCartEventWithDatesAndBigInt;
    }
  };

  const evolveState = (
    state: ShoppingCartState,
    { type, data }: ShoppingCartEventWithDatesAndBigInt,
  ): ShoppingCartState => {
    switch (type) {
      case 'ShoppingCartOpened':
        return {
          ...state,
          openedAt: data.openedAt,
          loyaltyPoints: data.loyaltyPoints,
        };
      case 'ProductItemAdded':
        return {
          ...state,
          productItems: [...state.productItems, data.productItem],
          totalAmount:
            state.totalAmount +
            data.productItem.price * data.productItem.quantity,
        };
      case 'DiscountApplied':
        return {
          ...state,
          totalAmount: (state.totalAmount * (100 - data.percent)) / 100,
        };
    }
  };

  const initialState = (): ShoppingCartState => ({
    productItems: [],
    totalAmount: 0,
    openedAt: null,
    loyaltyPoints: 0n,
  });

  void it('should upcast ISO string to Date and string to BigInt when aggregating', async () => {
    const eventStore = getSQLiteEventStore({
      driver: d1EventStoreDriver,
      schema: { autoMigration: 'CreateOrUpdate' },
      database,
    });

    const openedAtString = '2024-01-15T10:30:00.000Z';
    const loyaltyPointsString = '9007199254740993';
    const productItem: PricedProductItem = {
      productId: '123',
      quantity: 10,
      price: 3,
    };
    const shoppingCartId = `shopping_cart-${uuid()}`;

    await eventStore.appendToStream<ShoppingCartEventFromDB>(shoppingCartId, [
      {
        type: 'ShoppingCartOpened',
        data: { openedAt: openedAtString, loyaltyPoints: loyaltyPointsString },
      },
      { type: 'ProductItemAdded', data: { productItem } },
    ]);

    const { state, currentStreamVersion } = await eventStore.aggregateStream<
      ShoppingCartState,
      ShoppingCartEventWithDatesAndBigInt
    >(shoppingCartId, {
      evolve: evolveState,
      initialState,
      read: { schema: { versioning: { upcast } } },
    });

    assertEqual(currentStreamVersion, 2n);
    assertDeepEqual(state.openedAt, new Date(openedAtString));
    assertEqual(state.loyaltyPoints, BigInt(loyaltyPointsString));
    assertEqual(state.totalAmount, productItem.price * productItem.quantity);
  });
});
