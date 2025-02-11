import { JSONParser } from '../serialization';

export interface DocumentsCollection<T> {
  store: (id: string, obj: T) => void;
  delete: (id: string) => void;
  get: (id: string) => T | null;
}

export interface Database {
  collection: <T>(name: string) => DocumentsCollection<T>;
}

export const getInMemoryDatabase = (): Database => {
  const storage = new Map<string, unknown>();

  return {
    collection: <T>(
      collectionName: string,
      _collectionOptions: {
        errors?: { throwOnOperationFailures?: boolean } | undefined;
      } = {},
    ): DocumentsCollection<T> => {
      const toFullId = (id: string) => `${collectionName}-${id}`;

      const collection = {
        store: (id: string, obj: T): void => {
          storage.set(toFullId(id), obj);
        },
        delete: (id: string): void => {
          storage.delete(toFullId(id));
        },
        get: (id: string): T | null => {
          const result = storage.get(toFullId(id));

          return result
            ? // Clone to simulate getting new instance on loading
              (JSONParser.parse(JSONParser.stringify(result)) as T)
            : null;
        },
      };

      return collection;
    },
  };
};
