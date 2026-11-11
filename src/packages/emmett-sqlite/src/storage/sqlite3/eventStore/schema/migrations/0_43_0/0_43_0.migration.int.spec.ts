import {
  JSONSerializer,
  runSQLMigrations,
  SQL,
  single,
  type SQLExecutor,
} from '@event-driven-io/dumbo';
import {
  InMemorySQLiteDatabase,
  sqlite3Connection,
  sqlite3Pool,
  type SQLite3Connection,
  type Sqlite3Pool,
} from '@event-driven-io/dumbo/sqlite3';
import {
  assertDeepEqual,
  assertThatArray,
  assertTrue,
  bigIntProcessorCheckpoint,
  type Event,
  type RecordedMessage,
} from '@event-driven-io/emmett';
import { afterEach, beforeEach, describe, it } from 'vitest';
import {
  defaultTag,
  messagesTable,
  tableReference,
} from '../../../../../../eventStore/schema/typing';
import { migrations_0_41_0 } from '../../../../../../eventStore/schema/migrations/0_41_0';
import { migrations_0_42_0 } from '../../../../../../eventStore/schema/migrations/0_42_0';
import { appendToStream } from '../../../../../../eventStore/schema/migrations/0_42_0/legacyApi';
import { appendToStream as appendToStream_0_43_0 } from '../../../../../../eventStore/schema/appendToStream';
import { readStream } from '../../../../../../eventStore/schema/readStream';
import {
  migration_0_43_0_numericMessageSchemaVersionFor,
  migrations_0_43_0,
} from '../../../../../../eventStore/schema/migrations/0_43_0';
import {
  appendToStream_0_43_0_rc_2,
  readStream_0_43_0_rc_2,
  migrations_0_43_0_rc_2,
} from '../../../../../../eventStore/schema/migrations/0_43_0/legacyApi';

export type ProductItemAdded = Event<
  'ProductItemAdded',
  {
    shoppingCartId: string;
    productItem: { productId: string; quantity: number };
  }
>;

