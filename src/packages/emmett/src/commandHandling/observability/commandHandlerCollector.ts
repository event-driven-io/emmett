import {
  LogEvent,
  MessagingAttributes,
  defaultObservabilityContextGenerator,
  noopLogger,
  noopMeter,
  noopTracer,
  ObservabilityScope as createObservabilityScope,
  type AttributeTarget,
  type Logger,
  type Meter,
  type ObservabilityScope,
  type ObservabilityContextGenerator,
  type Tracer,
} from '@event-driven-io/almanac';
import {
  EmmettAttributes,
  EmmettMetrics,
  MessagingSystemName,
  ScopeTypes,
} from '../../observability/attributes';
import { mergeWithDefaultObservability } from '../../observability/defaultObservability';
import type {
  EmmettObservabilityConfig,
  OperationObservabilityOptions,
} from '../../observability/options';
import { withOperationAttributes } from '../../observability/options';
import type { Event } from '../../typing';

export type CommandObservabilityConfig = Pick<
  EmmettObservabilityConfig,
  | 'tracer'
  | 'meter'
  | 'logger'
  | 'attributeTarget'
  | 'includeMessagePayloads'
  | 'contextGenerator'
>;

export type ResolvedCommandObservability = {
  tracer: Tracer;
  meter: Meter;
  logger: Logger;
  attributeTarget: AttributeTarget;
  includeMessagePayloads: boolean;
  contextGenerator: ObservabilityContextGenerator;
};

export const commandObservability = (
  options: { observability?: CommandObservabilityConfig } | undefined,
  parent?: EmmettObservabilityConfig,
): ResolvedCommandObservability => {
  const observability = mergeWithDefaultObservability(
    parent,
    options?.observability,
  );

  return {
    tracer: observability?.tracer ?? noopTracer(),
    meter: observability?.meter ?? noopMeter(),
    logger: observability?.logger ?? noopLogger,
    attributeTarget: observability?.attributeTarget ?? 'both',
    includeMessagePayloads: observability?.includeMessagePayloads ?? false,
    contextGenerator:
      observability?.contextGenerator ?? defaultObservabilityContextGenerator,
  };
};

export type CommandHandlerCollectorContext = {
  streamName: string;
  commandType?: string | string[];
  correlationId?: string;
  causationId?: string;
};

export const commandHandlerCollector = (
  observability: ResolvedCommandObservability,
) => {
  const { startScope } = createObservabilityScope({
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
  const startCommandScope = <T>(
    name: string,
    fn: (scope: ObservabilityScope) => Promise<T>,
    options?: OperationObservabilityOptions,
  ): Promise<T> => {
    if (options?.scope) {
      const { scope, ...scopeOptions } = options;
      return scope.scope(name, fn, scopeOptions);
    }

    return startScope(name, fn, options);
  };

  return {
    startScope: <T>(
      context: CommandHandlerCollectorContext,
      fn: (scope: ObservabilityScope) => Promise<T>,
      options?: OperationObservabilityOptions,
    ): Promise<T> => {
      const start = Date.now();
      return startCommandScope(
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
            scope.log(
              LogEvent.error(
                err instanceof Error ? err : new Error(String(err)),
              ),
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
        withOperationAttributes(options, {
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
        }),
      );
    },

    recordEvents: (
      scope: ObservabilityScope,
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
      scope: ObservabilityScope,
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
