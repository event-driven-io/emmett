import {
  collectingMeter,
  collectingTracer,
  LogEvent,
  noopLogger,
  ObservabilitySpec,
} from '@event-driven-io/almanac';
import { afterEach, describe, expect, it } from 'vitest';
import {
  EmmettAttributes,
  EmmettMetrics,
  MessagingSystemName,
  setDefaultObservability,
} from '../../observability';
import { workflowCollector, workflowObservability } from './workflowCollector';

const A = EmmettAttributes;
const M = { system: 'messaging.system' };

const defaultContext = {
  workflowId: 'wf-1',
  workflowType: 'OrderWorkflow',
  inputType: 'PlaceOrder',
};

const given = ObservabilitySpec.for();

afterEach(() => setDefaultObservability(undefined));

describe('workflowCollector', () => {
  it('creates workflow.handle scope with emmett.scope.type=workflow and emmett.scope.main=true', async () => {
    await given((config) => workflowCollector(config))
      .when((collector) =>
        collector.startScope(defaultContext, () => Promise.resolve()),
      )
      .then(({ spans }) =>
        spans.hasSingleSpanNamed('workflow.handle').hasAttributes({
          [A.scope.type]: 'workflow',
          'emmett.scope.main': true,
        }),
      );
  });

  it('sets emmett.workflow.id, emmett.workflow.type, emmett.workflow.input.type', async () => {
    await given((config) => workflowCollector(config))
      .when((collector) =>
        collector.startScope(
          {
            workflowId: 'wf-42',
            workflowType: 'ShippingWorkflow',
            inputType: 'ShipOrder',
          },
          () => Promise.resolve(),
        ),
      )
      .then(({ spans }) =>
        spans.hasSingleSpanNamed('workflow.handle').hasAttributes({
          [A.workflow.id]: 'wf-42',
          [A.workflow.type]: 'ShippingWorkflow',
          [A.workflow.inputType]: 'ShipOrder',
        }),
      );
  });

  it('sets emmett.workflow.outputs and emmett.workflow.outputs.count via recordOutputs', async () => {
    const outputs = [{ type: 'OrderShipped' }, { type: 'NotificationSent' }];
    await given((config) => workflowCollector(config))
      .when((collector) =>
        collector.startScope(defaultContext, (scope) => {
          collector.recordOutputs(scope, outputs);
          return Promise.resolve();
        }),
      )
      .then(({ spans }) =>
        spans.hasSingleSpanNamed('workflow.handle').hasAttributes({
          [A.workflow.outputs]: ['OrderShipped', 'NotificationSent'],
          [A.workflow.outputsCount]: 2,
        }),
      );
  });

  it('creates child scopes for evolve and decide', async () => {
    await given((config) => workflowCollector(config))
      .when((collector) =>
        collector.startScope(defaultContext, async (scope) => {
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
    await given((config) => workflowCollector(config))
      .when((collector) =>
        collector.startScope(defaultContext, () => Promise.resolve()),
      )
      .then(({ spans }) =>
        spans
          .hasSingleSpanNamed('workflow.handle')
          .hasAttribute(M.system, MessagingSystemName),
      );
  });

  it('sets emmett.workflow.state_rebuild.event_count via recordStateRebuild', async () => {
    await given((config) => workflowCollector(config))
      .when((collector) =>
        collector.startScope(defaultContext, (scope) => {
          collector.recordStateRebuild(scope, 7);
          return Promise.resolve();
        }),
      )
      .then(({ spans }) =>
        spans
          .hasSingleSpanNamed('workflow.handle')
          .hasAttribute(A.workflow.stateRebuildEventCount, 7),
      );
  });

  it('records emmett.workflow.processing.duration histogram with workflow type', async () => {
    const meter = collectingMeter();
    const obs = {
      tracer: collectingTracer(),
      meter,
      logger: noopLogger,
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
});

describe('workflowObservability', () => {
  it('uses default observability when handling a workflow', async () => {
    await given((observability) => {
      setDefaultObservability(observability);
      return workflowCollector(workflowObservability(undefined));
    })
      .when((collector) =>
        collector.startScope(defaultContext, (scope) => {
          scope.log(LogEvent.info('using global observability'));
          return Promise.resolve();
        }),
      )
      .then(({ spans, metrics }) => {
        spans
          .hasSingleSpanNamed('workflow.handle')
          .logged('info', 'using global observability');
        metrics
          .haveHistogramNamed(EmmettMetrics.workflow.processingDuration)
          .hasValueAtLeast(0);
      });
  });

  it('works with noop observability', async () => {
    const o11y = workflowObservability(undefined);
    const collector = workflowCollector(o11y);
    await collector.startScope(defaultContext, () => Promise.resolve());
  });

  it('returns noop tracer, meter, propagation=links, attributeTarget=both when no options', () => {
    const resolved = workflowObservability(undefined);
    expect(resolved.tracer).toBeDefined();
    expect(resolved.meter).toBeDefined();
    expect(resolved.propagation).toBe('links');
    expect(resolved.attributeTarget).toBe('both');
  });

  it('uses provided propagation and attributeTarget', () => {
    const resolved = workflowObservability({
      observability: { propagation: 'propagate', attributeTarget: 'mainSpan' },
    });
    expect(resolved.propagation).toBe('propagate');
    expect(resolved.attributeTarget).toBe('mainSpan');
  });

  it('falls back to parent', () => {
    const resolved = workflowObservability(undefined, {
      propagation: 'propagate',
    });
    expect(resolved.propagation).toBe('propagate');
  });

  it('defaults includeMessagePayloads to false', () => {
    const resolved = workflowObservability(undefined);
    expect(resolved.includeMessagePayloads).toBe(false);
  });

  it('uses provided includeMessagePayloads', () => {
    const resolved = workflowObservability({
      observability: { includeMessagePayloads: true },
    });
    expect(resolved.includeMessagePayloads).toBe(true);
  });
});
