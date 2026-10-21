import {
  EmmettError,
  IllegalStateError,
  sum,
  type Decider,
} from '@event-driven-io/emmett';
import { z } from 'zod';
import { Command, Commands } from '../../lib';
import {
  evolve,
  initialState,
  isoDate,
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

export const ShoppingCartCommandMetadata = z.object({
  now: isoDate,
  clientId: z.string(),
});
export type ShoppingCartCommandMetadata = z.infer<
  typeof ShoppingCartCommandMetadata
>;

export const AddProductItemToShoppingCart = Command(
  'AddProductItemToShoppingCart',
  {
    data: z.object({
      clientId: z.string(),
      shoppingCartId: z.string(),
      productItem: PricedProductItem,
    }),
    metadata: ShoppingCartCommandMetadata,
  },
);
export type AddProductItemToShoppingCart =
  typeof AddProductItemToShoppingCart.Type;

export const RemoveProductItemFromShoppingCart = Command(
  'RemoveProductItemFromShoppingCart',
  {
    data: z.object({
      shoppingCartId: z.string(),
      productItem: PricedProductItem,
    }),
    metadata: ShoppingCartCommandMetadata,
  },
);
export type RemoveProductItemFromShoppingCart =
  typeof RemoveProductItemFromShoppingCart.Type;

export const ConfirmShoppingCart = Command('ConfirmShoppingCart', {
  data: z.object({
    shoppingCartId: z.string(),
  }),
  metadata: ShoppingCartCommandMetadata,
});
export type ConfirmShoppingCart = typeof ConfirmShoppingCart.Type;

export const CancelShoppingCart = Command('CancelShoppingCart', {
  data: z.object({
    shoppingCartId: z.string(),
  }),
  metadata: ShoppingCartCommandMetadata,
});
export type CancelShoppingCart = typeof CancelShoppingCart.Type;

export const ShoppingCartCommand = Commands(
  AddProductItemToShoppingCart,
  RemoveProductItemFromShoppingCart,
  ConfirmShoppingCart,
  CancelShoppingCart,
);
export type ShoppingCartCommand = typeof ShoppingCartCommand.Type;

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

  return ProductItemAddedToShoppingCart(
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

  return ProductItemRemovedFromShoppingCart(
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

  return ShoppingCartConfirmed(
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
