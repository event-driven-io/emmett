import {
  EmmettError,
  IllegalStateError,
  sum,
  type Decider,
} from '@event-driven-io/emmett';
import { Commands, s } from '../../lib';
import {
  evolve,
  initialState,
  PricedProductItem,
  ProductItemAddedToShoppingCart,
  ProductItemRemovedFromShoppingCart,
  ShoppingCartCancelled,
  ShoppingCartConfirmed,
  type ShoppingCart,
  type ShoppingCartEvent,
  type ShoppingCartEvents,
} from './shoppingCart';

/////////////////////////////////////////
////////// Commands
/////////////////////////////////////////

export const ShoppingCartCommand = Commands(
  {
    AddProductItemToShoppingCart: {
      clientId: s.string(),
      shoppingCartId: s.string(),
      productItem: PricedProductItem,
    },
    RemoveProductItemFromShoppingCart: {
      shoppingCartId: s.string(),
      productItem: PricedProductItem,
    },
    ConfirmShoppingCart: {
      shoppingCartId: s.string(),
    },
    CancelShoppingCart: {
      shoppingCartId: s.string(),
    },
  },
  { metadata: { now: s.date(), clientId: s.string() } },
);
export type ShoppingCartCommand = typeof ShoppingCartCommand.Type;
export type ShoppingCartCommands = typeof ShoppingCartCommand.Types;

/////////////////////////////////////////
////////// Business Logic
/////////////////////////////////////////

export const addProductItem = (
  command: ShoppingCartCommands['AddProductItemToShoppingCart'],
  state: ShoppingCart,
): ShoppingCartEvents['ProductItemAddedToShoppingCart'] => {
  if (state.status === 'Closed')
    throw new IllegalStateError('Shopping Cart already closed');

  const {
    data: { shoppingCartId, clientId, productItem },
    metadata,
  } = command;

  return ProductItemAddedToShoppingCart(
    { shoppingCartId, clientId, productItem, addedAt: metadata.now },
    { clientId: metadata.clientId },
  );
};

export const removeProductItem = (
  command: ShoppingCartCommands['RemoveProductItemFromShoppingCart'],
  state: ShoppingCart,
): ShoppingCartEvents['ProductItemRemovedFromShoppingCart'] => {
  if (state.status !== 'Opened')
    throw new IllegalStateError('Shopping Cart is not opened');

  const {
    data: { shoppingCartId, productItem },
    metadata,
  } = command;

  const currentQuantity = state.productItems.get(productItem.productId) ?? 0;

  if (currentQuantity < productItem.quantity)
    throw new IllegalStateError('Not enough products');

  return ProductItemRemovedFromShoppingCart(
    { shoppingCartId, productItem, removedAt: metadata.now },
    { clientId: metadata.clientId },
  );
};

export const confirm = (
  command: ShoppingCartCommands['ConfirmShoppingCart'],
  state: ShoppingCart,
): ShoppingCartEvents['ShoppingCartConfirmed'] => {
  if (state.status !== 'Opened')
    throw new IllegalStateError('Shopping Cart is not opened');

  const totalQuantityOfAllProductItems = sum(state.productItems.values());

  if (totalQuantityOfAllProductItems <= 0)
    throw new IllegalStateError('Shopping Cart is empty');

  const {
    data: { shoppingCartId },
    metadata,
  } = command;

  return ShoppingCartConfirmed(
    { shoppingCartId, confirmedAt: metadata.now },
    { clientId: metadata.clientId },
  );
};

export const cancel = (
  command: ShoppingCartCommands['CancelShoppingCart'],
  state: ShoppingCart,
): ShoppingCartEvents['ShoppingCartCancelled'] => {
  if (state.status !== 'Opened')
    throw new IllegalStateError('Shopping Cart is not opened');

  const {
    data: { shoppingCartId },
    metadata,
  } = command;

  return ShoppingCartCancelled(
    { shoppingCartId, cancelledAt: metadata.now },
    { clientId: metadata.clientId },
  );
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
  initialState,
};
