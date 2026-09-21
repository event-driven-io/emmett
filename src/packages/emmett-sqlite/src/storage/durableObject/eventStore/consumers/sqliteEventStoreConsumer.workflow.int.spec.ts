import type { DurableObjectStorage } from '@cloudflare/workers-types';
import { JSONSerializer } from '@event-driven-io/dumbo';
import { cloudflareDurableObjectSQLitePool } from '@event-driven-io/dumbo/cloudflare';
import {
  assertEqual,
  assertThatArray,
  WorkflowHandler,
  workflowOutputHandler,
  workflowStreamName,
  type WorkflowOptions,
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
  type CheckOut,
  type GroupCheckout,
  type GroupCheckoutInput,
  type GroupCheckoutOutput,
  type GuestCheckedOut,
} from '../../../../testing/groupCheckout.domain';
import { createEventStoreSchema } from '../../../../eventStore/schema';
import {
  getSQLiteEventStore,
  type SQLiteEventStore,
} from '../../../../eventStore/SQLiteEventStore';
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

const handleWorkflow = WorkflowHandler(workflowProcessorOptions);

void describe('SQLite event store workflow processor', () => {
  let storage: DurableObjectStorage;
  let config: DurableObjectEventStoreOptions;
  let eventStore: SQLiteEventStore;

  aroundEach(async (runTest) => {
    const stub = env.TEST_OBJECT.get(env.TEST_OBJECT.newUniqueId());

    await runInDurableObject(stub, async (_instance, state) => {
      storage = state.storage;
      config = {
        driver: durableObjectEventStoreDriver,
        schema: {
          autoMigration: 'None',
        },
        storage,
      };
      eventStore = getSQLiteEventStore(config);

      try {
        await createEventStoreSchema({
          pool: cloudflareDurableObjectSQLitePool({
            storage,
            serialization: { serializer: JSONSerializer },
          }),
        });
        await runTest();
      } finally {
        await eventStore.close();
      }
    });
  });

  void it(
    'processes InitiateGroupCheckout and produces GroupCheckoutInitiated and CheckOut messages',
    withDeadline,
    async () => {
      const groupCheckoutId = uuid();
      const guestStayAccountIds = [uuid(), uuid()];
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
        ...workflowProcessorOptions,
        separateInputInboxFromProcessing: true,
        stopAfter: (message) =>
          message.type === 'GroupCheckoutInitiated' &&
          message.data.groupCheckoutId === groupCheckoutId,
      });

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

        const { events } = await eventStore.readStream(
          workflowStreamName({
            workflowName: 'GroupCheckoutWorkflow',
            workflowId: groupCheckoutId,
          }),
        );

        assertThatArray(events).isNotEmpty();
        // First stored message is the input with prefixed type
        assertEqual(
          events[0]!.type,
          'GroupCheckoutWorkflow:InitiateGroupCheckout',
        );
        assertEqual(events[1]!.type, 'GroupCheckoutInitiated');
        assertEqual(events[2]!.type, 'CheckOut');
        assertEqual(events[3]!.type, 'CheckOut');
      } finally {
        await consumer.close();
      }
    },
  );

  void it(
    'completes group checkout after all guests check out',
    withDeadline,
    async () => {
      const groupCheckoutId = uuid();
      const guestId = uuid();
      const now = new Date();

      // Step 1: Initiate the group checkout directly via WorkflowHandler
      await handleWorkflow(eventStore, {
        type: 'InitiateGroupCheckout',
        data: {
          groupCheckoutId,
          clerkId: 'clerk-1',
          guestStayAccountIds: [guestId],
          now,
        },
      });

      // Step 2: Guest checks out, completing the group checkout
      const completeConsumer = sqliteEventStoreConsumer({
        driver: durableObjectEventStoreDriver,
        storage,
      });

      completeConsumer.workflowProcessor<
        GroupCheckoutInput,
        GroupCheckout,
        GroupCheckoutOutput
      >({
        ...workflowProcessorOptions,
        separateInputInboxFromProcessing: true,
        processorId: `workflow-${groupCheckoutId}-complete`,
        stopAfter: (message) =>
          message.type === 'GroupCheckoutCompleted' &&
          message.data.groupCheckoutId === groupCheckoutId,
      });

      try {
        const completePromise = completeConsumer.start();

        await eventStore.appendToStream(`guestStay-${guestId}`, [
          {
            type: 'GuestCheckedOut',
            data: {
              guestStayAccountId: guestId,
              checkedOutAt: now,
              groupCheckoutId,
            },
          },
        ]);

        await completePromise;

        const { events } = await eventStore.readStream(
          workflowStreamName({
            workflowName: 'GroupCheckoutWorkflow',
            workflowId: groupCheckoutId,
          }),
        );

        const eventTypes = events.map((e) => e.type);
        assertThatArray(eventTypes).containsElements([
          'GroupCheckoutWorkflow:InitiateGroupCheckout',
          'GroupCheckoutInitiated',
          'GroupCheckoutWorkflow:GuestCheckedOut',
          'GroupCheckoutCompleted',
        ]);
      } finally {
        await completeConsumer.close();
      }
    },
  );

  void it(
    'ignores messages when getWorkflowId returns null',
    withDeadline,
    async () => {
      const guestId = uuid();
      const nonExistentStreamId = uuid();

      const consumer = sqliteEventStoreConsumer({
        driver: durableObjectEventStoreDriver,
        storage,
      });

      consumer.workflowProcessor<
        GroupCheckoutInput,
        GroupCheckout,
        GroupCheckoutOutput
      >({
        ...workflowProcessorOptions,
        getWorkflowId: () => null,
        stopAfter: (message) =>
          message.type === 'GuestCheckedOut' &&
          message.data.guestStayAccountId === guestId,
      });

      try {
        const consumerPromise = consumer.start();

        await eventStore.appendToStream(`guestStay-${guestId}`, [
          {
            type: 'GuestCheckedOut',
            data: {
              guestStayAccountId: guestId,
              checkedOutAt: new Date(),
            },
          },
        ]);

        await consumerPromise;

        // No workflow stream should have been created
        const { events } = await eventStore.readStream(nonExistentStreamId);
        assertThatArray(events).isEmpty();
      } finally {
        await consumer.close();
      }
    },
  );

  void it(
    'processes messages directly in regular mode (separateInputInboxFromProcessing: false)',
    withDeadline,
    async () => {
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
        ...workflowProcessorOptions,
        separateInputInboxFromProcessing: false,
        stopAfter: (message) =>
          message.type === 'InitiateGroupCheckout' &&
          message.data.groupCheckoutId === groupCheckoutId,
      });

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

        const { events } = await eventStore.readStream(
          workflowStreamName({
            workflowName: 'GroupCheckoutWorkflow',
            workflowId: groupCheckoutId,
          }),
        );

        assertThatArray(events).isNotEmpty();
        // In regular mode, input IS stored with workflow prefix, but together with outputs
        // This is the single-operation: input + outputs appended together
        assertEqual(
          events[0]!.type,
          'GroupCheckoutWorkflow:InitiateGroupCheckout',
        );
        assertEqual(events[1]!.type, 'GroupCheckoutInitiated');
        assertEqual(events[2]!.type, 'CheckOut');

        // Verify we got all messages in one operation (NOT double-hop)
        assertThatArray(events).hasSize(3);
      } finally {
        await consumer.close();
      }
    },
  );

  void it(
    'stores input first then processes in double-hop mode (separateInputInboxFromProcessing: true)',
    withDeadline,
    async () => {
      const groupCheckoutId = uuid();
      const guestStayAccountIds = [uuid(), uuid()];
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
        ...workflowProcessorOptions,
        separateInputInboxFromProcessing: true,
        stopAfter: (message) =>
          message.type === 'GroupCheckoutInitiated' &&
          message.data.groupCheckoutId === groupCheckoutId,
      });

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

        const { events } = await eventStore.readStream(
          workflowStreamName({
            workflowName: 'GroupCheckoutWorkflow',
            workflowId: groupCheckoutId,
          }),
        );

        assertThatArray(events).isNotEmpty();
        // In double-hop mode, first message should be the prefixed input
        assertEqual(
          events[0]!.type,
          'GroupCheckoutWorkflow:InitiateGroupCheckout',
        );
        // Then the workflow outputs
        assertEqual(events[1]!.type, 'GroupCheckoutInitiated');
        assertEqual(events[2]!.type, 'CheckOut');
        assertEqual(events[3]!.type, 'CheckOut');
      } finally {
        await consumer.close();
      }
    },
  );

  void it(
    'completes group checkout when GuestCheckedOut arrives on external stream',
    withDeadline,
    async () => {
      const groupCheckoutId = uuid();
      const guestStayAccountId = uuid();
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
        ...workflowProcessorOptions,
        separateInputInboxFromProcessing: true,
        stopAfter: (message) =>
          message.type === 'GroupCheckoutCompleted' &&
          message.data.groupCheckoutId === groupCheckoutId,
      });

      try {
        const consumerPromise = consumer.start();

        await eventStore.appendToStream(`groupCheckout-${groupCheckoutId}`, [
          {
            type: 'InitiateGroupCheckout',
            data: {
              groupCheckoutId,
              clerkId: 'clerk-1',
              guestStayAccountIds: [guestStayAccountId],
              now,
            },
          },
        ]);

        await eventStore.appendToStream(`guestStay-${guestStayAccountId}`, [
          {
            type: 'GuestCheckedOut',
            data: {
              guestStayAccountId,
              checkedOutAt: now,
              groupCheckoutId,
            },
          },
        ]);

        await consumerPromise;

        const { events } = await eventStore.readStream(
          workflowStreamName({
            workflowName: 'GroupCheckoutWorkflow',
            workflowId: groupCheckoutId,
          }),
        );

        const eventTypes = events.map((e) => e.type);
        assertThatArray(eventTypes).containsElements([
          'GroupCheckoutWorkflow:InitiateGroupCheckout',
          'GroupCheckoutInitiated',
          'GroupCheckoutWorkflow:GuestCheckedOut',
          'GroupCheckoutCompleted',
        ]);
      } finally {
        await consumer.close();
      }
    },
  );

  void it(
    'completes group checkout when output handler returns input message tagged for decide',
    withDeadline,
    async () => {
      const groupCheckoutId = uuid();
      const guestStayAccountId = uuid();
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
        ...workflowProcessorOptions,
        separateInputInboxFromProcessing: true,
        outputHandler: workflowOutputHandler<
          GroupCheckoutInput,
          GroupCheckoutOutput,
          GroupCheckoutOutput
        >({
          canHandle: ['CheckOut'],
          eachMessage: (msg): GuestCheckedOut => {
            const checkOut = msg as unknown as CheckOut;
            return {
              type: 'GuestCheckedOut',
              data: {
                guestStayAccountId: checkOut.data.guestStayAccountId,
                checkedOutAt: now,
                groupCheckoutId: checkOut.data.groupCheckoutId,
              },
            };
          },
        }),
        stopAfter: (message) => {
          return (
            message.type === 'GroupCheckoutCompleted' &&
            (message as unknown as { data: { groupCheckoutId: string } }).data
              .groupCheckoutId === groupCheckoutId
          );
        },
      });

      try {
        const consumerPromise = consumer.start();

        await eventStore.appendToStream(`groupCheckout-${groupCheckoutId}`, [
          {
            type: 'InitiateGroupCheckout',
            data: {
              groupCheckoutId,
              clerkId: 'clerk-1',
              guestStayAccountIds: [guestStayAccountId],
              now,
            },
          },
        ]);

        await consumerPromise;

        const { events } = await eventStore.readStream(
          workflowStreamName({
            workflowName: 'GroupCheckoutWorkflow',
            workflowId: groupCheckoutId,
          }),
        );

        const eventTypes = events.map((e) => e.type);
        assertThatArray(eventTypes).containsElements([
          'GroupCheckoutWorkflow:InitiateGroupCheckout',
          'GroupCheckoutInitiated',
          'CheckOut',
          'GuestCheckedOut',
          'GroupCheckoutWorkflow:GuestCheckedOut',
          'GroupCheckoutCompleted',
        ]);
      } finally {
        await consumer.close();
      }
    },
  );

  void it(
    'processes external events in double-hop mode after storing with prefix',
    withDeadline,
    async () => {
      const groupCheckoutId = uuid();
      const guestId = uuid();
      const now = new Date();

      await handleWorkflow(eventStore, {
        type: 'InitiateGroupCheckout',
        data: {
          groupCheckoutId,
          clerkId: 'clerk-1',
          guestStayAccountIds: [guestId],
          now,
        },
      });

      const consumer = sqliteEventStoreConsumer({
        driver: durableObjectEventStoreDriver,
        storage,
      });

      consumer.workflowProcessor<
        GroupCheckoutInput,
        GroupCheckout,
        GroupCheckoutOutput
      >({
        ...workflowProcessorOptions,
        separateInputInboxFromProcessing: true,
        stopAfter: (message) =>
          message.type === 'GroupCheckoutCompleted' &&
          message.data.groupCheckoutId === groupCheckoutId,
      });

      try {
        const consumerPromise = consumer.start();

        await eventStore.appendToStream(`guestStay-${guestId}`, [
          {
            type: 'GuestCheckedOut',
            data: {
              guestStayAccountId: guestId,
              checkedOutAt: now,
              groupCheckoutId,
            },
          },
        ]);

        await consumerPromise;

        const { events } = await eventStore.readStream(
          workflowStreamName({
            workflowName: 'GroupCheckoutWorkflow',
            workflowId: groupCheckoutId,
          }),
        );

        const eventTypes = events.map((e) => e.type);
        // Verify both prefixed inputs are stored
        assertThatArray(eventTypes).containsElements([
          'GroupCheckoutWorkflow:InitiateGroupCheckout',
          'GroupCheckoutInitiated',
          'GroupCheckoutWorkflow:GuestCheckedOut',
          'GroupCheckoutCompleted',
        ]);

        // Verify the prefixed messages appear before their corresponding outputs
        const initiateIndex = eventTypes.indexOf(
          'GroupCheckoutWorkflow:InitiateGroupCheckout',
        );
        const initiatedIndex = eventTypes.indexOf('GroupCheckoutInitiated');
        assertEqual(
          initiateIndex < initiatedIndex,
          true,
          'Prefixed input should appear before its output',
        );

        const guestCheckedOutIndex = eventTypes.indexOf(
          'GroupCheckoutWorkflow:GuestCheckedOut',
        );
        const completedIndex = eventTypes.indexOf('GroupCheckoutCompleted');
        assertEqual(
          guestCheckedOutIndex < completedIndex,
          true,
          'Prefixed external input should appear before completion output',
        );
      } finally {
        await consumer.close();
      }
    },
  );
});
