import { pongoSingleProjection } from '@event-driven-io/emmett-postgresql';
import type {
  ProductItemAddedToShoppingCart,
  ProductItemRemovedFromShoppingCart,
} from '../shoppingCart';

type ShoppingCartShortInfo = {
  productItemsCount: number;
  totalAmount: number;
};

const shoppingCartShortInfoCollectionName = 'shoppingCartShortInfo';

const evolve = (
  document: ShoppingCartShortInfo | null,
  {
    type,
    data: event,
  }: ProductItemAddedToShoppingCart | ProductItemRemovedFromShoppingCart,
): ShoppingCartShortInfo => {
  document = document ?? { productItemsCount: 0, totalAmount: 0 };

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
};

export const shoppingCartShortInfoProjection = pongoSingleProjection(
  shoppingCartShortInfoCollectionName,
  evolve,
  'ProductItemAddedToShoppingCart',
  'ProductItemRemovedFromShoppingCart',
);
