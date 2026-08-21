import type { Dumbo } from '@event-driven-io/dumbo';
import type { EventStoreDatabaseSchemaOptions } from '../../schema';
import type { PgConnection } from '@event-driven-io/dumbo/pg';
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
import { pgDriver } from '@event-driven-io/pongo/pg';
import type { PostgreSQLProjectionAssert } from '..';

export type PongoAssertOptions<
  Doc extends PongoDocument = PongoDocument,
  DocumentPayload extends PongoDocument = Doc,
> = {
  inCollection: string;
  inDatabase?: string;
  collectionOptions?: PongoDBCollectionOptions<Doc, DocumentPayload>;
};

const withCollection = <
  Doc extends PongoDocument,
  DocumentPayload extends PongoDocument = Doc,
>(
  handle: (collection: PongoCollection<Doc>) => Promise<void>,
  options: {
    pool: Dumbo;
    connectionString: string;
    migrationOptions?: EventStoreDatabaseSchemaOptions | undefined;
  } & PongoAssertOptions<Doc, DocumentPayload>,
) => {
  const {
    pool,
    connectionString,
    inDatabase,
    inCollection,
    collectionOptions,
    migrationOptions,
  } = options;

  return pool.withConnection(async (connection) => {
    const pongo = pongoClient({
      connectionString,
      connectionOptions: {
        connection: connection as PgConnection,
        transactionOptions: {
          allowNestedTransactions: true,
        },
      },
      driver: pgDriver,
      defaultSchemaName: migrationOptions?.projectionsDatabaseSchemaName,
      migrationTable: migrationOptions?.migrationTable,
    });
    try {
      const collection = pongo
        .db(inDatabase)
        .collection<Doc, DocumentPayload>(inCollection, collectionOptions);

      return handle(collection);
    } finally {
      await pongo.close();
    }
  });
};

export type PongoDocumentComparisonOptions = {
  normalizeDates?: boolean;
};

const normalizeDateValues = (value: unknown): unknown => {
  if (value instanceof Date) return value.toISOString();

  if (Array.isArray(value)) return value.map(normalizeDateValues);

  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        normalizeDateValues(nestedValue),
      ]),
    );

  return value;
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
  options?: PongoDocumentComparisonOptions,
) => {
  if ('_id' in expected)
    assertEqual(
      expected._id,
      actual._id,
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      `Document ids are not matching! Expected: ${expected._id}, Actual: ${actual._id}`,
    );
  if ('_version' in expected)
    assertEqual(
      expected._version,
      actual._version,
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      `Document versions are not matching! Expected: ${expected._version}, Actual: ${actual._version}`,
    );

  const actualDocument = withoutIdAndVersion(actual);
  const expectedDocument = withoutIdAndVersion(expected);

  return assertDeepEqual(
    options?.normalizeDates
      ? normalizeDateValues(actualDocument)
      : actualDocument,
    options?.normalizeDates
      ? normalizeDateValues(expectedDocument)
      : expectedDocument,
  );
};

type FilterOrId<Doc extends PongoDocument | WithId<PongoDocument>> =
  | { withId: string }
  | {
      matchingFilter: PongoFilter<Doc>;
    };

export const documentExists =
  <
    Doc extends PongoDocument | WithId<PongoDocument>,
    DocumentPayload extends PongoDocument = Doc,
  >(
    document: Doc,
    options: PongoAssertOptions<Doc, DocumentPayload> &
      FilterOrId<Doc> &
      PongoDocumentComparisonOptions,
  ): PostgreSQLProjectionAssert =>
  (assertOptions) =>
    withCollection<Doc, DocumentPayload>(
      async (collection) => {
        const result = await collection.findOne(
          'withId' in options
            ? { _id: options.withId }
            : options.matchingFilter,
        );

        assertIsNotNull(result);

        assertDocumentsEqual(result, document, options);
      },
      { ...options, ...assertOptions },
    );

export const documentsAreTheSame =
  <
    Doc extends PongoDocument | WithId<PongoDocument>,
    DocumentPayload extends PongoDocument = Doc,
  >(
    documents: Doc[],
    options: PongoAssertOptions<Doc, DocumentPayload> & FilterOrId<Doc>,
  ): PostgreSQLProjectionAssert =>
  (assertOptions) =>
    withCollection<Doc, DocumentPayload>(
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
  <
    Doc extends PongoDocument | WithId<PongoDocument>,
    DocumentPayload extends PongoDocument = Doc,
  >(
    expectedCount: number,
    options: PongoAssertOptions<Doc, DocumentPayload> & FilterOrId<Doc>,
  ): PostgreSQLProjectionAssert =>
  (assertOptions) =>
    withCollection<Doc, DocumentPayload>(
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
  <
    Doc extends PongoDocument | WithId<PongoDocument>,
    DocumentPayload extends PongoDocument = Doc,
  >(
    options: PongoAssertOptions<Doc, DocumentPayload> & FilterOrId<Doc>,
  ): PostgreSQLProjectionAssert =>
  (assertOptions) =>
    withCollection<Doc, DocumentPayload>(
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
  <
    Doc extends PongoDocument | WithId<PongoDocument>,
    DocumentPayload extends PongoDocument = Doc,
  >(
    options: PongoAssertOptions<Doc, DocumentPayload> & FilterOrId<Doc>,
  ): PostgreSQLProjectionAssert =>
  (assertOptions) =>
    withCollection<Doc, DocumentPayload>(
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
  fromCollection: <
    Doc extends PongoDocument | WithId<PongoDocument>,
    DocumentPayload extends PongoDocument = Doc,
  >(
    collectionName: string,
    collectionOptions?: PongoDBCollectionOptions<Doc, DocumentPayload>,
  ) => {
    return {
      withId: (id: string) => {
        return {
          toBeEqual: (
            document: Doc,
            comparisonOptions?: PongoDocumentComparisonOptions,
          ) =>
            documentExists<Doc, DocumentPayload>(document, {
              withId: id,
              inCollection: collectionName,
              collectionOptions,
              ...comparisonOptions,
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
      matching: (filter: PongoFilter<Doc>) => {
        return {
          toBeTheSame: (documents: Doc[]) =>
            documentsAreTheSame<Doc, DocumentPayload>(documents, {
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
