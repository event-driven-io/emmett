import {
  collectingMeter,
  collectingTracer,
  ObservabilitySpec,
} from '@event-driven-io/almanac';
import { describe, expect, it } from 'vitest';
import {
  EmmettAttributes,
  EmmettMetrics,
  MessagingSystemName,
} from '../../observability/attributes';
import { mergeObservabilityOptions } from '../../observability/options';
import type { AnyRecordedMessageMetadata } from '../../typing';
import {
  processorCollector,
  processorObservability,
} from './processorCollector';

const A = EmmettAttributes;
const M = {
  system: 'messaging.system',
  batchMessageCount: 'messaging.batch.message_count',
  operationType: 'messaging.operation.type',
  messageId: 'messaging.message.id',
};

const makeMessage = (type: string, meta: Record<string, unknown> = {}) => ({
  type,
  data: {},
  kind: 'Event' as const,
  metadata: meta as unknown as AnyRecordedMessageMetadata,
});

const given = ObservabilitySpec.for();

describe('processorCollector', () => {
  it('creates processor.handle span with emmett.scope.type=processor and emmett.scope.main=true', async () => {
    await given((config) => processorCollector(config))
      .when((collector) =>
        collector.startScope(
          { processorId: 'p1', type: 'reactor', checkpoint: null },
          [],
          () => Promise.resolve(),
        ),
      )
      .then(({ spans }) =>
        spans.haveSpanNamed('processor.handle').hasAttributes({
          [A.scope.type]: 'processor',
          'emmett.scope.main': true,
        }),
      );
  });

  it('sets emmett.processor.id, emmett.processor.type, emmett.processor.batch_size', async () => {
    const messages = [makeMessage('OrderPlaced'), makeMessage('ItemAdded')];
    await given((config) => processorCollector(config))
      .when((collector) =>
        collector.startScope(
          { processorId: 'my-processor', type: 'projector', checkpoint: null },
          messages,
          () => Promise.resolve(),
        ),
      )
      .then(({ spans }) =>
        spans.haveSpanNamed('processor.handle').hasAttributes({
          [A.processor.id]: 'my-processor',
          [A.processor.type]: 'projector',
          [A.processor.batchSize]: 2,
        }),
      );
  });

  it('sets messaging.system and messaging.batch.message_count', async () => {
    const messages = [makeMessage('OrderPlaced')];
    await given((config) => processorCollector(config))
      .when((collector) =>
        collector.startScope(
          { processorId: 'p1', type: 'reactor', checkpoint: null },
          messages,
          () => Promise.resolve(),
        ),
      )
      .then(({ spans }) =>
        spans.haveSpanNamed('processor.handle').hasAttributes({
          [M.system]: MessagingSystemName,
          [M.batchMessageCount]: 1,
        }),
      );
  });

  it('sets emmett.processor.event_types, deduplicating repeated types', async () => {
    const messages = [
      makeMessage('OrderPlaced'),
      makeMessage('OrderPlaced'),
      makeMessage('ItemAdded'),
    ];
    await given((config) => processorCollector(config))
      .when((collector) =>
        collector.startScope(
          { processorId: 'p1', type: 'reactor', checkpoint: null },
          messages,
          () => Promise.resolve(),
        ),
      )
      .then(({ spans }) =>
        spans
          .haveSpanNamed('processor.handle')
          .hasAttribute(A.processor.eventTypes, ['OrderPlaced', 'ItemAdded']),
      );
  });

  it('root span carries source links from message trace context', async () => {
    const messages = [
      makeMessage('OrderPlaced', { traceId: 'trace-A', spanId: 'span-x' }),
      makeMessage('ItemAdded', { traceId: 'trace-B', spanId: 'span-y' }),
    ];
    await given((config) => processorCollector(config), {
      propagation: 'links',
    })
      .when((collector) =>
        collector.startScope(
          { processorId: 'p1', type: 'reactor', checkpoint: null },
          messages,
          () => Promise.resolve(),
        ),
      )
      .then(({ spans }) =>
        spans.haveSpanNamed('processor.handle').hasCreationLinks([
          { traceId: 'trace-A', spanId: 'span-x' },
          { traceId: 'trace-B', spanId: 'span-y' },
        ]),
      );
  });

  it('deduplicates source links when messages share the same trace context', async () => {
    const messages = [
      makeMessage('OrderPlaced', { traceId: 'trace-1', spanId: 'span-1' }),
      makeMessage('ItemAdded', { traceId: 'trace-1', spanId: 'span-1' }),
      makeMessage('OrderShipped', { traceId: 'trace-2', spanId: 'span-2' }),
    ];
    await given((config) => processorCollector(config), {
      propagation: 'links',
    })
      .when((collector) =>
        collector.startScope(
          { processorId: 'p1', type: 'reactor', checkpoint: null },
          messages,
          () => Promise.resolve(),
        ),
      )
      .then(({ spans }) =>
        spans.haveSpanNamed('processor.handle').hasCreationLinks([
          { traceId: 'trace-1', spanId: 'span-1' },
          { traceId: 'trace-2', spanId: 'span-2' },
        ]),
      );
  });

  it('creates child scopes per message with messaging.operation.type=process', async () => {
    const messages = [makeMessage('OrderPlaced'), makeMessage('ItemAdded')];
    await given((config) => processorCollector(config))
      .when((collector) =>
        collector.startScope(
          { processorId: 'p1', type: 'reactor', checkpoint: null },
          messages,
          async (scope) => {
            for (const msg of messages) {
              await scope.scope(
                `processor.message.${msg.type}`,
                () => Promise.resolve(),
                { attributes: { [M.operationType]: 'process' } },
              );
            }
          },
        ),
      )
      .then(({ spans }) =>
        spans
          .containSpanNamed('processor.message.OrderPlaced')
          .containSpanNamed('processor.message.ItemAdded'),
      );
  });

  it('per-message child scopes carry messaging.operation.type and messaging.message.id', async () => {
    const messages = [makeMessage('OrderPlaced', { messageId: 'msg-42' })];
    await given((config) => processorCollector(config))
      .when((collector) =>
        collector.startScope(
          { processorId: 'p1', type: 'reactor', checkpoint: null },
          messages,
          async (scope) => {
            for (const msg of messages) {
              const meta = msg.metadata as unknown as Record<string, unknown>;
              await scope.scope(
                `processor.message.${msg.type}`,
                () => Promise.resolve(),
                {
                  attributes: {
                    [M.operationType]: 'process',
                    [M.messageId]: meta.messageId as string,
                  },
                },
              );
            }
          },
        ),
      )
      .then(({ spans }) =>
        spans.haveSpanNamed('processor.message.OrderPlaced').hasAttributes({
          [M.operationType]: 'process',
          [M.messageId]: 'msg-42',
        }),
      );
  });

  it('records emmett.processor.processing.duration histogram with processor attributes', async () => {
    const tracer = collectingTracer();
    const meter = collectingMeter();
    const obs = {
      tracer,
      meter,
      propagation: 'links' as const,
      attributeTarget: 'both' as const,
      includeMessagePayloads: false,
    };
    const collector = processorCollector(obs);
    await collector.startScope(
      { processorId: 'p1', type: 'reactor', checkpoint: null },
      [],
      () => Promise.resolve(),
    );
    const h = meter.histograms.find(
      (h) => h.name === EmmettMetrics.processor.processingDuration,
    );
    expect(h).toBeDefined();
    expect(h!.value).toBeGreaterThanOrEqual(0);
    expect((h!.attributes as Record<string, unknown>)[A.processor.id]).toBe(
      'p1',
    );
    expect((h!.attributes as Record<string, unknown>)[A.processor.type]).toBe(
      'reactor',
    );
  });

  it('records emmett.processor.lag_events gauge via recordLag', () => {
    const meter = collectingMeter();
    const obs = {
      tracer: collectingTracer(),
      meter,
      propagation: 'links' as const,
      attributeTarget: 'both' as const,
      includeMessagePayloads: false,
    };
    const collector = processorCollector(obs);
    collector.recordLag('p1', 42);
    const g = meter.gauges.find(
      (g) => g.name === EmmettMetrics.processor.lagEvents,
    );
    expect(g).toBeDefined();
    expect(g!.value).toBe(42);
    expect((g!.attributes as Record<string, unknown>)[A.processor.id]).toBe(
      'p1',
    );
  });

  it('works with noop observability', async () => {
    const o11y = processorObservability(undefined);
    const collector = processorCollector(o11y);
    await collector.startScope(
      { processorId: 'p1', type: 'reactor', checkpoint: null },
      [],
      () => Promise.resolve(),
    );
  });
});

