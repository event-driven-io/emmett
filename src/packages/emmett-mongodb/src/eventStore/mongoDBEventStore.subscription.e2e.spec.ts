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
import { after, before, beforeEach, describe, it } from 'node:test';
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
  mongoDBEventsConsumer,
  type EventStoreDBEventStoreConsumer,
} from './consumers/mongoDBEventsConsumer';
import { generateVersionPolicies } from './consumers/subscriptions';

void describe('MongoDBEventStore subscription', () => {
  let mongodb: StartedMongoDBContainer;
  let eventStore: MongoDBEventStore;
  let client: MongoClient;
  let collection: Collection<EventStream>;
  let consumer: EventStoreDBEventStoreConsumer<ShoppingCartEvent>;
  let messageProcessingPromise = new CancellationPromise<void>();

  const noop = () => {};
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

    consumer = mongoDBEventsConsumer<ShoppingCartEvent>({
      client,
      changeStreamFullDocumentPolicy:
        versionPolicy.changeStreamFullDocumentValuePolicy,
      onHandleEnd: () => {
        messageProcessingPromise.resolve();
        return Promise.resolve();
      },
    });

    consumer.reactor<ProductItemAdded>({
      processorId: v4(),
      eachMessage: (event) => {
        console.log(event);
      },
      connectionOptions: {
        client,
      },
    });

    await consumer.start();
  });

  after(async () => {
    try {
      if (consumer) {
        await consumer.close();
      }
      await client.close();
      await mongodb.stop();
    } catch (error) {
      console.log(error);
    }
  });

  beforeEach(() => {
    messageProcessingPromise = new CancellationPromise();
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
    await timeoutGuard(() => messageProcessingPromise);
    assertIsNotNull(stream);
    assertEqual(1n, stream.metadata.streamPosition);
    assertEqual(shoppingCartId, stream.metadata.streamId);
    assertEqual(streamType, stream.metadata.streamType);
    assertTrue(stream.metadata.createdAt instanceof Date);
    assertTrue(stream.metadata.updatedAt instanceof Date);
  });
});
