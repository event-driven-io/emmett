import 'dotenv/config';

import { randomUUID } from 'crypto';
import { getPostgreSQLEventStore } from '..';

const connectionString =
  process.env.BENCHMARK_POSTGRESQL_CONNECTION_STRING ??
  'postgresql://postgres@localhost:5432/postgres';

const eventStore = getPostgreSQLEventStore(connectionString, {
  connectionOptions: {
    pooled: false,
  },
});

const appendEvents = (streamName: string) => {
  return eventStore.appendToStream(streamName, [
    { type: 'DidSomething', data: { id: 1, description: 'something weird' } },
  ]);
};

const readEvents = (streamName: string) => eventStore.readStream(streamName);

const runBenchmark = async () => {
  console.log('\nStarting Event Store Operations');
  for (let i = 0; i < 100; i++) {
    console.log(`\r${100 - i}`);
    const streamName = `weird-${randomUUID()}`;
    await appendEvents(streamName);
    await readEvents(streamName);
  }
  console.log('Finished Event Store  Operations');
};

runBenchmark().catch(console.error);
