// #region getting-started-commands
import type { Command } from '@event-driven-io/emmett';
import type { PricedProductItem } from './events';

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

// #endregion getting-started-commands
