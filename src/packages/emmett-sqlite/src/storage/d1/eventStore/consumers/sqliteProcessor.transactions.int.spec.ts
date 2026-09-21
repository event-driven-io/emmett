import { d1Pool } from '@event-driven-io/dumbo/cloudflare';
import {
  assertEqual,
  assertTrue,
  workflowStreamName,
} from '@event-driven-io/emmett';
import { Miniflare } from 'miniflare';
import { v4 as uuid } from 'uuid';
import { afterEach, beforeEach, describe, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { d1EventStoreDriver } from '../..';
import {
  GroupCheckoutWorkflow,
  type GroupCheckout,
  type GroupCheckoutInput,
  type GroupCheckoutOutput,
} from '../../../../testing/groupCheckout.domain';
import { createEventStoreSchema } from '../../../../eventStore/schema';
import {
  getSQLiteEventStore,
  type SQLiteEventStore,
} from '../../../../eventStore/SQLiteEventStore';
import { sqliteEventStoreConsumer } from '../../../../eventStore/consumers/sqliteEventStoreConsumer';

const withDeadline = { timeout: 30000 };

void describe('SQLite processor transaction handling', () => {
  let mf: Miniflare;
  let database: D1Database;
  let eventStore: SQLiteEventStore;

  beforeEach(async () => {
    mf = new Miniflare({
      modules: true,
      script: 'export default { fetch() { return new Response("ok"); } }',
      d1Databases: { DB: 'test-db-id' },
    });
    database = await mf.getD1Database('DB');
    eventStore = getSQLiteEventStore({
      driver: d1EventStoreDriver,
      schema: { autoMigration: 'None' },
      database,
    });
    await createEventStoreSchema({
      pool: d1Pool({
        database,
        transactionOptions: {
          allowNestedTransactions: true,
          mode: 'session_based',
        },
      }),
    });
  });

  afterEach(async () => {
    await eventStore.close();
    await mf.dispose();
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
        driver: d1EventStoreDriver,
        database,
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
