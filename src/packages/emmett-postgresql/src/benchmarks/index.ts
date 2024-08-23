import 'dotenv/config';

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
});

const ids: string[] = [];

const appendEvents = () => {
  const streamName = `weird-${randomUUID()}`;
  ids.push(streamName);

  return eventStore.appendToStream(streamName, [
    { type: 'DidSomething', data: { id: 1, description: 'something weird' } },
  ]);
};

const readEvents = () => eventStore.readStream(ids[0] ?? 'not-existing');

// eslint-disable-next-line @typescript-eslint/require-await
async function runBenchmark() {
  const suite = new Benchmark.Suite();

  if (generateSchemaUpfront) {
    // this will trigger generating schema
    await readEvents();
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
      .on('cycle', function (event: Benchmark.Event) {
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
