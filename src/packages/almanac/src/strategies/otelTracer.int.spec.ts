import {
  BasicTracerProvider,
  ConsoleSpanExporter,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { SpanStatusCode, context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { otelTracer } from './otelTracer';
import { ObservabilityScope } from '../scope';

describe('otelTracer integration', () => {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [
      new SimpleSpanProcessor(new ConsoleSpanExporter()),
      new SimpleSpanProcessor(exporter),
    ],
  });

  beforeAll(() => {
    const contextManager = new AsyncLocalStorageContextManager();
    contextManager.enable();
    context.setGlobalContextManager(contextManager);
    trace.setGlobalTracerProvider(provider);
  });

  beforeEach(() => {
    exporter.reset();
  });

  it('records a command.handle span with attributes and marks root span as main', async () => {
    const tracer = otelTracer('almanac-integration');
    const scope = ObservabilityScope({ tracer });

    const result = await scope.startScope('command.handle', (s) => {
      s.setAttributes({
        'scope.type': 'command',
        'messaging.system': 'emmett',
        'messaging.destination.name': 'orders',
        'stream.name': 'orders',
      });
      s.addEvent('command.validated', { 'command.type': 'PlaceOrder' });
      return Promise.resolve('ok');
    });

    expect(result).toBe('ok');

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const span = spans[0]!;
    expect(span.name).toBe('command.handle');
    expect(span.attributes['almanac.scope.main']).toBe(true);
    expect(span.attributes['scope.type']).toBe('command');
    expect(span.attributes['messaging.system']).toBe('emmett');
    expect(span.attributes['stream.name']).toBe('orders');
    expect(span.events.some((e) => e.name === 'command.validated')).toBe(true);
    expect(span.spanContext().traceId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('nested scopes inherit active context as parent via AsyncLocalStorageContextManager', async () => {
    const tracer = otelTracer('almanac-integration');
    const scope = ObservabilityScope({ tracer });

    await scope.startScope('command.handle', async (s) => {
      s.setAttributes({ 'scope.type': 'command', 'stream.name': 'orders' });

      await s.scope('eventstore.read', (child) => {
        child.setAttributes({ 'eventstore.operation': 'read' });
        return Promise.resolve();
      });

      await s.scope('eventstore.append', (child) => {
        child.setAttributes({ 'eventstore.append.batch_size': 1 });
        return Promise.resolve();
      });
    });

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(3);

    const root = spans.find((s) => s.name === 'command.handle')!;
    const read = spans.find((s) => s.name === 'eventstore.read')!;
    const append = spans.find((s) => s.name === 'eventstore.append')!;

    // root span is the main span
    expect(root.attributes['almanac.scope.main']).toBe(true);
    // children are linked to root via active context
    expect(read.parentSpanContext?.spanId).toBe(root.spanContext().spanId);
    expect(append.parentSpanContext?.spanId).toBe(root.spanContext().spanId);
    expect(read.spanContext().traceId).toBe(root.spanContext().traceId);
    // default attributeTarget=both copies child attributes up to root
    expect(root.attributes['eventstore.operation']).toBe('read');
    expect(root.attributes['eventstore.append.batch_size']).toBe(1);
  });

  it('3-level nesting forms a correct parent-child chain', async () => {
    const tracer = otelTracer('almanac-integration');
    const scope = ObservabilityScope({ tracer });

    await scope.startScope('processor.handle', async (batch) => {
      batch.setAttributes({
        'scope.type': 'processor',
        'processor.id': 'orders-processor',
      });

      await batch.scope('processor.message.OrderPlaced', async (msg) => {
        msg.setAttributes({ 'processor.type': 'projector' });

        await msg.scope('eventstore.read', (child) => {
          child.setAttributes({ 'stream.name': 'orders-read-model' });
          return Promise.resolve();
        });
      });
    });

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(3);

    const root = spans.find((s) => s.name === 'processor.handle')!;
    const msg = spans.find((s) => s.name === 'processor.message.OrderPlaced')!;
    const read = spans.find((s) => s.name === 'eventstore.read')!;

    expect(root.attributes['almanac.scope.main']).toBe(true);
    expect(msg.parentSpanContext?.spanId).toBe(root.spanContext().spanId);
    expect(read.parentSpanContext?.spanId).toBe(msg.spanContext().spanId);
    expect(read.spanContext().traceId).toBe(root.spanContext().traceId);
  });

  it('propagation=propagate creates a child span under the producer trace', async () => {
    const tracer = otelTracer('almanac-integration');
    const scope = ObservabilityScope({ tracer });

    const producerTraceId = 'a'.repeat(32);
    const producerSpanId = 'b'.repeat(16);

    await scope.startScope(
      'processor.message.OrderPlaced',
      (s) => {
        s.setAttributes({
          'scope.type': 'processor',
          'processor.id': 'orders-processor',
          'messaging.operation.type': 'process',
        });
        return Promise.resolve();
      },
      {
        parent: { traceId: producerTraceId, spanId: producerSpanId },
        propagation: 'propagate',
      },
    );

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const span = spans[0]!;
    expect(span.parentSpanContext?.spanId).toBe(producerSpanId);
    expect(span.parentSpanContext?.traceId).toBe(producerTraceId);
    expect(span.spanContext().traceId).toBe(producerTraceId);
  });

  it('propagation=links demotes producer span to a SpanLink and starts a fresh trace', async () => {
    const tracer = otelTracer('almanac-integration');
    const scope = ObservabilityScope({ tracer });

    const producerTraceId = 'c'.repeat(32);
    const producerSpanId = 'd'.repeat(16);

    await scope.startScope(
      'processor.handle',
      (s) => {
        s.setAttributes({
          'scope.type': 'processor',
          'processor.id': 'orders-processor',
          'processor.type': 'reactor',
        });
        return Promise.resolve();
      },
      {
        parent: { traceId: producerTraceId, spanId: producerSpanId },
        propagation: 'links',
      },
    );

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const span = spans[0]!;
    expect(span.parentSpanContext).toBeUndefined();
    expect(span.spanContext().traceId).not.toBe(producerTraceId);
    expect(
      span.links.some(
        (l) =>
          l.context.spanId === producerSpanId &&
          l.context.traceId === producerTraceId,
      ),
    ).toBe(true);
  });

  it('explicit links array links the batch span to source message spans', async () => {
    const tracer = otelTracer('almanac-integration');

    const sourceLink1 = { traceId: 'e'.repeat(32), spanId: 'f'.repeat(16) };
    const sourceLink2 = { traceId: '1'.repeat(32), spanId: '2'.repeat(16) };

    await tracer.startSpan(
      'processor.handle',
      (s) => {
        s.setAttributes({
          'processor.id': 'inventory-processor',
          'processor.batch_size': 2,
        });
        return Promise.resolve();
      },
      { links: [sourceLink1, sourceLink2] },
    );

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const span = spans[0]!;
    expect(span.links).toHaveLength(2);
    expect(
      span.links.some((l) => l.context.spanId === sourceLink1.spanId),
    ).toBe(true);
    expect(
      span.links.some((l) => l.context.spanId === sourceLink2.spanId),
    ).toBe(true);
  });

  it('propagation=links with extra links includes both demoted parent and additional links', async () => {
    const tracer = otelTracer('almanac-integration');

    const producerTraceId = '3'.repeat(32);
    const producerSpanId = '4'.repeat(16);
    const extraLink = { traceId: '5'.repeat(32), spanId: '6'.repeat(16) };

    await tracer.startSpan(
      'processor.handle',
      (s) => {
        s.setAttributes({ 'processor.id': 'workflow-processor' });
        return Promise.resolve();
      },
      {
        parent: { traceId: producerTraceId, spanId: producerSpanId },
        propagation: 'links',
        links: [extraLink],
      },
    );

    const spans = exporter.getFinishedSpans();
    const span = spans[0]!;
    expect(span.parentSpanContext).toBeUndefined();
    expect(span.links.some((l) => l.context.spanId === producerSpanId)).toBe(
      true,
    );
    expect(span.links.some((l) => l.context.spanId === extraLink.spanId)).toBe(
      true,
    );
  });

  it('error marks span with ERROR status and records exception event', async () => {
    const tracer = otelTracer('almanac-integration');
    const scope = ObservabilityScope({ tracer });

    await expect(
      scope.startScope('command.handle', () =>
        Promise.reject(new Error('stream version conflict')),
      ),
    ).rejects.toThrow('stream version conflict');

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const span = spans[0]!;
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.status.message).toBe('stream version conflict');
    expect(span.events.some((e) => e.name === 'exception')).toBe(true);
  });

  it('full processor batch scenario: all spans captured with correct parentage and attributes', async () => {
    const tracer = otelTracer('almanac-integration');
    const scope = ObservabilityScope({ tracer });

    const sourceSpan = { traceId: '7'.repeat(32), spanId: '8'.repeat(16) };

    await scope.startScope(
      'processor.handle',
      async (batch) => {
        batch.setAttributes({
          'scope.type': 'processor',
          'processor.id': 'orders-processor',
          'processor.type': 'projector',
          'messaging.system': 'emmett',
          'messaging.batch.message_count': 1,
        });

        await batch.scope('processor.message.OrderPlaced', async (msg) => {
          msg.setAttributes({
            'messaging.operation.type': 'process',
            'messaging.message.id': 'msg-001',
          });

          await msg.scope('eventstore.read', (child) => {
            child.setAttributes({ 'stream.name': 'orders-read-model' });
            return Promise.resolve();
          });
        });

        batch.setAttributes({
          'processor.checkpoint.after': 42,
          'processor.status': 'success',
        });
      },
      { links: [sourceSpan] },
    );

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(3);

    const root = spans.find((s) => s.name === 'processor.handle')!;
    const msg = spans.find((s) => s.name === 'processor.message.OrderPlaced')!;
    const read = spans.find((s) => s.name === 'eventstore.read')!;

    expect(root.attributes['almanac.scope.main']).toBe(true);
    expect(root.attributes['processor.status']).toBe('success');
    expect(root.attributes['processor.checkpoint.after']).toBe(42);
    expect(root.links.some((l) => l.context.spanId === sourceSpan.spanId)).toBe(
      true,
    );

    expect(msg.parentSpanContext?.spanId).toBe(root.spanContext().spanId);
    expect(read.parentSpanContext?.spanId).toBe(msg.spanContext().spanId);
  });
});
