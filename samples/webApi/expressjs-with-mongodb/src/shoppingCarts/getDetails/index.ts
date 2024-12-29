import { merge } from '@event-driven-io/emmett';
import {
  mongoDBInlineProjection,
  type MongoDBEventStore,
} from '@event-driven-io/emmett-mongodb';
import type {
  PricedProductItem,
  ShoppingCartEvent,
  ShoppingCartId,
} from '../shoppingCart';

export type ShoppingCartDetails = {
  id: string;
  clientId: string;
  productItems: PricedProductItem[];
  productItemsCount: number;
  totalAmount: number;
  status: 'Opened' | 'Confirmed' | 'Cancelled';
  openedAt: Date;
  confirmedAt?: Date | undefined;
  cancelledAt?: Date | undefined;
};

const evolve = (
  documentFromDb: ShoppingCartDetails | null,
  { type, data: event }: ShoppingCartEvent,
): ShoppingCartDetails | null => {
  switch (type) {
    case 'ProductItemAddedToShoppingCart': {
      const document = documentFromDb ?? {
        id: event.shoppingCartId,
        status: 'Opened',
        productItems: [],
        totalAmount: 0,
        productItemsCount: 0,
      };

      const {
        productItem,
        productItem: { productId, quantity, unitPrice },
        clientId,
      } = event;

      return {
        ...document,
        openedAt: 'openedAt' in document ? document.openedAt : event.addedAt,
        clientId: clientId,
        productItems: merge(
          document.productItems,
          event.productItem,
          (p) => p.productId === productId && p.unitPrice === unitPrice,
          (p) => {
            return {
              ...p,
              quantity: p.quantity + quantity,
            };
          },
          () => productItem,
        ),
        totalAmount:
          document.totalAmount +
          event.productItem.unitPrice * event.productItem.quantity,
        productItemsCount:
          document?.productItemsCount + event.productItem.quantity,
      };
    }
    case 'ProductItemRemovedFromShoppingCart': {
      const {
        productItem,
        productItem: { productId, quantity, unitPrice },
      } = event;

      return {
        ...documentFromDb!,
        productItems: merge(
          documentFromDb!.productItems,
          productItem,
          (p) => p.productId === productId && p.unitPrice === unitPrice,
          (p) => {
            return {
              ...p,
              quantity: p.quantity - quantity,
            };
          },
        ),
        totalAmount:
          documentFromDb!.totalAmount -
          event.productItem.unitPrice * event.productItem.quantity,
        productItemsCount:
          documentFromDb!.productItemsCount - event.productItem.quantity,
      };
    }
    case 'ShoppingCartConfirmed':
      return {
        ...documentFromDb!,
        status: 'Confirmed',
      };
    case 'ShoppingCartCancelled':
      return {
        ...documentFromDb!,
        status: 'Cancelled',
      };
    default:
      return documentFromDb;
  }
};

export const shoppingCartDetailsCollectionName = 'shoppingCartDetails';

export const getDetailsById = (
  db: MongoDBEventStore,
  shoppingCartId: ShoppingCartId,
): Promise<ShoppingCartDetails | null> =>
  db.projections.inline.findOne({ streamName: shoppingCartId });

export const shoppingCartDetailsProjection = mongoDBInlineProjection({
  evolve,
  canHandle: [
    'ProductItemAddedToShoppingCart',
    'ProductItemRemovedFromShoppingCart',
    'ShoppingCartConfirmed',
    'ShoppingCartCancelled',
  ],
});
