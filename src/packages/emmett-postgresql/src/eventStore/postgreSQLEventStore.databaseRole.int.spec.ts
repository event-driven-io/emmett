import {
  count,
  dumbo,
  PendingMigrationsError,
  SQL,
  SQLTableReference,
} from '@event-driven-io/dumbo';
import { pgDumboDriver, type PgPool } from '@event-driven-io/dumbo/pg';
import {
  assertDeepEqual,
  assertEqual,
  assertFalse,
  assertRejects,
  assertTrue,
} from '@event-driven-io/emmett';
import { getPostgreSQLStartedContainer } from '@event-driven-io/emmett-testcontainers';
import type { Readable } from 'stream';
import { v4 as uuid } from 'uuid';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { pgEventStoreDriver } from '../pg';
import { tableExists } from '../testing/schemaObjects';
import type { ProductItemAdded } from '../testing/shoppingCart.domain';
import { getPostgreSQLEventStore } from './postgreSQLEventStore';
import { pongoSingleStreamProjection } from './projections';

const withDeadline = { timeout: 30000 };

void describe('PostgreSQL event store used by a database role that cannot create tables', () => {
  let container: Awaited<ReturnType<typeof getPostgreSQLStartedContainer>>;
  let containerLogs: Readable;
  let loggedText = '';
  let connectionString: string;
  let pool: PgPool;
  const productItem = { price: 10, productId: uuid(), quantity: 10 };

  beforeAll(async () => {
    container = await getPostgreSQLStartedContainer();
    containerLogs = await container.logs();
    containerLogs.on('data', (chunk: Buffer | string) => {
      loggedText += chunk.toString();
    });
    connectionString = container.getConnectionUri();
    pool = dumbo({ connectionString, driver: pgDumboDriver });
  });

  afterAll(async () => {
    try {
      containerLogs?.destroy();
      await pool?.close();
      await container?.stop();
    } catch (error) {
      console.log(error);
    }
  });

  void it(
    'projects events when the user migrated the schema and the event store skips migrations',
    withDeadline,
    async () => {
      const eventSchemaName = schemaName('events');
      const collectionName = schemaName('shopping_cart_summary');
      const projection = shoppingCartSummaryProjection(collectionName);
      await migrateAsOwner(eventSchemaName, projection);
      const runtimeConnectionString =
        await connectionStringOfRoleWithoutCreate(eventSchemaName);

      const ddl = await ddlSentBy(runtimeConnectionString, async () => {
        const store = getPostgreSQLEventStore({
          driver: pgEventStoreDriver,
          connectionString: runtimeConnectionString,
          schema: {
            autoMigration: 'None',
            databaseSchemaName: eventSchemaName,
          },
          projections: [{ type: 'async', projection }],
        });
        try {
          await projectEvent(store);
        } finally {
          await store.close();
        }
      });

      assertDeepEqual([], ddl);
      assertEqual(1, await rowsInTable(eventSchemaName, collectionName));
    },
  );

  void it(
    'projects events when the user migrated the schema and the event store creates or updates migrations',
    withDeadline,
    async () => {
      const eventSchemaName = schemaName('events');
      const collectionName = schemaName('shopping_cart_summary');
      const projection = shoppingCartSummaryProjection(collectionName);
      await migrateAsOwner(eventSchemaName, projection);
      const runtimeConnectionString =
        await connectionStringOfRoleWithoutCreate(eventSchemaName);

      const ddl = await ddlSentBy(runtimeConnectionString, async () => {
        const store = getPostgreSQLEventStore({
          driver: pgEventStoreDriver,
          connectionString: runtimeConnectionString,
          schema: {
            autoMigration: 'CreateOrUpdate',
            databaseSchemaName: eventSchemaName,
          },
          projections: [{ type: 'async', projection }],
        });
        try {
          await projectEvent(store);
        } finally {
          await store.close();
        }
      });

      assertDeepEqual([], ddl);
      assertEqual(1, await rowsInTable(eventSchemaName, collectionName));
    },
  );

  void it(
    'starts the consumer without creating pending projection tables when the event store skips migrations',
    withDeadline,
    async () => {
      const eventSchemaName = schemaName('events');
      const collectionName = schemaName('shopping_cart_summary');
      await migrateAsOwner(eventSchemaName);
      const runtimeConnectionString =
        await connectionStringOfRoleWithoutCreate(eventSchemaName);

      const ddl = await ddlSentBy(runtimeConnectionString, async () => {
        const store = getPostgreSQLEventStore({
          driver: pgEventStoreDriver,
          connectionString: runtimeConnectionString,
          schema: {
            autoMigration: 'None',
            databaseSchemaName: eventSchemaName,
          },
          projections: [
            {
              type: 'async',
              projection: shoppingCartSummaryProjection(collectionName),
            },
          ],
        });
        try {
          await store
            .consumer<ProductItemAdded>({ stopWhen: { noMessagesLeft: true } })
            .start();
        } finally {
          await store.close();
        }
      });

      assertDeepEqual([], ddl);
      assertFalse(
        await tableExists(pool.execute, collectionName, eventSchemaName),
      );
    },
  );

  void it(
    'fails to start the consumer with pending migrations when the event store ensures migrations',
    withDeadline,
    async () => {
      const eventSchemaName = schemaName('events');
      const collectionName = schemaName('shopping_cart_summary');
      await migrateAsOwner(eventSchemaName);
      const runtimeConnectionString =
        await connectionStringOfRoleWithoutCreate(eventSchemaName);

      const ddl = await ddlSentBy(runtimeConnectionString, async () => {
        const store = getPostgreSQLEventStore({
          driver: pgEventStoreDriver,
          connectionString: runtimeConnectionString,
          schema: {
            autoMigration: 'EnsureMigrated',
            databaseSchemaName: eventSchemaName,
          },
          projections: [
            {
              type: 'async',
              projection: shoppingCartSummaryProjection(collectionName),
            },
          ],
        });
        try {
          await assertRejects(
            store
              .consumer<ProductItemAdded>({
                stopWhen: { noMessagesLeft: true },
              })
              .start(),
            (error) =>
              error instanceof PendingMigrationsError &&
              error.pendingMigrations.some(({ name }) =>
                name.includes(collectionName),
              ),
          );
        } finally {
          await store.close();
        }
      });

      assertDeepEqual([], ddl);
    },
  );

  void it(
    'lists pending projection migrations without creating tables when the user runs a diff dry run',
    withDeadline,
    async () => {
      const eventSchemaName = schemaName('events');
      const collectionName = schemaName('shopping_cart_summary');
      await pool.execute.command(
        SQL`CREATE SCHEMA ${SQL.identifier(eventSchemaName)}`,
      );
      const runtimeConnectionString =
        await connectionStringOfRoleWithoutCreate(eventSchemaName);
      let pendingMigrationNames: string[] = [];

      const ddl = await ddlSentBy(runtimeConnectionString, async () => {
        const store = getPostgreSQLEventStore({
          driver: pgEventStoreDriver,
          connectionString: runtimeConnectionString,
          schema: {
            autoMigration: 'None',
            databaseSchemaName: eventSchemaName,
          },
          projections: [
            {
              type: 'async',
              projection: shoppingCartSummaryProjection(collectionName),
            },
          ],
        });
        try {
          const result = await store.schema.migrate({ dryRun: 'diff' });
          pendingMigrationNames = result.applied.map(({ name }) => name);
        } finally {
          await store.close();
        }
      });

      assertDeepEqual([], ddl);
      assertTrue(
        pendingMigrationNames.some((name) => name.includes(collectionName)),
      );
      assertFalse(
        await tableExists(pool.execute, collectionName, eventSchemaName),
      );
    },
  );

  const migrateAsOwner = async (
    eventSchemaName: string,
    projection?: ReturnType<typeof shoppingCartSummaryProjection>,
  ) => {
    const owner = getPostgreSQLEventStore({
      driver: pgEventStoreDriver,
      connectionString,
      schema: { autoMigration: 'None', databaseSchemaName: eventSchemaName },
      projections: projection ? [{ type: 'async', projection }] : [],
    });
    try {
      await owner.schema.migrate();
    } finally {
      await owner.close();
    }
  };

  const connectionStringOfRoleWithoutCreate = async (
    databaseSchemaName: string,
  ): Promise<string> => {
    const roleName = schemaName('runtime');
    const password = uuid();
    const role = SQL.identifier(roleName);
    const schema = SQL.identifier(databaseSchemaName);

    await pool.execute.command(
      SQL`CREATE ROLE ${role} LOGIN PASSWORD ${SQL.literal(password)}`,
    );
    await pool.execute.command(
      SQL`ALTER ROLE ${role} SET log_statement = 'all'`,
    );
    await pool.execute.command(SQL`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
    await pool.execute.command(
      SQL`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${role}`,
    );
    await pool.execute.command(
      SQL`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${schema} TO ${role}`,
    );

    const url = new URL(connectionString);
    url.username = roleName;
    url.password = password;
    return url.toString();
  };

  const ddlSentBy = async (
    roleConnectionString: string,
    action: () => Promise<void>,
  ): Promise<string[]> => {
    const startMarker = `start:${uuid()}`;
    const endMarker = `end:${uuid()}`;
    const role = dumbo({
      connectionString: roleConnectionString,
      driver: pgDumboDriver,
    });
    try {
      await role.execute.query(SQL`SELECT ${SQL.literal(startMarker)}`);
      await action();
      await role.execute.query(SQL`SELECT ${SQL.literal(endMarker)}`);
    } finally {
      await role.close();
    }

    const deadline = Date.now() + 10000;
    while (!loggedText.includes(endMarker) && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 50));
    assertTrue(loggedText.includes(endMarker));

    return loggedText
      .slice(loggedText.indexOf(startMarker), loggedText.indexOf(endMarker))
      .split(/\n(?=\d{4}-\d{2}-\d{2} )/)
      .map((entry) =>
        /LOG:\s+(?:statement|execute [^:]*):\s*([\s\S]*)/
          .exec(entry)?.[1]
          ?.trim(),
      )
      .filter((statement): statement is string => statement !== undefined)
      .filter((statement) =>
        /^(CREATE|ALTER|DROP|GRANT|REVOKE|TRUNCATE|COMMENT)\b/i.test(statement),
      );
  };

  const projectEvent = async (
    store: ReturnType<typeof getPostgreSQLEventStore>,
  ) => {
    const consumer = store.consumer<ProductItemAdded>();

    void consumer.start();
    try {
      await consumer.whenStarted();

      await store.appendToStream(`shopping_cart-${uuid()}`, [
        { type: 'ProductItemAdded', data: { productItem } },
      ]);

      await consumer.whenCaughtUp();
    } finally {
      await consumer.close();
    }
  };

  const rowsInTable = (
    databaseSchemaName: string,
    tableName: string,
  ): Promise<number> =>
    count(
      pool.execute.query<{ count: number }>(
        SQL`
          SELECT COUNT(*)::integer AS count
          FROM ${SQLTableReference.from({ databaseSchemaName, tableName })}
        `,
      ),
    );
});

type ShoppingCartSummary = {
  productItemsCount: number;
};

const shoppingCartSummaryProjection = (collectionName: string) =>
  pongoSingleStreamProjection<ShoppingCartSummary, ProductItemAdded>({
    collectionName,
    canHandle: ['ProductItemAdded'],
    evolve: (
      document: ShoppingCartSummary,
      event: ProductItemAdded,
    ): ShoppingCartSummary => ({
      productItemsCount:
        document.productItemsCount + event.data.productItem.quantity,
    }),
    initialState: () => ({ productItemsCount: 0 }),
  });

const schemaName = (prefix: string): string =>
  `${prefix}_${uuid().replaceAll('-', '_')}`;
