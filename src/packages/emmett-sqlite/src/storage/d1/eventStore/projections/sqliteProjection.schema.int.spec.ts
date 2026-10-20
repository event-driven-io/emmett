import type { D1Database } from '@cloudflare/workers-types';
import {
  count,
  mapRows,
  PendingMigrationsError,
  SQL,
  sqlMigration,
} from '@event-driven-io/dumbo';
import {
  d1Pool,
  tableExists,
  type D1ConnectionPool,
} from '@event-driven-io/dumbo/cloudflare';
import {
  assertEqual,
  assertFalse,
  assertRejects,
  assertThrows,
  assertTrue,
  EmmettError,
  type Event,
} from '@event-driven-io/emmett';
import { Miniflare } from 'miniflare';
import { v4 as uuid } from 'uuid';
import { afterEach, beforeEach, describe, it } from 'vitest';
import { d1EventStoreDriver } from '../..';
import {
  getSQLiteEventStore,
  type SQLiteEventStoreOptions,
} from '../../../../eventStore/SQLiteEventStore';
import { sqliteRawSQLProjection } from '../../../../eventStore/projections/sqliteProjection';
import { pongoSingleStreamProjection } from '../../../../eventStore/projections/pongo/pongoProjections';

const withDeadline = { timeout: 30000 };

