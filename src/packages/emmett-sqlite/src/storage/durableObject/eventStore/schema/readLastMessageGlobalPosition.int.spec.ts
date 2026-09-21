import type { DurableObjectStorage } from '@cloudflare/workers-types';
import { JSONSerializer } from '@event-driven-io/dumbo';
import {
  cloudflareDurableObjectSQLiteConnection,
  cloudflareDurableObjectSQLitePool,
  type CloudflareDurableObjectSQLiteConnection,
} from '@event-driven-io/dumbo/cloudflare';
import {
  assertEqual,
  assertIsNotNull,
  assertIsNull,
  assertTrue,
  type Event,
} from '@event-driven-io/emmett';
import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { v4 as uuid } from 'uuid';
import { aroundEach, describe, it } from 'vitest';
import {
  createEventStoreSchema,
  readLastMessageGlobalPosition,
} from '../../../../eventStore/schema';
import { appendToStream } from '../../../../eventStore/schema/appendToStream';

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
  let connection: CloudflareDurableObjectSQLiteConnection;

  aroundEach(async (runTest) => {
    const stub = env.TEST_OBJECT.get(env.TEST_OBJECT.newUniqueId());

    await runInDurableObject(stub, async (_instance, state) => {
      const storage: DurableObjectStorage = state.storage;
      connection = cloudflareDurableObjectSQLiteConnection({
        storage,
        serializer: JSONSerializer,
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
