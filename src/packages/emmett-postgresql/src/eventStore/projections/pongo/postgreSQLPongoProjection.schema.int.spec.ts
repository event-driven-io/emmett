import {
  dumbo,
  SQL,
  SQLTableReference,
  type SQLExecutor,
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
import {
  getPostgreSQLEventStore,
  type PostgresEventStore,
} from '../../postgreSQLEventStore';
import { PostgreSQLProjectionSpec } from '../postgresProjectionSpec';
import { pongoSingleStreamProjection } from './pongoProjections';

const withDeadline = { timeout: 30000 };

void describe('PostgreSQL Pongo projection schema configuration', () => {
  let database: PostgreSQLTestDatabase;
  let connectionString: string;
  let pool: PgPool;
  const stores: PostgresEventStore[] = [];

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
      for (const store of stores) await store.close();
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
      stores.push(store);

      await store.appendToStream(streamName, [
        { type: 'ProductItemAdded', data: { quantity: 3 } },
      ]);

      assertEqual(await tableRows(projectionSchemaName, collectionName), 1);
      assertFalse(await tableExists(eventSchemaName, collectionName));
      assertFalse(await tableExists(undefined, collectionName));
      assertTrue(
        (await migrationRows(migrationSchemaName, migrationTableName)).some(
          (name) => name.includes(collectionName),
        ),
      );
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
      stores.push(store);

      await store.appendToStream(streamName, [
        { type: 'ProductItemAdded', data: { quantity: 4 } },
      ]);

      assertEqual(await tableRows(collectionSchemaName, collectionName), 1);
      assertFalse(await tableExists(projectionSchemaName, collectionName));
      assertFalse(await tableExists(eventSchemaName, collectionName));
    },
  );

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
          assertEqual(await tableRows(projectionSchemaName, collectionName), 1);
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
      stores.push(store);

      await store.appendToStream(streamName, [
        { type: 'ProductItemAdded', data: { quantity: 6 } },
      ]);
      assertEqual(await tableRows(projectionSchemaName, collectionName), 1);

      await store.schema.dangerous.truncate({ truncateProjections: true });

      assertEqual(await tableRows(projectionSchemaName, collectionName), 0);
    },
  );

  const tableExists = (
    databaseSchemaName: string | undefined,
    tableName: string,
  ) => tableExistsUsing(pool.execute, databaseSchemaName, tableName);

  const tableRows = async (
    databaseSchemaName: string,
    tableName: string,
  ): Promise<number> => {
    if (!(await tableExists(databaseSchemaName, tableName))) return 0;

    const result = await pool.execute.query<{ count: string }>(
      SQL`SELECT COUNT(*) AS count FROM ${SQLTableReference.from({ databaseSchemaName, tableName })}`,
    );
    return Number(result.rows[0]?.count ?? 0);
  };

  const migrationRows = async (
    databaseSchemaName: string,
    tableName: string,
  ): Promise<string[]> => {
    if (!(await tableExists(databaseSchemaName, tableName))) return [];

    const result = await pool.execute.query<{ name: string }>(
      SQL`SELECT name FROM ${SQLTableReference.from({ databaseSchemaName, tableName })}`,
    );
    return result.rows.map(({ name }) => name);
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

const tableExistsUsing = async (
  execute: SQLExecutor,
  databaseSchemaName: string | undefined,
  tableName: string,
): Promise<boolean> => {
  const result = await execute.query<{ exists: boolean }>(
    SQL`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = ${databaseSchemaName ?? 'public'} AND table_name = ${tableName}
      ) AS exists
    `,
  );
  return result.rows[0]?.exists === true;
};
