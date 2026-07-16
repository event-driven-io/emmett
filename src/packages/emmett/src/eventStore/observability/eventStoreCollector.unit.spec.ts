import {
  collectingMeter,
  collectingTracer,
  MessagingAttributes,
  noopLogger,
  ObservabilitySpec,
} from '@event-driven-io/almanac';
import { afterEach, describe, expect, it } from 'vitest';
import { setupEmmettObservability } from '../../observability';
import {
  EmmettAttributes,
  EmmettMetrics,
  MessagingSystemName,
} from '../../observability/attributes';
import type { AnyRecordedMessageMetadata } from '../../typing';
import {
  eventStoreCollector,
  eventStoreObservability,
} from './eventStoreCollector';

const A = EmmettAttributes;

afterEach(() => setupEmmettObservability(undefined));
const M = MessagingAttributes;

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
    await given((config) => eventStoreCollector(config))
      .when((collector) =>
        collector.instrumentRead('orders-123', () =>
          Promise.resolve({
            events: makeEvents(['OrderPlaced']),
            currentStreamVersion: 1n,
            streamExists: true,
          }),
        ),
      )
      .then(({ spans }) =>
        spans.hasSingleSpanNamed('eventStore.readStream').hasAttributes({
          [A.scope.main]: true,
          [A.eventStore.operation]: 'readStream',
          [A.stream.name]: 'orders-123',
          [A.eventStore.read.status]: 'success',
          [A.eventStore.read.eventCount]: 1,
          [A.eventStore.read.eventTypes]: ['OrderPlaced'],
          [M.operation.type]: 'receive',
          [M.destination.name]: 'orders-123',
          [M.system]: MessagingSystemName,
        }),
      );
  });

  it('instrumentAppend creates eventStore.appendToStream span with attributes', async () => {
    const events = makeEvents(['OrderPlaced']);
    await given((config) => eventStoreCollector(config))
      .when((collector) =>
        collector.instrumentAppend('orders-123', events, () =>
          Promise.resolve({
            nextExpectedStreamVersion: 1n,
            createdNewStream: true,
          }),
        ),
      )
      .then(({ spans }) =>
        spans.hasSingleSpanNamed('eventStore.appendToStream').hasAttributes({
          [A.scope.main]: true,
          [A.eventStore.operation]: 'appendToStream',
          [A.stream.name]: 'orders-123',
          [A.eventStore.append.batchSize]: 1,
          [A.eventStore.append.status]: 'success',
          [A.stream.versionAfter]: 1,
          [M.operation.type]: 'send',
          [M.batch.messageCount]: 1,
          [M.destination.name]: 'orders-123',
          [M.system]: MessagingSystemName,
        }),
      );
  });

  it('instrumentAppend records stream.version.after', async () => {
    const events = makeEvents(['OrderPlaced']);
    await given((config) => eventStoreCollector(config))
      .when((collector) =>
        collector.instrumentAppend('test', events, () =>
          Promise.resolve({
            nextExpectedStreamVersion: 6n,
            createdNewStream: false,
          }),
        ),
      )
      .then(({ spans }) =>
        spans
          .hasSingleSpanNamed('eventStore.appendToStream')
          .hasAttribute(A.stream.versionAfter, 6),
      );
  });

  it('instrumentAggregate creates eventStore.aggregateStream span with attributes', async () => {
    await given((config) => eventStoreCollector(config))
      .when((collector) =>
        collector.instrumentAggregate('orders-123', () =>
          Promise.resolve({
            currentStreamVersion: 3n,
            state: { total: 42 },
            streamExists: true,
          }),
        ),
      )
      .then(({ spans, metrics }) => {
        spans.hasSingleSpanNamed('eventStore.aggregateStream').hasAttributes({
          [A.scope.main]: true,
          [A.eventStore.operation]: 'aggregateStream',
          [A.stream.name]: 'orders-123',
          [A.eventStore.aggregate.status]: 'success',
          [A.stream.versionAfter]: 3,
          [M.operation.type]: 'process',
          [M.destination.name]: 'orders-123',
          [M.system]: MessagingSystemName,
        });
        metrics
          .haveHistogramNamed(EmmettMetrics.stream.aggregatingDuration)
          .hasValueAtLeast(0);
      });
  });

  it('instrumentInlineProjection creates a child span under append', async () => {
    const events = makeEvents(['OrderPlaced']);

    await given((config) => eventStoreCollector(config))
      .when((collector) =>
        collector.instrumentAppend('orders-123', events, async (scope) => {
          await collector.instrumentInlineProjection('orders-123', scope, () =>
            Promise.resolve(),
          );

          return {
            nextExpectedStreamVersion: 1n,
            createdNewStream: true,
          };
        }),
      )
      .then(({ spans }) => {
        const appendSpan = spans
          .hasSingleSpanNamed('eventStore.appendToStream')
          .hasAttributes({
            [A.scope.main]: true,
            [A.eventStore.operation]: 'appendToStream',
            [A.stream.name]: 'orders-123',
            [A.eventStore.append.batchSize]: 1,
            [A.eventStore.append.status]: 'success',
            [A.stream.versionAfter]: 1,
            [M.operation.type]: 'send',
            [M.batch.messageCount]: 1,
            [M.destination.name]: 'orders-123',
            [M.system]: MessagingSystemName,
          });

        appendSpan.hasChildNamed('eventStore.inlineProjection').hasAttributes({
          [A.scope.main]: undefined,
          [A.eventStore.operation]: 'inlineProjection',
          [A.stream.name]: 'orders-123',
          [M.operation.type]: 'process',
          [M.destination.name]: 'orders-123',
          [M.system]: MessagingSystemName,
        });
      });
  });

  it('instrumentRead can create a child span under aggregate', async () => {
    await given((config) => eventStoreCollector(config))
      .when((collector) =>
        collector.instrumentAggregate('orders-123', async (scope) => {
          const result = await collector.instrumentRead(
            'orders-123',
            () =>
              Promise.resolve({
                events: makeEvents(['OrderPlaced']),
                currentStreamVersion: 1n,
                streamExists: true,
              }),
            { scope },
          );

          return {
            currentStreamVersion: result.currentStreamVersion,
            state: { total: 42 },
            streamExists: result.streamExists,
          };
        }),
      )
      .then(({ spans }) => {
        const aggregateSpan = spans
          .hasSingleSpanNamed('eventStore.aggregateStream')
          .hasAttributes({
            [A.scope.main]: true,
            [A.eventStore.operation]: 'aggregateStream',
            [A.stream.name]: 'orders-123',
            [M.operation.type]: 'process',
            [M.destination.name]: 'orders-123',
            [M.system]: MessagingSystemName,
            [A.eventStore.aggregate.status]: 'success',
            [A.stream.versionAfter]: 1,
          });

        aggregateSpan.hasChildNamed('eventStore.readStream').hasAttributes({
          [A.scope.main]: undefined,
          [A.eventStore.operation]: 'readStream',
          [A.stream.name]: 'orders-123',
          [A.eventStore.read.status]: 'success',
          [A.eventStore.read.eventCount]: 1,
          [A.eventStore.read.eventTypes]: ['OrderPlaced'],
          [M.operation.type]: 'receive',
          [M.destination.name]: 'orders-123',
          [M.system]: MessagingSystemName,
        });
      });
  });

  it('instrumentRead records stream.reading.duration histogram on success', async () => {
    const meter = collectingMeter();
    const obs = {
      tracer: collectingTracer(),
      meter,
      logger: noopLogger,
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
      logger: noopLogger,
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
      logger: noopLogger,
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
      logger: noopLogger,
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
      logger: noopLogger,
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
    const o11y = eventStoreObservability(undefined);
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

describe('eventStoreObservability', () => {
  it('uses default observability when reading a stream', async () => {
    await given((observability) => {
      setupEmmettObservability(observability);
      return eventStoreCollector(eventStoreObservability(undefined));
    })
      .when((collector) =>
        collector.instrumentRead('orders-1', () =>
          Promise.resolve({
            events: [],
            currentStreamVersion: 0n,
            streamExists: false,
          }),
        ),
      )
      .then(({ spans, metrics }) => {
        spans.hasSingleSpanNamed('eventStore.readStream').hasAttributes({
          [A.eventStore.operation]: 'readStream',
          [A.stream.name]: 'orders-1',
          [A.eventStore.read.status]: 'success',
          [A.eventStore.read.eventCount]: 0,
          [A.eventStore.read.eventTypes]: [],
          [M.operation.type]: 'receive',
          [M.destination.name]: 'orders-1',
          [M.system]: MessagingSystemName,
        });
        metrics
          .haveHistogramNamed(EmmettMetrics.stream.readingDuration)
          .hasValueAtLeast(0);
      });
  });

  it('uses event store fields after broader observability is merged', () => {
    const tracer = collectingTracer();
    const meter = collectingMeter();
    const resolved = eventStoreObservability(
      { observability: { attributeTarget: 'currentSpan' } },
      {
        tracer,
        meter,
        pollTracing: 'verbose',
        propagation: 'propagate',
      },
    );

    expect(resolved.tracer).toBe(tracer);
    expect(resolved.meter).toBe(meter);
    expect(resolved.attributeTarget).toBe('currentSpan');
    expect('pollTracing' in resolved).toBe(false);
    expect('propagation' in resolved).toBe(false);
  });
});
