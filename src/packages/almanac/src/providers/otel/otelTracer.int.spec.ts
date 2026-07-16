import { SpanStatusCode, context, trace } from '@opentelemetry/api';
import { SeverityNumber, logs } from '@opentelemetry/api-logs';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  InMemoryLogRecordExporter,
  LoggerProvider,
  SimpleLogRecordProcessor,
} from '@opentelemetry/sdk-logs';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LogEvent, logger } from '../../loggers/logger';
import { ObservabilityScope } from '../../scopes/scope';
import { otelLogger } from './otelLogger';
import { otelAssertions } from './otelTesting';
import { otelTracer } from './otelTracer';

describe('otelTracer integration', () => {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });

  const logExporter = new InMemoryLogRecordExporter();
  const loggerProvider = new LoggerProvider({
    processors: [new SimpleLogRecordProcessor(logExporter)],
  });

  beforeAll(() => {
    const contextManager = new AsyncLocalStorageContextManager();
    contextManager.enable();
    context.setGlobalContextManager(contextManager);
    trace.setGlobalTracerProvider(provider);
    logs.setGlobalLoggerProvider(loggerProvider);
  });

  beforeEach(() => {
    exporter.reset();
    logExporter.reset();
  });

  it('exports command.handle span with all success attributes', async () => {
    const tracer = otelTracer('almanac-integration', { logger: otelLogger() });
    const scope = ObservabilityScope({ tracer, attributePrefix: 'emmett' });

    const result = await scope.startScope('command.handle', (s) => {
      s.setAttributes({
        'emmett.scope.type': 'command',
        'messaging.system': 'emmett',
        'messaging.destination.name': 'orders-stream',
        'emmett.stream.name': 'orders-stream',
      });
      s.log(
        LogEvent.info({
          eventName: 'command.validated',
          'emmett.command.type': 'PlaceOrder',
        }),
      );
      s.setAttributes({
        'emmett.command.status': 'success',
        'emmett.command.event_count': 1,
        'emmett.command.event_types': ['OrderPlaced'],
        'emmett.stream.version.before': 0,
        'emmett.stream.version.after': 1,
        error: false,
      });
      return Promise.resolve('ok');
    });

    expect(result).toBe('ok');

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    otelAssertions
      .spans(spans)
      .hasSingleSpanNamed('command.handle')
      .isMainScope('emmett')
      .hasAttributes({
        'emmett.scope.type': 'command',
        'messaging.system': 'emmett',
        'messaging.destination.name': 'orders-stream',
        'emmett.stream.name': 'orders-stream',
        'emmett.command.status': 'success',
        'emmett.command.event_count': 1,
        'emmett.stream.version.before': 0,
        'emmett.stream.version.after': 1,
        error: false,
      });
    expect(spans[0]!.attributes['emmett.command.event_types']).toEqual([
      'OrderPlaced',
    ]);
    expect(spans[0]!.spanContext().traceId).toMatch(/^[0-9a-f]{32}$/);

    otelAssertions
      .logs(logExporter.getFinishedLogRecords())
      .haveLogNamed('command.validated')
      .hasSeverity(SeverityNumber.INFO)
      .hasAttribute('emmett.command.type', 'PlaceOrder')
      .hasSpanContext(spans[0]!.spanContext());
  });

  it('exports command.handle span with all failure attributes', async () => {
    const tracer = otelTracer('almanac-integration', { logger: otelLogger() });
    const scope = ObservabilityScope({ tracer, attributePrefix: 'emmett' });
    const error = new Error('stream version conflict');

    await expect(
      scope.startScope('command.handle', (s) => {
        s.setAttributes({
          'emmett.scope.type': 'command',
          'messaging.system': 'emmett',
          'emmett.stream.name': 'orders-stream',
        });
        s.setAttributes({
          'emmett.command.status': 'failure',
          error: true,
          'exception.message': error.message,
          'exception.type': 'error',
        });
        s.log(LogEvent.error(error));
        return Promise.reject(error);
      }),
    ).rejects.toThrow('stream version conflict');

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    otelAssertions
      .span(spans[0])
      .isMainScope('emmett')
      .hasAttributes({
        'emmett.scope.type': 'command',
        'messaging.system': 'emmett',
        'emmett.stream.name': 'orders-stream',
        'emmett.command.status': 'failure',
        error: true,
        'exception.message': 'stream version conflict',
        'exception.type': 'error',
      })
      .hasStatus(SpanStatusCode.ERROR, 'stream version conflict');

    otelAssertions
      .logs(logExporter.getFinishedLogRecords())
      .haveLogNamed('exception')
      .hasSeverity(SeverityNumber.ERROR)
      .hasAttribute('exception.message', 'stream version conflict')
      .hasSpanContext(spans[0]!.spanContext());
  });

  it('nested command.handle with eventStore child scopes inherits active context as parent', async () => {
    const tracer = otelTracer('almanac-integration');
    const scope = ObservabilityScope({ tracer, attributePrefix: 'emmett' });

    await scope.startScope('command.handle', async (s) => {
      s.setAttributes({
        'emmett.scope.type': 'command',
        'emmett.stream.name': 'orders-stream',
        'messaging.system': 'emmett',
      });

      await s.scope('eventStore.readStream', (child) => {
        child.setAttributes({
          'emmett.eventstore.operation': 'readStream',
          'emmett.eventstore.read.event_count': 2,
        });
        return Promise.resolve();
      });

      await s.scope('eventStore.appendToStream', (child) => {
        child.setAttributes({
          'emmett.eventstore.operation': 'appendToStream',
          'emmett.eventstore.append.batch_size': 1,
        });
        return Promise.resolve();
      });

      s.setAttributes({ 'emmett.command.status': 'success', error: false });
    });

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(3);

    const root = spans.find((s) => s.name === 'command.handle')!;
    const read = spans.find((s) => s.name === 'eventStore.readStream')!;
    const append = spans.find((s) => s.name === 'eventStore.appendToStream')!;

    otelAssertions.span(root).isMainScope('emmett');
    otelAssertions.span(read).hasParent(root.spanContext());
    otelAssertions.span(append).hasParent(root.spanContext());
    // attributeTarget=both copies child attributes up to root; last write wins for emmett.eventstore.operation
    otelAssertions
      .span(root)
      .hasAttribute('emmett.eventstore.operation', 'appendToStream')
      .hasAttribute('emmett.command.status', 'success');
  });

  it('3-level nesting: processor.handle → processor.message → eventStore.readStream', async () => {
    const tracer = otelTracer('almanac-integration');
    const scope = ObservabilityScope({ tracer, attributePrefix: 'emmett' });

    await scope.startScope('processor.handle', async (batch) => {
      batch.setAttributes({
        'emmett.scope.type': 'processor',
        'emmett.processor.id': 'orders-processor',
        'emmett.processor.type': 'projector',
        'emmett.processor.batch_size': 1,
        'messaging.system': 'emmett',
      });

      await batch.scope('processor.message.OrderPlaced', async (msg) => {
        msg.setAttributes({
          'emmett.scope.type': 'projector',
          'emmett.processor.id': 'orders-processor',
          'emmett.processor.type': 'projector',
          'messaging.operation.type': 'process',
          'messaging.message.id': 'msg-001',
        });

        await msg.scope('eventStore.readStream', (child) => {
          child.setAttributes({
            'emmett.eventstore.operation': 'readStream',
            'emmett.stream.name': 'orders-read-model',
          });
          return Promise.resolve();
        });
      });
    });

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(3);

    const root = spans.find((s) => s.name === 'processor.handle')!;
    const msg = spans.find((s) => s.name === 'processor.message.OrderPlaced')!;
    const read = spans.find((s) => s.name === 'eventStore.readStream')!;

    otelAssertions.span(root).isMainScope('emmett');
    otelAssertions.span(msg).hasParent(root.spanContext());
    otelAssertions.span(read).hasParent(msg.spanContext());
  });

  it('exports eventStore.readStream span with all attributes', async () => {
    const tracer = otelTracer('almanac-integration');

    await tracer.startSpan('eventStore.readStream', (span) => {
      span.setAttributes({
        'emmett.eventstore.operation': 'readStream',
        'emmett.stream.name': 'orders-stream',
        'messaging.operation.type': 'receive',
        'messaging.destination.name': 'orders-stream',
        'messaging.system': 'emmett',
      });
      span.setAttributes({
        'emmett.eventstore.read.status': 'success',
        'emmett.eventstore.read.event_count': 3,
        'emmett.eventstore.read.event_types': [
          'OrderPlaced',
          'ItemAdded',
          'OrderConfirmed',
        ],
      });
      return Promise.resolve();
    });

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    otelAssertions.span(spans[0]).hasAttributes({
      'emmett.eventstore.operation': 'readStream',
      'emmett.stream.name': 'orders-stream',
      'messaging.operation.type': 'receive',
      'messaging.destination.name': 'orders-stream',
      'messaging.system': 'emmett',
      'emmett.eventstore.read.status': 'success',
      'emmett.eventstore.read.event_count': 3,
    });
    expect(spans[0]!.attributes['emmett.eventstore.read.event_types']).toEqual([
      'OrderPlaced',
      'ItemAdded',
      'OrderConfirmed',
    ]);
  });

  it('exports eventStore.appendToStream span with all attributes', async () => {
    const tracer = otelTracer('almanac-integration');

    await tracer.startSpan('eventStore.appendToStream', (span) => {
      span.setAttributes({
        'emmett.eventstore.operation': 'appendToStream',
        'emmett.stream.name': 'orders-stream',
        'emmett.eventstore.append.batch_size': 1,
        'messaging.operation.type': 'send',
        'messaging.batch.message_count': 1,
        'messaging.destination.name': 'orders-stream',
        'messaging.system': 'emmett',
      });
      span.setAttributes({
        'emmett.eventstore.append.status': 'success',
        'emmett.stream.version.after': 5,
      });
      return Promise.resolve();
    });

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    otelAssertions.span(spans[0]).hasAttributes({
      'emmett.eventstore.operation': 'appendToStream',
      'emmett.stream.name': 'orders-stream',
      'emmett.eventstore.append.batch_size': 1,
      'messaging.operation.type': 'send',
      'messaging.batch.message_count': 1,
      'messaging.destination.name': 'orders-stream',
      'messaging.system': 'emmett',
      'emmett.eventstore.append.status': 'success',
      'emmett.stream.version.after': 5,
    });
  });

  it('exports workflow.handle span with all attributes', async () => {
    const tracer = otelTracer('almanac-integration');
    const scope = ObservabilityScope({ tracer, attributePrefix: 'emmett' });

    await scope.startScope('workflow.handle', (s) => {
      s.setAttributes({
        'emmett.scope.type': 'workflow',
        'emmett.workflow.id': 'workflow-123',
        'emmett.workflow.type': 'OrderFulfillment',
        'emmett.workflow.input.type': 'OrderPlaced',
        'messaging.system': 'emmett',
      });
      s.setAttributes({
        'emmett.workflow.state_rebuild.event_count': 5,
        'emmett.workflow.outputs': ['ShipmentRequested', 'InventoryReserved'],
        'emmett.workflow.outputs.count': 2,
      });
      return Promise.resolve();
    });

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    otelAssertions.span(spans[0]).isMainScope('emmett').hasAttributes({
      'emmett.scope.type': 'workflow',
      'emmett.workflow.id': 'workflow-123',
      'emmett.workflow.type': 'OrderFulfillment',
      'emmett.workflow.input.type': 'OrderPlaced',
      'messaging.system': 'emmett',
      'emmett.workflow.state_rebuild.event_count': 5,
      'emmett.workflow.outputs.count': 2,
    });
    expect(spans[0]!.attributes['emmett.workflow.outputs']).toEqual([
      'ShipmentRequested',
      'InventoryReserved',
    ]);
  });

  it('propagation=propagate creates a child span under the producer trace', async () => {
    const tracer = otelTracer('almanac-integration');
    const scope = ObservabilityScope({ tracer, attributePrefix: 'emmett' });

    const producerTraceId = 'a'.repeat(32);
    const producerSpanId = 'b'.repeat(16);

    await scope.startScope(
      'processor.message.OrderPlaced',
      (s) => {
        s.setAttributes({
          'emmett.scope.type': 'projector',
          'emmett.processor.id': 'orders-processor',
          'emmett.processor.type': 'projector',
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
    otelAssertions.span(spans[0]).hasParent({
      traceId: producerTraceId,
      spanId: producerSpanId,
    });
    expect(spans[0]!.spanContext().traceId).toBe(producerTraceId);
  });

  it('propagation=links demotes producer span to a SpanLink and starts a fresh trace', async () => {
    const tracer = otelTracer('almanac-integration');
    const scope = ObservabilityScope({ tracer, attributePrefix: 'emmett' });

    const producerTraceId = 'c'.repeat(32);
    const producerSpanId = 'd'.repeat(16);

    await scope.startScope(
      'processor.handle',
      (s) => {
        s.setAttributes({
          'emmett.scope.type': 'processor',
          'emmett.processor.id': 'orders-processor',
          'emmett.processor.type': 'reactor',
          'messaging.system': 'emmett',
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
    otelAssertions
      .span(spans[0])
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
          'emmett.scope.type': 'processor',
          'emmett.processor.id': 'inventory-processor',
          'emmett.processor.type': 'projector',
          'emmett.processor.batch_size': 2,
          'messaging.system': 'emmett',
        });
        return Promise.resolve();
      },
      { links: [sourceLink1, sourceLink2] },
    );

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    otelAssertions.span(spans[0]).hasCreationLinks([sourceLink1, sourceLink2]);
  });

  it('propagation=links with extra links includes both demoted parent and additional links', async () => {
    const tracer = otelTracer('almanac-integration');

    const producerTraceId = '3'.repeat(32);
    const producerSpanId = '4'.repeat(16);
    const extraLink = { traceId: '5'.repeat(32), spanId: '6'.repeat(16) };

    await tracer.startSpan(
      'processor.handle',
      (s) => {
        s.setAttributes({
          'emmett.scope.type': 'processor',
          'emmett.processor.id': 'workflow-processor',
          'emmett.processor.type': 'reactor',
        });
        return Promise.resolve();
      },
      {
        parent: { traceId: producerTraceId, spanId: producerSpanId },
        propagation: 'links',
        links: [extraLink],
      },
    );

    const spans = exporter.getFinishedSpans();
    otelAssertions
      .span(spans[0])
      .hasNoParent()
      .hasCreationLinks([
        { traceId: producerTraceId, spanId: producerSpanId },
        extraLink,
      ]);
  });

  it('full processor batch scenario: all spans captured with correct parentage and attributes', async () => {
    const tracer = otelTracer('almanac-integration');
    const scope = ObservabilityScope({ tracer, attributePrefix: 'emmett' });

    const sourceSpan = { traceId: '7'.repeat(32), spanId: '8'.repeat(16) };

    await scope.startScope(
      'processor.handle',
      async (batch) => {
        batch.setAttributes({
          'emmett.scope.type': 'processor',
          'emmett.processor.id': 'orders-processor',
          'emmett.processor.type': 'projector',
          'emmett.processor.batch_size': 1,
          'emmett.processor.event_types': ['OrderPlaced'],
          'messaging.system': 'emmett',
          'messaging.batch.message_count': 1,
          'emmett.processor.checkpoint.before': 10,
        });

        await batch.scope('processor.message.OrderPlaced', async (msg) => {
          msg.setAttributes({
            'emmett.scope.type': 'projector',
            'emmett.processor.id': 'orders-processor',
            'emmett.processor.type': 'projector',
            'messaging.operation.type': 'process',
            'messaging.message.id': 'msg-001',
          });

          await msg.scope('eventStore.readStream', (child) => {
            child.setAttributes({
              'emmett.eventstore.operation': 'readStream',
              'emmett.stream.name': 'orders-read-model',
              'emmett.eventstore.read.event_count': 3,
            });
            return Promise.resolve();
          });
        });

        batch.setAttributes({
          'emmett.processor.checkpoint.after': 42,
          'emmett.processor.status': 'success',
        });
      },
      { links: [sourceSpan] },
    );

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(3);

    const root = spans.find((s) => s.name === 'processor.handle')!;
    const msg = spans.find((s) => s.name === 'processor.message.OrderPlaced')!;
    const read = spans.find((s) => s.name === 'eventStore.readStream')!;

    otelAssertions
      .span(root)
      .isMainScope('emmett')
      .hasAttributes({
        // emmett.scope.type is overwritten to 'projector' by attributeTarget=both bubbling from the message child scope
        'emmett.scope.type': 'projector',
        'emmett.processor.id': 'orders-processor',
        'emmett.processor.type': 'projector',
        'emmett.processor.batch_size': 1,
        'messaging.system': 'emmett',
        'messaging.batch.message_count': 1,
        'emmett.processor.checkpoint.before': 10,
        'emmett.processor.checkpoint.after': 42,
        'emmett.processor.status': 'success',
      })
      .hasCreationLinks([sourceSpan]);
    expect(root.attributes['emmett.processor.event_types']).toEqual([
      'OrderPlaced',
    ]);

    otelAssertions.span(msg).hasParent(root.spanContext()).hasAttributes({
      'emmett.scope.type': 'projector',
      'emmett.processor.id': 'orders-processor',
      'emmett.processor.type': 'projector',
      'messaging.operation.type': 'process',
      'messaging.message.id': 'msg-001',
    });

    otelAssertions.span(read).hasParent(msg.spanContext()).hasAttributes({
      'emmett.eventstore.operation': 'readStream',
      'emmett.stream.name': 'orders-read-model',
      'emmett.eventstore.read.event_count': 3,
    });
  });

  it('delegates to a provided logger instead of the OTel Logs API', async () => {
    const logged: LogEvent[] = [];
    const captureLogger = logger({
      minLevel: 'trace',
      event: (e) => void logged.push(e),
    });

    const tracer = otelTracer('almanac-integration', {
      logger: captureLogger,
    });

    await tracer.startSpan('my-span', (span) => {
      span.log(LogEvent.info({ userId: 'u1' }, 'user.registered'));
      span.log(LogEvent.warn('degraded'));
      span.log(LogEvent.error(new Error('boom')));
      return Promise.resolve();
    });

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(logExporter.getFinishedLogRecords()).toHaveLength(0);

    expect(logged).toMatchObject([
      {
        metadata: { level: 'info' },
        data: { attributes: { userId: 'u1' }, body: 'user.registered' },
      },
      { metadata: { level: 'warn' }, data: { body: 'degraded' } },
      {
        metadata: { level: 'error' },
        data: { error: expect.any(Error) as unknown },
      },
    ]);
  });

  it('logs events via the OTel Logs API when the OTel logger is provided', async () => {
    const tracer = otelTracer('almanac-integration', { logger: otelLogger() });

    await tracer.startSpan('my-span', (span) => {
      span.log(LogEvent.info({ userId: 'u1' }, 'user.registered'));
      return Promise.resolve();
    });

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);

    otelAssertions
      .logs(logExporter.getFinishedLogRecords())
      .haveLogWithBody('user.registered')
      .hasSeverity(SeverityNumber.INFO)
      .hasAttribute('userId', 'u1')
      .hasSpanContext(spans[0]!.spanContext());
  });

  it('drops logs by default when no logger is provided', async () => {
    const tracer = otelTracer('almanac-integration');

    await tracer.startSpan('my-span', (span) => {
      span.log(LogEvent.info({ userId: 'u1' }, 'user.registered'));
      return Promise.resolve();
    });

    expect(exporter.getFinishedSpans()).toHaveLength(1);
    expect(logExporter.getFinishedLogRecords()).toHaveLength(0);
  });
});
