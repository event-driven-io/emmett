import { CommandHandler, type Event } from '@event-driven-io/emmett';
import { bench, group, run, summary } from 'mitata';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  getSQLiteEventStore,
  type SQLiteEventStore,
} from '../eventStore/SQLiteEventStore';
import { sqlite3EventStoreDriver } from '../sqlite3';

const dbPath = path.join(os.tmpdir(), `emmett-bench-${Date.now()}.db`);

const generateSchemaUpfront =
  process.env.BENCHMARK_GENERATE_SCHEMA_UPFRONT !== 'false';

const eventStore: SQLiteEventStore = getSQLiteEventStore({
  driver: sqlite3EventStoreDriver,
  fileName: dbPath,
  schema: {
    autoMigration: generateSchemaUpfront ? 'None' : 'CreateOrUpdate',
  },
});

if (generateSchemaUpfront) await eventStore.schema.migrate();

// TYPING
type DidSomething = Event<'DidSomething', { id: number; description: string }>;

type WhatDidIDo =
  | { id: number; description: string }
  | { description: 'Nothing!' };

const evolve = (_state: WhatDidIDo, event: DidSomething): WhatDidIDo =>
  event.data;

const initialState = (): WhatDidIDo => ({ description: 'Nothing!' });
// TYPING

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

const handleCommand = async (streamName = ids[0]!) =>
  handle(eventStore, streamName, (state) => ({
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
  bench('Reading events', async () => {
    await readEvents();
  });

  bench('Aggregating stream', async () => {
    await aggregateStream();
  });
});

summary(() => {
  bench('Appending events', async () => {
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

  bench('1000 sequential command handling', async () => {
    const streamName = `cmd-seq-${Date.now()}`;
    for (let i = 0; i < 1000; i++) {
      await handleCommand(streamName);
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

  bench('1000 concurrent command handling on unique streams', async () => {
    const batchId = `cmd-conc-${Date.now()}`;
    await Promise.all(
      Array.from({ length: 1000 }, (_, i) => handleCommand(`${batchId}-${i}`)),
    );
  });
});

const results = await run();

const rows = results.benchmarks.flatMap((trial) =>
  trial.runs.map((r) => {
    if (r.stats === undefined) return { name: r.name, display: 'error' };
    const match = r.name.match(/^(\d+)\s/);
    const multiplier = match ? parseInt(match[1]!, 10) : 1;
    const opsPerSec = Math.round((multiplier * 1e9) / r.stats.avg);
    return { name: r.name, display: `${opsPerSec.toLocaleString()} ops/sec` };
  }),
);

const nameWidth = Math.max(...rows.map((r) => r.name.length));
const valWidth = Math.max(...rows.map((r) => r.display.length));
console.log('\nops/sec');
console.log('-'.repeat(nameWidth + valWidth + 4));
for (const { name, display } of rows) {
  console.log(`${name.padEnd(nameWidth)}  ${display.padStart(valWidth)}`);
}

await eventStore.close();

try {
  fs.unlinkSync(dbPath);
  fs.unlinkSync(`${dbPath}-shm`);
  fs.unlinkSync(`${dbPath}-wal`);
} catch {
  // DB files may not all exist
}
