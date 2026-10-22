import { dumbo, SQL } from '@event-driven-io/dumbo';
import { pgDumboDriver, type PgPool } from '@event-driven-io/dumbo/pg';
import {
  assertDeepEqual,
  assertEqual,
  assertFalse,
  assertIsNotNull,
  assertMatches,
  assertTrue,
  asyncRetry,
  defaultTag,
  type Event,
} from '@event-driven-io/emmett';
import { v4 as uuid } from 'uuid';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { createEventStoreSchema, PostgreSQLEventStoreCheckpoint } from '.';
import {
  sharedPostgreSQLDatabase,
  type PostgreSQLTestDatabase,
} from '../../testing/postgreSQLTestDatabase';
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
  let database: PostgreSQLTestDatabase;
  let pool: PgPool;

  beforeAll(async () => {
    database = await sharedPostgreSQLDatabase();
    const connectionString = database.connectionString;
    pool = dumbo({
      driver: pgDumboDriver,
      connectionString,
      transactionOptions: {
        allowNestedTransactions: true,
      },
    });

    await createEventStoreSchema({ pool });
  });

  afterAll(async () => {
    try {
      await pool?.close();
      await database?.close();
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
    const appendResult = await pool.withConnection(async (connection) =>
      appendToStream(connection, streamId, 'shopping_cart', events),
    );

    assertTrue(appendResult.success);

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
        globalPosition: PostgreSQLEventStoreCheckpoint.toProcessorCheckpoint(
          appendResult.checkpoints[index]!,
        ),
        checkpoint: PostgreSQLEventStoreCheckpoint.toProcessorCheckpoint(
          appendResult.checkpoints[index]!,
        ),
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
           (${streamId}, ${index}, ${defaultTag}, '{}'::jsonb, '{}'::jsonb, '1', ${'test' + index}, 'C', ${uuid()}, pg_current_xact_id())`),
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

  void it('reads the schema version from event metadata', async () => {
    const streamId = uuid();
    const event: Event<
      'ProductItemAdded',
      { productItem: PricedProductItem },
      { meta: string; schemaVersion: string }
    > = {
      type: 'ProductItemAdded',
      data: { productItem: { productId: 'p1', quantity: 2, price: 30 } },
      metadata: { meta: 'data1', schemaVersion: '2' },
    };
    await pool.withConnection(async (connection) =>
      appendToStream(connection, streamId, 'shopping_cart', [event]),
    );

    const result = await readStream(pool.execute, streamId);

    assertDeepEqual(
      result.events.map((e) => e.metadata.schemaVersion),
      ['2'],
    );
  });

  void it('reads schema version 1 when event metadata has no schema version', async () => {
    const streamId = uuid();
    await pool.withConnection(async (connection) =>
      appendToStream(connection, streamId, 'shopping_cart', events),
    );

    const result = await readStream(pool.execute, streamId);

    assertDeepEqual(
      result.events.map((e) => e.metadata.schemaVersion),
      ['1', '1'],
    );
  });

  void it('upcasts events based on their schema version', async () => {
    type VersionedMetadata = { meta: string; schemaVersion?: string };
    type ProductItemAddedV1 = Event<
      'ProductItemAdded',
      PricedProductItem,
      VersionedMetadata
    >;
    type ProductItemAddedV2 = Event<
      'ProductItemAdded',
      { productItem: PricedProductItem },
      VersionedMetadata
    >;
    type StoredProductItemAdded = ProductItemAddedV1 | ProductItemAddedV2;

    const upcast = (event: StoredProductItemAdded): ProductItemAddedV2 => {
      switch (event.metadata.schemaVersion) {
        case '1':
          return {
            ...event,
            data: { productItem: (event as ProductItemAddedV1).data },
          };
        default:
          return event as ProductItemAddedV2;
      }
    };

    const productItem: PricedProductItem = {
      productId: 'p1',
      quantity: 2,
      price: 30,
    };
    const storedEvents: StoredProductItemAdded[] = [
      {
        type: 'ProductItemAdded',
        data: productItem,
        metadata: { meta: 'data1' },
      },
      {
        type: 'ProductItemAdded',
        data: { productItem },
        metadata: { meta: 'data2', schemaVersion: '2' },
      },
    ];
    const streamId = uuid();
    await pool.withConnection(async (connection) =>
      appendToStream(connection, streamId, 'shopping_cart', storedEvents),
    );

    const result = await readStream<ProductItemAddedV2, StoredProductItemAdded>(
      pool.execute,
      streamId,
      { schema: { versioning: { upcast } } },
    );

    assertDeepEqual(
      result.events.map((e) => e.data),
      [{ productItem }, { productItem }],
    );
  });
});
