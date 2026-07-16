import {
  MessagingAttributes,
  ObservabilitySpec,
  testTraceContextGenerator,
} from '@event-driven-io/almanac';
import { v4 as uuid } from 'uuid';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ExpectedVersionConflictError,
  getInMemoryEventStore,
} from '../eventStore';
import { setupEmmettObservability } from '../observability';
import {
  EmmettAttributes,
  EmmettMetrics,
  MessagingSystemName,
} from '../observability/attributes';
import { assertEqual, assertUndefined } from '../testing';
import type { Event } from '../typing';
import { CommandHandler } from './handleCommand';

type ItemAdded = Event<'ItemAdded', { productId: string }>;
type Cart = { count: number };

describe('handler observability', () => {
  const given = ObservabilitySpec.for();

  afterEach(() => setupEmmettObservability(undefined));

  it('uses default observability without handler configuration', () => {
    const eventStore = getInMemoryEventStore();
    const appendToStreamSpy = vi.spyOn(eventStore, 'appendToStream');
    const streamId = uuid();
    const expectedCorrelationId = 'flow-1';

    return given(
      (observability) => {
        setupEmmettObservability(observability);
        return CommandHandler<Cart, ItemAdded>({
          evolve: (state) => state,
          initialState: () => ({ count: 0 }),
        });
      },
      {
        traceContextGenerator: testTraceContextGenerator({
          traceIds: 'generated-trace-1',
          spanIds: 'generated-span-1',
        }),
      },
    )
      .when((handler) =>
        handler(
          eventStore,
          streamId,
          () => [{ type: 'ItemAdded', data: { productId: 'p1' } }],
          {
            observability: {
              correlationId: expectedCorrelationId,
            },
          },
        ),
      )
      .then(({ spans }) => {
        const appendToStreamOptions = appendToStreamSpy.mock.calls[0]![2]!;
        const { correlationId } = appendToStreamOptions;

        assertEqual(expectedCorrelationId, correlationId);

        spans.hasSingleSpanNamed('command.handle').hasAttributes({
          [EmmettAttributes.scope.type]: 'command',
          'emmett.scope.main': true,
          [EmmettAttributes.stream.name]: streamId,
          [EmmettAttributes.command.status]: 'success',
          [EmmettAttributes.command.eventTypes]: ['ItemAdded'],
          [EmmettAttributes.command.eventCount]: 1,
          [EmmettAttributes.stream.versionBefore]: 0,
          [EmmettAttributes.stream.versionAfter]: 1,
          [MessagingAttributes.message.correlationId]: expectedCorrelationId,
          [MessagingAttributes.batch.messageCount]: 1,
          [MessagingAttributes.destination.name]: streamId,
          [MessagingAttributes.system]: MessagingSystemName,
        });
      });
  });

  void describe('observability propagation', () => {
    void it('stamps correlationId, causationId, traceId and spanId from handle options onto produced events', () => {
      const eventStore = getInMemoryEventStore();
      const appendToStreamSpy = vi.spyOn(eventStore, 'appendToStream');
      const streamId = uuid();
      const expectedCorrelationId = 'flow-1';
      const expectedCausationId = 'cmd-1';
      const expectedSpanId = 'exp-span-1';
      const expectedTraceId = 'exp-trace-1';
      const generatedSpanId = 'generated-span-2';
      const generatedTraceId = 'generated-trace-2';

      const event: ItemAdded = {
        type: 'ItemAdded',
        data: { productId: 'p1' },
      };

      return given(
        (observability) =>
          CommandHandler<Cart, ItemAdded>({
            evolve: (state) => state,
            initialState: () => ({ count: 0 }),
            observability,
          }),
        {
          traceContextGenerator: testTraceContextGenerator({
            traceIds: generatedTraceId,
            spanIds: generatedSpanId,
          }),
        },
      )
        .when(async (handler) =>
          handler(eventStore, streamId, () => [event], {
            observability: {
              correlationId: expectedCorrelationId,
              causationId: expectedCausationId,
              spanId: expectedSpanId,
              traceId: expectedTraceId,
            },
          }),
        )
        .then(({ spans }) => {
          const appendToStreamOptions = appendToStreamSpy.mock.calls[0]![2]!;
          const { correlationId, causationId, spanId, traceId } =
            appendToStreamOptions;

          assertEqual(expectedCausationId, causationId);
          assertEqual(expectedCorrelationId, correlationId);
          assertEqual(generatedSpanId, spanId);
          assertEqual(generatedTraceId, traceId);

          spans
            .hasSingleSpanNamed('command.handle')
            .hasParent({ traceId: expectedTraceId, spanId: expectedSpanId })
            .hasAttributes({
              [MessagingAttributes.message.correlationId]:
                expectedCorrelationId,
              [MessagingAttributes.message.causationId]: expectedCausationId,
            });
        });
    });

    void it('stamps provided correlationId and causationId, and auto-generates spanId and traceId when not provided', async () => {
      const eventStore = getInMemoryEventStore();
      const appendToStreamSpy = vi.spyOn(eventStore, 'appendToStream');
      const streamId = uuid();
      const expectedCausationId = 'cmd-1';
      const expectedCorrelationId = 'flow-2';
      const generatedSpanId = 'generated-span-3';
      const generatedTraceId = 'generated-trace-3';

      const event: ItemAdded = {
        type: 'ItemAdded',
        data: { productId: 'p1' },
      };

      return given(
        (observability) =>
          CommandHandler<Cart, ItemAdded>({
            evolve: (state) => state,
            initialState: () => ({ count: 0 }),
            observability,
          }),
        {
          traceContextGenerator: testTraceContextGenerator({
            traceIds: generatedTraceId,
            spanIds: generatedSpanId,
          }),
        },
      )
        .when(async (handler) =>
          handler(eventStore, streamId, () => [event], {
            observability: {
              correlationId: expectedCorrelationId,
              causationId: expectedCausationId,
            },
          }),
        )
        .then(({ spans }) => {
          const appendToStreamOptions = appendToStreamSpy.mock.calls[0]![2]!;
          const { correlationId, causationId, spanId, traceId } =
            appendToStreamOptions;

          assertEqual(expectedCausationId, causationId);
          assertEqual(expectedCorrelationId, correlationId);
          assertEqual(generatedSpanId, spanId);
          assertEqual(generatedTraceId, traceId);

          spans
            .hasSingleSpanNamed('command.handle')
            .hasNoParent()
            .hasAttributes({
              [MessagingAttributes.message.correlationId]:
                expectedCorrelationId,
              [MessagingAttributes.message.causationId]: expectedCausationId,
            });
        });
    });

    void it('does not generate causationId when not provided', async () => {
      const eventStore = getInMemoryEventStore();
      const appendToStreamSpy = vi.spyOn(eventStore, 'appendToStream');
      const streamId = uuid();
      const expectedCorrelationId = 'flow-3';
      const generatedSpanId = 'generated-span-4';
      const generatedTraceId = 'generated-trace-4';

      const event: ItemAdded = {
        type: 'ItemAdded',
        data: { productId: 'p1' },
      };

      return given(
        (observability) =>
          CommandHandler<Cart, ItemAdded>({
            evolve: (state) => state,
            initialState: () => ({ count: 0 }),
            observability,
          }),
        {
          traceContextGenerator: testTraceContextGenerator({
            traceIds: generatedTraceId,
            spanIds: generatedSpanId,
          }),
        },
      )
        .when(async (handler) =>
          handler(eventStore, streamId, () => [event], {
            observability: {
              correlationId: expectedCorrelationId,
            },
          }),
        )
        .then(({ spans }) => {
          const appendToStreamOptions = appendToStreamSpy.mock.calls[0]![2]!;
          const { correlationId, causationId, spanId, traceId } =
            appendToStreamOptions;
          assertUndefined(causationId);
          assertEqual(expectedCorrelationId, correlationId);
          assertEqual(generatedSpanId, spanId);
          assertEqual(generatedTraceId, traceId);

          spans
            .hasSingleSpanNamed('command.handle')
            .hasNoParent()
            .hasAttributes({
              [MessagingAttributes.message.correlationId]:
                expectedCorrelationId,
              [MessagingAttributes.message.causationId]: undefined,
            });
        });
    });
  });

  void describe('command type', () => {
    void it('forwards commandType option to span attribute', () => {
      return given((observability) =>
        CommandHandler<Cart, ItemAdded>({
          evolve: (state) => state,
          initialState: () => ({ count: 0 }),
          commandType: 'AddItem',
          observability,
        }),
      )
        .when(async (handler) =>
          handler(getInMemoryEventStore(), uuid(), () => [
            { type: 'ItemAdded', data: { productId: 'p1' } },
          ]),
        )
        .then(({ spans }) => {
          spans
            .hasSingleSpanNamed('command.handle')
            .hasAttribute(EmmettAttributes.command.type, 'AddItem');
        });
    });

    void it('uses options.name as commandType when commandType is not set', () => {
      return given((observability) =>
        CommandHandler<Cart, ItemAdded>({
          evolve: (state) => state,
          initialState: () => ({ count: 0 }),
          name: 'PlaceOrder',
          observability,
        }),
      )
        .when(async (handler) =>
          handler(getInMemoryEventStore(), uuid(), () => [
            { type: 'ItemAdded', data: { productId: 'p1' } },
          ]),
        )
        .then(({ spans }) => {
          spans
            .hasSingleSpanNamed('command.handle')
            .hasAttribute(EmmettAttributes.command.type, 'PlaceOrder');
        });
    });

    void it('falls back to handler function name when neither commandType nor name is set', () => {
      function addItem(_state: Cart): ItemAdded {
        return { type: 'ItemAdded', data: { productId: 'p1' } };
      }

      return given((observability) =>
        CommandHandler<Cart, ItemAdded>({
          evolve: (state) => state,
          initialState: () => ({ count: 0 }),
          observability,
        }),
      )
        .when(async (handler) =>
          handler(getInMemoryEventStore(), uuid(), addItem),
        )
        .then(({ spans }) => {
          spans
            .hasSingleSpanNamed('command.handle')
            .hasAttribute(EmmettAttributes.command.type, 'addItem');
        });
    });

    void it('records handler names as an array for an array of named functions', () => {
      function addItem(_state: Cart): ItemAdded {
        return { type: 'ItemAdded', data: { productId: 'p1' } };
      }
      function addAnotherItem(_state: Cart): ItemAdded {
        return { type: 'ItemAdded', data: { productId: 'p2' } };
      }

      return given((observability) =>
        CommandHandler<Cart, ItemAdded>({
          evolve: (state) => state,
          initialState: () => ({ count: 0 }),
          observability,
        }),
      )
        .when(async (handler) =>
          handler(getInMemoryEventStore(), uuid(), [addItem, addAnotherItem]),
        )
        .then(({ spans }) => {
          spans
            .hasSingleSpanNamed('command.handle')
            .hasAttribute(EmmettAttributes.command.type, [
              'addItem',
              'addAnotherItem',
            ]);
        });
    });

    void it('leaves command type undefined for an anonymous handler with no name or commandType', () => {
      return given((observability) =>
        CommandHandler<Cart, ItemAdded>({
          evolve: (state) => state,
          initialState: () => ({ count: 0 }),
          observability,
        }),
      )
        .when(async (handler) =>
          handler(getInMemoryEventStore(), uuid(), (): [] => []),
        )
        .then(({ spans }) => {
          spans
            .hasSingleSpanNamed('command.handle')
            .hasAttribute(EmmettAttributes.command.type, undefined);
        });
    });
  });

  void describe('span attributes', () => {
    void it('records stream name, success status, event types, event count and stream versions', () => {
      const streamId = uuid();

      return given((observability) =>
        CommandHandler<Cart, ItemAdded>({
          evolve: (state) => state,
          initialState: () => ({ count: 0 }),
          observability,
        }),
      )
        .when(async (handler) =>
          handler(getInMemoryEventStore(), streamId, () => [
            { type: 'ItemAdded', data: { productId: 'p1' } },
          ]),
        )
        .then(({ spans }) => {
          spans.hasSingleSpanNamed('command.handle').hasAttributes({
            [EmmettAttributes.stream.name]: streamId,
            [EmmettAttributes.command.status]: 'success',
            [EmmettAttributes.command.eventTypes]: ['ItemAdded'],
            [EmmettAttributes.command.eventCount]: 1,
            [EmmettAttributes.stream.versionBefore]: 0,
            [EmmettAttributes.stream.versionAfter]: 1,
          });
        });
    });
  });

  void describe('metrics', () => {
    void it('records handling duration histogram with success status', () => {
      return given((observability) =>
        CommandHandler<Cart, ItemAdded>({
          evolve: (state) => state,
          initialState: () => ({ count: 0 }),
          observability,
        }),
      )
        .when(async (handler) =>
          handler(getInMemoryEventStore(), uuid(), () => [
            { type: 'ItemAdded', data: { productId: 'p1' } },
          ]),
        )
        .then(({ metrics }) => {
          metrics
            .haveHistogramNamed(EmmettMetrics.command.handlingDuration)
            .hasValueAtLeast(0)
            .hasAttribute(EmmettAttributes.command.status, 'success');
        });
    });

    void it('tags duration histogram with commandType when it is a scalar string', () => {
      return given((observability) =>
        CommandHandler<Cart, ItemAdded>({
          evolve: (state) => state,
          initialState: () => ({ count: 0 }),
          commandType: 'AddItem',
          observability,
        }),
      )
        .when(async (handler) =>
          handler(getInMemoryEventStore(), uuid(), () => [
            { type: 'ItemAdded', data: { productId: 'p1' } },
          ]),
        )
        .then(({ metrics }) => {
          metrics
            .haveHistogramNamed(EmmettMetrics.command.handlingDuration)
            .hasAttribute(EmmettAttributes.command.type, 'AddItem');
        });
    });

    void it('increments event appending counter once per appended event', () => {
      return given((observability) =>
        CommandHandler<Cart, ItemAdded>({
          evolve: (state) => state,
          initialState: () => ({ count: 0 }),
          observability,
        }),
      )
        .when(async (handler) =>
          handler(getInMemoryEventStore(), uuid(), () => [
            { type: 'ItemAdded', data: { productId: 'p1' } },
            { type: 'ItemAdded', data: { productId: 'p2' } },
          ]),
        )
        .then(({ metrics }) => {
          metrics
            .haveCounterNamed(EmmettMetrics.event.appendingCount)
            .hasValue(2)
            .recordedTimes(2)
            .hasAttribute(EmmettAttributes.event.type, 'ItemAdded');
        });
    });

    void it('records duration histogram with failure status when handler throws', () => {
      const eventStore = getInMemoryEventStore();

      return given((observability) =>
        CommandHandler<Cart, ItemAdded>({
          evolve: (state) => state,
          initialState: () => ({ count: 0 }),
          observability,
        }),
      )
        .when(async (handler) => {
          try {
            await handler(eventStore, uuid(), () => {
              throw new Error('business rule violated');
            });
          } catch {
            // expected
          }
        })
        .then(({ metrics }) => {
          metrics
            .haveHistogramNamed(EmmettMetrics.command.handlingDuration)
            .hasAttribute(EmmettAttributes.command.status, 'failure');
        });
    });
  });

  void describe('error handling', () => {
    void it('records failure span attributes when handler throws', () => {
      return given((observability) =>
        CommandHandler<Cart, ItemAdded>({
          evolve: (state) => state,
          initialState: () => ({ count: 0 }),
          observability,
        }),
      )
        .when(async (handler) =>
          handler(getInMemoryEventStore(), uuid(), () => {
            throw new Error('business rule violated');
          }),
        )
        .thenThrows(({ spans, error }) => {
          spans.hasSingleSpanNamed('command.handle').hasAttributes({
            [EmmettAttributes.command.status]: 'failure',
            error: true,
            'exception.message': 'business rule violated',
            'exception.type': 'Error',
          });
          expect((error as Error).message).toBe('business rule violated');
        });
    });

    void it('records failure span attributes when infrastructure throws a concurrency error', () => {
      const eventStore = getInMemoryEventStore();
      const streamId = uuid();

      return given((observability) =>
        CommandHandler<Cart, ItemAdded>({
          evolve: (state) => state,
          initialState: () => ({ count: 0 }),
          observability,
        }),
      )
        .when(async (handler) => {
          const seedEvent: ItemAdded = {
            type: 'ItemAdded',
            data: { productId: 'seed' },
          };
          await eventStore.appendToStream(streamId, [seedEvent]);
          await handler(
            eventStore,
            streamId,
            () => [{ type: 'ItemAdded', data: { productId: 'p1' } }],
            { expectedStreamVersion: 0n },
          );
        })
        .thenThrows(({ spans, error }) => {
          spans.hasSingleSpanNamed('command.handle').hasAttributes({
            [EmmettAttributes.command.status]: 'failure',
            error: true,
            'exception.type': 'ExpectedVersionConflictError',
          });
          expect(error).toBeInstanceOf(ExpectedVersionConflictError);
        });
    });

    void it('records failure histogram when handler throws', () => {
      return given((observability) =>
        CommandHandler<Cart, ItemAdded>({
          evolve: (state) => state,
          initialState: () => ({ count: 0 }),
          observability,
        }),
      )
        .when(async (handler) =>
          handler(getInMemoryEventStore(), uuid(), () => {
            throw new Error('business rule violated');
          }),
        )
        .thenThrows(({ metrics }) => {
          metrics
            .haveHistogramNamed(EmmettMetrics.command.handlingDuration)
            .hasAttribute(EmmettAttributes.command.status, 'failure');
        });
    });

    void it('records failure histogram when infrastructure throws a concurrency error', () => {
      const eventStore = getInMemoryEventStore();
      const streamId = uuid();

      return given((observability) =>
        CommandHandler<Cart, ItemAdded>({
          evolve: (state) => state,
          initialState: () => ({ count: 0 }),
          observability,
        }),
      )
        .when(async (handler) => {
          const seedEvent: ItemAdded = {
            type: 'ItemAdded',
            data: { productId: 'seed' },
          };
          await eventStore.appendToStream(streamId, [seedEvent]);
          await handler(
            eventStore,
            streamId,
            () => [{ type: 'ItemAdded', data: { productId: 'p1' } }],
            { expectedStreamVersion: 0n },
          );
        })
        .thenThrows(({ metrics }) => {
          metrics
            .haveHistogramNamed(EmmettMetrics.command.handlingDuration)
            .hasAttribute(EmmettAttributes.command.status, 'failure');
        });
    });
  });
});
