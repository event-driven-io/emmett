import {
  ObservabilityScope,
  MessagingAttributes,
  type ObservabilityScope as ObservabilityScopeType,
} from '@event-driven-io/almanac';
import {
  EmmettAttributes,
  EmmettMetrics,
  MessagingSystemName,
  ScopeTypes,
} from '../attributes';
import type { ResolvedConsumerObservability } from '../options';

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
    shouldTrace: (messageCount: number): boolean => {
      if (observability.pollTracing === 'off') return false;
      if (observability.pollTracing === 'active') return messageCount > 0;
      return true;
    },

    tracePoll: <T>(
      context: {
        processorCount: number;
        batchSize: number;
        empty: boolean;
        waitMs?: number;
      },
      fn: (scope: ObservabilityScopeType) => Promise<T>,
    ): Promise<T> =>
      startScope('consumer.poll', async (scope) => {
        scope.setAttributes({
          [A.scope.type]: ScopeTypes.consumer,
          [A.consumer.batchSize]: context.batchSize,
          [A.consumer.processorCount]: context.processorCount,
          [M.system]: MessagingSystemName,
          [M.operationType]: 'receive',
          ...(context.empty ? { 'emmett.consumer.poll.empty': true } : {}),
          ...(context.waitMs != null
            ? { 'emmett.consumer.poll.wait_ms': context.waitMs }
            : {}),
        });
        return fn(scope);
      }),

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
            if (error instanceof Error) child.recordException(error);
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
