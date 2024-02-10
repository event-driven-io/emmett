/* eslint-disable @typescript-eslint/no-unused-vars */
// #region event-type
import type { Event } from '@event-driven-io/emmett';

type ProductItemAddedToShoppingCart = Event<
  'ProductItemAddedToShoppingCart',
  {
    shoppingCartId: string;
    productItem: PricedProductItem;
  }
>;
// #endregion event-type

export interface ProductItem {
  productId: string;
  quantity: number;
}

export type PricedProductItem = ProductItem & {
  price: number;
};
