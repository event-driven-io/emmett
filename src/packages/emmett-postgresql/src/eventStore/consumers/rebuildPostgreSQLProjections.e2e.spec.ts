import { dumbo, single, SQL, type Dumbo } from '@event-driven-io/dumbo';
import { pgDumboDriver } from '@event-driven-io/dumbo/pg';
import {
  assertDeepEqual,
  asyncAwaiter,
  projections,
  type ReadEvent,
} from '@event-driven-io/emmett';
import { getPostgreSQLStartedContainer } from '@event-driven-io/emmett-testcontainers';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { after, before, beforeEach, describe, it } from 'node:test';
import { v4 as uuid } from 'uuid';
import type { ProductItemAdded } from '../../testing/shoppingCart.domain';
import {
  getPostgreSQLEventStore,
  type PostgresEventStore,
} from '../postgreSQLEventStore';
import { postgreSQLRawSQLProjection } from '../projections';
import { rebuildPostgreSQLProjections } from './rebuildPostgreSQLProjections';

const withDeadline = { timeout: 10000 };

void describe('PostgreSQL projection rebuild with advisory locking', () => {
  let postgres: StartedPostgreSqlContainer;
  let connectionString: string;
  let eventStore: PostgresEventStore;
  let pool: Dumbo;

  before(async () => {
    postgres = await getPostgreSQLStartedContainer();
    connectionString = postgres.getConnectionUri();

    eventStore = getPostgreSQLEventStore(connectionString, {
      projections: projections.inline([]),
    });
    pool = dumbo({ connectionString, driver: pgDumboDriver });
  });

  beforeEach(async () => {
    await eventStore.schema.dangerous.truncate({ truncateProjections: true });
  });

  after(async () => {
    try {
      await eventStore.close();
      await pool.close();
      await postgres.stop();
    } catch (error) {
      console.log(error);
    }
  });

  void describe('Projection setup and recovery', () => {
    void it(
      'creates projection status row when projection does not exist',
      withDeadline,
      async () => {
        const streamName = `product-stream-${uuid()}`;
        const productIds = Array.from({ length: 3 }, () => uuid());
        const events: ProductItemAdded[] = productIds.map(
          (productId, i): ProductItemAdded => ({
            type: 'ProductItemAdded',
            data: { productItem: { productId, quantity: i, price: i } },
          }),
        );

        await eventStore.appendToStream(streamName, events);

        const { projection, rowCount, getProductIds } =
          createRebuildTestProjection(
            'new-projection-test',
            'new_projection_test_events',
          );

        const beforeRebuild = await pool.execute.query<{
          name: string;
          status: string;
        }>(
          SQL`SELECT name, status FROM emt_projections WHERE name = 'new-projection-test'`,
        );

        assertDeepEqual(beforeRebuild.rows.length, 0);

        const consumer = rebuildPostgreSQLProjections({
          connectionString,
          projection,
        });

        try {
          await consumer.start();

          const afterRebuild = await single<{ status: string }>(
            pool.execute.query(
              SQL`SELECT status FROM emt_projections WHERE name = 'new-projection-test'`,
            ),
          );

          assertDeepEqual(afterRebuild.status, 'active');
          assertDeepEqual(await rowCount(pool), 3);
          assertDeepEqual(
            (await getProductIds(pool)).sort(),
            productIds.sort(),
          );
        } finally {
          await consumer.close();
        }
      },
    );

    void it(
      'continues rebuild from checkpoint after process restart',
      withDeadline,
      async () => {
        const streamName = `product-stream-${uuid()}`;
        const productIds = Array.from({ length: 10 }, () => uuid());
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
            'checkpoint-recovery-test',
            'checkpoint_test_events',
            {
              onEvolve: (count) => {
                if (shouldCrash && count === 6) {
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

        assertDeepEqual(processedCount(), 5);
        assertDeepEqual(await rowCount(pool), 5);

        const checkpointAfterCrash = await pool.execute.query<{
          last_processed_checkpoint: string;
        }>(
          SQL`SELECT last_processed_checkpoint FROM emt_processors 
              WHERE processor_id = 'emt:processor:projector:checkpoint-recovery-test'`,
        );

        assertDeepEqual(checkpointAfterCrash.rows.length, 1);

        reset();
        shouldCrash = false;

        const consumer2 = rebuildPostgreSQLProjections({
          connectionString,
          projection,
          pulling: { batchSize: 1 },
        });

        try {
          await consumer2.start();

          assertDeepEqual(processedCount(), 5);
          assertDeepEqual(await rowCount(pool), 10);
          assertDeepEqual(
            (await getProductIds(pool)).sort(),
            productIds.sort(),
          );
        } finally {
          await consumer2.close();
        }
      },
    );
  });

  void describe.skip('Inline projection and rebuild coordination', () => {
    void it(
      'inline projections skip when rebuild holds exclusive lock',
      withDeadline,
      async () => {
        const testProjectionName = 'inline-skip-test';
        const tableName = 'inline_skip_test_events';

        const reachedMidpoint = asyncAwaiter();
        const rebuildIsWaiting = asyncAwaiter();
        const continueProcessing = asyncAwaiter();
        let shouldWait = false;

        const { projection, rowCount, reset } = createRebuildTestProjection(
          testProjectionName,
          tableName,
          {
            onEvolve: async (count) => {
              console.log(
                `[onEvolve] Processing event ${count}, shouldWait: ${shouldWait}`,
              );
              if (count === 1) {
                console.log(`[onEvolve] Resolving reachedMidpoint`);
                reachedMidpoint.resolve();
              }
              if (count > 1 && shouldWait) {
                console.log(
                  `[onEvolve] About to wait, signaling rebuildIsWaiting`,
                );
                rebuildIsWaiting.resolve();
                console.log(`[onEvolve] Waiting for continueProcessing`);
                await continueProcessing.wait;
                console.log(`[onEvolve] Continuing after wait`);
              }
            },
          },
        );

        const inlineEventStore = getPostgreSQLEventStore(connectionString, {
          projections: projections.inline([projection]),
        });

        try {
          console.log('[Test] Appending events to streamA');
          const streamA = `stream-a-${uuid()}`;
          const eventsA: ProductItemAdded[] = [
            {
              type: 'ProductItemAdded',
              data: {
                productItem: { productId: uuid(), quantity: 1, price: 10 },
              },
            },
            {
              type: 'ProductItemAdded',
              data: {
                productItem: { productId: uuid(), quantity: 2, price: 20 },
              },
            },
          ];

          await inlineEventStore.appendToStream(streamA, eventsA);
          console.log(
            '[Test] StreamA appended, row count:',
            await rowCount(pool),
          );

          assertDeepEqual(await rowCount(pool), 2);

          console.log(
            '[Test] Appending 2 more events to streamA for rebuild to process',
          );
          const moreEventsA: ProductItemAdded[] = [
            {
              type: 'ProductItemAdded',
              data: {
                productItem: { productId: uuid(), quantity: 5, price: 50 },
              },
            },
            {
              type: 'ProductItemAdded',
              data: {
                productItem: { productId: uuid(), quantity: 6, price: 60 },
              },
            },
          ];
          await inlineEventStore.appendToStream(streamA, moreEventsA);
          console.log(
            '[Test] More events appended, row count:',
            await rowCount(pool),
          );

          console.log('[Test] Truncating projection table for rebuild');
          await pool.execute.command(
            SQL`TRUNCATE TABLE ${SQL.identifier(tableName)}`,
          );

          console.log('[Test] Resetting processed counter');
          reset();

          console.log('[Test] Enabling wait flag for rebuild');
          shouldWait = true;

          console.log('[Test] Starting rebuild consumer');
          const consumer = rebuildPostgreSQLProjections({
            connectionString,
            projection,
            pulling: { batchSize: 1 },
          });

          const rebuildPromise = consumer.start();

          console.log('[Test] Waiting for reachedMidpoint');
          await reachedMidpoint.wait;
          console.log('[Test] Reached midpoint!');

          console.log('[Test] Waiting for rebuild to be in waiting state');
          await rebuildIsWaiting.wait;
          console.log('[Test] Rebuild is now waiting!');

          const statusDuringRebuild = await single<{ status: string }>(
            pool.execute.query(
              SQL`SELECT status FROM emt_projections WHERE name = ${testProjectionName}`,
            ),
          );

          console.log(
            '[Test] Status during rebuild:',
            statusDuringRebuild.status,
          );
          assertDeepEqual(statusDuringRebuild.status, 'async_processing');

          console.log('[Test] Appending events to streamB');
          const streamB = `stream-b-${uuid()}`;
          const eventsB: ProductItemAdded[] = [
            {
              type: 'ProductItemAdded',
              data: {
                productItem: { productId: uuid(), quantity: 3, price: 30 },
              },
            },
            {
              type: 'ProductItemAdded',
              data: {
                productItem: { productId: uuid(), quantity: 4, price: 40 },
              },
            },
          ];

          await inlineEventStore.appendToStream(streamB, eventsB);
          console.log('[Test] StreamB appended');

          console.log('[Test] Row count after streamB:', await rowCount(pool));
          assertDeepEqual(await rowCount(pool), 2);

          console.log('[Test] Resolving continueProcessing');
          continueProcessing.resolve();

          console.log('[Test] Waiting for rebuild to complete');
          await rebuildPromise;
          console.log('[Test] Rebuild completed');

          await consumer.close();
          console.log('[Test] Consumer closed');

          const statusAfterRebuild = await single<{ status: string }>(
            pool.execute.query(
              SQL`SELECT status FROM emt_projections WHERE name = ${testProjectionName}`,
            ),
          );

          assertDeepEqual(statusAfterRebuild.status, 'active');
          assertDeepEqual(await rowCount(pool), 4);
        } finally {
          await inlineEventStore.close();
        }
      },
    );
  });
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

      init: () =>
        SQL`CREATE TABLE IF NOT EXISTS ${SQL.identifier(tableName)} 
            (event_id TEXT PRIMARY KEY, product_id TEXT, quantity INT)`,
      evolve: async (event) => {
        if (options.onEvolve) {
          await options.onEvolve(processed + 1);
        }
        processed++;
        return SQL`
           INSERT INTO ${SQL.identifier(tableName)} (event_id, product_id, quantity) 
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
          SQL`SELECT COUNT(*) as count FROM ${SQL.identifier(tableName)}`,
        ),
      );
      return Number(result.count);
    },
    getProductIds: async (p: Dumbo) => {
      const result = await p.execute.query<{ product_id: string }>(
        SQL`SELECT product_id FROM ${SQL.identifier(tableName)}`,
      );
      return result.rows.map((row) => row.product_id);
    },
  };
};
