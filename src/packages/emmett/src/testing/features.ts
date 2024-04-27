import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { EventStore } from '../eventStore';
import {
  evolve,
  getInitialState,
  type PricedProductItem,
  type ShoppingCartEvent,
} from './shoppingCart.domain';

type TestOptions = {
  getInitialIndex: () => bigint;
  teardownHook?: () => Promise<void>;
};

export type EventStoreFactory = () => Promise<EventStore<bigint>>;

export async function testAggregateStream(
  eventStoreFactory: EventStoreFactory,
  options: TestOptions = {
    getInitialIndex: () => 1n,
  },
) {
  return describe('aggregateStream', () => {
    let eventStore: EventStore<bigint>;

    before(async () => {
      eventStore = await eventStoreFactory();
    });

    after(async () => {
      const teardownHook = options.teardownHook;
      if (teardownHook) await teardownHook();
    });

    void it('When called with `to` allows time traveling', async () => {
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

      assert.equal(resultAt1.currentStreamVersion, options.getInitialIndex());
      assert.deepEqual(resultAt1.state, {
        productItems: [productItem],
        totalAmount: 30,
      });

      assert.equal(
        resultAt2.currentStreamVersion,
        options.getInitialIndex() + 1n,
      );
      assert.deepEqual(resultAt2.state, {
        productItems: [productItem, productItem],
        totalAmount: 60,
      });

      assert.equal(
        resultAt3.currentStreamVersion,
        options.getInitialIndex() + 2n,
      );
      assert.deepEqual(resultAt3.state, {
        productItems: [productItem, productItem],
        totalAmount: 54,
      });
    });
  });
}
