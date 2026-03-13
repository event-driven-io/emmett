import { describe, expect, it } from 'vitest';
import { collectingTracer, collectingMeter } from '@event-driven-io/almanac';
import { commandHandlerCollector } from './commandHandlerCollector';
import { resolveCommandObservability } from '../options';
import {
  EmmettAttributes,
  EmmettMetrics,
  MessagingSystemName,
} from '../attributes';

const A = EmmettAttributes;
const M = {
  system: 'messaging.system',
  destinationName: 'messaging.destination.name',
  batchMessageCount: 'messaging.batch.message_count',
};

const makeObservability = () => {
  const tracer = collectingTracer();
  const meter = collectingMeter();
  return {
    tracer,
    meter,
    attributeTarget: 'both' as const,
    includeMessagePayloads: false,
  };
};

describe('commandHandlerCollector', () => {
  it('creates a span named command.handle', async () => {
    const obs = makeObservability();
    const collector = commandHandlerCollector(obs);
    await collector.startScope({ streamName: 'test-stream' }, () =>
      Promise.resolve(),
    );
    expect(obs.tracer.spans.some((s) => s.name === 'command.handle')).toBe(
      true,
    );
  });

  it('sets emmett.scope.type and emmett.scope.main on root span', async () => {
    const obs = makeObservability();
    const collector = commandHandlerCollector(obs);
    await collector.startScope({ streamName: 'test-stream' }, () =>
      Promise.resolve(),
    );
    const span = obs.tracer.spans.find((s) => s.name === 'command.handle');
    expect(span).toBeDefined();
    expect(span!.attributes[A.scope.type]).toBe('command');
    expect(span!.attributes['emmett.scope.main']).toBe(true);
  });

  it('sets emmett.stream.name via creation-time attributes', async () => {
    const obs = makeObservability();
    const collector = commandHandlerCollector(obs);
    await collector.startScope({ streamName: 'orders-123' }, () =>
      Promise.resolve(),
    );
    const span = obs.tracer.spans.find((s) => s.name === 'command.handle');
    expect(span).toBeDefined();
    expect(span!.attributes[A.stream.name]).toBe('orders-123');
  });

  it('sets messaging.system and messaging.destination.name', async () => {
    const obs = makeObservability();
    const collector = commandHandlerCollector(obs);
    await collector.startScope({ streamName: 'orders-123' }, () =>
      Promise.resolve(),
    );
    const span = obs.tracer.spans.find((s) => s.name === 'command.handle');
    expect(span).toBeDefined();
    expect(span!.attributes[M.system]).toBe(MessagingSystemName);
    expect(span!.attributes[M.destinationName]).toBe('orders-123');
  });

  it('sets emmett.command.status to success on success', async () => {
    const obs = makeObservability();
    const collector = commandHandlerCollector(obs);
    await collector.startScope({ streamName: 'test' }, () => Promise.resolve());
    const span = obs.tracer.spans.find((s) => s.name === 'command.handle');
    expect(span).toBeDefined();
    expect(span!.attributes[A.command.status]).toBe('success');
    expect(span!.attributes['error']).toBe(false);
  });

  it('sets emmett.command.status to failure and error attributes on error', async () => {
    const obs = makeObservability();
    const collector = commandHandlerCollector(obs);
    await expect(
      collector.startScope({ streamName: 'test' }, () =>
        Promise.reject(new Error('boom')),
      ),
    ).rejects.toThrow('boom');
    const span = obs.tracer.spans.find((s) => s.name === 'command.handle');
    expect(span).toBeDefined();
    expect(span!.attributes[A.command.status]).toBe('failure');
    expect(span!.attributes['error']).toBe(true);
    expect(span!.attributes['exception.message']).toBe('boom');
    expect(span!.attributes['exception.type']).toBe('Error');
  });

  it('records emmett.command.handling.duration histogram', async () => {
    const obs = makeObservability();
    const collector = commandHandlerCollector(obs);
    await collector.startScope({ streamName: 'test' }, () => Promise.resolve());
    const entry = obs.meter.histograms.find(
      (h) => h.name === EmmettMetrics.command.handlingDuration,
    );
    expect(entry).toBeDefined();
    expect(entry!.value).toBeGreaterThanOrEqual(0);
  });

  it('recordEvents sets event_count, event_types, batch_message_count and increments counter per event', async () => {
    const obs = makeObservability();
    const collector = commandHandlerCollector(obs);
    const events = [
      { type: 'OrderPlaced', data: {}, kind: 'Event' as const },
      { type: 'ItemAdded', data: {}, kind: 'Event' as const },
    ];
    await collector.startScope({ streamName: 'test' }, (scope) => {
      collector.recordEvents(scope, events, 'success');
      return Promise.resolve();
    });
    const span = obs.tracer.spans.find((s) => s.name === 'command.handle');
    expect(span).toBeDefined();
    expect(span!.attributes[A.command.eventCount]).toBe(2);
    expect(span!.attributes[A.command.eventTypes]).toEqual([
      'OrderPlaced',
      'ItemAdded',
    ]);
    expect(span!.attributes[M.batchMessageCount]).toBe(2);
    const counters = obs.meter.counters.filter(
      (c) => c.name === EmmettMetrics.event.appendingCount,
    );
    expect(counters.length).toBe(2);
  });

  it('recordVersions sets stream version before and after', async () => {
    const obs = makeObservability();
    const collector = commandHandlerCollector(obs);
    await collector.startScope({ streamName: 'test' }, (scope) => {
      collector.recordVersions(scope, 3n, 5n);
      return Promise.resolve();
    });
    const span = obs.tracer.spans.find((s) => s.name === 'command.handle');
    expect(span).toBeDefined();
    expect(span!.attributes[A.stream.versionBefore]).toBe(3);
    expect(span!.attributes[A.stream.versionAfter]).toBe(5);
  });

  it('scope.scope creates child scopes', async () => {
    const obs = makeObservability();
    const collector = commandHandlerCollector(obs);
    await collector.startScope({ streamName: 'test' }, async (scope) => {
      await scope.scope('decide', () => Promise.resolve());
    });
    expect(obs.tracer.spans.some((s) => s.name === 'decide')).toBe(true);
  });

  it('works with noop observability', async () => {
    const o11y = resolveCommandObservability(undefined);
    const collector = commandHandlerCollector(o11y);
    await collector.startScope({ streamName: 'test' }, () => Promise.resolve());
  });
});
