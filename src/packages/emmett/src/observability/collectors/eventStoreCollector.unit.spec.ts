import {
  collectingMeter,
  collectingTracer,
  ObservabilitySpec,
} from '@event-driven-io/almanac';
import { describe, expect, it } from 'vitest';
import type { AnyRecordedMessageMetadata } from '../../typing';
import {
  EmmettAttributes,
  EmmettMetrics,
  MessagingSystemName,
} from '../attributes';
import { resolveEventStoreObservability } from '../options';
import { eventStoreCollector } from './eventStoreCollector';

const A = EmmettAttributes;
const M = {
  system: 'messaging.system',
  operationType: 'messaging.operation.type',
  batchMessageCount: 'messaging.batch.message_count',
};

const makeEvents = (types: string[]) =>
  types.map((type) => ({
    type,
    data: {},
    kind: 'Event' as const,
    metadata: {} as AnyRecordedMessageMetadata,
  }));

const given = ObservabilitySpec.for();

describe('eventStoreCollector', () => {
  it('instrumentRead creates eventStore.readStream span with operation and messaging attributes', async () => {
    await given({})
      .when((config) =>
        eventStoreCollector(config).instrumentRead('orders-123', () =>
          Promise.resolve({
            events: makeEvents(['OrderPlaced']),
            currentStreamVersion: 1n,
            streamExists: true,
          }),
        ),
      )
      .then(({ spans }) =>
        spans.haveSpanNamed('eventStore.readStream').hasAttributes({
          [A.eventStore.operation]: 'readStream',
          [M.operationType]: 'receive',
          [M.system]: MessagingSystemName,
          [A.stream.name]: 'orders-123',
        }),
      );
  });

  it('instrumentAppend creates eventStore.appendToStream span with attributes', async () => {
    const events = makeEvents(['OrderPlaced']);
    await given({})
      .when((config) =>
        eventStoreCollector(config).instrumentAppend('orders-123', events, () =>
          Promise.resolve({
            nextExpectedStreamVersion: 1n,
            createdNewStream: true,
          }),
        ),
      )
      .then(({ spans }) =>
        spans.haveSpanNamed('eventStore.appendToStream').hasAttributes({
          [A.eventStore.operation]: 'appendToStream',
          [M.operationType]: 'send',
          [M.batchMessageCount]: 1,
          [A.stream.name]: 'orders-123',
        }),
      );
  });

  it('instrumentAppend records stream.version.after', async () => {
    const events = makeEvents(['OrderPlaced']);
    await given({})
      .when((config) =>
        eventStoreCollector(config).instrumentAppend('test', events, () =>
          Promise.resolve({
            nextExpectedStreamVersion: 6n,
            createdNewStream: false,
          }),
        ),
      )
      .then(({ spans }) =>
        spans
          .haveSpanNamed('eventStore.appendToStream')
          .hasAttribute(A.stream.versionAfter, 6),
      );
  });

  it('instrumentRead records stream.reading.duration histogram on success', async () => {
    const meter = collectingMeter();
    const obs = {
      tracer: collectingTracer(),
      meter,
      attributeTarget: 'both' as const,
    };
    await eventStoreCollector(obs).instrumentRead('test', () =>
      Promise.resolve({
        events: [],
        currentStreamVersion: 0n,
        streamExists: false,
      }),
    );
    const h = meter.histograms.find(
      (h) => h.name === EmmettMetrics.stream.readingDuration,
    );
    expect(h).toBeDefined();
    expect(h!.value).toBeGreaterThanOrEqual(0);
    expect(
      (h!.attributes as Record<string, unknown>)[A.eventStore.read.status],
    ).toBe('success');
  });

  it('instrumentRead records stream.reading.duration histogram on failure', async () => {
    const meter = collectingMeter();
    const obs = {
      tracer: collectingTracer(),
      meter,
      attributeTarget: 'both' as const,
    };
    await expect(
      eventStoreCollector(obs).instrumentRead('test', () =>
        Promise.reject(new Error('read failed')),
      ),
    ).rejects.toThrow('read failed');
    const h = meter.histograms.find(
      (h) => h.name === EmmettMetrics.stream.readingDuration,
    );
    expect(h).toBeDefined();
    expect(
      (h!.attributes as Record<string, unknown>)[A.eventStore.read.status],
    ).toBe('failure');
  });

  it('instrumentRead records event.reading.count counter per event type', async () => {
    const meter = collectingMeter();
    const obs = {
      tracer: collectingTracer(),
      meter,
      attributeTarget: 'both' as const,
    };
    await eventStoreCollector(obs).instrumentRead('test', () =>
      Promise.resolve({
        events: makeEvents(['OrderPlaced', 'ItemAdded', 'OrderPlaced']),
        currentStreamVersion: 3n,
        streamExists: true,
      }),
    );
    const counters = meter.counters.filter(
      (c) => c.name === EmmettMetrics.event.readingCount,
    );
    expect(counters.length).toBe(3);
  });

  it('instrumentRead records stream.reading.size histogram', async () => {
    const meter = collectingMeter();
    const obs = {
      tracer: collectingTracer(),
      meter,
      attributeTarget: 'both' as const,
    };
    await eventStoreCollector(obs).instrumentRead('test', () =>
      Promise.resolve({
        events: makeEvents(['A', 'B']),
        currentStreamVersion: 2n,
        streamExists: true,
      }),
    );
    const h = meter.histograms.find(
      (h) => h.name === EmmettMetrics.stream.readingSize,
    );
    expect(h).toBeDefined();
    expect(h!.value).toBe(2);
  });

  it('instrumentAppend records appending.duration, appending.size, event.appending.count', async () => {
    const meter = collectingMeter();
    const obs = {
      tracer: collectingTracer(),
      meter,
      attributeTarget: 'both' as const,
    };
    const events = makeEvents(['OrderPlaced', 'ItemAdded']);
    await eventStoreCollector(obs).instrumentAppend('test', events, () =>
      Promise.resolve({
        nextExpectedStreamVersion: 2n,
        createdNewStream: true,
      }),
    );
    expect(
      meter.histograms.find(
        (h) => h.name === EmmettMetrics.stream.appendingDuration,
      ),
    ).toBeDefined();
    const sizeH = meter.histograms.find(
      (h) => h.name === EmmettMetrics.stream.appendingSize,
    );
    expect(sizeH).toBeDefined();
    expect(sizeH!.value).toBe(2);
    const counters = meter.counters.filter(
      (c) => c.name === EmmettMetrics.event.appendingCount,
    );
    expect(counters.length).toBe(2);
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
