import {
  assertDeepEqual,
  assertEqual,
  assertFalse,
  assertOk,
  assertThrowsAsync,
  assertTrue,
  command,
  CommandHandler,
  event,
  ExpectedVersionConflictError,
  isExpectedVersionConflictError,
  NO_CONCURRENCY_CHECK,
  STREAM_DOES_NOT_EXIST,
  reactor,
  STREAM_EXISTS,
  type Event,
  type EventStore,
  type ExpectedStreamVersion,
  type RecordedMessage,
} from '@event-driven-io/emmett';
import { randomUUID } from 'crypto';
import { v4 as uuid } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addProductItem,
  evolve,
  evolveWithMetadata,
  initialState,
  type AddProductItem,
  type AddProductItemV2,
  type PricedProductItem,
  type ProductItemAdded,
  type ProductItemAddedV2,
  type ProductItemAddedV2WithTenant,
  type ProductItemAddedV3,
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

type SchemaVersionTestOptions = TestOptions & {
  storeMetadata: Record<string, unknown>;
};

const schemaVersionTestDefaults: SchemaVersionTestOptions = {
  getInitialIndex: () => 1n,
  storeMetadata: {},
};

const recordedMetadataMatcher =
  (options: SchemaVersionTestOptions) =>
  (
    streamName: string,
    offset: bigint,
    userMetadata: Record<string, unknown> = {},
  ) => ({
    ...userMetadata,
    streamName,
    streamPosition: options.getInitialIndex() + offset,
    messageId: expect.any(String) as unknown,
    ...options.storeMetadata,
  });

