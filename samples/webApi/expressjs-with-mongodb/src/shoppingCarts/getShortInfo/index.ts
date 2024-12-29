import { pongoSingleStreamProjection } from '@event-driven-io/emmett-postgresql';
import { type PongoDb } from '@event-driven-io/pongo';
import type { ShoppingCartEvent } from '../shoppingCart';

export type ShoppingCartShortInfo = {
  productItemsCount: number;
  totalAmount: number;
};

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
      // delete read model
      return null;
    default:
      return document;
  }
};

export const shoppingCartShortInfoCollectionName = 'shoppingCartShortInfo';

export const getShortInfoById = (
  db: PongoDb,
  shoppingCartId: string,
): Promise<ShoppingCartShortInfo | null> =>
  db
    .collection<ShoppingCartShortInfo>(shoppingCartShortInfoCollectionName)
    .findOne({ _id: shoppingCartId });

export const shoppingCartShortInfoProjection = pongoSingleStreamProjection({
  collectionName: shoppingCartShortInfoCollectionName,
  evolve,
  canHandle: [
    'ProductItemAddedToShoppingCart',
    'ProductItemRemovedFromShoppingCart',
    'ShoppingCartConfirmed',
    'ShoppingCartCancelled',
  ],
  initialState: () => ({ productItemsCount: 0, totalAmount: 0 }),
});
