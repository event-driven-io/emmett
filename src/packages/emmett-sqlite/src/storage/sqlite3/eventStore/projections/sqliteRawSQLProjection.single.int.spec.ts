import { single, SQL, type QueryResultRow } from '@event-driven-io/dumbo';
import {
  InMemorySQLiteDatabase,
  sqlite3Pool,
  tableExists,
  type AnySQLiteConnection,
} from '@event-driven-io/dumbo/sqlite3';
import {
  assertDeepEqual,
  assertEqual,
  assertFalse,
  assertRejects,
  JSONSerializer,
} from '@event-driven-io/emmett';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';
import { beforeEach, describe, it } from 'vitest';
import { sqlite3EventStoreDriver } from '../../../../sqlite3';
import { deleteSQLiteDatabaseFiles } from '../../testing/sqliteTestDatabase';
import { getSQLiteEventStore } from '../../../../eventStore/SQLiteEventStore';
import type {
  DiscountApplied,
  ProductItemAdded,
} from '../../../../testing/shoppingCart.domain';
import { sqliteRawSQLProjection } from '../../../../eventStore/projections/sqliteProjection';
import {
  eventInStream,
  eventsInStream,
  newEventsInStream,
  SQLiteProjectionSpec,
} from '../../../../eventStore/projections/sqliteProjectionSpec';
const { identifier } = SQL;

type EventType =
  | (ProductItemAdded & {
      metadata: { streamName: string };
    })
  | (DiscountApplied & {
      metadata: { streamName: string };
    });

const projection = 'shoppingCartShortInfo';

void describe('SQLite Projections', () => {
  let given: SQLiteProjectionSpec<EventType>;
  let shoppingCartId: string;

  beforeEach(() => {
    shoppingCartId = `shoppingCart:${uuid()}:${uuid()}`;

    given = SQLiteProjectionSpec.for({
      driver: sqlite3EventStoreDriver,
      projection: shoppingCartShortInfoProjection,
      fileName: InMemorySQLiteDatabase,
    });
  });

  void it('with empty given and raw when', () =>
    given([])
      .when([
        {
          type: 'ProductItemAdded',
          data: {
            productItem: {
              price: 100,
              productId: 'shoes',
              quantity: 100,
            },
          },
          metadata: {
            streamName: shoppingCartId,
          },
        },
      ])
      .then(
        async ({ connection }) =>
          await rowExists({
            connection,
            id: shoppingCartId,
          }),
      ));

  void it('with empty given and when eventsInStream', () =>
    given([])
      .when([
        eventInStream(shoppingCartId, {
          type: 'ProductItemAdded',
          data: {
            productItem: { price: 100, productId: 'shoes', quantity: 100 },
          },
          metadata: {
            streamName: shoppingCartId,
          },
        }),
      ])
      .then(
        async ({ connection }) =>
          await rowExistsWithValues({
            connection,
            id: shoppingCartId,
            data: {
              id: shoppingCartId,
              productItemsCount: 100,
              totalAmount: 10000,
              discountsApplied: JSONSerializer.serialize([]),
            },
          }),
      ));

  void it('with idempotency check', () => {
    const couponId = uuid();

    return given(
      eventsInStream(shoppingCartId, [
        {
          type: 'ProductItemAdded',
          data: {
            productItem: { price: 100, productId: 'shoes', quantity: 100 },
          },
          metadata: {
            streamName: shoppingCartId,
          },
        },
      ]),
    )
      .when(
        newEventsInStream(shoppingCartId, [
          {
            type: 'DiscountApplied',
            data: { percent: 10, couponId },
            metadata: {
              streamName: shoppingCartId,
            },
          },
        ]),
        { numberOfTimes: 2 },
      )
      .then(
        async ({ connection }) =>
          await rowExistsWithValues({
            connection,
            id: shoppingCartId,
            data: {
              id: shoppingCartId,
              productItemsCount: 100,
              totalAmount: 9000,
              discountsApplied: JSONSerializer.serialize([couponId]),
            },
          }),
      );
  });

  for (const dryRun of ['transactional', 'diff'] as const) {
    void it(`creates no raw SQL projection table when the user runs a ${dryRun} dry run`, async () => {
      const fileName = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        `raw-sql-dry-run-${uuid()}.db`,
      );
      const eventStore = getSQLiteEventStore({
        driver: sqlite3EventStoreDriver,
        fileName,
        schema: { autoMigration: 'None' },
        projections: [
          {
            type: 'inline',
            projection: sqliteRawSQLProjection<ProductItemAdded>({
              name: 'dry_run_projection',
              canHandle: ['ProductItemAdded'],
              init: () =>
                SQL`CREATE TABLE IF NOT EXISTS ${identifier('dry_run_projection')} (id TEXT)`,
              evolve: () => SQL`SELECT 1;`,
            }),
          },
        ],
      });
      const pool = sqlite3Pool({ fileName });

      try {
        await eventStore.schema.migrate({ dryRun });

        assertFalse(await tableExists(pool.execute, 'dry_run_projection'));
      } finally {
        await eventStore.close();
        await pool.close();
        deleteSQLiteDatabaseFiles(fileName);
      }
    });
  }

  void it('reverts the raw SQL projection table and the event store schema when another projection fails during migration', async () => {
    const fileName = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      `raw-sql-reverted-${uuid()}.db`,
    );
    const eventStore = getSQLiteEventStore({
      driver: sqlite3EventStoreDriver,
      fileName,
      schema: { autoMigration: 'None' },
      projections: [
        {
          type: 'inline',
          projection: sqliteRawSQLProjection<ProductItemAdded>({
            name: 'reverted_projection',
            canHandle: ['ProductItemAdded'],
            init: () =>
              SQL`CREATE TABLE IF NOT EXISTS ${identifier('reverted_projection')} (id TEXT)`,
            evolve: () => SQL`SELECT 1;`,
          }),
        },
        {
          type: 'inline',
          projection: sqliteRawSQLProjection<ProductItemAdded>({
            name: 'failing_init',
            canHandle: ['ProductItemAdded'],
            init: () => {
              throw new Error('projection init failed on purpose');
            },
            evolve: () => SQL`SELECT 1;`,
          }),
        },
      ],
    });
    const pool = sqlite3Pool({ fileName });

    try {
      await assertRejects(
        eventStore.schema.migrate(),
        (error) =>
          error instanceof Error &&
          error.message === 'projection init failed on purpose',
      );

      assertFalse(await tableExists(pool.execute, 'reverted_projection'));
      assertFalse(await tableExists(pool.execute, 'emt_streams'));
    } finally {
      await eventStore.close();
      await pool.close();
      deleteSQLiteDatabaseFiles(fileName);
    }
  });

  void it('passes the configured schema names to raw SQL projection handlers', async () => {
    const databaseSchemaName = 'events';
    const projectionsDatabaseSchemaName = 'read_models';
    const migrationSchemaName = 'infrastructure';
    let evolveProjectionsDatabaseSchemaName: string | undefined;
    let evolveMigrationTableSchemaName: string | undefined;

    const givenConfigured = SQLiteProjectionSpec.for({
      driver: sqlite3EventStoreDriver,
      fileName: InMemorySQLiteDatabase,
      schema: {
        autoMigration: 'CreateOrUpdate',
        databaseSchemaName,
        projectionsDatabaseSchemaName,
        migrationTable: {
          schemaName: migrationSchemaName,
          tableName: 'emmett_migrations',
        },
      },
      projection: sqliteRawSQLProjection<ProductItemAdded>({
        name: 'raw_product_sales',
        canHandle: ['ProductItemAdded'],
        evolve: (_event, context) => {
          evolveProjectionsDatabaseSchemaName =
            context.migrationOptions?.projectionsDatabaseSchemaName;
          evolveMigrationTableSchemaName =
            context.migrationOptions?.migrationTable?.schemaName;
          return SQL`SELECT 1;`;
        },
      }),
    });

    await givenConfigured([])
      .when([
        {
          type: 'ProductItemAdded',
          data: {
            productItem: { price: 100, productId: 'shoes', quantity: 2 },
          },
          metadata: { streamName: shoppingCartId },
        },
      ])
      .then(() => {
        assertEqual(
          evolveProjectionsDatabaseSchemaName,
          projectionsDatabaseSchemaName,
        );
        assertEqual(evolveMigrationTableSchemaName, migrationSchemaName);
        return Promise.resolve();
      });
  });
});
const rowExistsWithValues = async <T extends QueryResultRow>({
  connection: { execute },
  id,
  data,
}: {
  connection: AnySQLiteConnection;
  id: string;
  data: T;
}): Promise<boolean> => {
  const res = await single(
    execute.query<T>(
      SQL`SELECT * FROM ${identifier(projection)} WHERE id = ${id}`,
    ),
  );

  assertDeepEqual(data, res);

  return true;
};

