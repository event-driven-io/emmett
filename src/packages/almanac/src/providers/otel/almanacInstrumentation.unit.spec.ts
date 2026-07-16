import { trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  currentDefaultObservability,
  mergeWithDefaultObservability,
  setupObservability,
  type Observability,
} from '../../configuration';
import { AlmanacInstrumentation } from './almanacInstrumentation';

type TestObservability = Partial<Observability<string>>;

describe('AlmanacInstrumentation', () => {
  const globalExporter = new InMemorySpanExporter();
  const globalProvider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(globalExporter)],
  });

  beforeAll(() => {
    trace.setGlobalTracerProvider(globalProvider);
  });

  beforeEach(() => {
    globalExporter.reset();
    setupObservability(undefined);
  });

  afterEach(() => {
    setupObservability(undefined);
  });

  it('does no module patching', () => {
    const instrumentation = new AlmanacInstrumentation({ enabled: false });

    expect(instrumentation.getModuleDefinitions()).toEqual([]);
  });

  it('does not register observability when constructed disabled', () => {
    new AlmanacInstrumentation({ enabled: false });

    expect(currentDefaultObservability()).toBeUndefined();
  });

  it('registers its tracer, meter and logger built from the config on enable', () => {
    new AlmanacInstrumentation();

    const merged = mergeWithDefaultObservability(undefined, undefined);

    expect(merged?.tracer).toBeDefined();
    expect(merged?.meter).toBeDefined();
    expect(merged?.logger).toBeDefined();
  });

  it('carries base observability config into the store', () => {
    new AlmanacInstrumentation({ attributePrefix: 'custom' });

    const merged = mergeWithDefaultObservability(undefined, undefined);

    expect(merged?.attributePrefix).toBe('custom');
  });

  it('restores the prior observability on disable', () => {
    const sentinel = { tracer: {} } as TestObservability;
    setupObservability(sentinel);

    const instrumentation = new AlmanacInstrumentation();
    expect(currentDefaultObservability()).not.toBe(sentinel);

    instrumentation.disable();
    expect(currentDefaultObservability()).toBe(sentinel);
  });

  it('rebinds the registered tracer to an injected provider', async () => {
    const injectedExporter = new InMemorySpanExporter();
    const injectedProvider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(injectedExporter)],
    });

    const instrumentation = new AlmanacInstrumentation();
    instrumentation.setTracerProvider(injectedProvider);

    const merged = mergeWithDefaultObservability(undefined, undefined);
    await merged!.tracer!.startSpan('rebind-span', () => Promise.resolve());

    expect(injectedExporter.getFinishedSpans().map((s) => s.name)).toContain(
      'rebind-span',
    );
    expect(globalExporter.getFinishedSpans().map((s) => s.name)).not.toContain(
      'rebind-span',
    );
  });

  it('restores the prior observability after rebinding on disable', () => {
    const sentinel = { tracer: {} } as TestObservability;
    setupObservability(sentinel);

    const injectedProvider = new BasicTracerProvider();
    const instrumentation = new AlmanacInstrumentation();
    instrumentation.setTracerProvider(injectedProvider);

    instrumentation.disable();
    expect(currentDefaultObservability()).toBe(sentinel);
  });
});
