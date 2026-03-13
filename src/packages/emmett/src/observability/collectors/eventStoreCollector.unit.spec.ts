import { describe, expect, it } from 'vitest';
import { collectingTracer, collectingMeter } from '@event-driven-io/almanac';
import { eventStoreCollector } from './eventStoreCollector';
import { resolveEventStoreObservability } from '../options';
import {
  EmmettAttributes,
  EmmettMetrics,
  MessagingSystemName,
} from '../attributes';

const A = EmmettAttributes;
const M = {
  system: 'messaging.system',
  operationType: 'messaging.operation.type',
  batchMessageCount: 'messaging.batch.message_count',
  destinationName: 'messaging.destination.name',
};

const makeObservability = () => ({
  tracer: collectingTracer(),
  meter: collectingMeter(),
  attributeTarget: 'both' as const,
});

const makeEvents = (types: string[]) =>
  types.map((type) => ({ type, data: {}, kind: 'Event' as const }));

describe('eventStoreCollector', () => {
  it('instrumentRead creates eventStore.readStream span with operation and messaging attributes', async () => {
    const obs = makeObservability();
    const collector = eventStoreCollector(obs);
    await collector.instrumentRead('orders-123', () =>
      Promise.resolve({
        events: makeEvents(['OrderPlaced']),
        currentStreamVersion: 1n,
        streamExists: true,
      }),
    );
    const span = obs.tracer.spans.find(
      (s) => s.name === 'eventStore.readStream',
    );
    expect(span).toBeDefined();
    expect(span!.attributes[A.eventStore.operation]).toBe('readStream');
    expect(span!.attributes[M.operationType]).toBe('receive');
    expect(span!.attributes[M.system]).toBe(MessagingSystemName);
    expect(span!.attributes[A.stream.name]).toBe('orders-123');
  });

  it('instrumentRead records stream.reading.duration histogram on success', async () => {
    const obs = makeObservability();
    const collector = eventStoreCollector(obs);
    await collector.instrumentRead('test', () =>
      Promise.resolve({
        events: [],
        currentStreamVersion: 0n,
        streamExists: false,
      }),
    );
    const h = obs.meter.histograms.find(
      (h) => h.name === EmmettMetrics.stream.readingDuration,
    );
    expect(h).toBeDefined();
    expect(h!.value).toBeGreaterThanOrEqual(0);
    expect(
      (h!.attributes as Record<string, unknown>)[A.eventStore.read.status],
    ).toBe('success');
  });

  it('instrumentRead records stream.reading.duration histogram on failure', async () => {
    const obs = makeObservability();
    const collector = eventStoreCollector(obs);
    await expect(
      collector.instrumentRead('test', () =>
        Promise.reject(new Error('read failed')),
      ),
    ).rejects.toThrow('read failed');
    const h = obs.meter.histograms.find(
      (h) => h.name === EmmettMetrics.stream.readingDuration,
    );
    expect(h).toBeDefined();
    expect(
      (h!.attributes as Record<string, unknown>)[A.eventStore.read.status],
    ).toBe('failure');
  });

  it('instrumentRead records event.reading.count counter per event type', async () => {
    const obs = makeObservability();
    const collector = eventStoreCollector(obs);
    await collector.instrumentRead('test', () =>
      Promise.resolve({
        events: makeEvents(['OrderPlaced', 'ItemAdded', 'OrderPlaced']),
        currentStreamVersion: 3n,
        streamExists: true,
      }),
    );
    const counters = obs.meter.counters.filter(
      (c) => c.name === EmmettMetrics.event.readingCount,
    );
    expect(counters.length).toBe(3);
  });

  it('instrumentRead records stream.reading.size histogram', async () => {
    const obs = makeObservability();
    const collector = eventStoreCollector(obs);
    await collector.instrumentRead('test', () =>
      Promise.resolve({
        events: makeEvents(['A', 'B']),
        currentStreamVersion: 2n,
        streamExists: true,
      }),
    );
    const h = obs.meter.histograms.find(
      (h) => h.name === EmmettMetrics.stream.readingSize,
    );
    expect(h).toBeDefined();
    expect(h!.value).toBe(2);
  });

  it('instrumentAppend creates eventStore.appendToStream span with attributes', async () => {
    const obs = makeObservability();
    const collector = eventStoreCollector(obs);
    const events = makeEvents(['OrderPlaced']);
    await collector.instrumentAppend('orders-123', events, 0n, () =>
      Promise.resolve({
        nextExpectedStreamVersion: 1n,
        createdNewStream: true,
      }),
    );
    const span = obs.tracer.spans.find(
      (s) => s.name === 'eventStore.appendToStream',
    );
    expect(span).toBeDefined();
    expect(span!.attributes[A.eventStore.operation]).toBe('appendToStream');
    expect(span!.attributes[M.operationType]).toBe('send');
    expect(span!.attributes[M.batchMessageCount]).toBe(1);
    expect(span!.attributes[A.stream.name]).toBe('orders-123');
  });

  it('instrumentAppend records appending.duration, appending.size, event.appending.count', async () => {
    const obs = makeObservability();
    const collector = eventStoreCollector(obs);
    const events = makeEvents(['OrderPlaced', 'ItemAdded']);
    await collector.instrumentAppend('test', events, 0n, () =>
      Promise.resolve({
        nextExpectedStreamVersion: 2n,
        createdNewStream: true,
      }),
    );
    expect(
      obs.meter.histograms.find(
        (h) => h.name === EmmettMetrics.stream.appendingDuration,
      ),
    ).toBeDefined();
    const sizeH = obs.meter.histograms.find(
      (h) => h.name === EmmettMetrics.stream.appendingSize,
    );
    expect(sizeH).toBeDefined();
    expect(sizeH!.value).toBe(2);
    const counters = obs.meter.counters.filter(
      (c) => c.name === EmmettMetrics.event.appendingCount,
    );
    expect(counters.length).toBe(2);
  });

  it('instrumentAppend records stream.version.before and stream.version.after', async () => {
    const obs = makeObservability();
    const collector = eventStoreCollector(obs);
    const events = makeEvents(['OrderPlaced']);
    await collector.instrumentAppend('test', events, 5n, () =>
      Promise.resolve({
        nextExpectedStreamVersion: 6n,
        createdNewStream: false,
      }),
    );
    const span = obs.tracer.spans.find(
      (s) => s.name === 'eventStore.appendToStream',
    );
    expect(span).toBeDefined();
    expect(span!.attributes[A.stream.versionBefore]).toBe(5);
    expect(span!.attributes[A.stream.versionAfter]).toBe(6);
  });

  it('works with noop observability', async () => {
    const o11y = resolveEventStoreObservability(undefined);
    const collector = eventStoreCollector(o11y);
    await collector.instrumentRead('test', () =>
      Promise.resolve({
        events: [],
        currentStreamVersion: 0n,
        streamExists: false,
      }),
    );
  });
});
