import { dumbo, SQL, type Dumbo } from '@event-driven-io/dumbo';
import {
  assertDeepEqual,
  assertEqual,
  assertFalse,
  assertIsNotNull,
  assertMatches,
  assertTrue,
  asyncRetry,
  type Event,
} from '@event-driven-io/emmett';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { after, before, describe, it } from 'node:test';
import { v4 as uuid } from 'uuid';
import { createEventStoreSchema, defaultTag } from '.';
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
  { productItem: PricedProductItem },
  { meta: string }
>;
export type DiscountApplied = Event<
  'DiscountApplied',
  { percent: number },
  { meta: string }
>;

export type ShoppingCartEvent = ProductItemAdded | DiscountApplied;

void describe('readStream', () => {
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

  void it('reads event in order based on the stream position', async () => {
    // Given
    const streamId = uuid();

    const indexes = [...Array(100).keys()].map((i) => i + 1);
    const randomizedIndexes = [...indexes].sort(() => Math.random() - 0.5);

    await Promise.all(
      randomizedIndexes.map((index) =>
        asyncRetry(
          () =>
            pool.withTransaction((tx) =>
              tx.execute.command(SQL`INSERT INTO "emt_messages"
          (stream_id, stream_position, partition, message_data, message_metadata, message_schema_version, message_type, message_kind, message_id, transaction_id)
        VALUES          
           (${streamId}, ${index}, ${defaultTag}, '{}'::jsonb, '{}'::jsonb, '1', 'test${index}', 'C', ${uuid()}, pg_current_xact_id())`),
            ),
          { forever: true },
        ),
      ),
    );

    // When
    const result = await readStream(pool.execute, streamId);

    // Then
    assertDeepEqual(
      result.events.map((e) => e.metadata.streamPosition),
      indexes.map((i) => BigInt(i)),
    );
  });
});
