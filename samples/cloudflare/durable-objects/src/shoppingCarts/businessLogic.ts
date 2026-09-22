import {
  EmmettError,
  type Command,
  type Decider,
  type DefaultCommandMetadata,
} from '@event-driven-io/emmett';
import {
  evolve,
  initialState,
  ProductItems,
  type PricedProductItem,
  type ShoppingCartEvent,
  type ShoppingCartState,
} from './shoppingCart';

export type ShoppingCartCommandMetadata = DefaultCommandMetadata & {
  clientId: string;
};

export type AddProductItemToShoppingCart = Command<
  'AddProductItemToShoppingCart',
  {
    shoppingCartId: string;
    clientId: string;
    productItem: PricedProductItem;
  },
  ShoppingCartCommandMetadata
>;

export type RemoveProductItemFromShoppingCart = Command<
  'RemoveProductItemFromShoppingCart',
  {
    shoppingCartId: string;
    productId: string;
    quantity: number;
  },
  ShoppingCartCommandMetadata
>;

export type ConfirmShoppingCart = Command<
  'ConfirmShoppingCart',
  { shoppingCartId: string },
  ShoppingCartCommandMetadata
>;

export type CancelShoppingCart = Command<
  'CancelShoppingCart',
  { shoppingCartId: string },
  ShoppingCartCommandMetadata
>;

export type ShoppingCartCommand =
  | AddProductItemToShoppingCart
  | RemoveProductItemFromShoppingCart
  | ConfirmShoppingCart
  | CancelShoppingCart;

const conflict = (message: string) =>
  new EmmettError({ errorCode: 409, message });

export const addProductItem = (
  { data, metadata }: AddProductItemToShoppingCart,
  state: ShoppingCartState,
): ShoppingCartEvent[] => {
  if (state.status === 'Confirmed' || state.status === 'Cancelled')
    throw conflict('Shopping Cart already closed');

  const { shoppingCartId, clientId } = data;
  const currentProductItem =
    state.status === 'Opened'
      ? ProductItems.find(state.productItems, data.productItem.productId)
      : undefined;
  const productItem = {
    ...data.productItem,
    unitPrice: currentProductItem?.unitPrice ?? data.productItem.unitPrice,
  };

  const added: ShoppingCartEvent = {
    type: 'ProductItemAddedToShoppingCart',
    data: { shoppingCartId, clientId, productItem, addedAt: metadata.now },
    metadata: { clientId: metadata.clientId },
  };

  if (state.status === 'Opened') return [added];

  return [
    {
      type: 'ShoppingCartOpened',
      data: { shoppingCartId, clientId, openedAt: metadata.now },
      metadata: { clientId: metadata.clientId },
    },
    added,
  ];
};

export const removeProductItem = (
  { data, metadata }: RemoveProductItemFromShoppingCart,
  state: ShoppingCartState,
): ShoppingCartEvent[] => {
  if (state.status !== 'Opened') throw conflict('Shopping Cart is not opened');

  const currentProductItem = ProductItems.find(
    state.productItems,
    data.productId,
  );
  if (!currentProductItem || currentProductItem.quantity < data.quantity)
    throw conflict('Not enough products in shopping cart');

  return [
    {
      type: 'ProductItemRemovedFromShoppingCart',
      data: {
        shoppingCartId: data.shoppingCartId,
        productItem: { ...currentProductItem, quantity: data.quantity },
        removedAt: metadata.now,
      },
      metadata: { clientId: metadata.clientId },
    },
  ];
};

export const confirm = (
  { data, metadata }: ConfirmShoppingCart,
  state: ShoppingCartState,
): ShoppingCartEvent[] => {
  if (state.status === 'Confirmed') return [];
  if (state.status !== 'Opened') throw conflict('Shopping Cart is not opened');
  if (state.productItemsCount === 0) throw conflict('Shopping Cart is empty');

  return [
    {
      type: 'ShoppingCartConfirmed',
      data: { shoppingCartId: data.shoppingCartId, confirmedAt: metadata.now },
      metadata: { clientId: metadata.clientId },
    },
  ];
};

export const cancel = (
  { data, metadata }: CancelShoppingCart,
  state: ShoppingCartState,
): ShoppingCartEvent[] => {
  if (state.status === 'Cancelled') return [];
  if (state.status !== 'Opened') throw conflict('Shopping Cart is not opened');

  return [
    {
      type: 'ShoppingCartCancelled',
      data: { shoppingCartId: data.shoppingCartId, cancelledAt: metadata.now },
      metadata: { clientId: metadata.clientId },
    },
  ];
};

export const decide = (
  command: ShoppingCartCommand,
  state: ShoppingCartState,
): ShoppingCartEvent[] => {
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
      throw new EmmettError('Unknown command type');
    }
  }
};

export const decider: Decider<
  ShoppingCartState,
  ShoppingCartCommand,
  ShoppingCartEvent
> = {
  decide,
  evolve,
  initialState,
};
