import {
  dumbo,
  dumboSchema,
  mapRows,
  PendingMigrationsError,
  SQL,
  sqlMigration,
  SQLTableReference,
} from '@event-driven-io/dumbo';
import { pgDumboDriver, type PgPool } from '@event-driven-io/dumbo/pg';
import {
  assertFalse,
  assertRejects,
  assertTrue,
  type Event,
} from '@event-driven-io/emmett';
import { v4 as uuid } from 'uuid';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { pgEventStoreDriver } from '../../pg';
import {
  sharedPostgreSQLDatabase,
  type PostgreSQLTestDatabase,
} from '../../testing/postgreSQLTestDatabase';
import { tableExists } from '../../testing/schemaObjects';
import { getPostgreSQLEventStore } from '../postgreSQLEventStore';
import { pongoSingleStreamProjection } from './pongo';
import {
  isPostgreSQLProjectionWithSchema,
  postgreSQLRawSQLProjection,
} from './postgreSQLProjection';

const withDeadline = { timeout: 30000 };

const { column, table } = dumboSchema;
const { Integer, Text } = SQL.column.type;

void describe('PostgreSQL projection schema', () => {
  let database: PostgreSQLTestDatabase;
  let connectionString: string;
  let pool: PgPool;

  beforeAll(async () => {
    database = await sharedPostgreSQLDatabase();
    connectionString = database.connectionString;
    pool = dumbo({ driver: pgDumboDriver, connectionString });
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
    'creates the Pongo collection of an async projection when the user migrates the event store schema',
    withDeadline,
    async () => {
      const eventSchemaName = schemaName('events');
      const collectionName = schemaName('shopping_cart_summary');
      const store = getPostgreSQLEventStore({
        driver: pgEventStoreDriver,
        connectionString,
        schema: { autoMigration: 'None', databaseSchemaName: eventSchemaName },
        projections: [
          { type: 'async', projection: shoppingCartProjection(collectionName) },
        ],
      });

      try {
        await store.schema.migrate();

        assertTrue(
          await tableExists(pool.execute, collectionName, eventSchemaName),
        );
      } finally {
        await store.close();
      }
    },
  );

  void it(
    'creates the raw SQL projection table from the migrations the user provided',
    withDeadline,
    async () => {
      const eventSchemaName = schemaName('events');
      const tableName = schemaName('product_sales');
      const migrationName = `test:${tableName}:create`;
      const store = getPostgreSQLEventStore({
        driver: pgEventStoreDriver,
        connectionString,
        schema: { autoMigration: 'None', databaseSchemaName: eventSchemaName },
        projections: [
          {
            type: 'inline',
            projection: postgreSQLRawSQLProjection<ProductItemAdded>({
              name: tableName,
              canHandle: ['ProductItemAdded'],
              migrations: [
                sqlMigration(migrationName, [
                  SQL`CREATE TABLE ${SQLTableReference.from({ databaseSchemaName: eventSchemaName, tableName })} (id TEXT PRIMARY KEY)`,
                ]),
              ],
              evolve: () => SQL`SELECT 1;`,
            }),
          },
        ],
      });

      try {
        await store.schema.migrate();

        assertTrue(await tableExists(pool.execute, tableName, eventSchemaName));
        assertTrue(
          (await migrationNames(eventSchemaName)).includes(migrationName),
        );
      } finally {
        await store.close();
      }
    },
  );

  void it(
    'creates the raw SQL projection tables from the schema the user provided',
    withDeadline,
    async () => {
      const eventSchemaName = schemaName('events');
      const projectionSchemaName = schemaName('read_models');
      const salesTableName = schemaName('product_sales');
      const totalsTableName = schemaName('product_totals');
      const store = getPostgreSQLEventStore({
        driver: pgEventStoreDriver,
        connectionString,
        schema: { autoMigration: 'None', databaseSchemaName: eventSchemaName },
        projections: [
          {
            type: 'inline',
            projection: postgreSQLRawSQLProjection<ProductItemAdded>({
              name: salesTableName,
              canHandle: ['ProductItemAdded'],
              schema: dumboSchema.schema(projectionSchemaName, {
                sales: table(salesTableName, {
                  columns: {
                    productId: column('product_id', Text, {
                      primaryKey: true,
                      notNull: true,
                    }),
                    totalAmount: column('total_amount', Integer),
                  },
                }),
                totals: table(totalsTableName, {
                  columns: {
                    productId: column('product_id', Text, {
                      primaryKey: true,
                      notNull: true,
                    }),
                  },
                }),
              }),
              evolve: () => SQL`SELECT 1;`,
            }),
          },
        ],
      });

      try {
        await store.schema.migrate();

        assertTrue(
          await tableExists(pool.execute, salesTableName, projectionSchemaName),
        );
        assertTrue(
          await tableExists(
            pool.execute,
            totalsTableName,
            projectionSchemaName,
          ),
        );
      } finally {
        await store.close();
      }
    },
  );

  void it(
    'rejects migrating when the user changes the SQL returned by init after it was applied',
    withDeadline,
    async () => {
      const eventSchemaName = schemaName('events');
      const tableName = schemaName('product_sales');
      const storeWith = (columns: SQL) =>
        getPostgreSQLEventStore({
          driver: pgEventStoreDriver,
          connectionString,
          schema: {
            autoMigration: 'None',
            databaseSchemaName: eventSchemaName,
          },
          projections: [
            {
              type: 'inline',
              projection: postgreSQLRawSQLProjection<ProductItemAdded>({
                name: tableName,
                canHandle: ['ProductItemAdded'],
                init: () =>
                  SQL`CREATE TABLE IF NOT EXISTS ${SQLTableReference.from({ databaseSchemaName: eventSchemaName, tableName })} (${columns})`,
                evolve: () => SQL`SELECT 1;`,
              }),
            },
          ],
        });

      const migrated = storeWith(SQL`id TEXT PRIMARY KEY`);
      try {
        await migrated.schema.migrate();
      } finally {
        await migrated.close();
      }

      const changed = storeWith(SQL`id TEXT PRIMARY KEY, total INT`);
      try {
        await assertRejects(changed.schema.migrate(), (error: Error) =>
          error.message.includes('Migration hash mismatch'),
        );
      } finally {
        await changed.close();
      }
    },
  );

  void it(
    'rejects appending events when projection migrations are pending and the store ensures migrations',
    withDeadline,
    async () => {
      const eventSchemaName = schemaName('events');
      const collectionName = schemaName('shopping_cart_summary');
      const provisioning = getPostgreSQLEventStore({
        driver: pgEventStoreDriver,
        connectionString,
        schema: { autoMigration: 'None', databaseSchemaName: eventSchemaName },
      });
      try {
        await provisioning.schema.migrate();
      } finally {
        await provisioning.close();
      }

      const store = getPostgreSQLEventStore({
        driver: pgEventStoreDriver,
        connectionString,
        schema: {
          autoMigration: 'EnsureMigrated',
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
        await assertRejects(
          store.appendToStream(`shopping_cart-${uuid()}`, [
            { type: 'ProductItemAdded', data: { quantity: 1 } },
          ]),
          (error) =>
            error instanceof PendingMigrationsError &&
            error.pendingMigrations.some(({ name }) =>
              name.includes(collectionName),
            ),
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
    'describes the projection tables in the projection and event store schema SQL',
    withDeadline,
    async () => {
      const eventSchemaName = schemaName('events');
      const collectionName = schemaName('shopping_cart_summary');
      const projection = shoppingCartProjection(collectionName);
      const store = getPostgreSQLEventStore({
        driver: pgEventStoreDriver,
        connectionString,
        schema: { autoMigration: 'None', databaseSchemaName: eventSchemaName },
        projections: [{ type: 'async', projection }],
      });

      try {
        assertTrue(isPostgreSQLProjectionWithSchema(projection));
        assertTrue(
          projection.schema
            .sql({ databaseSchemaName: eventSchemaName })
            .includes(collectionName),
        );
        assertTrue(store.schema.sql().includes(collectionName));
        assertTrue(store.schema.sql().includes('emt_messages'));
      } finally {
        await store.close();
      }
    },
  );

  const migrationNames = (databaseSchemaName: string): Promise<string[]> =>
    mapRows(
      pool.execute.query<{ name: string }>(
        SQL`SELECT name FROM ${SQLTableReference.from({ databaseSchemaName, tableName: 'dmb_migrations' })}`,
      ),
      ({ name }) => name,
    );
});

type ProductItemAdded = Event<'ProductItemAdded', { quantity: number }>;

type ShoppingCartSummary = {
  productItemsCount: number;
};

const shoppingCartProjection = (collectionName: string) =>
  pongoSingleStreamProjection<ShoppingCartSummary, ProductItemAdded>({
    collectionName,
    canHandle: ['ProductItemAdded'],
    evolve: (document: ShoppingCartSummary, event: ProductItemAdded) => ({
      productItemsCount: document.productItemsCount + event.data.quantity,
    }),
    initialState: () => ({ productItemsCount: 0 }),
  });

const schemaName = (prefix: string): string =>
  `${prefix}_${uuid().replaceAll('-', '_')}`;
