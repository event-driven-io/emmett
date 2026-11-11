import type { InvalidOperationError } from '@event-driven-io/dumbo';
import {
  dumbo,
  runSQLMigrations,
  single,
  SQL,
  sqlMigration,
  type Dumbo,
} from '@event-driven-io/dumbo';
import { pgDumboDriver, type PgPool } from '@event-driven-io/dumbo/pg';
import {
  assertDeepEqual,
  assertEqual,
  assertFalse,
  assertIsNotNull,
  assertMatches,
  assertThatArray,
  assertThrowsAsync,
  assertTrue,
  asyncRetry,
  bigIntProcessorCheckpoint,
  STREAM_DOES_NOT_EXIST,
  STREAM_EXISTS,
  ValidationError,
  type Event,
  type ProcessorCheckpoint,
} from '@event-driven-io/emmett';
import { afterEach, beforeEach, describe, it } from 'vitest';
import {
  sharedPostgreSQLDatabase,
  type PostgreSQLTestDatabase,
} from '../../../../testing/postgreSQLTestDatabase';
import {
  functionExists,
  indexExists,
  tableExists,
} from '../../../../testing/schemaObjects';
import {
  getPostgreSQLEventStore,
  type PostgresEventStore,
} from '../../../postgreSQLEventStore';
import { tryAcquireProcessorLock } from '../../../projections/locks/tryAcquireProcessorLock';
import {
  PostgreSQLEventStoreCheckpoint,
  readMessagesBatch,
} from '../../readMessagesBatch';
import { appendToStream as appendToStreamToCurrentSchema } from '../../appendToStream';
import { readStream } from '../../readStream';
import { eventStoreSchemaMigrationsFor, schemaMigrationFor } from '..';
import { readProcessorCheckpoint } from '../../readProcessorCheckpoint';
import { storeProcessorCheckpoint } from '../../storeProcessorCheckpoint';
import { defaultTag } from '../../typing';
import { migrations_0_36_0 } from '../0_36_0';
import { migrations_0_38_7 } from '../0_38_7';
import {
  appendToStream as appendToStream_0_38_7,
  storeSubscriptionCheckpoint,
} from '../0_38_7/legacyApi';
import { migrations_0_42_0 } from '../0_42_0';
import { schema_0_42_0 } from '../0_42_0/0_42_0.snapshot';
import {
  appendToStream,
  readEvents,
  readProcessorCheckpoint as readProcessorCheckpointV042,
  storeProcessorCheckpoint as storeProcessorCheckpointV042,
} from '../0_42_0/legacyApi';
import { migrations_0_43_0 } from './';
import {
  appendToStream_0_43_0_rc_2,
  callAppendToStream,
  readStream_0_43_0_rc_2,
  migrations_0_43_0_rc_2,
} from './legacyApi';
import { pgEventStoreDriver } from '../../../../pg';

export type ProductItemAdded = Event<
  'ProductItemAdded',
  {
    shoppingCartId: string;
    productItem: { productId: string; quantity: number };
  }
>;

export type ShoppingCartConfirmed = Event<
  'ShoppingCartConfirmed',
  { shoppingCartId: string }
>;

export type ShoppingCartEvent = ProductItemAdded | ShoppingCartConfirmed;

export type OrderInitiated = Event<
  'OrderInitiated',
  { shoppingCartId: string; orderId: string }
>;

