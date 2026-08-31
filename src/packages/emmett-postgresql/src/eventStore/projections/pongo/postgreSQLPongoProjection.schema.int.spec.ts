import {
  count,
  dumbo,
  mapRows,
  SQL,
  SQLTableReference,
} from '@event-driven-io/dumbo';
import { pgDumboDriver, type PgPool } from '@event-driven-io/dumbo/pg';
import {
  assertEqual,
  assertFalse,
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
import { pongoSingleStreamProjection } from './pongoProjections';

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

        assertEqual(
          1,
          await count(
            pool.execute.query<{ count: number }>(
              SQL`SELECT COUNT(*)::integer AS count FROM ${SQLTableReference.from({ databaseSchemaName: projectionSchemaName, tableName: collectionName })}`,
            ),
          ),
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

        assertEqual(
          1,
          await count(
            pool.execute.query<{ count: number }>(
              SQL`SELECT COUNT(*)::integer AS count FROM ${SQLTableReference.from({ databaseSchemaName: collectionSchemaName, tableName: collectionName })}`,
            ),
          ),
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

        assertEqual(
          1,
          await count(
            pool.execute.query<{ count: number }>(
              SQL`SELECT COUNT(*)::integer AS count FROM ${SQLTableReference.from({ databaseSchemaName: projectionSchemaName, tableName: collectionName })}`,
            ),
          ),
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

          assertEqual(
            1,
            await count(
              pool.execute.query<{ count: number }>(
                SQL`SELECT COUNT(*)::integer AS count FROM ${SQLTableReference.from({ databaseSchemaName: projectionSchemaName, tableName: collectionName })}`,
              ),
            ),
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
          assertEqual(
            1,
            await count(
              pool.execute.query<{ count: number }>(
                SQL`SELECT COUNT(*)::integer AS count FROM ${SQLTableReference.from({ databaseSchemaName: projectionSchemaName, tableName: collectionName })}`,
              ),
            ),
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
        assertEqual(
          1,
          await count(
            pool.execute.query<{ count: number }>(
              SQL`SELECT COUNT(*)::integer AS count FROM ${SQLTableReference.from({ databaseSchemaName: projectionSchemaName, tableName: collectionName })}`,
            ),
          ),
        );

        await store.schema.dangerous.truncate({ truncateProjections: true });

        assertEqual(
          0,
          await count(
            pool.execute.query<{ count: number }>(
              SQL`SELECT COUNT(*)::integer AS count FROM ${SQLTableReference.from({ databaseSchemaName: projectionSchemaName, tableName: collectionName })}`,
            ),
          ),
        );
      } finally {
        await store.close();
      }
    },
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
