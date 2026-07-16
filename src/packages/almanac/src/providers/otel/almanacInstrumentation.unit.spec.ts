import { trace } from '@opentelemetry/api';
import type { InstrumentationConfig } from '@opentelemetry/instrumentation';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Observability } from '../../configuration';
import { AlmanacInstrumentation } from './almanacInstrumentation';

type TestObservability = Partial<Observability<string>>;

let store: TestObservability | undefined;

class TestInstrumentation extends AlmanacInstrumentation<TestObservability> {
  constructor(config: InstrumentationConfig = {}) {
    super('test-instrumentation', '0.0.0', config);
  }

  protected buildObservability(): TestObservability {
    return this.almanacObservability();
  }

  protected readObservability(): TestObservability | undefined {
    return store;
  }

  protected setupObservability(
    observability: TestObservability | undefined,
  ): void {
    store = observability;
  }
}

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
    store = undefined;
  });

  afterEach(() => {
    store = undefined;
  });

  it('does no module patching', () => {
    const instrumentation = new TestInstrumentation({ enabled: false });

    expect(instrumentation.getModuleDefinitions()).toEqual([]);
  });

  it('does not register observability when constructed disabled', () => {
    new TestInstrumentation({ enabled: false });

    expect(store).toBeUndefined();
  });

  it('registers observability on enable', () => {
    new TestInstrumentation();

    expect(store).toBeDefined();
    expect(store!.tracer).toBeDefined();
  });

  it('restores the prior observability on disable', () => {
    const sentinel = { tracer: {} } as TestObservability;
    store = sentinel;

    const instrumentation = new TestInstrumentation();
    expect(store).not.toBe(sentinel);

    instrumentation.disable();
    expect(store).toBe(sentinel);
  });

  it('rebinds the registered tracer to an injected provider', async () => {
    const injectedExporter = new InMemorySpanExporter();
    const injectedProvider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(injectedExporter)],
    });

    const instrumentation = new TestInstrumentation();
    instrumentation.setTracerProvider(injectedProvider);

    await store!.tracer!.startSpan('rebind-span', () => Promise.resolve());

    expect(injectedExporter.getFinishedSpans().map((s) => s.name)).toContain(
      'rebind-span',
    );
    expect(globalExporter.getFinishedSpans().map((s) => s.name)).not.toContain(
      'rebind-span',
    );
  });

  it('restores the prior observability after rebinding on disable', () => {
    const sentinel = { tracer: {} } as TestObservability;
    store = sentinel;

    const injectedProvider = new BasicTracerProvider();
    const instrumentation = new TestInstrumentation();
    instrumentation.setTracerProvider(injectedProvider);

    instrumentation.disable();
    expect(store).toBe(sentinel);
  });
});
