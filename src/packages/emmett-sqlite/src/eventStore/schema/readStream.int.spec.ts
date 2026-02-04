import { JSONSerializer } from '@event-driven-io/dumbo';
import {
  InMemorySQLiteDatabase,
  sqlite3Connection,
  type SQLite3Connection,
} from '@event-driven-io/dumbo/sqlite3';
import {
  assertEqual,
  assertFalse,
  assertIsNotNull,
  assertMatches,
  type Event,
} from '@event-driven-io/emmett';
import { v4 as uuid } from 'uuid';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { createEventStoreSchema } from '.';
import { appendToStream } from './appendToStream';
import { readStream } from './readStream';

export type PricedProductItem = {
  productId: string;
  quantity: number;
  price: number;
};

export type ShoppingCart = {
  productItems: PricedProductItem[];
  totalAmount: number;
};

export type ProductItemAdded = Event<
  'ProductItemAdded',
  { productItem: PricedProductItem },
  { meta: string }
>;
export type DiscountApplied = Event<
  'DiscountApplied',
  { percent: number },
  { meta: string }
>;

export type ShoppingCartEvent = ProductItemAdded | DiscountApplied;

void describe('appendEvent', () => {
  let connection: SQLite3Connection;

  beforeAll(async () => {
    connection = sqlite3Connection({
      fileName: InMemorySQLiteDatabase,
      serializer: JSONSerializer,
    });
    await createEventStoreSchema(connection);
  });

  afterAll(async () => {
    await connection.close();
  });

  const events: ShoppingCartEvent[] = [
    {
      type: 'ProductItemAdded',
      data: { productItem: { productId: '1', quantity: 2, price: 30 } },
      metadata: { meta: 'data1' },
    },
    {
      type: 'DiscountApplied',
      data: { percent: 10 },
      metadata: { meta: 'data2' },
    },
  ];

  void it('reads events from non-empty stream', async () => {
    // Given
    const streamId = uuid();
    await appendToStream(connection, streamId, 'shopping_cart', events);

    // When
    const result = await readStream(connection.execute, streamId);

    // Then
    assertIsNotNull(result);
    assertEqual(2n, result.currentStreamVersion);

    const expected = events.map((e, index) => ({
      ...e,
      metadata: {
        ...('metadata' in e ? (e.metadata ?? {}) : {}),
        streamName: streamId,
        streamPosition: BigInt(index + 1),
      },
    }));

    assertMatches(result.events, expected);
  });

  void it('returns false for non-existent stream', async () => {
    // Given
    const nonExistingStreamId = uuid();

    // When
    const result = await readStream(connection.execute, nonExistingStreamId);

    // Then
    assertFalse(result.streamExists);
  });
});
