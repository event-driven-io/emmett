import {
  MessagingAttributes,
  ObservabilitySpec,
} from '@event-driven-io/almanac';
import {
  assertDeepEqual,
  assertEqual,
  assertIsNotNull,
  assertTrue,
  EmmettAttributes,
  MessagingSystemName,
  projections,
  STREAM_DOES_NOT_EXIST,
  type Event,
} from '@event-driven-io/emmett';
import { getMongoDBStartedContainer } from '@event-driven-io/emmett-testcontainers';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import { MongoClient, type Collection } from 'mongodb';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { v4 as uuid } from 'uuid';
import type { PricedProductItem, ShoppingCartEvent } from '../testing';
import {
  getMongoDBEventStore,
  toStreamCollectionName,
  toStreamName,
  type EventStream,
  type MongoDBEventStore,
} from './';

void describe('MongoDBEventStore', () => {
  const M = MessagingAttributes;
  const given = ObservabilitySpec.for();
  let mongodb: StartedMongoDBContainer;
  let eventStore: MongoDBEventStore;
  let client: MongoClient;
  let collection: Collection<EventStream>;

  beforeAll(async () => {
    mongodb = await getMongoDBStartedContainer();
    client = new MongoClient(mongodb.getConnectionString(), {
      directConnection: true,
    });

    await client.connect();
    const db = client.db();
    collection = db.collection<EventStream>(
      toStreamCollectionName('shopping_cart'),
    );

    eventStore = getMongoDBEventStore({
      client,
    });
    return eventStore;
  });

  afterAll(async () => {
    try {
      await client.close();
      await mongodb.stop();
    } catch (error) {
      console.log(error);
    }
  });

  void it('should create a new stream with metadata with appendToStream', async () => {
    const productItem: PricedProductItem = {
      productId: '123',
      quantity: 10,
      price: 3,
    };
    const shoppingCartId = uuid();
    const streamType = 'shopping_cart';
    const streamName = toStreamName(streamType, shoppingCartId);

    await eventStore.appendToStream<ShoppingCartEvent>(
      streamName,
      [{ type: 'ProductItemAdded', data: { productItem } }],
      { expectedStreamVersion: STREAM_DOES_NOT_EXIST },
    );

    const stream = await collection.findOne(
      { streamName },
      { useBigInt64: true },
    );
    assertIsNotNull(stream);
    assertEqual(1n, stream.metadata.streamPosition);
    assertEqual(shoppingCartId, stream.metadata.streamId);
    assertEqual(streamType, stream.metadata.streamType);
    assertTrue(stream.metadata.createdAt instanceof Date);
    assertTrue(stream.metadata.updatedAt instanceof Date);
  });

  void it('should append events correctly using appendEvent function', async () => {
    const productItem: PricedProductItem = {
      productId: '123',
      quantity: 10,
      price: 3,
    };
    const discount = 10;
    const shoppingCartId = uuid();
    const streamType = 'shopping_cart';
    const streamName = toStreamName(streamType, shoppingCartId);

    await eventStore.appendToStream<ShoppingCartEvent>(
      streamName,
      [
        { type: 'ProductItemAdded', data: { productItem } },
        { type: 'ProductItemAdded', data: { productItem } },
        {
          type: 'DiscountApplied',
          data: { percent: discount, couponId: uuid() },
        },
      ],
      { expectedStreamVersion: STREAM_DOES_NOT_EXIST },
    );

    const stream = await collection.findOne(
      { streamName },
      { useBigInt64: true },
    );
    assertIsNotNull(stream);
    assertEqual(3n, stream.metadata.streamPosition);
  });

  void it('should record observability while appending', async () => {
    const streamType = 'shopping_cart';
    const shoppingCartId = uuid();
    const streamName = toStreamName(streamType, shoppingCartId);
    const productItem: PricedProductItem = {
      productId: '123',
      quantity: 10,
      price: 3,
    };

    await given((observability) => ({
      eventStore: getMongoDBEventStore({
        client,
        observability,
      }),
    }))
      .when(async ({ eventStore }) => {
        await eventStore.appendToStream<ShoppingCartEvent>(
          streamName,
          [{ type: 'ProductItemAdded', data: { productItem } }],
          { expectedStreamVersion: STREAM_DOES_NOT_EXIST },
        );
      })
      .then(({ spans }) => {
        spans.hasSingleSpanNamed('eventStore.appendToStream').hasAttributes({
          [EmmettAttributes.eventStore.operation]: 'appendToStream',
          [EmmettAttributes.stream.name]: streamName,
          [EmmettAttributes.eventStore.append.batchSize]: 1,
          [EmmettAttributes.eventStore.append.status]: 'success',
          [EmmettAttributes.stream.versionAfter]: 1,
          [M.operation.type]: 'send',
          [M.batch.messageCount]: 1,
          [M.destination.name]: streamName,
          [M.system]: MessagingSystemName,
        });
      });
  });

  void it('should record observability while reading', async () => {
    const streamType = 'shopping_cart';
    const shoppingCartId = uuid();
    const streamName = toStreamName(streamType, shoppingCartId);
    const productItem: PricedProductItem = {
      productId: '123',
      quantity: 10,
      price: 3,
    };

    await given(async (observability) => {
      const eventStore = getMongoDBEventStore({
        client,
        observability,
      });
      await eventStore.appendToStream<ShoppingCartEvent>(
        streamName,
        [{ type: 'ProductItemAdded', data: { productItem } }],
        { expectedStreamVersion: STREAM_DOES_NOT_EXIST },
      );
      return {
        eventStore,
      };
    })
      .when(async ({ eventStore }) => {
        await eventStore.readStream<ShoppingCartEvent>(streamName);
      })
      .then(({ spans }) => {
        spans.hasSingleSpanNamed('eventStore.readStream').hasAttributes({
          [EmmettAttributes.eventStore.operation]: 'readStream',
          [EmmettAttributes.stream.name]: streamName,
          [EmmettAttributes.eventStore.read.status]: 'success',
          [EmmettAttributes.eventStore.read.eventCount]: 1,
          [EmmettAttributes.eventStore.read.eventTypes]: ['ProductItemAdded'],
          [M.operation.type]: 'receive',
          [M.destination.name]: streamName,
          [M.system]: MessagingSystemName,
        });
      });
  });

  void it('should record observability while handling inline projections', async () => {
    const projectionName = `mongo_observability_projection_${uuid()}`;
    const streamType = 'shopping_cart';
    const shoppingCartId = uuid();
    const streamName = toStreamName(streamType, shoppingCartId);
    const productItem: PricedProductItem = {
      productId: '123',
      quantity: 10,
      price: 3,
    };

    await given((observability) => ({
      eventStore: getMongoDBEventStore({
        client,
        observability,
        projections: projections.inline([
          {
            name: projectionName,
            canHandle: ['ProductItemAdded'],
            handle: () => undefined,
          },
        ]),
      }),
    }))
      .when(async ({ eventStore }) => {
        await eventStore.appendToStream<ShoppingCartEvent>(
          streamName,
          [{ type: 'ProductItemAdded', data: { productItem } }],
          { expectedStreamVersion: STREAM_DOES_NOT_EXIST },
        );
      })
      .then(({ spans }) => {
        spans.hasSingleSpanNamed('eventStore.appendToStream').hasAttributes({
          'emmett.scope.main': true,
          [EmmettAttributes.eventStore.operation]: 'appendToStream',
          [EmmettAttributes.stream.name]: streamName,
          [EmmettAttributes.eventStore.append.batchSize]: 1,
          [EmmettAttributes.eventStore.append.status]: 'success',
          [EmmettAttributes.stream.versionAfter]: 1,
          [M.operation.type]: 'send',
          [M.batch.messageCount]: 1,
          [M.destination.name]: streamName,
          [M.system]: MessagingSystemName,
        });

        spans
          .hasSingleSpanNamed('eventStore.inlineProjection')
          .hasParentSpanNamed('eventStore.appendToStream')
          .hasAttributes({
            'emmett.scope.main': undefined,
            [EmmettAttributes.eventStore.operation]: 'inlineProjection',
            [EmmettAttributes.stream.name]: streamName,
            [M.operation.type]: 'process',
            [M.destination.name]: streamName,
            [M.system]: MessagingSystemName,
          });
      });
  });

  void it('should record observability while aggregating stream', async () => {
    const streamType = 'shopping_cart';
    const shoppingCartId = uuid();
    const streamName = toStreamName(streamType, shoppingCartId);
    const productItem: PricedProductItem = {
      productId: '123',
      quantity: 10,
      price: 3,
    };

    await given(async (observability) => {
      const eventStore = getMongoDBEventStore({
        client,
        observability,
      });
      await eventStore.appendToStream<ShoppingCartEvent>(
        streamName,
        [{ type: 'ProductItemAdded', data: { productItem } }],
        { expectedStreamVersion: STREAM_DOES_NOT_EXIST },
      );
      return {
        eventStore,
      };
    })
      .when(async ({ eventStore }) => {
        await eventStore.aggregateStream<
          { productItemsCount: number },
          ShoppingCartEvent
        >(streamName, {
          initialState: () => ({ productItemsCount: 0 }),
          evolve: (state: { productItemsCount: number }) => ({
            productItemsCount: state.productItemsCount + 1,
          }),
        });
      })
      .then(({ spans }) => {
        spans.hasSingleSpanNamed('eventStore.aggregateStream').hasAttributes({
          'emmett.scope.main': true,
          [EmmettAttributes.eventStore.operation]: 'aggregateStream',
          [EmmettAttributes.stream.name]: streamName,
          [EmmettAttributes.eventStore.aggregate.status]: 'success',
          [EmmettAttributes.stream.versionAfter]: 1,
          [M.operation.type]: 'process',
          [M.destination.name]: streamName,
          [M.system]: MessagingSystemName,
        });

        spans
          .hasSingleSpanNamed('eventStore.readStream')
          .hasParentSpanNamed('eventStore.aggregateStream')
          .hasAttributes({
            'emmett.scope.main': undefined,
            [EmmettAttributes.eventStore.operation]: 'readStream',
            [EmmettAttributes.stream.name]: streamName,
            [EmmettAttributes.eventStore.read.status]: 'success',
            [EmmettAttributes.eventStore.read.eventCount]: 1,
            [EmmettAttributes.eventStore.read.eventTypes]: ['ProductItemAdded'],
            [M.operation.type]: 'receive',
            [M.destination.name]: streamName,
            [M.system]: MessagingSystemName,
          });
      });
  });

  void it('should only return a subset of stream events based on expectedStreamVersion', async () => {
    const productItem: PricedProductItem = {
      productId: '123',
      quantity: 10,
      price: 3,
    };
    const discount = 10;
    const shoppingCartId = uuid();
    const streamName = toStreamName('shopping_cart', shoppingCartId);

    await eventStore.appendToStream<ShoppingCartEvent>(
      streamName,
      [
        { type: 'ProductItemAdded', data: { productItem } },
        { type: 'ProductItemAdded', data: { productItem } },
        {
          type: 'DiscountApplied',
          data: { percent: discount, couponId: uuid() },
        },
      ],
      { expectedStreamVersion: STREAM_DOES_NOT_EXIST },
    );

    const expectedStreamVersion = 3n;
    const expectedNumEvents = 2;
    const stream = await eventStore.readStream<ShoppingCartEvent>(streamName, {
      from: 0n,
      to: BigInt(expectedNumEvents),
      expectedStreamVersion,
    });

    assertTrue(stream.streamExists);
    assertEqual(expectedStreamVersion, stream.currentStreamVersion);
    assertEqual(expectedNumEvents, stream.events.length);
  });

  void describe('upcasting', () => {
    type ShoppingCartOpenedFromDB = Event<
      'ShoppingCartOpened',
      { openedAt: string; loyaltyPoints: string }
    >;

    type ShoppingCartOpened = Event<
      'ShoppingCartOpened',
      { openedAt: Date; loyaltyPoints: bigint }
    >;

    type ShoppingCartEventFromDB = ShoppingCartEvent | ShoppingCartOpenedFromDB;

    type ShoppingCartEventWithDatesAndBigInt =
      ShoppingCartEvent | ShoppingCartOpened;

    type ShoppingCartState = {
      productItems: PricedProductItem[];
      totalAmount: number;
      openedAt: Date | null;
      loyaltyPoints: bigint;
    };

    const upcast = (event: Event): ShoppingCartEventWithDatesAndBigInt => {
      switch (event.type) {
        case 'ShoppingCartOpened': {
          const e = event as ShoppingCartOpenedFromDB;
          return {
            ...e,
            data: {
              openedAt: new Date(e.data.openedAt),
              loyaltyPoints: BigInt(e.data.loyaltyPoints),
            },
          };
        }
        default:
          return event as ShoppingCartEventWithDatesAndBigInt;
      }
    };

    const evolveState = (
      state: ShoppingCartState,
      { type, data }: ShoppingCartEventWithDatesAndBigInt,
    ): ShoppingCartState => {
      switch (type) {
        case 'ShoppingCartOpened':
          return {
            ...state,
            openedAt: data.openedAt,
            loyaltyPoints: data.loyaltyPoints,
          };
        case 'ProductItemAdded':
          return {
            ...state,
            productItems: [...state.productItems, data.productItem],
            totalAmount:
              state.totalAmount +
              data.productItem.price * data.productItem.quantity,
          };
        case 'DiscountApplied':
          return {
            ...state,
            totalAmount: state.totalAmount * (1 - data.percent / 100),
          };
        case 'ShoppingCartConfirmed':
        case 'DeletedShoppingCart':
          return state;
      }
    };

    const initialState = (): ShoppingCartState => ({
      productItems: [],
      totalAmount: 0,
      openedAt: null,
      loyaltyPoints: 0n,
    });

    void it('should upcast ISO string to Date and string to BigInt when aggregating', async () => {
      const openedAtString = '2024-01-15T10:30:00.000Z';
      const loyaltyPointsString = '9007199254740993';
      const productItem: PricedProductItem = {
        productId: '123',
        quantity: 10,
        price: 3,
      };
      const shoppingCartId = uuid();
      const streamName = toStreamName('shopping_cart', shoppingCartId);

      await eventStore.appendToStream<ShoppingCartEventFromDB>(
        streamName,
        [
          {
            type: 'ShoppingCartOpened',
            data: {
              openedAt: openedAtString,
              loyaltyPoints: loyaltyPointsString,
            },
          },
          { type: 'ProductItemAdded', data: { productItem } },
        ],
        { expectedStreamVersion: STREAM_DOES_NOT_EXIST },
      );

      const { state, currentStreamVersion } = await eventStore.aggregateStream<
        ShoppingCartState,
        ShoppingCartEventWithDatesAndBigInt
      >(streamName, {
        evolve: evolveState,
        initialState,
        read: { schema: { versioning: { upcast } } },
      });

      assertEqual(currentStreamVersion, 2n);
      assertDeepEqual(state.openedAt, new Date(openedAtString));
      assertEqual(state.loyaltyPoints, BigInt(loyaltyPointsString));
      assertEqual(state.totalAmount, productItem.price * productItem.quantity);
    });
  });
});
