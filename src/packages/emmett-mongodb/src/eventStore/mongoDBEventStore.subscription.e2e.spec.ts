import {
  assertEqual,
  assertIsNotNull,
  assertNotEqual,
  assertTrue,
  STREAM_DOES_NOT_EXIST,
} from '@event-driven-io/emmett';
import {
  MongoDBContainer,
  type StartedMongoDBContainer,
} from '@testcontainers/mongodb';
import assert from 'assert';
import { MongoClient, type Collection } from 'mongodb';
import { after, before, describe, it } from 'node:test';
import { v4 as uuid, v4 } from 'uuid';
import {
  getMongoDBEventStore,
  toStreamCollectionName,
  toStreamName,
  type EventStream,
  type MongoDBEventStore,
} from '.';
import {
  type PricedProductItem,
  type ProductItemAdded,
  type ShoppingCartEvent,
} from '../testing';
import { CancellationPromise } from './consumers/CancellablePromise';
import {
  mongoDBMessagesConsumer,
  type MongoDBEventStoreConsumer,
} from './consumers/mongoDBEventsConsumer';
import type { MongoDBProcessor } from './consumers/mongoDBProcessor';
import {
  compareTwoMongoDBTokens,
  generateVersionPolicies,
} from './consumers/subscriptions';
import type { MongoDBResumeToken } from './consumers/subscriptions/types';

void describe('MongoDBEventStore subscription', () => {
  let mongodb: StartedMongoDBContainer;
  let eventStore: MongoDBEventStore;
  let client: MongoClient;
  let collection: Collection<EventStream>;
  let consumer: MongoDBEventStoreConsumer<ShoppingCartEvent>;
  let processor: MongoDBProcessor<ProductItemAdded> | undefined;
  let lastResumeToken: MongoDBResumeToken | null = null;

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
  const noop = () => {};
  const productItem = (productId: string) =>
    ({
      productId,
      quantity: 10,
      price: 3,
    }) as PricedProductItem;
  const timeoutGuard = async (
    action: () => Promise<void>,
    timeoutAfterMs = 1000,
  ) => {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('timeout'));
        clearTimeout(timer);
      }, timeoutAfterMs);

      action()
        .catch(noop)
        .finally(() => {
          clearTimeout(timer);
          resolve();
        });
    });
  };

  before(async () => {
    mongodb = await new MongoDBContainer('mongo:8.0.10').start();
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
    const versionPolicy = await generateVersionPolicies(db);

    consumer = mongoDBMessagesConsumer<ShoppingCartEvent>({
      client,
      changeStreamFullDocumentPolicy:
        versionPolicy.changeStreamFullDocumentValuePolicy,
    });
  });

  after(async () => {
    if (consumer) {
      await consumer.close();
    }
    await client.close();
    await mongodb.stop();
  });

  void it('should react to new events added by the appendToStream', async () => {
    let receivedMessageCount: 0 | 1 | 2 = 0;

    processor = consumer.reactor<ProductItemAdded>({
      processorId: v4(),
      stopAfter: (event) => {
        if (event.data.productItem.productId === lastProductItemIdTest1) {
          messageProcessingPromise1.resolve();
          consumer.stop();
        }
        if (event.data.productItem.productId === lastProductItemIdTest2) {
          messageProcessingPromise2.resolve();
          consumer.stop();
        }

        return (
          event.data.productItem.productId === lastProductItemIdTest1 ||
          event.data.productItem.productId === lastProductItemIdTest2
        );
      },
      eachMessage: (event) => {
        lastResumeToken = event.metadata.globalPosition;

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

    try {
      await consumer.start();
    } catch (err) {
      console.error(err);
    }

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
  });

  void it.skip('should renew after the last event', async () => {
    assertTrue(!!processor);
    assert(processor);

    let stream = await collection.findOne(
      { streamName },
      { useBigInt64: true },
    );
    assertIsNotNull(stream);
    assertEqual(3n, stream.metadata.streamPosition);

    await consumer.start();

    const position = await processor.start({ client });

    assertTrue(!!position);
    assertNotEqual(typeof position, 'string');
    assert(position);
    assert(typeof position !== 'string');

    // processor after restart is renewed after the 3rd position.
    assertEqual(
      0,
      compareTwoMongoDBTokens(position.lastCheckpoint, lastResumeToken!),
    );

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

    await timeoutGuard(() => messageProcessingPromise2);

    stream = await collection.findOne({ streamName }, { useBigInt64: true });
    assertIsNotNull(stream);
    assertEqual(4n, stream.metadata.streamPosition);

    // lastResumeToken has changed after the last message
    assertEqual(
      1,
      compareTwoMongoDBTokens(lastResumeToken!, position.lastCheckpoint),
    );

    await consumer.stop();
  });
});
