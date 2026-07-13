import {
  collectingMeter,
  collectingTracer,
  LogEvent,
  MessagingAttributes,
  ObservabilitySpec,
} from '@event-driven-io/almanac';
import { afterEach, describe, expect, it } from 'vitest';
import { setDefaultObservability } from '../../observability';
import {
  EmmettAttributes,
  EmmettMetrics,
  MessagingSystemName,
} from '../../observability/attributes';
import {
  commandHandlerCollector,
  commandObservability,
} from './commandHandlerCollector';

const A = EmmettAttributes;
const M = MessagingAttributes;

const given = ObservabilitySpec.for();

afterEach(() => setDefaultObservability(undefined));

describe('commandHandlerCollector', () => {
  it('creates a span named command.handle with emmett.scope.type=command and emmett.scope.main=true', async () => {
    await given((config) => commandHandlerCollector(config))
      .when((collector) =>
        collector.startScope({ streamName: 'test-stream' }, () =>
          Promise.resolve(),
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
    await given((config) => commandHandlerCollector(config))
      .when((collector) =>
        collector.startScope({ streamName: 'orders-123' }, () =>
          Promise.resolve(),
        ),
      )
      .then(({ spans }) =>
        spans
          .haveSpanNamed('command.handle')
          .hasAttribute(A.stream.name, 'orders-123'),
      );
  });

  it('sets messaging.system and messaging.destination.name', async () => {
    await given((config) => commandHandlerCollector(config))
      .when((collector) =>
        collector.startScope({ streamName: 'orders-123' }, () =>
          Promise.resolve(),
        ),
      )
      .then(({ spans }) =>
        spans.haveSpanNamed('command.handle').hasAttributes({
          [M.system]: MessagingSystemName,
          [M.destination.name]: 'orders-123',
        }),
      );
  });

  it('sets emmett.command.status to success on success', async () => {
    await given((config) => commandHandlerCollector(config))
      .when((collector) =>
        collector.startScope({ streamName: 'test' }, () => Promise.resolve()),
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
    await given((config) => commandHandlerCollector(config))
      .when((collector) =>
        collector.startScope({ streamName: 'test' }, (scope) => {
          collector.recordEvents(scope, events, 'success');
          return Promise.resolve();
        }),
      )
      .then(({ spans }) =>
        spans.haveSpanNamed('command.handle').hasAttributes({
          [A.command.eventCount]: 2,
          [A.command.eventTypes]: ['OrderPlaced', 'ItemAdded'],
          [M.batch.messageCount]: 2,
        }),
      );
  });

  it('recordVersions sets stream version before and after', async () => {
    await given((config) => commandHandlerCollector(config))
      .when((collector) =>
        collector.startScope({ streamName: 'test' }, (scope) => {
          collector.recordVersions(scope, 3n, 5n);
          return Promise.resolve();
        }),
      )
      .then(({ spans }) =>
        spans.haveSpanNamed('command.handle').hasAttributes({
          [A.stream.versionBefore]: 3,
          [A.stream.versionAfter]: 5,
        }),
      );
  });

  it('scope.scope creates child scopes', async () => {
    await given((config) => commandHandlerCollector(config))
      .when((collector) =>
        collector.startScope({ streamName: 'test' }, async (scope) => {
          await scope.scope('decide', () => Promise.resolve());
        }),
      )
      .then(({ spans }) => spans.containSpanNamed('decide'));
  });

  it('sets emmett.command.status to failure and error attributes on error', async () => {
    await given((config) => commandHandlerCollector(config))
      .when((collector) =>
        collector.startScope({ streamName: 'test' }, () =>
          Promise.reject(new Error('boom')),
        ),
      )
      .thenThrows(({ spans }) =>
        spans.haveSpanNamed('command.handle').hasAttributes({
          [A.command.status]: 'failure',
          error: true,
          'exception.message': 'boom',
          'exception.type': 'Error',
        }),
      );
  });

  it('records emmett.command.handling.duration histogram', async () => {
    await given((config) => commandHandlerCollector(config))
      .when((collector) =>
        collector.startScope({ streamName: 'test' }, () => Promise.resolve()),
      )
      .then(({ metrics }) =>
        metrics
          .haveHistogramNamed(EmmettMetrics.command.handlingDuration)
          .hasValueAtLeast(0),
      );
  });

  it('recordEvents increments counter per event', async () => {
    const events = [
      { type: 'OrderPlaced', data: {}, kind: 'Event' as const },
      { type: 'ItemAdded', data: {}, kind: 'Event' as const },
    ];
    await given((config) => commandHandlerCollector(config))
      .when((collector) =>
        collector.startScope({ streamName: 'test' }, (scope) => {
          collector.recordEvents(scope, events, 'success');
          return Promise.resolve();
        }),
      )
      .then(({ metrics }) =>
        metrics
          .haveCounterNamed(EmmettMetrics.event.appendingCount)
          .recordedTimes(2),
      );
  });

  it('works with noop observability', async () => {
    const o11y = commandObservability(undefined);
    const collector = commandHandlerCollector(o11y);
    await collector.startScope({ streamName: 'test' }, () => Promise.resolve());
  });

  it('sets messaging.message.correlation_id when correlationId is provided', async () => {
    await given((config) => commandHandlerCollector(config))
      .when((collector) =>
        collector.startScope(
          { streamName: 'test', correlationId: 'corr-123' },
          () => Promise.resolve(),
        ),
      )
      .then(({ spans }) =>
        spans
          .haveSpanNamed('command.handle')
          .hasAttribute(M.message.correlationId, 'corr-123'),
      );
  });

  it('does not set messaging.message.correlation_id when correlationId is absent', async () => {
    await given((config) => commandHandlerCollector(config))
      .when((collector) =>
        collector.startScope({ streamName: 'test' }, () => Promise.resolve()),
      )
      .then(({ spans }) =>
        spans
          .haveSpanNamed('command.handle')
          .hasAttribute(M.message.correlationId, undefined),
      );
  });

  it('sets messaging.message.causation_id when causationId is provided', async () => {
    await given((config) => commandHandlerCollector(config))
      .when((collector) =>
        collector.startScope(
          { streamName: 'test', causationId: 'caus-456' },
          () => Promise.resolve(),
        ),
      )
      .then(({ spans }) =>
        spans
          .haveSpanNamed('command.handle')
          .hasAttribute(M.message.causationId, 'caus-456'),
      );
  });

  it('does not set messaging.message.causation_id when causationId is absent', async () => {
    await given((config) => commandHandlerCollector(config))
      .when((collector) =>
        collector.startScope({ streamName: 'test' }, () => Promise.resolve()),
      )
      .then(({ spans }) =>
        spans
          .haveSpanNamed('command.handle')
          .hasAttribute(M.message.causationId, undefined),
      );
  });

  it('sets emmett.command.type when commandType is provided', async () => {
    await given((config) => commandHandlerCollector(config))
      .when((collector) =>
        collector.startScope(
          { streamName: 'test', commandType: 'AddProductItem' },
          () => Promise.resolve(),
        ),
      )
      .then(({ spans }) =>
        spans
          .haveSpanNamed('command.handle')
          .hasAttribute(A.command.type, 'AddProductItem'),
      );
  });

  it('records emmett.command.type as an array when commandType is a list', async () => {
    await given((config) => commandHandlerCollector(config))
      .when((collector) =>
        collector.startScope(
          { streamName: 'test', commandType: ['AddProductItem', 'Confirm'] },
          () => Promise.resolve(),
        ),
      )
      .then(({ spans }) =>
        spans
          .haveSpanNamed('command.handle')
          .hasAttribute(A.command.type, ['AddProductItem', 'Confirm']),
      );
  });

  it('does not set emmett.command.type when commandType is absent', async () => {
    await given((config) => commandHandlerCollector(config))
      .when((collector) =>
        collector.startScope({ streamName: 'test' }, () => Promise.resolve()),
      )
      .then(({ spans }) =>
        spans
          .haveSpanNamed('command.handle')
          .hasAttribute(A.command.type, undefined),
      );
  });

  it('uses inherited trace context when traceId/spanId are provided', async () => {
    await given((config) => commandHandlerCollector(config))
      .when((collector) =>
        collector.startScope(
          {
            streamName: 'test',
            traceId: 'parent-trace',
            spanId: 'parent-span',
          },
          () => Promise.resolve(),
        ),
      )
      .then(({ spans }) =>
        spans
          .haveSpanNamed('command.handle')
          .hasParent({ traceId: 'parent-trace', spanId: 'parent-span' }),
      );
  });

  it('does not set parent when traceId/spanId are absent', async () => {
    await given((config) => commandHandlerCollector(config))
      .when((collector) =>
        collector.startScope({ streamName: 'test' }, () => Promise.resolve()),
      )
      .then(({ spans }) => spans.haveSpanNamed('command.handle').hasNoParent());
  });

  it('records emmett.command.type on the handling duration histogram for a single type', async () => {
    await given((config) => commandHandlerCollector(config))
      .when((collector) =>
        collector.startScope(
          { streamName: 'test', commandType: 'AddProductItem' },
          () => Promise.resolve(),
        ),
      )
      .then(({ metrics }) =>
        metrics
          .haveHistogramNamed(EmmettMetrics.command.handlingDuration)
          .hasAttribute(A.command.type, 'AddProductItem'),
      );
  });

  it('omits emmett.command.type from the handling duration histogram when commandType is an array', async () => {
    await given((config) => commandHandlerCollector(config))
      .when((collector) =>
        collector.startScope(
          { streamName: 'test', commandType: ['AddProductItem', 'Confirm'] },
          () => Promise.resolve(),
        ),
      )
      .then(({ metrics }) =>
        metrics
          .haveHistogramNamed(EmmettMetrics.command.handlingDuration)
          .hasAttribute(A.command.type, undefined),
      );
  });
});

describe('commandObservability', () => {
  it('uses default observability when handling a command', async () => {
    await given((observability) => {
      setDefaultObservability(observability);
      return commandHandlerCollector(commandObservability(undefined));
    })
      .when((collector) =>
        collector.startScope({ streamName: 'orders-1' }, (scope) => {
          scope.log(LogEvent.info('using global observability'));
          return Promise.resolve();
        }),
      )
      .then(({ spans, metrics }) => {
        spans
          .haveSpanNamed('command.handle')
          .logged('info', 'using global observability');
        metrics
          .haveHistogramNamed(EmmettMetrics.command.handlingDuration)
          .hasValueAtLeast(0);
      });
  });

  it('returns noop tracer, meter, attributeTarget=both when no options', () => {
    const resolved = commandObservability(undefined);
    expect(resolved.tracer).toBeDefined();
    expect(resolved.meter).toBeDefined();
    expect(resolved.attributeTarget).toBe('both');
  });

  it('uses provided tracer and meter', () => {
    const tracer = collectingTracer();
    const meter = collectingMeter();
    const resolved = commandObservability({
      observability: { tracer, meter },
    });
    expect(resolved.tracer).toBe(tracer);
    expect(resolved.meter).toBe(meter);
  });

  it('uses provided attributeTarget', () => {
    const resolved = commandObservability({
      observability: { attributeTarget: 'mainSpan' },
    });
    expect(resolved.attributeTarget).toBe('mainSpan');
  });

  it('falls back to parent options', () => {
    const tracer = collectingTracer();
    const resolved = commandObservability(undefined, {
      tracer,
    });
    expect(resolved.tracer).toBe(tracer);
  });

  it('child overrides parent', () => {
    const parentTracer = collectingTracer();
    const childTracer = collectingTracer();
    const resolved = commandObservability(
      { observability: { tracer: childTracer } },
      { tracer: parentTracer },
    );
    expect(resolved.tracer).toBe(childTracer);
  });

  it('defaults includeMessagePayloads to false', () => {
    const resolved = commandObservability(undefined);
    expect(resolved.includeMessagePayloads).toBe(false);
  });

  it('uses provided includeMessagePayloads', () => {
    const resolved = commandObservability({
      observability: { includeMessagePayloads: true },
    });
    expect(resolved.includeMessagePayloads).toBe(true);
  });

  it('falls back to parent includeMessagePayloads', () => {
    const resolved = commandObservability(undefined, {
      includeMessagePayloads: true,
    });
    expect(resolved.includeMessagePayloads).toBe(true);
  });
});
