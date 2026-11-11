import {
  dumbo,
  runSQLMigrations,
  single,
  SQL,
  sqlMigration,
  DumboError,
  QueryCanceledError,
  type Dumbo,
  type RunSQLMigrationsResult,
} from '@event-driven-io/dumbo';
import { pgDumboDriver, type PgPool } from '@event-driven-io/dumbo/pg';
import {
  assertDeepEqual,
  assertEqual,
  assertThatArray,
  assertThrowsAsync,
  assertTrue,
  asyncRetry,
  type Event,
} from '@event-driven-io/emmett';
import { afterEach, beforeEach, describe, it } from 'vitest';
import {
  sharedPostgreSQLDatabase,
  type PostgreSQLTestDatabase,
} from '../../testing/postgreSQLTestDatabase';
import { functionExists } from '../../testing/schemaObjects';
import { pgEventStoreDriver } from '../../pg';
import { appendToStream } from './appendToStream';
import {
  eventStoreDatabaseSchema,
  type EventStoreDatabaseSchemaOptions,
} from './eventStoreDatabaseSchema';
import { migrateSchemaToNumericMessageSchemaVersion } from './migrateSchemaToNumericMessageSchemaVersion';
import {
  eventStoreSchemaMigrationsFor,
  schemaMigrationFor,
} from './migrations';
import { migrations_0_36_0 } from './migrations/0_36_0';
import { migrations_0_38_7 } from './migrations/0_38_7';
import { appendToStream as appendToStream_0_38_7 } from './migrations/0_38_7/legacyApi';
import { migrations_0_42_0 } from './migrations/0_42_0';
import { schema_0_42_0 } from './migrations/0_42_0/0_42_0.snapshot';
import {
  appendToStream_0_43_0_rc_2,
  migrations_0_43_0_rc_2,
  readStream_0_43_0_rc_2,
} from './migrations/0_43_0/legacyApi';
import { migration_0_44_0_numericMessageSchemaVersionFor } from './migrations/0_44_0/0_44_0.migration';
import { migrations_0_44_0 } from './migrations/0_44_0';
import {
  PostgreSQLEventStoreCheckpoint,
  readMessagesBatch,
} from './readMessagesBatch';
import { readStream } from './readStream';
import { defaultTag } from './typing';

type ProductItemAdded = Event<
  'ProductItemAdded',
  {
    shoppingCartId: string;
    productItem: { productId: string; quantity: number };
  }
>;

type MigrationOptions = EventStoreDatabaseSchemaOptions & {
  messageSchemaVersionMapping?: SQL;
};

const customSchemaOptions: EventStoreDatabaseSchemaOptions = {
  databaseSchemaName: 'events',
  migrationTable: { schemaName: 'infrastructure' },
};

const productItemData = (streamId: string): ProductItemAdded['data'] => ({
  shoppingCartId: streamId,
  productItem: { productId: 'product-123', quantity: 2 },
});

const event_0_43_0_rc_2 = (
  streamId: string,
  schemaVersion: string,
): Event<
  'ProductItemAdded',
  ProductItemAdded['data'],
  { schemaVersion: string }
> => ({
  type: 'ProductItemAdded',
  data: productItemData(streamId),
  metadata: { schemaVersion },
});

const newStreamId = () => `shopping_cart-${crypto.randomUUID()}`;

