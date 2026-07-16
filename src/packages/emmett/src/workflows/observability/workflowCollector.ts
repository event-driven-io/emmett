import {
  MessagingAttributes,
  noopLogger,
  noopMeter,
  noopTracer,
  ObservabilityScope as createObservabilityScope,
  type AttributeTarget,
  type Logger,
  type Meter,
  type ObservabilityScope,
  type TracePropagation,
  type Tracer,
} from '@event-driven-io/almanac';
import {
  EmmettAttributes,
  EmmettMetrics,
  MessagingSystemName,
  ScopeTypes,
  type EmmettObservabilityConfig,
} from '../../observability';
import { mergeWithDefaultObservability } from '../../observability/defaultObservability';

export type WorkflowObservabilityConfig = Pick<
  EmmettObservabilityConfig,
  | 'tracer'
  | 'meter'
  | 'logger'
  | 'propagation'
  | 'attributeTarget'
  | 'includeMessagePayloads'
>;

export type ResolvedWorkflowObservability = {
  tracer: Tracer;
  meter: Meter;
  logger: Logger;
  propagation: TracePropagation;
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
  const { startScope } = createObservabilityScope({
    ...observability,
    attributePrefix: 'emmett',
  });
  const A = EmmettAttributes;
  const M = MessagingAttributes;
  const processingDuration = observability.meter.histogram(
    EmmettMetrics.workflow.processingDuration,
  );

  return {
    startScope: <T>(
      context: WorkflowCollectorContext,
      fn: (scope: ObservabilityScope) => Promise<T>,
    ): Promise<T> => {
      const start = Date.now();
      return startScope(
        'workflow.handle',
        async (scope) => {
          scope.setAttributes({
            [A.scope.type]: ScopeTypes.workflow,
            [A.workflow.id]: context.workflowId,
            [A.workflow.type]: context.workflowType,
            [A.workflow.inputType]: context.inputType,
            [M.system]: MessagingSystemName,
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
        {
          attributes: {
            [A.scope.type]: ScopeTypes.workflow,
            [A.workflow.type]: context.workflowType,
          },
        },
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
