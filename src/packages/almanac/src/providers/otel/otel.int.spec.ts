import { context, trace } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
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
import { observability } from '../../configuration';
import { LogEvent, type AnyLogEvent } from '../../loggers';
import { ObservabilityScope } from '../../scopes';
import { otel } from './otel';
import { otelAssertions } from './otelTesting';

describe('OTel observability with an application-owned SDK', () => {
  const spanExporter = new InMemorySpanExporter();
  const tracerProvider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(spanExporter)],
  });
  const logExporter = new InMemoryLogRecordExporter();
  const loggerProvider = new LoggerProvider({
    processors: [new SimpleLogRecordProcessor({ exporter: logExporter })],
  });

  beforeAll(() => {
    const contextManager = new AsyncLocalStorageContextManager();
    contextManager.enable();
    context.setGlobalContextManager(contextManager);
    trace.setGlobalTracerProvider(tracerProvider);
    logs.setGlobalLoggerProvider(loggerProvider);
  });

  beforeEach(() => {
    spanExporter.reset();
    logExporter.reset();
  });

  it('uses the OTel providers already registered by the application', async () => {
    const configured = observability(otel());
    const scope = ObservabilityScope(configured);

    await scope.startScope('handle request', (active) => {
      active.log(LogEvent.info('request handled'));
      return Promise.resolve();
    });

    const span = spanExporter.getFinishedSpans()[0]!;
    otelAssertions.span(span).exists();
    otelAssertions
      .logs(logExporter.getFinishedLogRecords())
      .haveLogWithBody('request handled')
      .hasSpanContext(span.spanContext());
  });

  it('combines OTel tracing with an application logger', async () => {
    const recordedLogs: AnyLogEvent[] = [];
    const configured = observability(
      otel({ logging: (event) => recordedLogs.push(event) }),
    );
    const scope = ObservabilityScope(configured);

    await scope.startScope('handle request', (active) => {
      active.log(LogEvent.info('request handled'));
      return Promise.resolve();
    });

    const span = spanExporter.getFinishedSpans()[0]!;
    const { traceId, spanId } = span.spanContext();
    expect(recordedLogs).toHaveLength(1);
    expect(recordedLogs[0]!.data.body).toBe('request handled');
    expect(recordedLogs[0]!.metadata).toMatchObject({ traceId, spanId });
    expect(logExporter.getFinishedLogRecords()).toEqual([]);
  });
});