export function testSchemaVersion(
  eventStoreFactory: EventStoreFactory,
  options: SchemaVersionTestOptions = schemaVersionTestDefaults,
) {
  describe('Schema version', () => {
    let eventStore: EventStore;
    const recordedMetadata = recordedMetadataMatcher(options);

    beforeAll(async () => {
      eventStore = await eventStoreFactory();
    });

    afterAll(async () => {
      const teardownHook = options.teardownHook;
      if (teardownHook) await teardownHook();
    });

    const productItem: PricedProductItem = {
      productId: '123',
      quantity: 10,
      price: 3,
    };

    const productItemAddedV1 = event<ProductItemAdded>('ProductItemAdded', {
      productItem,
    });

    const productItemAddedV2 = event<ProductItemAddedV2>(
      'ProductItemAdded',
      { productItem, currency: 'USD' },
      2,
    );

    it('Records the schema version of an appended event', async () => {
      const streamName = randomUUID();

      await eventStore.appendToStream(streamName, [productItemAddedV2]);

      const { events } = await eventStore.readStream(streamName);
      expect(events).toEqual([
        {
          type: 'ProductItemAdded',
          data: { productItem, currency: 'USD' },
          kind: 'Event',
          schemaVersion: 2,
          metadata: recordedMetadata(streamName, 0n),
        },
      ]);
    });

    it('Records the own schema version of each event appended in one call', async () => {
      const streamName = randomUUID();
      const productItemAddedV3 = event<ProductItemAddedV3>(
        'ProductItemAdded',
        { productItem, currency: 'USD', addedBy: 'john' },
        3,
      );

      await eventStore.appendToStream<
        ProductItemAdded | ProductItemAddedV2 | ProductItemAddedV3
      >(streamName, [
        productItemAddedV1,
        productItemAddedV2,
        productItemAddedV3,
      ]);

      const { events } = await eventStore.readStream(streamName);
      expect(events).toEqual([
        {
          type: 'ProductItemAdded',
          data: { productItem },
          kind: 'Event',
          schemaVersion: 1,
          metadata: recordedMetadata(streamName, 0n),
        },
        {
          type: 'ProductItemAdded',
          data: { productItem, currency: 'USD' },
          kind: 'Event',
          schemaVersion: 2,
          metadata: recordedMetadata(streamName, 1n),
        },
        {
          type: 'ProductItemAdded',
          data: { productItem, currency: 'USD', addedBy: 'john' },
          kind: 'Event',
          schemaVersion: 3,
          metadata: recordedMetadata(streamName, 2n),
        },
      ]);
    });

    it('Records version 1 for an event appended without a schema version', async () => {
      const streamName = randomUUID();

      await eventStore.appendToStream(streamName, [productItemAddedV1]);

      const { events } = await eventStore.readStream(streamName);
      expect(events).toEqual([
        {
          type: 'ProductItemAdded',
          data: { productItem },
          kind: 'Event',
          schemaVersion: 1,
          metadata: recordedMetadata(streamName, 0n),
        },
      ]);
    });

    const withMetadataSchemaVersion = (
      metadataSchemaVersion: string,
      schemaVersion?: number,
    ): Event<
      'ProductItemAdded',
      { productItem: PricedProductItem },
      { schemaVersion: string },
      number
    > => ({
      type: 'ProductItemAdded',
      data: { productItem },
      metadata: { schemaVersion: metadataSchemaVersion },
      ...(schemaVersion === undefined ? {} : { schemaVersion }),
    });

    for (const {
      criterion,
      metadataSchemaVersion,
      schemaVersion,
      recorded,
    } of [
      {
        criterion:
          'Takes the metadata version when the top-level one is missing',
        metadataSchemaVersion: '2',
        schemaVersion: undefined,
        recorded: 2,
      },
      {
        criterion: 'Falls back to version 1 for a non-numeric metadata version',
        metadataSchemaVersion: 'v2',
        schemaVersion: undefined,
        recorded: 1,
      },
      {
        criterion: 'Keeps the top-level version over the metadata one',
        metadataSchemaVersion: '2',
        schemaVersion: 3,
        recorded: 3,
      },
    ]) {
      it(criterion, async () => {
        const streamName = randomUUID();

        await eventStore.appendToStream(streamName, [
          withMetadataSchemaVersion(metadataSchemaVersion, schemaVersion),
        ]);

        const { events } = await eventStore.readStream(streamName);
        expect(events).toEqual([
          {
            type: 'ProductItemAdded',
            data: { productItem },
            kind: 'Event',
            schemaVersion: recorded,
            metadata: recordedMetadata(streamName, 0n),
          },
        ]);
        expect(events[0]!.metadata).not.toHaveProperty('schemaVersion');
      });
    }

    it('Passes the recorded schema version to evolve when aggregating', async () => {
      const streamName = randomUUID();
      await eventStore.appendToStream(streamName, [productItemAddedV2]);

      const { state } = await eventStore.aggregateStream(streamName, {
        evolve: (
          evolved: RecordedMessage<ProductItemAddedV2>[],
          recorded: RecordedMessage<ProductItemAddedV2>,
        ) => [...evolved, recorded],
        initialState: (): RecordedMessage<ProductItemAddedV2>[] => [],
      });

      expect(state).toEqual([
        {
          type: 'ProductItemAdded',
          data: { productItem, currency: 'USD' },
          kind: 'Event',
          schemaVersion: 2,
          metadata: recordedMetadata(streamName, 0n),
        },
      ]);
    });

    it('Records the schema version of an appended command', async () => {
      const streamName = randomUUID();
      const addProductItem = command<AddProductItemV2>(
        'AddProductItem',
        { productItem, currency: 'USD' },
        2,
      );

      await eventStore.appendToStream(streamName, [
        addProductItem,
      ] as unknown as Event[]);

      const { events } = await eventStore.readStream(streamName);
      expect(events).toEqual([
        {
          type: 'AddProductItem',
          data: { productItem, currency: 'USD' },
          kind: 'Command',
          schemaVersion: 2,
          metadata: recordedMetadata(streamName, 0n),
        },
      ]);
    });

    it('Keeps user metadata and leaves schema version out of recorded metadata', async () => {
      const streamName = randomUUID();
      const withTenant = event<ProductItemAddedV2WithTenant>(
        'ProductItemAdded',
        { productItem, currency: 'USD' },
        { tenantId: 'acme' },
        2,
      );

      await eventStore.appendToStream(streamName, [withTenant]);

      const { events } = await eventStore.readStream(streamName);
      expect(events).toEqual([
        {
          type: 'ProductItemAdded',
          data: { productItem, currency: 'USD' },
          kind: 'Event',
          schemaVersion: 2,
          metadata: recordedMetadata(streamName, 0n, { tenantId: 'acme' }),
        },
      ]);
      expect(events[0]!.metadata).not.toHaveProperty('schemaVersion');
    });

    it('Appends an event with schema version 0 without validating it', async () => {
      const streamName = randomUUID();
      const versionZero = event<
        Event<
          'ProductItemAdded',
          { productItem: PricedProductItem },
          undefined,
          0
        >
      >('ProductItemAdded', { productItem }, 0);

      await eventStore.appendToStream(streamName, [versionZero]);

      const { events } = await eventStore.readStream(streamName);
      expect(events).toEqual([
        {
          type: 'ProductItemAdded',
          data: { productItem },
          kind: 'Event',
          schemaVersion: 0,
          metadata: recordedMetadata(streamName, 0n),
        },
      ]);
    });

    it('Appends an event with schema version -1 without validating it', async () => {
      const streamName = randomUUID();
      const versionMinusOne = event<
        Event<
          'ProductItemAdded',
          { productItem: PricedProductItem },
          undefined,
          -1
        >
      >('ProductItemAdded', { productItem }, -1);

      await eventStore.appendToStream(streamName, [versionMinusOne]);

      const { events } = await eventStore.readStream(streamName);
      expect(events).toEqual([
        {
          type: 'ProductItemAdded',
          data: { productItem },
          kind: 'Event',
          schemaVersion: 1,
          metadata: recordedMetadata(streamName, 0n),
        },
      ]);
    });

    it('Reads the schema version returned by the upcaster', async () => {
      const streamName = randomUUID();
      await eventStore.appendToStream(streamName, [productItemAddedV1]);

      const { events } = await eventStore.readStream<
        ProductItemAddedV2,
        ProductItemAdded
      >(streamName, {
        schema: {
          versioning: {
            upcast: (stored: ProductItemAdded) =>
              event<ProductItemAddedV2>(
                'ProductItemAdded',
                { productItem: stored.data.productItem, currency: 'USD' },
                2,
              ),
          },
        },
      });

      expect(events).toEqual([
        {
          type: 'ProductItemAdded',
          data: { productItem, currency: 'USD' },
          kind: 'Event',
          schemaVersion: 2,
          metadata: recordedMetadata(streamName, 0n),
        },
      ]);
    });

    it('Reads version 1 when the upcaster returns only type and data', async () => {
      const streamName = randomUUID();
      await eventStore.appendToStream(streamName, [productItemAddedV1]);

      const { events } = await eventStore.readStream<ProductItemAdded>(
        streamName,
        {
          schema: {
            versioning: {
              upcast: (stored: ProductItemAdded): ProductItemAdded => ({
                type: 'ProductItemAdded',
                data: {
                  productItem: {
                    ...stored.data.productItem,
                    price: stored.data.productItem.price * 100,
                  },
                },
              }),
            },
          },
        },
      );

      expect(events).toEqual([
        {
          type: 'ProductItemAdded',
          data: { productItem: { ...productItem, price: 300 } },
          kind: 'Event',
          schemaVersion: 1,
          metadata: recordedMetadata(streamName, 0n),
        },
      ]);
    });

    it('Keeps the recorded schema version when the upcaster returns the event unchanged', async () => {
      const streamName = randomUUID();
      await eventStore.appendToStream(streamName, [productItemAddedV2]);

      const { events } = await eventStore.readStream<ProductItemAddedV2>(
        streamName,
        {
          schema: {
            versioning: {
              upcast: (stored: ProductItemAddedV2) => stored,
            },
          },
        },
      );

      expect(events).toEqual([
        {
          type: 'ProductItemAdded',
          data: { productItem, currency: 'USD' },
          kind: 'Event',
          schemaVersion: 2,
          metadata: recordedMetadata(streamName, 0n),
        },
      ]);
    });

    it('Records the schema version returned by the downcaster', async () => {
      const streamName = randomUUID();

      await eventStore.appendToStream<ProductItemAddedV2, ProductItemAdded>(
        streamName,
        [productItemAddedV2],
        {
          schema: {
            versioning: {
              downcast: (current: ProductItemAddedV2): ProductItemAdded => ({
                type: 'ProductItemAdded',
                data: { productItem: current.data.productItem },
                schemaVersion: 1,
              }),
            },
          },
        },
      );

      const { events } = await eventStore.readStream(streamName);
      expect(events).toEqual([
        {
          type: 'ProductItemAdded',
          data: { productItem },
          kind: 'Event',
          schemaVersion: 1,
          metadata: recordedMetadata(streamName, 0n),
        },
      ]);
    });

    it('Records version 1 when the downcaster returns only type and data', async () => {
      const streamName = randomUUID();

      await eventStore.appendToStream<ProductItemAddedV2, ProductItemAdded>(
        streamName,
        [productItemAddedV2],
        {
          schema: {
            versioning: {
              downcast: (current: ProductItemAddedV2): ProductItemAdded => ({
                type: 'ProductItemAdded',
                data: { productItem: current.data.productItem },
              }),
            },
          },
        },
      );

      const { events } = await eventStore.readStream(streamName);
      expect(events).toEqual([
        {
          type: 'ProductItemAdded',
          data: { productItem },
          kind: 'Event',
          schemaVersion: 1,
          metadata: recordedMetadata(streamName, 0n),
        },
      ]);
    });

    it('Records the schema version of each result of a downcaster that returns either version', async () => {
      const streamName = randomUUID();
      const productItemAddedV2InEuro = event<ProductItemAddedV2>(
        'ProductItemAdded',
        { productItem, currency: 'EUR' },
        2,
      );

      await eventStore.appendToStream<
        ProductItemAddedV2,
        ProductItemAdded | ProductItemAddedV2
      >(streamName, [productItemAddedV2, productItemAddedV2InEuro], {
        schema: {
          versioning: {
            downcast: (
              current: ProductItemAddedV2,
            ): ProductItemAdded | ProductItemAddedV2 =>
              current.data.currency === 'USD'
                ? {
                    type: 'ProductItemAdded',
                    data: { productItem: current.data.productItem },
                  }
                : current,
          },
        },
      });

      const { events } = await eventStore.readStream(streamName);
      expect(events).toEqual([
        {
          type: 'ProductItemAdded',
          data: { productItem },
          kind: 'Event',
          schemaVersion: 1,
          metadata: recordedMetadata(streamName, 0n),
        },
        {
          type: 'ProductItemAdded',
          data: { productItem, currency: 'EUR' },
          kind: 'Event',
          schemaVersion: 2,
          metadata: recordedMetadata(streamName, 1n),
        },
      ]);
    });

    it('Records the schema version of an event returned by a command handler', async () => {
      const streamName = randomUUID();
      const handle = CommandHandler<ProductItemAddedV2[], ProductItemAddedV2>({
        evolve: (evolved, recorded) => [...evolved, recorded],
        initialState: () => [],
      });

      await handle(eventStore, streamName, () => productItemAddedV2);

      const { events } = await eventStore.readStream(streamName);
      expect(events).toEqual([
        {
          type: 'ProductItemAdded',
          data: { productItem, currency: 'USD' },
          kind: 'Event',
          schemaVersion: 2,
          metadata: recordedMetadata(streamName, 0n),
        },
      ]);
    });

    it('Evolves upcasted events with the schema version from the command handler upcaster', async () => {
      const streamName = randomUUID();
      await eventStore.appendToStream(streamName, [productItemAddedV1]);

      const handle = CommandHandler<
        ProductItemAddedV2[],
        ProductItemAddedV2,
        ProductItemAdded
      >({
        evolve: (evolved, recorded) => [...evolved, recorded],
        initialState: () => [],
        schema: {
          versioning: {
            upcast: (stored: ProductItemAdded) =>
              event<ProductItemAddedV2>(
                'ProductItemAdded',
                { productItem: stored.data.productItem, currency: 'USD' },
                2,
              ),
          },
        },
      });

      const { newState } = await handle(eventStore, streamName, () => []);

      expect(newState).toEqual([
        {
          type: 'ProductItemAdded',
          data: { productItem, currency: 'USD' },
          kind: 'Event',
          schemaVersion: 2,
          metadata: recordedMetadata(streamName, 0n),
        },
      ]);
    });
  });
}

