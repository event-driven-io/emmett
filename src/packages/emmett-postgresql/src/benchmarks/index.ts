import 'dotenv/config';

import { CommandHandler, type Event } from '@event-driven-io/emmett';
import Benchmark from 'benchmark';
import { randomUUID } from 'node:crypto';
import {
  getPostgreSQLEventStore,
  type PostgresEventStoreConnectionOptions,
} from '..';

const connectionString =
  process.env.BENCHMARK_POSTGRESQL_CONNECTION_STRING ??
  'postgresql://postgres@localhost:5432/postgres';

const connectionOptions: PostgresEventStoreConnectionOptions | undefined =
  process.env.BENCHMARK_CONNECTION_POOLED === 'true'
    ? undefined
    : {
        pooled: false,
      };

const generateSchemaUpfront =
  process.env.BENCHMARK_GENERATE_SCHEMA_UPFRONT === 'true';

const eventStore = getPostgreSQLEventStore(connectionString, {
  connectionOptions: connectionOptions,
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

const initialState = (): WhatDidIDo => ({
  description: 'Nothing!',
});
// TYPING

// BENCHMARKS
const ids: string[] = [];

const appendEvents = () => {
  const streamName = `weird-${randomUUID()}`;
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

async function runBenchmark() {
  const suite = new Benchmark.Suite();

  if (generateSchemaUpfront) {
    // this will trigger generating schema
    await eventStore.schema.migrate();
  }

  return (
    suite
      .add('Appending events', {
        defer: true,
        fn: async function (deferred: Benchmark.Deferred) {
          await appendEvents();
          deferred.resolve();
        },
      })
      .add('Reading events', {
        defer: true,
        fn: async function (deferred: Benchmark.Deferred) {
          await readEvents();
          deferred.resolve();
        },
      })
      .add('Aggregating stream', {
        defer: true,
        fn: async function (deferred: Benchmark.Deferred) {
          await aggregateStream();
          deferred.resolve();
        },
      })
      .add('Aggregating and Appending stream', {
        defer: true,
        fn: async function (deferred: Benchmark.Deferred) {
          await aggregateStream();
          await appendEvents();
          deferred.resolve();
        },
      })
      .add('Command handling', {
        defer: true,
        fn: async function (deferred: Benchmark.Deferred) {
          await handleCommand();
          deferred.resolve();
        },
      })
      .on('cycle', function (event: Benchmark.Event) {
        // eslint-disable-next-line @typescript-eslint/no-base-to-string
        console.log(String(event.target));
      })
      .on('complete', function (this: Benchmark.Suite) {
        this.forEach((bench: Benchmark.Target) => {
          const stats = bench.stats;
          console.log(`\nBenchmark: ${bench.name}`);
          console.log(
            `  Operations per second: ${bench.hz!.toFixed(2)} ops/sec`,
          );
          console.log(
            `  Mean execution time: ${(stats!.mean * 1000).toFixed(2)} ms`,
          );
          console.log(
            `  Standard deviation: ${(stats!.deviation * 1000).toFixed(2)} ms`,
          );
          console.log(`  Margin of error: ±${stats!.rme.toFixed(2)}%`);
          console.log(`  Sample size: ${stats!.sample.length} runs`);
          console.log();
        });

        console.log('Benchmarking complete.');
        return eventStore.close(); // Close the database connection
      })
      // Run the benchmarks
      .run({ async: true })
  );
}

runBenchmark().catch(console.error);
