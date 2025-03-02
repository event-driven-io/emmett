import {
  assertEqual,
  assertFalse,
  assertIsNotNull,
  assertMatches,
  type Event,
} from '@event-driven-io/emmett';
import { after, before, describe, it } from 'node:test';
import { v4 as uuid } from 'uuid';
import { createEventStoreSchema } from '.';
import {
  sqliteConnection,
  type SQLiteConnection,
} from '../../sqliteConnection';
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
  { productItem: PricedProductItem }
>;
export type DiscountApplied = Event<'DiscountApplied', { percent: number }>;

export type ShoppingCartEvent = ProductItemAdded | DiscountApplied;

void describe('appendEvent', () => {
  let db: SQLiteConnection;

  before(async () => {
    db = sqliteConnection({ location: ':memory:' });
    await createEventStoreSchema(db);
  });

  after(() => {
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
