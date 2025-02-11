import { type Event } from '@event-driven-io/emmett';
import type { Collection, Db, MongoClient } from 'mongodb';
import {
  toStreamCollectionName,
  type EventStream,
  type StreamType,
} from '../mongoDBStreamAsDocumentEventStore';

export type MongoDBEventStoreCollectionPerStreamTypeStorageOptions = {
  /**
   * The recommended setting where each stream type will be kept
   * in a separate collection type using the format: `emt_${streamType}`.
   */
  type: 'COLLECTION_PER_STREAM_TYPE';
  databaseName?: string;
};

export type MongoDBEventStoreSingleCollectionStorageOptions = {
  /**
   * All streams will be kept withing a single MongDB collection
   * It'll either use default collection name ("emt_streams")
   * or provided name through 'collection' param.
   */
  type: 'SINGLE_COLLECTION';
  collectionName?: string;
  databaseName?: string;
};

export type MongoDBEventStoreCollectionResolution = {
  databaseName?: string;
  collectionName: string;
};

export type MongoDBEventStoreCustomStorageOptions = {
  /**
   * This is advanced option, where you specify your own collection
   * resolution function. You can do that by specifying the `collectionFor` function.
   */
  type: 'CUSTOM';
  databaseName?: string;
  collectionFor: <T extends StreamType>(
    streamType: T,
  ) => string | MongoDBEventStoreCollectionResolution;
};

export type MongoDBEventStoreStorageOptions =
  | 'COLLECTION_PER_STREAM_TYPE'
  | 'SINGLE_COLLECTION'
  | MongoDBEventStoreSingleCollectionStorageOptions
  | MongoDBEventStoreCollectionPerStreamTypeStorageOptions
  | MongoDBEventStoreCustomStorageOptions;

export const DefaultMongoDBEventStoreStorageOptions =
  'COLLECTION_PER_STREAM_TYPE';

export type MongoDBEventStoreStorage = {
  collectionFor: <T extends StreamType, EventType extends Event = Event>(
    streamType: T,
  ) => Promise<Collection<EventStream<EventType>>>;
};

export const DefaultMongoDBEventStoreCollectionName = 'emt:streams';

const resolveCollectionAndDatabase = <T extends StreamType>(
  streamType: T,
  options: MongoDBEventStoreStorageOptions,
): MongoDBEventStoreCollectionResolution => {
  if (
    options === 'SINGLE_COLLECTION' ||
    (typeof options === 'object' && options.type === 'SINGLE_COLLECTION')
  ) {
    return {
      collectionName:
        typeof options === 'object'
          ? (options.collectionName ?? DefaultMongoDBEventStoreCollectionName)
          : DefaultMongoDBEventStoreCollectionName,
      databaseName:
        typeof options === 'object' ? options.databaseName : undefined,
    };
  } else if (
    options === 'COLLECTION_PER_STREAM_TYPE' ||
    (typeof options === 'object' &&
      options.type === 'COLLECTION_PER_STREAM_TYPE')
  ) {
    return {
      collectionName: toStreamCollectionName(streamType),
      databaseName:
        typeof options === 'object' ? options.databaseName : undefined,
    };
  } else {
    const result = options.collectionFor(streamType);
    return {
      collectionName:
        typeof result === 'object' ? result.collectionName : result,
      databaseName:
        typeof result === 'object'
          ? (result.databaseName ?? options.databaseName)
          : options.databaseName,
    };
  }
};

const getDB = async (options: {
  databaseName: string | undefined;
  dbsCache: Map<string, Db>;
  getConnectedClient: () => Promise<MongoClient>;
}): Promise<Db> => {
  const { dbsCache, databaseName, getConnectedClient } = options;
  const safeDbName = databaseName ?? '___default';

  let db = dbsCache.get(safeDbName);

  if (!db) {
    const connectedClient = await getConnectedClient();

    db = connectedClient.db(databaseName);

    dbsCache.set(safeDbName, db);
  }

  return db;
};

const collectionFor = async <EventType extends Event = Event>(options: {
  collectionName: string;
  streamCollections: Map<string, Collection<EventStream>>;
  db: Db;
}): Promise<Collection<EventStream<EventType>>> => {
  const { collectionName, db, streamCollections } = options;

  let collection = streamCollections.get(collectionName) as
    | Collection<EventStream<EventType>>
    | undefined;

  if (!collection) {
    collection = db.collection<EventStream<EventType>>(collectionName);
    await collection.createIndex({ streamName: 1 }, { unique: true });

    streamCollections.set(
      collectionName,
      collection as Collection<EventStream>,
    );
  }

  return collection;
};

export const mongoDBEventStoreStorage = (options: {
  storage?: MongoDBEventStoreStorageOptions | undefined;
  getConnectedClient: () => Promise<MongoClient>;
}): MongoDBEventStoreStorage => {
  const dbsCache: Map<string, Db> = new Map();
  const streamCollections: Map<string, Collection<EventStream>> = new Map();
  const storageOptions =
    options.storage ?? DefaultMongoDBEventStoreStorageOptions;

  const { getConnectedClient } = options;

  return {
    collectionFor: async <
      T extends StreamType,
      EventType extends Event = Event,
    >(
      streamType: T,
    ): Promise<Collection<EventStream<EventType>>> => {
      const { collectionName, databaseName } = resolveCollectionAndDatabase(
        streamType,
        storageOptions,
      );

      let collection = streamCollections.get(collectionName) as
        | Collection<EventStream<EventType>>
        | undefined;

      if (!collection) {
        const db = await getDB({ databaseName, dbsCache, getConnectedClient });
        collection = await collectionFor<EventType>({
          collectionName,
          streamCollections,
          db,
        });
      }

      return collection;
    },
  };
};
