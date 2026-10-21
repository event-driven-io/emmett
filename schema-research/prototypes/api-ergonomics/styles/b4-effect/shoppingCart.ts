import { Schema } from 'effect';
import { Event, Events } from '../../lib';

/////////////////////////////////////////
////////// Events
/////////////////////////////////////////

// JSON has no Date: ISO 8601 string on the wire, Date in code.
export const isoDate = Schema.DateFromString;

export const ProductItem = Schema.Struct({
  productId: Schema.String,
  quantity: Schema.Number,
});
export type ProductItem = typeof ProductItem.Type;

export const PricedProductItem = Schema.Struct({
  ...ProductItem.fields,
  unitPrice: Schema.Number,
});
export type PricedProductItem = typeof PricedProductItem.Type;

export const ShoppingCartEventMetadata = Schema.toStandardSchemaV1(
  Schema.Struct({
    clientId: Schema.String,
  }),
);
export type ShoppingCartEventMetadata = typeof ShoppingCartEventMetadata.Type;

export const ProductItemAddedToShoppingCart = Event(
  'ProductItemAddedToShoppingCart',
  {
    data: Schema.toStandardSchemaV1(
      Schema.Struct({
        shoppingCartId: Schema.String,
        clientId: Schema.String,
        productItem: PricedProductItem,
        addedAt: isoDate,
      }),
    ),
    metadata: ShoppingCartEventMetadata,
  },
);
export type ProductItemAddedToShoppingCart =
  typeof ProductItemAddedToShoppingCart.Type;

export const ProductItemRemovedFromShoppingCart = Event(
  'ProductItemRemovedFromShoppingCart',
  {
    data: Schema.toStandardSchemaV1(
      Schema.Struct({
        shoppingCartId: Schema.String,
        productItem: PricedProductItem,
        removedAt: isoDate,
      }),
    ),
    metadata: ShoppingCartEventMetadata,
  },
);
export type ProductItemRemovedFromShoppingCart =
  typeof ProductItemRemovedFromShoppingCart.Type;

export const ShoppingCartConfirmed = Event('ShoppingCartConfirmed', {
  data: Schema.toStandardSchemaV1(
    Schema.Struct({
      shoppingCartId: Schema.String,
      confirmedAt: isoDate,
    }),
  ),
  metadata: ShoppingCartEventMetadata,
});
export type ShoppingCartConfirmed = typeof ShoppingCartConfirmed.Type;

export const ShoppingCartCancelled = Event('ShoppingCartCancelled', {
  data: Schema.toStandardSchemaV1(
    Schema.Struct({
      shoppingCartId: Schema.String,
      cancelledAt: isoDate,
    }),
  ),
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
