import {
  EmmettError,
  type Command,
  type DefaultCommandMetadata,
} from '@event-driven-io/emmett';
import {
  ProductItems,
  type PricedProductItem,
  type ProductItemAddedToShoppingCart,
  type ProductItemRemovedFromShoppingCart,
  type ShoppingCart,
  type ShoppingCartCancelled,
  type ShoppingCartConfirmed,
  type ShoppingCartEvent,
  type ShoppingCartOpened,
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

export const addProductItem = (
  {
    data: { shoppingCartId, clientId, productItem },
    metadata,
  }: AddProductItemToShoppingCart,
  state: ShoppingCart,
): (ShoppingCartOpened | ProductItemAddedToShoppingCart)[] => {
  if (state.status === 'Confirmed' || state.status === 'Cancelled')
    throw new EmmettError({
      errorCode: 409,
      message: 'Shopping Cart already closed',
    });

  const currentProductItem =
    state.status === 'Opened'
      ? ProductItems.find(state.productItems, productItem.productId)
      : undefined;

  const added: ProductItemAddedToShoppingCart = {
    type: 'ProductItemAddedToShoppingCart',
    data: {
      shoppingCartId,
      clientId,
      productItem: {
        ...productItem,
        unitPrice: currentProductItem?.unitPrice ?? productItem.unitPrice,
      },
      addedAt: metadata.now,
    },
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
  {
    data: { shoppingCartId, productId, quantity },
    metadata,
  }: RemoveProductItemFromShoppingCart,
  state: ShoppingCart,
): ProductItemRemovedFromShoppingCart[] => {
  if (state.status !== 'Opened')
    throw new EmmettError({
      errorCode: 409,
      message: 'Shopping Cart is not opened',
    });

  const currentProductItem = ProductItems.find(state.productItems, productId);
  if (!currentProductItem || currentProductItem.quantity < quantity)
    throw new EmmettError({
      errorCode: 409,
      message: 'Not enough products in shopping cart',
    });

  return [
    {
      type: 'ProductItemRemovedFromShoppingCart',
      data: {
        shoppingCartId,
        productItem: { ...currentProductItem, quantity },
        removedAt: metadata.now,
      },
      metadata: { clientId: metadata.clientId },
    },
  ];
};

export const confirm = (
  { data: { shoppingCartId }, metadata }: ConfirmShoppingCart,
  state: ShoppingCart,
): ShoppingCartConfirmed[] => {
  if (state.status === 'Confirmed') return [];
  if (state.status !== 'Opened')
    throw new EmmettError({
      errorCode: 409,
      message: 'Shopping Cart is not opened',
    });
  if (state.productItemsCount === 0)
    throw new EmmettError({
      errorCode: 409,
      message: 'Shopping Cart is empty',
    });

  return [
    {
      type: 'ShoppingCartConfirmed',
      data: { shoppingCartId, confirmedAt: metadata.now },
      metadata: { clientId: metadata.clientId },
    },
  ];
};

export const cancel = (
  { data: { shoppingCartId }, metadata }: CancelShoppingCart,
  state: ShoppingCart,
): ShoppingCartCancelled[] => {
  if (state.status === 'Cancelled') return [];
  if (state.status !== 'Opened')
    throw new EmmettError({
      errorCode: 409,
      message: 'Shopping Cart is not opened',
    });

  return [
    {
      type: 'ShoppingCartCancelled',
      data: { shoppingCartId, cancelledAt: metadata.now },
      metadata: { clientId: metadata.clientId },
    },
  ];
};

export const decide = (
  command: ShoppingCartCommand,
  state: ShoppingCart,
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
