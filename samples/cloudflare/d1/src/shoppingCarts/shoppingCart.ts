import type { Event } from '@event-driven-io/emmett';

export type ShoppingCartEventMetadata = { clientId: string };

export type ShoppingCartOpened = Event<
  'ShoppingCartOpened',
  { shoppingCartId: string; clientId: string; openedAt: Date },
  ShoppingCartEventMetadata
>;

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
  { shoppingCartId: string; productItem: PricedProductItem; removedAt: Date },
  ShoppingCartEventMetadata
>;

export type ShoppingCartConfirmed = Event<
  'ShoppingCartConfirmed',
  { shoppingCartId: string; confirmedAt: Date },
  ShoppingCartEventMetadata
>;

export type ShoppingCartCancelled = Event<
  'ShoppingCartCancelled',
  { shoppingCartId: string; cancelledAt: Date },
  ShoppingCartEventMetadata
>;

export type ShoppingCartEvent =
  | ShoppingCartOpened
  | ProductItemAddedToShoppingCart
  | ProductItemRemovedFromShoppingCart
  | ShoppingCartConfirmed
  | ShoppingCartCancelled;

export type ProductItem = Readonly<{
  productId: string;
  quantity: number;
}>;

export type PricedProductItem = Readonly<
  ProductItem & {
    unitPrice: number;
  }
>;

export type ProductItems = ReadonlyArray<PricedProductItem>;

const findProductItem = (
  productItems: ProductItems,
  productId: string,
): PricedProductItem | undefined =>
  productItems.find((productItem) => productItem.productId === productId);

export const ProductItems = {
  find: findProductItem,

  withUpdatedQuantity(
    productItems: ProductItems,
    productItem: PricedProductItem,
    quantityChange: number,
  ): ProductItems {
    const currentProductItem = findProductItem(
      productItems,
      productItem.productId,
    );

    if (!currentProductItem)
      return [...productItems, { ...productItem, quantity: quantityChange }];

    const quantity = currentProductItem.quantity + quantityChange;
    if (quantity === 0)
      return productItems.filter(
        ({ productId }) => productId !== productItem.productId,
      );

    return productItems.map((current) => {
      if (current.productId !== productItem.productId) return current;

      return { ...current, quantity };
    });
  },
};

export type ShoppingCart =
  | { status: 'Empty' }
  | {
      status: 'Opened';
      productItems: ProductItems;
      productItemsCount: number;
    }
  | { status: 'Confirmed' }
  | { status: 'Cancelled' };

export const initialState = (): ShoppingCart => ({ status: 'Empty' });

export const shoppingCartIdFor = (clientId: string, cartNumber: number) =>
  `shopping_cart-${clientId}:${cartNumber}`;

export const evolve = (
  state: ShoppingCart,
  { type, data }: ShoppingCartEvent,
): ShoppingCart => {
  switch (type) {
    case 'ShoppingCartOpened':
      return { status: 'Opened', productItems: [], productItemsCount: 0 };
    case 'ProductItemAddedToShoppingCart':
    case 'ProductItemRemovedFromShoppingCart': {
      if (state.status !== 'Opened') return state;

      const quantityChange =
        type === 'ProductItemAddedToShoppingCart'
          ? data.productItem.quantity
          : -data.productItem.quantity;

      return {
        status: 'Opened',
        productItems: ProductItems.withUpdatedQuantity(
          state.productItems,
          data.productItem,
          quantityChange,
        ),
        productItemsCount: state.productItemsCount + quantityChange,
      };
    }
    case 'ShoppingCartConfirmed':
      return { status: 'Confirmed' };
    case 'ShoppingCartCancelled':
      return { status: 'Cancelled' };
    default: {
      const _notExistingEventType: never = type;
      return state;
    }
  }
};
