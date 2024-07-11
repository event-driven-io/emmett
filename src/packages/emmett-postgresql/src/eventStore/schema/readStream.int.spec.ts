import {
  assertEqual,
  assertIsNotNull,
  assertIsNull,
  assertMatches,
  type Event,
} from '@event-driven-io/emmett';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { after, before, describe, it } from 'node:test';
import pg from 'pg';
import { v4 as uuid } from 'uuid';
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
  { productItem: PricedProductItem }
>;
export type DiscountApplied = Event<'DiscountApplied', { percent: number }>;

export type ShoppingCartEvent = ProductItemAdded | DiscountApplied;

void describe('appendEvent', () => {
  let postgres: StartedPostgreSqlContainer;
  let pool: pg.Pool;

  before(async () => {
    postgres = await new PostgreSqlContainer().start();
    pool = new pg.Pool({
      connectionString: postgres.getConnectionUri(),
    });

    await createEventStoreSchema(pool);
  });

  after(async () => {
    try {
      await pool.end();
      await postgres.stop();
    } catch (error) {
      console.log(error);
    }
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
    await appendToStream(pool, streamId, 'shopping_cart', events);

    // When
    const result = await readStream(pool, streamId);

    // Then
    assertIsNotNull(result);
    assertEqual(2n, result.currentStreamVersion);

    const expected = events.map((e, index) => ({
      ...e,
      metadata: {
        ...e.metadata,
        streamName: streamId,
        streamPosition: BigInt(index + 1),
      },
    }));
    assertMatches(result.events, expected);
  });

  void it('returns null from non-existing stream', async () => {
    // Given
    const nonExistingStreamId = uuid();

    // When
    const result = await readStream(pool, nonExistingStreamId);

    // Then
    assertIsNull(result);
  });
});