void describe('SQLite projection schema', () => {
  const collectionName = 'shopping_cart_summary';

  let mf: Miniflare;
  let database: D1Database;
  let pool: D1ConnectionPool;

  beforeEach(async () => {
    mf = new Miniflare({
      modules: true,
      script: 'export default { fetch() { return new Response("ok"); } }',
      d1Databases: { DB: 'test-db-id' },
    });
    database = await mf.getD1Database('DB');
    pool = d1Pool({ database });
  });

  afterEach(async () => {
    await pool.close();
    await mf.dispose();
  });

  const eventStore = (
    options: Pick<
      SQLiteEventStoreOptions<typeof d1EventStoreDriver>,
      'schema' | 'projections'
    >,
  ) =>
    getSQLiteEventStore({
      driver: d1EventStoreDriver,
      database,
      ...options,
    });

  void it(
    'creates the Pongo collection of an async projection when the user migrates the event store schema',
    withDeadline,
    async () => {
      const store = eventStore({
        schema: { autoMigration: 'None' },
        projections: [
          { type: 'async', projection: shoppingCartProjection(collectionName) },
        ],
      });

      try {
        await store.schema.migrate();
      } finally {
        await store.close();
      }

      assertTrue(await tableExists(pool.execute, collectionName));
    },
  );

  void it(
    'creates the raw SQL projection table from the migrations the user provided',
    withDeadline,
    async () => {
      const tableName = 'product_sales';
      const migrationName = `test:${tableName}:create`;
      const store = eventStore({
        schema: { autoMigration: 'None' },
        projections: [
          {
            type: 'inline',
            projection: sqliteRawSQLProjection<ProductItemAdded>({
              name: tableName,
              canHandle: ['ProductItemAdded'],
              migrations: [
                sqlMigration(migrationName, [
                  SQL`CREATE TABLE ${SQL.identifier(tableName)} (id TEXT PRIMARY KEY)`,
                ]),
              ],
              evolve: () => SQL`SELECT 1;`,
            }),
          },
        ],
      });

      try {
        await store.schema.migrate();
      } finally {
        await store.close();
      }

      assertTrue(await tableExists(pool.execute, tableName));
      assertTrue((await migrationNames()).includes(migrationName));
    },
  );

  void it(
    'rejects migrating when the user changes the SQL returned by init after it was applied',
    withDeadline,
    async () => {
      const tableName = 'product_sales';
      const storeWith = (columns: SQL) =>
        eventStore({
          schema: { autoMigration: 'None' },
          projections: [
            {
              type: 'inline',
              projection: sqliteRawSQLProjection<ProductItemAdded>({
                name: tableName,
                canHandle: ['ProductItemAdded'],
                init: () =>
                  SQL`CREATE TABLE IF NOT EXISTS ${SQL.identifier(tableName)} (${columns})`,
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

      const changed = storeWith(SQL`id TEXT PRIMARY KEY, total INTEGER`);
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
      const provisioning = eventStore({ schema: { autoMigration: 'None' } });
      try {
        await provisioning.schema.migrate();
      } finally {
        await provisioning.close();
      }

      const store = eventStore({
        schema: { autoMigration: 'EnsureMigrated' },
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
          isPendingMigrationOf(collectionName),
        );
      } finally {
        await store.close();
      }

      assertFalse(await tableExists(pool.execute, collectionName));
    },
  );

  void it(
    'creates no projection tables in projector initialization when the consumer skips migrations',
    withDeadline,
    async () => {
      const store = eventStore({ schema: { autoMigration: 'None' } });

      try {
        await store.schema.migrate();

        const consumer = store.consumer<ProductItemAdded>({
          stopWhen: { noMessagesLeft: true },
          schema: { autoMigration: 'None' },
        });
        consumer.projector({
          processorId: `processor:${uuid()}`,
          projection: shoppingCartProjection(collectionName),
        });

        try {
          await consumer.start();
        } finally {
          await consumer.close();
        }
      } finally {
        await store.close();
      }

      assertFalse(await tableExists(pool.execute, collectionName));
    },
  );

  void it(
    'creates no projection tables in projector initialization when the event store skips migrations',
    withDeadline,
    async () => {
      const store = eventStore({ schema: { autoMigration: 'None' } });

      try {
        await store.schema.migrate();

        const consumer = store.consumer<ProductItemAdded>({
          stopWhen: { noMessagesLeft: true },
        });
        consumer.projector({
          processorId: `processor:${uuid()}`,
          projection: shoppingCartProjection(collectionName),
        });

        try {
          await consumer.start();
        } finally {
          await consumer.close();
        }
      } finally {
        await store.close();
      }

      assertFalse(await tableExists(pool.execute, collectionName));
    },
  );

  void it(
    'fails to start the consumer when projection migrations are pending and the consumer ensures migrations',
    withDeadline,
    async () => {
      const store = eventStore({ schema: { autoMigration: 'None' } });

      try {
        await store.schema.migrate();

        const consumer = store.consumer<ProductItemAdded>({
          stopWhen: { noMessagesLeft: true },
          schema: { autoMigration: 'EnsureMigrated' },
        });
        consumer.projector({
          processorId: `processor:${uuid()}`,
          projection: shoppingCartProjection(collectionName),
        });

        try {
          await assertRejects(
            consumer.start(),
            isPendingMigrationOf(collectionName),
          );
        } finally {
          await consumer.close();
        }
      } finally {
        await store.close();
      }

      assertFalse(await tableExists(pool.execute, collectionName));
    },
  );

  void it(
    'projects events with the async projections registered on the event store',
    withDeadline,
    async () => {
      const store = eventStore({
        schema: { autoMigration: 'None' },
        projections: [
          { type: 'async', projection: shoppingCartProjection(collectionName) },
        ],
      });

      try {
        await store.schema.migrate();
        await store.appendToStream(`shopping_cart-${uuid()}`, [
          { type: 'ProductItemAdded', data: { quantity: 1 } },
        ]);

        const consumer = store.consumer<ProductItemAdded>({
          stopWhen: { noMessagesLeft: true },
        });

        try {
          await consumer.start();
        } finally {
          await consumer.close();
        }
      } finally {
        await store.close();
      }

      assertEqual(
        1,
        await count(
          pool.execute.query<{ count: number }>(
            SQL`SELECT COUNT(*) AS count FROM ${SQL.identifier(collectionName)}`,
          ),
        ),
      );
    },
  );

  void it(
    'rejects registering a projector for a projection that the event store already runs as async',
    withDeadline,
    async () => {
      const projection = shoppingCartProjection(collectionName);
      const store = eventStore({
        schema: { autoMigration: 'None' },
        projections: [{ type: 'async', projection }],
      });

      try {
        const consumer = store.consumer<ProductItemAdded>();

        assertThrows(
          () => consumer.projector({ projection }),
          (error) => error instanceof EmmettError,
        );
      } finally {
        await store.close();
      }
    },
  );

  void it('describes the projection tables in the given database schema', () => {
    const projection = shoppingCartProjection(collectionName);

    assertTrue(projection.schema.sql().includes(collectionName));
    assertFalse(projection.schema.sql().includes('read_models'));
    assertTrue(
      projection.schema
        .withDatabaseSchemaName('read_models')
        .sql()
        .includes('read_models'),
    );
  });

  const migrationNames = (): Promise<string[]> =>
    mapRows(
      pool.execute.query<{ name: string }>(
        SQL`SELECT name FROM dmb_migrations`,
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

const isPendingMigrationOf = (collectionName: string) => (error: unknown) =>
  error instanceof PendingMigrationsError &&
  error.pendingMigrations.some(({ name }) => name.includes(collectionName));
