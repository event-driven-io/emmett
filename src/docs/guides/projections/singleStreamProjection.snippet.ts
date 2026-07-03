/* eslint-disable @typescript-eslint/no-unused-vars */
import type { Event } from '@event-driven-io/emmett';

export interface ProductItem {
  productId: string;
  quantity: number;
}

export type PricedProductItem = ProductItem & {
  price: number;
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

type ShoppingCartEvent =
  ProductItemAddedToShoppingCart | ProductItemRemovedFromShoppingCart;

// #region single-stream-projection
import { pongoSingleStreamProjection } from '@event-driven-io/emmett-postgresql';

type ShoppingCartSummary = {
  _id: string;
  productItemsCount: number;
  totalAmount: number;
};

const cartSummaryProjection = pongoSingleStreamProjection({
  collectionName: 'shopping_cart_summaries',
  canHandle: [
    'ProductItemAddedToShoppingCart',
    'ProductItemRemovedFromShoppingCart',
  ],
  evolve: (document: ShoppingCartSummary | null, event: ShoppingCartEvent) => {
    const current = document ?? {
      _id: event.data.shoppingCartId,
      productItemsCount: 0,
      totalAmount: 0,
    };

    switch (event.type) {
      case 'ProductItemAddedToShoppingCart':
        return {
          ...current,
          productItemsCount:
            current.productItemsCount + event.data.productItem.quantity,
          totalAmount:
            current.totalAmount +
            event.data.productItem.price * event.data.productItem.quantity,
        };
      case 'ProductItemRemovedFromShoppingCart':
        return {
          ...current,
          productItemsCount:
            current.productItemsCount - event.data.productItem.quantity,
          totalAmount:
            current.totalAmount -
            event.data.productItem.price * event.data.productItem.quantity,
        };
    }
  },
});
// #endregion single-stream-projection
