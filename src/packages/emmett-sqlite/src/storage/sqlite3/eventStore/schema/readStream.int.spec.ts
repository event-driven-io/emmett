import { JSONSerializer } from '@event-driven-io/dumbo';
import {
  InMemorySQLiteDatabase,
  sqlite3Connection,
  sqlite3Pool,
  type SQLite3Connection,
  type Sqlite3Pool,
} from '@event-driven-io/dumbo/sqlite3';
import {
  assertDeepEqual,
  assertEqual,
  assertFalse,
  assertIsNotNull,
  assertMatches,
  type Event,
} from '@event-driven-io/emmett';
import { v4 as uuid } from 'uuid';
import { afterAll, beforeAll, describe, it } from 'vitest';
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
  let connection: SQLite3Connection;
  let pool: Sqlite3Pool;
  const serializer = JSONSerializer;

  beforeAll(async () => {
    connection = sqlite3Connection({
      fileName: InMemorySQLiteDatabase,
      serializer,
    });
    pool = sqlite3Pool({
      fileName: InMemorySQLiteDatabase,
      singleton: true,
      connection,
    });
    await createEventStoreSchema({
      pool,
    });
  });

  afterAll(async () => {
    await connection.close();
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

  void it('reads the schema version from event metadata', async () => {
    const streamId = uuid();
    await appendToStream(connection, streamId, 'shopping_cart', [
      {
        type: 'ProductItemAdded',
        data: { productItem: { productId: '1', quantity: 2, price: 30 } },
        metadata: { meta: 'data1', schemaVersion: '2' },
      },
    ]);

    const result = await readStream(connection.execute, streamId, {
      serializer,
    });

    assertDeepEqual(
      result.events.map((e) => e.metadata.schemaVersion),
      ['2'],
    );
  });

  void it('reads schema version 1 when event metadata has no schema version', async () => {
    const streamId = uuid();
    await appendToStream(connection, streamId, 'shopping_cart', events);

    const result = await readStream(connection.execute, streamId, {
      serializer,
    });

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
      productId: '1',
      quantity: 2,
      price: 30,
    };
    const streamId = uuid();
    await appendToStream<StoredProductItemAdded>(
      connection,
      streamId,
      'shopping_cart',
      [
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
      ],
    );

    const result = await readStream<ProductItemAddedV2, StoredProductItemAdded>(
      connection.execute,
      streamId,
      { serializer, schema: { versioning: { upcast } } },
    );

    assertDeepEqual(
      result.events.map((e) => e.data),
      [{ productItem }, { productItem }],
    );
  });
});
