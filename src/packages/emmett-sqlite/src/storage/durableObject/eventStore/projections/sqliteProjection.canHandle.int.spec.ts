import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { v4 as uuid } from 'uuid';
import { aroundEach, describe, it } from 'vitest';
import { durableObjectEventStoreDriver } from '../..';
import type {
  DiscountApplied,
  ProductItemAdded,
  ShoppingCartConfirmed,
} from '../../../../testing/shoppingCart.domain';
import {
  expectPongoDocuments,
  pongoSingleStreamProjection,
} from '../../../../eventStore/projections/pongo';
import {
  eventInStream,
  SQLiteProjectionSpec,
} from '../../../../eventStore/projections/sqliteProjectionSpec';

type ShoppingCartShortInfo = {
  productItemsCount: number;
  totalAmount: number;
  appliedDiscounts: string[];
};

const collectionName = 'shoppingCartShortInfo';

// evolve deliberately knows how to apply DiscountApplied, even though the
// projection only declares `ProductItemAdded` in canHandle. If
// handleProjections did not filter, the discount would change totalAmount.
const evolve = (
  document: ShoppingCartShortInfo,
  { type, data }: ProductItemAdded | DiscountApplied | ShoppingCartConfirmed,
): ShoppingCartShortInfo => {
  switch (type) {
    case 'ProductItemAdded':
      return {
        ...document,
        totalAmount:
          document.totalAmount +
          data.productItem.price * data.productItem.quantity,
        productItemsCount:
          document.productItemsCount + data.productItem.quantity,
      };
    case 'DiscountApplied':
      if (document.appliedDiscounts.includes(data.couponId)) return document;

      return {
        ...document,
        totalAmount: (document.totalAmount * (100 - data.percent)) / 100,
        appliedDiscounts: [...document.appliedDiscounts, data.couponId],
      };
    default:
      return document;
  }
};

const shoppingCartShortInfoProjection = pongoSingleStreamProjection<
  ShoppingCartShortInfo,
  ProductItemAdded | DiscountApplied | ShoppingCartConfirmed
>({
  collectionName,
  evolve,
  // only ProductItemAdded is handled; the other event types must be filtered out
  canHandle: ['ProductItemAdded'],
  initialState: () => ({
    productItemsCount: 0,
    totalAmount: 0,
    appliedDiscounts: [],
  }),
});

void describe('SQLite handleProjections canHandle filtering', () => {
  let given: SQLiteProjectionSpec<
    ProductItemAdded | DiscountApplied | ShoppingCartConfirmed
  >;
  let shoppingCartId: string;

  aroundEach(async (runTest) => {
    const stub = env.TEST_OBJECT.get(env.TEST_OBJECT.newUniqueId());

    await runInDurableObject(stub, async (_instance, state) => {
      shoppingCartId = `shoppingCart:${uuid()}`;

      given = SQLiteProjectionSpec.for({
        projection: shoppingCartShortInfoProjection,
        driver: durableObjectEventStoreDriver,
        storage: state.storage,
      });
      await runTest();
    });
  });

  void it('only applies events whose type is declared in canHandle', () => {
    const couponId = uuid();

    return given([])
      .when([
        eventInStream(shoppingCartId, {
          type: 'ProductItemAdded',
          data: {
            productItem: { price: 100, productId: 'shoes', quantity: 100 },
          },
        }),
        // not in canHandle: must be filtered out before reaching evolve
        eventInStream(shoppingCartId, {
          type: 'DiscountApplied',
          data: { percent: 10, couponId },
        }),
        // not in canHandle: must be filtered out before reaching evolve
        eventInStream(shoppingCartId, {
          type: 'ShoppingCartConfirmed',
          data: { confirmedAt: new Date() },
        }),
      ])
      .then(
        expectPongoDocuments
          .fromCollection<ShoppingCartShortInfo>(collectionName)
          .withId(shoppingCartId)
          .toBeEqual({
            productItemsCount: 100,
            totalAmount: 10000,
            appliedDiscounts: [],
          }),
      );
  });
});
