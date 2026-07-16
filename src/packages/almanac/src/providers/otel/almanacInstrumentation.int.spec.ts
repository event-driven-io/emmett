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
import {
  currentDefaultObservability,
  mergeWithDefaultObservability,
  setupObservability,
} from '../../configuration';
import { ObservabilityScope, type ScopeObservability } from '../../scopes';
import { AlmanacInstrumentation } from './almanacInstrumentation';
import { otelAssertions } from './otelTesting';
import { otelTracer } from './otelTracer';

describe('AlmanacInstrumentation integration', () => {
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
    setupObservability(undefined);
  });

  afterEach(() => {
    setupObservability(undefined);
  });

  afterAll(async () => {
    await globalProvider.shutdown();
  });

  it('publishes a working observability that emits a real span through the merge chain', async () => {
    new AlmanacInstrumentation({ attributePrefix: 'almanac' });

    const observability = mergeWithDefaultObservability(undefined, undefined);
    const scope = ObservabilityScope(observability as ScopeObservability);

    await scope.startScope('command.handle', (s) => {
      s.setAttributes({ 'almanac.scope.type': 'command' });
      return Promise.resolve();
    });

    const spans = globalExporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    otelAssertions
      .spans(spans)
      .hasSingleSpanNamed('command.handle')
      .isMainScope('almanac')
      .hasAttribute('almanac.scope.type', 'command');
  });

  it('routes spans to an injected tracer provider instead of the global one', async () => {
    const injectedExporter = new InMemorySpanExporter();
    const injectedProvider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(injectedExporter)],
    });

    const instrumentation = new AlmanacInstrumentation();
    instrumentation.setTracerProvider(injectedProvider);

    const observability = mergeWithDefaultObservability(undefined, undefined);
    const scope = ObservabilityScope(observability as ScopeObservability);

    await scope.startScope('command.handle', () => Promise.resolve());

    otelAssertions
      .spans(injectedExporter.getFinishedSpans())
      .hasSingleSpanNamed('command.handle');
    otelAssertions.spans(globalExporter.getFinishedSpans()).haveNoSpans();

    await injectedProvider.shutdown();
  });

  it('restores the prior observability on disable and routes spans back through it', async () => {
    const priorExporter = new InMemorySpanExporter();
    const priorProvider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(priorExporter)],
    });
    const prior: ScopeObservability = {
      tracer: otelTracer('prior', {
        tracer: priorProvider.getTracer('prior'),
      }),
      attributePrefix: 'almanac',
    };
    setupObservability(prior);

    const instrumentation = new AlmanacInstrumentation();
    expect(currentDefaultObservability()).not.toBe(prior);

    instrumentation.disable();
    expect(currentDefaultObservability()).toBe(prior);

    const scope = ObservabilityScope(
      currentDefaultObservability() as ScopeObservability,
    );
    await scope.startScope('command.handle', () => Promise.resolve());

    otelAssertions
      .spans(priorExporter.getFinishedSpans())
      .hasSingleSpanNamed('command.handle');
    otelAssertions.spans(globalExporter.getFinishedSpans()).haveNoSpans();

    await priorProvider.shutdown();
  });
});
