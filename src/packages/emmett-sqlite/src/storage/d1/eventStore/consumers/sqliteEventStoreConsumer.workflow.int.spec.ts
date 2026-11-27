import type { D1Database } from '@cloudflare/workers-types';
import { JSONSerializer } from '@event-driven-io/dumbo';
import { d1Pool } from '@event-driven-io/dumbo/cloudflare';
import {
  assertDeepEqual,
  assertEqual,
  assertThatArray,
  WorkflowHandler,
  workflowOutputHandler,
  workflowStreamName,
  type Command,
  type Event,
  type WorkflowOptions,
} from '@event-driven-io/emmett';
import { Miniflare } from 'miniflare';
import { v4 as uuid } from 'uuid';
import { afterEach, beforeEach, describe, it } from 'vitest';
import { d1EventStoreDriver, type D1EventStoreOptions } from '../..';
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

const handleWorkflowWithSeparateInbox = WorkflowHandler({
  ...workflowProcessorOptions,
  separateInputInboxFromProcessing: true,
});

type PaymentAuthorized = Event<
  'PaymentAuthorized',
  { paymentId: string; amount: number },
  { messageId: string }
>;
type CapturePayment = Command<
  'CapturePayment',
  { paymentId: string; amount: number }
>;
type PaymentCapture = { authorizedAmount: number };

const paymentCaptureOptions: WorkflowOptions<
  PaymentAuthorized,
  PaymentCapture,
  CapturePayment
> = {
  workflow: {
    name: 'PaymentCaptureWorkflow',
    initialState: () => ({ authorizedAmount: 0 }),
    evolve: (state, { type, data }) =>
      type === 'PaymentAuthorized'
        ? { authorizedAmount: state.authorizedAmount + data.amount }
        : state,
    decide: ({ data: { paymentId, amount } }, { authorizedAmount }) => ({
      type: 'CapturePayment',
      kind: 'Command',
      data: { paymentId, amount: authorizedAmount + amount },
    }),
  },
  getWorkflowId: (input) => input.data.paymentId,
  inputs: { commands: [], events: ['PaymentAuthorized'] },
  outputs: { commands: ['CapturePayment'], events: [] },
  separateInputInboxFromProcessing: true,
};

const handlePaymentCapture = WorkflowHandler(paymentCaptureOptions);

