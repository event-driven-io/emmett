import {
  assertEqual,
  assertThatArray,
  WorkflowHandler,
  workflowOutputHandler,
  workflowStreamName,
  type WorkflowOptions,
} from '@event-driven-io/emmett';
import { beforeAll, describe, it } from 'vitest';
import { v4 as uuid } from 'uuid';
import {
  getSharedEventStoreDB,
  type SharedEventStoreDB,
} from '../../testing/sharedEventStoreDB';
import {
  GroupCheckoutWorkflow,
  type CheckOut,
  type GroupCheckout,
  type GroupCheckoutInput,
  type GroupCheckoutOutput,
  type GuestCheckedOut,
} from '../../testing/groupCheckout.domain';
import {
  getEventStoreDBEventStore,
  type EventStoreDBEventStore,
} from '../eventstoreDBEventStore';
import { eventStoreDBEventStoreConsumer } from './eventStoreDBEventStoreConsumer';

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

const newWorkflowProcessorOptions = () => ({
  ...workflowProcessorOptions,
  processorId: uuid(),
});

void describe('EventStoreDB event store workflow processor', () => {
  let eventStoreDB: SharedEventStoreDB;
  let connectionString: string;
  let eventStore: EventStoreDBEventStore;

  beforeAll(() => {
    eventStoreDB = getSharedEventStoreDB();
    connectionString = eventStoreDB.connectionString;
    eventStore = getEventStoreDBEventStore(eventStoreDB.getClient());
  });

  void it(
    'processes InitiateGroupCheckout and produces GroupCheckoutInitiated and CheckOut messages',
    withDeadline,
    async () => {
      const groupCheckoutId = uuid();
      const guestStayAccountIds = [uuid(), uuid()];
      const now = new Date();

      const consumer = eventStoreDBEventStoreConsumer({
        connectionString,
      });

      consumer.workflowProcessor<
        GroupCheckoutInput,
        GroupCheckout,
        GroupCheckoutOutput
      >({
        ...newWorkflowProcessorOptions(),
        startFrom: 'END',
        separateInputInboxFromProcessing: true,
        stopAfter: (message) =>
          message.type === 'GroupCheckoutInitiated' &&
          message.data.groupCheckoutId === groupCheckoutId,
      });

      try {
        const consumerPromise = consumer.start();
        await consumer.whenStarted();

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

      await handleWorkflow(eventStore, {
        type: 'InitiateGroupCheckout',
        data: {
          groupCheckoutId,
          clerkId: 'clerk-1',
          guestStayAccountIds: [guestId],
          now,
        },
      });

      const completeConsumer = eventStoreDBEventStoreConsumer({
        connectionString,
      });

      completeConsumer.workflowProcessor<
        GroupCheckoutInput,
        GroupCheckout,
        GroupCheckoutOutput
      >({
        ...newWorkflowProcessorOptions(),
        startFrom: 'END',
        separateInputInboxFromProcessing: true,
        processorId: `workflow-${groupCheckoutId}-complete`,
        stopAfter: (message) =>
          message.type === 'GroupCheckoutCompleted' &&
          message.data.groupCheckoutId === groupCheckoutId,
      });

      try {
        const completePromise = completeConsumer.start();
        await completeConsumer.whenStarted();

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

      const consumer = eventStoreDBEventStoreConsumer({
        connectionString,
      });

      consumer.workflowProcessor<
        GroupCheckoutInput,
        GroupCheckout,
        GroupCheckoutOutput
      >({
        ...newWorkflowProcessorOptions(),
        startFrom: 'END',
        getWorkflowId: () => null,
        stopAfter: (message) =>
          message.type === 'GuestCheckedOut' &&
          message.data.guestStayAccountId === guestId,
      });

      try {
        const consumerPromise = consumer.start();
        await consumer.whenStarted();

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

      const consumer = eventStoreDBEventStoreConsumer({
        connectionString,
      });

      consumer.workflowProcessor<
        GroupCheckoutInput,
        GroupCheckout,
        GroupCheckoutOutput
      >({
        ...newWorkflowProcessorOptions(),
        startFrom: 'END',
        separateInputInboxFromProcessing: false,
        stopAfter: (message) =>
          message.type === 'InitiateGroupCheckout' &&
          message.data.groupCheckoutId === groupCheckoutId,
      });

      try {
        const consumerPromise = consumer.start();
        await consumer.whenStarted();

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
        assertEqual(
          events[0]!.type,
          'GroupCheckoutWorkflow:InitiateGroupCheckout',
        );
        assertEqual(events[1]!.type, 'GroupCheckoutInitiated');
        assertEqual(events[2]!.type, 'CheckOut');
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

      const consumer = eventStoreDBEventStoreConsumer({
        connectionString,
      });

      consumer.workflowProcessor<
        GroupCheckoutInput,
        GroupCheckout,
        GroupCheckoutOutput
      >({
        ...newWorkflowProcessorOptions(),
        startFrom: 'END',
        separateInputInboxFromProcessing: true,
        stopAfter: (message) =>
          message.type === 'GroupCheckoutInitiated' &&
          message.data.groupCheckoutId === groupCheckoutId,
      });

      try {
        const consumerPromise = consumer.start();
        await consumer.whenStarted();

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

  (
    [
      ['the same client', true],
      ['a different client', false],
    ] as const
  ).forEach(([clientUsage, reuseClient]) => {
    void it(
      `recreated workflow consumer resumes from its persisted checkpoint using ${clientUsage}`,
      withDeadline,
      async () => {
        const groupCheckoutId = uuid();
        const guestStayAccountIds = [uuid()];
        const processorId = uuid();
        const inputStreamName = `groupCheckout-${groupCheckoutId}`;
        const now = new Date();
        const firstClient = eventStoreDB.getClient();

        const firstConsumer = eventStoreDBEventStoreConsumer({
          client: firstClient,
          from: { stream: inputStreamName },
        });
        firstConsumer.workflowProcessor<
          GroupCheckoutInput,
          GroupCheckout,
          GroupCheckoutOutput
        >({
          ...newWorkflowProcessorOptions(),
          processorId,
          startFrom: 'END',
          separateInputInboxFromProcessing: false,
          stopAfter: (message) => message.type === 'InitiateGroupCheckout',
        });

        let firstConsumerPromise: Promise<void> | undefined;
        try {
          firstConsumerPromise = firstConsumer.start();
          await firstConsumer.whenStarted();

          await eventStore.appendToStream(inputStreamName, [
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

          await firstConsumerPromise;
        } finally {
          await firstConsumer.close();
          await firstConsumerPromise;
        }

        await eventStore.appendToStream(inputStreamName, [
          {
            type: 'TimeoutGroupCheckout',
            data: {
              groupCheckoutId,
              startedAt: now,
              timeOutAt: new Date(now.getTime() + 60_000),
            },
          },
        ]);

        const recreatedConsumer = eventStoreDBEventStoreConsumer({
          client: reuseClient ? firstClient : eventStoreDB.getClient(),
          from: { stream: inputStreamName },
          until: { caughtUp: true },
        });
        recreatedConsumer.workflowProcessor<
          GroupCheckoutInput,
          GroupCheckout,
          GroupCheckoutOutput
        >({
          ...newWorkflowProcessorOptions(),
          processorId,
          separateInputInboxFromProcessing: false,
        });

        let recreatedConsumerPromise: Promise<void> | undefined;
        try {
          recreatedConsumerPromise = recreatedConsumer.start();
          await recreatedConsumer.whenCaughtUp();
          await recreatedConsumerPromise;

          const { events } = await eventStore.readStream(
            workflowStreamName({
              workflowName: 'GroupCheckoutWorkflow',
              workflowId: groupCheckoutId,
            }),
          );

          assertThatArray(
            events.map(({ type }) => type),
          ).containsOnlyElementsMatching([
            'GroupCheckoutWorkflow:InitiateGroupCheckout',
            'GroupCheckoutInitiated',
            'CheckOut',
            'GroupCheckoutWorkflow:TimeoutGroupCheckout',
            'GroupCheckoutTimedOut',
          ]);
        } finally {
          await recreatedConsumer.close();
          await recreatedConsumerPromise;
        }
      },
    );
  });

  void it(
    'completes group checkout when GuestCheckedOut arrives on external stream',
    withDeadline,
    async () => {
      const groupCheckoutId = uuid();
      const guestStayAccountId = uuid();
      const now = new Date();

      const consumer = eventStoreDBEventStoreConsumer({
        connectionString,
      });

      consumer.workflowProcessor<
        GroupCheckoutInput,
        GroupCheckout,
        GroupCheckoutOutput
      >({
        ...newWorkflowProcessorOptions(),
        startFrom: 'END',
        separateInputInboxFromProcessing: true,
        stopAfter: (message) =>
          message.type === 'GroupCheckoutCompleted' &&
          message.data.groupCheckoutId === groupCheckoutId,
      });

      try {
        const consumerPromise = consumer.start();
        await consumer.whenStarted();

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

      const consumer = eventStoreDBEventStoreConsumer({
        connectionString,
      });

      consumer.workflowProcessor<
        GroupCheckoutInput,
        GroupCheckout,
        GroupCheckoutOutput
      >({
        ...newWorkflowProcessorOptions(),
        startFrom: 'END',
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
        stopAfter: (message) =>
          message.type === 'GroupCheckoutCompleted' &&
          message.data.groupCheckoutId === groupCheckoutId,
      });

      try {
        const consumerPromise = consumer.start();
        await consumer.whenStarted();

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

      const consumer = eventStoreDBEventStoreConsumer({
        connectionString,
      });

      consumer.workflowProcessor<
        GroupCheckoutInput,
        GroupCheckout,
        GroupCheckoutOutput
      >({
        ...newWorkflowProcessorOptions(),
        startFrom: 'END',
        separateInputInboxFromProcessing: true,
        stopAfter: (message) =>
          message.type === 'GroupCheckoutCompleted' &&
          message.data.groupCheckoutId === groupCheckoutId,
      });

      try {
        const consumerPromise = consumer.start();
        await consumer.whenStarted();

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
        assertThatArray(eventTypes).containsElements([
          'GroupCheckoutWorkflow:InitiateGroupCheckout',
          'GroupCheckoutInitiated',
          'GroupCheckoutWorkflow:GuestCheckedOut',
          'GroupCheckoutCompleted',
        ]);

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
