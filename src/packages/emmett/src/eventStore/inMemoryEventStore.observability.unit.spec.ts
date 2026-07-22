import { testObservabilityContextGenerator } from '@event-driven-io/almanac';
import { describe, expect, it } from 'vitest';
import { getInMemoryEventStore } from './inMemoryEventStore';

describe('inMemoryEventStore observability context', () => {
  it('generates persisted message ids from the configured context generator', async () => {
    const eventStore = getInMemoryEventStore({
      observability: {
        contextGenerator: testObservabilityContextGenerator({
          traceIds: 'trace',
          spanIds: 'span',
          messageIds: ['message-1', 'message-2'],
        }),
      },
    });

    await eventStore.appendToStream('shopping_cart-1', [
      {
        type: 'ProductItemAdded',
        kind: 'Event',
        data: { productId: 'product-1' },
      },
      {
        type: 'ProductItemAdded',
        kind: 'Event',
        data: { productId: 'product-2' },
      },
    ]);

    const { events } = await eventStore.readStream('shopping_cart-1');

    expect(events.map((event) => event.metadata.messageId)).toEqual([
      'message-1',
      'message-2',
    ]);
  });

  it('a direct append self-instruments the observability id set onto persisted events', async () => {
    const eventStore = getInMemoryEventStore({
      observability: {
        contextGenerator: testObservabilityContextGenerator({
          traceIds: 'trace-1',
          spanIds: 'span-1',
          correlationIds: 'corr-1',
          messageIds: ['message-1', 'message-2'],
        }),
      },
    });

    await eventStore.appendToStream('shopping_cart-1', [
      {
        type: 'ProductItemAdded',
        kind: 'Event',
        data: { productId: 'product-1' },
      },
      {
        type: 'ProductItemAdded',
        kind: 'Event',
        data: { productId: 'product-2' },
      },
    ]);

    const { events } = await eventStore.readStream('shopping_cart-1');

    expect(
      events.map((event) => ({
        messageId: event.metadata.messageId,
        correlationId: event.metadata.correlationId,
        causationId: event.metadata.causationId,
        traceId: event.metadata.traceId,
        spanId: event.metadata.spanId,
      })),
    ).toEqual([
      {
        messageId: 'message-1',
        correlationId: 'corr-1',
        causationId: 'message-1',
        traceId: 'trace-1',
        spanId: 'span-1',
      },
      {
        messageId: 'message-2',
        correlationId: 'corr-1',
        causationId: 'message-2',
        traceId: 'trace-1',
        spanId: 'span-1',
      },
    ]);
  });

  it('a raw append seeds correlation from observability.context', async () => {
    const eventStore = getInMemoryEventStore({
      observability: {
        contextGenerator: testObservabilityContextGenerator({
          traceIds: 'trace-1',
          spanIds: 'span-1',
          messageIds: ['message-1'],
        }),
      },
    });

    await eventStore.appendToStream(
      'shopping_cart-1',
      [
        {
          type: 'ProductItemAdded',
          kind: 'Event',
          data: { productId: 'product-1' },
        },
      ],
      { observability: { context: { correlationId: 'seeded-correlation' } } },
    );

    const { events } = await eventStore.readStream('shopping_cart-1');

    expect(events[0]!.metadata.correlationId).toBe('seeded-correlation');
  });
});
