import type { Event } from '@event-driven-io/emmett';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { getSQLiteEventStore } from '../../../eventStore/SQLiteEventStore';
import type { SQLiteEventStoreConsumerConfig } from '../../../eventStore/consumers/sqliteEventStoreConsumer';
import { sqlite3EventStoreDriver } from '../../../sqlite3';

type Ticked = Event<'Ticked', { id: string }>;

type Pulling = SQLiteEventStoreConsumerConfig['pulling'];

const pullingFrequencyInMs = 20;
const appendEveryInMs = 30;
const trickledMessages = 100;
const warmUpMessages = 20;
const wakeUps = 8;
const idleInMs = 3000;
const idleStepInMs = 125;

const configurations: { name: string; pulling: Pulling }[] = [
  {
    name: 'batchSize 100, default backoff',
    pulling: { pullingFrequencyInMs, batchSize: 100 },
  },
  {
    name: 'batchSize 1, default backoff',
    pulling: { pullingFrequencyInMs, batchSize: 1 },
  },
  {
    name: 'batchSize 100, backoff.maxInMs 20, batchDeadlineInMs 0',
    pulling: {
      pullingFrequencyInMs,
      batchSize: 100,
      batchDeadlineInMs: 0,
      backoff: { maxInMs: pullingFrequencyInMs },
    },
  },
];

const percentile = (sorted: number[], quantile: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(quantile * sorted.length))] ??
  Number.NaN;

const summary = (latencies: number[]) => {
  const sorted = [...latencies].sort((a, b) => a - b);

  return `p50 ${percentile(sorted, 0.5).toFixed(0)} ms, p95 ${percentile(sorted, 0.95).toFixed(0)} ms, max ${percentile(sorted, 1).toFixed(0)} ms`;
};

const measure = async (pulling: Pulling) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'emmett-latency-'));
  const fileName = path.join(folder, 'latency.db');
  const eventStore = getSQLiteEventStore({
    driver: sqlite3EventStoreDriver,
    fileName,
  });
  await eventStore.schema.migrate();

  const appendedAt = new Map<string, number>();
  const handledAfter = new Map<string, number>();
  const consumer = eventStore.consumer<Ticked>({ pulling });

  consumer.reactor<Ticked>({
    processorId: 'latency',
    eachMessage: (message) => {
      const { id } = message.data;
      handledAfter.set(id, performance.now() - (appendedAt.get(id) ?? 0));
    },
  });

  const running = consumer.start();
  await consumer.whenStarted();

  const append = async () => {
    const id = randomUUID();
    appendedAt.set(id, performance.now());
    await eventStore.appendToStream<Ticked>(`tick-${id}`, [
      { type: 'Ticked', data: { id } },
    ]);
    return id;
  };

  const handled = async (ids: string[]) => {
    while (ids.some((id) => !handledAfter.has(id))) await delay(5);
    return ids.map((id) => handledAfter.get(id) ?? Number.NaN);
  };

  await delay(idleInMs);

  const trickled: string[] = [];
  for (let i = 0; i < trickledMessages; i++) {
    trickled.push(await append());
    await delay(appendEveryInMs);
  }
  const trickle = await handled(trickled);

  const afterIdle: number[] = [];
  for (let i = 0; i < wakeUps; i++) {
    await delay(idleInMs + i * idleStepInMs);
    afterIdle.push(...(await handled([await append()])));
  }

  await consumer.stop();
  await running.catch(() => undefined);
  await eventStore.close();
  fs.rmSync(folder, { recursive: true, force: true });

  return {
    steady: summary(trickle.slice(warmUpMessages)),
    afterIdle: summary(afterIdle),
  };
};

console.log(
  `Append-to-handle latency: polling every ${pullingFrequencyInMs} ms, one message every ${appendEveryInMs} ms (first ${warmUpMessages} of ${trickledMessages} skipped), then ${wakeUps} single messages after ${idleInMs} to ${idleInMs + (wakeUps - 1) * idleStepInMs} ms idle\n`,
);

for (const { name, pulling } of configurations) {
  const { steady, afterIdle } = await measure(pulling);

  console.log(name);
  console.log(`  steady trickle: ${steady}`);
  console.log(`  after idle:     ${afterIdle}`);
}
