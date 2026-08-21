import { dumbo, SQL, type SQLExecutor } from '@event-driven-io/dumbo';
import { pgDumboDriver, type PgPool } from '@event-driven-io/dumbo/pg';
import { assertEqual, assertIsNotNull } from '@event-driven-io/emmett';
import { v4 as uuid } from 'uuid';
import { afterAll, beforeAll, describe, it } from 'vitest';
import {
  sharedPostgreSQLDatabase,
  type PostgreSQLTestDatabase,
} from '../../testing/postgreSQLTestDatabase';
import type { ProductItemAdded } from '../../testing/shoppingCart.domain';
import {
  getPostgreSQLEventStore,
  type PostgresEventStore,
} from '../postgreSQLEventStore';
import { postgreSQLProjection, readProjectionInfo } from '../projections';
import { readProcessorCheckpoint } from '../schema';
import {
  emmettRelation,
  processorsTable,
  projectionsTable,
} from '../schema/typing';

const withDeadline = { timeout: 30000 };

void describe('PostgreSQL event store consumer schema configuration', () => {
  let database: PostgreSQLTestDatabase;
  let connectionString: string;
  let pool: PgPool;
  const stores: PostgresEventStore[] = [];
  const productItem = { price: 10, productId: uuid(), quantity: 10 };

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
    'passes the configured schema names to inline PostgreSQL projection handlers',
    withDeadline,
    async () => {
      const eventSchemaName = schemaName('events');
      let migrationTableSchemaName: string | undefined;
      let projectionsDatabaseSchemaName: string | undefined;
      const store = getPostgreSQLEventStore(connectionString, {
        schema: {
          autoMigration: 'CreateOrUpdate',
          databaseSchemaName: eventSchemaName,
          migrationTable: {
            tableName: 'custom_migrations',
          },
        },
        projections: [
          {
            type: 'inline',
            projection: postgreSQLProjection<ProductItemAdded>({
              name: schemaName('projection'),
              canHandle: ['ProductItemAdded'],
              handle: (_events, context) => {
                migrationTableSchemaName =
                  context.migrationOptions?.migrationTable?.schemaName;
                projectionsDatabaseSchemaName =
                  context.migrationOptions?.projectionsDatabaseSchemaName;
              },
            }),
          },
        ],
      });
      stores.push(store);

      await store.appendToStream(`shopping_cart-${uuid()}`, [
        { type: 'ProductItemAdded', data: { productItem } },
      ]);

      assertEqual(migrationTableSchemaName, eventSchemaName);
      assertEqual(projectionsDatabaseSchemaName, eventSchemaName);
    },
  );

  void it(
    'keeps processor checkpoints and projection registrations in the configured event-store schema',
    withDeadline,
    async () => {
      const eventSchemaName = schemaName('events');
      const projectionSchemaName = schemaName('read_models');
      const processorId = `processor:${uuid()}`;
      const projectionName = schemaName('projection');
      const store = getPostgreSQLEventStore(connectionString, {
        schema: {
          autoMigration: 'CreateOrUpdate',
          databaseSchemaName: eventSchemaName,
          projectionsDatabaseSchemaName: projectionSchemaName,
          migrationTable: {
            schemaName: schemaName('infrastructure'),
            tableName: 'emmett_migrations',
          },
        },
      });
      stores.push(store);

      await store.schema.migrate();

      const consumer = store.consumer<ProductItemAdded>({
        stopWhen: { noMessagesLeft: true },
      });
      consumer.projector({
        processorId,
        projection: postgreSQLProjection<ProductItemAdded>({
          name: projectionName,
          canHandle: ['ProductItemAdded'],
          handle: () => {},
        }),
      });

      await store.appendToStream(`shopping_cart-${uuid()}`, [
        { type: 'ProductItemAdded', data: { productItem } },
      ]);
      await consumer.start();

      const checkpoint = await readProcessorCheckpoint(pool.execute, {
        processorId,
        databaseSchemaName: eventSchemaName,
      });
      const registration = await readProjectionInfo(pool.execute, {
        databaseSchemaName: eventSchemaName,
        name: projectionName,
        partition: 'emt:default',
        version: 1,
      });

      assertIsNotNull(checkpoint);
      assertIsNotNull(registration);
      assertEqual(await countProcessorRows(projectionSchemaName), 0);
      assertEqual(await countProcessorRows(undefined), 0);
      assertEqual(await countProjectionRows(projectionSchemaName), 0);
      assertEqual(await countProjectionRows(undefined), 0);
    },
  );

  void it(
    'passes the configured schema names to PostgreSQL projection initialization',
    withDeadline,
    async () => {
      const eventSchemaName = schemaName('events');
      const processorId = `processor:${uuid()}`;
      const projectionName = schemaName('projection');
      const store = getPostgreSQLEventStore(connectionString, {
        schema: {
          autoMigration: 'CreateOrUpdate',
          databaseSchemaName: eventSchemaName,
          migrationTable: {
            tableName: 'custom_migrations',
          },
        },
      });
      stores.push(store);
      await store.schema.migrate();

      let migrationTableSchemaName: string | undefined;
      let projectionsDatabaseSchemaName: string | undefined;

      const consumer = store.consumer<ProductItemAdded>({
        stopWhen: { noMessagesLeft: true },
      });
      consumer.projector({
        processorId,
        projection: postgreSQLProjection<ProductItemAdded>({
          name: projectionName,
          canHandle: ['ProductItemAdded'],
          handle: () => {},
          init: ({ context }) => {
            migrationTableSchemaName =
              context.migrationOptions?.migrationTable?.schemaName;
            projectionsDatabaseSchemaName =
              context.migrationOptions?.projectionsDatabaseSchemaName;
          },
        }),
      });

      await consumer.start();

      assertEqual(migrationTableSchemaName, eventSchemaName);
      assertEqual(projectionsDatabaseSchemaName, eventSchemaName);
    },
  );

  const countProcessorRows = async (
    databaseSchemaName: string | undefined,
  ): Promise<number> => {
    if (
      !(await tableExists(
        pool.execute,
        databaseSchemaName,
        processorsTable.name,
      ))
    )
      return 0;

    const result = await pool.execute.query<{ count: string }>(
      SQL`SELECT COUNT(*) AS count FROM ${emmettRelation(databaseSchemaName, processorsTable.name)}`,
    );
    return Number(result.rows[0]?.count ?? 0);
  };

  const countProjectionRows = async (
    databaseSchemaName: string | undefined,
  ): Promise<number> => {
    if (
      !(await tableExists(
        pool.execute,
        databaseSchemaName,
        projectionsTable.name,
      ))
    )
      return 0;

    const result = await pool.execute.query<{ count: string }>(
      SQL`SELECT COUNT(*) AS count FROM ${emmettRelation(databaseSchemaName, projectionsTable.name)}`,
    );
    return Number(result.rows[0]?.count ?? 0);
  };
});

const schemaName = (prefix: string): string =>
  `${prefix}_${uuid().replaceAll('-', '_')}`;

const tableExists = async (
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
