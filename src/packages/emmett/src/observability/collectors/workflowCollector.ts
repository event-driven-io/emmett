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
import type { ResolvedWorkflowObservability } from '../options';

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
            status = 'success';
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
