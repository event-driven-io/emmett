import {
  EmmettError,
  IllegalStateError,
  sum,
  type Decider,
} from '@event-driven-io/emmett';
import { CommandClass, s } from '../../lib';
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
} from './shoppingCart';

/////////////////////////////////////////
////////// Commands
/////////////////////////////////////////

export const ShoppingCartCommandMetadata = s.object({
  now: s.date(),
  clientId: s.string(),
});
export type ShoppingCartCommandMetadata =
  typeof ShoppingCartCommandMetadata.Type;

export class AddProductItemToShoppingCart extends CommandClass(
  'AddProductItemToShoppingCart',
  {
    data: {
      clientId: s.string(),
      shoppingCartId: s.string(),
      productItem: PricedProductItem,
    },
    metadata: ShoppingCartCommandMetadata,
  },
) {}

export class RemoveProductItemFromShoppingCart extends CommandClass(
  'RemoveProductItemFromShoppingCart',
  {
    data: {
      shoppingCartId: s.string(),
      productItem: PricedProductItem,
    },
    metadata: ShoppingCartCommandMetadata,
  },
) {}

export class ConfirmShoppingCart extends CommandClass('ConfirmShoppingCart', {
  data: {
    shoppingCartId: s.string(),
  },
  metadata: ShoppingCartCommandMetadata,
}) {}

export class CancelShoppingCart extends CommandClass('CancelShoppingCart', {
  data: {
    shoppingCartId: s.string(),
  },
  metadata: ShoppingCartCommandMetadata,
}) {}

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
    data: { shoppingCartId, clientId, productItem },
    metadata,
  } = command;

  return new ProductItemAddedToShoppingCart(
    { shoppingCartId, clientId, productItem, addedAt: metadata.now },
    { clientId: metadata.clientId },
  );
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

  return new ProductItemRemovedFromShoppingCart(
    { shoppingCartId, productItem, removedAt: metadata.now },
    { clientId: metadata.clientId },
  );
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

  return new ShoppingCartConfirmed(
    { shoppingCartId, confirmedAt: metadata.now },
    { clientId: metadata.clientId },
  );
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

  return new ShoppingCartCancelled(
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
