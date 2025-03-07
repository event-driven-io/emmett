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
import {
  InMemorySQLiteDatabase,
  sqliteConnection,
  type SQLiteConnection,
} from '../../connection';
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
  let db: SQLiteConnection;

  beforeAll(async () => {
    db = sqliteConnection({ fileName: InMemorySQLiteDatabase });
    await createEventStoreSchema(db);
  });

  afterAll(() => {
    db.close();
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
    await appendToStream(db, streamId, 'shopping_cart', events);

    // When
    const result = await readStream(db, streamId);

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
    const result = await readStream(db, nonExistingStreamId);

    // Then
    assertFalse(result.streamExists);
  });
});
