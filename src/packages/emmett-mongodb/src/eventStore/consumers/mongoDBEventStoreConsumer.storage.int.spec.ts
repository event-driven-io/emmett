import {
  assertDeepEqual,
  assertEqual,
  assertOk,
  inMemoryReactor,
  WorkflowHandler,
  workflowStreamName,
  type ProcessorCheckpoint,
  type ReadEvent,
  type RecordedMessage,
  type WorkflowOptions,
} from '@event-driven-io/emmett';
import { MongoClient } from 'mongodb';
import { v4 as uuid } from 'uuid';
import { afterAll, beforeAll, describe, it } from 'vitest';
import {
  sharedMongoDBDatabase,
  type SharedMongoDBDatabase,
} from '../../testing/sharedMongoDBDatabase';
import {
  GroupCheckoutWorkflow,
  type GroupCheckout,
  type GroupCheckoutInput,
  type GroupCheckoutOutput,
} from '../../testing/groupCheckout.domain';
import type { ProductItemAdded } from '../../testing/shoppingCart.domain';
import {
  getMongoDBEventStore,
  type MongoDBEventStore,
} from '../mongoDBEventStore';
import type { MongoDBEventStoreStorageOptions } from '../storage';
import { readProcessorCheckpoint } from './mongoDBCheckpointer';
import { mongoDBEventStoreConsumer } from './mongoDBEventStoreConsumer';
import { changeStreamReactor } from './mongoDBProcessor';

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

