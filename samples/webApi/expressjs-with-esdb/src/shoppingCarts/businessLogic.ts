import {
  EmmettError,
  IllegalStateError,
  sum,
  type Command,
  type Decider,
} from '@event-driven-io/emmett';
import {
  evolve,
  getInitialState,
  type PricedProductItem,
  type ProductItemAddedToShoppingCart,
  type ProductItemRemovedFromShoppingCart,
  type ShoppingCart,
  type ShoppingCartCancelled,
  type ShoppingCartConfirmed,
  type ShoppingCartEvent,
} from './shoppingCart';

/////////////////////////////////////////
////////// Commands
/////////////////////////////////////////

export type AddProductItemToShoppingCart = Command<
  'AddProductItemToShoppingCart',
  {
    shoppingCartId: string;
    productItem: PricedProductItem;
  }
>;

export type RemoveProductItemFromShoppingCart = Command<
  'RemoveProductItemFromShoppingCart',
  {
    shoppingCartId: string;
    productItem: PricedProductItem;
  }
>;

export type ConfirmShoppingCart = Command<
  'ConfirmShoppingCart',
  {
    shoppingCartId: string;
  }
>;

export type CancelShoppingCart = Command<
  'CancelShoppingCart',
  {
    shoppingCartId: string;
  }
>;

export type ShoppingCartCommand =
  | AddProductItemToShoppingCart
  | RemoveProductItemFromShoppingCart
  | ConfirmShoppingCart
  | CancelShoppingCart;

/////////////////////////////////////////
////////// Business Logic
/////////////////////////////////////////

export const addProductItem = (
  command: AddProductItemToShoppingCart,
  state: ShoppingCart,
): ProductItemAddedToShoppingCart => {
  if (state.status === 'Closed')
    throw new IllegalStateError('Shopping Cart already closed');

  const {
    data: { shoppingCartId, productItem },
    metadata,
  } = command;

  return {
    type: 'ProductItemAddedToShoppingCart',
    data: {
      shoppingCartId,
      productItem,
      addedAt: metadata?.now ?? new Date(),
    },
  };
};

export const removeProductItem = (
  command: RemoveProductItemFromShoppingCart,
  state: ShoppingCart,
): ProductItemRemovedFromShoppingCart => {
  if (state.status !== 'Opened')
    throw new IllegalStateError('Shopping Cart is not opened');

  const {
    data: { shoppingCartId, productItem },
    metadata,
  } = command;

  const currentQuantity = state.productItems.get(productItem.productId) ?? 0;

  if (currentQuantity < productItem.quantity)
    throw new IllegalStateError('Not enough products');

  return {
    type: 'ProductItemRemovedFromShoppingCart',
    data: {
      shoppingCartId,
      productItem,
      removedAt: metadata?.now ?? new Date(),
    },
  };
};

export const confirm = (
  command: ConfirmShoppingCart,
  state: ShoppingCart,
): ShoppingCartConfirmed => {
  if (state.status !== 'Opened')
    throw new IllegalStateError('Shopping Cart is not opened');

  const totalQuantityOfAllProductItems = sum(state.productItems.values());

  if (totalQuantityOfAllProductItems <= 0)
    throw new IllegalStateError('Shopping Cart is empty');

  const {
    data: { shoppingCartId },
    metadata,
  } = command;

  return {
    type: 'ShoppingCartConfirmed',
    data: {
      shoppingCartId,
      confirmedAt: metadata?.now ?? new Date(),
    },
  };
};

export const cancel = (
  command: CancelShoppingCart,
  state: ShoppingCart,
): ShoppingCartCancelled => {
  if (state.status !== 'Opened')
    throw new IllegalStateError('Shopping Cart is not opened');

  const {
    data: { shoppingCartId },
    metadata,
  } = command;

  return {
    type: 'ShoppingCartCancelled',
    data: {
      shoppingCartId,
      canceledAt: metadata?.now ?? new Date(),
    },
  };
};

export const decide = (command: ShoppingCartCommand, state: ShoppingCart) => {
  const { type } = command;

  switch (type) {
    case 'AddProductItemToShoppingCart':
      return addProductItem(command, state);
    case 'RemoveProductItemFromShoppingCart':
      return removeProductItem(command, state);
    case 'ConfirmShoppingCart':
      return confirm(command, state);
    case 'CancelShoppingCart':
      return cancel(command, state);
    default: {
      const _notExistingCommandType: never = type;
      throw new EmmettError(`Unknown command type`);
    }
  }
};

export const decider: Decider<
  ShoppingCart,
  ShoppingCartCommand,
  ShoppingCartEvent
> = {
  decide,
  evolve,
  getInitialState,
};
