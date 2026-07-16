import {
  currentDefaultObservability,
  mergeWithDefaultObservability,
  ObservabilityScope,
  setupEmmettObservability,
  type EmmettObservabilityConfig,
  type ScopeObservability,
} from '@event-driven-io/emmett';
import {
  EmmettInstrumentation,
  otelTracer,
} from '@event-driven-io/emmett/otel';
import { otelAssertions } from '@event-driven-io/almanac/otel';
import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

describe('EmmettInstrumentation integration', () => {
  const globalExporter = new InMemorySpanExporter();
  const globalProvider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(globalExporter)],
  });

  beforeAll(() => {
    const contextManager = new AsyncLocalStorageContextManager();
    contextManager.enable();
    context.setGlobalContextManager(contextManager);
    trace.setGlobalTracerProvider(globalProvider);
  });

  beforeEach(() => {
    globalExporter.reset();
    setupEmmettObservability(undefined);
  });

  afterEach(() => {
    setupEmmettObservability(undefined);
  });

  afterAll(async () => {
    await globalProvider.shutdown();
  });

  it('publishes a working observability that emits a real span through the merge chain', async () => {
    new EmmettInstrumentation();

    const observability = mergeWithDefaultObservability(undefined, undefined);
    const scope = ObservabilityScope(observability as ScopeObservability);

    await scope.startScope('command.handle', (s) => {
      s.setAttributes({ 'emmett.scope.type': 'command' });
      return Promise.resolve();
    });

    otelAssertions
      .spans(globalExporter.getFinishedSpans())
      .haveSpanNamed('command.handle')
      .isMainScope('emmett')
      .hasAttribute('emmett.scope.type', 'command');
  });

  it('routes spans to an injected tracer provider instead of the global one', async () => {
    const injectedExporter = new InMemorySpanExporter();
    const injectedProvider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(injectedExporter)],
    });

    const instrumentation = new EmmettInstrumentation();
    instrumentation.setTracerProvider(injectedProvider);

    const observability = mergeWithDefaultObservability(undefined, undefined);
    const scope = ObservabilityScope(observability as ScopeObservability);

    await scope.startScope('command.handle', () => Promise.resolve());

    otelAssertions
      .spans(injectedExporter.getFinishedSpans())
      .haveSpanNamed('command.handle')
      .isMainScope('emmett');
    otelAssertions.spans(globalExporter.getFinishedSpans()).haveNoSpans();

    await injectedProvider.shutdown();
  });

  it('restores the prior observability on disable and routes spans back through it', async () => {
    const priorExporter = new InMemorySpanExporter();
    const priorProvider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(priorExporter)],
    });
    const prior: EmmettObservabilityConfig = {
      tracer: otelTracer('prior', {
        tracer: priorProvider.getTracer('prior'),
      }),
      attributePrefix: 'emmett',
    };
    setupEmmettObservability(prior);

    const instrumentation = new EmmettInstrumentation();
    expect(currentDefaultObservability()).not.toBe(prior);

    instrumentation.disable();
    expect(currentDefaultObservability()).toBe(prior);

    const scope = ObservabilityScope(
      currentDefaultObservability() as ScopeObservability,
    );
    await scope.startScope('command.handle', () => Promise.resolve());

    otelAssertions
      .spans(priorExporter.getFinishedSpans())
      .haveSpanNamed('command.handle')
      .isMainScope('emmett');
    otelAssertions.spans(globalExporter.getFinishedSpans()).haveNoSpans();

    await priorProvider.shutdown();
  });
});
