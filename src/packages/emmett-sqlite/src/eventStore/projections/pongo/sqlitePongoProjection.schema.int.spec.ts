import { mapRows, SQL, SQLTableReference } from '@event-driven-io/dumbo';
import { sqliteTableName } from '@event-driven-io/dumbo/sqlite';
import {
  sqlite3Pool,
  tableExists,
  type SQLite3Connection,
  type SQLitePool,
} from '@event-driven-io/dumbo/sqlite3';
import {
  assertDeepEqual,
  assertFalse,
  assertIsNull,
  assertRejects,
  assertTrue,
  type Event,
} from '@event-driven-io/emmett';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';
import { afterEach, beforeEach, describe, it } from 'vitest';
import { sqlite3EventStoreDriver } from '../../../sqlite3';
import { deleteSQLiteDatabaseFiles } from '../../../testing/sqliteTestDatabase';
import { getSQLiteEventStore } from '../../SQLiteEventStore';
import { SQLiteProjectionSpec } from '../sqliteProjectionSpec';
import { pongoClient, type PongoCollection } from '@event-driven-io/pongo';
import { pongoSingleStreamProjection } from './pongoProjections';
import { expectPongoDocuments } from './pongoProjectionSpec';

const withDeadline = { timeout: 30000 };

void describe('SQLite Pongo projection schema configuration', () => {
  const testDatabasePath = path.dirname(fileURLToPath(import.meta.url));
  const fileName = path.resolve(testDatabasePath, 'pongo-schema.db');
  const databaseSchemaName = 'events';
  const projectionsDatabaseSchemaName = 'read_models';
  const migrationSchemaName = 'infrastructure';
  const migrationTableName = 'emmett_migrations';
  const collectionName = 'shopping_cart_summary';

  let pool: SQLitePool<SQLite3Connection>;

  beforeEach(() => {
    pool = sqlite3Pool({
      fileName,
      transactionOptions: {
        allowNestedTransactions: true,
      },
    });
  });

  afterEach(async () => {
    await pool.close();
    deleteSQLiteDatabaseFiles(fileName);
  });

  void it(
    'stores Pongo projection documents in the configured projection schema',
    withDeadline,
    async () => {
      const streamName = `shopping_cart-${uuid()}`;
      const eventStore = getSQLiteEventStore({
        driver: sqlite3EventStoreDriver,
        fileName,
        schema: {
          autoMigration: 'CreateOrUpdate',
          databaseSchemaName,
          projectionsDatabaseSchemaName,
          migrationTable: {
            schemaName: migrationSchemaName,
            tableName: migrationTableName,
          },
        },
        projections: [
          {
            type: 'inline',
            projection: shoppingCartProjection(collectionName),
          },
        ],
      });

      try {
        await eventStore.appendToStream(streamName, [
          { type: 'ProductItemAdded', data: { quantity: 3 } },
        ]);
      } finally {
        await eventStore.close();
      }

      assertDeepEqual(
        await summaryIn(projectionsDatabaseSchemaName, streamName),
        {
          _id: streamName,
          _version: 1n,
          productItemsCount: 3,
        },
      );
      assertFalse(await tableExists(pool.execute, collectionName));
      assertFalse(
        await tableExists(
          pool.execute,
          sqliteTableName({ databaseSchemaName, tableName: collectionName }),
        ),
      );
      assertTrue(
        (await migrationNames(migrationSchemaName, migrationTableName)).some(
          (name) => name.includes(collectionName),
        ),
      );
    },
  );

  void it(
    'stores Pongo projection documents in the event schema when no projection schema is configured',
    withDeadline,
    async () => {
      const streamName = `shopping_cart-${uuid()}`;
      const eventStore = getSQLiteEventStore({
        driver: sqlite3EventStoreDriver,
        fileName,
        schema: {
          autoMigration: 'CreateOrUpdate',
          databaseSchemaName,
        },
        projections: [
          {
            type: 'inline',
            projection: shoppingCartProjection(collectionName),
          },
        ],
      });

      try {
        await eventStore.appendToStream(streamName, [
          { type: 'ProductItemAdded', data: { quantity: 2 } },
        ]);
      } finally {
        await eventStore.close();
      }

      assertDeepEqual(await summaryIn(databaseSchemaName, streamName), {
        _id: streamName,
        _version: 1n,
        productItemsCount: 2,
      });
      assertFalse(await tableExists(pool.execute, collectionName));
    },
  );

  void it(
    'uses the collection schema configured by the user instead of the projection default',
    withDeadline,
    async () => {
      const collectionSchemaName = 'custom_read_models';
      const streamName = `shopping_cart-${uuid()}`;
      const eventStore = getSQLiteEventStore({
        driver: sqlite3EventStoreDriver,
        fileName,
        schema: {
          autoMigration: 'CreateOrUpdate',
          databaseSchemaName,
          projectionsDatabaseSchemaName,
        },
        projections: [
          {
            type: 'inline',
            projection: shoppingCartProjection(collectionName, {
              databaseSchemaName: collectionSchemaName,
            }),
          },
        ],
      });

      try {
        await eventStore.appendToStream(streamName, [
          { type: 'ProductItemAdded', data: { quantity: 4 } },
        ]);
      } finally {
        await eventStore.close();
      }

      assertDeepEqual(await summaryIn(collectionSchemaName, streamName), {
        _id: streamName,
        _version: 1n,
        productItemsCount: 4,
      });
      assertFalse(
        await tableExists(
          pool.execute,
          sqliteTableName({
            databaseSchemaName: projectionsDatabaseSchemaName,
            tableName: collectionName,
          }),
        ),
      );
      assertFalse(
        await tableExists(
          pool.execute,
          sqliteTableName({ databaseSchemaName, tableName: collectionName }),
        ),
      );
    },
  );

  void it(
    'uses the configured schema names in SQLite projection specs',
    withDeadline,
    async () => {
      const streamName = `shopping_cart-${uuid()}`;

      await SQLiteProjectionSpec.for({
        driver: sqlite3EventStoreDriver,
        fileName,
        pool,
        projection: shoppingCartProjection(collectionName),
        schema: {
          autoMigration: 'CreateOrUpdate',
          databaseSchemaName,
          projectionsDatabaseSchemaName,
          migrationTable: {
            schemaName: migrationSchemaName,
            tableName: migrationTableName,
          },
        },
      })([])
        .when([
          {
            type: 'ProductItemAdded',
            data: { quantity: 5 },
            metadata: { streamName },
          },
        ])
        .then(async () => {
          assertDeepEqual(
            await summaryIn(projectionsDatabaseSchemaName, streamName),
            { _id: streamName, _version: 1n, productItemsCount: 5 },
          );
          assertTrue(
            (
              await migrationNames(migrationSchemaName, migrationTableName)
            ).some((name) => name.includes(collectionName)),
          );
        });
    },
  );

  void it(
    'reads Pongo projection documents from the configured projection schema in assertions',
    withDeadline,
    async () => {
      const streamName = `shopping_cart-${uuid()}`;

      await SQLiteProjectionSpec.for({
        driver: sqlite3EventStoreDriver,
        fileName,
        pool,
        projection: shoppingCartProjection(collectionName),
        schema: {
          autoMigration: 'CreateOrUpdate',
          databaseSchemaName,
          projectionsDatabaseSchemaName,
        },
      })([])
        .when([
          {
            type: 'ProductItemAdded',
            data: { quantity: 7 },
            metadata: { streamName },
          },
        ])
        .then(
          expectPongoDocuments
            .fromCollection<ShoppingCartSummary>(collectionName)
            .withId(streamName)
            .toBeEqual({ productItemsCount: 7 }),
        );
    },
  );

  void it(
    'truncates Pongo projection documents in the configured projection schema',
    withDeadline,
    async () => {
      const streamName = `shopping_cart-${uuid()}`;
      const eventStore = getSQLiteEventStore({
        driver: sqlite3EventStoreDriver,
        fileName,
        schema: {
          autoMigration: 'CreateOrUpdate',
          databaseSchemaName,
          projectionsDatabaseSchemaName,
        },
        projections: [
          {
            type: 'inline',
            projection: shoppingCartProjection(collectionName),
          },
        ],
      });

      try {
        await eventStore.appendToStream(streamName, [
          { type: 'ProductItemAdded', data: { quantity: 6 } },
        ]);

        assertDeepEqual(
          await summaryIn(projectionsDatabaseSchemaName, streamName),
          {
            _id: streamName,
            _version: 1n,
            productItemsCount: 6,
          },
        );

        await eventStore.schema.dangerous.truncate({
          truncateProjections: true,
        });

        assertIsNull(
          await summaryIn(projectionsDatabaseSchemaName, streamName),
        );
      } finally {
        await eventStore.close();
      }
    },
  );

  void it(
    'ignores a Pongo collection migration hash mismatch when the user asks for it',
    withDeadline,
    async () => {
      const streamName = `shopping_cart-${uuid()}`;
      const eventStore = () =>
        getSQLiteEventStore({
          driver: sqlite3EventStoreDriver,
          fileName,
          schema: {
            autoMigration: 'CreateOrUpdate',
            databaseSchemaName,
            projectionsDatabaseSchemaName,
            migrationTable: {
              schemaName: migrationSchemaName,
              tableName: migrationTableName,
            },
          },
          projections: [
            {
              type: 'inline',
              projection: shoppingCartProjection(collectionName),
            },
          ],
        });

      const migrated = eventStore();
      try {
        await migrated.schema.migrate();
      } finally {
        await migrated.close();
      }

      await changeCollectionMigrationHash();

      const rejecting = eventStore();
      try {
        await assertRejects(rejecting.schema.migrate(), (error: Error) =>
          error.message.includes('Migration hash mismatch'),
        );
      } finally {
        await rejecting.close();
      }

      const ignoring = eventStore();
      try {
        await ignoring.schema.migrate({ ignoreMigrationHashMismatch: true });

        await ignoring.appendToStream(streamName, [
          { type: 'ProductItemAdded', data: { quantity: 8 } },
        ]);
      } finally {
        await ignoring.close();
      }

      assertDeepEqual(
        await summaryIn(projectionsDatabaseSchemaName, streamName),
        {
          _id: streamName,
          _version: 1n,
          productItemsCount: 8,
        },
      );
    },
  );

  const changeCollectionMigrationHash = () =>
    pool.execute.command(
      SQL`UPDATE ${SQLTableReference.from({
        databaseSchemaName: migrationSchemaName,
        tableName: migrationTableName,
      })} SET sql_hash = ${'changed'} WHERE name LIKE ${`%${collectionName}%`}`,
    );

  const withSummaries = <Result>(
    databaseSchemaName: string,
    handle: (
      collection: PongoCollection<ShoppingCartSummary>,
    ) => Promise<Result>,
  ): Promise<Result> =>
    pool.withConnection(async (connection) => {
      const driver = (await pongoDriverRegistry.tryResolve(
        connection.driverType,
      ))!;
      const pongo = pongoClient({
        driver,
        connectionOptions: { connection },
        defaultSchemaName: databaseSchemaName,
      });
      try {
        return await handle(
          pongo.db().collection<ShoppingCartSummary>(collectionName),
        );
      } finally {
        await pongo.close();
      }
    });

  const summaryIn = (databaseSchemaName: string, streamName: string) =>
    withSummaries(databaseSchemaName, (summaries) =>
      summaries.findOne({ _id: streamName }),
    );

  const migrationNames = (
    databaseSchemaName: string,
    tableName: string,
  ): Promise<string[]> =>
    mapRows(
      pool.execute.query<{ name: string }>(
        SQL`SELECT name FROM ${SQLTableReference.from({
          databaseSchemaName,
          tableName,
        })}`,
      ),
      ({ name }) => name,
    );
});

type ProductItemAdded = Event<'ProductItemAdded', { quantity: number }>;

type ShoppingCartSummary = {
  productItemsCount: number;
};

const shoppingCartProjection = (
  collectionName: string,
  collectionOptions?: { databaseSchemaName?: string | undefined },
) =>
  pongoSingleStreamProjection<ShoppingCartSummary, ProductItemAdded>({
    collectionName,
    collectionOptions,
    canHandle: ['ProductItemAdded'],
    evolve: (document: ShoppingCartSummary, event: ProductItemAdded) => ({
      productItemsCount: document.productItemsCount + event.data.quantity,
    }),
    initialState: () => ({ productItemsCount: 0 }),
  });
