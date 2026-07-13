import {
  ObservabilitySpec,
  collectingMeter,
  collectingTracer,
  LogEvent,
  noopLogger,
  type CollectedHistogram,
  type CollectedSpan,
  type CollectingTracer,
  type Logger,
} from '@event-driven-io/almanac';
import { afterEach, describe, expect, it } from 'vitest';
import {
  EmmettAttributes,
  EmmettMetrics,
  MessagingSystemName,
  setDefaultObservability,
} from '../../observability';
import {
  assertDefined,
  assertEqual,
  assertTrue,
} from '../../testing/assertions';
import { consumerCollector, consumerObservability } from './consumerCollector';

const A = EmmettAttributes;

afterEach(() => setDefaultObservability(undefined));
const M = {
  system: 'messaging.system',
  operationType: 'messaging.operation.type',
};

const given = ObservabilitySpec.for();

const spanLogger =
  (tracer: CollectingTracer): Logger =>
  (log) => {
    const span = tracer.spans.find(
      (s) =>
        s.ownContext.traceId === log.metadata.traceId &&
        s.ownContext.spanId === log.metadata.spanId,
    );
    span?.logs.push(log);
  };

describe('consumerCollector', () => {
  it('tracePoll does not create a span when pollTracing=off', async () => {
    await given((config) =>
      consumerCollector({ ...config, pollTracing: 'off' as const }),
    )
      .when((collector) =>
        collector.tracePoll(
          { batchSize: 5, processorCount: 1, empty: false },
          () => Promise.resolve(),
        ),
      )
      .then(({ spans }) => spans.haveNoSpans());
  });

  it('tracePoll propagates fn return value when pollTracing=off', async () => {
    const result = await consumerCollector({
      tracer: collectingTracer(),
      meter: collectingMeter(),
      logger: noopLogger,
      pollTracing: 'off',
      attributeTarget: 'both',
    }).tracePoll({ batchSize: 5, processorCount: 1, empty: false }, () =>
      Promise.resolve(42),
    );
    assertEqual(result, 42);
  });

  it('tracePoll does not create a span for empty polls when pollTracing=active', async () => {
    await given((config) =>
      consumerCollector({ ...config, pollTracing: 'active' as const }),
    )
      .when((collector) =>
        collector.tracePoll(
          { batchSize: 0, processorCount: 1, empty: true },
          () => Promise.resolve(),
        ),
      )
      .then(({ spans }) => spans.haveNoSpans());
  });

  it('tracePoll creates a span for non-empty polls when pollTracing=active', async () => {
    await given((config) =>
      consumerCollector({ ...config, pollTracing: 'active' as const }),
    )
      .when(async (collector) => {
        await collector.tracePoll(
          { batchSize: 3, processorCount: 1, empty: false },
          (scope) => {
            scope.log(LogEvent.info('using global observability'));
            return Promise.resolve();
          },
        );
        collector.recordPollMetrics(1);
      })
      .then(({ spans, metrics }) => {
        spans
          .haveSpanNamed('consumer.poll')
          .logged('info', 'using global observability');
        metrics
          .haveHistogramNamed(EmmettMetrics.consumer.pollDuration)
          .hasValue(1);
      });
  });

  it('tracePoll creates consumer.poll span with emmett.scope.type=consumer and emmett.scope.main=true', async () => {
    await given((config) =>
      consumerCollector({
        ...config,
        pollTracing: 'active' as const,
      }),
    )
      .when((collector) =>
        collector.tracePoll(
          { batchSize: 3, processorCount: 1, empty: false },
          () => Promise.resolve(),
        ),
      )
      .then(({ spans }) => spans.haveSpanNamed('consumer.poll'));
  });

  it('tracePoll creates consumer.poll span with emmett.scope.type=consumer and emmett.scope.main=true', async () => {
    await given((config) =>
      consumerCollector({
        ...config,
        pollTracing: 'verbose' as const,
      }),
    )
      .when((collector) =>
        collector.tracePoll(
          { batchSize: 5, processorCount: 2, empty: false },
          () => Promise.resolve(),
        ),
      )
      .then(({ spans }) =>
        spans.haveSpanNamed('consumer.poll').hasAttributes({
          [A.scope.type]: 'consumer',
          'emmett.scope.main': true,
        }),
      );
  });

  it('tracePoll sets emmett.consumer.batch_size, emmett.consumer.processor_count', async () => {
    await given((config) =>
      consumerCollector({
        ...config,
        pollTracing: 'verbose' as const,
      }),
    )
      .when((collector) =>
        collector.tracePoll(
          { batchSize: 25, processorCount: 4, empty: false },
          () => Promise.resolve(),
        ),
      )
      .then(({ spans }) =>
        spans.haveSpanNamed('consumer.poll').hasAttributes({
          [A.consumer.batchSize]: 25,
          [A.consumer.processorCount]: 4,
        }),
      );
  });

  it('tracePoll sets messaging.system=emmett and messaging.operation.type=receive', async () => {
    await given((config) =>
      consumerCollector({
        ...config,
        pollTracing: 'verbose' as const,
      }),
    )
      .when((collector) =>
        collector.tracePoll(
          { batchSize: 1, processorCount: 1, empty: false },
          () => Promise.resolve(),
        ),
      )
      .then(({ spans }) =>
        spans.haveSpanNamed('consumer.poll').hasAttributes({
          [M.system]: MessagingSystemName,
          [M.operationType]: 'receive',
        }),
      );
  });

  it('tracePoll sets emmett.consumer.poll.empty=true for empty polls', async () => {
    await given((config) =>
      consumerCollector({
        ...config,
        pollTracing: 'verbose' as const,
      }),
    )
      .when((collector) =>
        collector.tracePoll(
          { batchSize: 0, processorCount: 1, empty: true },
          () => Promise.resolve(),
        ),
      )
      .then(({ spans }) =>
        spans
          .haveSpanNamed('consumer.poll')
          .hasAttribute('emmett.consumer.poll.empty', true),
      );
  });

  it('tracePoll sets emmett.consumer.poll.wait_ms for backoff timing', async () => {
    await given((config) =>
      consumerCollector({
        ...config,
        pollTracing: 'verbose' as const,
      }),
    )
      .when((collector) =>
        collector.tracePoll(
          { batchSize: 0, processorCount: 1, empty: true, waitMs: 500 },
          () => Promise.resolve(),
        ),
      )
      .then(({ spans }) =>
        spans
          .haveSpanNamed('consumer.poll')
          .hasAttribute('emmett.consumer.poll.wait_ms', 500),
      );
  });

  it('traceDelivery creates child scope per processor with emmett.consumer.delivery.processor_id', async () => {
    await given((config) =>
      consumerCollector({
        ...config,
        pollTracing: 'verbose' as const,
      }),
    )
      .when((collector) =>
        collector.tracePoll(
          { batchSize: 3, processorCount: 1, empty: false },
          (scope) =>
            collector.traceDelivery(scope, 'ShoppingCartProjection', () =>
              Promise.resolve(),
            ),
        ),
      )
      .then(({ spans }) =>
        spans
          .haveSpanNamed('consumer.deliver.ShoppingCartProjection')
          .hasAttribute(
            A.consumer.delivery.processorId,
            'ShoppingCartProjection',
          ),
      );
  });

  it('traceDelivery records exception on failure', async () => {
    const tracer = collectingTracer();
    const meter = collectingMeter();
    const collector = consumerCollector({
      tracer,
      meter,
      logger: spanLogger(tracer),
      pollTracing: 'verbose',
      attributeTarget: 'both',
    });

    const err = new Error('delivery failed');
    await collector.tracePoll(
      { batchSize: 1, processorCount: 1, empty: false },
      async (scope) => {
        try {
          await collector.traceDelivery(scope, 'p1', () => Promise.reject(err));
        } catch {
          // expected
        }
      },
    );

    const deliverySpan: CollectedSpan | undefined = tracer.spans.find(
      (s) => s.name === 'consumer.deliver.p1',
    );
    assertDefined(deliverySpan);
    assertTrue(
      deliverySpan.logs.some(
        (r) => r.metadata.level === 'error' && r.data.error === err,
      ),
    );
  });

  it('recordPollMetrics records emmett.consumer.poll.duration histogram regardless of pollTracing', () => {
    const meter = collectingMeter();
    const collector = consumerCollector({
      tracer: collectingTracer(),
      meter,
      logger: noopLogger,
      pollTracing: 'off',
      attributeTarget: 'both',
    });

    collector.recordPollMetrics(123);

    const h: CollectedHistogram | undefined = meter.histograms.find(
      (h) => h.name === EmmettMetrics.consumer.pollDuration,
    );
    assertDefined(h);
    assertEqual(h.value, 123);
  });

  it('works with noop observability', async () => {
    const o11y = consumerObservability(undefined);
    const collector = consumerCollector(o11y);
    await collector.tracePoll(
      { batchSize: 0, processorCount: 0, empty: true },
      () => Promise.resolve(),
    );
  });
});

