import {
  assertEqual,
  assertIsNotNull,
  assertTrue,
  STREAM_DOES_NOT_EXIST,
} from '@event-driven-io/emmett';
import {
  MongoDBContainer,
  type StartedMongoDBContainer,
} from '@testcontainers/mongodb';
import { MongoClient, type Collection } from 'mongodb';
import { after, before, describe, it } from 'node:test';
import { v4 as uuid } from 'uuid';
import { type PricedProductItem, type ShoppingCartEvent } from '../testing';
import {
  getMongoDBEventStore,
  toStreamCollectionName,
  toStreamName,
  type EventStream,
  type MongoDBStreamAsDocumentEventStore,
} from './';

void describe('MongoDBEventStore', () => {
  let mongodb: StartedMongoDBContainer;
  let eventStore: MongoDBStreamAsDocumentEventStore;
  let client: MongoClient;
  let collection: Collection<EventStream>;

  before(async () => {
    mongodb = await new MongoDBContainer().start();
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
});
