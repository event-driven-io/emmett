/* eslint-disable @typescript-eslint/no-unused-vars */
import type { Event } from '@event-driven-io/emmett';
import {
  pongoMultiStreamProjection,
  pongoSingleStreamProjection,
} from '@event-driven-io/emmett-postgresql';

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
  },
  {
    clientId: string;
  }
>;

type ShoppingCartCancelled = Event<
  'ShoppingCartCancelled',
  {
    shoppingCartId: string;
    cancelledAt: Date;
  },
  {
    clientId: string;
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

// #region can-handle
const shoppingCartShortInfoProjection = pongoSingleStreamProjection({
  collectionName: 'shoppingCartShortInfo',
  // Only events listed here will reach the evolve function.
  // All other event types in the stream are ignored.
  canHandle: [
    'ProductItemAddedToShoppingCart',
    'ProductItemRemovedFromShoppingCart',
    'ShoppingCartConfirmed',
    'ShoppingCartCancelled',
  ],
  evolve: (
    document: ShoppingCartShortInfo,
    { type, data: event }: ShoppingCartEvent,
  ): ShoppingCartShortInfo => {
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
      default:
        return document;
    }
  },
  initialState: () => ({ productItemsCount: 0, totalAmount: 0 }),
});
// #endregion can-handle

// #region versioning
const cartSummariesV2 = pongoSingleStreamProjection({
  collectionName: 'cart_summaries_v2',
  evolve: (
    document: ShoppingCartShortInfo,
    { type, data: event }: ShoppingCartEvent,
  ): ShoppingCartShortInfo => {
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
      default:
        return document;
    }
  },
  canHandle: [
    'ProductItemAddedToShoppingCart',
    'ProductItemRemovedFromShoppingCart',
  ],
  initialState: () => ({ productItemsCount: 0, totalAmount: 0 }),
});
// #endregion versioning

type ClientShoppingSummary = {
  clientId: string;
  totalOrders: number;
  totalSpent: number;
};

// #region metadata-usage
const clientShoppingSummaryProjection = pongoMultiStreamProjection({
  collectionName: 'clientShoppingSummary',
  // Use event metadata to route events from different streams
  // into the same document, grouped by client
  getDocumentId: (event) => event.metadata.clientId,
  canHandle: ['ShoppingCartConfirmed'],
  evolve: (
    document: ClientShoppingSummary,
    event: ShoppingCartConfirmed,
  ): ClientShoppingSummary => ({
    ...document,
    clientId: event.metadata.clientId,
    totalOrders: document.totalOrders + 1,
    totalSpent: document.totalSpent + event.data.totalAmount,
  }),
  initialState: () => ({
    clientId: '',
    totalOrders: 0,
    totalSpent: 0,
  }),
});
// #endregion metadata-usage
