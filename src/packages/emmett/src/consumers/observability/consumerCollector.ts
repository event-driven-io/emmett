import {
  LogEvent,
  MessagingAttributes,
  noopMeter,
  noopScope,
  noopTracer,
  ObservabilityScope,
  type AttributeTarget,
  type Meter,
  type ObservabilityScope as ObservabilityScopeType,
  type Tracer,
} from '@event-driven-io/almanac';
import {
  EmmettAttributes,
  EmmettMetrics,
  mergeObservabilityOptions,
  MessagingSystemName,
  ScopeTypes,
  type EmmettObservabilityConfig,
  type EmmettObservabilityOptions,
  type PollTracing,
} from '../../observability';

export type ConsumerObservabilityConfig = Pick<
  EmmettObservabilityConfig,
  'tracer' | 'meter' | 'pollTracing' | 'attributeTarget'
>;

export type ResolvedConsumerObservability = {
  tracer: Tracer;
  meter: Meter;
  pollTracing: PollTracing;
  attributeTarget: AttributeTarget;
};

export const consumerObservability = (
  options: { observability?: ConsumerObservabilityConfig } | undefined,
  parent?: EmmettObservabilityOptions,
): ResolvedConsumerObservability => {
  const observability = mergeObservabilityOptions(
    { observability: options?.observability },
    parent?.observability,
  ).observability;

  return {
    tracer: observability?.tracer ?? noopTracer(),
    meter: observability?.meter ?? noopMeter(),
    pollTracing: observability?.pollTracing ?? 'off',
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
      fn: (scope: ObservabilityScopeType) => Promise<T>,
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
      scope: ObservabilityScopeType,
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
