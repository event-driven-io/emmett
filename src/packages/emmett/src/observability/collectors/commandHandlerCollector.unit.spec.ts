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
import { resolveCommandObservability } from '../options';
import { commandHandlerCollector } from './commandHandlerCollector';

const A = EmmettAttributes;
const M = {
  system: 'messaging.system',
  destinationName: 'messaging.destination.name',
  batchMessageCount: 'messaging.batch.message_count',
};

const given = ObservabilitySpec.for();

describe('commandHandlerCollector', () => {
  it('creates a span named command.handle with emmett.scope.type=command and emmett.scope.main=true', async () => {
    await given({})
      .when((config) =>
        commandHandlerCollector(config).startScope(
          { streamName: 'test-stream' },
          () => Promise.resolve(),
        ),
      )
      .then(({ spans }) =>
        spans.haveSpanNamed('command.handle').hasAttributes({
          [A.scope.type]: 'command',
          'emmett.scope.main': true,
        }),
      );
  });

  it('sets emmett.stream.name via creation-time attributes', async () => {
    await given({})
      .when((config) =>
        commandHandlerCollector(config).startScope(
          { streamName: 'orders-123' },
          () => Promise.resolve(),
        ),
      )
      .then(({ spans }) =>
        spans
          .haveSpanNamed('command.handle')
          .hasAttribute(A.stream.name, 'orders-123'),
      );
  });

  it('sets messaging.system and messaging.destination.name', async () => {
    await given({})
      .when((config) =>
        commandHandlerCollector(config).startScope(
          { streamName: 'orders-123' },
          () => Promise.resolve(),
        ),
      )
      .then(({ spans }) =>
        spans.haveSpanNamed('command.handle').hasAttributes({
          [M.system]: MessagingSystemName,
          [M.destinationName]: 'orders-123',
        }),
      );
  });

  it('sets emmett.command.status to success on success', async () => {
    await given({})
      .when((config) =>
        commandHandlerCollector(config).startScope({ streamName: 'test' }, () =>
          Promise.resolve(),
        ),
      )
      .then(({ spans }) =>
        spans.haveSpanNamed('command.handle').hasAttributes({
          [A.command.status]: 'success',
          error: false,
        }),
      );
  });

  it('recordEvents sets event_count, event_types, batch_message_count and increments counter per event', async () => {
    const events = [
      { type: 'OrderPlaced', data: {}, kind: 'Event' as const },
      { type: 'ItemAdded', data: {}, kind: 'Event' as const },
    ];
    await given({})
      .when((config) =>
        commandHandlerCollector(config).startScope(
          { streamName: 'test' },
          (scope) => {
            commandHandlerCollector(config).recordEvents(
              scope,
              events,
              'success',
            );
            return Promise.resolve();
          },
        ),
      )
      .then(({ spans }) =>
        spans.haveSpanNamed('command.handle').hasAttributes({
          [A.command.eventCount]: 2,
          [A.command.eventTypes]: ['OrderPlaced', 'ItemAdded'],
          [M.batchMessageCount]: 2,
        }),
      );
  });

  it('recordVersions sets stream version before and after', async () => {
    await given({})
      .when((config) =>
        commandHandlerCollector(config).startScope(
          { streamName: 'test' },
          (scope) => {
            commandHandlerCollector(config).recordVersions(scope, 3n, 5n);
            return Promise.resolve();
          },
        ),
      )
      .then(({ spans }) =>
        spans.haveSpanNamed('command.handle').hasAttributes({
          [A.stream.versionBefore]: 3,
          [A.stream.versionAfter]: 5,
        }),
      );
  });

  it('scope.scope creates child scopes', async () => {
    await given({})
      .when((config) =>
        commandHandlerCollector(config).startScope(
          { streamName: 'test' },
          async (scope) => {
            await scope.scope('decide', () => Promise.resolve());
          },
        ),
      )
      .then(({ spans }) => spans.containSpanNamed('decide'));
  });

  it('sets emmett.command.status to failure and error attributes on error', async () => {
    const tracer = collectingTracer();
    const obs = {
      tracer,
      meter: collectingMeter(),
      attributeTarget: 'both' as const,
      includeMessagePayloads: false,
    };
    await expect(
      commandHandlerCollector(obs).startScope({ streamName: 'test' }, () =>
        Promise.reject(new Error('boom')),
      ),
    ).rejects.toThrow('boom');
    const span = tracer.spans.find((s) => s.name === 'command.handle');
    expect(span).toBeDefined();
    expect(span!.attributes[A.command.status]).toBe('failure');
    expect(span!.attributes['error']).toBe(true);
    expect(span!.attributes['exception.message']).toBe('boom');
    expect(span!.attributes['exception.type']).toBe('Error');
  });

  it('records emmett.command.handling.duration histogram', async () => {
    const meter = collectingMeter();
    const obs = {
      tracer: collectingTracer(),
      meter,
      attributeTarget: 'both' as const,
      includeMessagePayloads: false,
    };
    await commandHandlerCollector(obs).startScope({ streamName: 'test' }, () =>
      Promise.resolve(),
    );
    const entry = meter.histograms.find(
      (h) => h.name === EmmettMetrics.command.handlingDuration,
    );
    expect(entry).toBeDefined();
    expect(entry!.value).toBeGreaterThanOrEqual(0);
  });

  it('recordEvents increments counter per event', async () => {
    const meter = collectingMeter();
    const obs = {
      tracer: collectingTracer(),
      meter,
      attributeTarget: 'both' as const,
      includeMessagePayloads: false,
    };
    const events = [
      { type: 'OrderPlaced', data: {}, kind: 'Event' as const },
      { type: 'ItemAdded', data: {}, kind: 'Event' as const },
    ];
    await commandHandlerCollector(obs).startScope(
      { streamName: 'test' },
      (scope) => {
        commandHandlerCollector(obs).recordEvents(scope, events, 'success');
        return Promise.resolve();
      },
    );
    const counters = meter.counters.filter(
      (c) => c.name === EmmettMetrics.event.appendingCount,
    );
    expect(counters.length).toBe(2);
  });

  it('works with noop observability', async () => {
    const o11y = resolveCommandObservability(undefined);
    const collector = commandHandlerCollector(o11y);
    await collector.startScope({ streamName: 'test' }, () => Promise.resolve());
  });
});
