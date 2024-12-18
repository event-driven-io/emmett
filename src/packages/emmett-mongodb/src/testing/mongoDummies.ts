import type {
  Collection,
  CollectionOptions,
  Db,
  DbOptions,
  Document,
  MongoClient,
} from 'mongodb';

/**
 * Creates a dummy MongoDB collection. It should not be used as in-memory version,
 * but just a dummy replacement for the basic structure and calls test.
 * @param name collection name
 * @param options collection setup options
 * @returns Dummmy collection that has name, dbName and createIndex method
 */
export const getDummyCollection = <TSchema extends Document = Document>(
  name: string,
  options?: CollectionOptions & { dbName?: string },
): Collection<TSchema> => {
  const dummyCollection: Collection<TSchema> = {
    collectionName: name,
    dbName: options?.dbName,
    createIndex: (_indexSpec, _options) => {},
    options,
  } as Collection<TSchema>;
  return dummyCollection;
};

/**
 * Creates a dummy MongoDB database. It should not be used as in-memory version,
 * but just a dummy replacement for the basic structure and calls test.
 * @param dbName database name
 * @param options database setup options
 * @returns Dummmy database that has name and can setup dummy collection
 */
export const getDummyDb = (dbName?: string, options?: DbOptions): Db => {
  const dummyDB: Db = {
    databaseName: dbName!,
    options,
    collection: (name, options) =>
      getDummyCollection(name, { dbName, ...options }),
  } as Db;
  return dummyDB;
};

/**
 * Creates a dummy MongoDB connection. It should not be used as in-memory version,
 * but just a dummy replacement for the basic structure and calls test.
 * @param options setup options allowing to pass the default database name
 * @returns Dummmy connection that can setup a dummy database
 */
export const getDummyClient = (options?: {
  defaultDBName?: string;
}): MongoClient => {
  const dummyClient: MongoClient = {
    db: (name, dbOptions) =>
      getDummyDb(name ?? options?.defaultDBName, dbOptions),
  } as MongoClient;

  return dummyClient;
};
