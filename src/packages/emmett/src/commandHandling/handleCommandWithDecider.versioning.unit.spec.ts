import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { getInMemoryEventStore } from '../eventStore';
import type { Command, Event } from '../typing';
import { DeciderCommandHandler } from './handleCommandWithDecider';

// #region decider-upcasting

type AddProductItem = Command<
  'AddProductItem',
  { productId: string; quantity: number }
>;

// The shape currently written to the stream
type ProductItemAdded = Event<
  'ProductItemAdded',
  { productId: string; quantity: number }
>;

// The shape older events were stored with
type ProductItemAddedV1 = Event<
  'ProductItemAdded',
  { productId: string; quantity: string }
>;

type ShoppingCart = { productItems: { productId: string; quantity: number }[] };

const initialState = (): ShoppingCart => ({ productItems: [] });

const evolve = (
  state: ShoppingCart,
  event: ProductItemAdded,
): ShoppingCart => ({
  productItems: [...state.productItems, event.data],
});

const decide = (
  command: AddProductItem,
  _state: ShoppingCart,
): ProductItemAdded => ({
  type: 'ProductItemAdded',
  data: command.data,
});

const handle = DeciderCommandHandler<
  ShoppingCart,
  AddProductItem,
  ProductItemAdded,
  ProductItemAddedV1
>({
  decide,
  evolve,
  initialState,
  schema: {
    versioning: {
      // `event` is typed as ProductItemAddedV1, not ProductItemAdded
      upcast: (event) => ({
        type: 'ProductItemAdded',
        data: {
          productId: event.data.productId,
          quantity: Number(event.data.quantity),
        },
      }),
    },
  },
});

// #endregion decider-upcasting

void describe('DeciderCommandHandler schema versioning', () => {
  const eventStore = getInMemoryEventStore();

  void it('upcasts stored events before rebuilding the state', async () => {
    const shoppingCartId = randomUUID();

    await eventStore.appendToStream<ProductItemAddedV1>(shoppingCartId, [
      {
        type: 'ProductItemAdded',
        data: { productId: 'shoes', quantity: '10' },
      },
    ]);

    const { newState } = await handle(eventStore, shoppingCartId, {
      type: 'AddProductItem',
      data: { productId: 'socks', quantity: 3 },
    });

    expect(newState).toEqual({
      productItems: [
        { productId: 'shoes', quantity: 10 },
        { productId: 'socks', quantity: 3 },
      ],
    });
  });
});
