/* eslint-disable @typescript-eslint/no-unused-vars */
import type { Event } from '@event-driven-io/emmett';
import { pongoSingleStreamProjection } from '@event-driven-io/emmett-postgresql';

export interface ProductItem {
  productId: string;
  quantity: number;
}

export type PricedProductItem = ProductItem & {
  unitPrice: number;
};

type ProductItemAddedToShoppingCart = Event<
  'ProductItemAddedToShoppingCart',
  {
    shoppingCartId: string;
    productItem: PricedProductItem;
    addedAt: Date;
  }
>;

type ProductItemRemovedFromShoppingCart = Event<
  'ProductItemRemovedFromShoppingCart',
  {
    shoppingCartId: string;
    productItem: PricedProductItem;
    removedAt: Date;
  }
>;

type ShoppingCartConfirmed = Event<
  'ShoppingCartConfirmed',
  {
    shoppingCartId: string;
    confirmedAt: Date;
  }
>;

type ShoppingCartCancelled = Event<
  'ShoppingCartCancelled',
  {
    shoppingCartId: string;
    cancelledAt: Date;
  }
>;

type ShoppingCartEvent =
  | ProductItemAddedToShoppingCart
  | ProductItemRemovedFromShoppingCart
  | ShoppingCartConfirmed
  | ShoppingCartCancelled;

type ShoppingCartShortInfo = {
  productItemsCount: number;
  totalAmount: number;
};

// #region deletion-pattern
const evolve = (
  document: ShoppingCartShortInfo,
  { type, data: event }: ShoppingCartEvent,
): ShoppingCartShortInfo | null => {
  switch (type) {
    case 'ProductItemAddedToShoppingCart':
      return {
        totalAmount:
          document.totalAmount +
          event.productItem.unitPrice * event.productItem.quantity,
        productItemsCount:
          document.productItemsCount + event.productItem.quantity,
      };
    case 'ProductItemRemovedFromShoppingCart':
      return {
        totalAmount:
          document.totalAmount -
          event.productItem.unitPrice * event.productItem.quantity,
        productItemsCount:
          document.productItemsCount - event.productItem.quantity,
      };
    case 'ShoppingCartConfirmed':
    case 'ShoppingCartCancelled':
      // Delete the pending cart document
      return null;
    default:
      return document;
  }
};
// #endregion deletion-pattern

const shoppingCartShortInfoProjection = pongoSingleStreamProjection({
  collectionName: 'shoppingCartShortInfo',
  evolve,
  canHandle: [
    'ProductItemAddedToShoppingCart',
    'ProductItemRemovedFromShoppingCart',
    'ShoppingCartConfirmed',
    'ShoppingCartCancelled',
  ],
  initialState: () => ({ productItemsCount: 0, totalAmount: 0 }),
});
