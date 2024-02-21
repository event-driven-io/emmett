import { merge } from '@event-driven-io/emmett';

export interface ProductItem {
  productId: string;
  quantity: number;
}

export type PricedProductItem = ProductItem & {
  unitPrice: number;
};

export type ShoppingCartEvent =
  | {
      type: 'ShoppingCartOpened';
      data: {
        shoppingCartId: string;
        clientId: string;
        openedAt: Date;
      };
    }
  | {
      type: 'ProductItemAddedToShoppingCart';
      data: {
        shoppingCartId: string;
        productItem: PricedProductItem;
      };
    }
  | {
      type: 'ProductItemRemovedFromShoppingCart';
      data: {
        shoppingCartId: string;
        productItem: PricedProductItem;
      };
    }
  | {
      type: 'ShoppingCartConfirmed';
      data: {
        shoppingCartId: string;
        confirmedAt: Date;
      };
    }
  | {
      type: 'ShoppingCartCanceled';
      data: {
        shoppingCartId: string;
        canceledAt: Date;
      };
    };

export enum ShoppingCartStatus {
  Empty = 'Empty',
  Pending = 'Pending',
  Confirmed = 'Confirmed',
  Canceled = 'Canceled',
}

export type Empty = { status: ShoppingCartStatus.Empty };

export type Pending = {
  status: ShoppingCartStatus.Pending;
  id: string;
  clientId: string;
  productItems: PricedProductItem[];
  openedAt: Date;
};

export type Confirmed = {
  status: ShoppingCartStatus.Confirmed;
  id: string;
  clientId: string;
  productItems: PricedProductItem[];
  confirmedAt: Date;
};

export type Canceled = {
  status: ShoppingCartStatus.Canceled;
  id: string;
  clientId: string;
  productItems: PricedProductItem[];
  canceledAt: Date;
};

export type ShoppingCart = Empty | Pending | Confirmed | Canceled;

export const emptyShoppingCart: Empty = { status: ShoppingCartStatus.Empty };

export const evolve = (
  state: ShoppingCart,
  { type, data: event }: ShoppingCartEvent,
): ShoppingCart => {
  switch (type) {
    case 'ShoppingCartOpened':
      return {
        id: event.shoppingCartId,
        clientId: event.clientId,
        openedAt: event.openedAt,
        productItems: [],
        status: ShoppingCartStatus.Pending,
      };
    case 'ProductItemAddedToShoppingCart': {
      if (state.status !== ShoppingCartStatus.Pending) return state;

      const { productItems } = state;
      const { productItem } = event;

      return {
        ...state,
        productItems: merge(
          productItems,
          productItem,
          (p) =>
            p.productId === productItem.productId &&
            p.unitPrice === productItem.unitPrice,
          (p) => {
            return {
              ...p,
              quantity: p.quantity + productItem.quantity,
            };
          },
          () => productItem,
        ),
      };
    }
    case 'ProductItemRemovedFromShoppingCart': {
      if (state.status !== ShoppingCartStatus.Pending) return state;

      const { productItems } = state;
      const { productItem } = event;
      return {
        ...state,
        productItems: merge(
          productItems,
          productItem,
          (p) =>
            p.productId === productItem.productId &&
            p.unitPrice === productItem.unitPrice,
          (p) => {
            return {
              ...p,
              quantity: p.quantity - productItem.quantity,
            };
          },
        ),
      };
    }
    case 'ShoppingCartConfirmed':
      if (state.status !== ShoppingCartStatus.Pending) return state;

      return {
        ...state,
        status: ShoppingCartStatus.Confirmed,
        confirmedAt: event.confirmedAt,
      };
    case 'ShoppingCartCanceled':
      if (state.status !== ShoppingCartStatus.Pending) return state;

      return {
        ...state,
        status: ShoppingCartStatus.Canceled,
        canceledAt: event.canceledAt,
      };
  }
};

export const getShoppingCart = (events: ShoppingCartEvent[]): ShoppingCart => {
  return events.reduce<ShoppingCart>(evolve, emptyShoppingCart);
};

export const enum ShoppingCartErrors {
  CART_IS_ALREADY_CLOSED = 'CART_IS_ALREADY_CLOSED',
  PRODUCT_ITEM_NOT_FOUND = 'PRODUCT_ITEM_NOT_FOUND',
  CART_IS_EMPTY = 'CART_IS_EMPTY',
  UNKNOWN_EVENT_TYPE = 'UNKNOWN_EVENT_TYPE',
  UNKNOWN_COMMAND_TYPE = 'UNKNOWN_COMMAND_TYPE',
}