describe('processorObservability', () => {
  it('returns noop tracer, meter, propagation=links, attributeTarget=both when no options', () => {
    const resolved = processorObservability(undefined);
    expect(resolved.tracer).toBeDefined();
    expect(resolved.meter).toBeDefined();
    expect(resolved.propagation).toBe('links');
    expect(resolved.attributeTarget).toBe('both');
  });

  it('uses provided propagation', () => {
    const resolved = processorObservability({
      observability: { propagation: 'propagate' },
    });
    expect(resolved.propagation).toBe('propagate');
  });

  it('uses provided attributeTarget', () => {
    const resolved = processorObservability({
      observability: { attributeTarget: 'currentSpan' },
    });
    expect(resolved.attributeTarget).toBe('currentSpan');
  });

  it('falls back to parent', () => {
    const resolved = processorObservability(undefined, {
      observability: { propagation: 'propagate' },
    });
    expect(resolved.propagation).toBe('propagate');
  });

  it('child overrides parent', () => {
    const resolved = processorObservability(
      { observability: { propagation: 'propagate' } },
      { observability: { propagation: 'links' } },
    );
    expect(resolved.propagation).toBe('propagate');
  });

  it('uses processor fields after store or consumer observability is merged', () => {
    const tracer = collectingTracer();
    const meter = collectingMeter();
    const options = mergeObservabilityOptions(
      { observability: { propagation: 'propagate' as const } },
      {
        tracer,
        meter,
        pollTracing: 'verbose',
        attributeTarget: 'currentSpan',
      },
    );

    const resolved = processorObservability(options);

    expect(resolved.tracer).toBe(tracer);
    expect(resolved.meter).toBe(meter);
    expect(resolved.propagation).toBe('propagate');
    expect(resolved.attributeTarget).toBe('currentSpan');
    expect('pollTracing' in resolved).toBe(false);
  });

  it('defaults includeMessagePayloads to false', () => {
    const resolved = processorObservability(undefined);
    expect(resolved.includeMessagePayloads).toBe(false);
  });

  it('uses provided includeMessagePayloads', () => {
    const resolved = processorObservability({
      observability: { includeMessagePayloads: true },
    });
    expect(resolved.includeMessagePayloads).toBe(true);
  });
});
