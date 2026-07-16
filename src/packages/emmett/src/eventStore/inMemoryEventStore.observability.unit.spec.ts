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
});
