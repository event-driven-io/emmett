import {
  assertDeepEqual,
  assertEqual,
  assertFalse,
  assertOk,
  assertThrowsAsync,
  assertTrue,
  CommandHandler,
  EmmettError,
  ExpectedVersionConflictError,
  isExpectedVersionConflictError,
  type EventStore,
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
          read: { to: options.getInitialIndex() },
        });
        const resultAt2 = await eventStore.aggregateStream(shoppingCartId, {
          evolve: testCase.evolve,
          initialState,
          read: { to: options.getInitialIndex() + 1n },
        });
        const resultAt3 = await eventStore.aggregateStream(shoppingCartId, {
          evolve: testCase.evolve,
          initialState,
          read: { to: options.getInitialIndex() + 2n },
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

/**
 * Forward reads: `from` and `to` are inclusive stream positions, `maxCount` limits
 * the number of messages, and the result reports the whole stream's version and
 * existence even when the requested range is empty.
 */
export function testReadStreamRanges(
  eventStoreFactory: EventStoreFactory,
  options: TestOptions = {
    getInitialIndex: () => 1n,
  },
) {
  describe('readStream ranges', () => {
    let eventStore: EventStore;
    let streamName: string;
    const position = (index: number) =>
      options.getInitialIndex() + BigInt(index);
    const lastPosition = () => position(9);

    beforeAll(async () => {
      eventStore = await eventStoreFactory();
      streamName = `shopping_cart-${randomUUID()}`;
      await eventStore.appendToStream(
        streamName,
        Array.from({ length: 10 }, (_, index) => ({
          type: 'ProductItemAdded',
          data: { index },
        })),
      );
    });

    afterAll(async () => {
      const teardownHook = options?.teardownHook;
      if (teardownHook) await teardownHook();
    });

    const read = async (range: {
      from?: bigint;
      to?: bigint;
      maxCount?: bigint;
    }) => {
      const result = await eventStore.readStream(streamName, range);

      return {
        positions: result.events.map((e) => e.metadata.streamPosition),
        currentStreamVersion: result.currentStreamVersion,
        streamExists: result.streamExists,
      };
    };

    const positions = (fromIndex: number, toIndex: number) =>
      Array.from({ length: toIndex - fromIndex + 1 }, (_, i) =>
        position(fromIndex + i),
      );

    it('reads the whole stream without a range', async () => {
      assertDeepEqual(await read({}), {
        positions: positions(0, 9),
        currentStreamVersion: lastPosition(),
        streamExists: true,
      });
    });

    it('reads from an inclusive position', async () => {
      assertDeepEqual(
        (await read({ from: position(3) })).positions,
        positions(3, 9),
      );
    });

    it('reads up to an inclusive position', async () => {
      assertDeepEqual(
        (await read({ to: position(5) })).positions,
        positions(0, 5),
      );
    });

    it('reads an inclusive range', async () => {
      assertDeepEqual(
        (await read({ from: position(2), to: position(6) })).positions,
        positions(2, 6),
      );
    });

    it('reads at most maxCount messages', async () => {
      assertDeepEqual(
        (await read({ maxCount: 3n })).positions,
        positions(0, 2),
      );
      assertDeepEqual(
        (await read({ from: position(2), maxCount: 3n })).positions,
        positions(2, 4),
      );
    });

    it('applies maxCount within the range', async () => {
      assertDeepEqual(
        (await read({ from: position(2), to: position(8), maxCount: 3n }))
          .positions,
        positions(2, 4),
      );
    });

    it('reports the stream version and existence for a partial range', async () => {
      assertDeepEqual(await read({ from: position(2), maxCount: 2n }), {
        positions: positions(2, 3),
        currentStreamVersion: lastPosition(),
        streamExists: true,
      });
    });

    it('reports the stream version and existence for a range past the end', async () => {
      assertDeepEqual(await read({ from: position(20) }), {
        positions: [],
        currentStreamVersion: lastPosition(),
        streamExists: true,
      });
    });

    it('reports a missing stream', async () => {
      const result = await eventStore.readStream(
        `shopping_cart-${randomUUID()}`,
        { from: position(2), maxCount: 2n },
      );

      assertDeepEqual(result.events, []);
      assertFalse(result.streamExists);
    });
  });
}

/**
 * Stream listing for stores providing `listStreams`.
 * Streams get a unique prefix, so the tests can share a database.
 */
export function testListStreams(
  eventStoreFactory: EventStoreFactory,
  options?: { teardownHook?: () => Promise<void> },
) {
  describe('listStreams', () => {
    let eventStore: EventStore;
    let prefix: string;

    beforeAll(async () => {
      eventStore = await eventStoreFactory();
      prefix = `list_${randomUUID().replaceAll('-', '')}`;

      for (const [suffix, count] of [
        ['c', 1],
        ['a', 2],
        ['b', 3],
      ] as const)
        await eventStore.appendToStream(
          `${prefix}-${suffix}`,
          Array.from({ length: count }, (_, index) => ({
            type: 'ProductItemAdded',
            data: { index },
          })),
        );
    });

    afterAll(async () => {
      const teardownHook = options?.teardownHook;
      if (teardownHook) await teardownHook();
    });

    it('lists streams matching the search, ordered by name, with their versions', async () => {
      const result = await eventStore.listStreams!({ limit: 10, q: prefix });

      assertDeepEqual(
        result.streams.map((s) => s.streamName),
        [`${prefix}-a`, `${prefix}-b`, `${prefix}-c`],
      );
      assertDeepEqual(
        result.streams.map(
          (s) =>
            s.currentStreamVersion - result.streams[2]!.currentStreamVersion,
        ),
        [1n, 2n, 0n],
      );
      assertEqual(result.nextCursor, undefined);
    });

    it('pages with an opaque cursor', async () => {
      const names: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await eventStore.listStreams!({
          limit: 2,
          q: prefix,
          ...(cursor ? { cursor } : {}),
        });
        names.push(...page.streams.map((s) => s.streamName));
        cursor = page.nextCursor;
      } while (cursor);

      assertDeepEqual(names, [`${prefix}-a`, `${prefix}-b`, `${prefix}-c`]);
    });

    it('rejects a malformed cursor', async () => {
      await assertThrowsAsync(
        () => eventStore.listStreams!({ limit: 1, cursor: '%%%' }),
        (error) =>
          EmmettError.isInstanceOf(error, EmmettError.Codes.ValidationError),
      );
    });
  });
}
