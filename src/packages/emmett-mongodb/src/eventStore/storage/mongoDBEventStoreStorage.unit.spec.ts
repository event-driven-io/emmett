import { assertEqual, assertNotEqual } from '@event-driven-io/emmett';
import type { MongoClient } from 'mongodb';
import { beforeEach, describe, it } from 'node:test';
import { v7 as uuid } from 'uuid';
import { getDummyClient } from '../../testing';
import { toStreamCollectionName, type StreamType } from '../mongoDBEventStore';
import {
  DefaultMongoDBEventStoreCollectionName,
  mongoDBEventStoreStorage,
  type MongoDBEventStoreCollectionResolution,
} from './mongoDBEventStoreStorage';

type TestStreamType = StreamType;
type OtherTestStreamType = StreamType;

void describe('mongoDBEventStoreStorage', () => {
  let testStreamTypeName: TestStreamType;
  let otherStreamTypeName: OtherTestStreamType;
  let defaultDBName: string;
  let getConnectedClient: () => Promise<MongoClient>;

  beforeEach(() => {
    testStreamTypeName = uuid();
    otherStreamTypeName = uuid();
    defaultDBName = uuid();
    getConnectedClient = () =>
      Promise.resolve(getDummyClient({ defaultDBName }));
  });

  void it('uses COLLECTION_PER_STREAM_TYPE storage option if none provided with default db', async () => {
    // Given
    const storage = mongoDBEventStoreStorage({
      getConnectedClient,
    });

    // When
    const collection = await storage.collectionFor(testStreamTypeName);
    const otherCollection = await storage.collectionFor(otherStreamTypeName);

    // Then
    assertNotEqual(collection.collectionName, otherCollection.collectionName);
    assertEqual(
      collection.collectionName,
      toStreamCollectionName(testStreamTypeName),
    );
    assertEqual(
      otherCollection.collectionName,
      toStreamCollectionName(otherStreamTypeName),
    );
    assertEqual(collection.dbName, defaultDBName);
    assertEqual(collection.dbName, defaultDBName);
  });

  void it('resolves the same instance of collection for multiple calls for the same stream type resolution', async () => {
    // Given
    const storage = mongoDBEventStoreStorage({
      getConnectedClient,
    });

    // When
    const firstResolution = await storage.collectionFor(testStreamTypeName);
    const nextResolution = await storage.collectionFor(testStreamTypeName);

    // Then
    assertEqual(firstResolution, nextResolution);
  });

  void describe('Single Collection storage', () => {
    void it('handles SINGLE_COLLECTION passed as string with default collection name and no db', async () => {
      // Given
      const storage = mongoDBEventStoreStorage({
        storage: 'SINGLE_COLLECTION',
        getConnectedClient,
      });

      // When
      const collection = await storage.collectionFor(testStreamTypeName);
      const otherCollection = await storage.collectionFor(otherStreamTypeName);

      // Then
      assertEqual(collection.collectionName, otherCollection.collectionName);
      assertEqual(
        collection.collectionName,
        DefaultMongoDBEventStoreCollectionName,
      );
      assertEqual(
        otherCollection.collectionName,
        DefaultMongoDBEventStoreCollectionName,
      );
      assertEqual(collection.dbName, defaultDBName);
      assertEqual(collection.dbName, defaultDBName);
    });

    void it('handles SINGLE_COLLECTION passed as object with default collection name and no db', async () => {
      // Given
      const storage = mongoDBEventStoreStorage({
        storage: { type: 'SINGLE_COLLECTION' },
        getConnectedClient,
      });

      // When
      const collection = await storage.collectionFor(testStreamTypeName);
      const otherCollection = await storage.collectionFor(otherStreamTypeName);

      // Then
      assertEqual(collection.collectionName, otherCollection.collectionName);
      assertEqual(
        collection.collectionName,
        DefaultMongoDBEventStoreCollectionName,
      );
      assertEqual(
        otherCollection.collectionName,
        DefaultMongoDBEventStoreCollectionName,
      );
      assertEqual(collection.dbName, defaultDBName);
      assertEqual(collection.dbName, defaultDBName);
    });

    void it('handles SINGLE_COLLECTION passed as object with custom collection name and no db', async () => {
      // Given
      const customCollectionName = uuid();
      const storage = mongoDBEventStoreStorage({
        storage: {
          type: 'SINGLE_COLLECTION',
          collectionName: customCollectionName,
        },
        getConnectedClient,
      });

      // When
      const collection = await storage.collectionFor(testStreamTypeName);
      const otherCollection = await storage.collectionFor(otherStreamTypeName);

      // Then
      assertEqual(collection.collectionName, otherCollection.collectionName);
      assertEqual(collection.collectionName, customCollectionName);
      assertEqual(otherCollection.collectionName, customCollectionName);
      assertEqual(collection.dbName, defaultDBName);
      assertEqual(collection.dbName, defaultDBName);
    });

    void it('handles SINGLE_COLLECTION passed as object with no collection name and custom db', async () => {
      // Given
      const customDatabaseName = uuid();
      const storage = mongoDBEventStoreStorage({
        storage: {
          type: 'SINGLE_COLLECTION',
          databaseName: customDatabaseName,
        },
        getConnectedClient,
      });

      // When
      const collection = await storage.collectionFor(testStreamTypeName);
      const otherCollection = await storage.collectionFor(otherStreamTypeName);

      // Then
      assertEqual(collection.collectionName, otherCollection.collectionName);
      assertEqual(
        collection.collectionName,
        DefaultMongoDBEventStoreCollectionName,
      );
      assertEqual(
        otherCollection.collectionName,
        DefaultMongoDBEventStoreCollectionName,
      );
      assertEqual(collection.dbName, customDatabaseName);
      assertEqual(collection.dbName, customDatabaseName);
    });

    void it('handles SINGLE_COLLECTION passed as object with custom collection name and custom db', async () => {
      // Given
      const customCollectionName = uuid();
      const customDatabaseName = uuid();
      const storage = mongoDBEventStoreStorage({
        storage: {
          type: 'SINGLE_COLLECTION',
          collectionName: customCollectionName,
          databaseName: customDatabaseName,
        },
        getConnectedClient,
      });

      // When
      const collection = await storage.collectionFor(testStreamTypeName);
      const otherCollection = await storage.collectionFor(otherStreamTypeName);

      // Then
      assertEqual(collection.collectionName, otherCollection.collectionName);
      assertEqual(collection.collectionName, customCollectionName);
      assertEqual(otherCollection.collectionName, customCollectionName);
      assertEqual(collection.dbName, customDatabaseName);
      assertEqual(collection.dbName, customDatabaseName);
    });
  });

  void describe('Collection per stream type storage', () => {
    void it('handles COLLECTION_PER_STREAM_TYPE passed as string', async () => {
      // Given
      const storage = mongoDBEventStoreStorage({
        storage: 'COLLECTION_PER_STREAM_TYPE',
        getConnectedClient,
      });

      // When
      const collection = await storage.collectionFor(testStreamTypeName);
      const otherCollection = await storage.collectionFor(otherStreamTypeName);

      // Then
      assertNotEqual(collection.collectionName, otherCollection.collectionName);
      assertEqual(
        collection.collectionName,
        toStreamCollectionName(testStreamTypeName),
      );
      assertEqual(
        otherCollection.collectionName,
        toStreamCollectionName(otherStreamTypeName),
      );
      assertEqual(collection.dbName, defaultDBName);
      assertEqual(collection.dbName, defaultDBName);
    });

    void it('handles COLLECTION_PER_STREAM_TYPE passed as object with no db', async () => {
      // Given
      const storage = mongoDBEventStoreStorage({
        storage: { type: 'COLLECTION_PER_STREAM_TYPE' },
        getConnectedClient,
      });

      // When
      const collection = await storage.collectionFor(testStreamTypeName);
      const otherCollection = await storage.collectionFor(otherStreamTypeName);

      // Then
      assertNotEqual(collection.collectionName, otherCollection.collectionName);
      assertEqual(
        collection.collectionName,
        toStreamCollectionName(testStreamTypeName),
      );
      assertEqual(
        otherCollection.collectionName,
        toStreamCollectionName(otherStreamTypeName),
      );
      assertEqual(collection.dbName, defaultDBName);
      assertEqual(collection.dbName, defaultDBName);
    });

    void it('handles COLLECTION_PER_STREAM_TYPE passed as object and custom db', async () => {
      // Given
      const customDatabaseName = uuid();
      const storage = mongoDBEventStoreStorage({
        storage: {
          type: 'COLLECTION_PER_STREAM_TYPE',
          databaseName: customDatabaseName,
        },
        getConnectedClient,
      });

      // When
      const collection = await storage.collectionFor(testStreamTypeName);
      const otherCollection = await storage.collectionFor(otherStreamTypeName);

      // Then
      assertNotEqual(collection.collectionName, otherCollection.collectionName);
      assertEqual(
        collection.collectionName,
        toStreamCollectionName(testStreamTypeName),
      );
      assertEqual(
        otherCollection.collectionName,
        toStreamCollectionName(otherStreamTypeName),
      );
      assertEqual(collection.dbName, customDatabaseName);
      assertEqual(collection.dbName, customDatabaseName);
    });
  });

  void describe('Custom collection resolution storage', () => {
    const customSuffix = uuid();
    const collectionFor = (streamType: string) =>
      `${streamType}:${customSuffix}`;

    void it('handles CUSTOM with collectionFor returning string and no db', async () => {
      // Given
      const storage = mongoDBEventStoreStorage({
        storage: { type: 'CUSTOM', collectionFor },
        getConnectedClient,
      });

      // When
      const collection = await storage.collectionFor(testStreamTypeName);
      const otherCollection = await storage.collectionFor(otherStreamTypeName);

      // Then
      assertNotEqual(collection.collectionName, otherCollection.collectionName);
      assertEqual(
        collection.collectionName,
        `${testStreamTypeName}:${customSuffix}`,
      );
      assertEqual(
        otherCollection.collectionName,
        `${otherStreamTypeName}:${customSuffix}`,
      );
      assertEqual(collection.dbName, defaultDBName);
      assertEqual(collection.dbName, defaultDBName);
    });

    void it('handles CUSTOM with collectionFor returning object with collection name and no db', async () => {
      // Given
      const collectionForWithDb = (
        streamType: string,
      ): MongoDBEventStoreCollectionResolution => ({
        collectionName: collectionFor(streamType),
      });

      const storage = mongoDBEventStoreStorage({
        storage: {
          type: 'CUSTOM',
          collectionFor: collectionForWithDb,
        },
        getConnectedClient,
      });

      // When
      const collection = await storage.collectionFor(testStreamTypeName);
      const otherCollection = await storage.collectionFor(otherStreamTypeName);

      // Then
      assertNotEqual(collection.collectionName, otherCollection.collectionName);
      assertEqual(
        collection.collectionName,
        `${testStreamTypeName}:${customSuffix}`,
      );
      assertEqual(
        otherCollection.collectionName,
        `${otherStreamTypeName}:${customSuffix}`,
      );
      assertEqual(collection.dbName, defaultDBName);
      assertEqual(collection.dbName, defaultDBName);
    });

    void it('handles CUSTOM with collectionFor returning string and using custom db from options', async () => {
      // Given
      const customDatabaseName = uuid();
      const storage = mongoDBEventStoreStorage({
        storage: {
          type: 'CUSTOM',
          collectionFor,
          databaseName: customDatabaseName,
        },
        getConnectedClient,
      });

      // When
      const collection = await storage.collectionFor(testStreamTypeName);
      const otherCollection = await storage.collectionFor(otherStreamTypeName);

      // Then
      assertNotEqual(collection.collectionName, otherCollection.collectionName);
      assertEqual(
        collection.collectionName,
        `${testStreamTypeName}:${customSuffix}`,
      );
      assertEqual(
        otherCollection.collectionName,
        `${otherStreamTypeName}:${customSuffix}`,
      );
      assertEqual(collection.dbName, customDatabaseName);
      assertEqual(collection.dbName, customDatabaseName);
    });

    void it('handles CUSTOM with collectionFor returning object with collection name and using custom db from options', async () => {
      // Given
      const customDefaultDatabaseName = uuid();
      const collectionForWithDb = (
        streamType: string,
      ): MongoDBEventStoreCollectionResolution => ({
        collectionName: collectionFor(streamType),
      });

      const storage = mongoDBEventStoreStorage({
        storage: {
          type: 'CUSTOM',
          collectionFor: collectionForWithDb,
          databaseName: customDefaultDatabaseName,
        },
        getConnectedClient,
      });

      // When
      const collection = await storage.collectionFor(testStreamTypeName);
      const otherCollection = await storage.collectionFor(otherStreamTypeName);

      // Then
      assertNotEqual(collection.collectionName, otherCollection.collectionName);
      assertEqual(
        collection.collectionName,
        `${testStreamTypeName}:${customSuffix}`,
      );
      assertEqual(
        otherCollection.collectionName,
        `${otherStreamTypeName}:${customSuffix}`,
      );
      assertEqual(collection.dbName, customDefaultDatabaseName);
      assertEqual(collection.dbName, customDefaultDatabaseName);
    });

    void it('handles CUSTOM with collectionFor returning string and custom db', async () => {
      // Given
      const customDatabaseName = uuid();
      const customDefaultDatabaseName = uuid();
      const collectionForWithDb = (
        streamType: string,
      ): MongoDBEventStoreCollectionResolution => ({
        collectionName: collectionFor(streamType),
        databaseName: customDatabaseName,
      });

      const storage = mongoDBEventStoreStorage({
        storage: {
          type: 'CUSTOM',
          collectionFor: collectionForWithDb,
          databaseName: customDefaultDatabaseName,
        },
        getConnectedClient,
      });

      // When
      const collection = await storage.collectionFor(testStreamTypeName);
      const otherCollection = await storage.collectionFor(otherStreamTypeName);

      // Then
      assertNotEqual(collection.collectionName, otherCollection.collectionName);
      assertEqual(
        collection.collectionName,
        `${testStreamTypeName}:${customSuffix}`,
      );
      assertEqual(
        otherCollection.collectionName,
        `${otherStreamTypeName}:${customSuffix}`,
      );
      assertEqual(collection.dbName, customDatabaseName);
      assertEqual(collection.dbName, customDatabaseName);
    });
  });
});
