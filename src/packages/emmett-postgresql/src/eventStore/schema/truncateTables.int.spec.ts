import {
  count,
  dumbo,
  singleOrNull,
  sql,
  type Dumbo,
} from '@event-driven-io/dumbo';
import {
  assertEqual,
  assertIsNotNull,
  assertOk,
  type Event,
} from '@event-driven-io/emmett';
import { type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { after, before, describe, it } from 'node:test';
import { v4 as uuid } from 'uuid';
import { createEventStoreSchema } from '.';
import { appendToStream } from './appendToStream';
import { truncateTables } from './truncateTables';
import {
  messagesTable,
  processorsTable,
  projectionsTable,
  streamsTable,
} from './typing';
import { getPostgreSQLStartedContainer } from '@event-driven-io/emmett-testcontainers';

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
  let postgres: StartedPostgreSqlContainer;
  let pool: Dumbo;

  before(async () => {
    postgres = await getPostgreSQLStartedContainer();
    const connectionString = postgres.getConnectionUri();
    pool = dumbo({
      connectionString,
    });

    await createEventStoreSchema(connectionString, pool);
  });

  after(async () => {
    try {
      await pool.close();
      await postgres.stop();
    } catch (error) {
      console.log(error);
    }
  });

  const getTableCount = (tableName: string): Promise<number> => {
    return count(
      pool.execute.query<{ count: number }>(
        sql(`SELECT COUNT(*)::integer as count FROM ${tableName}`),
      ),
    );
  };

  const getLatestGlobalPosition = async (): Promise<bigint | null> => {
    const result = await singleOrNull(
      pool.execute.query<{ global_position: bigint }>(
        sql(
          `SELECT global_position FROM ${messagesTable.name} ORDER BY global_position DESC LIMIT 1`,
        ),
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
  ) => {
    const result = await appendToStream(
      pool,
      streamId,
      'shopping_cart',
      events,
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
});