const rowExists = async <T extends QueryResultRow>({
  connection: { execute },
  id,
}: {
  connection: AnySQLiteConnection;
  id: string;
}): Promise<boolean> => {
  const res = await single(
    execute.query<T>(
      SQL`SELECT * FROM ${identifier(projection)} WHERE id = ${id}`,
    ),
  );

  if (res == null) return false;

  return true;
};

const shoppingCartShortInfoProjection = sqliteRawSQLProjection({
  name: 'shoppingCartShortInfo',
  evolve: (event: EventType): SQL => {
    switch (event.type) {
      case 'ProductItemAdded': {
        const productItemsCount = event.data.productItem.quantity;
        const totalAmount =
          event.data.productItem.price * event.data.productItem.quantity;

        const sql = SQL`INSERT INTO 
          ${identifier(projection)} 
          (
            id, 
            productItemsCount, 
            totalAmount, 
            discountsApplied
          ) VALUES (
            ${event.metadata.streamName}, 
            ${productItemsCount}, 
            ${totalAmount}, 
            "[]"
          )
          ON CONFLICT (id) DO UPDATE SET
            productItemsCount = productItemsCount + ${productItemsCount},
            totalAmount = totalAmount + ${totalAmount};`;

        return sql;
      }
      case 'DiscountApplied': {
        const sql = SQL`INSERT INTO 
          ${identifier(projection)} 
          (
            id, 
            productItemsCount, 
            totalAmount, 
            discountsApplied
          ) VALUES (
            ${event.metadata.streamName}, 
            0, 
            0, 
            "[]"
          )
          ON CONFLICT (id) DO UPDATE SET
            totalAmount = (totalAmount * (100 - ${event.data.percent})) / 100,
             discountsApplied = 
               json_insert(
                  COALESCE(discountsApplied, '[]'),
                  '$[#]', 
                  ${event.data.couponId})
             WHERE json_array_length(discountsApplied) = 0 
                  OR NOT EXISTS (
                    SELECT 1 FROM json_each(discountsApplied) 
                    WHERE json_each.value = ${event.data.couponId}
                  )`;

        return sql;
      }
      default:
        throw new Error(
          `Unknown event type for ${shoppingCartShortInfoProjection.name}`,
        );
    }
  },
  canHandle: ['ProductItemAdded', 'DiscountApplied'],
  init: () => SQL`CREATE TABLE IF NOT EXISTS ${identifier(projection)}
        (
          id TEXT PRIMARY KEY,
          productItemsCount INTEGER,
          totalAmount INTEGER,
          discountsApplied JSON
        );
      `,
});
