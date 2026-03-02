import 'dotenv/config';

import { CommandHandler, type Event } from '@event-driven-io/emmett';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { bench, group, run, summary } from 'mitata';
import { randomUUID } from 'node:crypto';
import {
  getPostgreSQLEventStore,
  type PostgresEventStoreConnectionOptions,
} from '..';

let postgres: StartedPostgreSqlContainer = undefined!;

if (!process.env.BENCHMARK_POSTGRESQL_CONNECTION_STRING)
  postgres = await new PostgreSqlContainer('postgres').start();

const connectionString =
  process.env.BENCHMARK_POSTGRESQL_CONNECTION_STRING ??
  postgres.getConnectionUri();

console.log(`Using PostgreSQL connection string: ${connectionString}`);

const connectionOptions: PostgresEventStoreConnectionOptions | undefined =
  process.env.BENCHMARK_CONNECTION_POOLED === 'true'
    ? undefined
    : { pooled: false };

const generateSchemaUpfront =
  process.env.BENCHMARK_GENERATE_SCHEMA_UPFRONT === 'true';

const eventStore = getPostgreSQLEventStore(connectionString, {
  connectionOptions,
  schema: {
    autoMigration: generateSchemaUpfront ? 'None' : 'CreateOrUpdate',
  },
});

// TYPING
type DidSomething = Event<'DidSomething', { id: number; description: string }>;

type WhatDidIDo =
  | { id: number; description: string }
  | { description: 'Nothing!' };

const evolve = (_state: WhatDidIDo, event: DidSomething): WhatDidIDo =>
  event.data;

const initialState = (): WhatDidIDo => ({ description: 'Nothing!' });
// TYPING

if (generateSchemaUpfront) await eventStore.schema.migrate();

// BENCHMARKS
const ids: string[] = [];

const appendEvents = (streamName = `weird-${randomUUID()}`) => {
  ids.push(streamName);
  return eventStore.appendToStream(streamName, [
    { type: 'DidSomething', data: { id: 1, description: 'something weird' } },
  ]);
};

const readEvents = () => eventStore.readStream(ids[0] ?? 'not-existing');

const aggregateStream = () =>
  eventStore.aggregateStream(ids[0] ?? 'not-existing', {
    evolve,
    initialState,
  });

export const handle = CommandHandler({ evolve, initialState });

const handleCommand = () =>
  handle(eventStore, ids[0]!, (state) => ({
    type: 'DidSomething',
    data: {
      id: 'id' in state ? state.id + 1 : 1,
      description: 'something weird',
    },
  }));
// BENCHMARKS

// Warm up before benchmarking
await appendEvents();

summary(() => {
  bench('Appending events', async () => {
    await appendEvents();
  });

  bench('Reading events', async () => {
    await readEvents();
  });

  bench('Aggregating stream', async () => {
    await aggregateStream();
  });
});

summary(() => {
  bench('Aggregating and Appending stream', async () => {
    await aggregateStream();
    await appendEvents();
  });

  bench('Command handling', async () => {
    await handleCommand();
  });
});

group('sequential throughput', () => {
  bench('1000 sequential appends', async () => {
    const batchId = `seq-${Date.now()}`;
    for (let i = 0; i < 1000; i++) {
      await appendEvents(`${batchId}-${i}`);
    }
  });
});

group('concurrent throughput (Promise.all)', () => {
  bench('1000 concurrent appends to unique streams', async () => {
    const batchId = `concurrent-${Date.now()}`;
    await Promise.all(
      Array.from({ length: 1000 }, (_, i) => appendEvents(`${batchId}-${i}`)),
    );
  });
});

const results = await run();

const rows = results.benchmarks.flatMap((trial) =>
  trial.runs
    .filter((r) => r.stats !== undefined)
    .map((r) => {
      const match = r.name.match(/^(\d+)\s/);
      const multiplier = match ? parseInt(match[1]!, 10) : 1;
      const opsPerSec = Math.round((multiplier * 1e9) / r.stats.avg);
      return { name: r.name, opsPerSec };
    }),
);

const nameWidth = Math.max(...rows.map((r) => r.name.length));
console.log('\nops/sec');
console.log('-'.repeat(nameWidth + 20));
for (const { name, opsPerSec } of rows) {
  console.log(
    `${name.padEnd(nameWidth)}  ${opsPerSec.toLocaleString().padStart(12)} ops/sec`,
  );
}

await eventStore.close();
if (postgres) await postgres.stop();
