import { count, dumbo, singleOrNull, SQL } from '@event-driven-io/dumbo';
import { pgDumboDriver, type PgPool } from '@event-driven-io/dumbo/pg';
import {
  assertEqual,
  assertIsNotNull,
  assertOk,
  type Event,
} from '@event-driven-io/emmett';
import { v4 as uuid } from 'uuid';
import { afterAll, beforeAll, describe, it } from 'vitest';
import {
  sharedPostgreSQLDatabase,
  type PostgreSQLTestDatabase,
} from '../../testing/postgreSQLTestDatabase';
import { getPostgreSQLEventStore } from '../postgreSQLEventStore';
import { createEventStoreSchema } from '.';
import { appendToStream } from './appendToStream';
import { truncateTables } from './truncateTables';
import {
  messagesTable,
  processorsTable,
  projectionsTable,
  streamsTable,
  tableReference,
} from './typing';

export type PricedProductItem = {
  productId: string;
  quantity: number;
  price: number;
};

export type ProductItemAdded = Event<
  'ProductItemAdded',
  { productItem: PricedProductItem },
  { meta: string }
>;

export type ShoppingCartEvent = ProductItemAdded;

void describe('truncateTables', () => {
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

    await createEventStoreSchema(connectionString, pool);
  });

  afterAll(async () => {
    try {
      await pool?.close();
      await database?.close();
    } catch (error) {
      console.log(error);
    }
  });

  const getTableCount = (tableName: string): Promise<number> => {
    return count(
      pool.execute.query<{ count: number }>(
        SQL`SELECT COUNT(*)::integer as count FROM ${SQL.identifier(tableName)}`,
      ),
    );
  };

  const getSchemaTableCount = (
    databaseSchemaName: string | undefined,
    tableName: string,
  ): Promise<number> => {
    return count(
      pool.execute.query<{ count: number }>(
        SQL`SELECT COUNT(*)::integer as count FROM ${tableReference(databaseSchemaName, tableName)}`,
      ),
    );
  };

  const getLatestGlobalPosition = async (): Promise<bigint | null> => {
    const result = await singleOrNull(
      pool.execute.query<{ global_position: bigint }>(
        SQL`SELECT global_position FROM ${SQL.identifier(messagesTable.name)} ORDER BY global_position DESC LIMIT 1`,
      ),
    );
    return result?.global_position ?? null;
  };

  const createTestEvent = (): ShoppingCartEvent => ({
    type: 'ProductItemAdded',
    data: { productItem: { productId: '1', quantity: 2, price: 30 } },
    metadata: { meta: 'data1' },
  });

  const appendTestEvents = async (
    streamId: string,
    events: ShoppingCartEvent[],
    databaseSchemaName?: string,
  ) => {
    const result = await pool.withConnection(async (connection) =>
      appendToStream(connection, streamId, 'shopping_cart', events, {
        databaseSchemaName,
      }),
    );
    assertOk(result.success);
    return result;
  };

  void it('should truncate all tables successfully', async () => {
    // Given
    const events = [createTestEvent()];
    const streamId = uuid();
    await appendTestEvents(streamId, events);

    assertEqual(1, await getTableCount(streamsTable.name));
    assertEqual(1, await getTableCount(messagesTable.name));

    // When
    await truncateTables(pool.execute);

    // Then
    assertEqual(0, await getTableCount(streamsTable.name));
    assertEqual(0, await getTableCount(messagesTable.name));
    assertEqual(0, await getTableCount(processorsTable.name));
    assertEqual(0, await getTableCount(projectionsTable.name));
  });

  void it('should truncate tables and reset sequences when resetSequences option is true', async () => {
    // Given
    const events = [createTestEvent()];
    const firstStreamId = uuid();
    await appendTestEvents(firstStreamId, events);

    const firstGlobalPosition = await getLatestGlobalPosition();
    assertIsNotNull(firstGlobalPosition);
    assertOk(firstGlobalPosition > 0);

    // When
    await truncateTables(pool.execute, { resetSequences: true });

    // Then
    const secondStreamId = uuid();
    await appendTestEvents(secondStreamId, events);

    const secondGlobalPosition = await getLatestGlobalPosition();
    assertIsNotNull(secondGlobalPosition);
    assertEqual(1n, secondGlobalPosition);
  });

  void it('should truncate tables without resetting sequences when resetSequences option is false', async () => {
    // Given
    await truncateTables(pool.execute);

    const events = [createTestEvent()];
    const firstStreamId = uuid();
    await appendTestEvents(firstStreamId, events);

    const firstGlobalPosition = await getLatestGlobalPosition();
    assertIsNotNull(firstGlobalPosition);

    // When
    await truncateTables(pool.execute, { resetSequences: false });

    // Then
    const secondStreamId = uuid();
    await appendTestEvents(secondStreamId, events);

    const secondGlobalPosition = await getLatestGlobalPosition();
    assertIsNotNull(secondGlobalPosition);
    assertOk(secondGlobalPosition > firstGlobalPosition);
  });

  void it('should truncate tables without resetting sequences when no options provided', async () => {
    // Given
    await truncateTables(pool.execute);

    const events = [createTestEvent()];
    const firstStreamId = uuid();
    await appendTestEvents(firstStreamId, events);

    const firstGlobalPosition = await getLatestGlobalPosition();
    assertIsNotNull(firstGlobalPosition);

    // When
    await truncateTables(pool.execute);

    // Then
    const secondStreamId = uuid();
    await appendTestEvents(secondStreamId, events);

    const secondGlobalPosition = await getLatestGlobalPosition();
    assertIsNotNull(secondGlobalPosition);
    assertOk(secondGlobalPosition > firstGlobalPosition);
  });

  void it('should handle CASCADE correctly by truncating dependent tables', async () => {
    // Given
    const events = [createTestEvent()];
    const streamId = uuid();
    await appendTestEvents(streamId, events);

    // When
    await truncateTables(pool.execute);

    // Then
    const allTablesCounts = await Promise.all([
      getTableCount(streamsTable.name),
      getTableCount(messagesTable.name),
      getTableCount(processorsTable.name),
      getTableCount(projectionsTable.name),
    ]);

    allTablesCounts.forEach((count) => {
      assertEqual(0, count);
    });
  });

  void it('should truncate only the tables in the database schema configured by the user', async () => {
    // Given
    const truncatedSchemaName = schemaName('events');
    const otherSchemaName = schemaName('other_events');

    await createEventStoreSchema(connectionString, pool, undefined, {
      databaseSchemaName: truncatedSchemaName,
    });
    await createEventStoreSchema(connectionString, pool, undefined, {
      databaseSchemaName: otherSchemaName,
    });

    const events = [createTestEvent()];
    await appendTestEvents(uuid(), events, truncatedSchemaName);
    await appendTestEvents(uuid(), events, otherSchemaName);

    assertEqual(
      1,
      await getSchemaTableCount(truncatedSchemaName, messagesTable.name),
    );
    assertEqual(
      1,
      await getSchemaTableCount(otherSchemaName, messagesTable.name),
    );

    // When
    await truncateTables(pool.execute, {
      databaseSchemaName: truncatedSchemaName,
    });

    // Then
    assertEqual(
      0,
      await getSchemaTableCount(truncatedSchemaName, streamsTable.name),
    );
    assertEqual(
      0,
      await getSchemaTableCount(truncatedSchemaName, messagesTable.name),
    );
    assertEqual(
      0,
      await getSchemaTableCount(truncatedSchemaName, processorsTable.name),
    );
    assertEqual(
      0,
      await getSchemaTableCount(truncatedSchemaName, projectionsTable.name),
    );

    assertEqual(
      1,
      await getSchemaTableCount(otherSchemaName, streamsTable.name),
    );
    assertEqual(
      1,
      await getSchemaTableCount(otherSchemaName, messagesTable.name),
    );
  });

  void it('should truncate only the event store configured database schema through schema.dangerous.truncate', async () => {
    // Given
    const truncatedSchemaName = schemaName('events');
    const otherSchemaName = schemaName('other_events');

    const first = getPostgreSQLEventStore(connectionString, {
      schema: {
        autoMigration: 'CreateOrUpdate',
        databaseSchemaName: truncatedSchemaName,
      },
    });
    const second = getPostgreSQLEventStore(connectionString, {
      schema: {
        autoMigration: 'CreateOrUpdate',
        databaseSchemaName: otherSchemaName,
      },
    });

    try {
      await first.appendToStream(`shopping_cart-${uuid()}`, [
        createTestEvent(),
      ]);
      await second.appendToStream(`shopping_cart-${uuid()}`, [
        createTestEvent(),
      ]);

      assertEqual(
        1,
        await getSchemaTableCount(truncatedSchemaName, streamsTable.name),
      );
      assertEqual(
        1,
        await getSchemaTableCount(truncatedSchemaName, messagesTable.name),
      );
      assertEqual(
        1,
        await getSchemaTableCount(otherSchemaName, streamsTable.name),
      );
      assertEqual(
        1,
        await getSchemaTableCount(otherSchemaName, messagesTable.name),
      );

      // When
      await first.schema.dangerous.truncate();

      // Then
      assertEqual(
        0,
        await getSchemaTableCount(truncatedSchemaName, streamsTable.name),
      );
      assertEqual(
        0,
        await getSchemaTableCount(truncatedSchemaName, messagesTable.name),
      );
      assertEqual(
        1,
        await getSchemaTableCount(otherSchemaName, streamsTable.name),
      );
      assertEqual(
        1,
        await getSchemaTableCount(otherSchemaName, messagesTable.name),
      );
    } finally {
      await first.close();
      await second.close();
    }
  });
});

const schemaName = (prefix: string): string =>
  `${prefix}_${uuid().replaceAll('-', '_')}`;
