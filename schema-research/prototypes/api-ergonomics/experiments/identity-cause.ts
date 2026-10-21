import type * as Today from '../styles/today/shoppingCart';
import type * as A from '../styles/a-builtin/shoppingCart';
type Equals<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
export type Cause = {
  confirmed: [Equals<A.ShoppingCartConfirmed, Today.ShoppingCartConfirmed>];
  added: [Equals<A.ProductItemAddedToShoppingCart, Today.ProductItemAddedToShoppingCart>];
  pricedItem: [Equals<A.PricedProductItem, Today.PricedProductItem>];
  pricedItemFlattened: [Equals<A.PricedProductItem, { productId: string; quantity: number; unitPrice: number }>];
};
