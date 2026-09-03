import { count, singleOrNull, SQL } from '@event-driven-io/dumbo';
import {
  sqlite3Pool,
  type SQLite3Connection,
  type SQLitePool,
} from '@event-driven-io/dumbo/sqlite3';
import {
  assertEqual,
  assertIsNotNull,
  assertOk,
  assertTrue,
  type Event,
} from '@event-driven-io/emmett';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';
import { afterEach, beforeEach, describe, it } from 'vitest';
import { sqlite3EventStoreDriver } from '../../sqlite3';
import { deleteSQLiteDatabaseFiles } from '../../testing/sqliteTestDatabase';
import { getSQLiteEventStore } from '../SQLiteEventStore';
import { createEventStoreSchema } from './index';
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
  const testDatabasePath = path.dirname(fileURLToPath(import.meta.url));
  const fileName = path.resolve(testDatabasePath, 'truncate-tables.db');

  let pool: SQLitePool<SQLite3Connection>;

  beforeEach(() => {
    pool = sqlite3Pool({
      fileName,
      transactionOptions: {
        allowNestedTransactions: true,
      },
    });
  });

  afterEach(async () => {
    await pool.close();
    deleteSQLiteDatabaseFiles(fileName);
  });

  void it('truncates all tables in the default database schema', async () => {
    // Given
    await createEventStoreSchema(pool);
    await appendTestEvent(uuid());

    assertEqual(1, await tableCount(undefined, streamsTable.name));
    assertEqual(1, await tableCount(undefined, messagesTable.name));

    // When
    await truncateTables(pool.execute);

    // Then
    assertEqual(0, await tableCount(undefined, streamsTable.name));
    assertEqual(0, await tableCount(undefined, messagesTable.name));
    assertEqual(0, await tableCount(undefined, processorsTable.name));
    assertEqual(0, await tableCount(undefined, projectionsTable.name));
  });

  void it('truncates only the tables in the database schema configured by the user', async () => {
    // Given
    await createEventStoreSchema(pool, undefined, {
      databaseSchemaName: 'events',
    });
    await createEventStoreSchema(pool, undefined, {
      databaseSchemaName: 'other_events',
    });

    await appendTestEvent(uuid(), 'events');
    await appendTestEvent(uuid(), 'other_events');

    assertEqual(1, await tableCount('events', messagesTable.name));
    assertEqual(1, await tableCount('other_events', messagesTable.name));

    // When
    await truncateTables(pool.execute, { databaseSchemaName: 'events' });

    // Then
    assertEqual(0, await tableCount('events', streamsTable.name));
    assertEqual(0, await tableCount('events', messagesTable.name));
    assertEqual(0, await tableCount('events', processorsTable.name));
    assertEqual(0, await tableCount('events', projectionsTable.name));

    assertEqual(1, await tableCount('other_events', streamsTable.name));
    assertEqual(1, await tableCount('other_events', messagesTable.name));
  });

  void it('truncates only the event store configured database schema through schema.dangerous.truncate', async () => {
    // Given
    const first = getSQLiteEventStore({
      driver: sqlite3EventStoreDriver,
      fileName,
      schema: {
        autoMigration: 'CreateOrUpdate',
        databaseSchemaName: 'events',
      },
    });
    const second = getSQLiteEventStore({
      driver: sqlite3EventStoreDriver,
      fileName,
      schema: {
        autoMigration: 'CreateOrUpdate',
        databaseSchemaName: 'other_events',
      },
    });

    try {
      await first.appendToStream(`shopping_cart-${uuid()}`, events);
      await second.appendToStream(`shopping_cart-${uuid()}`, events);

      assertEqual(1, await tableCount('events', streamsTable.name));
      assertEqual(1, await tableCount('events', messagesTable.name));
      assertEqual(1, await tableCount('other_events', streamsTable.name));
      assertEqual(1, await tableCount('other_events', messagesTable.name));

      // When
      await first.schema.dangerous.truncate();

      // Then
      assertEqual(0, await tableCount('events', streamsTable.name));
      assertEqual(0, await tableCount('events', messagesTable.name));
      assertEqual(1, await tableCount('other_events', streamsTable.name));
      assertEqual(1, await tableCount('other_events', messagesTable.name));
    } finally {
      await first.close();
      await second.close();
    }
  });

  void it('restarts the global position at 1 after truncating', async () => {
    // Given
    await createEventStoreSchema(pool);
    await appendTestEvent(uuid());

    const firstGlobalPosition = await latestGlobalPosition();
    assertIsNotNull(firstGlobalPosition);
    assertTrue(firstGlobalPosition > 0n);

    // When
    await truncateTables(pool.execute);

    // Then
    await appendTestEvent(uuid());

    const secondGlobalPosition = await latestGlobalPosition();
    assertIsNotNull(secondGlobalPosition);
    assertEqual(1n, secondGlobalPosition);
  });

  void it('restarts the global position at 1 only in the truncated database schema', async () => {
    // Given
    await createEventStoreSchema(pool, undefined, {
      databaseSchemaName: 'events',
    });
    await createEventStoreSchema(pool, undefined, {
      databaseSchemaName: 'other_events',
    });

    await appendTestEvent(uuid(), 'events');
    await appendTestEvent(uuid(), 'events');
    await appendTestEvent(uuid(), 'other_events');
    await appendTestEvent(uuid(), 'other_events');

    const eventsGlobalPosition = await latestGlobalPosition('events');
    assertIsNotNull(eventsGlobalPosition);
    assertTrue(eventsGlobalPosition > 1n);

    const otherEventsGlobalPosition =
      await latestGlobalPosition('other_events');
    assertIsNotNull(otherEventsGlobalPosition);
    assertTrue(otherEventsGlobalPosition > 1n);

    // When
    await truncateTables(pool.execute, { databaseSchemaName: 'events' });

    // Then
    await appendTestEvent(uuid(), 'events');

    const eventsGlobalPositionAfterTruncate =
      await latestGlobalPosition('events');
    assertIsNotNull(eventsGlobalPositionAfterTruncate);
    assertEqual(1n, eventsGlobalPositionAfterTruncate);

    assertEqual(
      otherEventsGlobalPosition,
      await latestGlobalPosition('other_events'),
    );
  });

  const events: ShoppingCartEvent[] = [
    {
      type: 'ProductItemAdded',
      data: { productItem: { productId: '1', quantity: 2, price: 30 } },
      metadata: { meta: 'data1' },
    },
  ];

  const appendTestEvent = async (
    streamName: string,
    databaseSchemaName?: string,
  ) => {
    const result = await pool.withConnection((connection) =>
      appendToStream(connection, streamName, 'shopping_cart', events, {
        databaseSchemaName,
      }),
    );

    assertOk(result.success);

    return result;
  };

  const tableCount = (
    databaseSchemaName: string | undefined,
    tableName: string,
  ): Promise<number> =>
    count(
      pool.execute.query<{ count: number }>(
        SQL`SELECT COUNT(*) AS count FROM ${tableReference(databaseSchemaName, tableName)}`,
      ),
    );

  const latestGlobalPosition = async (
    databaseSchemaName?: string,
  ): Promise<bigint | null> => {
    const result = await singleOrNull(
      pool.execute.query<{ global_position: string }>(
        SQL`SELECT CAST(global_position as VARCHAR) AS global_position FROM ${tableReference(databaseSchemaName, messagesTable.name)} ORDER BY global_position DESC LIMIT 1`,
      ),
    );

    return result !== null ? BigInt(result.global_position) : null;
  };
});