void describe('Schema migrations tests', () => {
  let connection: SQLite3Connection;
  let pool: Sqlite3Pool;

  beforeEach(() => {
    connection = sqlite3Connection({
      fileName: InMemorySQLiteDatabase,
      serializer: JSONSerializer,
    });

    pool = sqlite3Pool({
      fileName: InMemorySQLiteDatabase,
      singleton: true,
      connection,
    });
  });

  afterEach(async () => {
    await connection.close();
  });

  void it('migrates from 0.42.0 schema', async () => {
    // Given
    await runSQLMigrations(pool, [...migrations_0_41_0, ...migrations_0_42_0]);

    // When
    const { applied, skipped } = await runSQLMigrations(
      pool,
      migrations_0_43_0,
    );

    // Then
    assertDeepEqual(applied, migrations_0_43_0);
    assertThatArray(skipped).isEmpty();
  });

  void it('migrates from 0.43.0 schema', async () => {
    // Given
    await runSQLMigrations(pool, [
      ...migrations_0_41_0,
      ...migrations_0_42_0,
      ...migrations_0_43_0,
    ]);

    // When
    const { applied, skipped } = await runSQLMigrations(
      pool,
      migrations_0_43_0,
    );

    // Then
    assertThatArray(applied).isEmpty();
    assertDeepEqual(skipped, migrations_0_43_0);
  });

  void it('migrates pre-existing stream partition to the default partition', async () => {
    // Given
    await runSQLMigrations(pool, [...migrations_0_41_0, ...migrations_0_42_0]);
    await appendToStream<ProductItemAdded>(pool.execute, {
      streamId: 'legacy-cart-1',
      streamType: 'cart',
      events: [productItemAdded('legacy-cart-1')],
    });

    // When
    await runSQLMigrations(pool, migrations_0_43_0);

    // Then
    assertDeepEqual(await streamPartition('legacy-cart-1'), defaultTag);
  });

  void it('leaves a pre-existing explicit stream partition untouched', async () => {
    // Given
    await runSQLMigrations(pool, [...migrations_0_41_0, ...migrations_0_42_0]);
    await appendToStream<ProductItemAdded>(pool.execute, {
      streamId: 'tenant-cart-1',
      streamType: 'cart',
      events: [productItemAdded('tenant-cart-1')],
      partition: 'tenant-a',
    });

    // When
    await runSQLMigrations(pool, migrations_0_43_0);

    // Then
    assertDeepEqual(await streamPartition('tenant-cart-1'), 'tenant-a');
  });

  void it('0.43.0-rc.2 reads the metadata schema version of the event it appended to a 0.43.0-rc.2 store', async () => {
    // Given
    await runSQLMigrations(pool, [
      ...migrations_0_41_0,
      ...migrations_0_42_0,
      ...migrations_0_43_0_rc_2,
    ]);
    const streamId = `shopping_cart-${crypto.randomUUID()}`;
    const messageId = crypto.randomUUID();
    const event: Event<
      'ProductItemAdded',
      ProductItemAdded['data'],
      { schemaVersion: string }
    > = {
      type: 'ProductItemAdded',
      data: {
        shoppingCartId: streamId,
        productItem: { productId: 'product-456', quantity: 2 },
      },
      metadata: { schemaVersion: '2' },
    };
    const appended = await appendToStream_0_43_0_rc_2(
      connection,
      streamId,
      'shopping_cart',
      [event],
      { messageIdGenerator: () => messageId },
    );
    assertTrue(appended.success);
    const globalPosition = bigIntProcessorCheckpoint(
      appended.lastGlobalPosition,
    );

    // When
    const { events } = await readStream_0_43_0_rc_2(
      connection.execute,
      streamId,
      {
        serializer: JSONSerializer,
      },
    );

    // Then
    assertDeepEqual(events, [
      {
        type: 'ProductItemAdded',
        kind: 'Event',
        data: event.data,
        metadata: {
          schemaVersion: '2',
          messageId,
          streamName: streamId,
          streamPosition: 1n,
          globalPosition,
          checkpoint: globalPosition,
        },
      },
    ]);
  });

  void it('a 0.42.0 store gets version 1 for every row', async () => {
    // Given
    await runSQLMigrations(pool, [...migrations_0_41_0, ...migrations_0_42_0]);
    const streamId = 'cart-0-42-x';
    for (let i = 0; i < 3; i++)
      await appendToStream<ProductItemAdded>(pool.execute, {
        streamId,
        streamType: 'cart',
        events: [productItemAdded(streamId)],
      });
    assertDeepEqual((await storedVersions(pool.execute)).map(String), [
      '0',
      '1',
      '2',
    ]);

    // When
    await runSQLMigrations(pool, migrations_0_43_0);

    // Then
    assertDeepEqual(await versionColumn(pool.execute), integerVersionColumn);
    assertDeepEqual(await storedVersions(pool.execute), [1, 1, 1]);
  });

  void it('a 0.43.0-rc.2 row gets its numeric metadata version, or 1', async () => {
    // Given
    await runSQLMigrations(pool, [
      ...migrations_0_41_0,
      ...migrations_0_42_0,
      ...migrations_0_43_0_rc_2,
    ]);
    await appendWithMetadataVersion('cart-numeric-string', '2');
    await appendWithMetadataVersion('cart-not-numeric', 'v2');

    // When
    await runSQLMigrations(pool, migrations_0_43_0);

    // Then
    assertDeepEqual(await versionColumn(pool.execute), integerVersionColumn);
    assertDeepEqual(await storedVersions(pool.execute), [2, 1]);
  });

  void it('takes a whole JSON number in metadata as it is', async () => {
    // Given
    await runSQLMigrations(pool, [
      ...migrations_0_41_0,
      ...migrations_0_42_0,
      ...migrations_0_43_0_rc_2,
    ]);
    await appendWithMetadataVersion('cart-json-number', 3);
    await appendWithMetadataVersion('cart-fraction', 1.5);
    await appendWithMetadataVersion('cart-negative', -1);
    await appendWithMetadataVersion('cart-zero', 0);
    await appendWithMetadataVersion('cart-padded', '02');
    await appendWithMetadataVersion('cart-empty', '');
    await appendWithMetadataVersion('cart-spaced', ' 2');
    await appendWithMetadataVersion('cart-decimal', '2.0');

    // When
    await runSQLMigrations(pool, migrations_0_43_0);

    // Then
    assertDeepEqual(
      await storedVersions(pool.execute),
      [3, 1, 1, 0, 2, 1, 1, 1],
    );
  });

  void it('the column swap keeps every message unchanged', async () => {
    // Given
    await runSQLMigrations(pool, [
      ...migrations_0_41_0,
      ...migrations_0_42_0,
      ...migrations_0_43_0_rc_2,
    ]);
    for (const [streamId, partition] of [
      ['cart-a', 'tenant-a'],
      ['cart-b', undefined],
    ] as const)
      for (let i = 0; i < 5; i++)
        await appendToStream_0_43_0_rc_2(
          connection,
          streamId,
          'shopping_cart',
          [productItemAdded(streamId)],
          { partition },
        );
    await pool.execute.command(
      SQL`UPDATE emt_messages SET is_archived = 1 WHERE stream_id = 'cart-a' AND stream_position <= 2`,
    );
    const before = await messagesWithoutVersion(pool.execute);
    assertDeepEqual(before.length, 10);

    // When
    await runSQLMigrations(pool, migrations_0_43_0);

    // Then
    assertDeepEqual(await messagesWithoutVersion(pool.execute), before);
    const appended = await appendToStream_0_43_0(
      connection,
      'cart-b',
      'shopping_cart',
      [productItemAdded('cart-b')],
    );
    assertTrue(appended.success);
    assertDeepEqual(appended.lastGlobalPosition, 11n);
  });

  void it('reads a migrated row with a metadata version', async () => {
    // Given
    const streamId = 'cart-read-metadata-version';
    await runSQLMigrations(pool, [
      ...migrations_0_41_0,
      ...migrations_0_42_0,
      ...migrations_0_43_0_rc_2,
    ]);
    const messageId = crypto.randomUUID();
    const appended = await appendToStream_0_43_0_rc_2(
      connection,
      streamId,
      'shopping_cart',
      [productItemAddedWithMetadataVersion(streamId, '2')],
      { messageIdGenerator: () => messageId },
    );
    assertTrue(appended.success);
    await runSQLMigrations(pool, migrations_0_43_0);
    const globalPosition = bigIntProcessorCheckpoint(
      appended.lastGlobalPosition,
    );

    // When
    const { events } = await readStream(pool.execute, streamId, {
      serializer: JSONSerializer,
    });

    // Then
    assertDeepEqual<RecordedMessage[]>(events, [
      {
        type: 'ProductItemAdded',
        kind: 'Event',
        data: productItemAdded(streamId).data,
        schemaVersion: 2,
        metadata: {
          messageId,
          streamName: streamId,
          streamPosition: 1n,
          globalPosition,
          checkpoint: globalPosition,
        },
      },
    ]);
  });

  void it('reads the column only', async () => {
    // Given
    const streamId = 'cart-read-column-only';
    await runSQLMigrations(pool, [
      ...migrations_0_41_0,
      ...migrations_0_42_0,
      ...migrations_0_43_0_rc_2,
    ]);
    await appendToStream_0_43_0_rc_2(connection, streamId, 'shopping_cart', [
      productItemAddedWithMetadataVersion(streamId, '2'),
    ]);
    await runSQLMigrations(pool, migrations_0_43_0);
    await pool.execute.command(
      SQL`UPDATE emt_messages SET message_schema_version = 3 WHERE stream_id = ${streamId}`,
    );

    // When
    const { events } = await readStream(pool.execute, streamId, {
      serializer: JSONSerializer,
    });

    // Then
    assertDeepEqual(
      events.map((event) => event.schemaVersion),
      [3],
    );
  });

  void it('a second run changes nothing', async () => {
    // Given
    await runSQLMigrations(pool, [
      ...migrations_0_41_0,
      ...migrations_0_42_0,
      ...migrations_0_43_0_rc_2,
    ]);
    await appendWithMetadataVersion('cart-second-run', '2');
    await runSQLMigrations(pool, migrations_0_43_0);
    await pool.execute.command(
      SQL`UPDATE emt_messages SET message_schema_version = 3`,
    );
    const before = await allMessages(pool.execute);
    const layoutBefore = await pool.execute.query(
      SQL`PRAGMA table_info(emt_messages)`,
    );

    // When
    const { applied, skipped } = await runSQLMigrations(
      pool,
      migrations_0_43_0,
    );

    // Then
    assertThatArray(applied).isEmpty();
    assertDeepEqual(skipped, migrations_0_43_0);
    assertDeepEqual(await allMessages(pool.execute), before);
    assertDeepEqual(
      (await pool.execute.query(SQL`PRAGMA table_info(emt_messages)`)).rows,
      layoutBefore.rows,
    );
    assertDeepEqual(await storedVersions(pool.execute), [3]);
  });

  void it('a store in a custom database schema gets the integer version column', async () => {
    // Given
    const messages = tableReference('events', messagesTable.name);
    await pool.execute.command(
      SQL`CREATE TABLE ${messages}(
        stream_id TEXT NOT NULL,
        stream_position BIGINT NOT NULL,
        partition TEXT NOT NULL DEFAULT 'global',
        message_kind CHAR(1) NOT NULL DEFAULT 'E',
        message_data JSONB NOT NULL,
        message_metadata JSONB NOT NULL,
        message_schema_version TEXT NOT NULL,
        message_type TEXT NOT NULL,
        message_id TEXT NOT NULL,
        is_archived BOOLEAN NOT NULL DEFAULT FALSE,
        global_position INTEGER PRIMARY KEY,
        created DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (stream_id, stream_position, partition, is_archived)
      )`,
    );
    const rows: [string, string][] = [
      ['2', '{}'],
      ['1', '{"schemaVersion":"2"}'],
      ['v2', '{"schemaVersion":"v2"}'],
    ];
    for (const [index, [column, metadata]] of rows.entries())
      await pool.execute.command(
        SQL`INSERT INTO ${messages}
          (stream_id, stream_position, message_data, message_metadata, message_schema_version, message_type, message_id)
          VALUES ('cart', ${index + 1}, '{}', ${metadata}, ${column}, 'ProductItemAdded', ${crypto.randomUUID()})`,
      );

    // When
    await runSQLMigrations(pool, [
      migration_0_43_0_numericMessageSchemaVersionFor({
        databaseSchemaName: 'events',
      }),
    ]);

    // Then
    const columns = await pool.execute.query<{ name: string; type: string }>(
      SQL`PRAGMA table_info(${messages})`,
    );
    assertDeepEqual(
      columns.rows.find((row) => row.name === 'message_schema_version')?.type,
      'INTEGER',
    );
    const versions = await pool.execute.query<{
      message_schema_version: number;
    }>(
      SQL`SELECT message_schema_version FROM ${messages} ORDER BY global_position`,
    );
    assertDeepEqual(
      versions.rows.map((row) => row.message_schema_version),
      [1, 2, 1],
    );
  });

  const appendWithMetadataVersion = async (
    streamId: string,
    schemaVersion: string | number,
  ) => {
    const appended = await appendToStream_0_43_0_rc_2(
      connection,
      streamId,
      'shopping_cart',
      [productItemAddedWithMetadataVersion(streamId, schemaVersion)],
    );
    assertTrue(appended.success);
  };

  const productItemAddedWithMetadataVersion = (
    shoppingCartId: string,
    schemaVersion: string | number,
  ): Event<
    'ProductItemAdded',
    ProductItemAdded['data'],
    { schemaVersion: string | number }
  > => ({
    ...productItemAdded(shoppingCartId),
    metadata: { schemaVersion },
  });

  const storedVersions = async (execute: SQLExecutor): Promise<number[]> => {
    const { rows } = await execute.query<{ message_schema_version: number }>(
      SQL`SELECT message_schema_version FROM emt_messages ORDER BY global_position`,
    );
    return rows.map((row) => row.message_schema_version);
  };

  const versionColumn = async (execute: SQLExecutor) => {
    const { rows } = await execute.query<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
    }>(SQL`PRAGMA table_info(emt_messages)`);
    const index = rows.findIndex(
      (row) => row.name === 'message_schema_version',
    );
    return {
      type: rows[index]?.type,
      notnull: rows[index]?.notnull,
      dflt_value: rows[index]?.dflt_value,
      after: rows[index - 1]?.name,
    };
  };

  const integerVersionColumn = {
    type: 'INTEGER',
    notnull: 1,
    dflt_value: '1',
    after: 'created',
  };

  const messagesWithoutVersion = async (execute: SQLExecutor) => {
    const { rows } = await execute.query(
      SQL`SELECT stream_id, stream_position, partition, message_kind, message_data, message_metadata, message_type, message_id, is_archived, global_position, created
          FROM emt_messages ORDER BY global_position`,
    );
    return rows;
  };

  const allMessages = async (execute: SQLExecutor) => {
    const { rows } = await execute.query(
      SQL`SELECT * FROM emt_messages ORDER BY global_position`,
    );
    return rows;
  };

  const productItemAdded = (shoppingCartId: string): ProductItemAdded => ({
    type: 'ProductItemAdded',
    data: {
      shoppingCartId,
      productItem: { productId: 'product-456', quantity: 2 },
    },
  });

  const streamPartition = async (streamId: string): Promise<string> => {
    const { partition } = await single(
      pool.execute.query<{ partition: string }>(SQL`
        SELECT partition
        FROM emt_streams
        WHERE stream_id = ${streamId}
      `),
    );

    return partition;
  };
});