void describe('Schema migrations tests', () => {
  let database: PostgreSQLTestDatabase;
  let pool: PgPool;
  let eventStore: PostgresEventStore;
  let connectionString: string;

  beforeEach(async () => {
    database = await sharedPostgreSQLDatabase();
    connectionString = database.connectionString;

    pool = dumbo({
      driver: pgDumboDriver,
      connectionString,
      transactionOptions: {
        allowNestedTransactions: true,
      },
    });

    // TODO: Change setup to schemas, when they're supported in Emmett instead of using separate containers
    eventStore = getPostgreSQLEventStore({
      driver: pgEventStoreDriver,
      connectionString: connectionString,
      pool: pool,
      schema: { autoMigration: 'None' },
    });
  });

  afterEach(async () => {
    try {
      await eventStore?.close();
      await pool?.close();
      await database?.close();
    } catch (error) {
      console.log(error);
    }
  });

  for (const { name, databaseSchemaName } of [
    { name: 'default schema', databaseSchemaName: undefined },
    { name: 'configured schema', databaseSchemaName: 'events' },
  ]) {
    void it(`Preserves existing events and enforces stream existence requirements when upgrading an initialized store in the ${name}`, async () => {
      const schemaName = databaseSchemaName ?? 'public';
      const event: Event = {
        type: 'Opened',
        data: { accountId: 'account-123' },
      };
      const streamName = 'account-existing';

      await pool.withTransaction(async ({ execute }) => {
        await execute.command(
          SQL`CREATE SCHEMA IF NOT EXISTS ${SQL.identifier(schemaName)}`,
        );
        await execute.command(
          SQL`SET LOCAL search_path TO ${SQL.identifier(schemaName)}`,
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
          { execute, migrationTable: { schemaName: 'infrastructure' } },
        );

        const result = await single(
          execute.command<{ success: boolean }>(
            callAppendToStream({
              databaseSchemaName,
              messageIds: [crypto.randomUUID()],
              messagesData: [event.data],
              messagesMetadata: [{}],
              schemaVersions: ['1'],
              messageTypes: [event.type],
              messageKinds: ['E'],
              streamId: streamName,
              streamType: 'account',
              expectedStreamPosition: null,
              partition: defaultTag,
            }),
          ),
        );
        assertTrue(result.success);
      });

      const migrations = eventStoreSchemaMigrationsFor({ databaseSchemaName });
      const migrationOptions = {
        migrationTable: { schemaName: 'infrastructure' },
      };
      const migration = await runSQLMigrations(
        pool,
        migrations,
        migrationOptions,
      );
      assertTrue(migration.applied.length > 0);
      assertTrue(
        migration.skipped.some(
          ({ name }) =>
            name === schemaMigrationFor({ databaseSchemaName }).name,
        ),
      );

      const existing = await single(
        pool.execute.command<{
          success: boolean;
          next_stream_position: string | bigint | null;
        }>(
          callAppendToStream({
            databaseSchemaName,
            messageIds: [crypto.randomUUID()],
            messagesData: [event.data],
            messagesMetadata: [{}],
            schemaVersions: ['1'],
            messageTypes: [event.type],
            messageKinds: ['E'],
            streamId: streamName,
            streamType: 'account',
            expectedStreamPosition: -1n,
            partition: defaultTag,
          }),
        ),
      );
      assertTrue(existing.success);
      assertIsNotNull(existing.next_stream_position);
      assertEqual(2n, BigInt(existing.next_stream_position));

      const duplicate = await pool.withConnection((connection) =>
        appendToStreamToCurrentSchema(
          connection,
          streamName,
          'account',
          [event],
          {
            expectedStreamVersion: STREAM_DOES_NOT_EXIST,
            databaseSchemaName,
          },
        ),
      );
      assertFalse(duplicate.success);
      const missing = await pool.withConnection((connection) =>
        appendToStreamToCurrentSchema(
          connection,
          'account-missing',
          'account',
          [event],
          {
            expectedStreamVersion: STREAM_EXISTS,
            databaseSchemaName,
          },
        ),
      );
      assertFalse(missing.success);

      const stored = await readStream(pool.execute, streamName, {
        databaseSchemaName,
      });
      assertEqual(2, stored.events.length);
      assertDeepEqual(
        stored.events.map(({ type, data }) => ({ type, data })),
        [event, event],
      );
      assertDeepEqual(
        stored.events.map(({ metadata }) => metadata.streamPosition),
        [1n, 2n],
      );
      const missingStream = await readStream(pool.execute, 'account-missing', {
        databaseSchemaName,
      });
      assertFalse(missingStream.streamExists);

      const repeated = await runSQLMigrations(
        pool,
        migrations,
        migrationOptions,
      );
      assertEqual(0, repeated.applied.length);
    });
  }

  void it('migrates from 0.42.0 schema and drops old subscriptions API', async () => {
    // Given
    await runSQLMigrations(pool, [
      ...migrations_0_36_0,
      ...migrations_0_38_7,
      ...migrations_0_42_0,
    ]);

    // When
    const { applied, skipped } = await runSQLMigrations(
      pool,
      migrations_0_43_0,
    );

    // Then
    assertDeepEqual(applied, migrations_0_43_0);
    assertThatArray(skipped).isEmpty();

    // Then
    const result = await assertCanAppendAndRead();
    await assertCanStoreAndReadCheckpoints(pool, result);

    assertFalse(
      await functionExists(pool.execute, 'store_subscription_checkpoint'),
    );
    assertFalse(await tableExists(pool.execute, 'emt_subscriptions'));
  });

  void it('adds the messages poll index when migrating from an existing 0.42.0 schema', async () => {
    // Given
    await runSQLMigrations(pool, [
      ...migrations_0_36_0,
      ...migrations_0_38_7,
      ...migrations_0_42_0,
    ]);
    assertFalse(
      await indexExists(
        pool.execute,
        'idx_messages_transaction_id_global_position',
      ),
    );

    // When
    await runSQLMigrations(pool, migrations_0_43_0);

    // Then
    assertTrue(
      await indexExists(
        pool.execute,
        'idx_messages_transaction_id_global_position',
      ),
    );
  });

  void it('drops the single-column backport index when migrating from an existing 0.42.0 schema', async () => {
    // Given
    await runSQLMigrations(pool, [
      ...migrations_0_36_0,
      ...migrations_0_38_7,
      ...migrations_0_42_0,
    ]);
    await pool.execute.command(
      SQL`CREATE INDEX idx_messages_global_position ON emt_messages(global_position)`,
    );
    assertTrue(await indexExists(pool.execute, 'idx_messages_global_position'));

    // When
    await runSQLMigrations(pool, migrations_0_43_0);

    // Then
    assertFalse(
      await indexExists(pool.execute, 'idx_messages_global_position'),
    );
    assertTrue(
      await indexExists(
        pool.execute,
        'idx_messages_transaction_id_global_position',
      ),
    );
  });

  void it('leaves the event store tables of another database schema alone when migrating the default schema', async () => {
    // Given
    const otherSchemaName = 'events';
    const otherSchemaStore = getPostgreSQLEventStore({
      driver: pgEventStoreDriver,
      connectionString: connectionString,
      schema: {
        autoMigration: 'None',
        databaseSchemaName: otherSchemaName,
      },
    });
    try {
      await otherSchemaStore.schema.migrate();
    } finally {
      await otherSchemaStore.close();
    }

    // When
    const { applied } = await runSQLMigrations(pool, migrations_0_43_0);

    // Then
    assertDeepEqual(applied, migrations_0_43_0);
    assertFalse(await tableExists(pool.execute, 'emt_messages', 'public'));
    assertFalse(await tableExists(pool.execute, 'emt_processors', 'public'));
    assertFalse(
      await indexExists(
        pool.execute,
        'idx_messages_transaction_id_global_position',
        'public',
      ),
    );
    assertTrue(
      await indexExists(
        pool.execute,
        'idx_messages_transaction_id_global_position',
        otherSchemaName,
      ),
    );
  });

  void it('migrates from 0.43.0 schema', async () => {
    // Given
    await runSQLMigrations(pool, [
      ...migrations_0_36_0,
      ...migrations_0_38_7,
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

  void it('0.43.0-rc.2 reads the metadata schema version of the event it appended to a 0.43.0-rc.2 store', async () => {
    // Given
    await runSQLMigrations(pool, [
      ...migrations_0_36_0,
      ...migrations_0_38_7,
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
        productItem: { productId: 'product-123', quantity: 2 },
      },
      metadata: { schemaVersion: '2' },
    };
    const appended = await pool.withConnection((connection) =>
      appendToStream_0_43_0_rc_2(
        connection,
        streamId,
        'shopping_cart',
        [event],
        {
          messageIdGenerator: () => messageId,
        },
      ),
    );
    assertTrue(appended.success);
    const globalPosition = PostgreSQLEventStoreCheckpoint.toProcessorCheckpoint(
      appended.checkpoints[0]!,
    );

    // When
    const { events } = await readStream_0_43_0_rc_2(pool.execute, streamId);

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

  const readStoredMessage = async (streamId: string) =>
    single(
      pool.execute.query<{
        message_id: string;
        message_schema_version: string;
      }>(
        SQL`SELECT message_id, message_schema_version FROM emt_messages WHERE stream_id = ${streamId}`,
      ),
    );

  const readSchemaVersionColumnType = async (databaseSchemaName = 'public') =>
    (
      await single(
        pool.execute.query<{ data_type: string }>(
          SQL`SELECT data_type FROM information_schema.columns WHERE table_schema = ${databaseSchemaName} AND table_name = 'emt_messages' AND column_name = 'message_schema_version'`,
        ),
      )
    ).data_type;

  const appendWith_0_42_0 = async (streamId: string) => {
    await runSQLMigrations(pool, [
      ...migrations_0_36_0,
      ...migrations_0_38_7,
      ...migrations_0_42_0,
    ]);
    const itemAdded: ProductItemAdded = {
      type: 'ProductItemAdded',
      data: {
        shoppingCartId: streamId,
        productItem: { productId: 'product-123', quantity: 2 },
      },
    };
    const appended = await appendToStream(pool.execute, {
      streamId,
      streamType: 'shopping_cart',
      events: [itemAdded],
    });
    return {
      event: itemAdded,
      globalPosition: PostgreSQLEventStoreCheckpoint.toProcessorCheckpoint({
        transactionId: appended.transactionId,
        globalPosition: appended.globalPositions[0]!,
      }),
    };
  };

  const appendWith_0_43_0_rc_2 = async (
    streamId: string,
    messageId: string,
  ) => {
    await runSQLMigrations(pool, [
      ...migrations_0_36_0,
      ...migrations_0_38_7,
      ...migrations_0_42_0,
      ...migrations_0_43_0_rc_2,
    ]);
    const event: Event<
      'ProductItemAdded',
      ProductItemAdded['data'],
      { schemaVersion: string }
    > = {
      type: 'ProductItemAdded',
      data: {
        shoppingCartId: streamId,
        productItem: { productId: 'product-123', quantity: 2 },
      },
      metadata: { schemaVersion: '2' },
    };
    const appended = await pool.withConnection((connection) =>
      appendToStream_0_43_0_rc_2(
        connection,
        streamId,
        'shopping_cart',
        [event],
        {
          messageIdGenerator: () => messageId,
        },
      ),
    );
    assertTrue(appended.success);
    return {
      event,
      globalPosition: PostgreSQLEventStoreCheckpoint.toProcessorCheckpoint(
        appended.checkpoints[0]!,
      ),
    };
  };

  void it('0.43.0 reads schema version 1 for an event 0.42.0 appended, after migrating from 0.42.0', async () => {
    // Given
    const streamId = `shopping_cart-${crypto.randomUUID()}`;
    const { event, globalPosition } = await appendWith_0_42_0(streamId);
    const stored = await readStoredMessage(streamId);
    assertEqual('1', stored.message_schema_version);

    // When
    await runSQLMigrations(pool, eventStoreSchemaMigrationsFor());
    const { events } = await readStream(pool.execute, streamId);

    // Then
    assertEqual('text', await readSchemaVersionColumnType());
    assertDeepEqual(events, [
      {
        type: 'ProductItemAdded',
        kind: 'Event',
        data: event.data,
        schemaVersion: 1,
        metadata: {
          messageId: stored.message_id,
          streamName: streamId,
          streamPosition: 1n,
          globalPosition,
          checkpoint: globalPosition,
        },
      },
    ]);
  });

  void it("0.43.0 reads schema version 2 without metadata schemaVersion for an event 0.43.0-rc.2 appended with metadata schemaVersion '2', after migrating from 0.43.0-rc.2", async () => {
    // Given
    const streamId = `shopping_cart-${crypto.randomUUID()}`;
    const messageId = crypto.randomUUID();
    const { event, globalPosition } = await appendWith_0_43_0_rc_2(
      streamId,
      messageId,
    );
    assertEqual(
      '2',
      (await readStoredMessage(streamId)).message_schema_version,
    );

    // When
    await runSQLMigrations(pool, eventStoreSchemaMigrationsFor());
    const { events } = await readStream(pool.execute, streamId);

    // Then
    assertDeepEqual(events, [
      {
        type: 'ProductItemAdded',
        kind: 'Event',
        data: event.data,
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

  void it('0.43.0 consumers read the same schema versions as readStream for events 0.42.0 and 0.43.0-rc.2 appended, after migrating from them', async () => {
    // Given
    const streamId_0_42_0 = `shopping_cart-${crypto.randomUUID()}`;
    const streamId_0_43_0_rc_2 = `shopping_cart-${crypto.randomUUID()}`;
    await appendWith_0_42_0(streamId_0_42_0);
    await appendWith_0_43_0_rc_2(streamId_0_43_0_rc_2, crypto.randomUUID());

    // When
    await runSQLMigrations(pool, eventStoreSchemaMigrationsFor());
    const messages = await asyncRetry(
      async () =>
        (
          await readMessagesBatch(pool.execute, {
            after: PostgreSQLEventStoreCheckpoint.default,
            batchSize: 100,
          })
        ).messages.filter(({ metadata }) =>
          [streamId_0_42_0, streamId_0_43_0_rc_2].includes(metadata.streamName),
        ),
      {
        retries: 20,
        minTimeout: 50,
        factor: 1,
        shouldRetryResult: (visible) => visible.length < 2,
      },
    );
    const events_0_42_0 = await readStream(pool.execute, streamId_0_42_0);
    const events_0_43_0_rc_2 = await readStream(
      pool.execute,
      streamId_0_43_0_rc_2,
    );

    // Then
    assertEqual('text', await readSchemaVersionColumnType());
    assertDeepEqual(messages, [
      ...events_0_42_0.events,
      ...events_0_43_0_rc_2.events,
    ]);
    assertDeepEqual(
      [...events_0_42_0.events, ...events_0_43_0_rc_2.events].map(
        ({ schemaVersion }) => schemaVersion,
      ),
      [1, 2],
    );
  });

  void describe('numeric schema version appends', () => {
    const productItemData = (streamId: string): ProductItemAdded['data'] => ({
      shoppingCartId: streamId,
      productItem: { productId: 'product-123', quantity: 2 },
    });

    const versionedEvent = (
      streamId: string,
      schemaVersion: number,
    ): Event<
      'ProductItemAdded',
      ProductItemAdded['data'],
      undefined,
      number
    > => ({
      type: 'ProductItemAdded',
      data: productItemData(streamId),
      schemaVersion,
    });

    const unversionedEvent = (streamId: string): ProductItemAdded => ({
      type: 'ProductItemAdded',
      data: productItemData(streamId),
    });

    const event_0_43_0_rc_2 = (
      streamId: string,
      metadataSchemaVersion?: string,
    ): Event<
      'ProductItemAdded',
      ProductItemAdded['data'],
      { schemaVersion?: string }
    > => ({
      type: 'ProductItemAdded',
      data: productItemData(streamId),
      metadata:
        metadataSchemaVersion === undefined
          ? {}
          : { schemaVersion: metadataSchemaVersion },
    });

    const build_0_43_0_rc_2_store = () =>
      runSQLMigrations(pool, [
        ...migrations_0_36_0,
        ...migrations_0_38_7,
        ...migrations_0_42_0,
        ...migrations_0_43_0_rc_2,
        sqlMigration(schemaMigrationFor().name, [SQL`SELECT 1`], {
          ignoreHashMismatch: true,
        }),
      ]);

    const upgradeFrom_0_43_0_rc_2 = async () => {
      await build_0_43_0_rc_2_store();
      await runSQLMigrations(pool, eventStoreSchemaMigrationsFor());
    };

    const append_0_43_0 = async (
      streamId: string,
      events: Event[],
      messageIds: string[] = events.map(() => crypto.randomUUID()),
      databaseSchemaName?: string,
    ) => {
      let next = 0;
      const appended = await pool.withConnection((connection) =>
        appendToStreamToCurrentSchema(
          connection,
          streamId,
          'shopping_cart',
          events,
          {
            messageIdGenerator: () => messageIds[next++]!,
            databaseSchemaName,
          },
        ),
      );
      assertTrue(appended.success);
      return appended.checkpoints.map((checkpoint) =>
        PostgreSQLEventStoreCheckpoint.toProcessorCheckpoint(checkpoint),
      );
    };

    const append_0_43_0_rc_2 = async (
      streamId: string,
      metadataSchemaVersion?: string,
      messageId: string = crypto.randomUUID(),
    ) => {
      const appended = await pool.withConnection((connection) =>
        appendToStream_0_43_0_rc_2(
          connection,
          streamId,
          'shopping_cart',
          [event_0_43_0_rc_2(streamId, metadataSchemaVersion)],
          { messageIdGenerator: () => messageId },
        ),
      );
      assertTrue(appended.success);
      return PostgreSQLEventStoreCheckpoint.toProcessorCheckpoint(
        appended.checkpoints[0]!,
      );
    };

    const readStoredRows = async (
      streamId: string,
      databaseSchemaName = 'public',
    ) =>
      (
        await pool.execute.query<{
          message_schema_version: string | number;
          message_metadata: Record<string, unknown>;
        }>(
          SQL`SELECT message_schema_version, message_metadata FROM ${SQL.identifier(databaseSchemaName)}.emt_messages WHERE stream_id = ${streamId} ORDER BY stream_position`,
        )
      ).rows;

    const recordedMetadata = (
      streamId: string,
      messageId: string,
      streamPosition: bigint,
      globalPosition: ProcessorCheckpoint,
    ) => ({
      messageId,
      streamName: streamId,
      streamPosition,
      globalPosition,
      checkpoint: globalPosition,
    });

    const recordedEvent = (
      streamId: string,
      schemaVersion: number,
      messageId: string,
      streamPosition: bigint,
      globalPosition: ProcessorCheckpoint,
    ) => ({
      type: 'ProductItemAdded',
      kind: 'Event' as const,
      data: productItemData(streamId),
      schemaVersion,
      metadata: recordedMetadata(
        streamId,
        messageId,
        streamPosition,
        globalPosition,
      ),
    });

    void it('0.43.0 append fails for version -1, after migrating from 0.43.0-rc.2', async () => {
      await upgradeFrom_0_43_0_rc_2();
      const streamId = `shopping_cart-${crypto.randomUUID()}`;

      await assertThrowsAsync(
        () =>
          append_0_43_0(
            streamId,
            [versionedEvent(streamId, -1)],
            [crypto.randomUUID()],
          ),
        (error) => error instanceof ValidationError,
      );

      assertDeepEqual(await readStoredRows(streamId), []);
    });

    void it('0.43.0-rc.2 reads metadata schema versions of events 0.43.0 appended, after migrating from 0.43.0-rc.2', async () => {
      await upgradeFrom_0_43_0_rc_2();
      const streamId = `shopping_cart-${crypto.randomUUID()}`;
      const messageIds = [crypto.randomUUID(), crypto.randomUUID()];
      const globalPositions = await append_0_43_0(
        streamId,
        [versionedEvent(streamId, 2), unversionedEvent(streamId)],
        messageIds,
      );

      const { events } = await readStream_0_43_0_rc_2(pool.execute, streamId);

      assertDeepEqual(
        events,
        ['2', '1'].map((schemaVersion, index) => ({
          type: 'ProductItemAdded',
          kind: 'Event',
          data: productItemData(streamId),
          metadata: {
            schemaVersion,
            ...recordedMetadata(
              streamId,
              messageIds[index]!,
              BigInt(index + 1),
              globalPositions[index]!,
            ),
          },
        })),
      );
    });

    void it('0.43.0 reads schema versions of events 0.43.0-rc.2 appended, after migrating from 0.43.0-rc.2', async () => {
      await upgradeFrom_0_43_0_rc_2();
      const streamId = `shopping_cart-${crypto.randomUUID()}`;
      const messageIds = [crypto.randomUUID(), crypto.randomUUID()];
      const globalPositions = [
        await append_0_43_0_rc_2(streamId, '2', messageIds[0]),
        await append_0_43_0_rc_2(streamId, undefined, messageIds[1]),
      ];

      const { events } = await readStream(pool.execute, streamId);

      assertDeepEqual(
        events,
        [2, 1].map((schemaVersion, index) =>
          recordedEvent(
            streamId,
            schemaVersion,
            messageIds[index]!,
            BigInt(index + 1),
            globalPositions[index]!,
          ),
        ),
      );
    });

    void it('0.43.0-rc.2 and 0.43.0 append to one stream in turn, after migrating from 0.43.0-rc.2', async () => {
      await upgradeFrom_0_43_0_rc_2();
      const streamId = `shopping_cart-${crypto.randomUUID()}`;

      const messageIds = [
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
      ];

      const globalPositions = [
        await append_0_43_0_rc_2(streamId, '2', messageIds[0]),
        ...(await append_0_43_0(
          streamId,
          [versionedEvent(streamId, 3)],
          [messageIds[1]!],
        )),
        await append_0_43_0_rc_2(streamId, undefined, messageIds[2]),
        ...(await append_0_43_0(
          streamId,
          [unversionedEvent(streamId)],
          [messageIds[3]!],
        )),
      ];

      const { events } = await readStream(pool.execute, streamId);
      assertDeepEqual(
        events,
        [2, 3, 1, 1].map((schemaVersion, index) =>
          recordedEvent(
            streamId,
            schemaVersion,
            messageIds[index]!,
            BigInt(index + 1),
            globalPositions[index]!,
          ),
        ),
      );
    });

    void it("0.43.0-rc.2 appends metadata schemaVersion '2' to the TEXT column, after migrating from 0.43.0-rc.2", async () => {
      await upgradeFrom_0_43_0_rc_2();
      const streamId = `shopping_cart-${crypto.randomUUID()}`;

      await append_0_43_0_rc_2(streamId, '2');

      assertDeepEqual(await readStoredRows(streamId), [
        {
          message_schema_version: '2',
          message_metadata: { schemaVersion: '2' },
        },
      ]);
    });

    for (const { criterion, schemaVersion } of [
      {
        criterion:
          "0.43.0-rc.2 append fails for metadata schemaVersion 'v2', after migrating from 0.43.0-rc.2",
        schemaVersion: 'v2',
      },
      {
        criterion:
          '0.43.0-rc.2 append fails for a metadata schemaVersion too large for INT, after migrating from 0.43.0-rc.2',
        schemaVersion: '99999999999',
      },
      {
        criterion:
          "0.43.0-rc.2 append fails for metadata schemaVersion '0', after migrating from 0.43.0-rc.2",
        schemaVersion: '0',
      },
    ]) {
      void it(criterion, async () => {
        await upgradeFrom_0_43_0_rc_2();
        const streamId = `shopping_cart-${crypto.randomUUID()}`;
        const messageId = crypto.randomUUID();
        const globalPosition = await append_0_43_0_rc_2(
          streamId,
          '2',
          messageId,
        );

        await assertThrowsAsync(() =>
          append_0_43_0_rc_2(streamId, schemaVersion),
        );

        const { events } = await readStream_0_43_0_rc_2(pool.execute, streamId);
        assertDeepEqual(events, [
          {
            type: 'ProductItemAdded',
            kind: 'Event',
            data: productItemData(streamId),
            metadata: {
              schemaVersion: '2',
              ...recordedMetadata(streamId, messageId, 1n, globalPosition),
            },
          },
        ]);
      });
    }

    void it('0.43.0 appends after emt_append_to_stream is dropped, after migrating from 0.43.0-rc.2', async () => {
      await upgradeFrom_0_43_0_rc_2();
      await pool.execute.command(
        SQL`DROP FUNCTION emt_append_to_stream(text[], jsonb[], jsonb[], text[], text[], text[], text, text, bigint, text)`,
      );
      const streamId = `shopping_cart-${crypto.randomUUID()}`;
      const messageId = crypto.randomUUID();

      const [globalPosition] = await append_0_43_0(
        streamId,
        [versionedEvent(streamId, 2)],
        [messageId],
      );

      const { events } = await readStream(pool.execute, streamId);
      assertDeepEqual(events, [
        recordedEvent(streamId, 2, messageId, 1n, globalPosition!),
      ]);
    });

    void it('0.43.0 appends when an emt_append_to_stream_v_0_43_0 with text[] versions also exists, after migrating from 0.43.0-rc.2', async () => {
      await upgradeFrom_0_43_0_rc_2();
      await pool.execute.command(
        SQL`CREATE FUNCTION emt_append_to_stream_v_0_43_0(text[], jsonb[], jsonb[], text[], text[], text[], text, text, bigint, text) RETURNS void LANGUAGE sql AS $$ SELECT $$`,
      );
      const streamId = `shopping_cart-${crypto.randomUUID()}`;
      const messageId = crypto.randomUUID();

      const [globalPosition] = await append_0_43_0(
        streamId,
        [versionedEvent(streamId, 2)],
        [messageId],
      );

      const { events } = await readStream(pool.execute, streamId);
      assertDeepEqual(events, [
        recordedEvent(streamId, 2, messageId, 1n, globalPosition!),
      ]);
    });

    void it('0.43.0 stores version 3 in the TEXT column and in metadata, after migrating from 0.43.0-rc.2', async () => {
      await upgradeFrom_0_43_0_rc_2();
      const streamId = `shopping_cart-${crypto.randomUUID()}`;
      const messageId = crypto.randomUUID();

      const [globalPosition] = await append_0_43_0(
        streamId,
        [versionedEvent(streamId, 3)],
        [messageId],
      );

      const { events } = await readStream(pool.execute, streamId);
      assertDeepEqual(await readStoredRows(streamId), [
        {
          message_schema_version: '3',
          message_metadata: { schemaVersion: '3' },
        },
      ]);
      assertDeepEqual(events, [
        recordedEvent(streamId, 3, messageId, 1n, globalPosition!),
      ]);
    });

    void it('a fresh 0.43.0 store gets an INT schema version column after created and before is_archived', async () => {
      await runSQLMigrations(pool, eventStoreSchemaMigrationsFor());

      const { rows } = await pool.execute.query<{
        column_name: string;
        data_type: string;
      }>(
        SQL`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'emt_messages' ORDER BY ordinal_position`,
      );
      const index = rows.findIndex(
        (row) => row.column_name === 'message_schema_version',
      );
      assertDeepEqual(
        {
          dataType: rows[index]?.data_type,
          after: rows[index - 1]?.column_name,
          before: rows[index + 1]?.column_name,
        },
        { dataType: 'integer', after: 'created', before: 'is_archived' },
      );
    });

    void it('a store migrated from 0.43.0-rc.2 keeps the TEXT schema version column', async () => {
      await upgradeFrom_0_43_0_rc_2();

      assertEqual('text', await readSchemaVersionColumnType());
    });

    void it('a store migrated from 0.42.0 keeps the TEXT schema version column', async () => {
      await runSQLMigrations(pool, [
        ...migrations_0_36_0,
        ...migrations_0_38_7,
        ...migrations_0_42_0,
      ]);
      await runSQLMigrations(pool, eventStoreSchemaMigrationsFor());

      assertEqual('text', await readSchemaVersionColumnType());
    });

    void it("0.43.0-rc.2 appends metadata schemaVersion '2' as INT and fails for 'v2' on a store 0.43.0 created", async () => {
      await runSQLMigrations(pool, eventStoreSchemaMigrationsFor());
      const streamId = `shopping_cart-${crypto.randomUUID()}`;
      const messageId = crypto.randomUUID();

      await append_0_43_0_rc_2(streamId, '2', messageId);
      await assertThrowsAsync(() => append_0_43_0_rc_2(streamId, 'v2'));

      assertEqual('integer', await readSchemaVersionColumnType());
      assertDeepEqual(await readStoredRows(streamId), [
        {
          message_schema_version: 2,
          message_metadata: { schemaVersion: '2' },
        },
      ]);
    });

    void it("0.43.0-rc.2 append fails for metadata schemaVersion '0' on a store 0.43.0 created", async () => {
      await runSQLMigrations(pool, eventStoreSchemaMigrationsFor());
      const streamId = `shopping_cart-${crypto.randomUUID()}`;

      await assertThrowsAsync(() => append_0_43_0_rc_2(streamId, '0'));

      assertDeepEqual(await readStoredRows(streamId), []);
    });

    void it('running the 0.43.0 automatic migrations twice after migrating from 0.43.0-rc.2 applies nothing and keeps both append functions', async () => {
      await upgradeFrom_0_43_0_rc_2();

      const repeated = await runSQLMigrations(
        pool,
        eventStoreSchemaMigrationsFor(),
      );

      assertThatArray(repeated.applied).isEmpty();
      assertTrue(await functionExists(pool.execute, 'emt_append_to_stream'));
      assertTrue(
        await functionExists(pool.execute, 'emt_append_to_stream_v_0_43_0'),
      );
    });

    void it('the 0.43.0 automatic migrations add both append functions to a custom schema with 0.42.0 and 0.43.0-rc.2 events', async () => {
      const databaseSchemaName = 'events';
      const migrationOptions = {
        migrationTable: { schemaName: 'infrastructure' },
      };
      const streamId_0_42_0 = `shopping_cart-${crypto.randomUUID()}`;
      const streamId_0_43_0_rc_2 = `shopping_cart-${crypto.randomUUID()}`;
      const messageId_0_43_0_rc_2 = crypto.randomUUID();
      await pool.withTransaction(async ({ execute }) => {
        await execute.command(
          SQL`CREATE SCHEMA IF NOT EXISTS ${SQL.identifier(databaseSchemaName)}`,
        );
        await execute.command(
          SQL`SET LOCAL search_path TO ${SQL.identifier(databaseSchemaName)}`,
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
          streamId: streamId_0_42_0,
          streamType: 'shopping_cart',
          events: [unversionedEvent(streamId_0_42_0)],
        });
        await execute.command(
          SQL`INSERT INTO emt_streams (stream_id, stream_position, partition, stream_type, stream_metadata, is_archived)
              VALUES (${streamId_0_43_0_rc_2}, 1, ${defaultTag}, 'shopping_cart', '{}', FALSE)`,
        );
        await execute.command(
          SQL`INSERT INTO emt_messages (stream_id, stream_position, partition, message_data, message_metadata, message_schema_version, message_type, message_kind, message_id, transaction_id)
              VALUES (${streamId_0_43_0_rc_2}, 1, ${defaultTag}, ${JSON.stringify(productItemData(streamId_0_43_0_rc_2))}::jsonb, '{"schemaVersion":"2"}'::jsonb, '2', 'ProductItemAdded', 'E', ${messageId_0_43_0_rc_2}, pg_current_xact_id())`,
        );
      });

      await runSQLMigrations(
        pool,
        eventStoreSchemaMigrationsFor({ databaseSchemaName }),
        migrationOptions,
      );

      assertTrue(
        await functionExists(
          pool.execute,
          'emt_append_to_stream',
          databaseSchemaName,
        ),
      );
      assertTrue(
        await functionExists(
          pool.execute,
          'emt_append_to_stream_v_0_43_0',
          databaseSchemaName,
        ),
      );
      assertEqual(
        'text',
        await readSchemaVersionColumnType(databaseSchemaName),
      );

      const readStoredPosition = async (streamId: string) => {
        const row = await single(
          pool.execute.query<{
            message_id: string;
            global_position: string;
            transaction_id: string;
          }>(
            SQL`SELECT message_id, global_position, transaction_id FROM ${SQL.identifier(databaseSchemaName)}.emt_messages WHERE stream_id = ${streamId}`,
          ),
        );
        return {
          messageId: row.message_id,
          globalPosition: PostgreSQLEventStoreCheckpoint.toProcessorCheckpoint({
            transactionId: BigInt(row.transaction_id),
            globalPosition: BigInt(row.global_position),
          }),
        };
      };
      const position_0_42_0 = await readStoredPosition(streamId_0_42_0);
      const position_0_43_0_rc_2 =
        await readStoredPosition(streamId_0_43_0_rc_2);

      const events_0_42_0 = await readStream(pool.execute, streamId_0_42_0, {
        databaseSchemaName,
      });
      const events_0_43_0_rc_2 = await readStream(
        pool.execute,
        streamId_0_43_0_rc_2,
        {
          databaseSchemaName,
        },
      );
      assertDeepEqual(events_0_42_0.events, [
        recordedEvent(
          streamId_0_42_0,
          1,
          position_0_42_0.messageId,
          1n,
          position_0_42_0.globalPosition,
        ),
      ]);
      assertDeepEqual(events_0_43_0_rc_2.events, [
        recordedEvent(
          streamId_0_43_0_rc_2,
          2,
          messageId_0_43_0_rc_2,
          1n,
          position_0_43_0_rc_2.globalPosition,
        ),
      ]);

      const currentStreamId = `shopping_cart-${crypto.randomUUID()}`;
      const currentMessageIds = [crypto.randomUUID(), crypto.randomUUID()];
      const currentGlobalPositions = await append_0_43_0(
        currentStreamId,
        [
          versionedEvent(currentStreamId, 2),
          versionedEvent(currentStreamId, 3),
        ],
        currentMessageIds,
        databaseSchemaName,
      );
      const current = await readStream(pool.execute, currentStreamId, {
        databaseSchemaName,
      });
      assertDeepEqual(
        current.events,
        [2, 3].map((schemaVersion, index) =>
          recordedEvent(
            currentStreamId,
            schemaVersion,
            currentMessageIds[index]!,
            BigInt(index + 1),
            currentGlobalPositions[index]!,
          ),
        ),
      );
      assertDeepEqual(
        await readStoredRows(currentStreamId, databaseSchemaName),
        [
          {
            message_schema_version: '2',
            message_metadata: { schemaVersion: '2' },
          },
          {
            message_schema_version: '3',
            message_metadata: { schemaVersion: '3' },
          },
        ],
      );

      const appended_0_43_0_rc_2 = await single(
        pool.execute.command<{ success: boolean }>(
          callAppendToStream({
            databaseSchemaName,
            messageIds: [crypto.randomUUID()],
            messagesData: [productItemData(streamId_0_43_0_rc_2)],
            messagesMetadata: [{ schemaVersion: '2' }],
            schemaVersions: ['2'],
            messageTypes: ['ProductItemAdded'],
            messageKinds: ['E'],
            streamId: streamId_0_43_0_rc_2,
            streamType: 'shopping_cart',
            expectedStreamPosition: null,
            partition: defaultTag,
          }),
        ),
      );
      assertTrue(appended_0_43_0_rc_2.success);
      assertDeepEqual(
        await readStoredRows(streamId_0_43_0_rc_2, databaseSchemaName),
        [
          {
            message_schema_version: '2',
            message_metadata: { schemaVersion: '2' },
          },
          {
            message_schema_version: '2',
            message_metadata: { schemaVersion: '2' },
          },
        ],
      );
    });
  });

  void it('old storeSubscriptionCheckpoint FAILS with not existing procedure', async () => {
    // Given
    // When
    await runSQLMigrations(pool, [
      ...migrations_0_36_0,
      ...migrations_0_38_7,
      ...migrations_0_42_0,
      ...migrations_0_43_0,
    ]);

    // Then
    await assertThrowsAsync<InvalidOperationError>(
      () =>
        // When
        storeSubscriptionCheckpoint(pool.execute, {
          subscriptionId: 'test-processor',
          position: 10n,
          checkPosition: null,
        }),
      (error: InvalidOperationError) => {
        return (
          error.message.startsWith('function store_subscription_checkpoint') &&
          error.message.endsWith('does not exist') &&
          error.innerError instanceof Error &&
          'code' in error.innerError &&
          error.innerError.code === '42883'
        );
      },
    );
  });

  type AppendedStream = {
    streamId: string;
    lastGlobalPosition: bigint;
    lastCheckpoint: ProcessorCheckpoint;
  };

  const assertCanAppendAndRead = async (): Promise<{
    shoppingCart: AppendedStream;
    order: AppendedStream;
  }> => {
    const shoppingCartId = 'cart-123';
    const itemAdded: ProductItemAdded = {
      type: 'ProductItemAdded',
      data: {
        shoppingCartId,
        productItem: { productId: 'product-456', quantity: 2 },
      },
    };
    const shoppingCartConfirmed: ShoppingCartConfirmed = {
      type: 'ShoppingCartConfirmed',
      data: {
        shoppingCartId,
      },
    };

    const shoppingCartAppend = await appendToStream(pool.execute, {
      streamId: shoppingCartId,
      streamType: 'cart',
      events: [itemAdded, shoppingCartConfirmed],
    });

    const readShoppingCartResult = await readEvents<ShoppingCartEvent>(
      pool.execute,
      { streamId: shoppingCartId },
    );

    assertTrue(readShoppingCartResult.streamExists);
    assertDeepEqual(readShoppingCartResult.currentStreamVersion, 2n);
    assertDeepEqual(readShoppingCartResult.events.length, 2);
    assertMatches(readShoppingCartResult.events[0], itemAdded);
    assertMatches(readShoppingCartResult.events[1], shoppingCartConfirmed);

    const orderId = `order-${shoppingCartId}`;

    const orderInitiated: OrderInitiated = {
      type: 'OrderInitiated',
      data: {
        shoppingCartId: 'cart-123',
        orderId,
      },
    };
    const orderAppend = await appendToStream(pool.execute, {
      streamId: orderId,
      streamType: 'order',
      events: [orderInitiated],
    });

    const readOrderResult = await readEvents<OrderInitiated>(pool.execute, {
      streamId: orderId,
    });

    assertTrue(readOrderResult.streamExists);
    assertDeepEqual(readOrderResult.currentStreamVersion, 1n);
    assertDeepEqual(readOrderResult.events.length, 1);
    assertMatches(readOrderResult.events[0], orderInitiated);

    const shoppingCartLastGlobalPosition =
      shoppingCartAppend.globalPositions[
        shoppingCartAppend.globalPositions.length - 1
      ]!;
    const orderLastGlobalPosition = orderAppend.globalPositions[0]!;

    return {
      shoppingCart: {
        streamId: shoppingCartId,
        lastGlobalPosition: shoppingCartLastGlobalPosition,
        lastCheckpoint: PostgreSQLEventStoreCheckpoint.toProcessorCheckpoint({
          transactionId: shoppingCartAppend.transactionId,
          globalPosition: shoppingCartLastGlobalPosition,
        }),
      },
      order: {
        streamId: orderId,
        lastGlobalPosition: orderLastGlobalPosition,
        lastCheckpoint: PostgreSQLEventStoreCheckpoint.toProcessorCheckpoint({
          transactionId: orderAppend.transactionId,
          globalPosition: orderLastGlobalPosition,
        }),
      },
    };
  };

  const assertCanStoreAndReadCheckpoints = async (
    pool: Dumbo,
    {
      shoppingCart,
      order,
    }: {
      shoppingCart: AppendedStream;
      order: AppendedStream;
    },
  ) => {
    const shoppingCartProcessorId = `processor-shopping-cart-${shoppingCart.streamId}`;

    let storeResult = await storeProcessorCheckpoint(pool.execute, {
      processorId: shoppingCartProcessorId,
      partition: undefined,
      version: 1,
      newCheckpoint: bigIntProcessorCheckpoint(1n),
      lastProcessedCheckpoint: null,
      processorInstanceId: shoppingCartProcessorId,
    });

    assertTrue(storeResult.success);
    assertDeepEqual(storeResult.newCheckpoint, bigIntProcessorCheckpoint(1n));

    storeResult = await storeProcessorCheckpoint(pool.execute, {
      processorId: shoppingCartProcessorId,
      partition: undefined,
      version: 1,
      newCheckpoint: shoppingCart.lastCheckpoint,
      lastProcessedCheckpoint: bigIntProcessorCheckpoint(1n),
      processorInstanceId: shoppingCartProcessorId,
    });

    assertTrue(storeResult.success);
    assertDeepEqual(storeResult.newCheckpoint, shoppingCart.lastCheckpoint);

    const shoppingCartCheckpoint = await readProcessorCheckpoint(pool.execute, {
      processorId: shoppingCartProcessorId,
      partition: undefined,
    });

    assertDeepEqual(
      shoppingCartCheckpoint.lastProcessedCheckpoint,
      shoppingCart.lastCheckpoint,
    );

    const orderProcessorId = `processor-order-${order.streamId}`;

    let orderCheckpoint = await readProcessorCheckpoint(pool.execute, {
      processorId: orderProcessorId,
      partition: undefined,
    });

    assertDeepEqual(orderCheckpoint, { lastProcessedCheckpoint: null });

    storeResult = await storeProcessorCheckpoint(pool.execute, {
      processorId: orderProcessorId,
      partition: undefined,
      version: 1,
      newCheckpoint: order.lastCheckpoint,
      lastProcessedCheckpoint: null,
      processorInstanceId: orderProcessorId,
    });

    assertTrue(storeResult.success);
    assertDeepEqual(storeResult.newCheckpoint, order.lastCheckpoint);

    orderCheckpoint = await readProcessorCheckpoint(pool.execute, {
      processorId: orderProcessorId,
      partition: undefined,
    });

    assertDeepEqual(
      orderCheckpoint.lastProcessedCheckpoint,
      order.lastCheckpoint,
    );
  };

  void it('new code reads old-format checkpoint and resolves transaction id', async () => {
    // Given
    await runSQLMigrations(pool, [
      ...migrations_0_36_0,
      ...migrations_0_38_7,
      ...migrations_0_42_0,
    ]);
    const result = await assertCanAppendAndRead();

    const processorId = `processor-compat-${result.shoppingCart.streamId}`;
    await storeProcessorCheckpointV042(pool.execute, {
      processorId,
      newCheckpoint: bigIntProcessorCheckpoint(
        result.shoppingCart.lastGlobalPosition,
      ),
      lastProcessedCheckpoint: null,
    });

    // When
    await runSQLMigrations(pool, migrations_0_43_0);

    const { lastProcessedCheckpoint } = await readProcessorCheckpoint(
      pool.execute,
      { processorId, partition: undefined },
    );

    // Then
    assertDeepEqual(
      lastProcessedCheckpoint,
      result.shoppingCart.lastCheckpoint,
    );
  });

  void it('new code stores checkpoint when old-format is in DB (blue-green: new→old)', async () => {
    // Given
    await runSQLMigrations(pool, [
      ...migrations_0_36_0,
      ...migrations_0_38_7,
      ...migrations_0_42_0,
      ...migrations_0_43_0,
    ]);
    const result = await assertCanAppendAndRead();

    const processorId = `processor-compat-bg-${result.shoppingCart.streamId}`;
    await insertProcessorCheckpointDirectly(pool, {
      processorId,
      lastProcessedCheckpoint: bigIntProcessorCheckpoint(
        result.shoppingCart.lastGlobalPosition,
      ),
    });

    // When
    const storeResult = await storeProcessorCheckpoint(pool.execute, {
      processorId,
      partition: undefined,
      version: 1,
      newCheckpoint: result.order.lastCheckpoint,
      lastProcessedCheckpoint: result.shoppingCart.lastCheckpoint,
      processorInstanceId: processorId,
    });

    // Then
    assertTrue(storeResult.success);
    assertDeepEqual(storeResult.newCheckpoint, result.order.lastCheckpoint);
  });

  void it('stores the first checkpoint over the processor lock placeholder after migrating from 0.42.0 schema', async () => {
    // Given
    await runSQLMigrations(pool, [
      ...migrations_0_36_0,
      ...migrations_0_38_7,
      ...migrations_0_42_0,
    ]);
    const result = await assertCanAppendAndRead();

    // When
    await runSQLMigrations(pool, migrations_0_43_0);

    const processorId = `processor-lock-placeholder-${result.shoppingCart.streamId}`;
    const lock = await tryAcquireProcessorLock(pool.execute, {
      lockKey: processorId,
      processorId,
      version: 1,
      partition: defaultTag,
      processorInstanceId: processorId,
    });
    assertTrue(lock.acquired);

    const storeResult = await storeProcessorCheckpoint(pool.execute, {
      processorId,
      partition: undefined,
      version: 1,
      newCheckpoint: result.shoppingCart.lastCheckpoint,
      lastProcessedCheckpoint: null,
      processorInstanceId: processorId,
    });

    // Then
    assertDeepEqual(storeResult, {
      success: true,
      newCheckpoint: result.shoppingCart.lastCheckpoint,
    });

    const { lastProcessedCheckpoint } = await readProcessorCheckpoint(
      pool.execute,
      { processorId, partition: undefined },
    );
    assertDeepEqual(
      lastProcessedCheckpoint,
      result.shoppingCart.lastCheckpoint,
    );
  });

  void it('old code stores checkpoint when new-format is in DB (blue-green: old→new)', async () => {
    // Given
    await runSQLMigrations(pool, [
      ...migrations_0_36_0,
      ...migrations_0_38_7,
      ...migrations_0_42_0,
      ...migrations_0_43_0,
    ]);
    const result = await assertCanAppendAndRead();
    await assertCanStoreAndReadCheckpoints(pool, result);

    const processorId = `processor-compat-old-${result.shoppingCart.streamId}`;

    await storeProcessorCheckpoint(pool.execute, {
      processorId,
      partition: undefined,
      version: 1,
      newCheckpoint: result.shoppingCart.lastCheckpoint,
      lastProcessedCheckpoint: null,
      processorInstanceId: processorId,
    });

    const rawCheckpoint = await queryRawProcessorCheckpoint(pool, processorId);
    assertTrue(
      rawCheckpoint !== null && rawCheckpoint.includes(':'),
      `Expected new-format checkpoint in DB, got: ${rawCheckpoint}`,
    );

    // When
    const storeResult = await storeProcessorCheckpointV042(pool.execute, {
      processorId,
      newCheckpoint: bigIntProcessorCheckpoint(result.order.lastGlobalPosition),
      lastProcessedCheckpoint: bigIntProcessorCheckpoint(
        result.shoppingCart.lastGlobalPosition,
      ),
    });

    // Then
    assertTrue(storeResult.success);
  });

  void it('old consumer round-trip continues to work after 0.43.0 migration upgrades stored checkpoint to new format', async () => {
    // Given: 0.42.0 schema with an old-format checkpoint already stored by old code
    await runSQLMigrations(pool, [
      ...migrations_0_36_0,
      ...migrations_0_38_7,
      ...migrations_0_42_0,
    ]);
    const result = await assertCanAppendAndRead();

    const processorId = `processor-old-roundtrip-${result.shoppingCart.streamId}`;
    await storeProcessorCheckpointV042(pool.execute, {
      processorId,
      newCheckpoint: bigIntProcessorCheckpoint(
        result.shoppingCart.lastGlobalPosition,
      ),
      lastProcessedCheckpoint: null,
    });

    // When
    await runSQLMigrations(pool, migrations_0_43_0);

    // Then
    const { lastProcessedCheckpoint: afterMigration } =
      await readProcessorCheckpointV042(pool.execute, {
        processorId,
        partition: undefined,
      });

    assertTrue(afterMigration !== null);
    assertTrue(
      afterMigration!.includes(':'),
      `Expected new-format checkpoint after migration, got: ${afterMigration}`,
    );

    // And
    const advanced = await storeProcessorCheckpointV042(pool.execute, {
      processorId,
      newCheckpoint: bigIntProcessorCheckpoint(result.order.lastGlobalPosition),
      lastProcessedCheckpoint: afterMigration,
    });

    assertTrue(advanced.success);

    // And
    const { lastProcessedCheckpoint: afterAdvance } =
      await readProcessorCheckpointV042(pool.execute, {
        processorId,
        partition: undefined,
      });

    assertDeepEqual(
      afterAdvance,
      bigIntProcessorCheckpoint(result.order.lastGlobalPosition),
    );

    // And: the round-trip keeps working on subsequent cycles
    const shoppingCartConfirmedAgain: ShoppingCartConfirmed = {
      type: 'ShoppingCartConfirmed',
      data: { shoppingCartId: result.shoppingCart.streamId },
    };
    const nextAppend = await appendToStream(pool.execute, {
      streamId: `cart-next-${result.shoppingCart.streamId}`,
      streamType: 'cart',
      events: [shoppingCartConfirmedAgain],
    });
    const nextGlobalPosition = nextAppend.globalPositions[0]!;

    const advancedAgain = await storeProcessorCheckpointV042(pool.execute, {
      processorId,
      newCheckpoint: bigIntProcessorCheckpoint(nextGlobalPosition),
      lastProcessedCheckpoint: afterAdvance,
    });

    assertTrue(advancedAgain.success);

    const { lastProcessedCheckpoint: final } =
      await readProcessorCheckpointV042(pool.execute, {
        processorId,
        partition: undefined,
      });

    assertDeepEqual(final, bigIntProcessorCheckpoint(nextGlobalPosition));
  });

  void it('legacy reader returns new-format checkpoint verbatim without throwing', async () => {
    // Given
    await runSQLMigrations(pool, [
      ...migrations_0_36_0,
      ...migrations_0_38_7,
      ...migrations_0_42_0,
      ...migrations_0_43_0,
    ]);
    const result = await assertCanAppendAndRead();

    const processorId = `processor-legacy-read-${result.shoppingCart.streamId}`;
    await insertProcessorCheckpointDirectly(pool, {
      processorId,
      lastProcessedCheckpoint: result.shoppingCart.lastCheckpoint,
    });

    // When
    const { lastProcessedCheckpoint } = await readProcessorCheckpointV042(
      pool.execute,
      { processorId, partition: undefined },
    );

    // Then
    assertDeepEqual(
      lastProcessedCheckpoint,
      result.shoppingCart.lastCheckpoint,
    );
  });

  const insertProcessorCheckpointDirectly = (
    pool: Dumbo,
    {
      processorId,
      lastProcessedCheckpoint,
    }: { processorId: string; lastProcessedCheckpoint: string },
  ) =>
    pool.execute.command(
      SQL`INSERT INTO emt_processors (processor_id, version, last_processed_checkpoint, last_processed_transaction_id, partition, created_at, last_updated)
          VALUES (${processorId}, 1, ${lastProcessedCheckpoint}, pg_current_xact_id(), ${defaultTag}, now(), now())`,
    );

  const queryRawProcessorCheckpoint = async (
    pool: Dumbo,
    processorId: string,
  ): Promise<string | null> => {
    const result = await pool.execute.query<{
      last_processed_checkpoint: string;
    }>(
      SQL`SELECT last_processed_checkpoint FROM emt_processors WHERE processor_id = ${processorId} LIMIT 1`,
    );
    return result.rows[0]?.last_processed_checkpoint ?? null;
  };
});
