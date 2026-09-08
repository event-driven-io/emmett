import { JSONSerializer } from '@event-driven-io/dumbo';
import { sqlite3Pool } from '@event-driven-io/dumbo/sqlite3';
import {
  assertEqual,
  assertTrue,
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
});
