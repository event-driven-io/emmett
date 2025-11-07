import {
  assertDeepEqual,
  assertEqual,
  assertOk,
  assertThrowsAsync,
  assertTrue,
  CommandHandler,
  ExpectedVersionConflictError,
  isExpectedVersionConflictError,
  type EventStore,
} from '@event-driven-io/emmett';
import { randomUUID } from 'crypto';
import { after, before, describe, it } from 'node:test';
import { v4 as uuid } from 'uuid';
import {
  addProductItem,
  evolve,
  evolveWithMetadata,
  initialState,
  type AddProductItem,
  type PricedProductItem,
  type ShoppingCart,
  type ShoppingCartEvent,
} from './shoppingCart.domain';

type TestOptions = {
  getInitialIndex: () => bigint;
  teardownHook?: () => Promise<void>;
};

export type EventStoreFactory = () => Promise<EventStore>;

export async function testAggregateStream(
  eventStoreFactory: EventStoreFactory,
  options: TestOptions = {
    getInitialIndex: () => 1n,
  },
) {
  return describe('aggregateStream', async () => {
    let eventStore: EventStore;
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
          productId: 'p123',
          quantity: 10,
          price: 3,
        };
        const discount = 10;
        const shoppingCartId = uuid();

        await eventStore.appendToStream<ShoppingCartEvent>(shoppingCartId, [
          { type: 'ProductItemAdded', data: { productItem } },
        ]);
        await eventStore.appendToStream<ShoppingCartEvent>(shoppingCartId, [
          { type: 'ProductItemAdded', data: { productItem } },
        ]);
        await eventStore.appendToStream<ShoppingCartEvent>(shoppingCartId, [
          {
            type: 'DiscountApplied',
            data: { percent: discount, couponId: uuid() },
          },
        ]);

        // when
        const resultAt1 = await eventStore.aggregateStream(shoppingCartId, {
          evolve: testCase.evolve,
          initialState,
          read: { to: 1n },
        });
        const resultAt2 = await eventStore.aggregateStream(shoppingCartId, {
          evolve: testCase.evolve,
          initialState,
          read: { to: 2n },
        });
        const resultAt3 = await eventStore.aggregateStream(shoppingCartId, {
          evolve: testCase.evolve,
          initialState,
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

export async function testCommandHandling(
  eventStoreFactory: EventStoreFactory,
  options: TestOptions = {
    getInitialIndex: () => 1n,
  },
) {
  return describe('Command handling', async () => {
    let eventStore: EventStore;

    const handleCommand = CommandHandler<ShoppingCart, ShoppingCartEvent>({
      evolve,
      initialState,
    });

    before(async () => {
      eventStore = await eventStoreFactory();
    });

    after(async () => {
      const teardownHook = options.teardownHook;
      if (teardownHook) await teardownHook();
    });

    await it('Correctly handles no retries on version conflict when retry is disabled', async () => {
      const productItem: PricedProductItem = {
        productId: '123',
        quantity: 10,
        price: 3,
      };

      const shoppingCartId = randomUUID();
      const command: AddProductItem = {
        type: 'AddProductItem',
        data: { productItem },
      };

      // Create the stream
      await handleCommand(
        eventStore,
        shoppingCartId,
        (state) => addProductItem(command, state),
        { expectedStreamVersion: 'STREAM_DOES_NOT_EXIST' },
      );

      let tried = 0;

      const error = await assertThrowsAsync(
        async () => {
          await handleCommand(eventStore, shoppingCartId, () => {
            tried++;
            throw new ExpectedVersionConflictError(0, 1);
          });
        },
        (error) => error instanceof ExpectedVersionConflictError,
      );

      assertTrue(isExpectedVersionConflictError(error));

      assertEqual(1, tried);
    });
  });
}
