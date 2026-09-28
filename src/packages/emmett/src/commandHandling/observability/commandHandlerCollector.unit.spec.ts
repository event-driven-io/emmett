import {
  collectingMeter,
  collectingTracer,
  LogEvent,
  MessagingAttributes,
  ObservabilityScope,
  ObservabilitySpec,
  testObservabilityContextGenerator,
} from '@event-driven-io/almanac';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ConcurrencyError,
  IllegalStateError,
  NotFoundError,
  ValidationError,
} from '../../errors';
import { setupEmmettObservability } from '../../observability';
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

afterEach(() => setupEmmettObservability(undefined));

describe('commandHandlerCollector', () => {
  it('creates a span named command.handle with emmett.scope.type=command and emmett.scope.main=true', async () => {
    await given((config) => commandHandlerCollector(config))
      .when((collector) =>
        collector.startScope({ streamName: 'test-stream' }, () =>
          Promise.resolve(),
        ),
      )
      .then(({ spans }) =>
        spans.hasSingleSpanNamed('command.handle').hasAttributes({
          [A.scope.type]: 'command',
          [A.scope.main]: true,
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
          .hasSingleSpanNamed('command.handle')
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
        spans.hasSingleSpanNamed('command.handle').hasAttributes({
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
        spans
          .hasSingleSpanNamed('command.handle')
          .hasAttributes({ [A.command.status]: 'success', error: undefined })
          .noLogs(),
      );
  });

  it('recordEvents sets emitted event count, unique event types, messaging batch size, and command status', async () => {
    const events = [
      { type: 'OrderPlaced', data: {}, kind: 'Event' as const },
      { type: 'ItemAdded', data: {}, kind: 'Event' as const },
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
        spans.hasSingleSpanNamed('command.handle').hasAttributes({
          [A.command.eventCount]: 3,
          [A.command.eventTypes]: ['OrderPlaced', 'ItemAdded'],
          [M.batch.messageCount]: 3,
          [A.command.status]: 'success',
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
        spans.hasSingleSpanNamed('command.handle').hasAttributes({
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

  it('a failed command span has no exception attributes and keeps emmett.command.status failure', async () => {
    const failure = new Error('boom');

    await given((config) => commandHandlerCollector(config))
      .when((collector) =>
        collector.startScope({ streamName: 'test' }, () =>
          Promise.reject(failure),
        ),
      )
      .thenThrows(({ spans }) =>
        spans
          .hasSingleSpanNamed('command.handle')
          .hasError(failure)
          .hasAttributes({
            [A.command.status]: 'failure',
            error: undefined,
            'exception.message': undefined,
            'exception.type': undefined,
          }),
      );
  });

  it('a command failing with ConcurrencyError at the outermost level logs at debug', async () => {
    const failure = new ConcurrencyError('1', '2');

    await given((config) => commandHandlerCollector(config))
      .when((collector) =>
        collector.startScope(
          { streamName: 'order-1', commandType: 'PlaceOrder' },
          () => Promise.reject(failure),
        ),
      )
      .thenThrows(({ spans }) =>
        spans
          .hasSingleSpanNamed('command.handle')
          .logged('debug', 'Command handling failed', {
            [A.command.type]: 'PlaceOrder',
            [A.stream.name]: 'order-1',
          })
          .loggedCount(1),
      );
  });

  it.each([
    ['ValidationError', new ValidationError('invalid')],
    ['IllegalStateError', new IllegalStateError('illegal')],
    ['NotFoundError', new NotFoundError({ id: '1', type: 'Order' })],
  ])(
    'a command failing with %s at the outermost level logs at debug',
    async (_, failure) => {
      await given((config) => commandHandlerCollector(config))
        .when((collector) =>
          collector.startScope({ streamName: 'order-1' }, () =>
            Promise.reject(failure),
          ),
        )
        .thenThrows(({ spans }) =>
          spans
            .hasSingleSpanNamed('command.handle')
            .logged('debug', 'Command handling failed', {
              [A.stream.name]: 'order-1',
            })
            .loggedCount(1),
        );
    },
  );

  it('a command failing with an unexpected error at the outermost level logs at error', async () => {
    const failure = new Error('boom');

    await given((config) => commandHandlerCollector(config))
      .when(async (collector, config) => {
        await collector
          .startScope(
            { streamName: 'order-1', commandType: 'PlaceOrder' },
            () => Promise.reject(failure),
          )
          .catch(() => {});
        return config.tracer.spans.flatMap((s) => s.logs);
      })
      .then(({ result: logs, spans }) => {
        spans
          .hasSingleSpanNamed('command.handle')
          .logged('error', 'Command handling failed', {
            [A.command.type]: 'PlaceOrder',
            [A.stream.name]: 'order-1',
          })
          .loggedCount(1);
        expect(logs[0]!.name).toBe('emmett.command.handle.exception');
        expect(logs[0]!.data.error).toBe(failure);
      });
  });

  it('a command handled inside another Emmett operation logs nothing on failure', async () => {
    const failure = new Error('boom');

    await given((config) => commandHandlerCollector(config))
      .when((collector, config) =>
        ObservabilityScope(config).startScope('outer', (outer) =>
          collector.startScope(
            { streamName: 'order-1' },
            () => Promise.reject(failure),
            { scope: outer },
          ),
        ),
      )
      .thenThrows(({ spans }) => {
        spans
          .hasSingleSpanNamed('command.handle')
          .hasParentSpanNamed('outer')
          .hasError(failure)
          .noLogs();
        spans.hasSingleSpanNamed('outer').noLogs();
      });
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

  it('works with noop observability', async () => {
    const o11y = commandObservability(undefined);
    const collector = commandHandlerCollector(o11y);
    await collector.startScope({ streamName: 'test' }, () => Promise.resolve());
  });

  it('sets messaging.message.correlation_id from the seeded context', async () => {
    await given((config) => commandHandlerCollector(config))
      .when((collector) =>
        collector.startScope({ streamName: 'test' }, () => Promise.resolve(), {
          context: { correlationId: 'corr-123' },
        }),
      )
      .then(({ spans }) =>
        spans
          .hasSingleSpanNamed('command.handle')
          .hasAttribute(M.message.correlationId, 'corr-123'),
      );
  });

  it('generates messaging.message.correlation_id when none is seeded', async () => {
    await given((config) => commandHandlerCollector(config), {
      contextGenerator: testObservabilityContextGenerator({
        traceIds: 'trace-1',
        spanIds: 'span-1',
        correlationIds: 'gen-corr',
      }),
    })
      .when((collector) =>
        collector.startScope({ streamName: 'test' }, () => Promise.resolve()),
      )
      .then(({ spans }) =>
        spans
          .hasSingleSpanNamed('command.handle')
          .hasAttribute(M.message.correlationId, 'gen-corr'),
      );
  });

  it('sets messaging.message.causation_id from the seeded context', async () => {
    await given((config) => commandHandlerCollector(config))
      .when((collector) =>
        collector.startScope({ streamName: 'test' }, () => Promise.resolve(), {
          context: { causationId: 'caus-456' },
        }),
      )
      .then(({ spans }) =>
        spans
          .hasSingleSpanNamed('command.handle')
          .hasAttribute(M.message.causationId, 'caus-456'),
      );
  });

  it('roots messaging.message.causation_id on the correlationId when causationId is absent', async () => {
    await given((config) => commandHandlerCollector(config), {
      contextGenerator: testObservabilityContextGenerator({
        traceIds: 'trace-1',
        spanIds: 'span-1',
        correlationIds: 'gen-corr',
      }),
    })
      .when((collector) =>
        collector.startScope({ streamName: 'test' }, () => Promise.resolve()),
      )
      .then(({ spans }) =>
        spans
          .hasSingleSpanNamed('command.handle')
          .hasAttribute(M.message.causationId, 'gen-corr'),
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
          .hasSingleSpanNamed('command.handle')
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
          .hasSingleSpanNamed('command.handle')
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
          .hasSingleSpanNamed('command.handle')
          .hasAttribute(A.command.type, undefined),
      );
  });

  it('uses inherited trace context when parent is provided', async () => {
    await given((config) => commandHandlerCollector(config))
      .when((collector) =>
        collector.startScope(
          {
            streamName: 'test',
          },
          () => Promise.resolve(),
          {
            parent: {
              traceId: 'parent-trace',
              spanId: 'parent-span',
            },
          },
        ),
      )
      .then(({ spans }) =>
        spans
          .hasSingleSpanNamed('command.handle')
          .hasParent({ traceId: 'parent-trace', spanId: 'parent-span' }),
      );
  });

  it('does not set parent when parent is absent', async () => {
    await given((config) => commandHandlerCollector(config))
      .when((collector) =>
        collector.startScope({ streamName: 'test' }, () => Promise.resolve()),
      )
      .then(({ spans }) =>
        spans.hasSingleSpanNamed('command.handle').hasNoParent(),
      );
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
      setupEmmettObservability(observability);
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
          .hasSingleSpanNamed('command.handle')
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

  it('uses provided contextGenerator', () => {
    const contextGenerator = testObservabilityContextGenerator({
      traceIds: 'trace',
      spanIds: 'span',
    });
    const resolved = commandObservability({
      observability: { contextGenerator },
    });

    expect(resolved.contextGenerator).toBe(contextGenerator);
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
