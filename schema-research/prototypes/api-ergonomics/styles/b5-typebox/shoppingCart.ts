import Type, { type Static } from 'typebox';
import { standard } from '../../lib/typebox';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { Event, Events } from '../../lib';

/////////////////////////////////////////
////////// Events
/////////////////////////////////////////

// JSON has no Date: ISO 8601 string on the wire, Date in code.
export const isoDate = Type.Codec(Type.String({ format: 'date-time' }))
  .Decode((iso) => new Date(iso))
  .Encode((date) => date.toISOString());

export const ProductItem = Type.Object({
  productId: Type.String(),
  quantity: Type.Number(),
});
export type ProductItem = Static<typeof ProductItem>;

export const PricedProductItem = Type.Object({
  ...ProductItem.properties,
  unitPrice: Type.Number(),
});
export type PricedProductItem = Static<typeof PricedProductItem>;

export const ShoppingCartEventMetadata = standard(
  Type.Object({
    clientId: Type.String(),
  }),
);
export type ShoppingCartEventMetadata = StandardSchemaV1.InferOutput<
  typeof ShoppingCartEventMetadata
>;

export const ProductItemAddedToShoppingCart = Event(
  'ProductItemAddedToShoppingCart',
  {
    data: standard(
      Type.Object({
        shoppingCartId: Type.String(),
        clientId: Type.String(),
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
    data: standard(
      Type.Object({
        shoppingCartId: Type.String(),
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
  data: standard(
    Type.Object({
      shoppingCartId: Type.String(),
      confirmedAt: isoDate,
    }),
  ),
  metadata: ShoppingCartEventMetadata,
});
export type ShoppingCartConfirmed = typeof ShoppingCartConfirmed.Type;

export const ShoppingCartCancelled = Event('ShoppingCartCancelled', {
  data: standard(
    Type.Object({
      shoppingCartId: Type.String(),
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
