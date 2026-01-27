import { dumbo, sql, type Dumbo } from '@event-driven-io/dumbo';
import { assertFalse, assertTrue, type Event } from '@event-driven-io/emmett';
import { type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { after, before, describe, it } from 'node:test';
import { v4 as uuid } from 'uuid';
import { createEventStoreSchema, defaultTag } from '.';
import { appendToStream } from './appendToStream';
import { streamExists } from './streamExists';
import { streamsTable } from './typing';
import { getPostgreSQLStartedContainer } from '@event-driven-io/emmett-testcontainers';

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
export type DiscountApplied = Event<
  'DiscountApplied',
  { percent: number },
  { meta: string }
>;

export type ShoppingCartEvent = ProductItemAdded | DiscountApplied;

void describe('streamExists', () => {
  let postgres: StartedPostgreSqlContainer;
  let pool: Dumbo;

  before(async () => {
    postgres = await getPostgreSQLStartedContainer();
    const connectionString = postgres.getConnectionUri();
    pool = dumbo({
      connectionString,
    });

    await createEventStoreSchema(connectionString, pool);
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

  void it('returns true for existing stream', async () => {
    const streamId = uuid();
    await appendToStream(pool, streamId, 'shopping_cart', events);

    const result = await streamExists(pool.execute, streamId);

    assertTrue(result);
  });

  void it('returns false for non-existing stream', async () => {
    const nonExistingStreamId = uuid();

    const result = await streamExists(pool.execute, nonExistingStreamId);

    assertFalse(result);
  });

  void it('returns true for stream with single event', async () => {
    const streamId = uuid();
    await appendToStream(pool, streamId, 'shopping_cart', [events[0]!]);

    const result = await streamExists(pool.execute, streamId);

    assertTrue(result);
  });

  void it('returns false for different non-existing stream IDs', async () => {
    const streamId = uuid();
    const differentStreamId = uuid();
    await appendToStream(pool, streamId, 'shopping_cart', events);

    const result = await streamExists(pool.execute, differentStreamId);

    assertFalse(result);
  });

  void it('returns false for archived stream', async () => {
    const streamId = uuid();
    await appendToStream(pool, streamId, 'shopping_cart', events);

    await pool.execute.command(
      sql(
        `UPDATE ${streamsTable.name} 
         SET is_archived = TRUE 
         WHERE stream_id = %L AND partition = %L`,
        streamId,
        defaultTag,
      ),
    );

    const result = await streamExists(pool.execute, streamId);

    assertFalse(result);
  });

  void it('returns true for not-archived stream', async () => {
    const streamId = uuid();
    await appendToStream(pool, streamId, 'shopping_cart', events);

    // Make sure the stream is not archived
    await pool.execute.command(
      sql(
        `UPDATE ${streamsTable.name} 
         SET is_archived = FALSE 
         WHERE stream_id = %L AND partition = %L`,
        streamId,
        defaultTag,
      ),
    );

    const result = await streamExists(pool.execute, streamId);

    assertTrue(result);
  });

  void it('returns true for not-archived stream when another stream is archived', async () => {
    const archivedStreamId = uuid();
    const activeStreamId = uuid();

    await appendToStream(pool, archivedStreamId, 'shopping_cart', events);
    await appendToStream(pool, activeStreamId, 'shopping_cart', events);

    // Archive only one stream
    await pool.execute.command(
      sql(
        `UPDATE ${streamsTable.name} 
         SET is_archived = TRUE 
         WHERE stream_id = %L AND partition = %L`,
        archivedStreamId,
        defaultTag,
      ),
    );

    const archivedResult = await streamExists(pool.execute, archivedStreamId);
    const activeResult = await streamExists(pool.execute, activeStreamId);

    assertFalse(archivedResult);
    assertTrue(activeResult);
  });
});
