import type { DurableObjectStorage } from '@cloudflare/workers-types';
import { cloudflareDurableObjectSQLitePool } from '@event-driven-io/dumbo/cloudflare';
import {
  assertEqual,
  assertTrue,
  workflowStreamName,
} from '@event-driven-io/emmett';
import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { v4 as uuid } from 'uuid';
import { aroundEach, describe, it } from 'vitest';
import {
  durableObjectEventStoreDriver,
  type DurableObjectEventStoreOptions,
} from '../..';
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
  let storage: DurableObjectStorage;
  let eventStore: SQLiteEventStore;

  aroundEach(async (runTest) => {
    const stub = env.TEST_OBJECT.get(env.TEST_OBJECT.newUniqueId());

    await runInDurableObject(stub, async (_instance, state) => {
      storage = state.storage;
      const config: DurableObjectEventStoreOptions = {
        driver: durableObjectEventStoreDriver,
        schema: { autoMigration: 'None' },
        storage,
      };
      eventStore = getSQLiteEventStore(config);
      await createEventStoreSchema({
        pool: cloudflareDurableObjectSQLitePool({ storage }),
      });

      try {
        await runTest();
      } finally {
        await eventStore.close();
      }
    });
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
        driver: durableObjectEventStoreDriver,
        storage,
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
