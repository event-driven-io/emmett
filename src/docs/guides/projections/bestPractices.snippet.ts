/* eslint-disable @typescript-eslint/no-unused-vars */
import type { Event } from '@event-driven-io/emmett';
import { pongoSingleStreamProjection } from '@event-driven-io/emmett-postgresql';

type ProductItemAddedToShoppingCart = Event<
  'ProductItemAddedToShoppingCart',
  {
    shoppingCartId: string;
    productItem: { productId: string; quantity: number; unitPrice: number };
    addedAt: Date;
  }
>;

type ProductItemRemovedFromShoppingCart = Event<
  'ProductItemRemovedFromShoppingCart',
  {
    shoppingCartId: string;
    productItem: { productId: string; quantity: number; unitPrice: number };
    removedAt: Date;
  }
>;

type ShoppingCartConfirmed = Event<
  'ShoppingCartConfirmed',
  {
    shoppingCartId: string;
    totalAmount: number;
    confirmedAt: Date;
  }
>;

type ShoppingCartEvent =
  | ProductItemAddedToShoppingCart
  | ProductItemRemovedFromShoppingCart
  | ShoppingCartConfirmed;

// #region one-per-query
// Read model for the menu bar: just count and total
type CartSummary = {
  productItemsCount: number;
  totalAmount: number;
};

const cartSummaryProjection = pongoSingleStreamProjection({
  collectionName: 'cart_summaries',
  canHandle: [
    'ProductItemAddedToShoppingCart',
    'ProductItemRemovedFromShoppingCart',
  ],
  evolve: (
    document: CartSummary,
    { type, data: event }: ShoppingCartEvent,
  ): CartSummary => {
    switch (type) {
      case 'ProductItemAddedToShoppingCart':
        return {
          productItemsCount:
            document.productItemsCount + event.productItem.quantity,
          totalAmount:
            document.totalAmount +
            event.productItem.unitPrice * event.productItem.quantity,
        };
      case 'ProductItemRemovedFromShoppingCart':
        return {
          productItemsCount:
            document.productItemsCount - event.productItem.quantity,
          totalAmount:
            document.totalAmount -
            event.productItem.unitPrice * event.productItem.quantity,
        };
      default:
        return document;
    }
  },
  initialState: () => ({ productItemsCount: 0, totalAmount: 0 }),
});

// Read model for the cart detail page: full product list
type CartDetails = {
  productItems: Map<
    string,
    { productId: string; quantity: number; unitPrice: number }
  >;
  status: 'open' | 'confirmed';
  confirmedAt: Date | null;
};

const cartDetailsProjection = pongoSingleStreamProjection({
  collectionName: 'cart_details',
  canHandle: [
    'ProductItemAddedToShoppingCart',
    'ProductItemRemovedFromShoppingCart',
    'ShoppingCartConfirmed',
  ],
  evolve: (
    document: CartDetails,
    { type, data: event }: ShoppingCartEvent,
  ): CartDetails => {
    switch (type) {
      case 'ProductItemAddedToShoppingCart': {
        const existing = document.productItems.get(event.productItem.productId);
        document.productItems.set(event.productItem.productId, {
          productId: event.productItem.productId,
          unitPrice: event.productItem.unitPrice,
          quantity: (existing?.quantity ?? 0) + event.productItem.quantity,
        });
        return document;
      }
      case 'ProductItemRemovedFromShoppingCart': {
        const existing = document.productItems.get(event.productItem.productId);
        if (existing) {
          existing.quantity -= event.productItem.quantity;
          if (existing.quantity <= 0) {
            document.productItems.delete(event.productItem.productId);
          }
        }
        return document;
      }
      case 'ShoppingCartConfirmed':
        return {
          ...document,
          status: 'confirmed',
          confirmedAt: event.confirmedAt,
        };
      default:
        return document;
    }
  },
  initialState: () => ({
    productItems: new Map(),
    status: 'open' as const,
    confirmedAt: null,
  }),
});
// #endregion one-per-query
