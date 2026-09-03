import { dumbo, mapRows, SQL, SQLTableReference } from '@event-driven-io/dumbo';
import { pgDumboDriver, type PgPool } from '@event-driven-io/dumbo/pg';
import {
  assertDeepEqual,
  assertIsNull,
  assertFalse,
  assertRejects,
  assertTrue,
  type Event,
} from '@event-driven-io/emmett';
import { v4 as uuid } from 'uuid';
import { afterAll, beforeAll, describe, it } from 'vitest';
import {
  sharedPostgreSQLDatabase,
  type PostgreSQLTestDatabase,
} from '../../../testing/postgreSQLTestDatabase';
import { getPostgreSQLEventStore } from '../../postgreSQLEventStore';
import { tableExists } from '../../../testing/schemaObjects';
import { PostgreSQLProjectionSpec } from '../postgresProjectionSpec';
import { pongoClient, type PongoCollection } from '@event-driven-io/pongo';
import { pgDriver } from '@event-driven-io/pongo/pg';
import { pongoSingleStreamProjection } from './pongoProjections';
import { expectPongoDocuments } from './pongoProjectionSpec';

const withDeadline = { timeout: 30000 };

void describe('PostgreSQL Pongo projection schema configuration', () => {
  let database: PostgreSQLTestDatabase;
  let connectionString: string;
  let pool: PgPool;

  beforeAll(async () => {
    database = await sharedPostgreSQLDatabase();
    connectionString = database.connectionString;
    pool = dumbo({
      connectionString,
      driver: pgDumboDriver,
      transactionOptions: {
        allowNestedTransactions: true,
      },
    });
  });

  afterAll(async () => {
    try {
      await pool?.close();
      await database?.close();
    } catch (error) {
      console.log(error);
    }
  });

  void it(
    'stores Pongo projection documents in the configured projection schema',
    withDeadline,
    async () => {
      const eventSchemaName = schemaName('events');
      const projectionSchemaName = schemaName('read_models');
      const migrationSchemaName = schemaName('infrastructure');
      const migrationTableName = 'emmett_migrations';
      const collectionName = schemaName('shopping_cart_summary');
      const streamName = `shopping_cart:${uuid()}`;

      const store = getPostgreSQLEventStore(connectionString, {
        schema: {
          autoMigration: 'CreateOrUpdate',
          databaseSchemaName: eventSchemaName,
          projectionsDatabaseSchemaName: projectionSchemaName,
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
        await store.appendToStream(streamName, [
          { type: 'ProductItemAdded', data: { quantity: 3 } },
        ]);

        assertDeepEqual(
          await summaryIn(projectionSchemaName, collectionName, streamName),
          { _id: streamName, _version: 1n, productItemsCount: 3 },
        );
        assertFalse(
          await tableExists(pool.execute, collectionName, eventSchemaName),
        );
        assertFalse(await tableExists(pool.execute, collectionName));
        assertTrue(
          (await migrationRows(migrationSchemaName, migrationTableName)).some(
            (name) => name.includes(collectionName),
          ),
        );
      } finally {
        await store.close();
      }
    },
  );

  void it(
    'uses the collection schema configured by the user instead of the projection default',
    withDeadline,
    async () => {
      const eventSchemaName = schemaName('events');
      const projectionSchemaName = schemaName('read_models');
      const collectionSchemaName = schemaName('custom_read_models');
      const collectionName = schemaName('shopping_cart_summary');
      const streamName = `shopping_cart:${uuid()}`;
      const store = getPostgreSQLEventStore(connectionString, {
        schema: {
          autoMigration: 'CreateOrUpdate',
          databaseSchemaName: eventSchemaName,
          projectionsDatabaseSchemaName: projectionSchemaName,
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
        await store.appendToStream(streamName, [
          { type: 'ProductItemAdded', data: { quantity: 4 } },
        ]);

        assertDeepEqual(
          await summaryIn(collectionSchemaName, collectionName, streamName),
          { _id: streamName, _version: 1n, productItemsCount: 4 },
        );
        assertFalse(
          await tableExists(pool.execute, collectionName, projectionSchemaName),
        );
        assertFalse(
          await tableExists(pool.execute, collectionName, eventSchemaName),
        );
      } finally {
        await store.close();
      }
    },
  );

  void it(
    'stores Pongo projection documents when configured schema names require quoting',
    withDeadline,
    async () => {
      const eventSchemaName = schemaNameRequiringQuotes('Events');
      const projectionSchemaName = schemaNameRequiringQuotes('Read-Models');
      const migrationSchemaName = schemaNameRequiringQuotes('Infrastructure');
      const migrationTableName = tableNameRequiringQuotes('Emmett-Migrations');
      const collectionName = tableNameRequiringQuotes('Shopping-Cart-Summary');
      const streamName = `shopping_cart:${uuid()}`;

      const store = getPostgreSQLEventStore(connectionString, {
        schema: {
          autoMigration: 'CreateOrUpdate',
          databaseSchemaName: eventSchemaName,
          projectionsDatabaseSchemaName: projectionSchemaName,
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
        await store.appendToStream(streamName, [
          { type: 'ProductItemAdded', data: { quantity: 7 } },
        ]);

        assertDeepEqual(
          await summaryIn(projectionSchemaName, collectionName, streamName),
          { _id: streamName, _version: 1n, productItemsCount: 7 },
        );
        assertFalse(
          await tableExists(pool.execute, collectionName, eventSchemaName),
        );
        assertFalse(await tableExists(pool.execute, collectionName));
        assertTrue(
          (await migrationRows(migrationSchemaName, migrationTableName)).some(
            (name) => name.includes(collectionName),
          ),
        );
      } finally {
        await store.close();
      }
    },
  );

  for (const { description, nameWith } of trickySchemaNameStyles) {
    void it(
      `stores Pongo projection documents when configured schema names contain ${description}`,
      withDeadline,
      async () => {
        const eventSchemaName = nameWith('events');
        const projectionSchemaName = nameWith('read_models');
        const migrationSchemaName = nameWith('infrastructure');
        const migrationTableName = schemaName('emmett_migrations');
        const collectionName = schemaName('shopping_cart_summary');
        const streamName = `shopping_cart:${uuid()}`;

        const store = getPostgreSQLEventStore(connectionString, {
          schema: {
            autoMigration: 'CreateOrUpdate',
            databaseSchemaName: eventSchemaName,
            projectionsDatabaseSchemaName: projectionSchemaName,
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
          await store.appendToStream(streamName, [
            { type: 'ProductItemAdded', data: { quantity: 8 } },
          ]);

          assertDeepEqual(
            await summaryIn(projectionSchemaName, collectionName, streamName),
            { _id: streamName, _version: 1n, productItemsCount: 8 },
          );
          assertFalse(
            await tableExists(pool.execute, collectionName, eventSchemaName),
          );
          assertTrue(
            (await migrationRows(migrationSchemaName, migrationTableName)).some(
              (name) => name.includes(collectionName),
            ),
          );
        } finally {
          await store.close();
        }
      },
    );
  }

  void it(
    'uses configured schema names in PostgreSQL projection specs',
    withDeadline,
    async () => {
      const eventSchemaName = schemaName('events');
      const projectionSchemaName = schemaName('read_models');
      const migrationSchemaName = schemaName('infrastructure');
      const migrationTableName = 'emmett_migrations';
      const collectionName = schemaName('shopping_cart_summary');
      const streamName = `shopping_cart:${uuid()}`;

      await PostgreSQLProjectionSpec.for<ProductItemAdded>({
        connectionString,
        projection: shoppingCartProjection(collectionName),
        schema: {
          autoMigration: 'CreateOrUpdate',
          databaseSchemaName: eventSchemaName,
          projectionsDatabaseSchemaName: projectionSchemaName,
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
            await summaryIn(projectionSchemaName, collectionName, streamName),
            { _id: streamName, _version: 1n, productItemsCount: 5 },
          );
          assertTrue(
            (await migrationRows(migrationSchemaName, migrationTableName)).some(
              (name) => name.includes(collectionName),
            ),
          );
        });
    },
  );

  void it(
    'stores Pongo projection documents in the event schema when no projection schema is configured',
    withDeadline,
    async () => {
      const eventSchemaName = schemaName('events');
      const collectionName = schemaName('shopping_cart_summary');
      const streamName = `shopping_cart:${uuid()}`;

      const store = getPostgreSQLEventStore(connectionString, {
        schema: {
          autoMigration: 'CreateOrUpdate',
          databaseSchemaName: eventSchemaName,
        },
        projections: [
          {
            type: 'inline',
            projection: shoppingCartProjection(collectionName),
          },
        ],
      });

      try {
        await store.appendToStream(streamName, [
          { type: 'ProductItemAdded', data: { quantity: 2 } },
        ]);

        assertDeepEqual(
          await summaryIn(eventSchemaName, collectionName, streamName),
          { _id: streamName, _version: 1n, productItemsCount: 2 },
        );
        assertFalse(await tableExists(pool.execute, collectionName));
      } finally {
        await store.close();
      }
    },
  );

  void it(
    'reads Pongo projection documents from the configured projection schema in assertions',
    withDeadline,
    async () => {
      const eventSchemaName = schemaName('events');
      const projectionSchemaName = schemaName('read_models');
      const collectionName = schemaName('shopping_cart_summary');
      const streamName = `shopping_cart:${uuid()}`;

      await PostgreSQLProjectionSpec.for<ProductItemAdded>({
        connectionString,
        projection: shoppingCartProjection(collectionName),
        schema: {
          autoMigration: 'CreateOrUpdate',
          databaseSchemaName: eventSchemaName,
          projectionsDatabaseSchemaName: projectionSchemaName,
        },
      })([])
        .when([
          {
            type: 'ProductItemAdded',
            data: { quantity: 9 },
            metadata: { streamName },
          },
        ])
        .then(
          expectPongoDocuments
            .fromCollection<ShoppingCartSummary>(collectionName)
            .withId(streamName)
            .toBeEqual({ productItemsCount: 9 }),
        );
    },
  );

  void it(
    'truncates Pongo projection documents in the configured projection schema',
    withDeadline,
    async () => {
      const eventSchemaName = schemaName('events');
      const projectionSchemaName = schemaName('read_models');
      const collectionName = schemaName('shopping_cart_summary');
      const streamName = `shopping_cart:${uuid()}`;
      const store = getPostgreSQLEventStore(connectionString, {
        schema: {
          autoMigration: 'CreateOrUpdate',
          databaseSchemaName: eventSchemaName,
          projectionsDatabaseSchemaName: projectionSchemaName,
        },
        projections: [
          {
            type: 'inline',
            projection: shoppingCartProjection(collectionName),
          },
        ],
      });

      try {
        await store.appendToStream(streamName, [
          { type: 'ProductItemAdded', data: { quantity: 6 } },
        ]);
        assertDeepEqual(
          await summaryIn(projectionSchemaName, collectionName, streamName),
          { _id: streamName, _version: 1n, productItemsCount: 6 },
        );

        await store.schema.dangerous.truncate({ truncateProjections: true });

        assertIsNull(
          await summaryIn(projectionSchemaName, collectionName, streamName),
        );
      } finally {
        await store.close();
      }
    },
  );

  void it(
    'ignores a Pongo collection migration hash mismatch when the user asks for it',
    withDeadline,
    async () => {
      const eventSchemaName = schemaName('events');
      const projectionSchemaName = schemaName('read_models');
      const migrationSchemaName = schemaName('infrastructure');
      const migrationTableName = 'emmett_migrations';
      const collectionName = schemaName('shopping_cart_summary');
      const streamName = `shopping_cart:${uuid()}`;

      const eventStore = () =>
        getPostgreSQLEventStore(connectionString, {
          schema: {
            autoMigration: 'CreateOrUpdate',
            databaseSchemaName: eventSchemaName,
            projectionsDatabaseSchemaName: projectionSchemaName,
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

      await changeCollectionMigrationHash(
        migrationSchemaName,
        migrationTableName,
        collectionName,
      );

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
        await summaryIn(projectionSchemaName, collectionName, streamName),
        { _id: streamName, _version: 1n, productItemsCount: 8 },
      );
    },
  );

  const changeCollectionMigrationHash = (
    databaseSchemaName: string,
    tableName: string,
    collectionName: string,
  ) =>
    pool.execute.command(
      SQL`UPDATE ${SQLTableReference.from({
        databaseSchemaName,
        tableName,
      })} SET sql_hash = ${'changed'} WHERE name LIKE ${`%${collectionName}%`}`,
    );

  const withSummaries = async <Result>(
    databaseSchemaName: string,
    collectionName: string,
    handle: (
      collection: PongoCollection<ShoppingCartSummary>,
    ) => Promise<Result>,
  ): Promise<Result> => {
    const pongo = pongoClient({
      connectionString,
      driver: pgDriver,
      defaultSchemaName: databaseSchemaName,
      connectionOptions: {
        transactionOptions: { allowNestedTransactions: true },
      },
    });
    try {
      return await handle(
        pongo.db().collection<ShoppingCartSummary>(collectionName),
      );
    } finally {
      await pongo.close();
    }
  };

  const summaryIn = (
    databaseSchemaName: string,
    collectionName: string,
    streamName: string,
  ) =>
    withSummaries(databaseSchemaName, collectionName, (summaries) =>
      summaries.findOne({ _id: streamName }),
    );

  const migrationRows = async (
    databaseSchemaName: string,
    tableName: string,
  ): Promise<string[]> => {
    return mapRows(
      pool.execute.query<{ name: string }>(
        SQL`SELECT name FROM ${SQLTableReference.from({ databaseSchemaName, tableName })}`,
      ),
      ({ name }) => name,
    );
  };
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

const schemaName = (prefix: string): string =>
  `${prefix}_${uuid().replaceAll('-', '_')}`;

const schemaNameRequiringQuotes = (prefix: string): string =>
  `${prefix}"-${uuid().replaceAll('-', '_')}`;

const tableNameRequiringQuotes = (prefix: string): string =>
  `${prefix}-${uuid().replaceAll('-', '_')}`;

const trickySchemaNameStyles: {
  description: string;
  nameWith: (prefix: string) => string;
}[] = [
  {
    description: 'capital letters',
    nameWith: (prefix) => `${prefix.toUpperCase()}_${uniqueSuffix()}`,
  },
  {
    description: 'dashes',
    nameWith: (prefix) => `${prefix}-${uniqueSuffix()}`,
  },
  {
    description: 'spaces',
    nameWith: (prefix) => `${prefix} ${uniqueSuffix()}`,
  },
  {
    description: 'double quotes',
    nameWith: (prefix) => `${prefix}"${uniqueSuffix()}`,
  },
  {
    description: 'apostrophes',
    nameWith: (prefix) => `${prefix}'${uniqueSuffix()}`,
  },
  {
    description: 'a leading digit',
    nameWith: (prefix) => `1${prefix}_${uniqueSuffix()}`,
  },
];

const uniqueSuffix = (): string => uuid().replaceAll('-', '_');
