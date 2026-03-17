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
import { assertThatOtelSpan, assertThatOtelSpans } from '../otelTesting';

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
    assertThatOtelSpans(spans)
      .haveSpanNamed('command.handle')
      .isMainScope()
      .hasAttributes({
        'scope.type': 'command',
        'messaging.system': 'emmett',
        'stream.name': 'orders',
      })
      .hasEvent('command.validated');
    expect(spans[0]!.spanContext().traceId).toMatch(/^[0-9a-f]{32}$/);
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

    assertThatOtelSpan(root).isMainScope();
    // children are linked to root via active context
    assertThatOtelSpan(read).hasParent(root.spanContext());
    assertThatOtelSpan(append).hasParent(root.spanContext());
    // default attributeTarget=both copies child attributes up to root
    assertThatOtelSpan(root)
      .hasAttribute('eventstore.operation', 'read')
      .hasAttribute('eventstore.append.batch_size', 1);
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

    assertThatOtelSpan(root).isMainScope();
    assertThatOtelSpan(msg).hasParent(root.spanContext());
    assertThatOtelSpan(read).hasParent(msg.spanContext());
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
    assertThatOtelSpan(spans[0]).hasParent({
      traceId: producerTraceId,
      spanId: producerSpanId,
    });
    expect(spans[0]!.spanContext().traceId).toBe(producerTraceId);
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
    assertThatOtelSpan(spans[0])
      .hasNoParent()
      .hasCreationLinks([{ traceId: producerTraceId, spanId: producerSpanId }]);
    expect(spans[0]!.spanContext().traceId).not.toBe(producerTraceId);
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
    assertThatOtelSpan(spans[0]).hasCreationLinks([sourceLink1, sourceLink2]);
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
    assertThatOtelSpan(spans[0])
      .hasNoParent()
      .hasCreationLinks([
        { traceId: producerTraceId, spanId: producerSpanId },
        extraLink,
      ]);
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
    assertThatOtelSpan(spans[0])
      .hasStatus(SpanStatusCode.ERROR, 'stream version conflict')
      .hasEvent('exception');
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

    assertThatOtelSpan(root)
      .isMainScope()
      .hasAttribute('processor.status', 'success')
      .hasAttribute('processor.checkpoint.after', 42)
      .hasCreationLinks([sourceSpan]);

    assertThatOtelSpan(msg).hasParent(root.spanContext());
    assertThatOtelSpan(read).hasParent(msg.spanContext());
  });
});
