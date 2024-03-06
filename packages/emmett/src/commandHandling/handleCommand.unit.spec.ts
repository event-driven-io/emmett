/* eslint-disable @typescript-eslint/no-floating-promises */
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { getInMemoryEventStore } from '../eventStore';
import { type Event } from '../typing';
import { CommandHandler } from './handleCommand';

// Events & Entity

type ShoppingCart = {
  productItems: string[];
};

type ProductItemAdded = Event<'ProductItemAdded', { productItem: string }>;

type ShoppingCartEvent = ProductItemAdded;

const evolve = (
  state: ShoppingCart,
  event: ShoppingCartEvent,
): ShoppingCart => {
  return { productItems: [...state.productItems, event.data.productItem] };
};

const getInitialState = (): ShoppingCart => {
  return { productItems: [] };
};

// Decision making

type AddProductItem = Event<'AddProductItem', { productItem: string }>;

const addProductItem = (
  command: AddProductItem,
  _state: ShoppingCart,
): ShoppingCartEvent => {
  return {
    type: 'ProductItemAdded',
    data: { productItem: command.data.productItem },
  };
};

const handleCommand = CommandHandler<ShoppingCart, ShoppingCartEvent>(
  evolve,
  getInitialState,
);

describe('Command Handler', () => {
  const eventStore = getInMemoryEventStore();

  it('When called successfuly returns new state', async () => {
    const productItem = '123';

    const shoppingCartId = randomUUID();
    const command: AddProductItem = {
      type: 'AddProductItem',
      data: { productItem },
    };

    const { nextExpectedStreamVersion, newState } = await handleCommand(
      eventStore,
      shoppingCartId,
      (state) => addProductItem(command, state),
    );

    assert.deepEqual(newState, { productItems: [productItem] });
    assert.equal(nextExpectedStreamVersion, 1);
  });
});
