import {
  d1Pool,
  type D1ConnectionPool,
} from '@event-driven-io/dumbo/cloudflare';
import {
  assertDeepEqual,
  assertMatches,
  assertOk,
  bigIntProcessorCheckpoint,
  getInMemoryDatabase,
  inMemoryProjector,
  inMemoryReactor,
  inMemorySingleStreamProjection,
  projections,
  type InMemoryDocumentsCollection,
  type ReadEvent,
} from '@event-driven-io/emmett';
import { Miniflare } from 'miniflare';
import { v4 as uuid } from 'uuid';
import { afterEach, beforeEach, describe, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { d1EventStoreDriver } from '../..';
import type {
  ProductItemAdded,
  ShoppingCartConfirmed,
} from '../../../../testing/shoppingCart.domain';
import { createEventStoreSchema } from '../../../../eventStore/schema';
import {
  getSQLiteEventStore,
  type SQLiteEventStore,
} from '../../../../eventStore/SQLiteEventStore';
import { sqliteEventStoreConsumer } from '../../../../eventStore/consumers/sqliteEventStoreConsumer';
import { sqliteProjection } from '../../../../eventStore/projections';

const withDeadline = { timeout: 30000 };

void describe('SQLite event store started consumer', () => {
  const productItem = { price: 10, productId: uuid(), quantity: 10 };
  const confirmedAt = new Date();
  const inMemoryDatabase = getInMemoryDatabase();

  let mf: Miniflare;
  let database: D1Database;
  let pool: D1ConnectionPool;
  let eventStore: SQLiteEventStore;
  let summaries: InMemoryDocumentsCollection<ShoppingCartSummary>;

  beforeEach(async () => {
    mf = new Miniflare({
      modules: true,
      script: 'export default { fetch() { return new Response("ok"); } }',
      d1Databases: { DB: 'test-db-id' },
    });
    database = await mf.getD1Database('DB');
    pool = d1Pool({
      database,
      transactionOptions: {
        allowNestedTransactions: true,
        mode: 'session_based',
      },
    });
    eventStore = getSQLiteEventStore({
      driver: d1EventStoreDriver,
      schema: { autoMigration: 'None' },
      database,
      pool,
    });
    summaries = inMemoryDatabase.collection(shoppingCartsSummaryCollectionName);
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
    await pool.close();
    await mf.dispose();
  });

  void describe('eachMessage', () => {
    void it(
      'handles all events appended to event store BEFORE projector was started',
      withDeadline,
      async () => {
        const streamName = `shopping_cart-shoppingCart:${uuid()}`;
        const appendResult = await eventStore.appendToStream(streamName, [
          { type: 'ProductItemAdded', data: { productItem } },
          { type: 'ShoppingCartConfirmed', data: { confirmedAt } },
        ] as ShoppingCartSummaryEvent[]);

        const inMemoryProcessor = inMemoryProjector<ShoppingCartSummaryEvent>({
          processorId: uuid(),
          projection: shoppingCartsSummaryProjection,
          connectionOptions: { database: inMemoryDatabase },
          stopAfter: (event) =>
            event.metadata.globalPosition ===
            appendResult.lastEventGlobalPosition,
        });

        const consumer = sqliteEventStoreConsumer({
          driver: d1EventStoreDriver,
          database,
          processors: [inMemoryProcessor],
        });

        try {
          await consumer.start();

          assertMatches(await summaries.findOne((d) => d._id === streamName), {
            _id: streamName,
            status: 'confirmed',
            productItemsCount: productItem.quantity,
          });
        } finally {
          await consumer.close();
        }
      },
    );

    void it(
      'handles all events appended to event store AFTER projector was started',
      withDeadline,
      async () => {
        const streamName = `shopping_cart-shoppingCart:${uuid()}`;
        const inMemoryProcessor = inMemoryProjector<ShoppingCartSummaryEvent>({
          processorId: uuid(),
          projection: shoppingCartsSummaryProjection,
          connectionOptions: { database: inMemoryDatabase },
        });
        const consumer = sqliteEventStoreConsumer({
          driver: d1EventStoreDriver,
          database,
          processors: [inMemoryProcessor],
        });

        let consumerPromise: Promise<void> | undefined;
        try {
          consumerPromise = consumer.start();
          await consumer.whenStarted();

          await eventStore.appendToStream(streamName, [
            { type: 'ProductItemAdded', data: { productItem } },
            { type: 'ShoppingCartConfirmed', data: { confirmedAt } },
          ] as ShoppingCartSummaryEvent[]);

          await consumer.whenCaughtUp();

          assertMatches(await summaries.findOne((d) => d._id === streamName), {
            _id: streamName,
            status: 'confirmed',
            productItemsCount: productItem.quantity,
          });
        } finally {
          await consumer.close();
          await consumerPromise;
        }
      },
    );

    void it(
      'handles ONLY events AFTER provided global position',
      withDeadline,
      async () => {
        const streamName = `shopping_cart-shoppingCart:${uuid()}`;
        const { lastEventGlobalPosition: startPosition } =
          await eventStore.appendToStream(streamName, [
            { type: 'ProductItemAdded', data: { productItem } },
            { type: 'ProductItemAdded', data: { productItem } },
          ] as ShoppingCartSummaryEvent[]);

        const inMemoryProcessor = inMemoryProjector<ShoppingCartSummaryEvent>({
          processorId: uuid(),
          projection: shoppingCartsSummaryProjection,
          connectionOptions: { database: inMemoryDatabase },
          startFrom: { lastCheckpoint: startPosition },
        });
        const consumer = sqliteEventStoreConsumer({
          driver: d1EventStoreDriver,
          database,
          processors: [inMemoryProcessor],
        });

        let consumerPromise: Promise<void> | undefined;
        try {
          consumerPromise = consumer.start();
          await consumer.whenStarted();

          await eventStore.appendToStream(streamName, [
            { type: 'ProductItemAdded', data: { productItem } },
            { type: 'ShoppingCartConfirmed', data: { confirmedAt } },
          ] as ShoppingCartSummaryEvent[]);

          await consumer.whenCaughtUp();

          assertMatches(await summaries.findOne((d) => d._id === streamName), {
            _id: streamName,
            status: 'confirmed',
            productItemsCount: productItem.quantity,
          });
        } finally {
          await consumer.close();
          await consumerPromise;
        }
      },
    );

    void it(
      'handles all events when CURRENT position is NOT stored',
      withDeadline,
      async () => {
        const streamName = `shopping_cart-shoppingCart:${uuid()}`;
        await eventStore.appendToStream(streamName, [
          { type: 'ProductItemAdded', data: { productItem } },
          { type: 'ProductItemAdded', data: { productItem } },
        ] as ShoppingCartSummaryEvent[]);

        const inMemoryProcessor = inMemoryProjector<ShoppingCartSummaryEvent>({
          processorId: uuid(),
          projection: shoppingCartsSummaryProjection,
          connectionOptions: { database: inMemoryDatabase },
          startFrom: 'CURRENT',
        });
        const consumer = sqliteEventStoreConsumer({
          driver: d1EventStoreDriver,
          database,
          processors: [inMemoryProcessor],
        });

        let consumerPromise: Promise<void> | undefined;
        try {
          consumerPromise = consumer.start();
          await consumer.whenStarted();

          await eventStore.appendToStream(streamName, [
            { type: 'ProductItemAdded', data: { productItem } },
            { type: 'ShoppingCartConfirmed', data: { confirmedAt } },
          ] as ShoppingCartSummaryEvent[]);

          await consumer.whenCaughtUp();

          assertMatches(await summaries.findOne((d) => d._id === streamName), {
            _id: streamName,
            status: 'confirmed',
            productItemsCount: productItem.quantity * 3,
          });
        } finally {
          await consumer.close();
          await consumerPromise;
        }
      },
    );

    void it(
      'handles only new events when CURRENT position is stored for restarted consumer',
      withDeadline,
      async () => {
        const streamName = `shopping_cart-shoppingCart:${uuid()}`;
        const { lastEventGlobalPosition: startPosition } =
          await eventStore.appendToStream(streamName, [
            { type: 'ProductItemAdded', data: { productItem } },
            { type: 'ProductItemAdded', data: { productItem } },
          ] as ShoppingCartSummaryEvent[]);

        const inMemoryProcessor = inMemoryProjector<ShoppingCartSummaryEvent>({
          processorId: uuid(),
          projection: shoppingCartsSummaryProjection,
          connectionOptions: { database: inMemoryDatabase },
          startFrom: 'CURRENT',
          stopAfter: (event) => event.metadata.globalPosition === startPosition,
        });
        const consumer = sqliteEventStoreConsumer({
          driver: d1EventStoreDriver,
          database,
          processors: [inMemoryProcessor],
        });

        await consumer.start();
        await consumer.stop();

        let consumerPromise: Promise<void> | undefined;
        try {
          consumerPromise = consumer.start();
          await consumer.whenStarted();

          await eventStore.appendToStream(streamName, [
            { type: 'ProductItemAdded', data: { productItem } },
            { type: 'ShoppingCartConfirmed', data: { confirmedAt } },
          ] as ShoppingCartSummaryEvent[]);

          await consumer.whenCaughtUp();

          assertMatches(await summaries.findOne((d) => d._id === streamName), {
            _id: streamName,
            status: 'confirmed',
            productItemsCount: productItem.quantity * 3,
          });
        } finally {
          await consumer.close();
          await consumerPromise;
        }
      },
    );

    void it(
      'handles only new events when CURRENT position is stored for a new consumer',
      withDeadline,
      async () => {
        const streamName = `shopping_cart-shoppingCart:${uuid()}`;
        const { lastEventGlobalPosition: startPosition } =
          await eventStore.appendToStream(streamName, [
            { type: 'ProductItemAdded', data: { productItem } },
            { type: 'ProductItemAdded', data: { productItem } },
          ] as ShoppingCartSummaryEvent[]);

        const processorId = uuid();
        const inMemoryProcessor = () =>
          inMemoryProjector<ShoppingCartSummaryEvent>({
            processorId,
            projection: shoppingCartsSummaryProjection,
            connectionOptions: { database: inMemoryDatabase },
            startFrom: 'CURRENT',
            stopAfter: (event) =>
              event.metadata.globalPosition === startPosition,
          });

        const consumer = sqliteEventStoreConsumer({
          driver: d1EventStoreDriver,
          database,
          processors: [inMemoryProcessor()],
        });
        try {
          await consumer.start();
        } finally {
          await consumer.close();
        }

        const newConsumer = sqliteEventStoreConsumer({
          driver: d1EventStoreDriver,
          database,
          processors: [inMemoryProcessor()],
        });

        let consumerPromise: Promise<void> | undefined;
        try {
          consumerPromise = newConsumer.start();
          await newConsumer.whenStarted();

          await eventStore.appendToStream(streamName, [
            { type: 'ProductItemAdded', data: { productItem } },
            { type: 'ShoppingCartConfirmed', data: { confirmedAt } },
          ] as ShoppingCartSummaryEvent[]);

          await newConsumer.whenCaughtUp();

          assertMatches(await summaries.findOne((d) => d._id === streamName), {
            _id: streamName,
            status: 'confirmed',
            productItemsCount: productItem.quantity * 3,
          });
        } finally {
          await newConsumer.close();
          await consumerPromise;
        }
      },
    );
  });

  void it(
    `in-memory reactor appends through the session's message store`,
    withDeadline,
    async () => {
      const streamName = `shopping_cart-shoppingCart:${uuid()}`;
      const orderStreamName = `order-${uuid()}`;
      const { lastEventGlobalPosition } = await eventStore.appendToStream(
        streamName,
        [
          { type: 'ProductItemAdded', data: { productItem } },
        ] as ProductItemAdded[],
      );

      const inMemoryProcessor = inMemoryReactor<ProductItemAdded>({
        processorId: uuid(),
        eachMessage: async (message, context) => {
          const messageStore = context.session.messageStore;
          await messageStore.appendToStream(orderStreamName, [
            {
              type: 'ProductItemAdded',
              data: { productItem: message.data.productItem },
            },
          ]);
        },
        stopAfter: (event) =>
          event.metadata.globalPosition === lastEventGlobalPosition,
      });

      const consumer = sqliteEventStoreConsumer({
        driver: d1EventStoreDriver,
        database,
        processors: [inMemoryProcessor],
      });

      try {
        await consumer.start();
      } finally {
        await consumer.close();
      }

      const {
        events: [handled],
      } = await eventStore.readStream<ProductItemAdded>(streamName);
      const { events } =
        await eventStore.readStream<ProductItemAdded>(orderStreamName);
      assertOk(handled);
      assertDeepEqual(
        events.map(({ type, kind, schemaVersion, data, metadata }) => ({
          type,
          kind,
          schemaVersion,
          data,
          streamName: metadata.streamName,
          streamPosition: metadata.streamPosition,
          globalPosition: metadata.globalPosition,
          checkpoint: metadata.checkpoint,
          correlationId: metadata.correlationId,
          causationId: metadata.causationId,
        })),
        [
          {
            type: 'ProductItemAdded',
            kind: 'Event',
            schemaVersion: 1,
            data: { productItem },
            streamName: orderStreamName,
            streamPosition: 1n,
            globalPosition: bigIntProcessorCheckpoint(2n),
            checkpoint: bigIntProcessorCheckpoint(2n),
            correlationId: handled.metadata.correlationId,
            causationId: handled.metadata.messageId,
          },
        ],
      );
    },
  );

  void it(
    `in-memory reactor on the event store's consumer appends through that event store`,
    withDeadline,
    async () => {
      const streamName = `shopping_cart-shoppingCart:${uuid()}`;
      const orderStreamName = `order-${uuid()}`;
      const { lastEventGlobalPosition } = await eventStore.appendToStream(
        streamName,
        [
          { type: 'ProductItemAdded', data: { productItem } },
        ] as ProductItemAdded[],
      );
      const inlineProjected: ReadEvent<ProductItemAdded>[] = [];
      const storeWithInlineProjection = getSQLiteEventStore({
        driver: d1EventStoreDriver,
        schema: { autoMigration: 'None' },
        database,
        pool,
        projections: projections.inline([
          sqliteProjection<ProductItemAdded>({
            name: `orders-${uuid()}`,
            canHandle: ['ProductItemAdded'],
            handle: (events) => {
              inlineProjected.push(...events);
            },
          }),
        ]),
      });

      const inMemoryProcessor = inMemoryReactor<ProductItemAdded>({
        processorId: uuid(),
        eachMessage: async (message, context) => {
          await context.session.messageStore.appendToStream(orderStreamName, [
            {
              type: 'ProductItemAdded',
              data: { productItem: message.data.productItem },
            },
          ]);
        },
        stopAfter: (event) =>
          event.metadata.globalPosition === lastEventGlobalPosition,
      });

      const consumer = storeWithInlineProjection.consumer({
        processors: [inMemoryProcessor],
      });

      try {
        await consumer.start();
      } finally {
        await consumer.close();
      }

      const {
        events: [stored],
      } = await eventStore.readStream<ProductItemAdded>(orderStreamName);
      assertOk(stored);
      assertDeepEqual(inlineProjected, [
        {
          type: 'ProductItemAdded',
          kind: 'Event',
          schemaVersion: 1,
          data: { productItem },
          metadata: {
            streamName: orderStreamName,
            streamPosition: 1n,
            messageId: stored.metadata.messageId,
            correlationId: stored.metadata.correlationId,
            causationId: stored.metadata.causationId,
            traceId: stored.metadata.traceId,
            spanId: stored.metadata.spanId,
          },
        },
      ]);
    },
  );
});

type ShoppingCartSummary = {
  _id?: string;
  productItemsCount: number;
  status: string;
};

const shoppingCartsSummaryCollectionName = 'shoppingCartsSummary';

export type ShoppingCartSummaryEvent = ProductItemAdded | ShoppingCartConfirmed;

const evolve = (
  document: ShoppingCartSummary,
  { type, data }: ReadEvent<ShoppingCartSummaryEvent>,
): ShoppingCartSummary => {
  switch (type) {
    case 'ProductItemAdded':
      return {
        ...document,
        productItemsCount:
          document.productItemsCount + data.productItem.quantity,
      };
    case 'ShoppingCartConfirmed':
      return { ...document, status: 'confirmed' };
    default:
      return document;
  }
};

const shoppingCartsSummaryProjection = inMemorySingleStreamProjection({
  collectionName: shoppingCartsSummaryCollectionName,
  evolve,
  canHandle: ['ProductItemAdded', 'ShoppingCartConfirmed'],
  initialState: () => ({
    status: 'pending',
    productItemsCount: 0,
  }),
});
