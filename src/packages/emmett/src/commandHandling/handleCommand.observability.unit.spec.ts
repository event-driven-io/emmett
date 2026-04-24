import {
  MessagingAttributes,
  ObservabilitySpec,
} from '@event-driven-io/almanac';
import { v4 as uuid } from 'uuid';
import { describe, expect, it, vi } from 'vitest';
import { getInMemoryEventStore } from '../eventStore';
import { assertEqual, assertNotEqual, assertUndefined } from '../testing';
import type { Event } from '../typing';
import { CommandHandler } from './handleCommand';

type ItemAdded = Event<'ItemAdded', { productId: string }>;
type Cart = { count: number };

describe('handler observability', () => {
  const given = ObservabilitySpec.for();

  void describe('observability propagation', () => {
    void it('stamps correlationId, causationId, traceId and spanId from handle options onto produced events', () => {
      const eventStore = getInMemoryEventStore();
      const appendToStreamSpy = vi.spyOn(eventStore, 'appendToStream');
      const streamId = uuid();
      const expectedCorrelationId = 'flow-1';
      const expectedCausationId = 'cmd-1';
      const expectedSpanId = 'exp-span-1';
      const expectedTraceId = 'exp-trace-1';

      const event: ItemAdded = {
        type: 'ItemAdded',
        data: { productId: 'p1' },
      };

      return given((observability) =>
        CommandHandler<Cart, ItemAdded>({
          evolve: (state) => state,
          initialState: () => ({ count: 0 }),
          observability,
        }),
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
          expect(spanId).toBeTypeOf('string');
          expect(traceId).toBeTypeOf('string');
          assertNotEqual(expectedSpanId, spanId);
          assertNotEqual(expectedTraceId, traceId);

          spans
            .haveSpanNamed('command.handle')
            .hasParent({ traceId: expectedTraceId, spanId: expectedSpanId })
            .hasAttribute(
              MessagingAttributes.message.correlationId,
              expectedCorrelationId,
            )
            .hasAttributes({
              [MessagingAttributes.message.correlationId]:
                expectedCorrelationId,
              [MessagingAttributes.message.causationId]: expectedCausationId,
            });
        });
    });

    void it('auto-generates correlationId, spanId and traceId when not provided', async () => {
      const eventStore = getInMemoryEventStore();
      const appendToStreamSpy = vi.spyOn(eventStore, 'appendToStream');
      const streamId = uuid();
      const expectedCausationId = 'cmd-1';

      const event: ItemAdded = {
        type: 'ItemAdded',
        data: { productId: 'p1' },
      };

      return given((observability) =>
        CommandHandler<Cart, ItemAdded>({
          evolve: (state) => state,
          initialState: () => ({ count: 0 }),
          observability,
        }),
      )
        .when(async (handler) =>
          handler(eventStore, streamId, () => [event], {
            observability: {
              causationId: expectedCausationId,
            },
          }),
        )
        .then(({ spans }) => {
          const appendToStreamOptions = appendToStreamSpy.mock.calls[0]![2]!;
          const { correlationId, causationId, spanId, traceId } =
            appendToStreamOptions;

          expect(causationId).toEqual(expectedCausationId);
          expect(correlationId).toBeTypeOf('string');
          expect(spanId).toBeTypeOf('string');
          expect(traceId).toBeTypeOf('string');

          spans
            .haveSpanNamed('command.handle')
            .hasNoParent()
            .hasAttributes({
              [MessagingAttributes.message.correlationId]: correlationId,
              [MessagingAttributes.message.causationId]: expectedCausationId,
            });
        });
    });

    void it('does not generate causationId when not provided', async () => {
      const eventStore = getInMemoryEventStore();
      const appendToStreamSpy = vi.spyOn(eventStore, 'appendToStream');
      const streamId = uuid();

      const event: ItemAdded = {
        type: 'ItemAdded',
        data: { productId: 'p1' },
      };

      return given((observability) =>
        CommandHandler<Cart, ItemAdded>({
          evolve: (state) => state,
          initialState: () => ({ count: 0 }),
          observability,
        }),
      )
        .when(async (handler) => handler(eventStore, streamId, () => [event]))
        .then(({ spans }) => {
          const appendToStreamOptions = appendToStreamSpy.mock.calls[0]![2]!;
          const { correlationId, causationId, spanId, traceId } =
            appendToStreamOptions;
          assertUndefined(causationId);
          expect(correlationId).toBeTypeOf('string');
          expect(spanId).toBeTypeOf('string');
          expect(traceId).toBeTypeOf('string');

          spans
            .haveSpanNamed('command.handle')
            .hasNoParent()
            .hasAttributes({
              [MessagingAttributes.message.correlationId]: correlationId,
              [MessagingAttributes.message.causationId]: undefined,
            });
        });
    });
  });
});
