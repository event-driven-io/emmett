import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  currentDefaultObservability,
  mergeWithDefaultObservability,
  setupObservability,
} from '../../../configuration';
import { ObservabilityScope, type ScopeObservability } from '../../../scopes';
import { AlmanacInstrumentation } from '../almanacInstrumentation';
import { otelAssertions } from '../otelTesting';

describe('AlmanacInstrumentation with NodeSDK', () => {
  const exporter = new InMemorySpanExporter();
  let sdk: NodeSDK | undefined;

  beforeEach(() => {
    exporter.reset();
    setupObservability(undefined);
  });

  afterEach(async () => {
    await sdk?.shutdown();
    sdk = undefined;
    setupObservability(undefined);
  });

  it('publishes a working observability and emits a real span through the SDK-registered provider', async () => {
    const spanProcessor = new SimpleSpanProcessor(exporter);
    sdk = new NodeSDK({
      spanProcessors: [spanProcessor],
      instrumentations: [
        new AlmanacInstrumentation({ attributePrefix: 'almanac' }),
      ],
    });

    sdk.start();

    const published = currentDefaultObservability();
    expect(published?.tracer).toBeDefined();

    const observability = mergeWithDefaultObservability(undefined, undefined);
    const scope = ObservabilityScope(observability as ScopeObservability);

    await scope.startScope('command.handle', (s) => {
      s.setAttributes({ 'almanac.scope.type': 'command' });
      return Promise.resolve();
    });

    // NodeSDK's span processor exports asynchronously, so flush before asserting.
    await spanProcessor.forceFlush();

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    otelAssertions
      .spans(spans)
      .haveSpanNamed('command.handle')
      .isMainScope('almanac')
      .hasAttribute('almanac.scope.type', 'command');
  });
});
