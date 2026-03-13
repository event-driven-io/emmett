import {
  ObservabilityScope,
  MessagingAttributes,
  type ObservabilityScope as ObservabilityScopeType,
} from '@event-driven-io/almanac';
import type { Event } from '../../typing';
import {
  EmmettAttributes,
  EmmettMetrics,
  MessagingSystemName,
  ScopeTypes,
} from '../attributes';
import type { ResolvedCommandObservability } from '../options';

export type CommandHandlerCollectorContext = {
  streamName: string;
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
      return startScope(
        'command.handle',
        async (scope) => {
          scope.setAttributes({
            [A.scope.type]: ScopeTypes.command,
            [M.system]: MessagingSystemName,
            [M.destinationName]: context.streamName,
          });

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
            });
          }
        },
        {
          attributes: {
            [A.scope.type]: ScopeTypes.command,
            [A.stream.name]: context.streamName,
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
        [M.batchMessageCount]: events.length,
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
