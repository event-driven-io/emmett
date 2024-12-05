import {
  assertDeepEqual,
  assertEqual,
  assertIsNotNull,
  assertTrue,
  projections,
  STREAM_DOES_NOT_EXIST,
} from '@event-driven-io/emmett';
import {
  MongoDBContainer,
  type StartedMongoDBContainer,
} from '@testcontainers/mongodb';
import { MongoClient, type Collection } from 'mongodb';
import { after, before, describe, it } from 'node:test';
import { v4 as uuid } from 'uuid';
import {
  type DiscountApplied,
  type PricedProductItem,
  type ProductItemAdded,
  type ShoppingCartEvent,
} from '../testing/shoppingCart.domain';
import {
  getMongoDBEventStore,
  toStreamName,
  mongoDBInlineProjection,
  type EventStream,
  type MongoDBEventStore,
} from './';

const DB_NAME = 'mongodbeventstore_testing';
const SHOPPING_CART_PROJECTION_NAME = 'shoppingCartShortInfo';

void describe('MongoDBEventStore', () => {
  let mongodb: StartedMongoDBContainer;
  let eventStore: MongoDBEventStore;
  let client: MongoClient;
  let collection: Collection<EventStream>;

  before(async () => {
    mongodb = await new MongoDBContainer().start();
    client = new MongoClient(mongodb.getConnectionString(), {
      directConnection: true,
    });

    await client.connect();
    const db = client.db(DB_NAME);
    collection = db.collection<EventStream>(
      'mongodbeventstore_testing_eventstreams',
    );

    eventStore = getMongoDBEventStore({
      collection,
      projections: projections.inline([
        mongoDBInlineProjection({
          name: SHOPPING_CART_PROJECTION_NAME,
          canHandle: ['ProductItemAdded', 'DiscountApplied'],
          evolve,
        }),
      ]),
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

  void it('should append events correctly using appendEvent function', async () => {
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

    const stream = await collection.findOne(
      { streamName },
      { useBigInt64: true },
    );
    assertIsNotNull(stream);
    assertEqual('3', stream.metadata.streamPosition.toString());
    assertDeepEqual(stream.projections[SHOPPING_CART_PROJECTION_NAME], {
      productItemsCount: 20,
      totalAmount: 54,
      _metadata: {
        name: SHOPPING_CART_PROJECTION_NAME,
        streamPosition: 3n,
        schemaVersion: 1,
      },
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
});

type ShoppingCartShortInfo = {
  productItemsCount: number;
  totalAmount: number;
};

const evolve = (
  document: ShoppingCartShortInfo | null,
  { type, data: event }: ProductItemAdded | DiscountApplied,
): ShoppingCartShortInfo | null => {
  document = document ?? { productItemsCount: 0, totalAmount: 0 };

  switch (type) {
    case 'ProductItemAdded':
      return {
        totalAmount:
          document.totalAmount +
          event.productItem.price * event.productItem.quantity,
        productItemsCount:
          document.productItemsCount + event.productItem.quantity,
      };
    case 'DiscountApplied':
      return {
        ...document,
        totalAmount: (document.totalAmount * (100 - event.percent)) / 100,
      };
    default:
      return document;
  }
};
