import type { Command, Event, ReadEvent } from '@event-driven-io/emmett';

export type PricedProductItem = {
  productId: string;
  quantity: number;
  price: number;
};

export type ShoppingCart = {
  productItems: PricedProductItem[];
  totalAmount: number;
};

export type ProductItemAdded = Event<
  'ProductItemAdded',
  { productItem: PricedProductItem }
>;
export type ProductItemAddedV2 = Event<
  'ProductItemAdded',
  { productItem: PricedProductItem; currency: string },
  undefined,
  2
>;
export type ProductItemAddedV3 = Event<
  'ProductItemAdded',
  { productItem: PricedProductItem; currency: string; addedBy: string },
  undefined,
  3
>;
export type ProductItemAddedV2WithTenant = Event<
  'ProductItemAdded',
  { productItem: PricedProductItem; currency: string },
  { tenantId: string },
  2
>;
export type DiscountApplied = Event<
  'DiscountApplied',
  { percent: number; couponId: string }
>;

export type ShoppingCartEvent = ProductItemAdded | DiscountApplied;

export const evolve = (
  state: ShoppingCart,
  { type, data }: ShoppingCartEvent,
): ShoppingCart => {
  switch (type) {
    case 'ProductItemAdded': {
      const productItem = data.productItem;
      return {
        productItems: [...state.productItems, productItem],
        totalAmount:
          state.totalAmount + productItem.price * productItem.quantity,
      };
    }
    case 'DiscountApplied':
      return {
        ...state,
        totalAmount: Math.max(state.totalAmount * (1 - data.percent / 100), 0),
      };
  }
};

export const evolveWithMetadata = (
  state: ShoppingCart,
  { type, data }: ReadEvent<ShoppingCartEvent>,
): ShoppingCart => {
  switch (type) {
    case 'ProductItemAdded': {
      const productItem = data.productItem;
      return {
        productItems: [...state.productItems, productItem],
        totalAmount:
          state.totalAmount + productItem.price * productItem.quantity,
      };
    }
    case 'DiscountApplied':
      return {
        ...state,
        totalAmount: state.totalAmount * (1 - data.percent / 100),
      };
  }
};

export const initialState = (): ShoppingCart => {
  return { productItems: [], totalAmount: 0 };
};
export type AddProductItem = Event<
  'AddProductItem',
  { productItem: PricedProductItem }
>;

export const addProductItem = (
  command: AddProductItem,
  _state: ShoppingCart,
): ShoppingCartEvent => {
  return {
    type: 'ProductItemAdded',
    data: { productItem: command.data.productItem },
  };
};

export type AddProductItemV2 = Command<
  'AddProductItem',
  { productItem: PricedProductItem; currency: string },
  undefined,
  2
>;
