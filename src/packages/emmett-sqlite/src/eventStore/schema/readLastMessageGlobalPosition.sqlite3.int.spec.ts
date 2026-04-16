import { JSONSerializer, SQL } from '@event-driven-io/dumbo';
import {
  InMemorySQLiteDatabase,
  sqlite3Connection,
  type AnySQLiteConnection,
} from '@event-driven-io/dumbo/sqlite3';
import {
  assertEqual,
  assertIsNotNull,
  assertIsNull,
  assertTrue,
  type Event,
} from '@event-driven-io/emmett';
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

  beforeAll(async () => {
    connection = sqlite3Connection({
      fileName: InMemorySQLiteDatabase,
      serializer: JSONSerializer,
    });
    await createEventStoreSchema(connection);
  });

  beforeEach(async () => {
    await connection.execute.command(SQL`DELETE FROM emt_messages;`);
  });

  afterAll(async () => {
    await connection.close();
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
