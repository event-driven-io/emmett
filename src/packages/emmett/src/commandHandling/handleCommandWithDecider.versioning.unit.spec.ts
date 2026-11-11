import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { getInMemoryEventStore } from '../eventStore';
import type { Command, Event } from '../typing';
import { DeciderCommandHandler } from './handleCommandWithDecider';

type AddProductItem = Command<
  'AddProductItem',
  { productId: string; quantity: number }
>;

// #region decider-upcasting
// The shape older events were stored with: productId and quantity as flat
// fields, addedAt as the ISO-8601 string JSON persists a Date as.
type ProductItemAddedV1 = Event<
  'ProductItemAdded',
  { productId: string; quantity: number; addedAt: string }
>;

// The current shape: the product item is grouped under its own object and
// addedAt is a Date. The event type name stays the same across versions.
type ProductItemAdded = Event<
  'ProductItemAdded',
  { productItem: { productId: string; quantity: number }; addedAt: Date },
  undefined,
  2
>;

// The events the domain works with, and the shapes the stream can hold: a
// stream written across the change carries both versions.
type ShoppingCartEvent = ProductItemAdded;
type StoredShoppingCartEvent = ProductItemAddedV1 | ProductItemAdded;

const upcast = (storedEvent: StoredShoppingCartEvent): ShoppingCartEvent => {
  switch (storedEvent.schemaVersion) {
    case 2:
      return storedEvent;
    default:
      return {
        type: 'ProductItemAdded',
        data: {
          productItem: {
            productId: storedEvent.data.productId,
            quantity: storedEvent.data.quantity,
          },
          addedAt: new Date(storedEvent.data.addedAt),
        },
        schemaVersion: 2,
      };
  }
};
// #endregion decider-upcasting

type ProductItem = { productId: string; quantity: number; addedAt: Date };

type ShoppingCart = { productItems: ProductItem[] };

const initialState = (): ShoppingCart => ({ productItems: [] });

const evolve = (
  state: ShoppingCart,
  event: ShoppingCartEvent,
): ShoppingCart => ({
  productItems: [
    ...state.productItems,
    { ...event.data.productItem, addedAt: event.data.addedAt },
  ],
});

// #region decider-versioned-event
const decide = (
  command: AddProductItem,
  _state: ShoppingCart,
): ShoppingCartEvent => ({
  type: 'ProductItemAdded',
  data: {
    productItem: command.data,
    addedAt: new Date('2024-03-01T09:00:00.000Z'),
  },
  schemaVersion: 2,
});
// #endregion decider-versioned-event

// #region decider-upcasting-register
const handle = DeciderCommandHandler<
  ShoppingCart,
  AddProductItem,
  ShoppingCartEvent,
  StoredShoppingCartEvent
>({
  decide,
  evolve,
  initialState,
  schema: { versioning: { upcast } },
});
// #endregion decider-upcasting-register

const downcast = (
  decidedEvent: ShoppingCartEvent,
): StoredShoppingCartEvent => ({
  type: 'ProductItemAdded',
  data: {
    productId: decidedEvent.data.productItem.productId,
    quantity: decidedEvent.data.productItem.quantity,
    addedAt: decidedEvent.data.addedAt.toISOString(),
  },
});

const handleWithDowncast = DeciderCommandHandler<
  ShoppingCart,
  AddProductItem,
  ShoppingCartEvent,
  StoredShoppingCartEvent
>({
  decide,
  evolve,
  initialState,
  schema: { versioning: { downcast } },
});

void describe('DeciderCommandHandler schema versioning', () => {
  const eventStore = getInMemoryEventStore();

  void it('upcasts a stream mixing old and current shapes', async () => {
    const shoppingCartId = randomUUID();

    await eventStore.appendToStream<StoredShoppingCartEvent>(shoppingCartId, [
      {
        type: 'ProductItemAdded',
        data: {
          productId: 'shoes',
          quantity: 10,
          addedAt: '2024-01-15T10:30:00.000Z',
        },
      },
      {
        type: 'ProductItemAdded',
        data: {
          productItem: { productId: 'hat', quantity: 2 },
          addedAt: new Date('2024-02-20T14:00:00.000Z'),
        },
        schemaVersion: 2,
      },
    ]);

    const { newState } = await handle(eventStore, shoppingCartId, {
      type: 'AddProductItem',
      data: { productId: 'socks', quantity: 3 },
    });

    expect(newState).toEqual({
      productItems: [
        {
          productId: 'shoes',
          quantity: 10,
          addedAt: new Date('2024-01-15T10:30:00.000Z'),
        },
        {
          productId: 'hat',
          quantity: 2,
          addedAt: new Date('2024-02-20T14:00:00.000Z'),
        },
        {
          productId: 'socks',
          quantity: 3,
          addedAt: new Date('2024-03-01T09:00:00.000Z'),
        },
      ],
    });
    expect(newState.productItems[0]!.addedAt).toBeInstanceOf(Date);
  });

  void it('downcasts decided events to the stored shape on append', async () => {
    const shoppingCartId = randomUUID();

    await handleWithDowncast(eventStore, shoppingCartId, {
      type: 'AddProductItem',
      data: { productId: 'socks', quantity: 3 },
    });

    const stored =
      await eventStore.readStream<ProductItemAddedV1>(shoppingCartId);

    expect(stored.events).toEqual([
      {
        type: 'ProductItemAdded',
        kind: 'Event',
        schemaVersion: 1,
        data: {
          productId: 'socks',
          quantity: 3,
          addedAt: '2024-03-01T09:00:00.000Z',
        },
        metadata: {
          messageId: expect.any(String) as unknown,
          streamName: shoppingCartId,
          streamPosition: 1n,
          globalPosition: expect.any(String) as unknown,
          checkpoint: expect.any(String) as unknown,
          causationId: expect.any(String) as unknown,
          correlationId: expect.any(String) as unknown,
          spanId: expect.any(String) as unknown,
          traceId: expect.any(String) as unknown,
        },
      },
    ]);
  });
});
