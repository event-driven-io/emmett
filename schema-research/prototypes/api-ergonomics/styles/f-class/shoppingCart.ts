import { EventClass, s } from '../../lib';

/////////////////////////////////////////
////////// Events
/////////////////////////////////////////

export const ProductItem = s.object({
  productId: s.string(),
  quantity: s.number(),
});
export type ProductItem = typeof ProductItem.Type;

export const PricedProductItem = ProductItem.extend({
  unitPrice: s.number(),
});
export type PricedProductItem = typeof PricedProductItem.Type;

export const ShoppingCartEventMetadata = s.object({ clientId: s.string() });
export type ShoppingCartEventMetadata = typeof ShoppingCartEventMetadata.Type;

export class ProductItemAddedToShoppingCart extends EventClass(
  'ProductItemAddedToShoppingCart',
  {
    data: {
      shoppingCartId: s.string(),
      clientId: s.string(),
      productItem: PricedProductItem,
      addedAt: s.date(),
    },
    metadata: ShoppingCartEventMetadata,
  },
) {}

export class ProductItemRemovedFromShoppingCart extends EventClass(
  'ProductItemRemovedFromShoppingCart',
  {
    data: {
      shoppingCartId: s.string(),
      productItem: PricedProductItem,
      removedAt: s.date(),
    },
    metadata: ShoppingCartEventMetadata,
  },
) {}

export class ShoppingCartConfirmed extends EventClass('ShoppingCartConfirmed', {
  data: {
    shoppingCartId: s.string(),
    confirmedAt: s.date(),
  },
  metadata: ShoppingCartEventMetadata,
}) {}

export class ShoppingCartCancelled extends EventClass('ShoppingCartCancelled', {
  data: {
    shoppingCartId: s.string(),
    cancelledAt: s.date(),
  },
  metadata: ShoppingCartEventMetadata,
}) {}

export type ShoppingCartEvent =
  | ProductItemAddedToShoppingCart
  | ProductItemRemovedFromShoppingCart
  | ShoppingCartConfirmed
  | ShoppingCartCancelled;

export const shoppingCartEventTypes = [
  ProductItemAddedToShoppingCart.type,
  ProductItemRemovedFromShoppingCart.type,
  ShoppingCartConfirmed.type,
  ShoppingCartCancelled.type,
];

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
