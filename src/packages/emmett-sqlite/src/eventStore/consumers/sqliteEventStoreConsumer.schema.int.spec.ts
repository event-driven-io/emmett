import { count, SQL, SQLTableReference } from '@event-driven-io/dumbo';
import {
  sqlite3Pool,
  tableExists,
  type SQLite3Connection,
  type SQLitePool,
} from '@event-driven-io/dumbo/sqlite3';
import {
  assertDeepEqual,
  assertEqual,
  assertFalse,
  assertIsNotNull,
  workflowStreamName,
  type Event,
  type WorkflowOptions,
} from '@event-driven-io/emmett';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';
import { afterEach, beforeEach, describe, it } from 'vitest';
import { sqlite3EventStoreDriver } from '../../sqlite3';
import {
  GroupCheckoutWorkflow,
  type GroupCheckout,
  type GroupCheckoutInput,
  type GroupCheckoutOutput,
} from '../../testing/groupCheckout.domain';
import { deleteSQLiteDatabaseFiles } from '../../testing/sqliteTestDatabase';
import { getSQLiteEventStore } from '../SQLiteEventStore';
import { readProcessorCheckpoint } from '../schema';
import { messagesTable, processorsTable } from '../schema/typing';
import { sqliteEventStoreConsumer } from './sqliteEventStoreConsumer';

const withDeadline = { timeout: 30000 };

const workflowProcessorOptions: WorkflowOptions<
  GroupCheckoutInput,
  GroupCheckout,
  GroupCheckoutOutput
> = {
  workflow: GroupCheckoutWorkflow,
  getWorkflowId: (input) =>
    (input.data as { groupCheckoutId?: string }).groupCheckoutId ?? null,
  inputs: {
    commands: ['InitiateGroupCheckout', 'TimeoutGroupCheckout'],
    events: ['GuestCheckedOut', 'GuestCheckoutFailed'],
  },
  outputs: {
    commands: ['CheckOut'],
    events: [
      'GroupCheckoutCompleted',
      'GroupCheckoutFailed',
      'GroupCheckoutTimedOut',
    ],
  },
};

