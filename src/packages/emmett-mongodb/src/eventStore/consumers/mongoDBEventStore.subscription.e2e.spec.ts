import {
  assertEqual,
  assertFails,
  assertIsNotNull,
  assertNotEqual,
  assertOk,
  assertTrue,
  ProcessorCheckpoint,
  STREAM_DOES_NOT_EXIST,
} from '@event-driven-io/emmett';
import { MongoClient, type Collection } from 'mongodb';
import { v4 as uuid, v4 } from 'uuid';
import { afterAll, beforeAll, describe, it } from 'vitest';
import {
  getMongoDBEventStore,
  toStreamCollectionName,
  toStreamName,
  type EventStream,
  type MongoDBEventStore,
} from '..';
import type { ProductItemAdded, ShoppingCartEvent } from '../../testing';
import {
  sharedMongoDBDatabase,
  type SharedMongoDBDatabase,
} from '../../testing/sharedMongoDBDatabase';
import { CancellationPromise } from './CancellablePromise';
import type { MongoDBCheckpoint } from './messageSource';
import {
  mongoDBEventStoreConsumer,
  type MongoDBEventStoreConsumer,
} from './mongoDBEventStoreConsumer';
import type { MongoDBProcessor } from './mongoDBProcessor';

const withDeadline = { timeout: 30000 };

void describe('MongoDBEventStore subscription', () => {
  let database: SharedMongoDBDatabase;
  let eventStore: MongoDBEventStore;
  let client: MongoClient;
  let collection: Collection<EventStream>;
  let consumer: MongoDBEventStoreConsumer<ShoppingCartEvent>;
  let processor: MongoDBProcessor<ProductItemAdded> | undefined;
  let lastResumeToken: MongoDBCheckpoint | null = null;

  const messageProcessingPromise1 = new CancellationPromise<void>();
  const messageProcessingPromise2 = new CancellationPromise<void>();
  const lastProductItemIdTest1 = '789';
  const lastProductItemIdTest2 = '999';
  const expectedProductItemIds = [
    '123',
    '456',
    lastProductItemIdTest1,
    lastProductItemIdTest2,
  ] as const;

  const shoppingCartId = uuid();
  const streamType = 'shopping_cart';
  const streamName = toStreamName(streamType, shoppingCartId);
  const productItem = (productId: string) => ({
    productId,
    quantity: 10,
    price: 3,
  });

  beforeAll(async () => {
    database = sharedMongoDBDatabase();
    client = new MongoClient(database.connectionString, {
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

    consumer = mongoDBEventStoreConsumer<ShoppingCartEvent>({
      client,
    });
  });

  afterAll(async () => {
    if (consumer) {
      await consumer.close();
    }
    await client.close();
    await database.close();
  });

  void it(
    'should react to new events added by the appendToStream',
    withDeadline,
    async () => {
      let receivedMessageCount: 0 | 1 | 2 = 0;

      processor = consumer.reactor<ProductItemAdded>({
        processorId: v4(),
        stopAfter: (event) => {
          if (event.data.productItem.productId === lastProductItemIdTest1) {
            messageProcessingPromise1.resolve();
          }
          if (event.data.productItem.productId === lastProductItemIdTest2) {
            messageProcessingPromise2.resolve();
          }

          return (
            event.data.productItem.productId === lastProductItemIdTest1 ||
            event.data.productItem.productId === lastProductItemIdTest2
          );
        },
        eachMessage: (event) => {
          lastResumeToken = event.metadata.checkpoint as MongoDBCheckpoint;

          assertTrue(receivedMessageCount <= 3);
          assertEqual(
            expectedProductItemIds[receivedMessageCount],
            event.data.productItem.productId,
          );

          receivedMessageCount++;
        },
        connectionOptions: {
          client,
        },
      });

      await eventStore.appendToStream<ShoppingCartEvent>(
        streamName,
        [
          {
            type: 'ProductItemAdded',
            data: { productItem: productItem(expectedProductItemIds[0]) },
          },
        ],
        { expectedStreamVersion: STREAM_DOES_NOT_EXIST },
      );
      await eventStore.appendToStream<ShoppingCartEvent>(
        streamName,
        [
          {
            type: 'ProductItemAdded',
            data: { productItem: productItem(expectedProductItemIds[1]) },
          },
        ],
        { expectedStreamVersion: 1n },
      );
      await eventStore.appendToStream<ShoppingCartEvent>(
        streamName,
        [
          {
            type: 'ProductItemAdded',
            data: { productItem: productItem(expectedProductItemIds[2]) },
          },
        ],
        { expectedStreamVersion: 2n },
      );

      const consumerPromise = consumer.start();

      await messageProcessingPromise1;
      await consumerPromise;

      await consumer.stop();

      const stream = await collection.findOne(
        { streamName },
        { useBigInt64: true },
      );

      assertIsNotNull(stream);
      assertEqual(3n, stream.metadata.streamPosition);
      assertEqual(shoppingCartId, stream.metadata.streamId);
      assertEqual(streamType, stream.metadata.streamType);
      assertTrue(stream.metadata.createdAt instanceof Date);
      assertTrue(stream.metadata.updatedAt instanceof Date);
    },
  );

  void it('should renew after the last event', withDeadline, async () => {
    assertOk(processor);

    let stream = await collection.findOne(
      { streamName },
      { useBigInt64: true },
    );
    assertIsNotNull(stream);
    assertEqual(3n, stream.metadata.streamPosition);

    const position = await processor.start({ client });

    assertOk(position);
    assertNotEqual(typeof position, 'string');
    assertOk(typeof position !== 'string');
    if (typeof position === 'string') {
      assertFails('Position should not be a string');
      return;
    }

    // processor after restart is renewed after the 3rd position.
    assertEqual(
      0,
      ProcessorCheckpoint.compare(
        position.lastCheckpoint as MongoDBCheckpoint,
        lastResumeToken!,
      ),
    );

    const consumerPromise = consumer.start();

    await new Promise((resolve) => setTimeout(resolve, 1000));

    await eventStore.appendToStream<ShoppingCartEvent>(
      streamName,
      [
        {
          type: 'ProductItemAdded',
          data: { productItem: productItem(expectedProductItemIds[3]) },
        },
      ],
      { expectedStreamVersion: 3n },
    );

    await messageProcessingPromise2;
    await consumerPromise;

    await consumer.stop();

    stream = await collection.findOne({ streamName }, { useBigInt64: true });
    assertIsNotNull(stream);
    assertEqual(4n, stream.metadata.streamPosition);

    // lastResumeToken has changed after the last message
    assertEqual(
      1,
      ProcessorCheckpoint.compare(
        lastResumeToken!,
        position.lastCheckpoint as MongoDBCheckpoint,
      ),
    );

    await consumer.stop();
  });
});