void describe('MongoDB event store consumer with a custom database name', () => {
  let defaultDatabase: SharedMongoDBDatabase;
  let customDatabase: SharedMongoDBDatabase;
  let otherDatabase: SharedMongoDBDatabase;
  let client: MongoClient;
  let customStorage: MongoDBEventStoreStorageOptions;
  let otherStorage: MongoDBEventStoreStorageOptions;
  let customStore: MongoDBEventStore;
  let otherStore: MongoDBEventStore;
  const productItem = { price: 10, productId: uuid(), quantity: 10 };

  beforeAll(() => {
    defaultDatabase = sharedMongoDBDatabase();
    customDatabase = sharedMongoDBDatabase();
    otherDatabase = sharedMongoDBDatabase();
    client = new MongoClient(defaultDatabase.connectionString, {
      directConnection: true,
    });
    customStorage = {
      type: 'COLLECTION_PER_STREAM_TYPE',
      databaseName: customDatabase.databaseName,
    };
    otherStorage = {
      type: 'COLLECTION_PER_STREAM_TYPE',
      databaseName: otherDatabase.databaseName,
    };
    customStore = getMongoDBEventStore({ client, storage: customStorage });
    otherStore = getMongoDBEventStore({ client, storage: otherStorage });
  });

  afterAll(async () => {
    try {
      await client.close();
      await defaultDatabase.close();
      await customDatabase.close();
      await otherDatabase.close();
    } catch (error) {
      console.log(error);
    }
  });

  const appendProductItem = (store: MongoDBEventStore, streamName: string) =>
    store.appendToStream<ProductItemAdded>(streamName, [
      { type: 'ProductItemAdded', data: { productItem } },
    ]);

  const isHandledEvent =
    (streamName: string) =>
    (event: ReadEvent<ProductItemAdded>): boolean =>
      event.metadata.streamName === streamName &&
      event.metadata.streamPosition === 1n;

  const appendedEvents = async (
    store: MongoDBEventStore,
    streamName: string,
    orderStreamName: string,
  ) => {
    const {
      events: [handled],
    } = await customStore.readStream<ProductItemAdded>(streamName);
    const { events } =
      await store.readStream<ProductItemAdded>(orderStreamName);
    assertOk(handled);

    const actual = events.map(
      ({ type, kind, schemaVersion, data, metadata }) => ({
        type,
        kind,
        schemaVersion,
        data,
        streamName: metadata.streamName,
        streamPosition: metadata.streamPosition,
        correlationId: metadata.correlationId,
        causationId: metadata.causationId,
      }),
    );
    const expected: typeof actual = [
      {
        type: 'ProductItemAdded',
        kind: 'Event',
        schemaVersion: 1,
        data: { productItem },
        streamName: orderStreamName,
        streamPosition: 1n,
        correlationId: handled.metadata.correlationId,
        causationId: handled.metadata.messageId,
      },
    ];

    return { actual, expected };
  };

  const assertReceivedFromCustomDatabase = async (
    received: ReadEvent<ProductItemAdded>[],
    streamName: string,
  ) => {
    const {
      events: [stored],
    } = await customStore.readStream<ProductItemAdded>(streamName);
    assertOk(stored);
    assertDeepEqual(
      received.map(({ type, kind, schemaVersion, data, metadata }) => ({
        type,
        kind,
        schemaVersion,
        data,
        streamName: metadata.streamName,
        streamPosition: metadata.streamPosition,
        messageId: metadata.messageId,
        correlationId: metadata.correlationId,
      })),
      [
        {
          type: 'ProductItemAdded',
          kind: 'Event',
          schemaVersion: 1,
          data: { productItem },
          streamName,
          streamPosition: 1n,
          messageId: stored.metadata.messageId,
          correlationId: stored.metadata.correlationId,
        },
      ],
    );
  };

  void it(
    'consumer of a custom-database store receives appended events',
    withDeadline,
    async () => {
      const streamName = `shopping_cart-shoppingCart:${uuid()}`;
      const received: ReadEvent<ProductItemAdded>[] = [];

      const consumer = customStore.consumer();
      consumer.reactor<ProductItemAdded>({
        processorId: uuid(),
        connectionOptions: { client },
        eachMessage: (message) => {
          if (message.metadata.streamName === streamName)
            received.push(message);
        },
        stopAfter: isHandledEvent(streamName),
      });

      try {
        const consumerPromise = consumer.start();

        await appendProductItem(customStore, streamName);

        await consumerPromise;
      } finally {
        await consumer.close();
      }

      await assertReceivedFromCustomDatabase(received, streamName);
    },
  );

  void it(
    'MongoDB reactor appends into the custom database',
    withDeadline,
    async () => {
      const streamName = `shopping_cart-shoppingCart:${uuid()}`;
      const orderStreamName = `order-${uuid()}`;
      await appendProductItem(customStore, streamName);

      const consumer = customStore.consumer();
      consumer.reactor<ProductItemAdded>({
        processorId: uuid(),
        connectionOptions: { client },
        eachMessage: async (message, context) => {
          if (message.metadata.streamName !== streamName) return;

          await context.session.messageStore.appendToStream<ProductItemAdded>(
            orderStreamName,
            [{ type: 'ProductItemAdded', data: message.data }],
          );
        },
        stopAfter: isHandledEvent(streamName),
      });

      try {
        await consumer.start();
      } finally {
        await consumer.close();
      }

      const { actual, expected } = await appendedEvents(
        customStore,
        streamName,
        orderStreamName,
      );
      assertDeepEqual(actual, expected);
    },
  );

  void it(
    'in-memory reactor on that consumer appends into the custom database',
    withDeadline,
    async () => {
      const streamName = `shopping_cart-shoppingCart:${uuid()}`;
      const orderStreamName = `order-${uuid()}`;
      await appendProductItem(customStore, streamName);

      const consumer = customStore.consumer({
        processors: [
          inMemoryReactor<ProductItemAdded>({
            processorId: uuid(),
            eachMessage: async (message, context) => {
              if (message.metadata.streamName !== streamName) return;

              const messageStore = context.session.messageStore;
              await messageStore.appendToStream(orderStreamName, [
                { type: 'ProductItemAdded', data: message.data },
              ]);
            },
            stopAfter: isHandledEvent(streamName),
          }),
        ],
      });

      try {
        await consumer.start();
      } finally {
        await consumer.close();
      }

      const { actual, expected } = await appendedEvents(
        customStore,
        streamName,
        orderStreamName,
      );
      assertDeepEqual(actual, expected);
    },
  );

  void it(
    'workflow output lands in the custom database',
    withDeadline,
    async () => {
      const groupCheckoutId = uuid();
      const guestStayAccountIds = [uuid(), uuid()];
      const now = new Date();

      const consumer = customStore.consumer();
      consumer.workflowProcessor<
        GroupCheckoutInput,
        GroupCheckout,
        GroupCheckoutOutput
      >({
        ...workflowProcessorOptions,
        processorId: uuid(),
        separateInputInboxFromProcessing: true,
        stopAfter: (message) =>
          message.type === 'GroupCheckoutInitiated' &&
          message.data.groupCheckoutId === groupCheckoutId,
      });

      try {
        const consumerPromise = consumer.start();

        await handleWorkflowWithSeparateInbox(customStore, {
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

      const { events } = await customStore.readStream(
        workflowStreamName({
          workflowName: 'GroupCheckoutWorkflow',
          workflowId: groupCheckoutId,
        }),
      );
      const actual: { type: string; kind: string; data: unknown }[] =
        events.map(({ type, kind, data }) => ({ type, kind, data }));
      assertDeepEqual(actual, [
        {
          type: 'GroupCheckoutWorkflow:InitiateGroupCheckout',
          kind: 'Command',
          data: {
            groupCheckoutId,
            clerkId: 'clerk-1',
            guestStayAccountIds,
            now,
          },
        },
        {
          type: 'GroupCheckoutInitiated',
          kind: 'Event',
          data: {
            groupCheckoutId,
            guestStayAccountIds,
            initiatedAt: now,
            clerkId: 'clerk-1',
          },
        },
        ...guestStayAccountIds.map((guestStayAccountId) => ({
          type: 'CheckOut',
          kind: 'Command',
          data: { guestStayAccountId, groupCheckoutId },
        })),
      ]);
    },
  );

  void it(
    "checkpoint is in the custom database's emt:processors, not the default database",
    withDeadline,
    async () => {
      const streamName = `shopping_cart-shoppingCart:${uuid()}`;
      const processorId = uuid();
      const handledCheckpoints: (ProcessorCheckpoint | null | undefined)[] = [];
      await appendProductItem(customStore, streamName);

      const consumer = customStore.consumer();
      consumer.reactor<ProductItemAdded>({
        processorId,
        connectionOptions: { client },
        eachMessage: (message) => {
          if (message.metadata.streamName === streamName)
            handledCheckpoints.push(message.metadata.checkpoint);
        },
        stopAfter: isHandledEvent(streamName),
      });

      try {
        await consumer.start();
      } finally {
        await consumer.close();
      }

      const inCustomDatabase = await readProcessorCheckpoint(client, {
        processorId,
        databaseName: customDatabase.databaseName,
      });
      const inDefaultDatabase = await readProcessorCheckpoint(client, {
        processorId,
      });
      assertEqual(handledCheckpoints.length, 1);
      assertOk(handledCheckpoints[0]);
      assertDeepEqual(inCustomDatabase, {
        lastCheckpoint: handledCheckpoints[0],
      });
      assertDeepEqual(inDefaultDatabase, { lastCheckpoint: null });
    },
  );

  void it(
    'reactor on a custom-database store resumes from its checkpoint in the custom database',
    withDeadline,
    async () => {
      const streamName = `shopping_cart-shoppingCart:${uuid()}`;
      const processorId = uuid();
      const received: ReadEvent<ProductItemAdded>[] = [];
      await appendProductItem(customStore, streamName);

      const initialConsumer = customStore.consumer();
      initialConsumer.reactor<ProductItemAdded>({
        processorId,
        connectionOptions: { client },
        eachMessage: () => undefined,
        stopAfter: isHandledEvent(streamName),
      });

      try {
        await initialConsumer.start();
      } finally {
        await initialConsumer.close();
      }

      await appendProductItem(customStore, streamName);

      const resumedConsumer = customStore.consumer();
      resumedConsumer.reactor<ProductItemAdded>({
        processorId,
        connectionOptions: { client },
        eachMessage: (message) => {
          if (message.metadata.streamName === streamName)
            received.push(message);
        },
        stopAfter: (event) =>
          event.metadata.streamName === streamName &&
          event.metadata.streamPosition === 2n,
      });

      try {
        await resumedConsumer.start();
      } finally {
        await resumedConsumer.close();
      }

      assertDeepEqual(
        received.map(({ type, data, metadata }) => ({
          type,
          data,
          streamName: metadata.streamName,
          streamPosition: metadata.streamPosition,
        })),
        [
          {
            type: 'ProductItemAdded',
            data: { productItem },
            streamName,
            streamPosition: 2n,
          },
        ],
      );
    },
  );

  void it(
    "projector checkpoint is in the custom database's emt:processors, not the default database",
    withDeadline,
    async () => {
      const streamName = `shopping_cart-shoppingCart:${uuid()}`;
      const processorId = uuid();
      const handledCheckpoints: (ProcessorCheckpoint | null | undefined)[] = [];
      await appendProductItem(customStore, streamName);

      const consumer = customStore.consumer();
      consumer.projector<ProductItemAdded>({
        processorId,
        connectionOptions: { client },
        projection: {
          name: uuid(),
          canHandle: ['ProductItemAdded'],
          handle: (events) => {
            handledCheckpoints.push(
              ...events
                .filter((event) => event.metadata.streamName === streamName)
                .map((event) => event.metadata.checkpoint),
            );
          },
        },
        stopAfter: isHandledEvent(streamName),
      });

      try {
        await consumer.start();
      } finally {
        await consumer.close();
      }

      const inCustomDatabase = await readProcessorCheckpoint(client, {
        processorId,
        databaseName: customDatabase.databaseName,
      });
      const inDefaultDatabase = await readProcessorCheckpoint(client, {
        processorId,
      });
      assertEqual(handledCheckpoints.length, 1);
      assertOk(handledCheckpoints[0]);
      assertDeepEqual(inCustomDatabase, {
        lastCheckpoint: handledCheckpoints[0],
      });
      assertDeepEqual(inDefaultDatabase, { lastCheckpoint: null });
    },
  );

  void it(
    "workflow processor checkpoint is in the custom database's emt:processors, not the default database",
    withDeadline,
    async () => {
      const groupCheckoutId = uuid();
      const processorId = uuid();
      const inboxCheckpoints: (ProcessorCheckpoint | null | undefined)[] = [];
      const isInboxInput = (message: RecordedMessage) =>
        message.type === 'GroupCheckoutWorkflow:InitiateGroupCheckout' &&
        message.metadata.streamName ===
          workflowStreamName({
            workflowName: 'GroupCheckoutWorkflow',
            workflowId: groupCheckoutId,
          });

      const consumer = customStore.consumer();
      consumer.workflowProcessor<
        GroupCheckoutInput,
        GroupCheckout,
        GroupCheckoutOutput
      >({
        ...workflowProcessorOptions,
        processorId,
        separateInputInboxFromProcessing: true,
        stopAfter: (message) =>
          message.type === 'GroupCheckoutInitiated' &&
          message.data.groupCheckoutId === groupCheckoutId,
      });
      consumer.reactor({
        processorId: uuid(),
        connectionOptions: { client },
        eachMessage: (message) => {
          if (isInboxInput(message))
            inboxCheckpoints.push(message.metadata.checkpoint);
        },
        stopAfter: isInboxInput,
      });

      try {
        const consumerPromise = consumer.start();

        await handleWorkflowWithSeparateInbox(customStore, {
          type: 'InitiateGroupCheckout',
          kind: 'Command',
          data: {
            groupCheckoutId,
            clerkId: 'clerk-1',
            guestStayAccountIds: [uuid()],
            now: new Date(),
          },
        });

        await consumerPromise;
      } finally {
        await consumer.close();
      }

      const inCustomDatabase = await readProcessorCheckpoint(client, {
        processorId,
        databaseName: customDatabase.databaseName,
      });
      const inDefaultDatabase = await readProcessorCheckpoint(client, {
        processorId,
      });
      assertEqual(inboxCheckpoints.length, 1);
      assertOk(inboxCheckpoints[0]);
      assertDeepEqual(inCustomDatabase, {
        lastCheckpoint: inboxCheckpoints[0],
      });
      assertDeepEqual(inDefaultDatabase, { lastCheckpoint: null });
    },
  );

  void it(
    'standalone consumer with storage receives and appends in the custom database',
    withDeadline,
    async () => {
      const streamName = `shopping_cart-shoppingCart:${uuid()}`;
      const orderStreamName = `order-${uuid()}`;
      const received: ReadEvent<ProductItemAdded>[] = [];

      const consumer = mongoDBEventStoreConsumer({
        client,
        storage: customStorage,
      });
      consumer.reactor<ProductItemAdded>({
        processorId: uuid(),
        connectionOptions: { client },
        eachMessage: async (message, context) => {
          if (message.metadata.streamName !== streamName) return;

          received.push(message);
          await context.session.messageStore.appendToStream<ProductItemAdded>(
            orderStreamName,
            [{ type: 'ProductItemAdded', data: message.data }],
          );
        },
        stopAfter: isHandledEvent(streamName),
      });

      try {
        const consumerPromise = consumer.start();

        await appendProductItem(customStore, streamName);

        await consumerPromise;
      } finally {
        await consumer.close();
      }

      const { actual, expected } = await appendedEvents(
        customStore,
        streamName,
        orderStreamName,
      );
      await assertReceivedFromCustomDatabase(received, streamName);
      assertDeepEqual(actual, expected);
    },
  );

  void it('caller-given processor storage wins', withDeadline, async () => {
    const streamName = `shopping_cart-shoppingCart:${uuid()}`;
    const orderStreamName = `order-${uuid()}`;
    await appendProductItem(customStore, streamName);

    const consumer = customStore.consumer();
    consumer.reactor<ProductItemAdded>({
      processorId: uuid(),
      connectionOptions: { client },
      storage: otherStorage,
      eachMessage: async (message, context) => {
        if (message.metadata.streamName !== streamName) return;

        await context.session.messageStore.appendToStream<ProductItemAdded>(
          orderStreamName,
          [{ type: 'ProductItemAdded', data: message.data }],
        );
      },
      stopAfter: isHandledEvent(streamName),
    });

    try {
      await consumer.start();
    } finally {
      await consumer.close();
    }

    const { actual, expected } = await appendedEvents(
      otherStore,
      streamName,
      orderStreamName,
    );
    const { events: inCustomDatabase } =
      await customStore.readStream(orderStreamName);
    assertDeepEqual(actual, expected);
    assertDeepEqual(inCustomDatabase, []);
  });

  void it('caller-given projector storage wins', withDeadline, async () => {
    const streamName = `shopping_cart-shoppingCart:${uuid()}`;
    const processorId = uuid();
    const handledCheckpoints: (ProcessorCheckpoint | null | undefined)[] = [];
    await appendProductItem(customStore, streamName);

    const consumer = customStore.consumer();
    consumer.projector<ProductItemAdded>({
      processorId,
      connectionOptions: { client },
      storage: otherStorage,
      projection: {
        name: uuid(),
        canHandle: ['ProductItemAdded'],
        handle: (events) => {
          handledCheckpoints.push(
            ...events
              .filter((event) => event.metadata.streamName === streamName)
              .map((event) => event.metadata.checkpoint),
          );
        },
      },
      stopAfter: isHandledEvent(streamName),
    });

    try {
      await consumer.start();
    } finally {
      await consumer.close();
    }

    const inOtherDatabase = await readProcessorCheckpoint(client, {
      processorId,
      databaseName: otherDatabase.databaseName,
    });
    const inCustomDatabase = await readProcessorCheckpoint(client, {
      processorId,
      databaseName: customDatabase.databaseName,
    });
    assertEqual(handledCheckpoints.length, 1);
    assertOk(handledCheckpoints[0]);
    assertDeepEqual(inOtherDatabase, {
      lastCheckpoint: handledCheckpoints[0],
    });
    assertDeepEqual(inCustomDatabase, { lastCheckpoint: null });
  });

  void it(
    'caller-given workflow processor storage wins',
    withDeadline,
    async () => {
      const groupCheckoutId = uuid();
      const guestStayAccountIds = [uuid()];
      const now = new Date();
      const workflowStream = workflowStreamName({
        workflowName: 'GroupCheckoutWorkflow',
        workflowId: groupCheckoutId,
      });

      const consumer = customStore.consumer();
      consumer.workflowProcessor<
        GroupCheckoutInput,
        GroupCheckout,
        GroupCheckoutOutput
      >({
        ...workflowProcessorOptions,
        processorId: uuid(),
        storage: otherStorage,
        separateInputInboxFromProcessing: true,
        stopAfter: (message) =>
          message.type === 'GroupCheckoutInitiated' &&
          message.data.groupCheckoutId === groupCheckoutId,
      });

      try {
        const consumerPromise = consumer.start();

        await handleWorkflowWithSeparateInbox(customStore, {
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

      const { events } = await otherStore.readStream(workflowStream);
      const { events: inCustomDatabase } =
        await customStore.readStream(workflowStream);
      const actual: { type: string; kind: string; data: unknown }[] =
        events.map(({ type, kind, data }) => ({ type, kind, data }));
      const actualInCustomDatabase: {
        type: string;
        kind: string;
        data: unknown;
      }[] = inCustomDatabase.map(({ type, kind, data }) => ({
        type,
        kind,
        data,
      }));
      assertDeepEqual(actual, [
        {
          type: 'GroupCheckoutInitiated',
          kind: 'Event',
          data: {
            groupCheckoutId,
            guestStayAccountIds,
            initiatedAt: now,
            clerkId: 'clerk-1',
          },
        },
        ...guestStayAccountIds.map((guestStayAccountId) => ({
          type: 'CheckOut',
          kind: 'Command',
          data: { guestStayAccountId, groupCheckoutId },
        })),
      ]);
      assertDeepEqual(actualInCustomDatabase, [
        {
          type: 'GroupCheckoutWorkflow:InitiateGroupCheckout',
          kind: 'Command',
          data: {
            groupCheckoutId,
            clerkId: 'clerk-1',
            guestStayAccountIds,
            now,
          },
        },
      ]);
    },
  );

  void it(
    'built changeStreamReactor keeps its own storage',
    withDeadline,
    async () => {
      const streamName = `shopping_cart-shoppingCart:${uuid()}`;
      const orderStreamName = `order-${uuid()}`;
      await appendProductItem(customStore, streamName);

      const consumer = customStore.consumer();
      consumer.reactor(
        changeStreamReactor<ProductItemAdded>({
          processorId: uuid(),
          connectionOptions: { client },
          storage: otherStorage,
          eachMessage: async (message, context) => {
            if (message.metadata.streamName !== streamName) return;

            await context.session.messageStore.appendToStream<ProductItemAdded>(
              orderStreamName,
              [{ type: 'ProductItemAdded', data: message.data }],
            );
          },
          stopAfter: isHandledEvent(streamName),
        }),
      );

      try {
        await consumer.start();
      } finally {
        await consumer.close();
      }

      const { actual, expected } = await appendedEvents(
        otherStore,
        streamName,
        orderStreamName,
      );
      const { events: inCustomDatabase } =
        await customStore.readStream(orderStreamName);
      assertDeepEqual(actual, expected);
      assertDeepEqual(inCustomDatabase, []);
    },
  );
});
