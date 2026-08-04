import {
  assertEqual,
  assertThatArray,
  type RecordedMessage,
  WorkflowHandler,
  workflowOutputHandler,
  workflowStreamName,
  type Closeable,
  type WorkflowOptions,
} from '@event-driven-io/emmett';
import { MongoClient } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { v4 as uuid } from 'uuid';
import {
  sharedMongoDBDatabase,
  type SharedMongoDBDatabase,
} from '../../testing/sharedMongoDBDatabase';
import {
  GroupCheckoutWorkflow,
  type CheckOut,
  type GroupCheckout,
  type GroupCheckoutInput,
  type GroupCheckoutOutput,
  type GuestCheckedOut,
} from '../../testing/groupCheckout.domain';
import {
  getMongoDBEventStore,
  type MongoDBEventStore,
} from '../mongoDBEventStore';
import { mongoDBEventStoreConsumer } from './mongoDBEventStoreConsumer';
import type { MongoDBChangeStreamMessageMetadata } from './mongoDBEventStoreConsumer';

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
type GroupCheckoutRecordedMessage = RecordedMessage<
  GroupCheckoutInput | GroupCheckoutOutput,
  MongoDBChangeStreamMessageMetadata
>;

void describe('MongoDB event store workflow processor', () => {
  let database: SharedMongoDBDatabase;
  let connectionString: string;
  let eventStore: MongoDBEventStore & Closeable;

  beforeAll(() => {
    database = sharedMongoDBDatabase();
    connectionString = database.connectionString;
    eventStore = getMongoDBEventStore({
      connectionString,
      clientOptions: { directConnection: true },
    });
  });

  beforeEach(async () => {
    const client = new MongoClient(connectionString, {
      directConnection: true,
    });
    await client.connect();

    try {
      const db = client.db(database.databaseName);
      const collections = await db.collections();

      await Promise.all(
        collections.map((collection) => collection.deleteMany({})),
      );
    } finally {
      await client.close();
    }
  });

  afterAll(async () => {
    try {
      await eventStore?.close();
      await database?.close();
    } catch (error) {
      console.log(error);
    }
  });

  void it(
    'processes InitiateGroupCheckout and produces GroupCheckoutInitiated and CheckOut messages',
    withDeadline,
    async () => {
      const groupCheckoutId = uuid();
      const guestStayAccountIds = [uuid(), uuid()];
      const now = new Date();

      const consumer = mongoDBEventStoreConsumer({
        connectionString,
        clientOptions: { directConnection: true },
      });

      consumer.workflowProcessor<
        GroupCheckoutInput,
        GroupCheckout,
        GroupCheckoutOutput
      >({
        ...workflowProcessorOptions,
        separateInputInboxFromProcessing: true,
        stopAfter: (message: GroupCheckoutRecordedMessage) =>
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

      const completeConsumer = mongoDBEventStoreConsumer({
        connectionString,
        clientOptions: { directConnection: true },
      });

      completeConsumer.workflowProcessor<
        GroupCheckoutInput,
        GroupCheckout,
        GroupCheckoutOutput
      >({
        ...workflowProcessorOptions,
        separateInputInboxFromProcessing: true,
        processorId: `workflow-${groupCheckoutId}-complete`,
        stopAfter: (message: GroupCheckoutRecordedMessage) =>
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

      const consumer = mongoDBEventStoreConsumer({
        connectionString,
        clientOptions: { directConnection: true },
      });

      consumer.workflowProcessor<
        GroupCheckoutInput,
        GroupCheckout,
        GroupCheckoutOutput
      >({
        ...workflowProcessorOptions,
        getWorkflowId: () => null,
        stopAfter: (message: GroupCheckoutRecordedMessage) =>
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

      const consumer = mongoDBEventStoreConsumer({
        connectionString,
        clientOptions: { directConnection: true },
      });

      consumer.workflowProcessor<
        GroupCheckoutInput,
        GroupCheckout,
        GroupCheckoutOutput
      >({
        ...workflowProcessorOptions,
        separateInputInboxFromProcessing: false,
        stopAfter: (message: GroupCheckoutRecordedMessage) =>
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

      const consumer = mongoDBEventStoreConsumer({
        connectionString,
        clientOptions: { directConnection: true },
      });

      consumer.workflowProcessor<
        GroupCheckoutInput,
        GroupCheckout,
        GroupCheckoutOutput
      >({
        ...workflowProcessorOptions,
        separateInputInboxFromProcessing: true,
        stopAfter: (message: GroupCheckoutRecordedMessage) =>
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
    'completes group checkout when GuestCheckedOut arrives on external stream',
    withDeadline,
    async () => {
      const groupCheckoutId = uuid();
      const guestStayAccountId = uuid();
      const now = new Date();

      const consumer = mongoDBEventStoreConsumer({
        connectionString,
        clientOptions: { directConnection: true },
      });

      consumer.workflowProcessor<
        GroupCheckoutInput,
        GroupCheckout,
        GroupCheckoutOutput
      >({
        ...workflowProcessorOptions,
        separateInputInboxFromProcessing: true,
        stopAfter: (message: GroupCheckoutRecordedMessage) =>
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

      const consumer = mongoDBEventStoreConsumer({
        connectionString,
        clientOptions: { directConnection: true },
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
        stopAfter: (message: GroupCheckoutRecordedMessage) =>
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

      const consumer = mongoDBEventStoreConsumer({
        connectionString,
        clientOptions: { directConnection: true },
      });

      consumer.workflowProcessor<
        GroupCheckoutInput,
        GroupCheckout,
        GroupCheckoutOutput
      >({
        ...workflowProcessorOptions,
        separateInputInboxFromProcessing: true,
        stopAfter: (message: GroupCheckoutRecordedMessage) =>
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