void describe('SQLite event store consumer schema configuration', () => {
  const testDatabasePath = path.dirname(fileURLToPath(import.meta.url));
  const fileName = path.resolve(testDatabasePath, 'consumer-schema.db');
  const databaseSchemaName = 'events';

  let pool: SQLitePool<SQLite3Connection>;

  beforeEach(() => {
    pool = sqlite3Pool({
      fileName,
      transactionOptions: {
        allowNestedTransactions: true,
      },
    });
  });

  afterEach(async () => {
    await pool.close();
    deleteSQLiteDatabaseFiles(fileName);
  });

  void it(
    'keeps processor checkpoints in the configured event-store schema',
    withDeadline,
    async () => {
      const processorId = `processor:${uuid()}`;
      const eventStore = getSQLiteEventStore({
        driver: sqlite3EventStoreDriver,
        fileName,
        schema: { autoMigration: 'CreateOrUpdate', databaseSchemaName },
      });
      const consumer = eventStore.consumer<GuestStayEvent>({
        stopWhen: { noMessagesLeft: true },
      });
      consumer.reactor({
        processorId,
        canHandle: ['GuestCheckedIn'],
        eachMessage: () => {},
      });

      await eventStore.appendToStream(`guestStay-${uuid()}`, [
        { type: 'GuestCheckedIn', data: { guestId: uuid() } },
      ]);
      try {
        await consumer.start();
      } finally {
        await consumer.close();
        await eventStore.close();
      }

      const { lastProcessedCheckpoint } = await readProcessorCheckpoint(
        pool.execute,
        { processorId, databaseSchemaName },
      );

      assertIsNotNull(lastProcessedCheckpoint);
      assertFalse(await tableExists(pool.execute, processorsTable.name));
    },
  );

  void it(
    'keeps messages stored by workflow processors in the configured event-store schema',
    withDeadline,
    async () => {
      const groupCheckoutId = uuid();
      const eventStore = getSQLiteEventStore({
        driver: sqlite3EventStoreDriver,
        fileName,
        schema: { autoMigration: 'None', databaseSchemaName },
      });
      await eventStore.schema.migrate();
      await eventStore.appendToStream(`groupCheckout-${groupCheckoutId}`, [
        initiateGroupCheckout(groupCheckoutId),
      ]);

      const consumer = eventStore.consumer();
      consumer.workflowProcessor<
        GroupCheckoutInput,
        GroupCheckout,
        GroupCheckoutOutput
      >({
        ...workflowProcessorOptions,
        separateInputInboxFromProcessing: true,
        stopAfter: (message) =>
          message.type === 'GroupCheckoutInitiated' &&
          message.data.groupCheckoutId === groupCheckoutId,
      });

      try {
        await consumer.start();
      } finally {
        await consumer.close();
        await eventStore.close();
      }

      assertDeepEqual(
        await messageTypesInStream(workflowStream(groupCheckoutId)),
        [
          'GroupCheckoutWorkflow:InitiateGroupCheckout',
          'GroupCheckoutInitiated',
          'CheckOut',
          'CheckOut',
        ],
      );
      assertFalse(await tableExists(pool.execute, messagesTable.name));
    },
  );

  void it(
    'keeps messages stored by directly created consumers in the configured event-store schema',
    withDeadline,
    async () => {
      const groupCheckoutId = uuid();
      const eventStore = getSQLiteEventStore({
        driver: sqlite3EventStoreDriver,
        fileName,
        schema: { autoMigration: 'None', databaseSchemaName },
      });
      await eventStore.schema.migrate();
      await eventStore.appendToStream(`groupCheckout-${groupCheckoutId}`, [
        initiateGroupCheckout(groupCheckoutId),
      ]);

      const consumer = sqliteEventStoreConsumer({
        driver: sqlite3EventStoreDriver,
        fileName,
        schema: { databaseSchemaName },
      });
      consumer.workflowProcessor<
        GroupCheckoutInput,
        GroupCheckout,
        GroupCheckoutOutput
      >({
        ...workflowProcessorOptions,
        separateInputInboxFromProcessing: true,
        stopAfter: (message) =>
          message.type === 'GroupCheckoutInitiated' &&
          message.data.groupCheckoutId === groupCheckoutId,
      });

      try {
        await consumer.start();
      } finally {
        await consumer.close();
        await eventStore.close();
      }

      assertDeepEqual(
        await messageTypesInStream(workflowStream(groupCheckoutId)),
        [
          'GroupCheckoutWorkflow:InitiateGroupCheckout',
          'GroupCheckoutInitiated',
          'CheckOut',
          'CheckOut',
        ],
      );
      assertFalse(await tableExists(pool.execute, messagesTable.name));
    },
  );

  void it(
    'keeps events appended through a session in the configured event-store schema',
    withDeadline,
    async () => {
      const guestId = uuid();
      const streamName = `guestStay-${guestId}`;
      const eventStore = getSQLiteEventStore({
        driver: sqlite3EventStoreDriver,
        fileName,
        schema: { autoMigration: 'CreateOrUpdate', databaseSchemaName },
      });

      try {
        await eventStore.withSession(({ eventStore }) =>
          eventStore.appendToStream(streamName, [
            { type: 'GuestCheckedIn', data: { guestId } },
          ]),
        );
      } finally {
        await eventStore.close();
      }

      assertEqual(1, await messagesInStream(streamName));
      assertFalse(await tableExists(pool.execute, messagesTable.name));
    },
  );

  void it(
    'keeps events appended through a supplied Dumbo pool in the configured event-store schema',
    withDeadline,
    async () => {
      const guestId = uuid();
      const streamName = `guestStay-${guestId}`;
      const eventStore = getSQLiteEventStore({
        driver: sqlite3EventStoreDriver,
        fileName,
        pool,
        schema: { autoMigration: 'CreateOrUpdate', databaseSchemaName },
      });

      await eventStore.appendToStream(streamName, [
        { type: 'GuestCheckedIn', data: { guestId } },
      ]);

      assertEqual(1, await messagesInStream(streamName));
      assertFalse(await tableExists(pool.execute, messagesTable.name));
    },
  );

  const initiateGroupCheckout = (groupCheckoutId: string) => ({
    type: 'InitiateGroupCheckout' as const,
    data: {
      groupCheckoutId,
      clerkId: 'clerk-1',
      guestStayAccountIds: [uuid(), uuid()],
      now: new Date(),
    },
  });

  const workflowStream = (groupCheckoutId: string): string =>
    workflowStreamName({
      workflowName: 'GroupCheckoutWorkflow',
      workflowId: groupCheckoutId,
    });

  const messageTypesInStream = async (
    streamName: string,
  ): Promise<string[]> => {
    const result = await pool.execute.query<{ message_type: string }>(
      SQL`
        SELECT message_type
        FROM ${SQLTableReference.from({
          databaseSchemaName,
          tableName: messagesTable.name,
        })}
        WHERE stream_id = ${streamName}
        ORDER BY global_position
      `,
    );

    return result.rows.map((row) => row.message_type);
  };

  const messagesInStream = (streamName: string): Promise<number> =>
    count(
      pool.execute.query<{ count: number }>(
        SQL`
          SELECT COUNT(*) AS count
          FROM ${SQLTableReference.from({
            databaseSchemaName,
            tableName: messagesTable.name,
          })}
          WHERE stream_id = ${streamName}
        `,
      ),
    );
});

type GuestCheckedIn = Event<'GuestCheckedIn', { guestId: string }>;

type GuestCheckedOut = Event<'GuestCheckedOut', { guestId: string }>;

type GuestStayEvent = GuestCheckedIn | GuestCheckedOut;
