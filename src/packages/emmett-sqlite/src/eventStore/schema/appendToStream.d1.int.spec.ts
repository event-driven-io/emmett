import type { D1Database } from '@cloudflare/workers-types';
import { JSONSerializer, SQL, type SQLExecutor } from '@event-driven-io/dumbo';
import {
  d1Connection,
  type AnySQLiteConnection,
} from '@event-driven-io/dumbo/cloudflare';
import {
  assertEqual,
  assertFalse,
  assertIsNotNull,
  assertThrowsAsync,
  assertTrue,
  type Event,
  type RecordedMessage,
} from '@event-driven-io/emmett';
import { Miniflare } from 'miniflare';
import { v4 as uuid } from 'uuid';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { createEventStoreSchema } from '.';
import { appendToStream } from './appendToStream';

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
  let connection: AnySQLiteConnection;
  let execute: SQLExecutor;
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
    execute = connection.execute;
    await createEventStoreSchema(connection);
  });

  afterAll(async () => {
    await connection.close();
    await mf.dispose();
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

  void it('should append events correctly', async () => {
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
    assertEqual(result.nextStreamPosition, 2n);
    assertIsNotNull(result.lastGlobalPosition);
    assertTrue(result.lastGlobalPosition > 0n);
  });

  void it('should append events correctly without expected stream position', async () => {
    const result = await appendToStream(
      connection,
      uuid(),
      'shopping_cart',
      events,
      {},
    );

    assertTrue(result.success);
    assertEqual(result.nextStreamPosition, 2n);
    assertIsNotNull(result.lastGlobalPosition);
    assertTrue(result.lastGlobalPosition > 0n);
  });

  void it('should append events correctly without optimistic concurrency', async () => {
    const streamId = uuid();
    await appendToStream(connection, streamId, 'shopping_cart', events);
    const result = await appendToStream(
      connection,
      streamId,
      'shopping_cart',
      events,
    );
    const { rows: resultEvents } = await execute.query(
      SQL`SELECT * FROM emt_messages WHERE stream_id = ${streamId}`,
    );

    assertEqual(4, resultEvents.length);
    assertTrue(result.success);
  });

  void it('should handle stream position if expected version is too high', async () => {
    // Given
    const streamId = uuid();

    const firstResult = await appendToStream(
      connection,
      streamId,
      'shopping_cart',
      events,
      {
        expectedStreamVersion: 0n,
      },
    );
    assertTrue(firstResult.success);

    // When
    const secondResult = await appendToStream(
      connection,
      streamId,
      'shopping_cart',
      events,
      {
        expectedStreamVersion: 4n,
      },
    );

    // Then
    assertFalse(secondResult.success);

    const { rows: resultEvents } = await execute.query(
      SQL`SELECT * FROM emt_messages WHERE stream_id = ${streamId}`,
    );

    assertEqual(events.length, resultEvents.length);
  });

  void it('should handle stream position conflict correctly when two streams are created', async () => {
    // Given
    const streamId = uuid();

    const firstResult = await appendToStream(
      connection,
      streamId,
      'shopping_cart',
      events,
      {
        expectedStreamVersion: 0n,
      },
    );
    assertTrue(firstResult.success);

    // When
    const secondResult = await appendToStream(
      connection,
      streamId,
      'shopping_cart',
      events,
      {
        expectedStreamVersion: 0n,
      },
    );

    // Then
    assertFalse(secondResult.success);

    const { rows: resultEvents } = await execute.query(
      SQL`SELECT * FROM emt_messages WHERE stream_id = ${streamId}`,
    );

    assertEqual(events.length, resultEvents.length);
  });

  void it('should handle stream position conflict correctly when version mismatches', async () => {
    // Given
    const streamId = uuid();

    const creationResult = await appendToStream(
      connection,
      streamId,
      'shopping_cart',
      events,
    );
    assertTrue(creationResult.success);
    const expectedStreamVersion = creationResult.nextStreamPosition;

    const firstResult = await appendToStream(
      connection,
      streamId,
      'shopping_cart',
      events,
      {
        expectedStreamVersion,
      },
    );

    assertTrue(firstResult.success);

    // When
    const secondResult = await appendToStream(
      connection,
      streamId,
      'shopping_cart',
      events,
      {
        expectedStreamVersion,
      },
    );

    // Then
    assertFalse(secondResult.success);

    const { rows: resultEvents } = await execute.query(
      SQL`SELECT * FROM emt_messages WHERE stream_id = ${streamId}`,
    );

    assertEqual(events.length * 2, resultEvents.length);
  });

  void it('should not have stream position conflict when version matches', async () => {
    // Given
    const streamId = uuid();
    const expectedStreamVersion = 0n;

    const firstResult = await appendToStream(
      connection,
      streamId,
      'shopping_cart',
      events,
      {
        expectedStreamVersion,
      },
    );
    assertTrue(firstResult.success);

    // When
    const secondResult = await appendToStream(
      connection,
      streamId,
      'shopping_cart',
      events,
      {
        expectedStreamVersion: firstResult.nextStreamPosition,
      },
    );

    // Then
    assertTrue(secondResult.success);

    const { rows: resultEvents } = await execute.query(
      SQL`SELECT * FROM emt_messages WHERE stream_id = ${streamId}`,
    );

    assertEqual(events.length * 2, resultEvents.length);
  });

  void it('should allow ability to read events inline with events', async () => {
    const streamId = uuid();

    let grabbedEvents: Event[] = [];

    await appendToStream(connection, streamId, 'shopping_cart', events, {
      onBeforeCommit: (messages: RecordedMessage[]): void => {
        grabbedEvents = messages.filter((m) => m.kind === 'Event');
      },
    });

    assertEqual(2, grabbedEvents.length);
  });

  void it('throwing exception inline and everything, including the events being stored are NOT rolled back', async () => {
    const streamId = uuid();

    await assertThrowsAsync(
      async () => {
        await appendToStream(connection, streamId, 'shopping_cart', events, {
          onBeforeCommit: (_: RecordedMessage[]): void => {
            throw new Error('fake error');
          },
        });
      },
      (err) => err?.message === 'fake error',
    );

    const { rows: resultEvents } = await execute.query(
      SQL`SELECT * FROM emt_messages WHERE stream_id = ${streamId}`,
    );

    assertEqual(events.length, resultEvents.length);
  });

  void it('should handle appending an empty events array gracefully', async () => {
    const result = await appendToStream(
      connection,
      uuid(),
      'shopping_cart',
      [],
    );

    assertFalse(result.success);
  });
});
