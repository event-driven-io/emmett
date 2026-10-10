import { dumbo, PendingMigrationsError, SQL } from '@event-driven-io/dumbo';
import {
  pgDumboDriver,
  tableExists,
  type PgPool,
} from '@event-driven-io/dumbo/pg';
import {
  assertDeepEqual,
  assertEqual,
  assertFalse,
  assertIsNotNull,
  assertThrowsAsync,
  assertTrue,
  projections,
  type ProjectionHandlingType,
} from '@event-driven-io/emmett';
import { v4 as uuid } from 'uuid';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { pgEventStoreDriver } from '../pg';
import {
  sharedPostgreSQLDatabase,
  type PostgreSQLTestDatabase,
} from '../testing/postgreSQLTestDatabase';
import type {
  PricedProductItem,
  ProductItemAdded,
} from '../testing/shoppingCart.domain';
import {
  getPostgreSQLEventStore,
  type PostgresEventStoreOptions,
} from './postgreSQLEventStore';
import { postgreSQLProjection, readProjectionInfo } from './projections';
import { pongoSingleStreamProjection } from './projections/pongo/pongoProjections';

const withDeadline = { timeout: 30000 };

void describe('PostgreSQL event store init', () => {
  let database: PostgreSQLTestDatabase;
  let connectionString: string;
  let pool: PgPool;
  const productItem: PricedProductItem = {
    productId: '123',
    quantity: 10,
    price: 3,
  };

  beforeAll(async () => {
    database = await sharedPostgreSQLDatabase();
    connectionString = database.connectionString;
    pool = dumbo({ connectionString, driver: pgDumboDriver });
  });

  afterAll(async () => {
    try {
      await pool?.close();
      await database?.close();
    } catch (error) {
      console.log(error);
    }
  });

  const storeSchema = () => {
    const databaseSchemaName = schemaName('events');
    return {
      databaseSchemaName,
      migrationTable: {
        schemaName: databaseSchemaName,
        tableName: schemaName('migrations'),
      },
    };
  };

  const storeWith = (
    options: Pick<
      PostgresEventStoreOptions,
      'schema' | 'projections' | 'hooks'
    >,
  ) =>
    getPostgreSQLEventStore({
      driver: pgEventStoreDriver,
      connectionString,
      ...options,
    });

  const countingProjection = (
    name: string,
    initCalls: ProjectionHandlingType[],
  ) =>
    postgreSQLProjection<ProductItemAdded>({
      name,
      canHandle: ['ProductItemAdded'],
      handle: () => {},
      init: ({ registrationType }) => {
        initCalls.push(registrationType);
      },
    });

  const append = (store: { appendToStream: AppendToStream }) =>
    store.appendToStream(`shopping_cart-${uuid()}`, [
      { type: 'ProductItemAdded', data: { productItem } },
    ]);

  const dropMigrationTable = (schema: ReturnType<typeof storeSchema>) =>
    pool.execute.command(
      SQL`DROP TABLE ${SQL.identifier(schema.migrationTable.schemaName)}.${SQL.identifier(schema.migrationTable.tableName)}`,
    );

  const migrationTableExists = (schema: ReturnType<typeof storeSchema>) =>
    tableExists(pool.execute, schema.migrationTable.tableName, {
      databaseSchemaName: schema.migrationTable.schemaName,
    });

  void it(
    'migrates the event store and the inline and async Pongo collections in one call under None',
    withDeadline,
    async () => {
      const schema = storeSchema();
      const inlineCollection = schemaName('inline_summary');
      const asyncCollection = schemaName('async_summary');
      const store = storeWith({
        schema: { autoMigration: 'None', ...schema },
        projections: [
          ...projections.inline([shoppingCartSummary(inlineCollection)]),
          ...projections.async([shoppingCartSummary(asyncCollection)]),
        ],
      });

      try {
        await store.schema.migrate();

        assertTrue(
          await tableExists(pool.execute, 'emt_streams', {
            databaseSchemaName: schema.databaseSchemaName,
          }),
        );
        assertTrue(
          await tableExists(pool.execute, inlineCollection, {
            databaseSchemaName: schema.databaseSchemaName,
          }),
        );
        assertTrue(
          await tableExists(pool.execute, asyncCollection, {
            databaseSchemaName: schema.databaseSchemaName,
          }),
        );
      } finally {
        await store.close();
      }
    },
  );

  void it(
    'describes the event store and then the projections in registration order',
    withDeadline,
    async () => {
      const schema = storeSchema();
      const asyncCollection = schemaName('async_summary');
      const inlineCollection = schemaName('inline_summary');
      const asyncProjection = shoppingCartSummary(asyncCollection);
      const store = storeWith({
        schema,
        projections: [
          ...projections.async([asyncProjection]),
          ...projections.inline([shoppingCartSummary(inlineCollection)]),
        ],
      });

      try {
        const sql = store.schema.sql();

        assertTrue(sql.indexOf('emt_streams') >= 0);
        assertTrue(sql.indexOf('emt_streams') < sql.indexOf(asyncCollection));
        assertTrue(
          sql.indexOf(asyncCollection) < sql.indexOf(inlineCollection),
        );

        const componentMigrations = store.schema.component
          .migrations()
          .map(({ name }) => name);
        assertTrue(
          componentMigrations.some((name) => name.includes(asyncCollection)),
        );
        assertTrue(
          componentMigrations.some((name) => name.includes(inlineCollection)),
        );
      } finally {
        await store.close();
      }
    },
  );

  void it(
    'reports pending migrations on a fresh schema and passes after migrate',
    withDeadline,
    async () => {
      const store = storeWith({ schema: storeSchema() });

      try {
        await assertThrowsAsync(
          () => store.schema.ensureMigrated(),
          (error) => error instanceof PendingMigrationsError,
        );

        await store.schema.migrate();

        await store.schema.ensureMigrated();
      } finally {
        await store.close();
      }
    },
  );

  void it(
    'reads no migration history under None and registers the inline projections',
    withDeadline,
    async () => {
      const schema = storeSchema();
      const projectionName = schemaName('inline_projection');
      const migrated = storeWith({ schema });
      const store = storeWith({
        schema: { autoMigration: 'None', ...schema },
        projections: projections.inline([
          countingProjection(projectionName, []),
        ]),
      });

      try {
        await migrated.schema.migrate();
        await dropMigrationTable(schema);

        await append(store);

        assertFalse(await migrationTableExists(schema));
        const registration = await readProjectionInfo(pool.execute, {
          databaseSchemaName: schema.databaseSchemaName,
          name: projectionName,
          partition: 'emt:default',
          version: 1,
        });
        assertIsNotNull(registration);
        assertEqual(registration.registration.type, 'inline');
      } finally {
        await migrated.close();
        await store.close();
      }
    },
  );

  void it(
    'does not initialize the inline projections in migrate',
    withDeadline,
    async () => {
      const initCalls: ProjectionHandlingType[] = [];
      const store = storeWith({
        schema: storeSchema(),
        projections: projections.inline([
          countingProjection(schemaName('inline_projection'), initCalls),
        ]),
      });

      try {
        await store.schema.migrate();

        assertDeepEqual(initCalls, []);
      } finally {
        await store.close();
      }
    },
  );

  void it(
    'initializes each inline projection once as inline',
    withDeadline,
    async () => {
      const initCalls: ProjectionHandlingType[] = [];
      const store = storeWith({
        schema: storeSchema(),
        projections: projections.inline([
          countingProjection(schemaName('first_projection'), initCalls),
          countingProjection(schemaName('second_projection'), initCalls),
        ]),
      });

      try {
        await store.init();
        await store.init();

        assertDeepEqual(initCalls, ['inline', 'inline']);
      } finally {
        await store.close();
      }
    },
  );

  void it(
    'initializes on the first operation when nobody called init',
    withDeadline,
    async () => {
      const initCalls: ProjectionHandlingType[] = [];
      const store = storeWith({
        schema: storeSchema(),
        projections: projections.inline([
          countingProjection(schemaName('inline_projection'), initCalls),
        ]),
      });

      try {
        await append(store);
        await append(store);

        assertDeepEqual(initCalls, ['inline']);
      } finally {
        await store.close();
      }
    },
  );

  void it(
    'does not initialize again on the first operation after init',
    withDeadline,
    async () => {
      const initCalls: ProjectionHandlingType[] = [];
      const store = storeWith({
        schema: storeSchema(),
        projections: projections.inline([
          countingProjection(schemaName('inline_projection'), initCalls),
        ]),
      });

      try {
        await store.init();
        await append(store);

        assertDeepEqual(initCalls, ['inline']);
      } finally {
        await store.close();
      }
    },
  );

  void it(
    'throws pending migrations from init under EnsureMigrated on a fresh schema',
    withDeadline,
    async () => {
      const store = storeWith({
        schema: { autoMigration: 'EnsureMigrated', ...storeSchema() },
      });

      try {
        await assertThrowsAsync(
          () => store.init(),
          (error) => error instanceof PendingMigrationsError,
        );
      } finally {
        await store.close();
      }
    },
  );

  void it(
    'runs the schema hooks once per instance also when nothing is pending',
    withDeadline,
    async () => {
      const schema = storeSchema();
      let hookCalls = 0;
      const migrated = storeWith({ schema });
      const store = storeWith({
        schema,
        hooks: {
          onBeforeSchemaCreated: () => {
            hookCalls++;
          },
          onAfterSchemaCreated: () => {
            hookCalls++;
          },
        },
      });

      try {
        await migrated.schema.migrate();

        await store.init();
        await append(store);
        await store.schema.migrate();

        assertEqual(hookCalls, 2);
      } finally {
        await migrated.close();
        await store.close();
      }
    },
  );

  void it(
    'runs the schema hooks in the migration transaction',
    withDeadline,
    async () => {
      const schema = storeSchema();
      const store = storeWith({
        schema,
        hooks: {
          onAfterSchemaCreated: () => {
            throw new Error('hook failed');
          },
        },
      });

      try {
        await assertThrowsAsync(() => store.schema.migrate());

        assertFalse(
          await tableExists(pool.execute, 'emt_streams', {
            databaseSchemaName: schema.databaseSchemaName,
          }),
        );
        assertFalse(await migrationTableExists(schema));
      } finally {
        await store.close();
      }
    },
  );

  void it(
    'rolls back a dry run and does not count it as migrated',
    withDeadline,
    async () => {
      const schema = storeSchema();
      const store = storeWith({
        schema: { autoMigration: 'EnsureMigrated', ...schema },
      });

      try {
        const dryRun = await store.schema.migrate({ dryRun: true });

        assertTrue(dryRun.applied.length > 0);
        assertFalse(await migrationTableExists(schema));
        await assertThrowsAsync(
          () => store.init(),
          (error) => error instanceof PendingMigrationsError,
        );
      } finally {
        await store.close();
      }
    },
  );

  void it(
    'reads no migration history after the first operation, in appends, sessions and processor message stores',
    withDeadline,
    async () => {
      const schema = storeSchema();
      const reactionStream = `reaction-${uuid()}`;
      const store = storeWith({
        schema: { autoMigration: 'EnsureMigrated', ...schema },
      });

      try {
        await store.schema.migrate();
        await append(store);
        await dropMigrationTable(schema);

        await append(store);
        await store.withSession(({ eventStore }) => append(eventStore));

        const consumer = store.consumer<ProductItemAdded>();
        consumer.reactor({
          processorId: schemaName('processor'),
          startFrom: 'BEGINNING',
          canHandle: ['ProductItemAdded'],
          eachMessage: async (_, context) => {
            await context.session.messageStore.appendToStream(reactionStream, [
              {
                type: 'DiscountApplied',
                data: { percent: 10, couponId: uuid() },
              },
            ]);
          },
        });
        try {
          void consumer.start();
          await consumer.whenStarted();
          await consumer.whenCaughtUp();
        } finally {
          await consumer.close();
        }

        const reactions = await store.readStream(reactionStream);
        assertEqual(reactions.events.length, 3);
        assertFalse(await migrationTableExists(schema));
      } finally {
        await store.close();
      }
    },
  );

  void it(
    'shares the store initialization with a session that runs first',
    withDeadline,
    async () => {
      const initCalls: ProjectionHandlingType[] = [];
      let hookCalls = 0;
      const store = storeWith({
        schema: storeSchema(),
        projections: projections.inline([
          countingProjection(schemaName('inline_projection'), initCalls),
        ]),
        hooks: {
          onAfterSchemaCreated: () => {
            hookCalls++;
          },
        },
      });

      try {
        await store.withSession(({ eventStore }) => append(eventStore));
        await store.withSession(({ eventStore }) => append(eventStore));
        await append(store);

        assertDeepEqual(initCalls, ['inline']);
        assertEqual(hookCalls, 1);
      } finally {
        await store.close();
      }
    },
  );
});

type AppendToStream = ReturnType<
  typeof getPostgreSQLEventStore
>['appendToStream'];

type ShoppingCartSummary = { productItemsCount: number };

const shoppingCartSummary = (collectionName: string) =>
  pongoSingleStreamProjection<ShoppingCartSummary, ProductItemAdded>({
    collectionName,
    canHandle: ['ProductItemAdded'],
    evolve: (document: ShoppingCartSummary, event: ProductItemAdded) => ({
      productItemsCount:
        document.productItemsCount + event.data.productItem.quantity,
    }),
    initialState: () => ({ productItemsCount: 0 }),
  });

const schemaName = (prefix: string): string =>
  `${prefix}_${uuid().replaceAll('-', '_')}`;
