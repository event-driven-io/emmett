/* eslint-disable @typescript-eslint/no-floating-promises */
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { getInMemoryEventStore } from '../eventStore';
import { type Event } from '../typing';

// Events & Entity

type PricedProductItem = { productId: string; quantity: number; price: number };

type ShoppingCart = {
  productItems: PricedProductItem[];
  totalAmount: number;
};

type ProductItemAdded = Event<
  'ProductItemAdded',
  { productItem: PricedProductItem }
>;
type DiscountApplied = Event<'DiscountApplied', { percent: number }>;

type ShoppingCartEvent = ProductItemAdded | DiscountApplied;

const evolve = (
  state: ShoppingCart,
  { type, data }: ShoppingCartEvent,
): ShoppingCart => {
  switch (type) {
    case 'ProductItemAdded': {
      const productItem = data.productItem;
      return {
        productItems: [...state.productItems, productItem],
        totalAmount:
          state.totalAmount + productItem.price * productItem.quantity,
      };
    }
    case 'DiscountApplied':
      return {
        ...state,
        totalAmount: state.totalAmount * (1 - data.percent / 100),
      };
  }
};

const getInitialState = (): ShoppingCart => {
  return { productItems: [], totalAmount: 0 };
};

describe('InMemoryEventStore', () => {
  const eventStore = getInMemoryEventStore();

  describe('aggregateStream', () => {
    it('When called with `to` allows time travelling', async () => {
      // Given
      const productItem: PricedProductItem = {
        productId: '123',
        quantity: 10,
        price: 3,
      };
      const discount = 10;
      const shoppingCartId = randomUUID();

      await eventStore.appendToStream<ShoppingCartEvent>(shoppingCartId, [
        { type: 'ProductItemAdded', data: { productItem } },
      ]);
      await eventStore.appendToStream<ShoppingCartEvent>(shoppingCartId, [
        { type: 'ProductItemAdded', data: { productItem } },
      ]);
      await eventStore.appendToStream<ShoppingCartEvent>(shoppingCartId, [
        { type: 'DiscountApplied', data: { percent: discount } },
      ]);

      // when
      const resultAt1 = await eventStore.aggregateStream(shoppingCartId, {
        evolve,
        getInitialState,
        read: { to: 1n },
      });
      const resultAt2 = await eventStore.aggregateStream(shoppingCartId, {
        evolve,
        getInitialState,
        read: { to: 2n },
      });
      const resultAt3 = await eventStore.aggregateStream(shoppingCartId, {
        evolve,
        getInitialState,
        read: { to: 3n },
      });

      // then
      assert.ok(resultAt1);
      assert.ok(resultAt2);
      assert.ok(resultAt3);

      assert.equal(resultAt1.currentStreamVersion, 1);
      assert.deepEqual(resultAt1.state, {
        productItems: [productItem],
        totalAmount: 30,
      });

      assert.equal(resultAt2.currentStreamVersion, 2);
      assert.deepEqual(resultAt2.state, {
        productItems: [productItem, productItem],
        totalAmount: 60,
      });

      assert.equal(resultAt3.currentStreamVersion, 3);
      assert.deepEqual(resultAt3.state, {
        productItems: [productItem, productItem],
        totalAmount: 54,
      });
    });
  });
});
