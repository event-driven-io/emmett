import 'dotenv/config';

import type { Event, ReadEvent } from '@event-driven-io/emmett';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { randomUUID } from 'node:crypto';
import {
  getPostgreSQLEventStore,
  type PostgresEventStore,
  type PostgresEventStoreConnectionOptions,
} from '..';
import { rebuildPostgreSQLProjections } from '../eventStore/consumers/rebuildPostgreSQLProjections';
import { pongoSingleStreamProjection } from '../eventStore/projections';
import type { ProductItemAdded } from '../testing/shoppingCart.domain';
import type { EventGenerator } from './loadTestGenerator';
import { runLoadTest } from './loadTestGenerator';
import { postgresEventStoreAppender } from './messageBatchAppender';

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

const MAX_STREAM_LENGTH = 100;
const PRODUCT_ITEM_VARIANTS = 1;
const CONFIRMED_VARIANTS = 1;

const productItemAddedTypes = Array.from(
  { length: PRODUCT_ITEM_VARIANTS },
  (_, i) => `ProductItemAdded-${i}`,
);
const shoppingCartConfirmedTypes = Array.from(
  { length: CONFIRMED_VARIANTS },
  (_, i) => `ShoppingCartConfirmed-${i}`,
);

type ShoppingCartSummary = {
  _id?: string;
  status: 'pending' | 'confirmed';
  productItemsCount: number;
};

const evolve = (
  document: ShoppingCartSummary,
  { type, data }: ReadEvent<Event>,
): ShoppingCartSummary => {
  if (type.startsWith('ProductItemAdded')) {
    const { productItem } = data as ProductItemAdded['data'];
    return {
      ...document,
      productItemsCount: document.productItemsCount + productItem.quantity,
    };
  }
  if (type.startsWith('ShoppingCartConfirmed')) {
    return { ...document, status: 'confirmed' };
  }
  return document;
};

const createProjection = (collectionName: string) =>
  pongoSingleStreamProjection<ShoppingCartSummary, Event>({
    collectionName,
    evolve,
    canHandle: [...productItemAddedTypes, ...shoppingCartConfirmedTypes],
    initialState: () => ({ status: 'pending', productItemsCount: 0 }),
  });

// EVENT GENERATION

const shoppingCartEvent: EventGenerator = ({ streamPosition }) => {
  const isLast = streamPosition === MAX_STREAM_LENGTH - 1;
  if (isLast) {
    return {
      type: shoppingCartConfirmedTypes[streamPosition % CONFIRMED_VARIANTS]!,
      data: { confirmedAt: new Date() },
    };
  }
  return {
    type: productItemAddedTypes[streamPosition % PRODUCT_ITEM_VARIANTS]!,
    data: {
      productItem: {
        productId: randomUUID().padEnd(2000, 'x'),
        quantity: Math.floor(Math.random() * 10) + 1,
        price: Math.floor(Math.random() * 100) + 1,
      },
    },
  };
};

// SEEDING

async function seedEvents(
  store: PostgresEventStore,
  totalEvents: number,
): Promise<void> {
  await runLoadTest(
    {
      totalEvents,
      streamTypes: 1,
      maxStreamLength: MAX_STREAM_LENGTH,
      batchSize: 10,
      partitions: 1,
    },
    shoppingCartEvent,
    postgresEventStoreAppender(store),
  );
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

type Result = { name: string; seconds: number; eventsPerSec: number };
const results: Result[] = [];

const measureRebuild = async (
  name: string,
  eventCount: number,
  makeConsumer: () => ReturnType<typeof rebuildPostgreSQLProjections>,
): Promise<void> => {
  const consumer = makeConsumer();
  const startedAt = performance.now();
  try {
    await consumer.start();
  } finally {
    await consumer.close();
  }
  const seconds = (performance.now() - startedAt) / 1000;
  results.push({
    name,
    seconds,
    eventsPerSec: Math.round(eventCount / seconds),
  });
};

for (const eventCount of EVENT_COUNTS) {
  console.log(`\nSeeding ${eventCount} events...`);
  await eventStore.schema.dangerous.truncate({ truncateProjections: true });
  await seedEvents(eventStore, eventCount);
  console.log(`Seeded ${eventCount} events.`);

  for (const batchSize of BATCH_SIZES) {
    await measureRebuild(
      `${eventCount}ev/1proj/batch ${batchSize}`,
      eventCount,
      () =>
        rebuildPostgreSQLProjections({
          connectionString,
          projection: createProjection('bench_summary'),
          pulling: { batchSize },
        }),
    );
  }

  for (const batchSize of BATCH_SIZES) {
    await measureRebuild(
      `${eventCount}ev/2proj/batch ${batchSize}`,
      eventCount,
      () =>
        rebuildPostgreSQLProjections({
          connectionString,
          projections: [
            createProjection('bench_summary_p1'),
            createProjection('bench_summary_p2'),
          ],
          pulling: { batchSize },
        }),
    );
  }
}

// RESULTS

const rows = results.map((r) => ({
  name: r.name,
  time: `${r.seconds.toFixed(2)}s`,
  eventsPerSec: `${r.eventsPerSec.toLocaleString()} events/sec`,
}));

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
