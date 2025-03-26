import { v7 as uuid } from 'uuid';
import { deepEquals } from '../utils';
import {
  type DeleteResult,
  type Document,
  type DocumentHandler,
  type HandleOptionErrors,
  type HandleOptions,
  type HandleResult,
  type InsertOneResult,
  type OptionalUnlessRequiredIdAndVersion,
  type ReplaceOneOptions,
  type UpdateResult,
  type WithoutId,
  type WithIdAndVersion,
} from './types';
import { expectedVersionValue, operationResult } from './utils';

export interface DocumentsCollection<T extends Document> {
  handle: (
    id: string,
    handle: DocumentHandler<T>,
    options?: HandleOptions,
  ) => HandleResult<T>;
  findOne: (predicate?: Predicate<T>) => T | null;
  find: (predicate?: Predicate<T>) => T[];
  insertOne: (
    document: OptionalUnlessRequiredIdAndVersion<T>,
  ) => InsertOneResult;
  deleteOne: (predicate?: Predicate<T>) => DeleteResult;
  replaceOne: (
    predicate: Predicate<T>,
    document: WithoutId<T>,
    options?: ReplaceOneOptions,
  ) => UpdateResult;
}

export interface Database {
  collection: <T extends Document>(name: string) => DocumentsCollection<T>;
}

type Predicate<T> = (item: T) => boolean;
type CollectionName = string;

