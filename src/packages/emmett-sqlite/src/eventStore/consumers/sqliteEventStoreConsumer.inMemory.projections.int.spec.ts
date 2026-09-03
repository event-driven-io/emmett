import { JSONSerializer } from '@event-driven-io/dumbo';
import {
  sqlite3Pool,
  type SQLite3Connection,
  type SQLitePool,
} from '@event-driven-io/dumbo/sqlite3';
import {
  assertMatches,
  getInMemoryDatabase,
  inMemoryProjector,
  inMemorySingleStreamProjection,
  type InMemoryDocumentsCollection,
  type ReadEvent,
} from '@event-driven-io/emmett';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';
import { afterEach, beforeEach, describe, it } from 'vitest';
import { sqlite3EventStoreDriver } from '../../sqlite3';
import type {
  ProductItemAdded,
  ShoppingCartConfirmed,
} from '../../testing/shoppingCart.domain';
import { deleteSQLiteDatabaseFiles } from '../../testing/sqliteTestDatabase';
import { createEventStoreSchema } from '../schema';
import {
  getSQLiteEventStore,
  type SQLiteEventStore,
} from '../SQLiteEventStore';
import { sqliteEventStoreConsumer } from './sqliteEventStoreConsumer';

const withDeadline = { timeout: 30000 };

void describe('SQLite event store started consumer', () => {
  const testDatabasePath = path.dirname(fileURLToPath(import.meta.url));
  const fileName = path.resolve(
    testDatabasePath,
    'inMemory.projections.test.db',
  );
  const productItem = { price: 10, productId: uuid(), quantity: 10 };
  const confirmedAt = new Date();
  const database = getInMemoryDatabase();

  let pool: SQLitePool<SQLite3Connection>;
  let eventStore: SQLiteEventStore;
  let summaries: InMemoryDocumentsCollection<ShoppingCartSummary>;

  beforeEach(async () => {
    pool = sqlite3Pool({
      fileName,
      transactionOptions: { allowNestedTransactions: true },
    });
    eventStore = getSQLiteEventStore({
      driver: sqlite3EventStoreDriver,
      schema: { autoMigration: 'None' },
      fileName,
      pool,
    });
    summaries = database.collection(shoppingCartsSummaryCollectionName);
    await createEventStoreSchema(
      sqlite3Pool({ fileName, serializer: JSONSerializer }),
    );
  });

  afterEach(async () => {
    await eventStore.close();
    await pool.close();
    deleteSQLiteDatabaseFiles(fileName);
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
          connectionOptions: { database },
          stopAfter: (event) =>
            event.metadata.globalPosition ===
            appendResult.lastEventGlobalPosition,
        });

        const consumer = sqliteEventStoreConsumer({
          driver: sqlite3EventStoreDriver,
          fileName,
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
          connectionOptions: { database },
        });
        const consumer = sqliteEventStoreConsumer({
          driver: sqlite3EventStoreDriver,
          fileName,
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
          connectionOptions: { database },
          startFrom: { lastCheckpoint: startPosition },
        });
        const consumer = sqliteEventStoreConsumer({
          driver: sqlite3EventStoreDriver,
          fileName,
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
          connectionOptions: { database },
          startFrom: 'CURRENT',
        });
        const consumer = sqliteEventStoreConsumer({
          driver: sqlite3EventStoreDriver,
          fileName,
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
          connectionOptions: { database },
          startFrom: 'CURRENT',
          stopAfter: (event) => event.metadata.globalPosition === startPosition,
        });
        const consumer = sqliteEventStoreConsumer({
          driver: sqlite3EventStoreDriver,
          fileName,
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
            connectionOptions: { database },
            startFrom: 'CURRENT',
            stopAfter: (event) =>
              event.metadata.globalPosition === startPosition,
          });

        const consumer = sqliteEventStoreConsumer({
          driver: sqlite3EventStoreDriver,
          fileName,
          processors: [inMemoryProcessor()],
        });
        try {
          await consumer.start();
        } finally {
          await consumer.close();
        }

        const newConsumer = sqliteEventStoreConsumer({
          driver: sqlite3EventStoreDriver,
          fileName,
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
