import type { D1Database } from '@cloudflare/workers-types';
import { JSONSerializer } from '@event-driven-io/dumbo';
import {
  d1Pool,
  type D1ConnectionPool,
} from '@event-driven-io/dumbo/cloudflare';
import {
  assertDeepEqual,
  assertMatches,
  type ReadEvent,
} from '@event-driven-io/emmett';
import { pongoClient } from '@event-driven-io/pongo';
import { Miniflare } from 'miniflare';
import { v4 as uuid } from 'uuid';
import { afterEach, beforeEach, describe, it } from 'vitest';
import { d1EventStoreDriver, type D1EventStoreDriver } from '../..';
import type {
  ProductItemAdded,
  ShoppingCartConfirmed,
} from '../../../../testing/shoppingCart.domain';
import { createEventStoreSchema } from '../../../../eventStore/schema';
import {
  getSQLiteEventStore,
  type SQLiteEventStore,
} from '../../../../eventStore/SQLiteEventStore';
import { pongoSingleStreamProjection } from '../../../../eventStore/projections';
import { sqliteEventStoreConsumer } from '../../../../eventStore/consumers/sqliteEventStoreConsumer';
import type { SQLiteProjectorOptions } from '../../../../eventStore/consumers/sqliteProcessor';
import { pongoDriverOf } from '../../../../eventStore/eventStoreDriver';

const withDeadline = { timeout: 30000 };

void describe('SQLite event store started consumer', () => {
  const productItem = { price: 10, productId: uuid(), quantity: 10 };
  const confirmedAt = new Date();

  let mf: Miniflare;
  let database: D1Database;
  let pool: D1ConnectionPool;
  let eventStore: SQLiteEventStore;

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
    await createEventStoreSchema({
      pool: d1Pool({
        database,
        serialization: { serializer: JSONSerializer },
        transactionOptions: { mode: 'session_based' },
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

        const consumer = sqliteEventStoreConsumer({
          driver: d1EventStoreDriver,
          database,
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
          driver: d1EventStoreDriver,
          database,
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
          driver: d1EventStoreDriver,
          database,
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
          driver: d1EventStoreDriver,
          database,
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
          driver: d1EventStoreDriver,
          database,
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

        const processorOptions: SQLiteProjectorOptions<
          ShoppingCartSummaryEvent,
          ShoppingCartSummaryEvent,
          D1EventStoreDriver
        > = {
          processorId: uuid(),
          projection: shoppingCartsSummaryProjection,
          startFrom: 'CURRENT',
          stopAfter: (event) => event.metadata.globalPosition === startPosition,
        };

        const consumer = sqliteEventStoreConsumer({
          driver: d1EventStoreDriver,
          database,
        });
        try {
          consumer.projector<ShoppingCartSummaryEvent>(processorOptions);

          await consumer.start();
        } finally {
          await consumer.close();
        }

        const newConsumer = sqliteEventStoreConsumer({
          driver: d1EventStoreDriver,
          database,
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
      const driver = pongoDriverOf(d1EventStoreDriver);
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
