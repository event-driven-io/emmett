import { assertDeepEqual, assertIsNotNull } from '@event-driven-io/emmett';
import {
  MongoDBContainer,
  type StartedMongoDBContainer,
} from '@testcontainers/mongodb';
import { MongoClient } from 'mongodb';
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
  type EventStream,
  type MongoDBEventStore,
} from './mongoDBEventStore';

const DB_NAME = 'mongodbeventstore_testing';
const SHOPPING_CARD_INFO_COLLECTION_NAME = 'shoppingCartShortInfo';

void describe('EventStoreDBEventStore', () => {
  let mongodb: StartedMongoDBContainer;
  let eventStore: MongoDBEventStore;
  let client: MongoClient;

  before(async () => {
    mongodb = await new MongoDBContainer().start();
    client = new MongoClient(mongodb.getConnectionString());

    const db = client.db(DB_NAME);
    const collection = db.collection<EventStream>(
      'mongodbeventstore_testing_eventstreams',
    );
    await collection.createIndex({ streamName: 1 }, { unique: true });
    eventStore = getMongoDBEventStore(collection);

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
    const shoppingCartId = toStreamName('shopping_cart', uuid());

    await eventStore.appendToStream<ShoppingCartEvent>(
      shoppingCartId,
      [
        { type: 'ProductItemAdded', data: { productItem } },
        { type: 'ProductItemAdded', data: { productItem } },
        {
          type: 'DiscountApplied',
          data: { percent: discount, couponId: uuid() },
        },
      ],
      {
        projections: [
          async ({ events }) => {
            const state = events.reduce(evolve, null);
            if (state === null) return;
            await client
              .db(DB_NAME)
              .collection(SHOPPING_CARD_INFO_COLLECTION_NAME)
              .insertOne({ shoppingCartId, ...state });
          },
        ],
      },
    );

    const shoppingCartShortInfo = client
      .db()
      .collection<ShoppingCartShortInfo>(SHOPPING_CARD_INFO_COLLECTION_NAME);

    const doc = await shoppingCartShortInfo.findOne({
      shoppingCartId,
    });

    assertIsNotNull(doc);
    assertDeepEqual(
      { ...doc, shoppingCartId },
      {
        shoppingCartId,
        productItemsCount: 20,
        totalAmount: 54,
        _version: 3n,
      },
    );
  });
});

type ShoppingCartShortInfo = {
  productItemsCount: number;
  totalAmount: number;
};

const evolve = (
  document: ShoppingCartShortInfo | null,
  { type, data: event }: ProductItemAdded | DiscountApplied,
): ShoppingCartShortInfo => {
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
