import type { Event } from '@event-driven-io/emmett';

/////////////////////////////////////////
////////// Events
/////////////////////////////////////////

export type ShoppingCartEventMetadata = { clientId: string };

export type ProductItemAddedToShoppingCart = Event<
  'ProductItemAddedToShoppingCart',
  {
    shoppingCartId: string;
    clientId: string;
    productItem: PricedProductItem;
    addedAt: Date;
  },
  ShoppingCartEventMetadata
>;

export type ProductItemRemovedFromShoppingCart = Event<
  'ProductItemRemovedFromShoppingCart',
  {
    shoppingCartId: string;
    productItem: PricedProductItem;
    removedAt: Date;
  },
  ShoppingCartEventMetadata
>;

export type ShoppingCartConfirmed = Event<
  'ShoppingCartConfirmed',
  {
    shoppingCartId: string;
    confirmedAt: Date;
  },
  ShoppingCartEventMetadata
>;

export type ShoppingCartCancelled = Event<
  'ShoppingCartCancelled',
  {
    shoppingCartId: string;
    cancelledAt: Date;
  },
  ShoppingCartEventMetadata
>;

export type ShoppingCartEvent =
  | ProductItemAddedToShoppingCart
  | ProductItemRemovedFromShoppingCart
  | ShoppingCartConfirmed
  | ShoppingCartCancelled;

export interface ProductItem {
  productId: string;
  quantity: number;
}

export type PricedProductItem = ProductItem & {
  unitPrice: number;
};

/////////////////////////////////////////
////////// Shopping Cart
/////////////////////////////////////////

export type ProductItemState = {
  quantity: number;
  unitPrice: number;
};

export type EmptyShoppingCart = {
  status: 'Empty';
};

export type OpenedShoppingCart = {
  status: 'Opened';
  productItems: Map<string, ProductItemState>;
};

export type ClosedShoppingCart = {
  status: 'Closed';
};

export type ShoppingCart =
  | EmptyShoppingCart
  | OpenedShoppingCart
  | ClosedShoppingCart;

export const initialState = (): ShoppingCart => {
  return {
    status: 'Empty',
  };
};

/////////////////////////////////////////
////////// Evolve
/////////////////////////////////////////

export const evolve = (
  state: ShoppingCart,
  event: ShoppingCartEvent,
): ShoppingCart => {
  const { type, data } = event;

  switch (type) {
    case 'ProductItemAddedToShoppingCart':
    case 'ProductItemRemovedFromShoppingCart': {
      if (state.status !== 'Opened' && state.status !== 'Empty') return state;

      const {
        productItem: { productId, quantity, unitPrice },
      } = data;

      const productItems =
        state.status === 'Opened'
          ? state.productItems
          : new Map<string, ProductItemState>();

      const plusOrMinus = type == 'ProductItemAddedToShoppingCart' ? 1 : -1;

      return {
        status: 'Opened',
        productItems: withUpdatedQuantity(
          productItems,
          productId,
          plusOrMinus * quantity,
          unitPrice,
        ),
      };
    }
    case 'ShoppingCartConfirmed':
    case 'ShoppingCartCancelled':
      return { status: 'Closed' };

    default:
      return state;
  }
};

const withUpdatedQuantity = (
  current: Map<string, ProductItemState>,
  productId: string,
  quantity: number,
  unitPrice: number,
) => {
  const productItems = new Map(current);
  const existing = productItems.get(productId);
  const currentQuantity = existing?.quantity ?? 0;

  productItems.set(productId, {
    quantity: currentQuantity + quantity,
    unitPrice,
  });

  return productItems;
};
