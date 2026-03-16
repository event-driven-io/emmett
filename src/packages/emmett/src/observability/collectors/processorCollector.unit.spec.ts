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
import { resolveProcessorObservability } from '../options';
import { processorCollector } from './processorCollector';

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
    await given({})
      .when((config) =>
        processorCollector(config).startScope(
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
    await given({})
      .when((config) =>
        processorCollector(config).startScope(
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
    await given({})
      .when((config) =>
        processorCollector(config).startScope(
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
    await given({})
      .when((config) =>
        processorCollector(config).startScope(
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
    await given({ propagation: 'links' })
      .when((config) =>
        processorCollector(config).startScope(
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
    await given({ propagation: 'links' })
      .when((config) =>
        processorCollector(config).startScope(
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
    await given({})
      .when((config) =>
        processorCollector(config).startScope(
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
    await given({})
      .when((config) =>
        processorCollector(config).startScope(
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
    const o11y = resolveProcessorObservability(undefined);
    const collector = processorCollector(o11y);
    await collector.startScope(
      { processorId: 'p1', type: 'reactor', checkpoint: null },
      [],
      () => Promise.resolve(),
    );
  });
});
