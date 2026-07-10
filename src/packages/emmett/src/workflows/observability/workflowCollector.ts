import {
  MessagingAttributes,
  noopMeter,
  noopTracer,
  ObservabilityScope,
  type AttributeTarget,
  type Meter,
  type ObservabilityScope as ObservabilityScopeType,
  type TracePropagation,
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
} from '../../observability';

export type WorkflowObservabilityConfig = Pick<
  EmmettObservabilityConfig,
  | 'tracer'
  | 'meter'
  | 'propagation'
  | 'attributeTarget'
  | 'includeMessagePayloads'
>;

export type ResolvedWorkflowObservability = {
  tracer: Tracer;
  meter: Meter;
  propagation: TracePropagation;
  attributeTarget: AttributeTarget;
  includeMessagePayloads: boolean;
};

export const workflowObservability = (
  options: { observability?: WorkflowObservabilityConfig } | undefined,
  parent?: EmmettObservabilityOptions,
): ResolvedWorkflowObservability => {
  const observability = mergeObservabilityOptions(
    { observability: options?.observability },
    parent?.observability,
  ).observability;

  return {
    tracer: observability?.tracer ?? noopTracer(),
    meter: observability?.meter ?? noopMeter(),
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
  const { startScope } = ObservabilityScope({
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
      fn: (scope: ObservabilityScopeType) => Promise<T>,
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
      scope: ObservabilityScopeType,
      outputs: { type: string }[],
    ): void => {
      scope.setAttributes({
        [A.workflow.outputs]: outputs.map((o) => o.type),
        [A.workflow.outputsCount]: outputs.length,
      });
    },

    recordStateRebuild: (
      scope: ObservabilityScopeType,
      eventCount: number,
    ): void => {
      scope.setAttributes({
        [A.workflow.stateRebuildEventCount]: eventCount,
      });
    },
  };
};
