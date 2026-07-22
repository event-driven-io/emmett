import {
  defaultObservabilityContextGenerator,
  MessagingAttributes,
  noopLogger,
  noopMeter,
  noopTracer,
  ObservabilityScope,
  type AttributeTarget,
  type Logger,
  type Meter,
  type ObservabilityContextGenerator,
  type TracePropagation,
  type Tracer,
} from '@event-driven-io/almanac';
import {
  EmmettAttributes,
  EmmettMetrics,
  MessagingSystemName,
  ScopeTypes,
  type EmmettObservabilityConfig,
  type OperationObservabilityOptions,
  withOperationAttributes,
} from '../../observability';
import { mergeWithDefaultObservability } from '../../observability/defaultObservability';

export type WorkflowObservabilityConfig = Pick<
  EmmettObservabilityConfig,
  | 'tracer'
  | 'meter'
  | 'logger'
  | 'propagation'
  | 'contextGenerator'
  | 'attributeTarget'
  | 'includeMessagePayloads'
>;

export type ResolvedWorkflowObservability = {
  tracer: Tracer;
  meter: Meter;
  logger: Logger;
  propagation: TracePropagation;
  contextGenerator: ObservabilityContextGenerator;
  attributeTarget: AttributeTarget;
  includeMessagePayloads: boolean;
};

export const workflowObservability = (
  options: { observability?: WorkflowObservabilityConfig } | undefined,
  parent?: EmmettObservabilityConfig,
): ResolvedWorkflowObservability => {
  const observability = mergeWithDefaultObservability(
    parent,
    options?.observability,
  );

  return {
    tracer: observability?.tracer ?? noopTracer(),
    meter: observability?.meter ?? noopMeter(),
    logger: observability?.logger ?? noopLogger,
    propagation: observability?.propagation ?? 'links',
    contextGenerator:
      observability?.contextGenerator ?? defaultObservabilityContextGenerator,
    attributeTarget: observability?.attributeTarget ?? 'both',
    includeMessagePayloads: observability?.includeMessagePayloads ?? false,
  };
};

export type WorkflowCollectorContext = {
  workflowId: string;
  workflowType: string;
  inputType: string;
};

export const workflowCollector = (
  observability: ResolvedWorkflowObservability,
) => {
  const { startScope } = ObservabilityScope({
    ...observability,
    attributePrefix: 'emmett',
  });
  const A = EmmettAttributes;
  const M = MessagingAttributes;
  const processingDuration = observability.meter.histogram(
    EmmettMetrics.workflow.processingDuration,
  );
  const startWorkflowScope = <T>(
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
      context: WorkflowCollectorContext,
      fn: (scope: ObservabilityScope) => Promise<T>,
      options?: OperationObservabilityOptions,
    ): Promise<T> => {
      const start = Date.now();
      return startWorkflowScope(
        'workflow.handle',
        async (scope) => {
          const { correlationId, causationId } = scope.context;
          scope.setAttributes({
            [A.scope.type]: ScopeTypes.workflow,
            [A.workflow.id]: context.workflowId,
            [A.workflow.type]: context.workflowType,
            [A.workflow.inputType]: context.inputType,
            [M.system]: MessagingSystemName,
            ...(correlationId
              ? { [M.message.correlationId]: correlationId }
              : {}),
            ...(causationId ? { [M.message.causationId]: causationId } : {}),
          });

          let status = 'success';
          try {
            const result = await fn(scope);
            return result;
          } catch (err) {
            status = 'failure';
            throw err;
          } finally {
            processingDuration.record(Date.now() - start, {
              [A.workflow.type]: context.workflowType,
              status,
            });
          }
        },
        withOperationAttributes(options, {
          [A.scope.type]: ScopeTypes.workflow,
          [A.workflow.type]: context.workflowType,
        }),
      );
    },

    recordOutputs: (
      scope: ObservabilityScope,
      outputs: { type: string }[],
    ): void => {
      scope.setAttributes({
        [A.workflow.outputs]: outputs.map((o) => o.type),
        [A.workflow.outputsCount]: outputs.length,
      });
    },

    recordStateRebuild: (
      scope: ObservabilityScope,
      eventCount: number,
    ): void => {
      scope.setAttributes({
        [A.workflow.stateRebuildEventCount]: eventCount,
      });
    },
  };
};
