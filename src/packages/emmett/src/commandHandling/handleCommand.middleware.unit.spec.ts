import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { IllegalStateError } from '../errors';
import { getInMemoryEventStore, type EventStore } from '../eventStore';
import { assertThrowsAsync, assertTrue } from '../testing';
import type { Event } from '../typing';
import { CommandHandler, type HandleOptions } from './handleCommand';

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

type ShoppingCartEvent = ProductItemAdded;

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

const rawCommandHandler = CommandHandler<ShoppingCart, ShoppingCartEvent>({
  evolve,
  initialState,
});

type RequestHeaders = {
  authToken: string;
};

const VALID_AUTH_TOKEN = 'VALID_AUTH_TOKEN';
const INVALID_AUTH_TOKEN = 'INVALID_AUTH_TOKEN';

export const authorize = (requestHeaders: RequestHeaders): Promise<void> => {
  if (requestHeaders.authToken !== VALID_AUTH_TOKEN)
    return Promise.reject(new IllegalStateError('Authorization failed!'));

  return Promise.resolve();
};

export const handleCommand = async <Store extends EventStore>(
  store: Store,
  id: string,
  decide: (state: ShoppingCart) => ShoppingCartEvent | ShoppingCartEvent[],
  handleOptions: HandleOptions<Store> & { requestHeaders: RequestHeaders },
) =>
  rawCommandHandler(
    store,
    id,
    async (
      state: ShoppingCart,
    ): Promise<ShoppingCartEvent | ShoppingCartEvent[]> => {
      await authorize(handleOptions.requestHeaders);

      return decide(state);
    },
    handleOptions,
  );

void describe('Command Handler', () => {
  const eventStore = getInMemoryEventStore();

  void it('Succeeds when middleware allows processing', async () => {
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

    const { createdNewStream } = await handleCommand(
      eventStore,
      shoppingCartId,
      (state) => addProductItem(command, state),
      { requestHeaders: { authToken: VALID_AUTH_TOKEN } },
    );

    assertTrue(createdNewStream);
  });

  void it('Fails when middleware rejects processing', async () => {
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

    await assertThrowsAsync<IllegalStateError>(
      async () => {
        await handleCommand(
          eventStore,
          shoppingCartId,
          (state) => addProductItem(command, state),
          { requestHeaders: { authToken: INVALID_AUTH_TOKEN } },
        );
      },
      (error: Error) =>
        error instanceof IllegalStateError &&
        error.message === 'Authorization failed!',
    );
  });
});
