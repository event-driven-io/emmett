import type {
  Collection,
  CollectionOptions,
  Db,
  DbOptions,
  Document,
  MongoClient,
} from 'mongodb';

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

export const getDummyDb = (dbName?: string, options?: DbOptions): Db => {
  const dummyDB: Db = {
    databaseName: dbName!,
    options,
    collection: (name, options) =>
      getDummyCollection(name, { dbName, ...options }),
  } as Db;
  return dummyDB;
};

export const getDummyClient = (options?: {
  defaultDBName?: string;
}): MongoClient => {
  const dummyClient: MongoClient = {
    db: (name, dbOptions) =>
      getDummyDb(name ?? options?.defaultDBName, dbOptions),
  } as MongoClient;

  return dummyClient;
};
