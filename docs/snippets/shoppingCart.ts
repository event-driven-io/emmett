// #region getting-started-events
import type { Event } from '@event-driven-io/emmett';

type ProductItemAddedToShoppingCart = Event<
  'ProductItemAddedToShoppingCart',
  {
    shoppingCartId: string;
    productItem: PricedProductItem;
  }
>;

type ProductItemRemovedFromShoppingCart = Event<
  'ProductItemRemovedFromShoppingCart',
  {
    shoppingCartId: string;
    productItem: PricedProductItem;
  }
>;

type ShoppingCartConfirmed = Event<
  'ShoppingCartConfirmed',
  {
    shoppingCartId: string;
    confirmedAt: Date;
  }
>;

type ShoppingCartCanceled = Event<
  'ShoppingCartCanceled',
  {
    shoppingCartId: string;
    canceledAt: Date;
  }
>;

export type ShoppingCartEvent =
  | ProductItemAddedToShoppingCart
  | ProductItemRemovedFromShoppingCart
  | ShoppingCartConfirmed
  | ShoppingCartCanceled;

export interface ProductItem {
  productId: string;
  quantity: number;
}

export type PricedProductItem = ProductItem & {
  price: number;
};
// #endregion getting-started-events
