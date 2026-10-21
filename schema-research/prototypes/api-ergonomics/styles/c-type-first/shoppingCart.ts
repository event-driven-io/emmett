import { Event, Events, s } from '../../lib';

/////////////////////////////////////////
////////// Events
/////////////////////////////////////////

export type ShoppingCartEventMetadata = { clientId: string };
export const ShoppingCartEventMetadata = { clientId: s.string() };

export interface ProductItem {
  productId: string;
  quantity: number;
}
export const ProductItem = s.object({
  productId: s.string(),
  quantity: s.number(),
});

export type PricedProductItem = ProductItem & {
  unitPrice: number;
};
export const PricedProductItem = ProductItem.extend({
  unitPrice: s.number(),
});

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
export const ProductItemAddedToShoppingCart =
  Event<ProductItemAddedToShoppingCart>('ProductItemAddedToShoppingCart', {
    data: {
      shoppingCartId: s.string(),
      clientId: s.string(),
      productItem: PricedProductItem,
      addedAt: s.date(),
    },
    metadata: ShoppingCartEventMetadata,
  });

export type ProductItemRemovedFromShoppingCart = Event<
  'ProductItemRemovedFromShoppingCart',
  {
    shoppingCartId: string;
    productItem: PricedProductItem;
    removedAt: Date;
  },
  ShoppingCartEventMetadata
>;
export const ProductItemRemovedFromShoppingCart =
  Event<ProductItemRemovedFromShoppingCart>(
    'ProductItemRemovedFromShoppingCart',
    {
      data: {
        shoppingCartId: s.string(),
        productItem: PricedProductItem,
        removedAt: s.date(),
      },
      metadata: ShoppingCartEventMetadata,
    },
  );

export type ShoppingCartConfirmed = Event<
  'ShoppingCartConfirmed',
  {
    shoppingCartId: string;
    confirmedAt: Date;
  },
  ShoppingCartEventMetadata
>;
export const ShoppingCartConfirmed = Event<ShoppingCartConfirmed>(
  'ShoppingCartConfirmed',
  {
    data: { shoppingCartId: s.string(), confirmedAt: s.date() },
    metadata: ShoppingCartEventMetadata,
  },
);

export type ShoppingCartCancelled = Event<
  'ShoppingCartCancelled',
  {
    shoppingCartId: string;
    cancelledAt: Date;
  },
  ShoppingCartEventMetadata
>;
export const ShoppingCartCancelled = Event<ShoppingCartCancelled>(
  'ShoppingCartCancelled',
  {
    data: { shoppingCartId: s.string(), cancelledAt: s.date() },
    metadata: ShoppingCartEventMetadata,
  },
);

export type ShoppingCartEvent =
  | ProductItemAddedToShoppingCart
  | ProductItemRemovedFromShoppingCart
  | ShoppingCartConfirmed
  | ShoppingCartCancelled;
export const ShoppingCartEvent = Events(
  ProductItemAddedToShoppingCart,
  ProductItemRemovedFromShoppingCart,
  ShoppingCartConfirmed,
  ShoppingCartCancelled,
);

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
