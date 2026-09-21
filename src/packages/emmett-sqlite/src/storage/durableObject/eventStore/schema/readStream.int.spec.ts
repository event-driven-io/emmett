import { JSONSerializer } from '@event-driven-io/dumbo';
import {
  cloudflareDurableObjectSQLiteConnection,
  cloudflareDurableObjectSQLitePool,
  type CloudflareDurableObjectSQLiteConnection,
} from '@event-driven-io/dumbo/cloudflare';
import {
  assertEqual,
  assertFalse,
  assertIsNotNull,
  assertMatches,
  type Event,
} from '@event-driven-io/emmett';
import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { v4 as uuid } from 'uuid';
import { aroundEach, describe, it } from 'vitest';
import { createEventStoreSchema } from '../../../../eventStore/schema';
import { appendToStream } from '../../../../eventStore/schema/appendToStream';
import { readStream } from '../../../../eventStore/schema/readStream';

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
  let connection: CloudflareDurableObjectSQLiteConnection;
  const serializer = JSONSerializer;

  aroundEach(async (runTest) => {
    const stub = env.TEST_OBJECT.get(env.TEST_OBJECT.newUniqueId());

    await runInDurableObject(stub, async (_instance, state) => {
      connection = cloudflareDurableObjectSQLiteConnection({
        storage: state.storage,
        serializer,
      });

      try {
        await createEventStoreSchema({
          pool: cloudflareDurableObjectSQLitePool({ connection }),
        });
        await runTest();
      } finally {
        await connection.close();
      }
    });
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
    const result = await readStream(connection.execute, streamId, {
      serializer,
    });

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
    const result = await readStream(connection.execute, nonExistingStreamId, {
      serializer,
    });

    // Then
    assertFalse(result.streamExists);
  });
});
