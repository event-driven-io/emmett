/* eslint-disable @typescript-eslint/no-unused-vars */
// #region command-type
import type { Command } from '@event-driven-io/emmett';

type AddProductItemToShoppingCart = Command<
  'AddProductItemToShoppingCart',
  {
    shoppingCartId: string;
    productItem: PricedProductItem;
  }
>;
// #endregion command-type

export interface ProductItem {
  productId: string;
  quantity: number;
}

export type PricedProductItem = ProductItem & {
  price: number;
};
