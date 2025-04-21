import { type Event, type ReadEvent } from '../typing';

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
export type DiscountApplied = Event<
  'DiscountApplied',
  { percent: number; couponId: string }
>;
export type ShoppingCartConfirmed = Event<
  'ShoppingCartConfirmed',
  { confirmedAt: Date }
>;

export type ShoppingCartEvent =
  | ProductItemAdded
  | DiscountApplied
  | ShoppingCartConfirmed;

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
        totalAmount: state.totalAmount * (1 - data.percent / 100),
      };
    case 'ShoppingCartConfirmed':
      return state;
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
    case 'ShoppingCartConfirmed':
      return state;
  }
};

export const initialState = (): ShoppingCart => {
  return { productItems: [], totalAmount: 0 };
};
