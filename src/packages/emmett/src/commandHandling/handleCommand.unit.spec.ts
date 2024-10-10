import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { getInMemoryEventStore } from '../eventStore';
import {
  assertDeepEqual,
  assertEqual,
  assertFalse,
  assertThatArray,
  assertTrue,
} from '../testing';
import { type Event } from '../typing';
import { CommandHandler } from './handleCommand';

// Events & Entity

type PricedProductItem = { productId: string; quantity: number; price: number };

type ShoppingCart = {
  productItems: PricedProductItem[];
  totalAmount: number;
};

type ProductItemAdded = Event<
  'ProductItemAdded',
  { productItem: PricedProductItem }
>;
type DiscountApplied = Event<'DiscountApplied', { percent: number }>;

type ShoppingCartEvent = ProductItemAdded | DiscountApplied;

const evolve = (
  state: ShoppingCart,
  { type, data }: ShoppingCartEvent,
): ShoppingCart => {
  switch (type) {
    case 'ProductItemAdded': {
      const productItem = data.productItem;
      return {
        productItems: [...state.productItems, productItem],
        totalAmount:
          state.totalAmount + productItem.price * productItem.quantity,
      };
    }
    case 'DiscountApplied':
      return {
        ...state,
        totalAmount: state.totalAmount * (1 - data.percent),
      };
  }
};

const initialState = (): ShoppingCart => {
  return { productItems: [], totalAmount: 0 };
};

// Decision making

type AddProductItem = Event<
  'AddProductItem',
  { productItem: PricedProductItem }
>;

const addProductItem = (
  command: AddProductItem,
  _state: ShoppingCart,
): ShoppingCartEvent => {
  return {
    type: 'ProductItemAdded',
    data: { productItem: command.data.productItem },
  };
};

const defaultDiscount = 0.1;

const addProductItemWithDiscount = (
  command: AddProductItem,
  _state: ShoppingCart,
): ShoppingCartEvent[] => {
  return [
    {
      type: 'ProductItemAdded',
      data: { productItem: command.data.productItem },
    },
    { type: 'DiscountApplied', data: { percent: defaultDiscount } },
  ];
};

const handleCommand = CommandHandler<ShoppingCart, ShoppingCartEvent>(
  evolve,
  initialState,
);

void describe('Command Handler', () => {
  const eventStore = getInMemoryEventStore();

  void it('When called successfully returns new state for a single returned event', async () => {
    const productItem: PricedProductItem = {
      productId: '123',
      quantity: 10,
      price: 3,
    };

    const shoppingCartId = randomUUID();
    const command: AddProductItem = {
      type: 'AddProductItem',
      data: { productItem },
    };

    const { nextExpectedStreamVersion, newState, newEvents, createdNewStream } =
      await handleCommand(eventStore, shoppingCartId, (state) =>
        addProductItem(command, state),
      );

    assertTrue(createdNewStream);
    assertThatArray(newEvents).hasSize(1);
    assertDeepEqual(newState, {
      productItems: [productItem],
      totalAmount: productItem.price * productItem.quantity,
    });
    assertEqual(nextExpectedStreamVersion, 1n);
  });

  void it('When called successfuly returns new state for multiple returned events', async () => {
    const productItem: PricedProductItem = {
      productId: '123',
      quantity: 10,
      price: 3,
    };

    const shoppingCartId = randomUUID();
    const command: AddProductItem = {
      type: 'AddProductItem',
      data: { productItem },
    };

    const { nextExpectedStreamVersion, newState, newEvents, createdNewStream } =
      await handleCommand(eventStore, shoppingCartId, (state) =>
        addProductItemWithDiscount(command, state),
      );

    assertTrue(createdNewStream);
    assertThatArray(newEvents).hasSize(2);
    assertDeepEqual(newState, {
      productItems: [productItem],
      totalAmount:
        productItem.price * productItem.quantity * (1 - defaultDiscount),
    });
    assertEqual(nextExpectedStreamVersion, 2n);
  });

  void it('When returning an empty array of events returns the same state', async () => {
    const productItem: PricedProductItem = {
      productId: '123',
      quantity: 10,
      price: 3,
    };

    const shoppingCartId = randomUUID();
    const command: AddProductItem = {
      type: 'AddProductItem',
      data: { productItem },
    };

    const { nextExpectedStreamVersion, newState, newEvents, createdNewStream } =
      await handleCommand(eventStore, shoppingCartId, (state) =>
        command.data.productItem.price > 100
          ? addProductItemWithDiscount(command, state)
          : [],
      );

    assertFalse(createdNewStream);
    assertEqual(nextExpectedStreamVersion, 0n);
    assertDeepEqual(newEvents, []);
    assertDeepEqual(newState, initialState());
  });
});
