import { dumbo, single, SQL, type Dumbo } from '@event-driven-io/dumbo';
import { pgDumboDriver } from '@event-driven-io/dumbo/pg';
import {
  assertDeepEqual,
  asyncAwaiter,
  getProjectorId,
  projections,
  type ReadEvent,
} from '@event-driven-io/emmett';
import { getPostgreSQLStartedContainer } from '@event-driven-io/emmett-testcontainers';
import {
  pongoClient,
  type PongoClient,
  type PongoCollection,
  type PongoDb,
} from '@event-driven-io/pongo';
import { pgDriver } from '@event-driven-io/pongo/pg';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { after, before, beforeEach, describe, it } from 'node:test';
import { v4 as uuid } from 'uuid';
import type {
  ProductItemAdded,
  ShoppingCartConfirmed,
} from '../../testing/shoppingCart.domain';
import {
  getPostgreSQLEventStore,
  type PostgresEventStore,
} from '../postgreSQLEventStore';
import {
  pongoSingleStreamProjection,
  postgreSQLRawSQLProjection,
} from '../projections';
import { rebuildPostgreSQLProjections } from './rebuildPostgreSQLProjections';

const withDeadline = { timeout: 30000 };

void describe('Rebuilding PostgreSQL Projections', () => {
  let postgres: StartedPostgreSqlContainer;
  let connectionString: string;
  let eventStore: PostgresEventStore;
  let pongo: PongoClient;
  let summaries: PongoCollection<ShoppingCartSummary>;
  let otherSummaries: PongoCollection<ShoppingCartSummary>;
  let summariesV2: PongoCollection<ShoppingCartSummary>;
  let otherSummariesV2: PongoCollection<ShoppingCartSummary>;
  const productItem = { price: 10, productId: uuid(), quantity: 10 };
  const confirmedAt = new Date();
  let db: PongoDb;
  let pool: Dumbo;

  before(async () => {
    postgres = await getPostgreSQLStartedContainer();
    connectionString = postgres.getConnectionUri();

    eventStore = getPostgreSQLEventStore(connectionString, {
      projections: projections.inline([
        shoppingCartsSummaryProjection,
        otherShoppingCartsSummaryProjection,
      ]),
    });
    pongo = pongoClient({ connectionString, driver: pgDriver });
    db = pongo.db();
    summaries = db.collection(shoppingCartsSummaryCollectionName);
    otherSummaries = db.collection(otherShoppingCartsSummaryCollectionName);
    summariesV2 = db.collection(`${shoppingCartsSummaryCollectionName}_v2`);
    otherSummariesV2 = db.collection(
      `${otherShoppingCartsSummaryCollectionName}_v2`,
    );
    pool = dumbo({ connectionString, driver: pgDumboDriver });
  });

  beforeEach(async () => {
    await eventStore.schema.dangerous.truncate({ truncateProjections: true });
  });

  after(async () => {
    try {
      await eventStore.close();
      await pongo.close();
      await pool.close();
      await postgres.stop();
    } catch (error) {
      console.log(error);
    }
  });

  void describe('rebuildPostgreSQLProjections', () => {
    void it('rebuilds single inline projections', withDeadline, async () => {
      // Given
      const shoppingCartId = `shoppingCart:${uuid()}`;
      const otherShoppingCartId = `shoppingCart:${uuid()}`;
      const streamName = `shopping_cart-${shoppingCartId}`;
      const otherStreamName = `shopping_cart-${otherShoppingCartId}`;
      const events: ShoppingCartSummaryEvent[] = [
        { type: 'ProductItemAdded', data: { productItem } },
        { type: 'ShoppingCartConfirmed', data: { confirmedAt } },
      ];

      await eventStore.appendToStream(streamName, events);
      await eventStore.appendToStream(otherStreamName, events);

      let summary = await summaries.findOne({ _id: streamName });
      let otherSummary = await summaries.findOne({ _id: otherStreamName });

      assertDeepEqual(summary, {
        _id: streamName,
        status: 'confirmed',
        _version: 2n,
        productItemsCount: productItem.quantity,
      });
      assertDeepEqual(otherSummary, {
        _id: otherStreamName,
        status: 'confirmed',
        _version: 2n,
        productItemsCount: productItem.quantity,
      });

      // When
      const consumer = rebuildPostgreSQLProjections({
        connectionString,
        projection: shoppingCartsSummaryProjectionNew,
      });

      try {
        await consumer.start();

        summary = await summaries.findOne({ _id: streamName });
        otherSummary = await summaries.findOne({ _id: otherStreamName });

        assertDeepEqual(summary, {
          _id: streamName,
          status: 'confirmed',
          _version: 2n,
          productItemsCount: productItem.quantity * v2QuantityMultiplier,
        });
        assertDeepEqual(otherSummary, {
          _id: otherStreamName,
          status: 'confirmed',
          _version: 2n,
          productItemsCount: productItem.quantity * v2QuantityMultiplier,
        });
      } finally {
        await consumer.close();
      }
    });

    void it('rebuilds multiple inline projection', withDeadline, async () => {
      // Given
      const shoppingCartId = `shoppingCart:${uuid()}`;
      const otherShoppingCartId = `shoppingCart:${uuid()}`;
      const streamName = `shopping_cart-${shoppingCartId}`;
      const otherStreamName = `shopping_cart-${otherShoppingCartId}`;
      const events: ShoppingCartSummaryEvent[] = [
        { type: 'ProductItemAdded', data: { productItem } },
        { type: 'ShoppingCartConfirmed', data: { confirmedAt } },
      ];

      await eventStore.appendToStream(streamName, events);
      await eventStore.appendToStream(otherStreamName, events);

      let p1Summary = await summaries.findOne({ _id: streamName });
      let p1OtherSummary = await summaries.findOne({ _id: otherStreamName });
      let p2Summary = await otherSummaries.findOne({ _id: streamName });
      let p2OtherSummary = await otherSummaries.findOne({
        _id: otherStreamName,
      });

      assertDeepEqual(p1Summary, {
        _id: streamName,
        status: 'confirmed',
        _version: 2n,
        productItemsCount: productItem.quantity,
      });
      assertDeepEqual(p1OtherSummary, {
        _id: otherStreamName,
        status: 'confirmed',
        _version: 2n,
        productItemsCount: productItem.quantity,
      });

      assertDeepEqual(p1Summary, p2Summary);
      assertDeepEqual(p1OtherSummary, p2OtherSummary);

      // When
      const consumer = rebuildPostgreSQLProjections({
        connectionString,
        projections: [
          shoppingCartsSummaryProjectionNew,
          otherShoppingCartsSummaryProjectionNew,
        ],
      });

      try {
        await consumer.start();

        p1Summary = await summaries.findOne({ _id: streamName });
        p1OtherSummary = await summaries.findOne({ _id: otherStreamName });
        p2Summary = await otherSummaries.findOne({ _id: streamName });
        p2OtherSummary = await otherSummaries.findOne({
          _id: otherStreamName,
        });

        assertDeepEqual(p1Summary, {
          _id: streamName,
          status: 'confirmed',
          _version: 2n,
          productItemsCount: productItem.quantity * v2QuantityMultiplier,
        });
        assertDeepEqual(p1OtherSummary, {
          _id: otherStreamName,
          status: 'confirmed',
          _version: 2n,
          productItemsCount: productItem.quantity * v2QuantityMultiplier,
        });
        assertDeepEqual(p1Summary, p2Summary);
        assertDeepEqual(p1OtherSummary, p2OtherSummary);
      } finally {
        await consumer.close();
      }
    });

    void it(
      'rebuilds multiple inline projection to new version',
      withDeadline,
      async () => {
        // Given
        const shoppingCartId = `shoppingCart:${uuid()}`;
        const otherShoppingCartId = `shoppingCart:${uuid()}`;
        const streamName = `shopping_cart-${shoppingCartId}`;
        const otherStreamName = `shopping_cart-${otherShoppingCartId}`;
        const events: ShoppingCartSummaryEvent[] = [
          { type: 'ProductItemAdded', data: { productItem } },
          { type: 'ShoppingCartConfirmed', data: { confirmedAt } },
        ];

        await eventStore.appendToStream(streamName, events);
        await eventStore.appendToStream(otherStreamName, events);

        const p1Summary = await summaries.findOne({ _id: streamName });
        const p1OtherSummary = await summaries.findOne({
          _id: otherStreamName,
        });
        const p2Summary = await otherSummaries.findOne({ _id: streamName });
        const p2OtherSummary = await otherSummaries.findOne({
          _id: otherStreamName,
        });

        assertDeepEqual(p1Summary, {
          _id: streamName,
          status: 'confirmed',
          _version: 2n,
          productItemsCount: productItem.quantity,
        });
        assertDeepEqual(p1OtherSummary, {
          _id: otherStreamName,
          status: 'confirmed',
          _version: 2n,
          productItemsCount: productItem.quantity,
        });

        assertDeepEqual(p1Summary, p2Summary);
        assertDeepEqual(p1OtherSummary, p2OtherSummary);

        // When
        const consumer = rebuildPostgreSQLProjections({
          connectionString,
          projections: [
            shoppingCartsSummaryProjectionV2,
            otherShoppingCartsSummaryProjectionV2,
          ],
        });

        try {
          await consumer.start();

          const p1SummaryV2 = await summariesV2.findOne({ _id: streamName });
          const p1OtherSummaryV2 = await summariesV2.findOne({
            _id: otherStreamName,
          });
          const p2SummaryV2 = await otherSummariesV2.findOne({
            _id: streamName,
          });
          const p2OtherSummaryV2 = await otherSummariesV2.findOne({
            _id: otherStreamName,
          });

          assertDeepEqual(p1SummaryV2, {
            _id: streamName,
            status: 'confirmed',
            _version: 2n,
            productItemsCount: productItem.quantity * v2QuantityMultiplier,
          });
          assertDeepEqual(p1OtherSummaryV2, {
            _id: otherStreamName,
            status: 'confirmed',
            _version: 2n,
            productItemsCount: productItem.quantity * v2QuantityMultiplier,
          });
          assertDeepEqual(p1SummaryV2, p2SummaryV2);
          assertDeepEqual(p1OtherSummaryV2, p2OtherSummaryV2);

          // Ensure old is not touched

          assertDeepEqual(
            p1Summary,
            await summaries.findOne({ _id: streamName }),
          );
          assertDeepEqual(
            p1OtherSummary,
            await summaries.findOne({
              _id: otherStreamName,
            }),
          );
          assertDeepEqual(
            p2Summary,
            await otherSummaries.findOne({ _id: streamName }),
          );
          assertDeepEqual(
            p2OtherSummary,
            await otherSummaries.findOne({
              _id: otherStreamName,
            }),
          );
        } finally {
          await consumer.close();
        }
      },
    );

    void it(
      'continues rebuilding from checkpoint after crash',
      withDeadline,
      async () => {
        const streamName = `product-stream-${uuid()}`;
        const productIds = Array.from({ length: 5 }, () => it.toString());
        const events: ProductItemAdded[] = productIds.map(
          (productId, i): ProductItemAdded => ({
            type: 'ProductItemAdded',
            data: { productItem: { productId, quantity: i, price: i } },
          }),
        );

        await eventStore.appendToStream(streamName, events);

        let shouldCrash = true;
        const { projection, processedCount, reset, rowCount, getProductIds } =
          createRebuildTestProjection(
            'crash-recovery-test',
            'rebuild_test_events',
            1,
            {
              onEvolve: (count) => {
                if (shouldCrash && count === 3) {
                  throw new Error('Simulated crash during rebuild');
                }
              },
            },
          );

        const consumer1 = rebuildPostgreSQLProjections({
          connectionString,
          projection,
          pulling: { batchSize: 1 },
        });

        try {
          await consumer1.start();
        } catch {
          // Expected crash
        } finally {
          await consumer1.close();
        }

        assertDeepEqual(processedCount(), 2);
        assertDeepEqual(await rowCount(pool), 2);

        reset();
        shouldCrash = false;

        const consumer2 = rebuildPostgreSQLProjections({
          connectionString,
          projection,
        });

        try {
          await consumer2.start();
        } finally {
          await consumer2.close();
        }

        assertDeepEqual(processedCount(), 3);
        assertDeepEqual(await rowCount(pool), 5);
        assertDeepEqual((await getProductIds(pool)).sort(), productIds.sort());
      },
    );

    void it.skip(
      'allows takeover after timeout when processor is stuck',
      withDeadline,
      async () => {
        const streamName = `product-stream-${uuid()}`;
        const productIds = Array.from({ length: 5 }, () => uuid());
        const events: ProductItemAdded[] = productIds.map(
          (productId, i): ProductItemAdded => ({
            type: 'ProductItemAdded',
            data: { productItem: { productId, quantity: i, price: i } },
          }),
        );

        await eventStore.appendToStream(streamName, events);

        const reachedTwo = asyncAwaiter();
        const waitBeforeProcessing = asyncAwaiter();
        const { projection, rowCount, getProductIds } =
          createRebuildTestProjection(
            'timeout-takeover-test',
            'timeout_test_events',
            1,
            {
              onEvolve: async (count) => {
                if (count === 2) {
                  reachedTwo.resolve();
                }
                if (count > 2) {
                  await waitBeforeProcessing.wait;
                }
              },
            },
          );

        const consumer1 = rebuildPostgreSQLProjections({
          connectionString,
          projection,
          pulling: { batchSize: 1 },
        });

        const consumer1Promise = consumer1.start();

        await reachedTwo.wait;

        await pool.execute.command(
          SQL`UPDATE emt_processors
             SET last_updated = now() - interval '400 seconds'
             WHERE processor_id = ${getProjectorId({ projectionName: 'timeout-takeover-test' })}`,
        );

        waitBeforeProcessing.resolve();

        const consumer2 = rebuildPostgreSQLProjections({
          connectionString,
          projection,
        });

        try {
          await consumer2.start();
        } finally {
          await consumer2.close();
          // TODO:Simulate releasing lock without closing the consumer
          try {
            await consumer1Promise;
          } catch {
            // Expected error from first consumer
          } finally {
            await consumer1.close();
          }
        }

        assertDeepEqual(await rowCount(pool), 5);
        assertDeepEqual((await getProductIds(pool)).sort(), productIds.sort());

        const projectionStatus = await single<{ status: string }>(
          pool.execute.query(
            SQL`SELECT status FROM emt_projections WHERE name = 'timeout-takeover-test'`,
          ),
        );
        assertDeepEqual(projectionStatus.status, 'active');
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
const otherShoppingCartsSummaryCollectionName = 'otherShoppingCartsSummary';

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
      return {
        ...document,
        status: 'confirmed',
      };
    default:
      return document;
  }
};

const v2QuantityMultiplier = 1.76;

const evolveV2 = (
  document: ShoppingCartSummary,
  { type, data }: ReadEvent<ShoppingCartSummaryEvent>,
): ShoppingCartSummary => {
  switch (type) {
    case 'ProductItemAdded':
      return {
        ...document,
        productItemsCount:
          // Multiply the quantity of product items to show differenece between v1 and v2
          document.productItemsCount +
          data.productItem.quantity * v2QuantityMultiplier,
      };
    case 'ShoppingCartConfirmed':
      return {
        ...document,
        status: 'confirmed',
      };
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

const shoppingCartsSummaryProjectionNew = pongoSingleStreamProjection({
  collectionName: shoppingCartsSummaryCollectionName,
  evolve: evolveV2,
  canHandle: ['ProductItemAdded', 'ShoppingCartConfirmed'],
  initialState: () => ({
    status: 'pending',
    productItemsCount: 0,
  }),
});
const shoppingCartsSummaryProjectionV2 = pongoSingleStreamProjection({
  collectionName: shoppingCartsSummaryCollectionName,
  version: 2,
  evolve: evolveV2,
  canHandle: ['ProductItemAdded', 'ShoppingCartConfirmed'],
  initialState: () => ({
    status: 'pending',
    productItemsCount: 0,
  }),
});

const otherShoppingCartsSummaryProjection = pongoSingleStreamProjection({
  collectionName: otherShoppingCartsSummaryCollectionName,
  evolve,
  canHandle: ['ProductItemAdded', 'ShoppingCartConfirmed'],
  initialState: () => ({
    status: 'pending',
    productItemsCount: 0,
  }),
});

const otherShoppingCartsSummaryProjectionNew = pongoSingleStreamProjection({
  collectionName: otherShoppingCartsSummaryCollectionName,
  evolve: evolveV2,
  canHandle: ['ProductItemAdded', 'ShoppingCartConfirmed'],
  initialState: () => ({
    status: 'pending',
    productItemsCount: 0,
  }),
});

const otherShoppingCartsSummaryProjectionV2 = pongoSingleStreamProjection({
  collectionName: otherShoppingCartsSummaryCollectionName,
  version: 2,
  evolve: evolveV2,
  canHandle: ['ProductItemAdded', 'ShoppingCartConfirmed'],
  initialState: () => ({
    status: 'pending',
    productItemsCount: 0,
  }),
});

const getTableFullName = (name: string, version: number) =>
  version === 1 ? name : `${name}_v${version}`;

const createRebuildTestProjection = (
  name: string,
  tableName: string,
  version: number,
  options: {
    onEvolve?: (processedCount: number) => void | Promise<void>;
  } = {},
) => {
  let processed = 0;

  const tableFullName = getTableFullName(tableName, version);

  return {
    projection: postgreSQLRawSQLProjection<ProductItemAdded>({
      name,
      canHandle: ['ProductItemAdded'],
      init: () =>
        SQL`CREATE TABLE IF NOT EXISTS ${SQL.identifier(tableFullName)} (event_id TEXT PRIMARY KEY, product_id TEXT, quantity INT)`,
      evolve: async (event) => {
        if (options.onEvolve) {
          await options.onEvolve(processed + 1);
        }
        processed++;
        return SQL`
          INSERT INTO ${SQL.identifier(tableFullName)} (event_id, product_id, quantity) 
          VALUES (${(event as ReadEvent<ProductItemAdded>).metadata.messageId}, ${event.data.productItem.productId}, ${event.data.productItem.quantity})`;
      },
    }),
    processedCount: () => processed,
    reset: () => {
      processed = 0;
    },
    rowCount: async (p: Dumbo) => {
      const result = await single<{ count: string }>(
        p.execute.query(
          SQL`SELECT COUNT(*) as count FROM ${SQL.identifier(tableFullName)}`,
        ),
      );
      return Number(result.count);
    },
    getProductIds: async (p: Dumbo) => {
      const result = await p.execute.query<{ product_id: string }>(
        SQL`SELECT product_id FROM ${SQL.identifier(tableFullName)}`,
      );
      return result.rows.map((row) => row.product_id);
    },
  };
};
