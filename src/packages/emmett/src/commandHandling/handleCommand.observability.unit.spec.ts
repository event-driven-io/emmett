import { collectingMeter, collectingTracer } from '@event-driven-io/almanac';
import { describe, expect, it } from 'vitest';
import { v4 as uuid } from 'uuid';
import type { Event } from '../typing';
import { getInMemoryEventStore } from '../eventStore';
import { CommandHandler } from './handleCommand';

type ItemAdded = Event<'ItemAdded', { productId: string }>;
type Cart = { count: number };

describe('handleCommand observability', () => {
  it('events appended by command handler carry traceId and spanId from the command.handle span', async () => {
    const tracer = collectingTracer();
    const meter = collectingMeter();
    const eventStore = getInMemoryEventStore();
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
});
