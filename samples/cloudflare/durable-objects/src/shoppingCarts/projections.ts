import type { ReadEvent } from '@event-driven-io/emmett';
import {
  pongoMultiStreamProjection,
  pongoSingleStreamProjection,
} from '@event-driven-io/emmett-sqlite';
import { clientShoppingCarts, shoppingCarts } from '../pongo.config';
import {
  ProductItems,
  type ClientShoppingCarts,
  type ShoppingCart,
  type ShoppingCartEvent,
} from './shoppingCart';

export const evolveShoppingCart = (
  document: ShoppingCart | null,
  { type, data }: ReadEvent<ShoppingCartEvent>,
): ShoppingCart | null => {
  // Inline projections in emmett-sqlite 0.43.0-beta.48 get metadata.streamPosition
  // relative to the appended batch, so the projection counts the cart events itself.
  // Pongo reads bigint values back as strings, hence BigInt().
  const streamPosition = BigInt(document?.streamPosition ?? 0n) + 1n;

  switch (type) {
    case 'ShoppingCartOpened':
      return {
        _id: data.shoppingCartId,
        clientId: data.clientId,
        productItems: [],
        productItemsCount: 0,
        totalAmount: 0,
        status: 'Opened',
        openedAt: data.openedAt,
        streamPosition,
      };
    case 'ProductItemAddedToShoppingCart':
    case 'ProductItemRemovedFromShoppingCart': {
      if (document === null) return null;

      const { productItem } = data;
      const quantityChange =
        type === 'ProductItemAddedToShoppingCart'
          ? productItem.quantity
          : -productItem.quantity;

      return {
        ...document,
        productItems: ProductItems.withUpdatedQuantity(
          document.productItems,
          productItem,
          quantityChange,
        ),
        productItemsCount: document.productItemsCount + quantityChange,
        totalAmount:
          document.totalAmount + productItem.unitPrice * quantityChange,
        streamPosition,
      };
    }
    case 'ShoppingCartConfirmed':
      return (
        document && {
          ...document,
          status: 'Confirmed',
          confirmedAt: data.confirmedAt,
          streamPosition,
        }
      );
    case 'ShoppingCartCancelled':
      return (
        document && {
          ...document,
          status: 'Cancelled',
          cancelledAt: data.cancelledAt,
          streamPosition,
        }
      );
    default:
      return document;
  }
};

export const evolveClientShoppingCarts = (
  document: ClientShoppingCarts | null,
  { type, data }: ReadEvent<ShoppingCartEvent>,
): ClientShoppingCarts | null => {
  switch (type) {
    case 'ShoppingCartOpened':
      return {
        clientId: data.clientId,
        lastCartNumber: (document?.lastCartNumber ?? 0) + 1,
        lastShoppingCartId: data.shoppingCartId,
        status: 'Opened',
      };
    case 'ShoppingCartConfirmed':
    case 'ShoppingCartCancelled':
      return document && { ...document, status: 'Closed' };
    default:
      return document;
  }
};

export const shoppingCartsProjection = pongoSingleStreamProjection({
  collectionName: shoppingCarts.tableName,
  collectionOptions: { definition: shoppingCarts },
  evolve: evolveShoppingCart,
  canHandle: [
    'ShoppingCartOpened',
    'ProductItemAddedToShoppingCart',
    'ProductItemRemovedFromShoppingCart',
    'ShoppingCartConfirmed',
    'ShoppingCartCancelled',
  ],
});

export const clientShoppingCartsProjection = pongoMultiStreamProjection({
  collectionName: clientShoppingCarts.tableName,
  collectionOptions: { definition: clientShoppingCarts },
  getDocumentId: (event: ReadEvent<ShoppingCartEvent>) =>
    event.metadata.clientId,
  evolve: evolveClientShoppingCarts,
  canHandle: [
    'ShoppingCartOpened',
    'ShoppingCartConfirmed',
    'ShoppingCartCancelled',
  ],
});
