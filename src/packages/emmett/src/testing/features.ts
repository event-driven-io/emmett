import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { EventStore } from '../eventStore';
import { assertDeepEqual, assertEqual, assertOk } from './assertions';
import {
  evolve,
  evolveWithMetadata,
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
  return describe('aggregateStream', async () => {
    let eventStore: EventStore<bigint>;
    const evolveTestCases = [
      {
        evolve,
        info: 'evolve with raw event',
      },
      { evolve: evolveWithMetadata, info: 'evolve with event and metadata' },
    ];

    before(async () => {
      eventStore = await eventStoreFactory();
    });

    after(async () => {
      const teardownHook = options.teardownHook;
      if (teardownHook) await teardownHook();
    });

    for (const testCase of evolveTestCases) {
      await it(`When called with 'to' allows time traveling using ${testCase.info}`, async () => {
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
          evolve: testCase.evolve,
          getInitialState,
          read: { to: 1n },
        });
        const resultAt2 = await eventStore.aggregateStream(shoppingCartId, {
          evolve: testCase.evolve,
          getInitialState,
          read: { to: 2n },
        });
        const resultAt3 = await eventStore.aggregateStream(shoppingCartId, {
          evolve: testCase.evolve,
          getInitialState,
          read: { to: 3n },
        });

        // then
        assertOk(resultAt1);
        assertOk(resultAt2);
        assertOk(resultAt3);

        assertEqual(resultAt1.currentStreamVersion, options.getInitialIndex());
        assertDeepEqual(resultAt1.state, {
          productItems: [productItem],
          totalAmount: 30,
        });

        assertEqual(
          resultAt2.currentStreamVersion,
          options.getInitialIndex() + 1n,
        );
        assertDeepEqual(resultAt2.state, {
          productItems: [productItem, productItem],
          totalAmount: 60,
        });

        assertEqual(
          resultAt3.currentStreamVersion,
          options.getInitialIndex() + 2n,
        );
        assertDeepEqual(resultAt3.state, {
          productItems: [productItem, productItem],
          totalAmount: 54,
        });
      });
    }
  });
}
