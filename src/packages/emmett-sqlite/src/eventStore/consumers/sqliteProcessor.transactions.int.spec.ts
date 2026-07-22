import { JSONSerializer } from '@event-driven-io/dumbo';
import { sqlite3Connection } from '@event-driven-io/dumbo/sqlite3';
import {
  assertEqual,
  assertFalse,
  workflowStreamName,
} from '@event-driven-io/emmett';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';
import { afterEach, beforeEach, describe, it } from 'vitest';
import {
  sqlite3EventStoreDriver,
  type SQLite3EventStoreOptions,
} from '../../sqlite3';
import {
  GroupCheckoutWorkflow,
  type GroupCheckout,
  type GroupCheckoutInput,
  type GroupCheckoutOutput,
} from '../../testing/groupCheckout.domain';
import { deleteSQLiteDatabaseFiles } from '../../testing/sqliteTestDatabase';
import { createEventStoreSchema } from '../schema';
import {
  getSQLiteEventStore,
  type SQLiteEventStore,
} from '../SQLiteEventStore';
import { sqliteEventStoreConsumer } from './sqliteEventStoreConsumer';

const withDeadline = { timeout: 30000 };

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
    return createEventStoreSchema(
      sqlite3Connection({ fileName, serializer: JSONSerializer }),
    );
  });

  afterEach(async () => {
    await eventStore.close();
    deleteSQLiteDatabaseFiles(fileName);
  });

  void it(
    'does not leak the workflow message store onto connections of other processors',
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
        separateInputInboxFromProcessing: true,
        stopAfter: (message) =>
          message.type === 'GroupCheckoutInitiated' &&
          message.data.groupCheckoutId === groupCheckoutId,
      });

      const reactorConnectionsWithMessageStore: boolean[] = [];

      consumer.reactor({
        processorId: `reactor-${groupCheckoutId}`,
        canHandle: ['GroupCheckoutInitiated'],
        stopAfter: (message) => message.type === 'GroupCheckoutInitiated',
        eachMessage: (_message, context) => {
          reactorConnectionsWithMessageStore.push(
            'messageStore' in context.connection,
          );
        },
      });

      // When
      try {
        const consumerPromise = consumer.start();

        await eventStore.appendToStream(`groupCheckout-${groupCheckoutId}`, [
          {
            type: 'InitiateGroupCheckout',
            data: {
              groupCheckoutId,
              clerkId: 'clerk-1',
              guestStayAccountIds,
              now,
            },
          },
        ]);

        await consumerPromise;
      } finally {
        await consumer.close();
      }

      // Then
      assertEqual(1, reactorConnectionsWithMessageStore.length);
      assertFalse(reactorConnectionsWithMessageStore[0]!);

      const { events } = await eventStore.readStream(
        workflowStreamName({
          workflowName: 'GroupCheckoutWorkflow',
          workflowId: groupCheckoutId,
        }),
      );
      assertEqual('GroupCheckoutInitiated', events[1]!.type);
    },
  );
});
