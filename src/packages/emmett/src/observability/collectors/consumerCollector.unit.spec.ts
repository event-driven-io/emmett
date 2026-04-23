import {
  ObservabilitySpec,
  collectingMeter,
  collectingTracer,
  type CollectedHistogram,
  type CollectedSpan,
} from '@event-driven-io/almanac';
import { describe, it } from 'vitest';
import {
  assertDefined,
  assertEqual,
  assertTrue,
} from '../../testing/assertions';
import {
  EmmettAttributes,
  EmmettMetrics,
  MessagingSystemName,
} from '../attributes';
import { resolveConsumerObservability } from '../options';
import { consumerCollector } from './consumerCollector';

const A = EmmettAttributes;
const M = {
  system: 'messaging.system',
  operationType: 'messaging.operation.type',
};

const given = ObservabilitySpec.for();

describe('consumerCollector', () => {
  it('tracePoll does not create a span when pollTracing=off', async () => {
    await given({})
      .when((config) =>
        consumerCollector({ ...config, pollTracing: 'off' as const }).tracePoll(
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
      pollTracing: 'off',
      attributeTarget: 'both',
    }).tracePoll({ batchSize: 5, processorCount: 1, empty: false }, () =>
      Promise.resolve(42),
    );
    assertEqual(result, 42);
  });

  it('tracePoll does not create a span for empty polls when pollTracing=active', async () => {
    await given({})
      .when((config) =>
        consumerCollector({
          ...config,
          pollTracing: 'active' as const,
        }).tracePoll({ batchSize: 0, processorCount: 1, empty: true }, () =>
          Promise.resolve(),
        ),
      )
      .then(({ spans }) => spans.haveNoSpans());
  });

  it('tracePoll creates a span for non-empty polls when pollTracing=active', async () => {
    await given({})
      .when((config) =>
        consumerCollector({
          ...config,
          pollTracing: 'active' as const,
        }).tracePoll({ batchSize: 3, processorCount: 1, empty: false }, () =>
          Promise.resolve(),
        ),
      )
      .then(({ spans }) => spans.haveSpanNamed('consumer.poll'));
  });

  it('tracePoll creates consumer.poll span with emmett.scope.type=consumer and emmett.scope.main=true', async () => {
    await given({})
      .when((config) =>
        consumerCollector({
          ...config,
          pollTracing: 'verbose' as const,
        }).tracePoll({ batchSize: 5, processorCount: 2, empty: false }, () =>
          Promise.resolve(),
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
    await given({})
      .when((config) =>
        consumerCollector({
          ...config,
          pollTracing: 'verbose' as const,
        }).tracePoll({ batchSize: 25, processorCount: 4, empty: false }, () =>
          Promise.resolve(),
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
    await given({})
      .when((config) =>
        consumerCollector({
          ...config,
          pollTracing: 'verbose' as const,
        }).tracePoll({ batchSize: 1, processorCount: 1, empty: false }, () =>
          Promise.resolve(),
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
    await given({})
      .when((config) =>
        consumerCollector({
          ...config,
          pollTracing: 'verbose' as const,
        }).tracePoll({ batchSize: 0, processorCount: 1, empty: true }, () =>
          Promise.resolve(),
        ),
      )
      .then(({ spans }) =>
        spans
          .haveSpanNamed('consumer.poll')
          .hasAttribute('emmett.consumer.poll.empty', true),
      );
  });

  it('tracePoll sets emmett.consumer.poll.wait_ms for backoff timing', async () => {
    await given({})
      .when((config) =>
        consumerCollector({
          ...config,
          pollTracing: 'verbose' as const,
        }).tracePoll(
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
    await given({})
      .when((config) => {
        const collector = consumerCollector({
          ...config,
          pollTracing: 'verbose' as const,
        });
        return collector.tracePoll(
          { batchSize: 3, processorCount: 1, empty: false },
          (scope) =>
            collector.traceDelivery(scope, 'ShoppingCartProjection', () =>
              Promise.resolve(),
            ),
        );
      })
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
    assertTrue(deliverySpan.exceptions.includes(err));
  });

  it('recordPollMetrics records emmett.consumer.poll.duration histogram regardless of pollTracing', () => {
    const meter = collectingMeter();
    const collector = consumerCollector({
      tracer: collectingTracer(),
      meter,
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
    const o11y = resolveConsumerObservability(undefined);
    const collector = consumerCollector(o11y);
    await collector.tracePoll(
      { batchSize: 0, processorCount: 0, empty: true },
      () => Promise.resolve(),
    );
  });
});
