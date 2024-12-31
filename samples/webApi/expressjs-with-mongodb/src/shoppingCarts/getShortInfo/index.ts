import {
  mongoDBInlineProjection,
  type MongoDBEventStore,
} from '@event-driven-io/emmett-mongodb';
import type { ShoppingCartEvent, ShoppingCartId } from '../shoppingCart';

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

export const shoppingCartShortInfoProjectionName = 'shoppingCartShortInfo';

export const getShortInfoById = (
  db: MongoDBEventStore,
  shoppingCartId: ShoppingCartId,
): Promise<ShoppingCartShortInfo | null> =>
  db.projections.inline.findOne({
    streamName: shoppingCartId,
    projectionName: shoppingCartShortInfoProjectionName,
  });

export const shoppingCartShortInfoProjection = mongoDBInlineProjection({
  name: shoppingCartShortInfoProjectionName,
  evolve,
  canHandle: [
    'ProductItemAddedToShoppingCart',
    'ProductItemRemovedFromShoppingCart',
    'ShoppingCartConfirmed',
    'ShoppingCartCancelled',
  ],
  initialState: () => ({ productItemsCount: 0, totalAmount: 0 }),
});
