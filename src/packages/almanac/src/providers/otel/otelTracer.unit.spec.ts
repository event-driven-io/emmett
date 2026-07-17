import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { SeverityNumber, logs } from '@opentelemetry/api-logs';
import {
  InMemoryLogRecordExporter,
  LoggerProvider,
  SimpleLogRecordProcessor,
} from '@opentelemetry/sdk-logs';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LogEvent, logger } from '../../loggers';
import { otelLogger } from './otelLogger';
import { otelAssertions } from './otelTesting';
import { otelTracer } from './otelTracer';

describe('otelTracer', () => {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });

  const logExporter = new InMemoryLogRecordExporter();
  const loggerProvider = new LoggerProvider({
    processors: [new SimpleLogRecordProcessor({ exporter: logExporter })],
  });

  beforeAll(() => {
    trace.setGlobalTracerProvider(provider);
    logs.setGlobalLoggerProvider(loggerProvider);
  });

  beforeEach(() => {
    exporter.reset();
    logExporter.reset();
  });

  it('creates a span via OTel API', async () => {
    const tracer = otelTracer();
    await tracer.startSpan('test-span', () => Promise.resolve());

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]!.name).toBe('test-span');
  });

  it('uses an injected tracer instead of the global provider', async () => {
    const injectedExporter = new InMemorySpanExporter();
    const injectedProvider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(injectedExporter)],
    });

    const tracer = otelTracer('almanac', {
      tracer: injectedProvider.getTracer('injected'),
    });
    await tracer.startSpan('injected-span', () => Promise.resolve());

    expect(injectedExporter.getFinishedSpans().map((s) => s.name)).toContain(
      'injected-span',
    );
    expect(exporter.getFinishedSpans().map((s) => s.name)).not.toContain(
      'injected-span',
    );
  });

  it('uses an injected tracerProvider instead of the global provider', async () => {
    const injectedExporter = new InMemorySpanExporter();
    const injectedProvider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(injectedExporter)],
    });

    const tracer = otelTracer('almanac', {
      tracerProvider: injectedProvider,
    });
    await tracer.startSpan('provider-span', () => Promise.resolve());

    expect(injectedExporter.getFinishedSpans().map((s) => s.name)).toContain(
      'provider-span',
    );
    expect(exporter.getFinishedSpans().map((s) => s.name)).not.toContain(
      'provider-span',
    );
  });

  it('falls back to the global tracer when none is injected', async () => {
    const tracer = otelTracer();
    await tracer.startSpan('global-span', () => Promise.resolve());

    expect(exporter.getFinishedSpans().map((s) => s.name)).toContain(
      'global-span',
    );
  });

  it('setAttributes maps to OTel span.setAttribute', async () => {
    const tracer = otelTracer();
    await tracer.startSpan('test-span', (span) => {
      span.setAttributes({ 'foo.bar': 'baz', count: 42 });
      return Promise.resolve();
    });

    const span = exporter.getFinishedSpans()[0]!;
    expect(span.attributes['foo.bar']).toBe('baz');
    expect(span.attributes['count']).toBe(42);
  });

  it('spanContext returns real OTel traceId and spanId', async () => {
    const tracer = otelTracer();
    let capturedContext: { traceId: string; spanId: string } | undefined;

    await tracer.startSpan('test-span', (span) => {
      capturedContext = span.spanContext();
      return Promise.resolve();
    });

    expect(capturedContext!.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(capturedContext!.spanId).toMatch(/^[0-9a-f]{16}$/);
  });

  it('nested startSpan creates parent-child relationship', async () => {
    const tracer = otelTracer();
    await tracer.startSpan('outer', async (outer) => {
      await tracer.startSpan('inner', () => Promise.resolve(), {
        parent: outer.spanContext(),
        propagation: 'propagate',
      });
    });

    const spans = exporter.getFinishedSpans();
    const outer = spans.find((s) => s.name === 'outer')!;
    const inner = spans.find((s) => s.name === 'inner')!;

    expect(inner.parentSpanContext?.spanId).toBe(outer.spanContext().spanId);
  });

  it('lifts the reserved eventName key into the logged event', async () => {
    const tracer = otelTracer('almanac', { logger: otelLogger() });
    await tracer.startSpan('test-span', (span) => {
      span.log(LogEvent.info({ eventName: 'user.registered', userId: 'u1' }));
      return Promise.resolve();
    });

    otelAssertions
      .logs(logExporter.getFinishedLogRecords())
      .haveLogNamed('user.registered')
      .hasSeverity(SeverityNumber.INFO)
      .hasAttribute('userId', 'u1');
  });

  it('does not synthesize span context for standalone OTel logger logs', () => {
    const log = otelLogger();

    log(LogEvent.info('standalone'));

    otelAssertions
      .logs(logExporter.getFinishedLogRecords())
      .haveLogWithBody('standalone');
    expect(logExporter.getFinishedLogRecords()[0]!.spanContext).toBeUndefined();
  });

  it('stamps injected loggers with the OTel span context', async () => {
    const logs: LogEvent[] = [];
    const log = logger({ event: (event) => logs.push(event) });
    const tracer = otelTracer('almanac', { logger: log });

    await tracer.startSpan('test-span', (span) => {
      span.log(LogEvent.info('inside span'));
      return Promise.resolve();
    });

    const span = exporter.getFinishedSpans()[0]!;
    expect(logs[0]!.data.body).toBe('inside span');
    expect(logs[0]!.metadata.traceId).toBe(span.spanContext().traceId);
    expect(logs[0]!.metadata.spanId).toBe(span.spanContext().spanId);
  });

  it('logs an exception event when the span throws', async () => {
    const tracer = otelTracer('almanac', { logger: otelLogger() });
    await expect(
      tracer.startSpan('failing-span', () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');

    otelAssertions
      .logs(logExporter.getFinishedLogRecords())
      .haveLogNamed('exception')
      .hasSeverity(SeverityNumber.ERROR)
      .hasAttribute('exception.message', 'boom');
  });

  it('sets ERROR status on exception', async () => {
    const tracer = otelTracer();
    await expect(
      tracer.startSpan('failing-span', () =>
        Promise.reject(new Error('something went wrong')),
      ),
    ).rejects.toThrow('something went wrong');

    const span = exporter.getFinishedSpans()[0]!;
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.status.message).toBe('something went wrong');
  });

  it('passes links at span creation', async () => {
    const linkTraceId = 'a'.repeat(32);
    const linkSpanId = 'b'.repeat(16);
    const tracer = otelTracer();

    await tracer.startSpan('linked-span', () => Promise.resolve(), {
      links: [{ traceId: linkTraceId, spanId: linkSpanId }],
    });

    const span = exporter.getFinishedSpans()[0]!;
    expect(span.links).toHaveLength(1);
    expect(span.links[0]!.context.traceId).toBe(linkTraceId);
    expect(span.links[0]!.context.spanId).toBe(linkSpanId);
  });

  it('propagation=propagate with parent creates child span', async () => {
    const parentTraceId = 'c'.repeat(32);
    const parentSpanId = 'd'.repeat(16);
    const tracer = otelTracer();

    await tracer.startSpan('child-span', () => Promise.resolve(), {
      parent: { traceId: parentTraceId, spanId: parentSpanId },
      propagation: 'propagate',
    });

    const span = exporter.getFinishedSpans()[0]!;
    expect(span.parentSpanContext?.spanId).toBe(parentSpanId);
    expect(span.parentSpanContext?.traceId).toBe(parentTraceId);
  });

  it('propagation=links with parent demotes parent to SpanLink', async () => {
    const parentTraceId = 'e'.repeat(32);
    const parentSpanId = 'f'.repeat(16);
    const tracer = otelTracer();

    await tracer.startSpan('new-trace-span', () => Promise.resolve(), {
      parent: { traceId: parentTraceId, spanId: parentSpanId },
      propagation: 'links',
    });

    const span = exporter.getFinishedSpans()[0]!;
    expect(span.parentSpanContext).toBeUndefined();
    expect(span.links.some((l) => l.context.spanId === parentSpanId)).toBe(
      true,
    );
  });
});
