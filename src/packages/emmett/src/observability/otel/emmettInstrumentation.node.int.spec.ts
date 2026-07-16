import { otelAssertions } from '@event-driven-io/almanac/otel';
import {
  mergeWithDefaultObservability,
  observability,
  ObservabilityScope,
  setupEmmettObservability,
  type ScopeObservability,
} from '@event-driven-io/emmett';
import { EmmettInstrumentation } from '@event-driven-io/emmett/otel';
import { otel } from '@event-driven-io/emmett/otel-node';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('EmmettInstrumentation with NodeSDK', () => {
  const exporter = new InMemorySpanExporter();
  let sdk: NodeSDK | undefined;

  beforeEach(() => {
    exporter.reset();
    setupEmmettObservability(undefined);
  });

  afterEach(async () => {
    await sdk?.shutdown();
    sdk = undefined;
    setupEmmettObservability(undefined);
  });

  it('emits a real span when registered in a NodeSDK instrumentations array', async () => {
    const spanProcessor = new SimpleSpanProcessor(exporter);
    sdk = new NodeSDK({
      spanProcessors: [spanProcessor],
      instrumentations: [new EmmettInstrumentation()],
    });

    sdk.start();

    const merged = mergeWithDefaultObservability(undefined, undefined);
    const scope = ObservabilityScope(merged as ScopeObservability);
    await scope.startScope('command.handle', (s) => {
      s.setAttributes({ 'emmett.scope.type': 'command' });
      return Promise.resolve();
    });

    // NodeSDK's span processor exports asynchronously, so flush before asserting.
    await spanProcessor.forceFlush();

    otelAssertions
      .spans(exporter.getFinishedSpans())
      .hasSingleSpanNamed('command.handle')
      .isMainScope('emmett')
      .hasAttribute('emmett.scope.type', 'command');
  });

  it('builds working observability from an injected SDK via @event-driven-io/emmett/otel-node', () => {
    const injectedSdk = {
      start: vi.fn<() => void>(),
      shutdown: vi.fn<() => void>(),
    };

    const configured = observability(otel({ sdk: injectedSdk }));

    expect(configured.tracer).toBeDefined();
    expect(injectedSdk.start).toHaveBeenCalledOnce();
  });
});
