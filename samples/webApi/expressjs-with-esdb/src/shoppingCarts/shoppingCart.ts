import type { Event } from '@event-driven-io/emmett';

/////////////////////////////////////////
////////// Events
/////////////////////////////////////////

export type ProductItemAddedToShoppingCart = Event<
  'ProductItemAddedToShoppingCart',
  {
    shoppingCartId: string;
    productItem: PricedProductItem;
    addedAt: Date;
  }
>;

export type ProductItemRemovedFromShoppingCart = Event<
  'ProductItemRemovedFromShoppingCart',
  {
    shoppingCartId: string;
    productItem: PricedProductItem;
    removedAt: Date;
  }
>;

export type ShoppingCartConfirmed = Event<
  'ShoppingCartConfirmed',
  {
    shoppingCartId: string;
    confirmedAt: Date;
  }
>;

export type ShoppingCartCancelled = Event<
  'ShoppingCartCancelled',
  {
    shoppingCartId: string;
    canceledAt: Date;
  }
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

export type EmptyShoppingCart = {
  status: 'Empty';
};

export type OpenedShoppingCart = {
  status: 'Opened';

  productItems: ProductItems;
};

export type ClosedShoppingCart = {
  status: 'Closed';
};

export type ShoppingCart =
  | EmptyShoppingCart
  | OpenedShoppingCart
  | ClosedShoppingCart;

export type ProductItems = Map<string, number>;

export const getInitialState = (): ShoppingCart => {
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
        productItem: { productId, quantity },
      } = data;

      const productItems =
        state.status === 'Opened'
          ? state.productItems
          : new Map<string, number>();

      const plusOrMinus = type == 'ProductItemAddedToShoppingCart' ? 1 : -1;

      return {
        status: 'Opened',
        productItems: withUpdatedQuantity(
          productItems,
          productId,
          plusOrMinus * quantity,
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
  current: ProductItems,
  productId: string,
  quantity: number,
) => {
  const productItems = new Map(current);
  const currentQuantity = productItems.get(productId) ?? 0;

  productItems.set(productId, currentQuantity + quantity);

  return productItems;
};
