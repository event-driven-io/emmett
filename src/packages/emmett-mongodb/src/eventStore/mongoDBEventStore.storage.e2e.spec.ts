import {
  assertIsNotNull,
  assertOk,
  assertThatArray,
} from '@event-driven-io/emmett';
import type { Collection, Db } from 'mongodb';
import { MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { v4 as uuid } from 'uuid';
import {
  DefaultMongoDBEventStoreCollectionName,
  getMongoDBEventStore,
  toStreamCollectionName,
  type EventStream,
  type MongoDBEventStoreCollectionResolution,
} from '.';
import {
  assertCanAppend,
  ShoppingCartStreamType,
  type DiscountApplied,
  type ProductItemAdded,
} from '../testing';
import {
  sharedMongoDBDatabase,
  type SharedMongoDBDatabase,
} from '../testing/sharedMongoDBDatabase';

void describe('MongoDBEventStore storage resolution', () => {
  let database: SharedMongoDBDatabase;
  let client: MongoClient;

  beforeAll(() => {
    database = sharedMongoDBDatabase();
    client = new MongoClient(database.connectionString, {
      directConnection: true,
    });
  });

  afterAll(async () => {
    try {
      await client.close();
      await database.close();
    } catch (error) {
      console.log(error);
    }
  });

  void it('sets up database and collection with COLLECTION_PER_STREAM_TYPE as default', async () => {
    // Given
    // When
    const eventStore = getMongoDBEventStore({
      client,
    });

    // Then
    await assertCanAppend(eventStore);

    const collection = await assertEventStoreSetUpCollection(
      client.db(),
      toStreamCollectionName(ShoppingCartStreamType),
    );
    const stream = await collection.findOne();
    assertIsNotNull(stream);
  });

  void it('sets up database and collection with custom SINGLE_COLLECTION', async () => {
    // Given
    const customCollectionName = uuid();

    // When
    const eventStore = getMongoDBEventStore({
      storage: {
        type: 'SINGLE_COLLECTION',
        collectionName: customCollectionName,
      },
      client,
    });

    // Then
    await assertCanAppend(eventStore);

    const collection = await assertEventStoreSetUpCollection(
      client.db(),
      customCollectionName,
    );
    const stream = await collection.findOne();
    assertIsNotNull(stream);
  });

  void it('sets up database and collection with default SINGLE_COLLECTION', async () => {
    // Given
    // When
    const eventStore = getMongoDBEventStore({
      storage: {
        type: 'SINGLE_COLLECTION',
      },
      client,
    });

    // Then
    await assertCanAppend(eventStore);

    const collection = await assertEventStoreSetUpCollection(
      client.db(),
      DefaultMongoDBEventStoreCollectionName,
    );
    const stream = await collection.findOne();
    assertIsNotNull(stream);
  });

  void it('sets up database and collection with CUSTOM collection resolution', async () => {
    // Given
    const customCollectionSuffix = uuid();
    const databaseName = uuid();

    // When
    const eventStore = getMongoDBEventStore({
      storage: {
        type: 'CUSTOM',
        collectionFor: (
          streamType: string,
        ): MongoDBEventStoreCollectionResolution => ({
          collectionName: `${streamType}:${customCollectionSuffix}`,
          databaseName,
        }),
      },
      client,
    });

    // Then
    await assertCanAppend(eventStore);

    const collection = await assertEventStoreSetUpCollection(
      client.db(databaseName),
      `${ShoppingCartStreamType}:${customCollectionSuffix}`,
    );
    const stream = await collection.findOne();
    assertIsNotNull(stream);
  });
});

const assertEventStoreSetUpCollection = async (
  db: Db,
  collectionName: string,
): Promise<Collection<EventStream<ProductItemAdded | DiscountApplied>>> => {
  const existingCollections = await db.collections();
  const collection = existingCollections.find(
    (c) => c.collectionName,
    collectionName,
  );

  assertOk(collection);

  const indexes = await collection.indexes();

  assertThatArray(indexes).anyMatches(
    (index) => index.unique === true && index.key['streamName'] === 1,
  );

  return collection as unknown as Collection<
    EventStream<ProductItemAdded | DiscountApplied>
  >;
};
