import {
  defaultObservabilityContextGenerator,
  MessagingAttributes,
  noopLogger,
  noopMeter,
  noopScope,
  noopTracer,
  ObservabilityScope,
  type AttributeTarget,
  type Logger,
  type Meter,
  type ObservabilityContextGenerator,
  type SpanLink,
  type Tracer,
} from '@event-driven-io/almanac';
import {
  EmmettAttributes,
  EmmettMetrics,
  MessagingSystemName,
  ScopeTypes,
  type EmmettObservabilityConfig,
  type PollTracing,
} from '../../observability';
import { mergeWithDefaultObservability } from '../../observability/defaultObservability';

export type ConsumerObservabilityConfig = Pick<
  EmmettObservabilityConfig,
  | 'tracer'
  | 'meter'
  | 'logger'
  | 'pollTracing'
  | 'contextGenerator'
  | 'attributeTarget'
>;

export type ResolvedConsumerObservability = {
  tracer: Tracer;
  meter: Meter;
  logger: Logger;
  pollTracing: PollTracing;
  contextGenerator: ObservabilityContextGenerator;
  attributeTarget: AttributeTarget;
};

export const consumerObservability = (
  options: { observability?: ConsumerObservabilityConfig } | undefined,
  parent?: EmmettObservabilityConfig,
): ResolvedConsumerObservability => {
  const observability = mergeWithDefaultObservability(
    parent,
    options?.observability,
  );

  return {
    tracer: observability?.tracer ?? noopTracer(),
    meter: observability?.meter ?? noopMeter(),
    logger: observability?.logger ?? noopLogger,
    pollTracing: observability?.pollTracing ?? 'off',
    contextGenerator:
      observability?.contextGenerator ?? defaultObservabilityContextGenerator,
    attributeTarget: observability?.attributeTarget ?? 'both',
  };
};

export const consumerCollector = (
  observability: ResolvedConsumerObservability,
) => {
  const { startScope } = ObservabilityScope({
    ...observability,
    attributePrefix: 'emmett',
  });
  const A = EmmettAttributes;
  const M = MessagingAttributes;
  const pollDuration = observability.meter.histogram(
    EmmettMetrics.consumer.pollDuration,
  );
  const deliveryDuration = observability.meter.histogram(
    EmmettMetrics.consumer.deliveryDuration,
  );

  return {
    tracePoll: <T>(
      context: {
        processorCount: number;
        batchSize: number;
        empty: boolean;
        waitMs?: number;
      },
      fn: (scope: ObservabilityScope) => Promise<T>,
    ): Promise<T> => {
      const skip =
        observability.pollTracing === 'off' ||
        (observability.pollTracing === 'active' && context.batchSize === 0);

      if (skip) return fn(noopScope);

      return startScope('consumer.poll', async (scope) => {
        scope.setAttributes({
          [A.scope.type]: ScopeTypes.consumer,
          [A.consumer.batchSize]: context.batchSize,
          [A.consumer.processorCount]: context.processorCount,
          [M.system]: MessagingSystemName,
          [M.operation.type]: 'receive',
          ...(context.empty ? { 'emmett.consumer.poll.empty': true } : {}),
          ...(context.waitMs != null
            ? { 'emmett.consumer.poll.wait_ms': context.waitMs }
            : {}),
        });
        return fn(scope);
      });
    },

    lifecycleScope: <T>(
      name: string,
      context: { consumerId: string; processorCount: number },
      fn: (scope: ObservabilityScope) => Promise<T>,
      options?: { links?: SpanLink[] },
    ): Promise<T> =>
      startScope(name, fn, {
        attributes: {
          [A.consumer.id]: context.consumerId,
          [A.consumer.processorCount]: context.processorCount,
        },
        ...(options?.links ? { links: options.links } : {}),
      }),

    recordPollMetrics: (
      durationMs: number,
      attrs?: Record<string, unknown>,
    ): void => {
      pollDuration.record(durationMs, attrs);
    },

    traceDelivery: <T>(
      scope: ObservabilityScope,
      processorId: string,
      fn: () => Promise<T>,
    ): Promise<T> => {
      const start = Date.now();
      return scope.scope(
        `consumer.deliver.${processorId}`,
        async () => {
          try {
            const result = await fn();
            return result;
          } finally {
            deliveryDuration.record(Date.now() - start, {
              [A.consumer.delivery.processorId]: processorId,
            });
          }
        },
        {
          attributes: {
            [A.consumer.delivery.processorId]: processorId,
          },
        },
      );
    },
  };
};
