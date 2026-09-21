import type { DurableObjectStorage } from '@cloudflare/workers-types';
import { count, SQL, SQLTableReference } from '@event-driven-io/dumbo';
import {
  cloudflareDurableObjectSQLitePool,
  sqliteTableName,
  tableExists,
  type CloudflareDurableObjectSQLiteConnectionPool,
} from '@event-driven-io/dumbo/cloudflare';
import {
  assertDeepEqual,
  assertEqual,
  assertFalse,
  assertIsNotNull,
  workflowStreamName,
  type Event,
  type WorkflowOptions,
} from '@event-driven-io/emmett';
import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { v4 as uuid } from 'uuid';
import { aroundEach, describe, it } from 'vitest';
import { durableObjectEventStoreDriver } from '../..';
import {
  GroupCheckoutWorkflow,
  type GroupCheckout,
  type GroupCheckoutInput,
  type GroupCheckoutOutput,
} from '../../../../testing/groupCheckout.domain';
import { getSQLiteEventStore } from '../../../../eventStore/SQLiteEventStore';
import { readProcessorCheckpoint } from '../../../../eventStore/schema';
import {
  messagesTable,
  processorsTable,
} from '../../../../eventStore/schema/typing';
import { pongoClient } from '@event-driven-io/pongo';
import { pongoSingleStreamProjection } from '../../../../eventStore/projections';
import { sqliteEventStoreConsumer } from '../../../../eventStore/consumers/sqliteEventStoreConsumer';
import { pongoDriverOf } from '../../../../eventStore/eventStoreDriver';

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
  const databaseSchemaName = 'events';

  let storage: DurableObjectStorage;
  let pool: CloudflareDurableObjectSQLiteConnectionPool;

  aroundEach(async (runTest) => {
    const stub = env.TEST_OBJECT.get(env.TEST_OBJECT.newUniqueId());

    await runInDurableObject(stub, async (_instance, state) => {
      storage = state.storage;
      pool = cloudflareDurableObjectSQLitePool({
        storage,
        transactionOptions: {
          allowNestedTransactions: true,
        },
      });

      try {
        await runTest();
      } finally {
        await pool.close();
      }
    });
  });

  void it(
    'keeps processor checkpoints in the configured event-store schema',
    withDeadline,
    async () => {
      const processorId = `processor:${uuid()}`;
      const eventStore = getSQLiteEventStore({
        driver: durableObjectEventStoreDriver,
        storage,
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
        driver: durableObjectEventStoreDriver,
        storage,
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
        driver: durableObjectEventStoreDriver,
        storage,
        schema: { autoMigration: 'None', databaseSchemaName },
      });
      await eventStore.schema.migrate();
      await eventStore.appendToStream(`groupCheckout-${groupCheckoutId}`, [
        initiateGroupCheckout(groupCheckoutId),
      ]);

      const consumer = sqliteEventStoreConsumer({
        driver: durableObjectEventStoreDriver,
        storage,
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
        driver: durableObjectEventStoreDriver,
        storage,
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
        driver: durableObjectEventStoreDriver,
        storage,
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

  void it(
    'reads events from the event-store schema and stores async Pongo projections in the projection schema',
    withDeadline,
    async () => {
      const projectionsDatabaseSchemaName = 'read_models';
      const collectionName = 'shopping_cart_summary';
      const streamName = `shopping_cart-${uuid()}`;
      const eventStore = getSQLiteEventStore({
        driver: durableObjectEventStoreDriver,
        storage,
        schema: {
          autoMigration: 'None',
          databaseSchemaName,
          projectionsDatabaseSchemaName,
        },
      });

      try {
        await eventStore.schema.migrate();
        await eventStore.appendToStream(streamName, [
          { type: 'GuestCheckedIn', data: { guestId: uuid() } },
        ]);

        const consumer = eventStore.consumer<GuestStayEvent>({
          stopWhen: { noMessagesLeft: true },
        });
        consumer.projector({
          processorId: `processor:${uuid()}`,
          projection: guestStaySummaryProjection(collectionName),
        });

        try {
          await consumer.start();
        } finally {
          await consumer.close();
        }
      } finally {
        await eventStore.close();
      }

      assertDeepEqual(
        await summaryIn(
          projectionsDatabaseSchemaName,
          collectionName,
          streamName,
        ),
        { _id: streamName, _version: 1n, checkedInCount: 1 },
      );
      assertFalse(await tableExists(pool.execute, collectionName));
      assertFalse(
        await tableExists(
          pool.execute,
          sqliteTableName({ databaseSchemaName, tableName: collectionName }),
        ),
      );
    },
  );

  const summaryIn = (
    databaseSchemaName: string,
    collectionName: string,
    streamName: string,
  ) =>
    pool.withConnection(async (connection) => {
      const driver = pongoDriverOf(durableObjectEventStoreDriver);
      const pongo = pongoClient({
        driver,
        connectionOptions: { connection },
        defaultSchemaName: databaseSchemaName,
      });
      try {
        return await pongo
          .db()
          .collection<GuestStaySummary>(collectionName)
          .findOne({ _id: streamName });
      } finally {
        await pongo.close();
      }
    });

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

type GuestStaySummary = { checkedInCount: number };

const guestStaySummaryProjection = (collectionName: string) =>
  pongoSingleStreamProjection<GuestStaySummary, GuestCheckedIn>({
    collectionName,
    canHandle: ['GuestCheckedIn'],
    evolve: (document: GuestStaySummary) => ({
      checkedInCount: document.checkedInCount + 1,
    }),
    initialState: () => ({ checkedInCount: 0 }),
  });
