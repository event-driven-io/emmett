import { beforeEach, describe, it } from 'vitest';
import { v4 as uuid } from 'uuid';
import {
  documentExists,
  eventInStream,
  eventsInStream,
  expectInMemoryDocuments,
  InMemoryProjectionSpec,
  inMemorySingleStreamProjection,
  newEventsInStream,
} from '.';
import type {
  DiscountApplied,
  ProductItemAdded,
} from '../../../testing/shoppingCart.domain';

type ShoppingCartShortInfo = {
  productItemsCount: number;
  totalAmount: number;
  appliedDiscounts: string[];
};

const shoppingCartShortInfoCollectionName = 'shoppingCartShortInfo';

const evolve = (
  document: ShoppingCartShortInfo | null,
  { type, data: event }: ProductItemAdded | DiscountApplied,
): ShoppingCartShortInfo | null => {
  if (!document) {
    document = {
      productItemsCount: 0,
      totalAmount: 0,
      appliedDiscounts: [],
    };
  }
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

const shoppingCartShortInfoProjection = inMemorySingleStreamProjection({
  collectionName: shoppingCartShortInfoCollectionName,
  evolve,
  canHandle: ['ProductItemAdded', 'DiscountApplied'],
  initialState: () => ({
    productItemsCount: 0,
    totalAmount: 0,
    appliedDiscounts: [],
  }),
});

void describe('InMemory Projections', () => {
  let given: ReturnType<
    typeof InMemoryProjectionSpec.for<ProductItemAdded | DiscountApplied>
  >;
  let shoppingCartId: string;

  beforeEach(() => {
    shoppingCartId = `shoppingCart:${uuid()}`;

    given = InMemoryProjectionSpec.for({
      projection: shoppingCartShortInfoProjection,
    });
  });

  void it('with empty given and raw when', () =>
    given([])
      .when([
        {
          type: 'ProductItemAdded',
          data: {
            shoppingCartId,
            productItem: { price: 100, productId: 'shoes', quantity: 100 },
          },
          metadata: {
            streamName: shoppingCartId,
          },
        },
      ])
      .then(
        documentExists<ShoppingCartShortInfo>(
          {
            productItemsCount: 100,
            totalAmount: 10000,
            appliedDiscounts: [],
          },
          {
            inCollection: shoppingCartShortInfoCollectionName,
            withId: shoppingCartId,
          },
        ),
      ));

  void it('with empty given and when eventsInStream', () =>
    given([])
      .when([
        eventInStream(shoppingCartId, {
          type: 'ProductItemAdded',
          data: {
            shoppingCartId,
            productItem: { price: 100, productId: 'shoes', quantity: 100 },
          },
        }),
      ])
      .then(
        expectInMemoryDocuments
          .fromCollection<ShoppingCartShortInfo>(
            shoppingCartShortInfoCollectionName,
          )
          .withId(shoppingCartId)
          .toBeEqual({
            productItemsCount: 100,
            totalAmount: 10000,
            appliedDiscounts: [],
          }),
      ));

  void it('with empty given and multiple when events', () => {
    const couponId = uuid();

    return given(
      eventsInStream<ProductItemAdded>(shoppingCartId, [
        {
          type: 'ProductItemAdded',
          data: {
            shoppingCartId,
            productItem: { price: 100, productId: 'shoes', quantity: 100 },
          },
        },
      ]),
    )
      .when(
        newEventsInStream(shoppingCartId, [
          {
            type: 'DiscountApplied',
            data: { shoppingCartId, percent: 10, couponId },
          },
        ]),
      )
      .then(
        expectInMemoryDocuments
          .fromCollection<ShoppingCartShortInfo>(
            shoppingCartShortInfoCollectionName,
          )
          .withId(shoppingCartId)
          .toBeEqual({
            productItemsCount: 100,
            totalAmount: 9000,
            appliedDiscounts: [couponId],
          }),
      );
  });

  void it('with idempotency check', () => {
    const couponId = uuid();

    return given(
      eventsInStream<ProductItemAdded>(shoppingCartId, [
        {
          type: 'ProductItemAdded',
          data: {
            shoppingCartId,
            productItem: { price: 100, productId: 'shoes', quantity: 100 },
          },
        },
      ]),
    )
      .when(
        newEventsInStream(shoppingCartId, [
          {
            type: 'DiscountApplied',
            data: { shoppingCartId, percent: 10, couponId },
          },
        ]),
        { numberOfTimes: 2 },
      )
      .then(
        expectInMemoryDocuments
          .fromCollection<ShoppingCartShortInfo>(
            shoppingCartShortInfoCollectionName,
          )
          .withId(shoppingCartId)
          .toBeEqual({
            productItemsCount: 100,
            totalAmount: 9000,
            appliedDiscounts: [couponId],
          }),
      );
  });
});

// #region coping-projection
type CartTotal = { cartId: string; totalAmount: number };

const cartTotalProjection = inMemorySingleStreamProjection<
  CartTotal,
  ProductItemAdded | DiscountApplied
>({
  collectionName: 'cart_totals',
  canHandle: ['ProductItemAdded', 'DiscountApplied'],
  initialState: () => ({ cartId: '', totalAmount: 0 }),
  evolve: (
    document: CartTotal,
    { type, data }: ProductItemAdded | DiscountApplied,
  ): CartTotal => {
    switch (type) {
      case 'ProductItemAdded':
        return {
          ...document,
          cartId: data.shoppingCartId,
          totalAmount:
            document.totalAmount +
            data.productItem.price * data.productItem.quantity,
        };
      case 'DiscountApplied':
        // the discount is already recorded: don't throw if it overshoots,
        // clamp the total to zero and keep the read model sane
        return {
          ...document,
          cartId: data.shoppingCartId,
          totalAmount: Math.max(
            (document.totalAmount * (100 - data.percent)) / 100,
            0,
          ),
        };
      default:
        return document;
    }
  },
});
// #endregion coping-projection

void describe('InMemory projection coping with drift', () => {
  let given: ReturnType<
    typeof InMemoryProjectionSpec.for<ProductItemAdded | DiscountApplied>
  >;
  let shoppingCartId: string;

  beforeEach(() => {
    shoppingCartId = `shoppingCart:${uuid()}`;
    given = InMemoryProjectionSpec.for({ projection: cartTotalProjection });
  });

  void it('clamps an overshooting discount instead of throwing', () =>
    given(
      eventsInStream(shoppingCartId, [
        {
          type: 'ProductItemAdded',
          data: {
            shoppingCartId,
            productItem: { price: 100, productId: 'shoes', quantity: 1 },
          },
        },
      ]),
    )
      .when(
        newEventsInStream(shoppingCartId, [
          {
            type: 'DiscountApplied',
            data: { shoppingCartId, percent: 150, couponId: uuid() },
          },
        ]),
      )
      .then(
        expectInMemoryDocuments
          .fromCollection<CartTotal>('cart_totals')
          .withId(shoppingCartId)
          .toBeEqual({ cartId: shoppingCartId, totalAmount: 0 }),
      ));
});