void describe('Numeric message schema version migrations', () => {
  let database: PostgreSQLTestDatabase;
  let pool: PgPool;

  beforeEach(async () => {
    database = await sharedPostgreSQLDatabase();
    pool = dumbo({
      driver: pgDumboDriver,
      connectionString: database.connectionString,
      transactionOptions: { allowNestedTransactions: true },
    });
  });

  afterEach(async () => {
    try {
      await pool?.close();
      await database?.close();
    } catch (error) {
      console.log(error);
    }
  });

  const schemaOf = (databaseSchemaName?: string) =>
    databaseSchemaName ?? 'public';

  const readColumnType = async (databaseSchemaName?: string) =>
    (
      await single(
        pool.execute.query<{ data_type: string }>(
          SQL`SELECT data_type FROM information_schema.columns WHERE table_schema = ${schemaOf(databaseSchemaName)} AND table_name = 'emt_messages' AND column_name = 'message_schema_version'`,
        ),
      )
    ).data_type;

  const readColumnPosition = async (databaseSchemaName?: string) =>
    (
      await single(
        pool.execute.query<{ ordinal_position: number }>(
          SQL`SELECT ordinal_position FROM information_schema.columns WHERE table_schema = ${schemaOf(databaseSchemaName)} AND table_name = 'emt_messages' AND column_name = 'message_schema_version'`,
        ),
      )
    ).ordinal_position;

  const readRows = async (databaseSchemaName?: string) =>
    (
      await pool.execute.query<{
        stream_id: string;
        message_schema_version: string | number;
        message_metadata: Record<string, unknown>;
      }>(
        SQL`SELECT stream_id, message_schema_version, message_metadata FROM ${SQL.identifier(schemaOf(databaseSchemaName))}.emt_messages ORDER BY global_position`,
      )
    ).rows;

  const readVersions = async (databaseSchemaName?: string) =>
    (await readRows(databaseSchemaName)).map(
      ({ message_schema_version }) => message_schema_version,
    );

  const buildStoreWithTextColumn = async () => {
    await runSQLMigrations(pool, [
      ...migrations_0_36_0,
      ...migrations_0_38_7,
      ...migrations_0_42_0,
      ...migrations_0_43_0_rc_2,
      sqlMigration(schemaMigrationFor().name, [SQL`SELECT 1`], {
        ignoreHashMismatch: true,
      }),
    ]);
    await runSQLMigrations(pool, eventStoreSchemaMigrationsFor());
  };

  const append_0_43_0_rc_2 = async (
    streamId: string,
    metadataSchemaVersion: string,
  ) => {
    const appended = await pool.withConnection((connection) =>
      appendToStream_0_43_0_rc_2(
        connection,
        streamId,
        'shopping_cart',
        [event_0_43_0_rc_2(streamId, metadataSchemaVersion)],
        { messageIdGenerator: () => crypto.randomUUID() },
      ),
    );
    assertTrue(appended.success);
  };

  const appendCurrent = async (
    streamId: string,
    schemaVersion: number,
    databaseSchemaName?: string,
  ) => {
    const appended = await pool.withConnection((connection) =>
      appendToStream(
        connection,
        streamId,
        'shopping_cart',
        [
          {
            type: 'ProductItemAdded',
            data: productItemData(streamId),
            schemaVersion,
          },
        ],
        { databaseSchemaName },
      ),
    );
    assertTrue(appended.success);
  };

  const build_16_1_store = async () => {
    await runSQLMigrations(pool, [
      ...migrations_0_36_0,
      ...migrations_0_38_7,
      ...migrations_0_42_0,
    ]);
    const stream_0_42_0 = newStreamId();
    await appendToStream_0_38_7(pool.execute, {
      streamId: stream_0_42_0,
      streamType: 'shopping_cart',
      events: [
        { type: 'ProductItemAdded', data: productItemData(stream_0_42_0) },
      ],
    });
    await runSQLMigrations(pool, [
      ...migrations_0_43_0_rc_2,
      sqlMigration(schemaMigrationFor().name, [SQL`SELECT 1`], {
        ignoreHashMismatch: true,
      }),
    ]);
    const stream_0_43_0_rc_2 = newStreamId();
    await append_0_43_0_rc_2(stream_0_43_0_rc_2, '1');
    await append_0_43_0_rc_2(stream_0_43_0_rc_2, '2');
    await runSQLMigrations(pool, eventStoreSchemaMigrationsFor());
    const streamCurrent = newStreamId();
    await appendCurrent(streamCurrent, 3);
    return {
      stream_0_42_0,
      stream_0_43_0_rc_2,
      streamCurrent,
    };
  };

  const build_16_1_storeInCustomSchema = async () => {
    const { databaseSchemaName } = customSchemaOptions;
    const stream_0_42_0 = newStreamId();
    const stream_0_43_0_rc_2 = newStreamId();
    const migrationOptions = {
      migrationTable: { schemaName: 'infrastructure' },
    };
    await pool.withTransaction(async ({ execute }) => {
      await execute.command(
        SQL`CREATE SCHEMA IF NOT EXISTS ${SQL.identifier(databaseSchemaName!)}`,
      );
      await execute.command(
        SQL`SET LOCAL search_path TO ${SQL.identifier(databaseSchemaName!)}`,
      );
      await runSQLMigrations(
        pool,
        [
          sqlMigration(
            schemaMigrationFor({ databaseSchemaName }).name,
            [schema_0_42_0],
            { ignoreHashMismatch: true },
          ),
        ],
        { execute, ...migrationOptions },
      );
      await appendToStream_0_38_7(execute, {
        streamId: stream_0_42_0,
        streamType: 'shopping_cart',
        events: [
          { type: 'ProductItemAdded', data: productItemData(stream_0_42_0) },
        ],
      });
      await execute.command(
        SQL`INSERT INTO emt_streams (stream_id, stream_position, partition, stream_type, stream_metadata, is_archived)
            VALUES (${stream_0_43_0_rc_2}, 2, ${defaultTag}, 'shopping_cart', '{}', FALSE)`,
      );
      for (const version of [1, 2]) {
        await execute.command(
          SQL`INSERT INTO emt_messages (stream_id, stream_position, partition, message_data, message_metadata, message_schema_version, message_type, message_kind, message_id, transaction_id)
              VALUES (${stream_0_43_0_rc_2}, ${version}, ${defaultTag}, ${JSON.stringify(productItemData(stream_0_43_0_rc_2))}::jsonb, ${JSON.stringify({ schemaVersion: String(version) })}::jsonb, ${String(version)}, 'ProductItemAdded', 'E', ${crypto.randomUUID()}, pg_current_xact_id())`,
        );
      }
    });
    await runSQLMigrations(
      pool,
      eventStoreSchemaMigrationsFor({ databaseSchemaName }),
      migrationOptions,
    );
    const streamCurrent = newStreamId();
    await appendCurrent(streamCurrent, 3, databaseSchemaName);
    return { stream_0_42_0, stream_0_43_0_rc_2, streamCurrent };
  };

  const insertRow = async (
    schemaVersion: string,
    options: {
      metadata?: Record<string, unknown>;
      messageType?: string;
      partition?: string;
      databaseSchemaName?: string;
    } = {},
  ) => {
    const streamId = newStreamId();
    const partition = options.partition ?? defaultTag;
    const schemaName = SQL.identifier(schemaOf(options.databaseSchemaName));
    await pool.execute.command(
      SQL`INSERT INTO ${schemaName}.emt_streams (stream_id, stream_position, partition, stream_type, stream_metadata, is_archived)
          VALUES (${streamId}, 1, ${partition}, 'shopping_cart', '{}', FALSE)`,
    );
    await pool.execute.command(
      SQL`INSERT INTO ${schemaName}.emt_messages (stream_id, stream_position, partition, message_data, message_metadata, message_schema_version, message_type, message_kind, message_id, transaction_id)
          VALUES (${streamId}, 1, ${partition}, ${JSON.stringify(productItemData(streamId))}::jsonb, ${JSON.stringify(options.metadata ?? {})}::jsonb, ${schemaVersion}, ${options.messageType ?? 'ProductItemAdded'}, 'E', ${crypto.randomUUID()}, pg_current_xact_id())`,
    );
    return streamId;
  };

  const versionOf = async (streamId: string, databaseSchemaName?: string) =>
    (await readRows(databaseSchemaName)).find(
      (row) => row.stream_id === streamId,
    )?.message_schema_version;

  const migrationVariants: {
    name: string;
    run: (
      options?: MigrationOptions & { dryRun?: 'diff' | 'transactional' },
    ) => Promise<RunSQLMigrationsResult>;
  }[] = [
    {
      name: 'schema version migration',
      run: (options) =>
        migrateSchemaToNumericMessageSchemaVersion({ pool, ...options }),
    },
    {
      name: 'mandatory migration',
      run: (options) =>
        runSQLMigrations(
          pool as Dumbo,
          [migration_0_44_0_numericMessageSchemaVersionFor(options)],
          { migrationTable: eventStoreDatabaseSchema(options).migrationTable },
        ),
    },
  ];

  const expectedEvents = async (
    streamId: string,
    schemaVersions: number[],
    reader: 'current' | 'rc2',
    databaseSchemaName?: string,
  ) => {
    const { rows } = await pool.execute.query<{
      message_id: string;
      stream_position: string;
      global_position: string;
      transaction_id: string;
    }>(
      SQL`SELECT message_id, stream_position, global_position, transaction_id FROM ${SQL.identifier(schemaOf(databaseSchemaName))}.emt_messages WHERE stream_id = ${streamId} ORDER BY stream_position`,
    );
    return rows.map((row, index) => {
      const globalPosition =
        PostgreSQLEventStoreCheckpoint.toProcessorCheckpoint({
          transactionId: BigInt(row.transaction_id),
          globalPosition: BigInt(row.global_position),
        });
      const recorded = {
        messageId: row.message_id,
        streamName: streamId,
        streamPosition: BigInt(row.stream_position),
        globalPosition,
        checkpoint: globalPosition,
      };
      return reader === 'current'
        ? {
            type: 'ProductItemAdded',
            kind: 'Event' as const,
            data: productItemData(streamId),
            schemaVersion: schemaVersions[index]!,
            metadata: recorded,
          }
        : {
            type: 'ProductItemAdded',
            kind: 'Event' as const,
            data: productItemData(streamId),
            metadata: {
              schemaVersion: String(schemaVersions[index]!),
              ...recorded,
            },
          };
    });
  };

  const waitForLockWaiter = async (queryPattern: string) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const { rows } = await pool.execute.query<{ waiting: string }>(
        SQL`SELECT count(*) AS waiting FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE ${queryPattern}`,
      );
      if (Number(rows[0]!.waiting) >= 1) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`No backend running ${queryPattern} waits for a lock`);
  };

  const frozenRead = (streamId: string, databaseSchemaName?: string) =>
    readStream_0_43_0_rc_2(pool.execute, streamId, { databaseSchemaName });

  for (const { name, run } of migrationVariants) {
    void describe(name, () => {
      void it('converts every row to an INT version without a user CASE', async () => {
        await build_16_1_store();
        assertEqual('text', await readColumnType());

        await run();

        assertEqual('integer', await readColumnType());
        assertDeepEqual(await readVersions(), [1, 1, 2, 3]);
      });

      void it('a user CASE maps a non-numeric version', async () => {
        await buildStoreWithTextColumn();
        const streamId = await insertRow('v2', {
          metadata: { schemaVersion: 'v2' },
        });

        await run({
          messageSchemaVersionMapping: SQL`CASE WHEN message_schema_version = 'v2' THEN 2 END`,
        });

        assertEqual(2, await versionOf(streamId));
      });

      void it('the user CASE wins over a numeric column value', async () => {
        await buildStoreWithTextColumn();
        const streamId = await insertRow('2', { messageType: 'X' });

        await run({
          messageSchemaVersionMapping: SQL`CASE WHEN message_type = 'X' THEN 5 END`,
        });

        assertEqual(5, await versionOf(streamId));
      });

      void it('rows the user CASE does not match get the default value', async () => {
        await build_16_1_store();

        await run({
          messageSchemaVersionMapping: SQL`CASE WHEN message_type = 'X' THEN 5 END`,
        });

        assertDeepEqual(await readVersions(), [1, 1, 2, 3]);
      });

      void it('a user CASE can read the message type and the metadata', async () => {
        await buildStoreWithTextColumn();
        const matching = await insertRow('v', {
          messageType: 'Y',
          metadata: { tenant: 'a' },
        });
        const notMatching = await insertRow('v', {
          messageType: 'Y',
          metadata: { tenant: 'b' },
        });

        await run({
          messageSchemaVersionMapping: SQL`CASE WHEN message_type = 'Y' AND message_metadata->>'tenant' = 'a' THEN 7 END`,
        });

        assertEqual(7, await versionOf(matching));
        assertEqual(1, await versionOf(notMatching));
      });

      void it('converts every partition', async () => {
        await buildStoreWithTextColumn();
        await pool.execute.command(SQL`SELECT emt_add_partition('other')`);
        const inDefault = await insertRow('2');
        const inOther = await insertRow('3', { partition: 'other' });

        await run();

        assertEqual('integer', await readColumnType());
        assertEqual(2, await versionOf(inDefault));
        assertEqual(3, await versionOf(inOther));
        const partitionColumnTypes = await pool.execute.query<{
          data_type: string;
        }>(
          SQL`SELECT DISTINCT c.data_type FROM information_schema.columns c
              WHERE c.table_name LIKE 'emt_messages%' AND c.column_name = 'message_schema_version'`,
        );
        assertDeepEqual(partitionColumnTypes.rows, [{ data_type: 'integer' }]);
      });

      void it('keeps the column position', async () => {
        await buildStoreWithTextColumn();
        const before = await readColumnPosition();

        await run();

        assertEqual(before, await readColumnPosition());
      });

      void it('a second run changes nothing', async () => {
        await build_16_1_store();
        await run();

        await run();

        assertEqual('integer', await readColumnType());
        assertDeepEqual(await readVersions(), [1, 1, 2, 3]);
      });

      void it('converts an empty store', async () => {
        await buildStoreWithTextColumn();

        await run();

        assertEqual('integer', await readColumnType());
      });

      void it('a rerun with a different user CASE succeeds and changes nothing', async () => {
        await buildStoreWithTextColumn();
        const streamId = await insertRow('2', { messageType: 'X' });
        await run({
          messageSchemaVersionMapping: SQL`CASE WHEN message_type = 'X' THEN 5 END`,
        });

        await run({
          messageSchemaVersionMapping: SQL`CASE WHEN message_type = 'X' THEN 7 END`,
        });

        assertEqual('integer', await readColumnType());
        assertEqual(5, await versionOf(streamId));
      });

      void it('reads a whole JSON number in metadata by the number rule', async () => {
        await buildStoreWithTextColumn();
        const negative = await insertRow('v', {
          metadata: { schemaVersion: -1 },
        });
        const whole = await insertRow('v', { metadata: { schemaVersion: 4 } });
        const fractional = await insertRow('v', {
          metadata: { schemaVersion: 1.5 },
        });
        const text = await insertRow('v', { metadata: { schemaVersion: '6' } });

        const padded = await insertRow('02');
        const decimal = await insertRow('2.0', {
          metadata: { schemaVersion: 5 },
        });
        const negativeText = await insertRow('-1');
        const spaced = await insertRow(' 2');
        const zero = await insertRow('v', { metadata: { schemaVersion: 0 } });
        const columnOverMetadata = await insertRow('3', {
          metadata: { schemaVersion: 4 },
        });

        await run();

        assertEqual(2, await versionOf(padded));
        assertEqual(5, await versionOf(decimal));
        assertEqual(1, await versionOf(negativeText));
        assertEqual(1, await versionOf(spaced));
        assertEqual(0, await versionOf(zero));
        assertEqual(3, await versionOf(columnOverMetadata));
        assertEqual(1, await versionOf(negative));
        assertEqual(4, await versionOf(whole));
        assertEqual(1, await versionOf(fractional));
        assertEqual(6, await versionOf(text));
      });

      void it('a 0.43.0-rc.2 append of a numeric version succeeds after the migration', async () => {
        await buildStoreWithTextColumn();
        await run();
        const streamId = newStreamId();

        await append_0_43_0_rc_2(streamId, '2');

        assertEqual(2, await versionOf(streamId));
        assertDeepEqual(
          (await readStream(pool.execute, streamId)).events,
          await expectedEvents(streamId, [2], 'current'),
        );
        assertDeepEqual(
          (await frozenRead(streamId)).events,
          await expectedEvents(streamId, [2], 'rc2'),
        );
      });

      void it('a 0.43.0-rc.2 append of a non-numeric version fails after the migration', async () => {
        await buildStoreWithTextColumn();
        await run();
        const streamId = newStreamId();

        await assertThrowsAsync(() => append_0_43_0_rc_2(streamId, 'v2'));

        assertThatArray((await frozenRead(streamId)).events).isEmpty();
      });

      void it('migrates a store in a custom database schema', async () => {
        const { databaseSchemaName } = customSchemaOptions;
        await build_16_1_storeInCustomSchema();
        assertEqual('text', await readColumnType(databaseSchemaName));

        await run(customSchemaOptions);

        assertEqual('integer', await readColumnType(databaseSchemaName));
        assertDeepEqual(await readVersions(databaseSchemaName), [1, 1, 2, 3]);
        const streamId = newStreamId();
        await pool.withConnection((connection) =>
          appendToStream_0_43_0_rc_2(
            connection,
            streamId,
            'shopping_cart',
            [event_0_43_0_rc_2(streamId, '2')],
            { databaseSchemaName },
          ),
        );
        assertEqual(2, await versionOf(streamId, databaseSchemaName));
        assertDeepEqual(
          (await frozenRead(streamId, databaseSchemaName)).events,
          await expectedEvents(streamId, [2], 'rc2', databaseSchemaName),
        );
      });
    });
  }

  void describe('schema version migration only', () => {
    const migrate = (
      options?: MigrationOptions & {
        dryRun?: 'diff' | 'transactional';
        migrationTimeoutMS?: number;
      },
    ) => migrateSchemaToNumericMessageSchemaVersion({ pool, ...options });

    void it('reads, consumes and appends after the migration', async () => {
      const streams = await build_16_1_store();
      const streamIds = [
        streams.stream_0_42_0,
        streams.stream_0_43_0_rc_2,
        streams.streamCurrent,
      ];
      const readAll = async () =>
        (
          await Promise.all(streamIds.map((id) => readStream(pool.execute, id)))
        ).flatMap(({ events }) => events);
      const before = await readAll();

      await migrate();

      const after = await readAll();
      assertDeepEqual(after, before);
      assertDeepEqual(
        after.map(({ schemaVersion }) => schemaVersion),
        [1, 1, 2, 3],
      );
      const consumed = await asyncRetry(
        () =>
          readMessagesBatch(pool.execute, {
            after: PostgreSQLEventStoreCheckpoint.default,
            batchSize: 100,
          }),
        {
          retries: 20,
          minTimeout: 50,
          factor: 1,
          shouldRetryResult: (result) => result.messages.length < 4,
        },
      );
      assertDeepEqual(consumed.messages, after);
      const streamId = newStreamId();
      await appendCurrent(streamId, 4);
      const appended = await readStream(pool.execute, streamId);
      assertDeepEqual(
        appended.events.map(({ schemaVersion }) => schemaVersion),
        [4],
      );
    });

    void it('0.43.0-rc.2 reads versions written before the migration', async () => {
      await buildStoreWithTextColumn();
      const streamId = newStreamId();
      await appendCurrent(streamId, 1);
      await appendCurrent(streamId, 2);

      await migrate();

      assertDeepEqual(
        (await frozenRead(streamId)).events,
        await expectedEvents(streamId, [1, 2], 'rc2'),
      );
    });

    void it('opens its own pool from a driver and a connection string', async () => {
      await build_16_1_store();

      await migrateSchemaToNumericMessageSchemaVersion({
        driver: pgEventStoreDriver,
        connectionString: database.connectionString,
      });

      assertEqual('integer', await readColumnType());
      assertDeepEqual(await readVersions(), [1, 1, 2, 3]);
    });

    void it('a diff dry run reports the migration and changes nothing', async () => {
      await build_16_1_store();

      const { applied } = await migrate({ dryRun: 'diff' });

      assertEqual(1, applied.length);
      assertEqual('text', await readColumnType());
      assertDeepEqual(await readVersions(), ['1', '1', '2', '3']);
    });

    void it('a dry run changes nothing', async () => {
      await build_16_1_store();

      await migrate({ dryRun: 'transactional' });

      assertEqual('text', await readColumnType());
      assertDeepEqual(await readVersions(), ['1', '1', '2', '3']);
    });

    void it('fails on the timeout while another transaction holds a lock', async () => {
      await build_16_1_store();
      const locker = dumbo({
        driver: pgDumboDriver,
        connectionString: database.connectionString,
      });
      try {
        await locker.withTransaction(async ({ execute }) => {
          await execute.command(
            SQL`LOCK TABLE emt_messages IN ACCESS SHARE MODE`,
          );
          await assertThrowsAsync(
            () => migrate({ migrationTimeoutMS: 10 }),
            (error) =>
              DumboError.isInstanceOf(error, {
                errorType: QueryCanceledError.ErrorType,
              }),
          );
          return { success: false, result: undefined };
        });
      } finally {
        await locker.close();
      }

      assertEqual('text', await readColumnType());
      assertDeepEqual(await readVersions(), ['1', '1', '2', '3']);
    });

    void it('fails on a metadata version too large for INT and succeeds once a user CASE maps it', async () => {
      await buildStoreWithTextColumn();
      const streamId = await insertRow('v', {
        metadata: { schemaVersion: '99999999999' },
      });

      await assertThrowsAsync(() => migrate());
      assertEqual('text', await readColumnType());
      assertEqual('v', await versionOf(streamId));

      await migrate({
        messageSchemaVersionMapping: SQL`CASE WHEN message_schema_version = 'v' THEN 2 END`,
      });
      assertEqual('integer', await readColumnType());
      assertEqual(2, await versionOf(streamId));
    });

    void it('fails on a value too large for INT and succeeds once a user CASE maps it', async () => {
      await buildStoreWithTextColumn();
      const streamId = await insertRow('99999999999');

      await assertThrowsAsync(() => migrate());
      assertEqual('text', await readColumnType());
      assertEqual('99999999999', await versionOf(streamId));

      await migrate({
        messageSchemaVersionMapping: SQL`CASE WHEN message_schema_version = '99999999999' THEN 2 END`,
      });
      assertEqual(2, await versionOf(streamId));
    });

    void it('a 0.43.0-rc.2 append waits for the migration and succeeds', async () => {
      await buildStoreWithTextColumn();
      const blocker = dumbo({
        driver: pgDumboDriver,
        connectionString: database.connectionString,
      });
      const appender = dumbo({
        driver: pgDumboDriver,
        connectionString: database.connectionString,
      });
      const streamId = newStreamId();
      try {
        let finishHolding: () => void = () => undefined;
        const lockHeld = new Promise<void>(
          (resolve) => (finishHolding = resolve),
        );
        const holding = blocker.withTransaction(async ({ execute }) => {
          await execute.command(
            SQL`LOCK TABLE emt_messages IN ACCESS SHARE MODE`,
          );
          await lockHeld;
          return { success: true, result: undefined };
        });
        await new Promise((resolve) => setTimeout(resolve, 200));

        const migration = migrate();
        await waitForLockWaiter('%ALTER COLUMN message_schema_version%');
        const appending = appender.withConnection((connection) =>
          appendToStream_0_43_0_rc_2(
            connection,
            streamId,
            'shopping_cart',
            [event_0_43_0_rc_2(streamId, '2')],
            { messageIdGenerator: () => crypto.randomUUID() },
          ),
        );
        await waitForLockWaiter('%emt_append_to_stream%');
        finishHolding();
        await holding;
        await migration;
        assertTrue((await appending).success);
      } finally {
        await blocker.close();
        await appender.close();
      }

      assertEqual(2, await versionOf(streamId));
    });

    void it('0.43.0 and 0.43.0-rc.2 append to an INT column after the migration', async () => {
      await build_16_1_store();
      await migrate();
      const streamId = newStreamId();

      await appendCurrent(streamId, 2);
      await append_0_43_0_rc_2(streamId, '2');

      assertEqual('integer', await readColumnType());
      assertDeepEqual(
        (await readStream(pool.execute, streamId)).events,
        await expectedEvents(streamId, [2, 2], 'current'),
      );
      assertEqual(2, await versionOf(streamId));
    });

    void it('a store migrated from 0.43.0-rc.2 keeps the TEXT column until the migration runs', async () => {
      await buildStoreWithTextColumn();

      assertTrue(
        await functionExists(pool.execute, 'emt_append_to_stream_v_0_43_0'),
      );
      assertEqual('text', await readColumnType());
      const recorded = await pool.execute.query<{ name: string }>(
        SQL`SELECT name FROM dmb_migrations WHERE name IN ('emt:postgresql:eventstore:0.43.0:numeric-message-schema-version', 'emt:postgresql:eventstore:0.44.0:numeric-message-schema-version')`,
      );
      assertThatArray(recorded.rows).isEmpty();

      await migrate();

      assertEqual('integer', await readColumnType());
    });

    void it('the mandatory migration changes nothing after the schema version migration', async () => {
      await build_16_1_store();
      await migrate();

      const { applied } = await runSQLMigrations(
        pool as Dumbo,
        migrations_0_44_0,
      );

      assertTrue(
        applied.some(
          ({ name }) =>
            name ===
            'emt:postgresql:eventstore:0.44.0:numeric-message-schema-version',
        ),
      );
      assertEqual('integer', await readColumnType());
      assertDeepEqual(await readVersions(), [1, 1, 2, 3]);
    });
  });
});
