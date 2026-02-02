import {
  assertDeepEqual,
  assertEqual,
  assertIsNotNull,
  assertTrue,
  STREAM_DOES_NOT_EXIST,
  type Event,
} from '@event-driven-io/emmett';
import { type StartedMongoDBContainer } from '@testcontainers/mongodb';
import { MongoClient, type Collection } from 'mongodb';
import { after, before, describe, it } from 'node:test';
import { v4 as uuid } from 'uuid';
import { type PricedProductItem, type ShoppingCartEvent } from '../testing';
import {
  getMongoDBEventStore,
  toStreamCollectionName,
  toStreamName,
  type EventStream,
  type MongoDBEventStore,
} from './';
import { getMongoDBStartedContainer } from '@event-driven-io/emmett-testcontainers';

void describe('MongoDBEventStore', () => {
  let mongodb: StartedMongoDBContainer;
  let eventStore: MongoDBEventStore;
  let client: MongoClient;
  let collection: Collection<EventStream>;

  before(async () => {
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

  after(async () => {
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
      | ShoppingCartEvent
      | ShoppingCartOpened;

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
