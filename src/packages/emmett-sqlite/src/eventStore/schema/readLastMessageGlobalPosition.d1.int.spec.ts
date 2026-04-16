import type { D1Database } from '@cloudflare/workers-types';
import { JSONSerializer, SQL } from '@event-driven-io/dumbo';
import { d1Connection } from '@event-driven-io/dumbo/cloudflare';
import type { AnySQLiteConnection } from '@event-driven-io/dumbo/sqlite3';
import {
  assertEqual,
  assertIsNotNull,
  assertIsNull,
  assertTrue,
  type Event,
} from '@event-driven-io/emmett';
import { Miniflare } from 'miniflare';
import { v4 as uuid } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { createEventStoreSchema, readLastMessageGlobalPosition } from '.';
import { appendToStream } from './appendToStream';

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
  let connection: AnySQLiteConnection;
  let mf: Miniflare;
  let database: D1Database;

  beforeAll(async () => {
    mf = new Miniflare({
      modules: true,
      script: 'export default { fetch() { return new Response("ok"); } }',
      d1Databases: { DB: 'test-db-id' },
    });
    database = await mf.getD1Database('DB');
    connection = d1Connection({
      database,
      serializer: JSONSerializer,
      transactionOptions: {
        allowNestedTransactions: true,
        mode: 'session_based',
      },
    });
    await createEventStoreSchema(connection);
  });

  beforeEach(async () => {
    await connection.execute.command(SQL`DELETE FROM emt_messages;`);
  });

  afterAll(async () => {
    await connection.close();
    await mf.dispose();
  });

  const events: ProductItemAdded[] = Array.from({ length: 3 }, (_, i) => ({
    type: 'ProductItemAdded',
    data: { productItem: { productId: String(i + 1), quantity: i, price: 30 } },
    metadata: { meta: `data${i + 1}` },
  }));

  void it('returns global position of last existing event of single event', async () => {
    // Given
    const result = await appendToStream(
      connection,
      uuid(),
      'shopping_cart',
      events.slice(0, 1),
      {
        expectedStreamVersion: 0n,
      },
    );
    assertTrue(result.success);
    const { lastGlobalPosition } = result;

    // When
    const { currentGlobalPosition } = await readLastMessageGlobalPosition(
      connection.execute,
    );

    // Then
    assertIsNotNull(currentGlobalPosition);
    assertEqual(currentGlobalPosition, lastGlobalPosition);
  });

  void it('returns global position of last existing event of single existing stream', async () => {
    // Given
    const result = await appendToStream(
      connection,
      uuid(),
      'shopping_cart',
      events,
      {
        expectedStreamVersion: 0n,
      },
    );
    assertTrue(result.success);
    const { lastGlobalPosition } = result;

    // When
    const { currentGlobalPosition } = await readLastMessageGlobalPosition(
      connection.execute,
    );

    // Then
    assertIsNotNull(currentGlobalPosition);
    assertEqual(currentGlobalPosition, lastGlobalPosition);
  });

  void it('returns global position of last existing event of multiple existing streams', async () => {
    // Given
    await appendToStream(connection, uuid(), 'shopping_cart', events, {
      expectedStreamVersion: 0n,
    });
    const result = await appendToStream(
      connection,
      uuid(),
      'shopping_cart',
      events,
    );
    assertTrue(result.success);
    const { lastGlobalPosition } = result;

    // When
    const { currentGlobalPosition } = await readLastMessageGlobalPosition(
      connection.execute,
    );

    // Then
    assertIsNotNull(currentGlobalPosition);
    assertEqual(currentGlobalPosition, lastGlobalPosition);
  });

  void it('returns null value for current position for empty event store', async () => {
    // Given
    // When
    const { currentGlobalPosition } = await readLastMessageGlobalPosition(
      connection.execute,
    );

    // Then
    assertIsNull(currentGlobalPosition);
  });
});