describe('consumerObservability', () => {
  it('uses default observability when polling', async () => {
    await given((observability) => {
      setDefaultObservability({ ...observability, pollTracing: 'active' });
      return consumerCollector(consumerObservability(undefined));
    })
      .when((collector) =>
        collector.tracePoll(
          { batchSize: 3, processorCount: 1, empty: false },
          () => Promise.resolve(),
        ),
      )
      .then(({ spans }) => spans.haveSpanNamed('consumer.poll'));
  });

  it('uses consumer fields after store observability is merged', () => {
    const tracer = collectingTracer();
    const meter = collectingMeter();
    const resolved = consumerObservability(
      { observability: { pollTracing: 'active' } },
      {
        tracer,
        meter,
        propagation: 'propagate',
        attributeTarget: 'currentSpan',
      },
    );

    expect(resolved.tracer).toBe(tracer);
    expect(resolved.meter).toBe(meter);
    expect(resolved.pollTracing).toBe('active');
    expect(resolved.attributeTarget).toBe('currentSpan');
    expect('propagation' in resolved).toBe(false);
  });

  it('returns noop tracer, meter, pollTracing=off, attributeTarget=both when no options', () => {
    const resolved = consumerObservability(undefined);
    expect(resolved.tracer).toBeDefined();
    expect(resolved.meter).toBeDefined();
    expect(resolved.pollTracing).toBe('off');
    expect(resolved.attributeTarget).toBe('both');
  });

  it('uses provided pollTracing', () => {
    const resolved = consumerObservability({
      observability: { pollTracing: 'active' },
    });
    expect(resolved.pollTracing).toBe('active');
  });

  it('uses provided pollTracing=verbose', () => {
    const resolved = consumerObservability({
      observability: { pollTracing: 'verbose' },
    });
    expect(resolved.pollTracing).toBe('verbose');
  });

  it('falls back to parent pollTracing', () => {
    const resolved = consumerObservability(undefined, {
      pollTracing: 'active',
    });
    expect(resolved.pollTracing).toBe('active');
  });

  it('uses provided attributeTarget', () => {
    const resolved = consumerObservability({
      observability: { attributeTarget: 'mainSpan' },
    });
    expect(resolved.attributeTarget).toBe('mainSpan');
  });

  it('falls back to parent attributeTarget', () => {
    const resolved = consumerObservability(undefined, {
      attributeTarget: 'currentSpan',
    });
    expect(resolved.attributeTarget).toBe('currentSpan');
  });
});
