import { JSONSerializer } from '@event-driven-io/dumbo';
import { sqlite3Pool } from '@event-driven-io/dumbo/sqlite3';
import {
  EmmettError,
  type Event,
  assertDeepEqual,
  assertEqual,
  assertTrue,
  WorkflowHandler,
  workflowStreamName,
  type WorkflowOptions,
} from '@event-driven-io/emmett';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';
import { afterEach, beforeEach, describe, it } from 'vitest';
import {
  sqlite3EventStoreDriver,
  type SQLite3EventStoreOptions,
} from '../../../../sqlite3';
import {
  GroupCheckoutWorkflow,
  type GroupCheckout,
  type GroupCheckoutInput,
  type GroupCheckoutOutput,
} from '../../../../testing/groupCheckout.domain';
import { deleteSQLiteDatabaseFiles } from '../../testing/sqliteTestDatabase';
import { createEventStoreSchema } from '../../../../eventStore/schema';
import {
  getSQLiteEventStore,
  type SQLiteEventStore,
} from '../../../../eventStore/SQLiteEventStore';
import { readProcessorCheckpoint } from '../../../../eventStore/schema/readProcessorCheckpoint';
import { sqliteEventStoreConsumer } from '../../../../eventStore/consumers/sqliteEventStoreConsumer';

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

const handleWorkflowWithSeparateInbox = WorkflowHandler({
  ...workflowProcessorOptions,
  separateInputInboxFromProcessing: true,
});

