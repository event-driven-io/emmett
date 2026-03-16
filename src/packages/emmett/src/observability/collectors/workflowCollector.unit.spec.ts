import {
  collectingMeter,
  collectingTracer,
  ObservabilitySpec,
} from '@event-driven-io/almanac';
import { describe, expect, it } from 'vitest';
import {
  EmmettAttributes,
  EmmettMetrics,
  MessagingSystemName,
} from '../attributes';
import { resolveWorkflowObservability } from '../options';
import { workflowCollector } from './workflowCollector';

const A = EmmettAttributes;
const M = { system: 'messaging.system' };

const defaultContext = {
  workflowId: 'wf-1',
  workflowType: 'OrderWorkflow',
  inputType: 'PlaceOrder',
};

const given = ObservabilitySpec.for();

describe('workflowCollector', () => {
  it('creates workflow.handle scope with emmett.scope.type=workflow and emmett.scope.main=true', async () => {
    await given({})
      .when((config) =>
        workflowCollector(config).startScope(defaultContext, () =>
          Promise.resolve(),
        ),
      )
      .then(({ spans }) =>
        spans.haveSpanNamed('workflow.handle').hasAttributes({
          [A.scope.type]: 'workflow',
          'emmett.scope.main': true,
        }),
      );
  });

  it('sets emmett.workflow.id, emmett.workflow.type, emmett.workflow.input.type', async () => {
    await given({})
      .when((config) =>
        workflowCollector(config).startScope(
          {
            workflowId: 'wf-42',
            workflowType: 'ShippingWorkflow',
            inputType: 'ShipOrder',
          },
          () => Promise.resolve(),
        ),
      )
      .then(({ spans }) =>
        spans.haveSpanNamed('workflow.handle').hasAttributes({
          [A.workflow.id]: 'wf-42',
          [A.workflow.type]: 'ShippingWorkflow',
          [A.workflow.inputType]: 'ShipOrder',
        }),
      );
  });

  it('sets emmett.workflow.outputs and emmett.workflow.outputs.count via recordOutputs', async () => {
    const outputs = [{ type: 'OrderShipped' }, { type: 'NotificationSent' }];
    await given({})
      .when((config) =>
        workflowCollector(config).startScope(defaultContext, (scope) => {
          workflowCollector(config).recordOutputs(scope, outputs);
          return Promise.resolve();
        }),
      )
      .then(({ spans }) =>
        spans.haveSpanNamed('workflow.handle').hasAttributes({
          [A.workflow.outputs]: ['OrderShipped', 'NotificationSent'],
          [A.workflow.outputsCount]: 2,
        }),
      );
  });

  it('creates child scopes for evolve and decide', async () => {
    await given({})
      .when((config) =>
        workflowCollector(config).startScope(defaultContext, async (scope) => {
          await scope.scope('workflow.evolve', () => Promise.resolve());
          await scope.scope('workflow.decide', () => Promise.resolve());
        }),
      )
      .then(({ spans }) =>
        spans
          .containSpanNamed('workflow.evolve')
          .containSpanNamed('workflow.decide'),
      );
  });

  it('sets messaging.system', async () => {
    await given({})
      .when((config) =>
        workflowCollector(config).startScope(defaultContext, () =>
          Promise.resolve(),
        ),
      )
      .then(({ spans }) =>
        spans
          .haveSpanNamed('workflow.handle')
          .hasAttribute(M.system, MessagingSystemName),
      );
  });

  it('sets emmett.workflow.state_rebuild.event_count via recordStateRebuild', async () => {
    await given({})
      .when((config) =>
        workflowCollector(config).startScope(defaultContext, (scope) => {
          workflowCollector(config).recordStateRebuild(scope, 7);
          return Promise.resolve();
        }),
      )
      .then(({ spans }) =>
        spans
          .haveSpanNamed('workflow.handle')
          .hasAttribute(A.workflow.stateRebuildEventCount, 7),
      );
  });

  it('records emmett.workflow.processing.duration histogram with workflow type', async () => {
    const meter = collectingMeter();
    const obs = {
      tracer: collectingTracer(),
      meter,
      propagation: 'links' as const,
      attributeTarget: 'both' as const,
      includeMessagePayloads: false,
    };
    const collector = workflowCollector(obs);
    await collector.startScope(defaultContext, () => Promise.resolve());
    const h = meter.histograms.find(
      (h) => h.name === EmmettMetrics.workflow.processingDuration,
    );
    expect(h).toBeDefined();
    expect(h!.value).toBeGreaterThanOrEqual(0);
    expect((h!.attributes as Record<string, unknown>)[A.workflow.type]).toBe(
      'OrderWorkflow',
    );
  });

  it('works with noop observability', async () => {
    const o11y = resolveWorkflowObservability(undefined);
    const collector = workflowCollector(o11y);
    await collector.startScope(defaultContext, () => Promise.resolve());
  });
});
