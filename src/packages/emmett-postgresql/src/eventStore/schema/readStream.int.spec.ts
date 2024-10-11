import { dumbo, type Dumbo } from '@event-driven-io/dumbo';
import {
  assertDeepEqual,
  assertEqual,
  assertFalse,
  assertIsNotNull,
  assertMatches,
  assertTrue,
  type Event,
} from '@event-driven-io/emmett';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { after, before, describe, it } from 'node:test';
import { v4 as uuid } from 'uuid';
import { createEventStoreSchema } from '.';
import { PostgreSQLEventStoreDefaultStreamVersion } from '../postgreSQLEventStore';
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
  let pool: Dumbo;

  before(async () => {
    postgres = await new PostgreSqlContainer().start();
    pool = dumbo({
      connectionString: postgres.getConnectionUri(),
    });

    await createEventStoreSchema(pool);
  });

  after(async () => {
    try {
      await pool.close();
      await postgres.stop();
    } catch (error) {
      console.log(error);
    }
  });

  const events: ShoppingCartEvent[] = [
    {
      type: 'ProductItemAdded',
      data: { productItem: { productId: 'p1', quantity: 2, price: 30 } },
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
    const result = await readStream(pool.execute, streamId);

    // Then
    assertIsNotNull(result);
    assertEqual(2n, result.currentStreamVersion);

    const expected = events.map((e, index) => ({
      ...e,
      metadata: {
        ...e.metadata,
        streamName: streamId,
        streamPosition: BigInt(index + 1),
        globalPosition: BigInt(index + 1),
      },
    }));
    assertMatches(result.events, expected);
    assertTrue(result.streamExists);
  });

  void it('returns result with default information from non-existing stream', async () => {
    // Given
    const nonExistingStreamId = uuid();

    // When
    const result = await readStream(pool.execute, nonExistingStreamId);

    // Then
    assertEqual(
      PostgreSQLEventStoreDefaultStreamVersion,
      result.currentStreamVersion,
    );
    assertDeepEqual([], result.events);
    assertFalse(result.streamExists);
  });
});
