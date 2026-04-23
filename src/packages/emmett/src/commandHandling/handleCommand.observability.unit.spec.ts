import {
  collectingMeter,
  collectingTracer,
  MessagingAttributes,
  ObservabilitySpec,
} from '@event-driven-io/almanac';
import { v4 as uuid } from 'uuid';
import { describe, expect, it, vi } from 'vitest';
import { getInMemoryEventStore } from '../eventStore';
import { WrapEventStore } from '../testing';
import type { Event } from '../typing';
import { CommandHandler } from './handleCommand';

type ItemAdded = Event<'ItemAdded', { productId: string }>;
type Cart = { count: number };

describe('handler observability', () => {
  const given = ObservabilitySpec.for();

  it('events appended by command handler carry traceId and spanId from the command.handle span', async () => {
    const tracer = collectingTracer();
    const meter = collectingMeter();
    const eventStore = WrapEventStore(getInMemoryEventStore());
    const streamId = uuid();

    const handler = CommandHandler<Cart, ItemAdded>({
      evolve: (state) => state,
      initialState: () => ({ count: 0 }),
      observability: { tracer, meter },
    });

    await handler(eventStore, streamId, () => [
      { type: 'ItemAdded', data: { productId: 'p1' } },
    ]);

    const commandHandleSpan = tracer.spans.find(
      (s) => s.name === 'command.handle',
    );
    expect(commandHandleSpan).toBeDefined();

    const { events } = await eventStore.readStream(streamId);
    expect(events).toHaveLength(1);

    const event = events[0]!;
    expect(event.metadata.traceId).toBe(commandHandleSpan!.ownContext.traceId);
    expect(event.metadata.spanId).toBe(commandHandleSpan!.ownContext.spanId);
  });

  void describe('correlationId and causationId propagation', () => {
    void it('stamps correlationId and causationId from handle options onto produced events', () => {
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
        .when(async (handler) =>
          handler(eventStore, streamId, () => [event], {
            correlationId: 'flow-1',
            causationId: 'cmd-1',
          }),
        )
        .then(({ spans }) => {
          expect(appendToStreamSpy).toHaveBeenCalledWith(
            streamId,
            [event],
            expect.objectContaining({
              correlationId: 'flow-1',
              causationId: 'cmd-1',
            }),
          );
          spans
            .haveSpanNamed('command.handle')
            .hasAttribute(MessagingAttributes.messageCorrelationId, 'flow-1')
            .hasAttributes({
              [MessagingAttributes.messageCorrelationId]: 'flow-1',
              [MessagingAttributes.messageCausationId]: 'cmd-1',
            });
        });
    });

    void it('auto-generates correlationId when not provided', async () => {
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
        .when(async (handler) =>
          handler(eventStore, streamId, () => [event], {
            causationId: 'cmd-1',
          }),
        )
        .then(({ spans }) => {
          const correlationId =
            appendToStreamSpy.mock.calls[0]![2]?.correlationId;
          expect(correlationId).toBeTypeOf('string');

          expect(appendToStreamSpy).toHaveBeenCalledWith(
            streamId,
            [event],
            expect.objectContaining({
              correlationId,
              causationId: 'cmd-1',
            }),
          );

          spans.haveSpanNamed('command.handle').hasAttributes({
            [MessagingAttributes.messageCorrelationId]: correlationId,
            [MessagingAttributes.messageCausationId]: 'cmd-1',
          });
        });
    });
  });
});
