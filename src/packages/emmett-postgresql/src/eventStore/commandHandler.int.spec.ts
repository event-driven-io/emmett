import {
  assertDeepEqual,
  assertEqual,
  assertIsNotNull,
  CommandHandler,
  projections,
} from '@event-driven-io/emmett';
import { pongoClient, type PongoClient } from '@event-driven-io/pongo';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { after, before, describe, it } from 'node:test';
import { v4 as uuid } from 'uuid';
import {
  getPostgreSQLEventStore,
  pongoSingleStreamProjection,
  type PostgresEventStore,
} from '.';
import {
  evolve,
  initialState,
  type DiscountApplied,
  type PricedProductItem,
  type ProductItemAdded,
} from '../testing/shoppingCart.domain';

void describe('Postgres Projections', () => {
  let postgres: StartedPostgreSqlContainer;
  let eventStore: PostgresEventStore;
  let connectionString: string;
  let pongo: PongoClient;
  const now = new Date();

  before(async () => {
    postgres = await new PostgreSqlContainer().start();
    connectionString = postgres.getConnectionUri();
    eventStore = getPostgreSQLEventStore(connectionString, {
      projections: projections.inline([shoppingCartShortInfoProjection]),
      schema: {
        autoMigration: 'None',
      },
    });
    await eventStore.schema.migrate();
    pongo = pongoClient(connectionString);
    return eventStore;
  });

  after(async () => {
    try {
      await eventStore.close();
      await pongo.close();
      await postgres.stop();
    } catch (error) {
      console.log(error);
    }
  });

  void it('should handle command correctly', async () => {
    const handle = CommandHandler({ evolve, initialState });

    const productItem: PricedProductItem = {
      productId: '123',
      quantity: 10,
      price: 3,
    };
    const discount = 10;
    const shoppingCartId = `shopping_cart-${uuid()}`;

    const result = await handle(eventStore, shoppingCartId, () => ({
      type: 'ProductItemAdded',
      data: { productItem, addedAt: now },
    }));

    const couponId = uuid();

    assertEqual(1n, result.nextExpectedStreamVersion);
    assertEqual(true, result.createdNewStream);

    await handle(eventStore, shoppingCartId, () => ({
      type: 'ProductItemAdded',
      data: { productItem, addedAt: new Date() },
    }));

    await handle(eventStore, shoppingCartId, () => ({
      type: 'DiscountApplied',
      data: { percent: discount, couponId },
    }));

    const shoppingCartShortInfo = pongo
      .db()
      .collection<ShoppingCartShortInfo>(shoppingCartShortInfoCollectionName);

    const document = await shoppingCartShortInfo.findOne({
      _id: shoppingCartId,
    });
    assertIsNotNull(document);
    assertDeepEqual(
      { ...document, _id: shoppingCartId },
      {
        _id: shoppingCartId,
        productItemsCount: 20,
        totalAmount: 54,
        appliedDiscounts: [couponId],
        _version: 3n,
      },
    );
  });
});

type ShoppingCartShortInfo = {
  productItemsCount: number;
  totalAmount: number;
  appliedDiscounts: string[];
};

const shoppingCartShortInfoCollectionName = 'shoppingCartShortInfo';

const projectionEvolve = (
  document: ShoppingCartShortInfo,
  { type, data: event }: ProductItemAdded | DiscountApplied,
): ShoppingCartShortInfo => {
  switch (type) {
    case 'ProductItemAdded':
      return {
        ...document,
        totalAmount:
          document.totalAmount +
          event.productItem.price * event.productItem.quantity,
        productItemsCount:
          document.productItemsCount + event.productItem.quantity,
      };
    case 'DiscountApplied':
      // idempotence check
      if (document.appliedDiscounts.includes(event.couponId)) return document;

      return {
        ...document,
        totalAmount: (document.totalAmount * (100 - event.percent)) / 100,
        appliedDiscounts: [...document.appliedDiscounts, event.couponId],
      };
    default:
      return document;
  }
};

const shoppingCartShortInfoProjection = pongoSingleStreamProjection({
  collectionName: shoppingCartShortInfoCollectionName,
  evolve: projectionEvolve,
  canHandle: ['ProductItemAdded', 'DiscountApplied'],
  initialState: () => ({
    productItemsCount: 0,
    totalAmount: 0,
    appliedDiscounts: [],
  }),
});
