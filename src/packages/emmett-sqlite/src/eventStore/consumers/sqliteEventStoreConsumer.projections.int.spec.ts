import { JSONSerializer } from '@event-driven-io/dumbo';
import {
  sqlite3Pool,
  type SQLite3Connection,
  type SQLitePool,
} from '@event-driven-io/dumbo/sqlite3';
import {
  assertDeepEqual,
  assertMatches,
  type ReadEvent,
} from '@event-driven-io/emmett';
import { pongoClient } from '@event-driven-io/pongo';
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
import { pongoSingleStreamProjection } from '../projections';
import { sqliteEventStoreConsumer } from './sqliteEventStoreConsumer';
import type { SQLiteProjectorOptions } from './sqliteProcessor';

const withDeadline = { timeout: 30000 };

void describe('SQLite event store started consumer', () => {
  const testDatabasePath = path.dirname(fileURLToPath(import.meta.url));
  const fileName = path.resolve(testDatabasePath, 'projections.test.db');
  const productItem = { price: 10, productId: uuid(), quantity: 10 };
  const confirmedAt = new Date();

  let pool: SQLitePool<SQLite3Connection>;
  let eventStore: SQLiteEventStore;

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

        const consumer = sqliteEventStoreConsumer({
          driver: sqlite3EventStoreDriver,
          fileName,
        });
        consumer.projector<ShoppingCartSummaryEvent>({
          processorId: uuid(),
          projection: shoppingCartsSummaryProjection,
          stopAfter: (event) =>
            event.metadata.globalPosition ===
            appendResult.lastEventGlobalPosition,
        });

        try {
          await consumer.start();

          assertDeepEqual(await summaryFor(streamName), {
            _id: streamName,
            status: 'confirmed',
            _version: 1n,
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
        const consumer = sqliteEventStoreConsumer({
          driver: sqlite3EventStoreDriver,
          fileName,
        });
        consumer.projector<ShoppingCartSummaryEvent>({
          processorId: uuid(),
          projection: shoppingCartsSummaryProjection,
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

          assertDeepEqual(await summaryFor(streamName), {
            _id: streamName,
            status: 'confirmed',
            _version: 1n,
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

        const consumer = sqliteEventStoreConsumer({
          driver: sqlite3EventStoreDriver,
          fileName,
        });
        consumer.projector<ShoppingCartSummaryEvent>({
          processorId: uuid(),
          projection: shoppingCartsSummaryProjection,
          startFrom: { lastCheckpoint: startPosition },
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

          assertDeepEqual(await summaryFor(streamName), {
            _id: streamName,
            status: 'confirmed',
            _version: 1n,
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

        const consumer = sqliteEventStoreConsumer({
          driver: sqlite3EventStoreDriver,
          fileName,
        });
        consumer.projector<ShoppingCartSummaryEvent>({
          processorId: uuid(),
          projection: shoppingCartsSummaryProjection,
          startFrom: 'CURRENT',
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

          // _version is not asserted here because the pre-existing events and
          // the ones appended after start may land in one or two poll batches
          assertMatches(await summaryFor(streamName), {
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

        const consumer = sqliteEventStoreConsumer({
          driver: sqlite3EventStoreDriver,
          fileName,
        });
        consumer.projector<ShoppingCartSummaryEvent>({
          processorId: uuid(),
          projection: shoppingCartsSummaryProjection,
          startFrom: 'CURRENT',
          stopAfter: (event) => event.metadata.globalPosition === startPosition,
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

          assertDeepEqual(await summaryFor(streamName), {
            _id: streamName,
            status: 'confirmed',
            _version: 2n,
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

        const processorOptions: SQLiteProjectorOptions<ShoppingCartSummaryEvent> =
          {
            processorId: uuid(),
            projection: shoppingCartsSummaryProjection,
            startFrom: 'CURRENT',
            stopAfter: (event) =>
              event.metadata.globalPosition === startPosition,
          };

        const consumer = sqliteEventStoreConsumer({
          driver: sqlite3EventStoreDriver,
          fileName,
        });
        try {
          consumer.projector<ShoppingCartSummaryEvent>(processorOptions);

          await consumer.start();
        } finally {
          await consumer.close();
        }

        const newConsumer = sqliteEventStoreConsumer({
          driver: sqlite3EventStoreDriver,
          fileName,
        });
        newConsumer.projector<ShoppingCartSummaryEvent>(processorOptions);

        let consumerPromise: Promise<void> | undefined;
        try {
          consumerPromise = newConsumer.start();
          await newConsumer.whenStarted();

          await eventStore.appendToStream(streamName, [
            { type: 'ProductItemAdded', data: { productItem } },
            { type: 'ShoppingCartConfirmed', data: { confirmedAt } },
          ] as ShoppingCartSummaryEvent[]);

          await newConsumer.whenCaughtUp();

          assertDeepEqual(await summaryFor(streamName), {
            _id: streamName,
            status: 'confirmed',
            _version: 2n,
            productItemsCount: productItem.quantity * 3,
          });
        } finally {
          await newConsumer.close();
          await consumerPromise;
        }
      },
    );
  });

  void describe('created by the event store', () => {
    void it(
      'catches up with events appended before it was started',
      withDeadline,
      async () => {
        const streamName = `shopping_cart-shoppingCart:${uuid()}`;
        await eventStore.appendToStream(streamName, [
          { type: 'ProductItemAdded', data: { productItem } },
          { type: 'ShoppingCartConfirmed', data: { confirmedAt } },
        ] as ShoppingCartSummaryEvent[]);

        const consumer = eventStore.consumer();
        consumer.projector<ShoppingCartSummaryEvent>({
          processorId: uuid(),
          projection: shoppingCartsSummaryProjection,
        });

        let consumerPromise: Promise<void> | undefined;
        try {
          consumerPromise = consumer.start();

          await consumer.whenCaughtUp();

          assertMatches(await summaryFor(streamName), {
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
  });

  const summaryFor = (streamName: string) =>
    pool.withConnection(async (connection) => {
      const driver = (await pongoDriverRegistry.tryResolve(
        connection.driverType,
      ))!;
      const pongo = pongoClient({ driver, connectionOptions: { connection } });
      try {
        return await pongo
          .db()
          .collection<ShoppingCartSummary>(shoppingCartsSummaryCollectionName)
          .findOne({ _id: streamName });
      } finally {
        await pongo.close();
      }
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

const shoppingCartsSummaryProjection = pongoSingleStreamProjection({
  collectionName: shoppingCartsSummaryCollectionName,
  evolve,
  canHandle: ['ProductItemAdded', 'ShoppingCartConfirmed'],
  initialState: () => ({
    status: 'pending',
    productItemsCount: 0,
  }),
});
