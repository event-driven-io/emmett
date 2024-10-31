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
    client = new MongoClient(mongodb.getConnectionString(), {
      directConnection: true,
    });
    await client.connect();
    const db = client.db(DB_NAME);
    const collection = db.collection<EventStream>(
      'mongodbeventstore_testing_eventstreams',
    );
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
    const shoppingCartId = uuid();

    const shoppingCartShortInfo = client
      .db()
      .collection<
        ShoppingCartShortInfo & { streamId: string; version: number }
      >(SHOPPING_CARD_INFO_COLLECTION_NAME);

    await eventStore.appendToStream<ShoppingCartEvent>(
      toStreamName('shopping_cart', shoppingCartId),
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
          async ({ events, streamVersion, streamId }) => {
            const state = events.reduce(evolve, null);
            if (state === null) return;
            await shoppingCartShortInfo.insertOne({
              streamId,
              version: streamVersion,
              ...state,
            });
          },
        ],
      },
    );

    const doc = await shoppingCartShortInfo.findOne({
      streamId: shoppingCartId,
    });

    assertIsNotNull(doc);

    const { _id, ...docWithoutId } = doc;

    assertDeepEqual(docWithoutId, {
      streamId: shoppingCartId,
      version: 3,
      productItemsCount: 20,
      totalAmount: 54,
    });
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
