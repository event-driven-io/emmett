import { dumbo, runSQLMigrations, SQL } from '@event-driven-io/dumbo';
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
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  it,
} from 'vitest';
import { createEventStoreSchema, PostgreSQLEventStoreCheckpoint } from '.';
import {
  sharedPostgreSQLDatabase,
  type PostgreSQLTestDatabase,
} from '../../testing/postgreSQLTestDatabase';
import { PostgreSQLEventStoreDefaultStreamVersion } from '../postgreSQLEventStore';
import { appendToStream } from './appendToStream';
import { migrations_0_36_0 } from './migrations/0_36_0';
import { migrations_0_38_7 } from './migrations/0_38_7';
import { migrations_0_42_0 } from './migrations/0_42_0';
import { migrations_0_43_0_rc_2 } from './migrations/0_43_0/legacyApi';
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

  const checkpointOf = (checkpoint: PostgreSQLEventStoreCheckpoint) =>
    PostgreSQLEventStoreCheckpoint.toProcessorCheckpoint(checkpoint);

  void describe('on a 0.43.0-rc.2 store', () => {
    type StoredProductItemAdded = Event<
      'ProductItemAdded',
      { productItem: PricedProductItem },
      { meta: string },
      number
    >;

    let database_0_43_0_rc_2: PostgreSQLTestDatabase;
    let pool_0_43_0_rc_2: PgPool;
    const data = { productItem: { productId: 'p1', quantity: 2, price: 30 } };

    beforeEach(async () => {
      database_0_43_0_rc_2 = await sharedPostgreSQLDatabase();
      pool_0_43_0_rc_2 = dumbo({
        driver: pgDumboDriver,
        connectionString: database_0_43_0_rc_2.connectionString,
      });
      await runSQLMigrations(pool_0_43_0_rc_2, [
        ...migrations_0_36_0,
        ...migrations_0_38_7,
        ...migrations_0_42_0,
        ...migrations_0_43_0_rc_2,
      ]);
    });

    afterEach(async () => {
      await pool_0_43_0_rc_2?.close();
      await database_0_43_0_rc_2?.close();
    });

    const insertRow = async ({
      streamId,
      streamPosition,
      metadata,
      schemaVersion,
    }: {
      streamId: string;
      streamPosition: number;
      metadata: Record<string, unknown>;
      schemaVersion: string;
    }) => {
      const messageId = uuid();
      const [inserted] = (
        await pool_0_43_0_rc_2.execute.command<{
          global_position: string;
          transaction_id: string;
        }>(
          SQL`INSERT INTO "emt_messages"
            (stream_id, stream_position, partition, message_data, message_metadata, message_schema_version, message_type, message_kind, message_id, transaction_id)
          VALUES
            (${streamId}, ${streamPosition}, ${defaultTag}, ${JSON.stringify(data)}::jsonb, ${JSON.stringify(metadata)}::jsonb, ${schemaVersion}, 'ProductItemAdded', 'E', ${messageId}, pg_current_xact_id())
          RETURNING global_position, transaction_id`,
        )
      ).rows;
      const globalPosition = checkpointOf({
        transactionId: BigInt(inserted!.transaction_id),
        globalPosition: BigInt(inserted!.global_position),
      });

      return {
        type: 'ProductItemAdded',
        kind: 'Event',
        data,
        metadata: {
          meta: 'data1',
          messageId,
          streamName: streamId,
          streamPosition: BigInt(streamPosition),
          globalPosition,
          checkpoint: globalPosition,
        },
      } as const;
    };

    const readVersions = (streamId: string) =>
      readStream<StoredProductItemAdded>(pool_0_43_0_rc_2.execute, streamId);

    void it('reads the schema version from event metadata', async () => {
      const streamId = uuid();
      const expected = await insertRow({
        streamId,
        streamPosition: 1,
        metadata: { meta: 'data1', schemaVersion: '2' },
        schemaVersion: 'v1',
      });

      const result = await readVersions(streamId);

      assertDeepEqual(result.events, [{ ...expected, schemaVersion: 2 }]);
    });

    void it('reads schema version 1 when event metadata has no schema version', async () => {
      const streamId = uuid();
      const expected = await insertRow({
        streamId,
        streamPosition: 1,
        metadata: { meta: 'data1' },
        schemaVersion: 'v1',
      });

      const result = await readVersions(streamId);

      assertDeepEqual(result.events, [{ ...expected, schemaVersion: 1 }]);
    });

    void it('reads version 1 when the metadata version is not numeric', async () => {
      const streamId = uuid();
      const expected = await insertRow({
        streamId,
        streamPosition: 1,
        metadata: { meta: 'data1', schemaVersion: 'v2' },
        schemaVersion: 'v1',
      });

      const result = await readVersions(streamId);

      assertDeepEqual(result.events, [{ ...expected, schemaVersion: 1 }]);
    });

    void it('reads the metadata schema version when the stored schema version is not numeric', async () => {
      const streamId = uuid();
      const expected = await insertRow({
        streamId,
        streamPosition: 1,
        metadata: { meta: 'data1', schemaVersion: '3' },
        schemaVersion: 'v2',
      });

      const result = await readVersions(streamId);

      assertDeepEqual(result.events, [{ ...expected, schemaVersion: 3 }]);
    });

    void it('reads the metadata version by the numeric value rule', async () => {
      const streamId = uuid();
      const metadataVersions = [
        { metadataSchemaVersion: '02', schemaVersion: 2 },
        { metadataSchemaVersion: '2.0', schemaVersion: 1 },
        { metadataSchemaVersion: '-1', schemaVersion: 1 },
        { metadataSchemaVersion: ' 2', schemaVersion: 1 },
        { metadataSchemaVersion: 2, schemaVersion: 2 },
      ];
      const expected = [];
      for (const [
        index,
        { metadataSchemaVersion, schemaVersion },
      ] of metadataVersions.entries()) {
        const inserted = await insertRow({
          streamId,
          streamPosition: index + 1,
          metadata: { meta: 'data1', schemaVersion: metadataSchemaVersion },
          schemaVersion: 'v1',
        });
        expected.push({ ...inserted, schemaVersion });
      }

      const result = await readVersions(streamId);

      assertDeepEqual(result.events, expected);
    });

    void it('reads a too large digits-only column value as that number', async () => {
      const streamId = uuid();
      const expected = await insertRow({
        streamId,
        streamPosition: 1,
        metadata: { meta: 'data1' },
        schemaVersion: '99999999999',
      });

      const result = await readVersions(streamId);

      assertDeepEqual(result.events, [
        { ...expected, schemaVersion: 99999999999 },
      ]);
    });
  });

  void it('upcasts events based on their schema version', async () => {
    type ProductItemAddedV1 = Event<
      'ProductItemAdded',
      PricedProductItem,
      { meta: string }
    >;
    type ProductItemAddedV2 = Event<
      'ProductItemAdded',
      { productItem: PricedProductItem },
      { meta: string },
      2
    >;
    type StoredProductItemAdded = ProductItemAddedV1 | ProductItemAddedV2;

    const upcast = (event: StoredProductItemAdded): ProductItemAddedV2 =>
      event.schemaVersion === 2
        ? event
        : {
            type: 'ProductItemAdded',
            data: { productItem: event.data },
            metadata: event.metadata,
            schemaVersion: 2,
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
        metadata: { meta: 'data2' },
        schemaVersion: 2,
      },
    ];
    const streamId = uuid();
    const messageIds = [uuid(), uuid()];
    let messageIndex = 0;
    const appendResult = await pool.withConnection(async (connection) =>
      appendToStream(connection, streamId, 'shopping_cart', storedEvents, {
        messageIdGenerator: () => messageIds[messageIndex++]!,
      }),
    );
    assertTrue(appendResult.success);

    const result = await readStream<ProductItemAddedV2, StoredProductItemAdded>(
      pool.execute,
      streamId,
      { schema: { versioning: { upcast } } },
    );

    assertDeepEqual(
      result.events,
      ['data1', 'data2'].map((meta, index) => {
        const globalPosition = checkpointOf(appendResult.checkpoints[index]!);
        return {
          type: 'ProductItemAdded',
          kind: 'Event',
          data: { productItem },
          schemaVersion: 2,
          metadata: {
            meta,
            messageId: messageIds[index]!,
            streamName: streamId,
            streamPosition: BigInt(index + 1),
            globalPosition,
            checkpoint: globalPosition,
          },
        };
      }),
    );
  });
});
