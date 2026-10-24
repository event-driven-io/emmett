import {
  assertDeepEqual,
  assertEqual,
  assertFalse,
  assertOk,
  assertThrowsAsync,
  assertTrue,
  CommandHandler,
  ExpectedVersionConflictError,
  isExpectedVersionConflictError,
  NO_CONCURRENCY_CHECK,
  STREAM_DOES_NOT_EXIST,
  STREAM_EXISTS,
  type EventStore,
  type ExpectedStreamVersion,
} from '@event-driven-io/emmett';
import { randomUUID } from 'crypto';
import { v4 as uuid } from 'uuid';
import { afterAll, beforeAll, describe, it } from 'vitest';
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

export function testAggregateStream(
  eventStoreFactory: EventStoreFactory,
  options: TestOptions = {
    getInitialIndex: () => 1n,
  },
) {
  describe('aggregateStream', () => {
    let eventStore: EventStore;
    const evolveTestCases = [
      {
        evolve,
        info: 'evolve with raw event',
      },
      { evolve: evolveWithMetadata, info: 'evolve with event and metadata' },
    ];

    beforeAll(async () => {
      eventStore = await eventStoreFactory();
    });

    afterAll(async () => {
      const teardownHook = options.teardownHook;
      if (teardownHook) await teardownHook();
    });

    for (const testCase of evolveTestCases) {
      it(`When called with 'to' allows time traveling using ${testCase.info}`, async () => {
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

export function testCommandHandling(
  eventStoreFactory: EventStoreFactory,
  options: TestOptions = {
    getInitialIndex: () => 1n,
  },
) {
  describe('Command handling', () => {
    let eventStore: EventStore;

    const handleCommand = CommandHandler<ShoppingCart, ShoppingCartEvent>({
      evolve,
      initialState,
    });

    beforeAll(async () => {
      eventStore = await eventStoreFactory();
    });

    afterAll(async () => {
      const teardownHook = options.teardownHook;
      if (teardownHook) await teardownHook();
    });

    it('Rejects a command when another writer creates the stream after its state was read', async () => {
      const streamName = randomUUID();
      const event: ShoppingCartEvent = {
        type: 'ProductItemAdded',
        data: {
          productItem: { productId: '123', quantity: 1, price: 3 },
        },
      };

      await assertThrowsAsync(
        () =>
          handleCommand(eventStore, streamName, async () => {
            await eventStore.appendToStream(streamName, [event]);
            return [event];
          }),
        isExpectedVersionConflictError,
      );

      const result = await eventStore.readStream(streamName);
      assertEqual(1, result.events.length);
    });

    it('Correctly handles no retries on version conflict when retry is disabled', async () => {
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
            throw new ExpectedVersionConflictError(0n, 1n);
          });
        },
        (error) => error instanceof ExpectedVersionConflictError,
      );

      assertTrue(isExpectedVersionConflictError(error));

      assertEqual(1, tried);
    });
  });
}

export function testAppendToStream(
  eventStoreFactory: EventStoreFactory,
  options?: { teardownHook?: () => Promise<void> },
) {
  describe('appendToStream', () => {
    let eventStore: EventStore;
    beforeAll(async () => {
      eventStore = await eventStoreFactory();
    });

    afterAll(async () => {
      const teardownHook = options?.teardownHook;
      if (teardownHook) await teardownHook();
    });

    const productItem: PricedProductItem = {
      productId: '123',
      quantity: 10,
      price: 3,
    };

    const expectations: {
      whenMissing: string;
      whenExisting: string;
      version: (current: bigint) => ExpectedStreamVersion | undefined;
      acceptsMissing: boolean;
      acceptsExisting: boolean;
    }[] = [
      {
        whenMissing: 'Creates a stream when STREAM_DOES_NOT_EXIST is specified',
        whenExisting:
          'Rejects appending to an existing stream when STREAM_DOES_NOT_EXIST is specified',
        version: () => STREAM_DOES_NOT_EXIST,
        acceptsMissing: true,
        acceptsExisting: false,
      },
      {
        whenMissing:
          'Rejects creating a stream when STREAM_EXISTS is specified',
        whenExisting:
          'Appends to an existing stream when STREAM_EXISTS is specified',
        version: () => STREAM_EXISTS,
        acceptsMissing: false,
        acceptsExisting: true,
      },
      {
        whenMissing: 'Creates a stream when concurrency checks are disabled',
        whenExisting:
          'Appends to an existing stream when concurrency checks are disabled',
        version: () => NO_CONCURRENCY_CHECK,
        acceptsMissing: true,
        acceptsExisting: true,
      },
      {
        whenMissing: 'Creates a stream when no expected version is provided',
        whenExisting:
          'Appends to an existing stream when no expected version is provided',
        version: () => undefined,
        acceptsMissing: true,
        acceptsExisting: true,
      },
      {
        whenMissing:
          'Creates a stream when the expected version matches an empty stream',
        whenExisting:
          'Appends events when the expected version matches the current stream version',
        version: (current) => current,
        acceptsMissing: true,
        acceptsExisting: true,
      },
      {
        whenMissing:
          'Rejects creating a stream when the expected version does not match an empty stream',
        whenExisting:
          'Rejects appending events when the expected version differs from the current stream version',
        version: (current) => current + 1n,
        acceptsMissing: false,
        acceptsExisting: false,
      },
    ];

    describe.each([
      { streamState: 'missing', exists: false },
      { streamState: 'existing', exists: true },
    ])('$streamState stream', ({ exists }) => {
      for (const expectation of expectations) {
        it(
          exists ? expectation.whenExisting : expectation.whenMissing,
          async () => {
            const streamName = randomUUID();
            const event: ShoppingCartEvent = {
              type: 'ProductItemAdded',
              data: { productItem },
            };

            if (exists) await eventStore.appendToStream(streamName, [event]);

            const before = await eventStore.readStream(streamName);
            const append = () =>
              eventStore.appendToStream(streamName, [event, event], {
                expectedStreamVersion: expectation.version(
                  before.currentStreamVersion,
                ),
              });
            const accepts = exists
              ? expectation.acceptsExisting
              : expectation.acceptsMissing;

            if (!accepts) {
              await assertThrowsAsync(append, isExpectedVersionConflictError);

              const after = await eventStore.readStream(streamName);
              assertEqual(before.streamExists, after.streamExists);
              assertEqual(
                before.currentStreamVersion,
                after.currentStreamVersion,
              );
              assertDeepEqual(after.events, before.events);
              return;
            }

            const result = await append();
            const after = await eventStore.readStream(streamName);

            assertEqual(!exists, result.createdNewStream);
            assertEqual(
              before.currentStreamVersion + 2n,
              result.nextExpectedStreamVersion,
            );
            assertEqual(
              result.nextExpectedStreamVersion,
              after.currentStreamVersion,
            );
            assertEqual(before.events.length + 2, after.events.length);
            assertDeepEqual(
              after.events
                .slice(-2)
                .map((message) => message.metadata.streamPosition),
              [
                before.currentStreamVersion + 1n,
                before.currentStreamVersion + 2n,
              ],
            );
          },
        );
      }
    });

    it('Returns createdNewStream true when the append creates the stream', async () => {
      const shoppingCartId = randomUUID();

      const result = await eventStore.appendToStream<ShoppingCartEvent>(
        shoppingCartId,
        [{ type: 'ProductItemAdded', data: { productItem } }],
      );

      assertTrue(result.createdNewStream);
    });

    it('Returns createdNewStream false when appending to an existing stream', async () => {
      const shoppingCartId = randomUUID();

      await eventStore.appendToStream<ShoppingCartEvent>(shoppingCartId, [
        { type: 'ProductItemAdded', data: { productItem } },
      ]);

      const result = await eventStore.appendToStream<ShoppingCartEvent>(
        shoppingCartId,
        [{ type: 'ProductItemAdded', data: { productItem } }],
      );

      assertFalse(result.createdNewStream);
    });
  });
}

export function testStreamExists(
  eventStoreFactory: EventStoreFactory,
  options?: { teardownHook?: () => Promise<void> },
) {
  describe('streamExists', () => {
    let eventStore: EventStore;
    beforeAll(async () => {
      eventStore = await eventStoreFactory();
    });

    afterAll(async () => {
      const teardownHook = options?.teardownHook;
      if (teardownHook) await teardownHook();
    });

    it('Returns true when stream exists and is the only stream', async () => {
      const productItem: PricedProductItem = {
        productId: '123',
        quantity: 10,
        price: 3,
      };

      const shoppingCartId = randomUUID();

      await eventStore.appendToStream<ShoppingCartEvent>(shoppingCartId, [
        { type: 'ProductItemAdded', data: { productItem } },
      ]);

      assertTrue(await eventStore.streamExists(shoppingCartId));
    });

    it('Returns false when does not stream exist and there are no other streams', async () => {
      const shoppingCartId = randomUUID();

      assertFalse(await eventStore.streamExists(shoppingCartId));
    });

    it('Returns true when stream exists and there are other streams', async () => {
      const productItemA: PricedProductItem = {
        productId: '123',
        quantity: 10,
        price: 3,
      };
      const productItemB: PricedProductItem = {
        productId: '321',
        quantity: 20,
        price: 6,
      };

      const shoppingCartIdA = randomUUID();
      const shoppingCartIdB = randomUUID();

      await eventStore.appendToStream<ShoppingCartEvent>(shoppingCartIdA, [
        { type: 'ProductItemAdded', data: { productItem: productItemA } },
      ]);
      await eventStore.appendToStream<ShoppingCartEvent>(shoppingCartIdB, [
        { type: 'ProductItemAdded', data: { productItem: productItemB } },
      ]);

      assertTrue(await eventStore.streamExists(shoppingCartIdA));
      assertTrue(await eventStore.streamExists(shoppingCartIdB));
    });

    it('Returns false when stream does not exist but there are other streams', async () => {
      const existingProductItem: PricedProductItem = {
        productId: '123',
        quantity: 10,
        price: 3,
      };

      const existingShoppingCartId = randomUUID();

      await eventStore.appendToStream<ShoppingCartEvent>(
        existingShoppingCartId,
        [
          {
            type: 'ProductItemAdded',
            data: { productItem: existingProductItem },
          },
        ],
      );

      const nonExistingShoppingCartId = randomUUID();

      assertFalse(await eventStore.streamExists(nonExistingShoppingCartId));
      assertTrue(await eventStore.streamExists(existingShoppingCartId));
    });
  });
}
