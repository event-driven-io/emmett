import 'dotenv/config';

import type { ReadEvent } from '@event-driven-io/emmett';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { bench, group, run } from 'mitata';
import { randomUUID } from 'node:crypto';
import { generateBatches, type BatchConfig } from './loadTestGenerator';
import {
  getPostgreSQLEventStore,
  type PostgresEventStore,
  type PostgresEventStoreConnectionOptions,
} from '..';
import { rebuildPostgreSQLProjections } from '../eventStore/consumers/rebuildPostgreSQLProjections';
import { pongoSingleStreamProjection } from '../eventStore/projections';
import type { ProductItemAdded } from '../testing/shoppingCart.domain';

let postgres: StartedPostgreSqlContainer = undefined!;

if (!process.env.BENCHMARK_POSTGRESQL_CONNECTION_STRING)
  postgres = await new PostgreSqlContainer('postgres').start();

const connectionString =
  process.env.BENCHMARK_POSTGRESQL_CONNECTION_STRING ??
  postgres.getConnectionUri();

console.log(`Using PostgreSQL connection string: ${connectionString}`);

const connectionOptions: PostgresEventStoreConnectionOptions | undefined =
  process.env.BENCHMARK_CONNECTION_POOLED !== 'false'
    ? undefined
    : { pooled: false };

const generateSchemaUpfront =
  process.env.BENCHMARK_GENERATE_SCHEMA_UPFRONT !== 'false';

const eventStore: PostgresEventStore = getPostgreSQLEventStore(
  connectionString,
  {
    connectionOptions,
    schema: {
      autoMigration: generateSchemaUpfront ? 'None' : 'CreateOrUpdate',
    },
  },
);

if (generateSchemaUpfront) await eventStore.schema.migrate();

type ShoppingCartSummary = {
  _id?: string;
  productItemsCount: number;
};

const evolve = (
  document: ShoppingCartSummary,
  { data }: ReadEvent<ProductItemAdded>,
): ShoppingCartSummary => ({
  ...document,
  productItemsCount: document.productItemsCount + data.productItem.quantity,
});

const createProjection = (collectionName: string) =>
  pongoSingleStreamProjection<ShoppingCartSummary, ProductItemAdded>({
    collectionName,
    evolve,
    canHandle: ['ProductItemAdded'],
    initialState: () => ({ status: 'pending', productItemsCount: 0 }),
  });

// EVENT GENERATION

const productItemAdded = (): ProductItemAdded => ({
  type: 'ProductItemAdded',
  data: {
    productItem: {
      productId: randomUUID().padEnd(2000, 'x'),
      quantity: Math.floor(Math.random() * 10) + 1,
      price: Math.floor(Math.random() * 100) + 1,
    },
  },
});

// SEEDING

async function seedEvents(
  store: PostgresEventStore,
  totalEvents: number,
): Promise<void> {
  const config: BatchConfig = {
    totalEvents,
    maxStreamLength: 100,
    batchSize: 10,
  };
  for (const { streamName, events } of generateBatches(
    config,
    () => `shopping_cart-${randomUUID()}`,
    productItemAdded,
  )) {
    await store.appendToStream(streamName, events);
  }
}

const ALL_EVENT_COUNTS = [
  1_000, 10_000, 100_000, 500_000, 1_000_000, 5_000_000,
];

const EVENT_COUNTS = process.env.BENCHMARK_EVENT_COUNTS
  ? process.env.BENCHMARK_EVENT_COUNTS.split(',').map((s) =>
      parseInt(s.trim(), 10),
    )
  : ALL_EVENT_COUNTS;

const ALL_BATCH_SIZES = [10, 100, 1_000, 2_000];

const BATCH_SIZES = process.env.BENCHMARK_BATCH_SIZES
  ? process.env.BENCHMARK_BATCH_SIZES.split(',').map((s) =>
      parseInt(s.trim(), 10),
    )
  : ALL_BATCH_SIZES;

for (const eventCount of EVENT_COUNTS) {
  console.log(`\nSeeding ${eventCount} events...`);
  await eventStore.schema.dangerous.truncate({ truncateProjections: true });
  await seedEvents(eventStore, eventCount);
  console.log(`  Seeded ${eventCount} events.`);

  // BENCHMARKS — 1 projection

  group(`rebuild 1 projection - ${eventCount} events`, () => {
    for (const batchSize of BATCH_SIZES) {
      bench(`${eventCount}ev/1proj/batch ${batchSize}`, async () => {
        await eventStore.schema.dangerous.truncate({
          truncateProjections: true,
        });

        const projection = createProjection('bench_summary');
        const consumer = rebuildPostgreSQLProjections({
          connectionString,
          projection,
          pulling: { batchSize },
        });

        try {
          await consumer.start();
        } finally {
          await consumer.close();
        }
      });
    }
  });

  // BENCHMARKS — 2 projections

  group(`rebuild 2 projections - ${eventCount} events`, () => {
    for (const batchSize of BATCH_SIZES) {
      bench(`${eventCount}ev/2proj/batch ${batchSize}`, async () => {
        await eventStore.schema.dangerous.truncate({
          truncateProjections: true,
        });

        const projection1 = createProjection('bench_summary_p1');
        const projection2 = createProjection('bench_summary_p2');

        const consumer = rebuildPostgreSQLProjections({
          connectionString,
          projections: [projection1, projection2],
          pulling: { batchSize },
        });

        try {
          await consumer.start();
        } finally {
          await consumer.close();
        }
      });
    }
  });
}

// RESULTS

const results = await run();

const rows = results.benchmarks.flatMap((trial) =>
  trial.runs.map((r) => {
    if (r.stats === undefined)
      return { name: r.name, time: 'error', eventsPerSec: 'error' };

    const match = r.name.match(/^(\d+)ev\//);
    const ec = match ? parseInt(match[1]!, 10) : 1;
    const avgSeconds = r.stats.avg / 1e9;
    const eventsPerSec = Math.round(ec / avgSeconds);

    return {
      name: r.name,
      time: `${avgSeconds.toFixed(2)}s`,
      eventsPerSec: `${eventsPerSec.toLocaleString()} events/sec`,
    };
  }),
);

const nameW = Math.max(...rows.map((r) => r.name.length), 'Scenario'.length);
const timeW = Math.max(...rows.map((r) => r.time.length), 'Total Time'.length);
const rateW = Math.max(
  ...rows.map((r) => r.eventsPerSec.length),
  'Events/sec'.length,
);

console.log('\n' + '-'.repeat(nameW + timeW + rateW + 8));
console.log(
  `${'Scenario'.padEnd(nameW)}  ${'Total Time'.padStart(timeW)}  ${'Events/sec'.padStart(rateW)}`,
);
console.log('-'.repeat(nameW + timeW + rateW + 8));
for (const { name, time, eventsPerSec } of rows) {
  console.log(
    `${name.padEnd(nameW)}  ${time.padStart(timeW)}  ${eventsPerSec.padStart(rateW)}`,
  );
}

await eventStore.close();
if (postgres) await postgres.stop();
