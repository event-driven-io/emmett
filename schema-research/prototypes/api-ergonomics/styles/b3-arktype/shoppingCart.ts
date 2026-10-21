import { type } from 'arktype';
import { Event, Events } from '../../lib';

/////////////////////////////////////////
////////// Events
/////////////////////////////////////////

// JSON has no Date: ISO 8601 string on the wire, Date in code.
export const isoDate = type('string.date.iso.parse');

export const ProductItem = type({
  productId: 'string',
  quantity: 'number',
});
export type ProductItem = typeof ProductItem.infer;

export const PricedProductItem = ProductItem.merge({
  unitPrice: 'number',
});
export type PricedProductItem = typeof PricedProductItem.infer;

export const ShoppingCartEventMetadata = type({
  clientId: 'string',
});
export type ShoppingCartEventMetadata = typeof ShoppingCartEventMetadata.infer;

export const ProductItemAddedToShoppingCart = Event(
  'ProductItemAddedToShoppingCart',
  {
    data: type({
      shoppingCartId: 'string',
      clientId: 'string',
      productItem: PricedProductItem,
      addedAt: isoDate,
    }),
    metadata: ShoppingCartEventMetadata,
  },
);
export type ProductItemAddedToShoppingCart =
  typeof ProductItemAddedToShoppingCart.Type;

export const ProductItemRemovedFromShoppingCart = Event(
  'ProductItemRemovedFromShoppingCart',
  {
    data: type({
      shoppingCartId: 'string',
      productItem: PricedProductItem,
      removedAt: isoDate,
    }),
    metadata: ShoppingCartEventMetadata,
  },
);
export type ProductItemRemovedFromShoppingCart =
  typeof ProductItemRemovedFromShoppingCart.Type;

export const ShoppingCartConfirmed = Event('ShoppingCartConfirmed', {
  data: type({
    shoppingCartId: 'string',
    confirmedAt: isoDate,
  }),
  metadata: ShoppingCartEventMetadata,
});
export type ShoppingCartConfirmed = typeof ShoppingCartConfirmed.Type;

export const ShoppingCartCancelled = Event('ShoppingCartCancelled', {
  data: type({
    shoppingCartId: 'string',
    cancelledAt: isoDate,
  }),
  metadata: ShoppingCartEventMetadata,
});
export type ShoppingCartCancelled = typeof ShoppingCartCancelled.Type;

export const ShoppingCartEvent = Events(
  ProductItemAddedToShoppingCart,
  ProductItemRemovedFromShoppingCart,
  ShoppingCartConfirmed,
  ShoppingCartCancelled,
);
export type ShoppingCartEvent = typeof ShoppingCartEvent.Type;

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
  EmptyShoppingCart | OpenedShoppingCart | ClosedShoppingCart;

export type ProductItems = Map<string, number>;

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