export const getInMemoryDatabase = (): Database => {
  const storage = new Map<CollectionName, WithIdAndVersion<Document>[]>();

  return {
    collection: <T extends Document, CollectionName extends string>(
      collectionName: CollectionName,
      collectionOptions: {
        errors?: HandleOptionErrors;
      } = {},
    ): DocumentsCollection<T> => {
      const ensureCollectionCreated = () => {
        if (!storage.has(collectionName)) storage.set(collectionName, []);
      };

      const errors = collectionOptions.errors;

      const collection = {
        collectionName,
        insertOne: (
          document: OptionalUnlessRequiredIdAndVersion<T>,
        ): InsertOneResult => {
          ensureCollectionCreated();

          const _id = (document._id as string | undefined | null) ?? uuid();
          const _version = document._version ?? 1n;

          const existing = collection.findOne((c) => c._id === _id);

          if (existing) {
            return operationResult<InsertOneResult>(
              {
                successful: false,
                insertedId: null,
                nextExpectedVersion: _version,
              },
              { operationName: 'insertOne', collectionName, errors },
            );
          }

          const documentsInCollection = storage.get(collectionName)!;
          const newDocument = { ...document, _id, _version };
          const newCollection = [...documentsInCollection, newDocument];
          storage.set(collectionName, newCollection);

          return operationResult<InsertOneResult>(
            {
              successful: true,
              insertedId: _id,
              nextExpectedVersion: _version,
            },
            { operationName: 'insertOne', collectionName, errors },
          );
        },
        findOne: (predicate?: Predicate<T>): T | null => {
          ensureCollectionCreated();

          const documentsInCollection = storage.get(collectionName);
          const filteredDocuments = predicate
            ? documentsInCollection?.filter((doc) => predicate(doc as T))
            : documentsInCollection;

          const firstOne = filteredDocuments?.[0] ?? null;

          return firstOne as T | null;
        },
        find: (predicate?: Predicate<T>): T[] => {
          ensureCollectionCreated();

          const documentsInCollection = storage.get(collectionName);
          const filteredDocuments = predicate
            ? documentsInCollection?.filter((doc) => predicate(doc as T))
            : documentsInCollection;

          return filteredDocuments as T[];
        },
        deleteOne: (predicate?: Predicate<T>): DeleteResult => {
          ensureCollectionCreated();

          const documentsInCollection = storage.get(collectionName)!;

          if (predicate) {
            const foundIndex = documentsInCollection.findIndex((doc) =>
              predicate(doc as T),
            );

            if (foundIndex === -1) {
              return operationResult<DeleteResult>(
                {
                  successful: false,
                  matchedCount: 0,
                  deletedCount: 0,
                },
                { operationName: 'deleteOne', collectionName, errors },
              );
            } else {
              const newCollection = documentsInCollection.toSpliced(
                foundIndex,
                1,
              );

              storage.set(collectionName, newCollection);

              return operationResult<DeleteResult>(
                {
                  successful: true,
                  matchedCount: 1,
                  deletedCount: 1,
                },
                { operationName: 'deleteOne', collectionName, errors },
              );
            }
          }

          const newCollection = documentsInCollection.slice(1);

          storage.set(collectionName, newCollection);

          return operationResult<DeleteResult>(
            {
              successful: true,
              matchedCount: 1,
              deletedCount: 1,
            },
            { operationName: 'deleteOne', collectionName, errors },
          );
        },
        replaceOne: (
          predicate: Predicate<T>,
          document: WithoutId<T>,
          options?: ReplaceOneOptions,
        ): UpdateResult => {
          ensureCollectionCreated();

          const documentsInCollection = storage.get(collectionName)!;

          const foundIndexes = documentsInCollection
            .filter((doc) => predicate(doc as T))
            .map((_, index) => index);

          const firstIndex = foundIndexes[0];

          if (firstIndex === undefined || firstIndex === -1) {
            return operationResult<UpdateResult>(
              {
                successful: false,
                matchedCount: 0,
                modifiedCount: 0,
                nextExpectedVersion: 0n,
              },
              { operationName: 'replaceOne', collectionName, errors },
            );
          }

          const existing = documentsInCollection[firstIndex]!;

          if (
            typeof options?.expectedVersion === 'bigint' &&
            existing._version !== options.expectedVersion
          ) {
            return operationResult<UpdateResult>(
              {
                successful: false,
                matchedCount: 1,
                modifiedCount: 0,
                nextExpectedVersion: existing._version,
              },
              { operationName: 'replaceOne', collectionName, errors },
            );
          }

          const newVersion = existing._version + 1n;

          const newCollection = documentsInCollection.with(firstIndex, {
            _id: existing._id,
            ...document,
            _version: newVersion,
          });

          storage.set(collectionName, newCollection);

          return operationResult<UpdateResult>(
            {
              successful: true,
              modifiedCount: 1,
              matchedCount: foundIndexes.length,
              nextExpectedVersion: newVersion,
            },
            { operationName: 'replaceOne', collectionName, errors },
          );
        },
        handle: (
          id: string,
          handle: DocumentHandler<T>,
          options?: HandleOptions,
        ): HandleResult<T> => {
          const { expectedVersion: version, ...operationOptions } =
            options ?? {};
          ensureCollectionCreated();
          const existing = collection.findOne(({ _id }) => _id === id);

          const expectedVersion = expectedVersionValue(version);

          if (
            (existing == null && version === 'DOCUMENT_EXISTS') ||
            (existing == null && expectedVersion != null) ||
            (existing != null && version === 'DOCUMENT_DOES_NOT_EXIST') ||
            (existing != null &&
              expectedVersion !== null &&
              existing._version !== expectedVersion)
          ) {
            return operationResult<HandleResult<T>>(
              {
                successful: false,
                document: existing as WithIdAndVersion<T>,
              },
              { operationName: 'handle', collectionName, errors },
            );
          }

          const result = handle(existing !== null ? { ...existing } : null);

          if (deepEquals(existing, result))
            return operationResult<HandleResult<T>>(
              {
                successful: true,
                document: existing as WithIdAndVersion<T>,
              },
              { operationName: 'handle', collectionName, errors },
            );

          if (!existing && result) {
            const newDoc = { ...result, _id: id };
            const insertResult = collection.insertOne({
              ...newDoc,
              _id: id,
            } as OptionalUnlessRequiredIdAndVersion<T>);
            return {
              ...insertResult,
              document: {
                ...newDoc,
                _version: insertResult.nextExpectedVersion,
              } as unknown as WithIdAndVersion<T>,
            };
          }

          if (existing && !result) {
            const deleteResult = collection.deleteOne(({ _id }) => id === _id);
            return { ...deleteResult, document: null };
          }

          if (existing && result) {
            const replaceResult = collection.replaceOne(
              ({ _id }) => id === _id,
              result,
              {
                ...operationOptions,
                expectedVersion: expectedVersion ?? 'DOCUMENT_EXISTS',
              },
            );
            return {
              ...replaceResult,
              document: {
                ...result,
                _version: replaceResult.nextExpectedVersion,
              } as unknown as WithIdAndVersion<T>,
            };
          }

          return operationResult<HandleResult<T>>(
            {
              successful: true,
              document: existing as WithIdAndVersion<T>,
            },
            { operationName: 'handle', collectionName, errors },
          );
        },
      };

      return collection;
    },
  };
};
