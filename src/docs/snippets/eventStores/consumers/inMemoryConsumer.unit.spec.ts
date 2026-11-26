import {
  assertDeepEqual,
  getInMemoryEventStore,
  inMemorySingleStreamProjection,
  type Event,
} from '@event-driven-io/emmett';
import { v4 as uuid } from 'uuid';
import { describe, it } from 'vitest';

type ProductItemAdded = Event<'ProductItemAdded', { quantity: number }>;
type ShoppingCartConfirmed = Event<'ShoppingCartConfirmed', { at: Date }>;
type ShoppingCartEvent = ProductItemAdded | ShoppingCartConfirmed;

type ShoppingCartSummary = {
  _id?: string;
  _version?: bigint;
  status: string;
  productItemsCount: number;
};

const shoppingCartsSummaryCollectionName = 'shoppingCartsSummary';

const shoppingCartsSummaryProjection = inMemorySingleStreamProjection({
  collectionName: shoppingCartsSummaryCollectionName,
  canHandle: ['ProductItemAdded', 'ShoppingCartConfirmed'],
  initialState: () => ({ status: 'pending', productItemsCount: 0 }),
  evolve: (
    document: ShoppingCartSummary,
    event: ShoppingCartEvent,
  ): ShoppingCartSummary => {
    switch (event.type) {
      case 'ProductItemAdded':
        return {
          ...document,
          productItemsCount: document.productItemsCount + event.data.quantity,
        };
      case 'ShoppingCartConfirmed':
        return { ...document, status: 'confirmed' };
    }
  },
});

void describe('In-memory consumer', () => {
  void it('projects appended events', async () => {
    const eventStore = getInMemoryEventStore();
    const streamName = `shopping_cart-${uuid()}`;

    await eventStore.appendToStream<ShoppingCartEvent>(streamName, [
      { type: 'ProductItemAdded', data: { quantity: 2 } },
      { type: 'ShoppingCartConfirmed', data: { at: new Date() } },
    ]);

    // #region in-memory-consumer
    const consumer = eventStore.consumer<ShoppingCartEvent>();

    consumer.projector({
      processorId: 'shopping-carts-summary',
      projection: shoppingCartsSummaryProjection,
    });

    const running = consumer.start();
    await consumer.whenCaughtUp();
    // #endregion in-memory-consumer

    const summary = await eventStore.database
      .collection<ShoppingCartSummary>(shoppingCartsSummaryCollectionName)
      .findOne((document) => document._id === streamName);

    assertDeepEqual(summary, {
      _id: streamName,
      _version: 2n,
      status: 'confirmed',
      productItemsCount: 2,
    });

    // #region in-memory-consumer-close
    await consumer.close();

    // the store stays usable, keep appending to it
    await eventStore.appendToStream<ShoppingCartEvent>(streamName, [
      { type: 'ProductItemAdded', data: { quantity: 1 } },
    ]);
    // #endregion in-memory-consumer-close

    await running;
  });
});
