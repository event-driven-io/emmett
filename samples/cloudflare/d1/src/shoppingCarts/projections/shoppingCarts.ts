import type { ReadEvent } from '@event-driven-io/emmett';
import {
  pongoSingleStreamProjection,
  type SQLiteReadEventMetadata,
} from '@event-driven-io/emmett-sqlite';
import { shoppingCartsCollection } from '../../pongo.config';
import { ProductItems, type ShoppingCartEvent } from '../shoppingCart';

export type ShoppingCart = {
  _id: string;
  clientId: string;
  productItems: ProductItems;
  productItemsCount: number;
  totalAmount: number;
  status: 'Opened' | 'Confirmed' | 'Cancelled';
  openedAt: Date;
  confirmedAt?: Date;
  cancelledAt?: Date;
  streamPosition: bigint;
};

export const evolve = (
  document: ShoppingCart | null,
  {
    type,
    data,
    metadata: { streamPosition },
  }: ReadEvent<ShoppingCartEvent, SQLiteReadEventMetadata>,
): ShoppingCart | null => {
  if (type === 'ShoppingCartOpened')
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

  if (document === null) return null;

  switch (type) {
    case 'ProductItemAddedToShoppingCart':
    case 'ProductItemRemovedFromShoppingCart': {
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
      return {
        ...document,
        status: 'Confirmed',
        confirmedAt: data.confirmedAt,
        streamPosition,
      };
    case 'ShoppingCartCancelled':
      return {
        ...document,
        status: 'Cancelled',
        cancelledAt: data.cancelledAt,
        streamPosition,
      };
  }
};

export const shoppingCartsProjection = pongoSingleStreamProjection({
  collectionName: shoppingCartsCollection.tableName,
  collectionOptions: { definition: shoppingCartsCollection },
  evolve,
  canHandle: [
    'ShoppingCartOpened',
    'ProductItemAddedToShoppingCart',
    'ProductItemRemovedFromShoppingCart',
    'ShoppingCartConfirmed',
    'ShoppingCartCancelled',
  ],
});
