import {
  dumbo,
  rawSql,
  single,
  sql,
  type NodePostgresPool,
} from '@event-driven-io/dumbo';
import {
  assertDeepEqual,
  asyncAwaiter,
  projections,
  type ReadEvent,
} from '@event-driven-io/emmett';
import {
  pongoClient,
  type PongoClient,
  type PongoCollection,
  type PongoDb,
} from '@event-driven-io/pongo';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
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

const withDeadline = { timeout: 300000 };

void describe('PostgreSQL event store started consumer', () => {
  let postgres: StartedPostgreSqlContainer;
  let connectionString: string;
  let eventStore: PostgresEventStore;
  let pongo: PongoClient;
  let summaries: PongoCollection<ShoppingCartSummary>;
  let otherSummaries: PongoCollection<ShoppingCartSummary>;
  const productItem = { price: 10, productId: uuid(), quantity: 10 };
  const confirmedAt = new Date();
  let db: PongoDb;
  let pool: NodePostgresPool;

  before(async () => {
    postgres = await new PostgreSqlContainer().start();
    connectionString = postgres.getConnectionUri();

    eventStore = getPostgreSQLEventStore(connectionString, {
      projections: projections.inline([
        shoppingCartsSummaryProjection,
        otherShoppingCartsSummaryProjection,
      ]),
    });
    pongo = pongoClient(connectionString);
    db = pongo.db();
    summaries = db.collection(shoppingCartsSummaryCollectionName);
    otherSummaries = db.collection(otherShoppingCartsSummaryCollectionName);
    pool = dumbo({ connectionString });
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
        projection: shoppingCartsSummaryProjectionV2,
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
          shoppingCartsSummaryProjectionV2,
          otherShoppingCartsSummaryProjectionV2,
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

    void it(
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
          sql(
            `UPDATE emt_processors
             SET last_updated = now() - interval '%s seconds'
             WHERE processor_id = %L`,
            '400',
            'timeout-takeover-test',
          ),
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
            sql(
              `SELECT status FROM emt_projections WHERE name = %L`,
              'timeout-takeover-test',
            ),
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

const shoppingCartsSummaryProjectionV2 = pongoSingleStreamProjection({
  collectionName: shoppingCartsSummaryCollectionName,
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

const otherShoppingCartsSummaryProjectionV2 = pongoSingleStreamProjection({
  collectionName: otherShoppingCartsSummaryCollectionName,
  evolve: evolveV2,
  canHandle: ['ProductItemAdded', 'ShoppingCartConfirmed'],
  initialState: () => ({
    status: 'pending',
    productItemsCount: 0,
  }),
});

const createRebuildTestProjection = (
  name: string,
  tableName: string,
  options: {
    onEvolve?: (processedCount: number) => void | Promise<void>;
  } = {},
) => {
  let processed = 0;

  return {
    projection: postgreSQLRawSQLProjection<ProductItemAdded>({
      name,
      canHandle: ['ProductItemAdded'],
      initSQL: rawSql(
        `CREATE TABLE IF NOT EXISTS ${tableName} (event_id TEXT PRIMARY KEY, product_id TEXT, quantity INT)`,
      ),
      evolve: async (event) => {
        if (options.onEvolve) {
          await options.onEvolve(processed + 1);
        }
        processed++;
        return rawSql(
          `INSERT INTO ${tableName} (event_id, product_id, quantity) VALUES ('${(event as ReadEvent<ProductItemAdded>).metadata.messageId}', '${event.data.productItem.productId}', ${event.data.productItem.quantity})`,
        );
      },
    }),
    processedCount: () => processed,
    reset: () => {
      processed = 0;
    },
    rowCount: async (p: NodePostgresPool) => {
      const result = await single<{ count: string }>(
        p.execute.query(sql(`SELECT COUNT(*) as count FROM ${tableName}`)),
      );
      return Number(result.count);
    },
    getProductIds: async (p: NodePostgresPool) => {
      const result = await p.execute.query<{ product_id: string }>(
        sql(`SELECT product_id FROM ${tableName}`),
      );
      return result.rows.map((row) => row.product_id);
    },
  };
};
