import {
  LogEvent,
  MessagingAttributes,
  noopLogger,
  noopMeter,
  noopScope,
  noopTracer,
  ObservabilityScope as createObservabilityScope,
  type AttributeTarget,
  type Logger,
  type Meter,
  type ObservabilityScope,
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
  'tracer' | 'meter' | 'logger' | 'pollTracing' | 'attributeTarget'
>;

export type ResolvedConsumerObservability = {
  tracer: Tracer;
  meter: Meter;
  logger: Logger;
  pollTracing: PollTracing;
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
    attributeTarget: observability?.attributeTarget ?? 'both',
  };
};

export const consumerCollector = (
  observability: ResolvedConsumerObservability,
) => {
  const { startScope } = createObservabilityScope({
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
        async (child) => {
          try {
            const result = await fn();
            return result;
          } catch (error) {
            if (error instanceof Error) child.log(LogEvent.error(error));
            throw error;
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
