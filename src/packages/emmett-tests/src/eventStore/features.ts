import {
  assertDeepEqual,
  assertEqual,
  assertFalse,
  assertOk,
  assertThrowsAsync,
  assertTrue,
  collectingMeter,
  collectingTracer,
  CommandHandler,
  EmmettAttributes,
  EmmettMetrics,
  ExpectedVersionConflictError,
  isExpectedVersionConflictError,
  MessagingAttributes,
  MessagingSystemName,
  STREAM_DOES_NOT_EXIST,
  type EventStore,
  type EventStoreObservabilityConfig,
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

export type EventStoreObservabilityFactory = (
  observability: EventStoreObservabilityConfig,
) => Promise<EventStore>;

export function testEventStoreObservability(
  eventStoreFactory: EventStoreObservabilityFactory,
  options?: { teardownHook?: () => Promise<void> },
) {
  const A = EmmettAttributes;
  const M = MessagingAttributes;

  describe('observability', () => {
    afterAll(async () => {
      if (options?.teardownHook) await options.teardownHook();
    });

    it('records all readStream span attributes for a non-existent stream', async () => {
      const tracer = collectingTracer();
      const meter = collectingMeter();
      const eventStore = await eventStoreFactory({ tracer, meter });
      const streamName = randomUUID();

      await eventStore.readStream(streamName);

      const span = tracer.spans.find((s) => s.name === 'eventStore.readStream');
      assertOk(span, 'expected eventStore.readStream span');
      assertEqual(span.attributes[A.eventStore.operation], 'readStream');
      assertEqual(span.attributes[A.stream.name], streamName);
      assertEqual(span.attributes[A.eventStore.read.status], 'success');
      assertEqual(span.attributes[A.eventStore.read.eventCount], 0);
      assertDeepEqual(span.attributes[A.eventStore.read.eventTypes], []);
      assertEqual(span.attributes[M.operationType], 'receive');
      assertEqual(span.attributes[M.destinationName], streamName);
      assertEqual(span.attributes[M.system], MessagingSystemName);
    });

    it('records readStream span event types after appending mixed events', async () => {
      const tracer = collectingTracer();
      const meter = collectingMeter();
      const eventStore = await eventStoreFactory({ tracer, meter });
      const streamName = randomUUID();
      const productItem: PricedProductItem = {
        productId: 'p1',
        quantity: 1,
        price: 5,
      };

      await eventStore.appendToStream<ShoppingCartEvent>(streamName, [
        { type: 'ProductItemAdded', data: { productItem } },
        {
          type: 'DiscountApplied',
          data: { percent: 10, couponId: randomUUID() },
        },
        { type: 'ProductItemAdded', data: { productItem } },
      ]);

      await eventStore.readStream(streamName);

      const readSpans = tracer.spans.filter(
        (s) => s.name === 'eventStore.readStream',
      );
      const lastReadSpan = readSpans[readSpans.length - 1];
      assertOk(lastReadSpan);
      assertEqual(lastReadSpan.attributes[A.eventStore.read.eventCount], 3);
      assertDeepEqual(
        (lastReadSpan.attributes[A.eventStore.read.eventTypes] as string[])
          .slice()
          .sort(),
        ['DiscountApplied', 'ProductItemAdded'],
      );
    });

    it('records readStream metrics with correct status attributes', async () => {
      const tracer = collectingTracer();
      const meter = collectingMeter();
      const eventStore = await eventStoreFactory({ tracer, meter });
      const streamName = randomUUID();
      const productItem: PricedProductItem = {
        productId: 'p1',
        quantity: 1,
        price: 5,
      };

      await eventStore.appendToStream<ShoppingCartEvent>(streamName, [
        { type: 'ProductItemAdded', data: { productItem } },
        { type: 'ProductItemAdded', data: { productItem } },
        { type: 'ProductItemAdded', data: { productItem } },
      ]);

      await eventStore.readStream(streamName);

      const durationH = meter.histograms.find(
        (h) => h.name === EmmettMetrics.stream.readingDuration,
      );
      assertOk(durationH, 'expected stream.reading.duration histogram');
      assertTrue(durationH.value >= 0);
      assertEqual(
        (durationH.attributes as Record<string, unknown>)[
          A.eventStore.read.status
        ],
        'success',
      );

      const sizeH = meter.histograms.find(
        (h) => h.name === EmmettMetrics.stream.readingSize,
      );
      assertOk(sizeH, 'expected stream.reading.size histogram');
      assertEqual(sizeH.value, 3);
      assertEqual(
        (sizeH.attributes as Record<string, unknown>)[A.eventStore.read.status],
        'success',
      );

      const readCounters = meter.counters.filter(
        (c) => c.name === EmmettMetrics.event.readingCount,
      );
      assertEqual(readCounters.length, 3);
      assertTrue(
        readCounters.every(
          (c) =>
            (c.attributes as Record<string, unknown>)[A.event.type] ===
            'ProductItemAdded',
        ),
      );
    });

    it('records all appendToStream span attributes', async () => {
      const tracer = collectingTracer();
      const meter = collectingMeter();
      const eventStore = await eventStoreFactory({ tracer, meter });
      const streamName = randomUUID();
      const productItem: PricedProductItem = {
        productId: 'p1',
        quantity: 2,
        price: 10,
      };

      await eventStore.appendToStream<ShoppingCartEvent>(
        streamName,
        [
          { type: 'ProductItemAdded', data: { productItem } },
          { type: 'ProductItemAdded', data: { productItem } },
        ],
        { expectedStreamVersion: STREAM_DOES_NOT_EXIST },
      );

      const span = tracer.spans.find(
        (s) => s.name === 'eventStore.appendToStream',
      );
      assertOk(span, 'expected eventStore.appendToStream span');
      assertEqual(span.attributes[A.eventStore.operation], 'appendToStream');
      assertEqual(span.attributes[A.stream.name], streamName);
      assertEqual(span.attributes[A.eventStore.append.batchSize], 2);
      assertEqual(span.attributes[A.eventStore.append.status], 'success');
      assertEqual(span.attributes[M.operationType], 'send');
      assertEqual(span.attributes[M.batchMessageCount], 2);
      assertEqual(span.attributes[M.destinationName], streamName);
      assertEqual(span.attributes[M.system], MessagingSystemName);
      assertOk(
        span.attributes[A.stream.versionAfter] !== undefined,
        'expected versionAfter to be set',
      );
    });

    it('records appendToStream metrics with correct status and event type attributes', async () => {
      const tracer = collectingTracer();
      const meter = collectingMeter();
      const eventStore = await eventStoreFactory({ tracer, meter });
      const streamName = randomUUID();
      const productItem: PricedProductItem = {
        productId: 'p1',
        quantity: 1,
        price: 5,
      };

      await eventStore.appendToStream<ShoppingCartEvent>(streamName, [
        { type: 'ProductItemAdded', data: { productItem } },
        {
          type: 'DiscountApplied',
          data: { percent: 10, couponId: randomUUID() },
        },
      ]);

      const durationH = meter.histograms.find(
        (h) => h.name === EmmettMetrics.stream.appendingDuration,
      );
      assertOk(durationH, 'expected stream.appending.duration histogram');
      assertTrue(durationH.value >= 0);
      assertEqual(
        (durationH.attributes as Record<string, unknown>)[
          A.eventStore.append.status
        ],
        'success',
      );

      const sizeH = meter.histograms.find(
        (h) => h.name === EmmettMetrics.stream.appendingSize,
      );
      assertOk(sizeH, 'expected stream.appending.size histogram');
      assertEqual(sizeH.value, 2);
      assertEqual(
        (sizeH.attributes as Record<string, unknown>)[
          A.eventStore.append.status
        ],
        'success',
      );

      const appendCounters = meter.counters.filter(
        (c) => c.name === EmmettMetrics.event.appendingCount,
      );
      assertEqual(appendCounters.length, 2);
      const counterTypes = appendCounters.map(
        (c) =>
          (c.attributes as Record<string, unknown>)[A.event.type] as string,
      );
      assertDeepEqual(counterTypes.sort(), [
        'DiscountApplied',
        'ProductItemAdded',
      ]);
    });

    it('records failure status on appendToStream span on version conflict', async () => {
      const tracer = collectingTracer();
      const meter = collectingMeter();
      const eventStore = await eventStoreFactory({ tracer, meter });
      const streamName = randomUUID();
      const productItem: PricedProductItem = {
        productId: 'p1',
        quantity: 1,
        price: 5,
      };

      await eventStore.appendToStream<ShoppingCartEvent>(streamName, [
        { type: 'ProductItemAdded', data: { productItem } },
      ]);

      await assertThrowsAsync(
        () =>
          eventStore.appendToStream<ShoppingCartEvent>(
            streamName,
            [{ type: 'ProductItemAdded', data: { productItem } }],
            { expectedStreamVersion: STREAM_DOES_NOT_EXIST },
          ),
        (err) => isExpectedVersionConflictError(err),
      );

      const appendSpans = tracer.spans.filter(
        (s) => s.name === 'eventStore.appendToStream',
      );
      const failedSpan = appendSpans[appendSpans.length - 1];
      assertOk(failedSpan, 'expected appendToStream span for failed append');
      assertEqual(failedSpan.attributes[A.eventStore.append.status], 'failure');

      const durationH = meter.histograms.find(
        (h) =>
          h.name === EmmettMetrics.stream.appendingDuration &&
          (h.attributes as Record<string, unknown>)[
            A.eventStore.append.status
          ] === 'failure',
      );
      assertOk(durationH, 'expected appendingDuration histogram for failure');
    });
  });
}
