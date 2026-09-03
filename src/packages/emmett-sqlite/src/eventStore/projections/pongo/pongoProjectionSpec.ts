import type { DatabaseDriverType } from '@event-driven-io/dumbo';
import type { AnySQLiteConnection } from '@event-driven-io/dumbo/sqlite';
import {
  assertDeepEqual,
  assertEqual,
  assertIsNotNull,
  assertIsNull,
  assertThatArray,
} from '@event-driven-io/emmett';
import {
  pongoClient,
  type PongoCollection,
  type PongoDBCollectionOptions,
  type PongoDocument,
  type PongoFilter,
  type WithId,
} from '@event-driven-io/pongo';
import type { SQLiteProjectionAssert } from '..';
import type { EventStoreDatabaseSchemaOptions } from '../../schema';

export type PongoAssertOptions = {
  inCollection: string;
  inDatabase?: string;
  collectionOptions?: PongoDBCollectionOptions<PongoDocument>;
};

const withCollection = async (
  handle: (collection: PongoCollection<PongoDocument>) => Promise<void>,
  options: {
    connection: AnySQLiteConnection;
    migrationOptions?: EventStoreDatabaseSchemaOptions | undefined;
  } & PongoAssertOptions,
) => {
  const {
    connection,
    inDatabase,
    inCollection,
    collectionOptions,
    migrationOptions,
  } = options;

  const driver = (await pongoDriverRegistry.tryResolve(
    connection.driverType as DatabaseDriverType,
  ))!;
  const pongo = pongoClient({
    connectionOptions: { connection },
    driver,
    defaultSchemaName: migrationOptions?.projectionsDatabaseSchemaName,
    migrationTable: migrationOptions?.migrationTable,
  });
  try {
    const collection = pongo
      .db(inDatabase)
      .collection(inCollection, collectionOptions);

    return handle(collection);
  } finally {
    await pongo.close();
  }
};

const withoutIdAndVersion = <Doc extends PongoDocument | WithId<PongoDocument>>(
  doc: Doc,
) => {
  const { _id, _version, ...without } = doc;

  return without;
};

const assertDocumentsEqual = <
  Doc extends PongoDocument | WithId<PongoDocument>,
>(
  actual: PongoDocument,
  expected: Doc,
) => {
  if ('_id' in expected)
    assertEqual(
      expected._id,
      actual._id,
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      `Document ids are not matching! Expected: ${expected._id}, Actual: ${actual._id}`,
    );

  return assertDeepEqual(
    withoutIdAndVersion(actual),
    withoutIdAndVersion(expected),
  );
};

type FilterOrId<Doc extends PongoDocument | WithId<PongoDocument>> =
  | { withId: string }
  | {
      matchingFilter: PongoFilter<Doc>;
    };

export const documentExists =
  <Doc extends PongoDocument | WithId<PongoDocument>>(
    document: Doc,
    options: PongoAssertOptions & FilterOrId<Doc>,
  ): SQLiteProjectionAssert =>
  (assertOptions) =>
    withCollection(
      async (collection) => {
        const result = await collection.findOne(
          'withId' in options
            ? { _id: options.withId }
            : options.matchingFilter,
        );

        assertIsNotNull(result);

        assertDocumentsEqual(result, document);
      },
      { ...options, ...assertOptions },
    );

export const documentsAreTheSame =
  <Doc extends PongoDocument | WithId<PongoDocument>>(
    documents: Doc[],
    options: PongoAssertOptions & FilterOrId<Doc>,
  ): SQLiteProjectionAssert =>
  (assertOptions) =>
    withCollection(
      async (collection) => {
        const result = await collection.find(
          'withId' in options
            ? { _id: options.withId }
            : options.matchingFilter,
        );

        assertEqual(
          documents.length,
          result.length,
          'Different Documents Count than expected',
        );

        for (let i = 0; i < documents.length; i++) {
          assertThatArray(result as Doc[]).contains(documents[i]!);
        }
      },
      { ...options, ...assertOptions },
    );

export const documentsMatchingHaveCount =
  <Doc extends PongoDocument | WithId<PongoDocument>>(
    expectedCount: number,
    options: PongoAssertOptions & FilterOrId<Doc>,
  ): SQLiteProjectionAssert =>
  (assertOptions) =>
    withCollection(
      async (collection) => {
        const result = await collection.find(
          'withId' in options
            ? { _id: options.withId }
            : options.matchingFilter,
        );

        assertEqual(
          expectedCount,
          result.length,
          'Different Documents Count than expected',
        );
      },
      { ...options, ...assertOptions },
    );

export const documentMatchingExists =
  <Doc extends PongoDocument | WithId<PongoDocument>>(
    options: PongoAssertOptions & FilterOrId<Doc>,
  ): SQLiteProjectionAssert =>
  (assertOptions) =>
    withCollection(
      async (collection) => {
        const result = await collection.find(
          'withId' in options
            ? { _id: options.withId }
            : options.matchingFilter,
        );

        assertThatArray(result).isNotEmpty();
      },
      { ...options, ...assertOptions },
    );

export const documentDoesNotExist =
  <Doc extends PongoDocument | WithId<PongoDocument>>(
    options: PongoAssertOptions & FilterOrId<Doc>,
  ): SQLiteProjectionAssert =>
  (assertOptions) =>
    withCollection(
      async (collection) => {
        const result = await collection.findOne(
          'withId' in options
            ? { _id: options.withId }
            : options.matchingFilter,
        );

        assertIsNull(result);
      },
      { ...options, ...assertOptions },
    );

export const expectPongoDocuments = {
  fromCollection: <Doc extends PongoDocument | WithId<PongoDocument>>(
    collectionName: string,
    collectionOptions?: PongoDBCollectionOptions<PongoDocument>,
  ) => {
    return {
      withId: (id: string) => {
        return {
          toBeEqual: (document: Doc) =>
            documentExists(document, {
              withId: id,
              inCollection: collectionName,
              collectionOptions,
            }),
          toExist: () =>
            documentMatchingExists({
              withId: id,
              inCollection: collectionName,
              collectionOptions,
            }),
          notToExist: () =>
            documentDoesNotExist({
              withId: id,
              inCollection: collectionName,
              collectionOptions,
            }),
        };
      },
      matching: <Doc extends PongoDocument | WithId<PongoDocument>>(
        filter: PongoFilter<Doc>,
      ) => {
        return {
          toBeTheSame: (documents: Doc[]) =>
            documentsAreTheSame<Doc>(documents, {
              matchingFilter: filter,
              inCollection: collectionName,
              collectionOptions,
            }),
          toHaveCount: (expectedCount: number) =>
            documentsMatchingHaveCount(expectedCount, {
              matchingFilter: filter,
              inCollection: collectionName,
              collectionOptions,
            }),
          toExist: () =>
            documentMatchingExists({
              matchingFilter: filter,
              inCollection: collectionName,
              collectionOptions,
            }),
          notToExist: () =>
            documentDoesNotExist({
              matchingFilter: filter,
              inCollection: collectionName,
              collectionOptions,
            }),
        };
      },
    };
  },
};
