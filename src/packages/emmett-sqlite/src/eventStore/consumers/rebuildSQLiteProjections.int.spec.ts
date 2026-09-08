import { sqlite3Pool, type SQLitePool } from '@event-driven-io/dumbo/sqlite3';
import {
  assertDeepEqual,
  projections,
  type ReadEvent,
} from '@event-driven-io/emmett';
import {
  pongoClient,
  type PongoClient,
  type PongoCollection,
} from '@event-driven-io/pongo';
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
import { pongoDriverOf } from '../eventStoreDriver';
import { pongoSingleStreamProjection } from '../projections';
import {
  getSQLiteEventStore,
  type SQLiteEventStore,
} from '../SQLiteEventStore';
import { rebuildSQLiteProjections } from './rebuildSQLiteProjections';

const withDeadline = { timeout: 30000 };

void describe('Rebuilding SQLite projections', () => {
  const testDatabasePath = path.dirname(fileURLToPath(import.meta.url));
  const fileName = path.resolve(testDatabasePath, 'rebuild.test.db');
  const productItem = { price: 10, productId: uuid(), quantity: 10 };
  const confirmedAt = new Date();
  const events: ShoppingCartSummaryEvent[] = [
    { type: 'ProductItemAdded', data: { productItem } },
    { type: 'ShoppingCartConfirmed', data: { confirmedAt } },
  ];

  let pool: SQLitePool;
  let eventStore: SQLiteEventStore;
  let pongo: PongoClient;
  let summaries: PongoCollection<ShoppingCartSummary>;
  let otherSummaries: PongoCollection<ShoppingCartSummary>;

  beforeEach(() => {
    pool = sqlite3Pool({
      fileName,
      transactionOptions: { allowNestedTransactions: true },
    });
    eventStore = getSQLiteEventStore({
      driver: sqlite3EventStoreDriver,
      schema: { autoMigration: 'CreateOrUpdate' },
      fileName,
      pool,
      projections: projections.inline([
        shoppingCartsSummaryProjection,
        otherShoppingCartsSummaryProjection,
      ]),
    });
    pongo = pongoClient({
      driver: pongoDriverOf(sqlite3EventStoreDriver),
      connectionOptions: {
        fileName,
        transactionOptions: { allowNestedTransactions: true },
      },
    });
    summaries = pongo.db().collection(shoppingCartsSummaryCollectionName);
    otherSummaries = pongo
      .db()
      .collection(otherShoppingCartsSummaryCollectionName);
  });

  afterEach(async () => {
    await pongo.close();
    await eventStore.close();
    await pool.close();
    deleteSQLiteDatabaseFiles(fileName);
  });

  void it('rebuilds a single inline projection', withDeadline, async () => {
    // Given
    const streamName = `shopping_cart-shoppingCart:${uuid()}`;
    await eventStore.appendToStream(streamName, events);

    assertDeepEqual(await summaries.findOne({ _id: streamName }), {
      _id: streamName,
      status: 'confirmed',
      _version: 1n,
      productItemsCount: productItem.quantity,
    });

    // When
    const consumer = rebuildSQLiteProjections({
      driver: sqlite3EventStoreDriver,
      fileName,
      projection: shoppingCartsSummaryProjectionNew,
    });

    try {
      await consumer.start();

      // Then
      assertDeepEqual(await summaries.findOne({ _id: streamName }), {
        _id: streamName,
        status: 'confirmed',
        _version: 1n,
        productItemsCount: productItem.quantity * v2QuantityMultiplier,
      });
    } finally {
      await consumer.close();
    }
  });

  void it('rebuilds multiple inline projections', withDeadline, async () => {
    // Given
    const streamName = `shopping_cart-shoppingCart:${uuid()}`;
    const otherStreamName = `shopping_cart-shoppingCart:${uuid()}`;

    await eventStore.appendToStream(streamName, events);
    await eventStore.appendToStream(otherStreamName, events);

    assertDeepEqual(
      await summaries.findOne({ _id: streamName }),
      await otherSummaries.findOne({ _id: streamName }),
    );

    // When
    const consumer = rebuildSQLiteProjections({
      driver: sqlite3EventStoreDriver,
      fileName,
      projections: [
        shoppingCartsSummaryProjectionNew,
        otherShoppingCartsSummaryProjectionNew,
      ],
    });

    try {
      await consumer.start();

      // Then
      for (const collection of [summaries, otherSummaries]) {
        for (const stream of [streamName, otherStreamName]) {
          assertDeepEqual(await collection.findOne({ _id: stream }), {
            _id: stream,
            status: 'confirmed',
            _version: 1n,
            productItemsCount: productItem.quantity * v2QuantityMultiplier,
          });
        }
      }
    } finally {
      await consumer.close();
    }
  });

  void it(
    'leaves no documents behind for streams that were rebuilt',
    withDeadline,
    async () => {
      // Given
      const streamNames = [
        `shopping_cart-shoppingCart:${uuid()}`,
        `shopping_cart-shoppingCart:${uuid()}`,
      ];

      for (const streamName of streamNames)
        await eventStore.appendToStream(streamName, events);

      // When
      const consumer = rebuildSQLiteProjections({
        driver: sqlite3EventStoreDriver,
        fileName,
        projection: shoppingCartsSummaryProjectionNew,
      });

      try {
        await consumer.start();

        // Then
        const documents = await summaries.find({});

        assertDeepEqual(documents.length, streamNames.length);
      } finally {
        await consumer.close();
      }
    },
  );
});

type ShoppingCartSummary = {
  _id?: string;
  productItemsCount: number;
  status: string;
};

type ShoppingCartSummaryEvent = ProductItemAdded | ShoppingCartConfirmed;

const shoppingCartsSummaryCollectionName = 'shoppingCartsSummary';
const otherShoppingCartsSummaryCollectionName = 'otherShoppingCartsSummary';

const v2QuantityMultiplier = 2;

const productItemQuantity = (
  document: ShoppingCartSummary,
  { type, data }: ReadEvent<ShoppingCartSummaryEvent>,
  multiplier: number,
): ShoppingCartSummary => {
  switch (type) {
    case 'ProductItemAdded':
      return {
        ...document,
        productItemsCount:
          document.productItemsCount + data.productItem.quantity * multiplier,
      };
    case 'ShoppingCartConfirmed':
      return { ...document, status: 'confirmed' };
    default:
      return document;
  }
};

const summaryProjection = (collectionName: string, multiplier: number) =>
  pongoSingleStreamProjection({
    collectionName,
    canHandle: ['ProductItemAdded', 'ShoppingCartConfirmed'],
    evolve: (
      document: ShoppingCartSummary,
      event: ReadEvent<ShoppingCartSummaryEvent>,
    ) => productItemQuantity(document, event, multiplier),
    initialState: () => ({ status: 'pending', productItemsCount: 0 }),
  });

const shoppingCartsSummaryProjection = summaryProjection(
  shoppingCartsSummaryCollectionName,
  1,
);

const shoppingCartsSummaryProjectionNew = summaryProjection(
  shoppingCartsSummaryCollectionName,
  v2QuantityMultiplier,
);

const otherShoppingCartsSummaryProjection = summaryProjection(
  otherShoppingCartsSummaryCollectionName,
  1,
);

const otherShoppingCartsSummaryProjectionNew = summaryProjection(
  otherShoppingCartsSummaryCollectionName,
  v2QuantityMultiplier,
);