void describe('SQLite processor transaction handling', () => {
  const testDatabasePath = path.dirname(fileURLToPath(import.meta.url));
  const fileName = path.resolve(testDatabasePath, `transactions_test.db`);

  const config: SQLite3EventStoreOptions = {
    driver: sqlite3EventStoreDriver,
    schema: { autoMigration: 'None' },
    fileName,
  };

  let eventStore: SQLiteEventStore;

  beforeEach(() => {
    eventStore = getSQLiteEventStore(config);
    return createEventStoreSchema({
      pool: sqlite3Pool({ fileName, serializer: JSONSerializer }),
    });
  });

  afterEach(async () => {
    await eventStore.close();
    deleteSQLiteDatabaseFiles(fileName);
  });

  void it(
    'gives every processor a message store bound to its own transaction',
    withDeadline,
    async () => {
      // Given
      const groupCheckoutId = uuid();
      const guestStayAccountIds = [uuid()];
      const now = new Date();

      const consumer = sqliteEventStoreConsumer({
        driver: sqlite3EventStoreDriver,
        fileName,
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

      const reactionStream = `reaction-${groupCheckoutId}`;
      const reactorMessageStores: boolean[] = [];

      consumer.reactor({
        processorId: `reactor-${groupCheckoutId}`,
        canHandle: ['GroupCheckoutInitiated'],
        stopAfter: (message) => message.type === 'GroupCheckoutInitiated',
        eachMessage: async (_message, context) => {
          reactorMessageStores.push('messageStore' in context.session);

          await context.session.messageStore.appendToStream(reactionStream, [
            { type: 'GuestCheckedOut', data: { guestId: groupCheckoutId } },
          ]);
        },
      });

      // When
      try {
        const consumerPromise = consumer.start();

        await handleWorkflowWithSeparateInbox(eventStore, {
          type: 'InitiateGroupCheckout',
          kind: 'Command',
          data: {
            groupCheckoutId,
            clerkId: 'clerk-1',
            guestStayAccountIds,
            now,
          },
        });

        await consumerPromise;
      } finally {
        await consumer.close();
      }

      // Then
      assertEqual(1, reactorMessageStores.length);
      assertTrue(reactorMessageStores[0]!);

      const reaction = await eventStore.readStream(reactionStream);
      assertEqual(1, reaction.events.length);
      assertEqual('GuestCheckedOut', reaction.events[0]!.type);

      const { events } = await eventStore.readStream(
        workflowStreamName({
          workflowName: 'GroupCheckoutWorkflow',
          workflowId: groupCheckoutId,
        }),
      );
      assertEqual('GroupCheckoutInitiated', events[1]!.type);
    },
  );

  void it(
    'rolls back the whole batch and keeps the checkpoint before it when a handler throws',
    withDeadline,
    async () => {
      // Given
      const id = uuid();
      const processorId = `failing-${id}`;
      const succeededStream = `succeeded-${id}`;
      const failedStream = `failed-${id}`;

      const pool = sqlite3Pool({ fileName, serializer: JSONSerializer });
      const consumer = sqliteEventStoreConsumer({
        driver: sqlite3EventStoreDriver,
        fileName,
      });

      consumer.reactor<Event<'Triggered', { fail: boolean }>>({
        processorId,
        canHandle: ['Triggered'],
        eachMessage: async (message, context) => {
          const failing = message.data.fail;

          await context.session.messageStore.appendToStream(
            failing ? failedStream : succeededStream,
            [{ type: 'SideEffect', data: {} }],
          );

          if (failing) throw new EmmettError('handler failed');
        },
      });

      await eventStore.appendToStream(`trigger-${id}`, [
        { type: 'Triggered', data: { fail: false } },
        { type: 'Triggered', data: { fail: true } },
      ]);

      // When
      try {
        await consumer.start();
      } finally {
        await consumer.close();
      }

      // Then
      try {
        const checkpoint = await readProcessorCheckpoint(pool.execute, {
          processorId,
        });
        assertEqual(null, checkpoint.lastProcessedCheckpoint);
        assertEqual(
          0,
          (await eventStore.readStream(succeededStream)).events.length,
        );
        assertEqual(
          0,
          (await eventStore.readStream(failedStream)).events.length,
        );
      } finally {
        await pool.close();
      }
    },
  );
  void it(
    'handles the rolled back batch again when the consumer starts again',
    withDeadline,
    async () => {
      // Given
      const id = uuid();
      const reactionsStream = `reactions-${id}`;
      let failed = false;

      const consumer = sqliteEventStoreConsumer({
        driver: sqlite3EventStoreDriver,
        fileName,
      });

      consumer.reactor<Event<'Triggered', { id: string; fail: boolean }>>({
        processorId: `restarted-${id}`,
        canHandle: ['Triggered'],
        stopAfter: (message) => message.data.id === id && message.data.fail,
        eachMessage: async (message, context) => {
          if (message.data.id !== id) return;

          await context.session.messageStore.appendToStream(reactionsStream, [
            { type: 'Reacted', data: { fail: message.data.fail } },
          ]);

          if (message.data.fail && !failed) {
            failed = true;
            throw new EmmettError('handler failed');
          }
        },
      });

      await eventStore.appendToStream(`trigger-${id}`, [
        { type: 'Triggered', data: { id, fail: false } },
        { type: 'Triggered', data: { id, fail: true } },
      ]);

      // When
      try {
        await consumer.start();
        await consumer.start();
      } finally {
        await consumer.close();
      }

      // Then
      const { events } = await eventStore.readStream(reactionsStream);
      assertDeepEqual(
        events.map(({ data }) => data),
        [{ fail: false }, { fail: true }],
      );
    },
  );
  void it(
    'releases the database lock between the attempts of a retried batch',
    withDeadline,
    async () => {
      // Given
      const id = uuid();
      const sideEffectStream = `side-effect-${id}`;
      const concurrentStream = `concurrent-${id}`;
      let attempts = 0;
      let attemptsWhenConcurrentAppendFinished: number | undefined;

      const consumer = sqliteEventStoreConsumer({
        driver: sqlite3EventStoreDriver,
        fileName,
        processorDefaults: {
          retry: { retries: 2, minTimeout: 1000, factor: 1 },
        },
      });

      consumer.reactor<Event<'Triggered', { id: string }>>({
        processorId: `retried-${id}`,
        canHandle: ['Triggered'],
        stopAfter: (message) => message.data.id === id,
        eachMessage: async (message, context) => {
          if (message.data.id !== id) return;
          attempts++;

          await context.session.messageStore.appendToStream(sideEffectStream, [
            { type: 'SideEffect', data: { attempt: attempts } },
          ]);

          if (attempts === 1) throw new EmmettError('broker is down');
        },
      });

      // When
      try {
        const consuming = consumer.start();

        await eventStore.appendToStream(`trigger-${id}`, [
          { type: 'Triggered', data: { id } },
        ]);

        while (attempts < 1) await new Promise((r) => setTimeout(r, 10));

        await eventStore.appendToStream(concurrentStream, [
          { type: 'Concurrent', data: {} },
        ]);
        attemptsWhenConcurrentAppendFinished = attempts;

        await consuming;
      } finally {
        await consumer.close();
      }

      // Then
      assertEqual(1, attemptsWhenConcurrentAppendFinished);
      assertEqual(2, attempts);
      assertDeepEqual(
        (await eventStore.readStream(sideEffectStream)).events.map(
          ({ data }) => data,
        ),
        [{ attempt: 2 }],
      );
    },
  );
});
