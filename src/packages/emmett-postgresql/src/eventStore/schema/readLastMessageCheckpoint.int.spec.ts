import { dumbo, SQL } from '@event-driven-io/dumbo';
import { pgDumboDriver, type PgPool } from '@event-driven-io/dumbo/pg';
import {
  assertDeepEqual,
  assertIsNotNull,
  assertIsNull,
  assertTrue,
  type Event,
} from '@event-driven-io/emmett';
import { getPostgreSQLStartedContainer } from '@event-driven-io/emmett-testcontainers';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { v4 as uuid } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { createEventStoreSchema, readLastMessageCheckpoint } from '.';
import { appendToStream } from './appendToStream';
import { messagesTable } from './typing';

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

void describe('readLastMessageGlobalPosition', () => {
  let postgres: StartedPostgreSqlContainer;
  let pool: PgPool;

  beforeAll(async () => {
    postgres = await getPostgreSQLStartedContainer();
    const connectionString = postgres.getConnectionUri();
    pool = dumbo({
      connectionString,
      driver: pgDumboDriver,
    });

    await createEventStoreSchema(connectionString, pool);
  });

  beforeEach(async () => {
    await pool.execute.command(
      SQL`TRUNCATE TABLE ${SQL.identifier(messagesTable.name)}`,
    );
  });

  afterAll(async () => {
    try {
      await pool?.close();
      await postgres?.stop();
    } catch (error) {
      console.log(error);
    }
  });

  const events: ProductItemAdded[] = Array.from({ length: 3 }, (_, i) => ({
    type: 'ProductItemAdded',
    data: { productItem: { productId: String(i + 1), quantity: i, price: 30 } },
    metadata: { meta: `data${i + 1}` },
  }));

  void it('returns global position of last existing event of single event', async () => {
    // Given
    const result = await pool.withConnection(async (connection) =>
      appendToStream(connection, uuid(), 'shopping_cart', events.slice(0, 1), {
        expectedStreamVersion: 0n,
      }),
    );
    assertTrue(result.success);
    const lastCheckpoint = result.checkpoints[result.checkpoints.length - 1]!;

    // When
    const { currentCheckpoint } = await readLastMessageCheckpoint(pool.execute);

    // Then
    assertIsNotNull(currentCheckpoint);
    assertDeepEqual(currentCheckpoint, lastCheckpoint);
  });

  void it('returns global position of last existing event of single existing stream', async () => {
    // Given
    const result = await pool.withConnection(async (connection) =>
      appendToStream(connection, uuid(), 'shopping_cart', events, {
        expectedStreamVersion: 0n,
      }),
    );
    assertTrue(result.success);
    const lastCheckpoint = result.checkpoints[result.checkpoints.length - 1]!;

    // When
    const { currentCheckpoint } = await readLastMessageCheckpoint(pool.execute);

    // Then
    assertIsNotNull(currentCheckpoint);
    assertDeepEqual(currentCheckpoint, lastCheckpoint);
  });

  void it('returns global position of last existing event of multiple existing streams', async () => {
    // Given
    await pool.withConnection(async (connection) =>
      appendToStream(connection, uuid(), 'shopping_cart', events, {
        expectedStreamVersion: 0n,
      }),
    );
    const result = await pool.withConnection(async (connection) =>
      appendToStream(connection, uuid(), 'shopping_cart', events),
    );
    assertTrue(result.success);
    const lastCheckpoint = result.checkpoints[result.checkpoints.length - 1]!;

    // When
    const { currentCheckpoint } = await readLastMessageCheckpoint(pool.execute);

    // Then
    assertIsNotNull(currentCheckpoint);
    assertDeepEqual(currentCheckpoint, lastCheckpoint);
  });

  void it('returns null value for current position for empty event store', async () => {
    // Given
    // When
    const { currentCheckpoint } = await readLastMessageCheckpoint(pool.execute);

    // Then
    assertIsNull(currentCheckpoint);
  });
});
