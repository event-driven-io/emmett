import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { getInMemoryEventStore } from '../eventStore';
import type { Event } from '../typing';
import { CommandHandler } from './handleCommand';

type ProductItemAddedV1 = Event<
  'ProductItemAdded',
  { productId: string; quantity: number; addedAt: string }
>;

type ProductItemAdded = Event<
  'ProductItemAdded',
  { productItem: { productId: string; quantity: number }; addedAt: Date }
>;

type ShoppingCartEvent = ProductItemAdded;
type StoredShoppingCartEvent = ProductItemAddedV1 | ProductItemAdded;

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

const upcast = (event: StoredShoppingCartEvent): ShoppingCartEvent => {
  if ('productItem' in event.data)
    return { type: 'ProductItemAdded', data: event.data };

  return {
    type: 'ProductItemAdded',
    data: {
      productItem: {
        productId: event.data.productId,
        quantity: event.data.quantity,
      },
      addedAt: new Date(event.data.addedAt),
    },
  };
};

const downcast = (event: ShoppingCartEvent): StoredShoppingCartEvent => ({
  type: 'ProductItemAdded',
  data: {
    productId: event.data.productItem.productId,
    quantity: event.data.productItem.quantity,
    addedAt: event.data.addedAt.toISOString(),
  },
});

const schema = { versioning: { upcast, downcast } };

const handle = CommandHandler<
  ShoppingCart,
  ShoppingCartEvent,
  StoredShoppingCartEvent
>({
  evolve,
  initialState,
  schema,
});

const addSocks = () => ({
  type: 'ProductItemAdded' as const,
  data: {
    productItem: { productId: 'socks', quantity: 3 },
    addedAt: new Date('2024-03-01T09:00:00.000Z'),
  },
});

void describe('CommandHandler schema versioning', () => {
  void it('upcasts a stream mixing old and current shapes', async () => {
    const eventStore = getInMemoryEventStore();
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
      },
    ]);

    const { newState } = await handle(eventStore, shoppingCartId, addSocks);

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

  void it('downcasts to the stored shape on append', async () => {
    const eventStore = getInMemoryEventStore();
    const shoppingCartId = randomUUID();

    await handle(eventStore, shoppingCartId, addSocks);

    const stored =
      await eventStore.readStream<ProductItemAddedV1>(shoppingCartId);

    expect(stored.events.map((event) => event.data)).toEqual([
      {
        productId: 'socks',
        quantity: 3,
        addedAt: '2024-03-01T09:00:00.000Z',
      },
    ]);
  });

  void it('round-trips through downcast on append and upcast on read', async () => {
    const eventStore = getInMemoryEventStore();
    const shoppingCartId = randomUUID();

    await handle(eventStore, shoppingCartId, addSocks);

    const { newState } = await handle(eventStore, shoppingCartId, () => ({
      type: 'ProductItemAdded',
      data: {
        productItem: { productId: 'hat', quantity: 1 },
        addedAt: new Date('2024-03-02T09:00:00.000Z'),
      },
    }));

    expect(newState).toEqual({
      productItems: [
        {
          productId: 'socks',
          quantity: 3,
          addedAt: new Date('2024-03-01T09:00:00.000Z'),
        },
        {
          productId: 'hat',
          quantity: 1,
          addedAt: new Date('2024-03-02T09:00:00.000Z'),
        },
      ],
    });
  });
});