export function testConsumerSchemaVersion(
  eventStoreFactory: EventStoreFactory,
  options: SchemaVersionTestOptions = schemaVersionTestDefaults,
) {
  describe('Consumer schema version', () => {
    let eventStore: EventStore;
    const recordedMetadata = recordedMetadataMatcher(options);

    beforeAll(async () => {
      eventStore = await eventStoreFactory();
    });

    afterAll(async () => {
      const teardownHook = options.teardownHook;
      if (teardownHook) await teardownHook();
    });

    const productItem: PricedProductItem = {
      productId: '123',
      quantity: 10,
      price: 3,
    };

    const consumeStream = async <MessageType extends Event>(
      streamName: string,
      messages: Event[],
      upcast?: (stored: Event) => MessageType,
    ): Promise<RecordedMessage<MessageType>[]> => {
      const consumer = eventStore.consumer?.<MessageType>();
      assertOk(consumer);
      const received: RecordedMessage<MessageType>[] = [];

      consumer.reactor(
        reactor<MessageType>({
          processorId: randomUUID(),
          checkpoints: 'DISABLED',
          eachMessage: (message) => {
            if (message.metadata.streamName === streamName)
              received.push(message);
          },
          ...(upcast
            ? { messageOptions: { schema: { versioning: { upcast } } } }
            : {}),
        }),
      );

      const consumerPromise = consumer.start();
      try {
        await consumer.whenStarted();
        await eventStore.appendToStream(streamName, messages);
        await consumer.whenCaughtUp();
      } finally {
        await consumer.close();
        await consumerPromise;
      }

      return received;
    };

    it('Delivers the recorded schema version to a consumer', async () => {
      const streamName = randomUUID();

      const received = await consumeStream<ProductItemAddedV2>(streamName, [
        event<ProductItemAddedV2>(
          'ProductItemAdded',
          { productItem, currency: 'USD' },
          2,
        ),
      ]);

      expect(received).toEqual([
        {
          type: 'ProductItemAdded',
          data: { productItem, currency: 'USD' },
          kind: 'Event',
          schemaVersion: 2,
          metadata: recordedMetadata(streamName, 0n),
        },
      ]);
    });

    it('Delivers the schema version returned by the consumer upcaster', async () => {
      const streamName = randomUUID();

      const received = await consumeStream<ProductItemAddedV2>(
        streamName,
        [event<ProductItemAdded>('ProductItemAdded', { productItem })],
        (stored) =>
          stored.type === 'ProductItemAdded' && stored.schemaVersion !== 2
            ? event<ProductItemAddedV2>(
                'ProductItemAdded',
                {
                  productItem: (stored as ProductItemAdded).data.productItem,
                  currency: 'USD',
                },
                2,
              )
            : (stored as ProductItemAddedV2),
      );

      expect(received).toEqual([
        {
          type: 'ProductItemAdded',
          data: { productItem, currency: 'USD' },
          kind: 'Event',
          schemaVersion: 2,
          metadata: recordedMetadata(streamName, 0n),
        },
      ]);
    });
  });
}