void describe('SQLite event store workflow processor', () => {
  let mf: Miniflare;
  let database: D1Database;
  let config: D1EventStoreOptions;
  let eventStore: SQLiteEventStore;

  beforeEach(async () => {
    mf = new Miniflare({
      modules: true,
      script: 'export default { fetch() { return new Response("ok"); } }',
      d1Databases: { DB: 'test-db-id' },
    });
    database = await mf.getD1Database('DB');
    config = {
      driver: d1EventStoreDriver,
      schema: {
        autoMigration: 'None',
      },
      database,
    };
    eventStore = getSQLiteEventStore(config);
    return createEventStoreSchema({
      pool: d1Pool({
        database,
        serialization: { serializer: JSONSerializer },
        transactionOptions: { mode: 'session_based' },
      }),
    });
  });

  afterEach(async () => {
    await eventStore.close();
    await mf.dispose();
  });

  void it('ignores a message without a workflow id', withDeadline, async () => {
    const guestId = uuid();
    const nonExistentStreamId = uuid();

    const consumer = sqliteEventStoreConsumer({
      driver: d1EventStoreDriver,
      database,
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
  });

  void it(
    'appends the input and its outputs together (separateInputInboxFromProcessing: false)',
    withDeadline,
    async () => {
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
            kind: 'Command',
            data: {
              groupCheckoutId,
              clerkId: 'clerk-1',
              guestStayAccountIds,
              now,
            },
          },
        ] as unknown as Event[]);

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
        assertEqual(events[0]!.kind, 'Command');
        assertEqual(events[1]!.type, 'GroupCheckoutInitiated');
        assertEqual(events[1]!.kind, 'Event');
        assertEqual(events[2]!.type, 'CheckOut');
        assertEqual(events[2]!.kind, 'Command');

        // Verify we got all messages in one operation (NOT double-hop)
        assertThatArray(events).hasSize(3);
      } finally {
        await consumer.close();
      }
    },
  );

  void it(
    'stores the input, then appends the outputs of its decision (separateInputInboxFromProcessing: true)',
    withDeadline,
    async () => {
      const groupCheckoutId = uuid();
      const guestStayAccountIds = [uuid(), uuid()];
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
        ...workflowProcessorOptions,
        separateInputInboxFromProcessing: true,
        stopAfter: (message) =>
          message.type === 'GroupCheckoutInitiated' &&
          message.data.groupCheckoutId === groupCheckoutId,
      });

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
        assertEqual(events[0]!.kind, 'Command');
        // Then the workflow outputs
        assertEqual(events[1]!.type, 'GroupCheckoutInitiated');
        assertEqual(events[1]!.kind, 'Event');
        assertEqual(events[2]!.type, 'CheckOut');
        assertEqual(events[2]!.kind, 'Command');
        assertEqual(events[3]!.type, 'CheckOut');
        assertEqual(events[3]!.kind, 'Command');
      } finally {
        await consumer.close();
      }
    },
  );

  void it(
    'runs decide once when the same message is delivered twice (separateInputInboxFromProcessing: true)',
    withDeadline,
    async () => {
      const paymentId = uuid();
      const laterPaymentId = uuid();
      const paymentAuthorized: PaymentAuthorized = {
        type: 'PaymentAuthorized',
        data: { paymentId, amount: 100 },
        metadata: { messageId: uuid() },
      };

      const consumer = sqliteEventStoreConsumer({
        driver: d1EventStoreDriver,
        database,
      });

      consumer.workflowProcessor<
        PaymentAuthorized,
        PaymentCapture,
        CapturePayment
      >({
        ...paymentCaptureOptions,
        stopAfter: (message) => message.data.paymentId === laterPaymentId,
      });

      try {
        const consumerPromise = consumer.start();

        await handlePaymentCapture(eventStore, paymentAuthorized);
        await handlePaymentCapture(eventStore, paymentAuthorized);
        await handlePaymentCapture(eventStore, {
          type: 'PaymentAuthorized',
          data: { paymentId: laterPaymentId, amount: 100 },
          metadata: { messageId: uuid() },
        });

        await consumerPromise;

        const { events } = await eventStore.readStream(
          workflowStreamName({
            workflowName: 'PaymentCaptureWorkflow',
            workflowId: paymentId,
          }),
        );

        assertEqual(
          1,
          events.filter((e) => e.type === 'CapturePayment').length,
        );
      } finally {
        await consumer.close();
      }
    },
  );

  void it(
    'evolves state once when the same message is delivered twice (separateInputInboxFromProcessing: true)',
    withDeadline,
    async () => {
      const paymentId = uuid();
      const laterPaymentId = uuid();
      const paymentAuthorized: PaymentAuthorized = {
        type: 'PaymentAuthorized',
        data: { paymentId, amount: 100 },
        metadata: { messageId: uuid() },
      };

      await handlePaymentCapture(eventStore, paymentAuthorized);
      await handlePaymentCapture(eventStore, paymentAuthorized);
      await handlePaymentCapture(eventStore, {
        type: 'PaymentAuthorized',
        data: { paymentId, amount: 50 },
        metadata: { messageId: uuid() },
      });
      await handlePaymentCapture(eventStore, {
        type: 'PaymentAuthorized',
        data: { paymentId: laterPaymentId, amount: 100 },
        metadata: { messageId: uuid() },
      });

      const consumer = sqliteEventStoreConsumer({
        driver: d1EventStoreDriver,
        database,
      });

      consumer.workflowProcessor<
        PaymentAuthorized,
        PaymentCapture,
        CapturePayment
      >({
        ...paymentCaptureOptions,
        processorId: uuid(),
        stopAfter: (message) => message.data.paymentId === laterPaymentId,
      });

      try {
        await consumer.start();
      } finally {
        await consumer.close();
      }

      const { events } = await eventStore.readStream(
        workflowStreamName({
          workflowName: 'PaymentCaptureWorkflow',
          workflowId: paymentId,
        }),
      );

      assertDeepEqual(
        [
          { paymentId, amount: 100 },
          { paymentId, amount: 150 },
        ],
        events.filter((e) => e.type === 'CapturePayment').map((e) => e.data),
      );
    },
  );

  void it(
    'does not run decide again when outputs were appended but the checkpoint was not stored (useCausationIdForIdempotencyCheck: true)',
    withDeadline,
    async () => {
      const paymentId = uuid();
      const laterPaymentId = uuid();

      await handlePaymentCapture(eventStore, {
        type: 'PaymentAuthorized',
        data: { paymentId, amount: 100 },
        metadata: { messageId: uuid() },
      });
      await handlePaymentCapture(eventStore, {
        type: 'PaymentAuthorized',
        data: { paymentId: laterPaymentId, amount: 100 },
        metadata: { messageId: uuid() },
      });

      const processUntilLaterPayment = async (processorId: string) => {
        const consumer = sqliteEventStoreConsumer({
          driver: d1EventStoreDriver,
          database,
        });

        consumer.workflowProcessor<
          PaymentAuthorized,
          PaymentCapture,
          CapturePayment
        >({
          ...paymentCaptureOptions,
          useCausationIdForIdempotencyCheck: true,
          processorId,
          stopAfter: (message) => message.data.paymentId === laterPaymentId,
        });

        try {
          await consumer.start();
        } finally {
          await consumer.close();
        }
      };

      await processUntilLaterPayment(uuid());
      await processUntilLaterPayment(uuid());

      const { events } = await eventStore.readStream(
        workflowStreamName({
          workflowName: 'PaymentCaptureWorkflow',
          workflowId: paymentId,
        }),
      );

      assertEqual(1, events.filter((e) => e.type === 'CapturePayment').length);
    },
  );

  void it(
    'decides a message that the output handler returns (separateInputInboxFromProcessing: true)',
    withDeadline,
    async () => {
      const groupCheckoutId = uuid();
      const guestStayAccountId = uuid();
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

        await handleWorkflow(eventStore, {
          type: 'InitiateGroupCheckout',
          kind: 'Command',
          data: {
            groupCheckoutId,
            clerkId: 'clerk-1',
            guestStayAccountIds: [guestStayAccountId],
            now,
          },
        });

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
    'completes group checkout after two guests check out (separateInputInboxFromProcessing: true)',
    withDeadline,
    async () => {
      const groupCheckoutId = uuid();
      const guestStayAccountIds = [uuid(), uuid()];
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

        await handleWorkflow(eventStore, {
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
    'stores an event from another stream before deciding it (separateInputInboxFromProcessing: true)',
    withDeadline,
    async () => {
      const groupCheckoutId = uuid();
      const guestId = uuid();
      const now = new Date();

      await handleWorkflow(eventStore, {
        type: 'InitiateGroupCheckout',
        kind: 'Command',
        data: {
          groupCheckoutId,
          clerkId: 'clerk-1',
          guestStayAccountIds: [guestId],
          now,
        },
      });

      const consumer = sqliteEventStoreConsumer({
        driver: d1EventStoreDriver,
        database,
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
