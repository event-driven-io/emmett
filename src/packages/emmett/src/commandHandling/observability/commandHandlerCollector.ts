import {
  MessagingAttributes,
  ObservabilityScope,
  type ObservabilityScope as ObservabilityScopeType,
} from '@event-driven-io/almanac';
import {
  EmmettAttributes,
  EmmettMetrics,
  MessagingSystemName,
  ScopeTypes,
} from '../../observability/attributes';
import type { ResolvedCommandObservability } from '../../observability/options';
import type { Event } from '../../typing';

export type CommandHandlerCollectorContext = {
  streamName: string;
  commandType?: string | string[];
  correlationId?: string;
  causationId?: string;
  traceId?: string;
  spanId?: string;
};

export const commandHandlerCollector = (
  observability: ResolvedCommandObservability,
) => {
  const { startScope } = ObservabilityScope({
    ...observability,
    attributePrefix: 'emmett',
  });
  const A = EmmettAttributes;
  const M = MessagingAttributes;
  const commandHandlingDuration = observability.meter.histogram(
    EmmettMetrics.command.handlingDuration,
  );
  const eventAppendingCount = observability.meter.counter(
    EmmettMetrics.event.appendingCount,
  );

  return {
    startScope: <T>(
      context: CommandHandlerCollectorContext,
      fn: (scope: ObservabilityScopeType) => Promise<T>,
    ): Promise<T> => {
      const start = Date.now();
      const parent =
        context.traceId && context.spanId
          ? { traceId: context.traceId, spanId: context.spanId }
          : undefined;
      return startScope(
        'command.handle',
        async (scope) => {
          scope.setAttributes({
            [A.scope.type]: ScopeTypes.command,
            [M.system]: MessagingSystemName,
            [M.destination.name]: context.streamName,
            ...(context.commandType
              ? { [A.command.type]: context.commandType }
              : {}),
            ...(context.correlationId
              ? { [M.message.correlationId]: context.correlationId }
              : {}),
            ...(context.causationId
              ? { [M.message.causationId]: context.causationId }
              : {}),
          });

          // eslint-disable-next-line no-useless-assignment
          let status = 'success';
          try {
            const result = await fn(scope);
            status = 'success';
            scope.setAttributes({
              [A.command.status]: 'success',
              error: false,
            });
            return result;
          } catch (err) {
            status = 'failure';
            scope.setAttributes({
              [A.command.status]: 'failure',
              error: true,
              'exception.message':
                err instanceof Error ? err.message : String(err),
              'exception.type':
                err instanceof Error ? err.constructor.name : 'unknown',
            });
            scope.recordException(
              err instanceof Error ? err : new Error(String(err)),
            );
            throw err;
          } finally {
            commandHandlingDuration.record(Date.now() - start, {
              [A.command.status]: status,
              ...(typeof context.commandType === 'string'
                ? { [A.command.type]: context.commandType }
                : {}),
            });
          }
        },
        {
          parent,
          attributes: {
            [A.scope.type]: ScopeTypes.command,
            [A.stream.name]: context.streamName,
            ...(context.commandType
              ? { [A.command.type]: context.commandType }
              : {}),
            ...(context.correlationId
              ? { [M.message.correlationId]: context.correlationId }
              : {}),
            ...(context.causationId
              ? { [M.message.causationId]: context.causationId }
              : {}),
          },
        },
      );
    },

    recordEvents: (
      scope: ObservabilityScopeType,
      events: Event[],
      status: string,
    ): void => {
      scope.setAttributes({
        [A.command.eventCount]: events.length,
        [A.command.eventTypes]: events.map((e) => e.type),
        [M.batch.messageCount]: events.length,
        [A.command.status]: status,
      });
      for (const event of events) {
        eventAppendingCount.add(1, { [A.event.type]: event.type });
      }
    },

    recordVersions: (
      scope: ObservabilityScopeType,
      before: bigint,
      after: bigint,
    ): void => {
      scope.setAttributes({
        [A.stream.versionBefore]: Number(before),
        [A.stream.versionAfter]: Number(after),
      });
    },
  };
};
