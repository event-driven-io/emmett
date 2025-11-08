import {
  assertNotEqual,
  STREAM_DOES_NOT_EXIST,
  type Event,
  type ReadEvent,
} from '@event-driven-io/emmett';
import { v7 as uuid } from 'uuid';
import {
  MongoDBEventStoreDefaultStreamVersion,
  toStreamName,
  type MongoDBEventStore,
  type StreamType,
} from '../eventStore';

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
export type DeletedShoppingCart = Event<
  'DeletedShoppingCart',
  { deletedAt: Date; reason: string }
>;

export type ShoppingCartEvent =
  | ProductItemAdded
  | DiscountApplied
  | ShoppingCartConfirmed
  | DeletedShoppingCart;

export const evolve = (
  state: ShoppingCart,
  { type, data }: ShoppingCartEvent,
): ShoppingCart | null => {
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
    case 'DeletedShoppingCart':
      return null;
  }
};

export const evolveWithMetadata = (
  state: ShoppingCart,
  { type, data }: ReadEvent<ShoppingCartEvent>,
): ShoppingCart | null => {
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
    case 'DeletedShoppingCart':
      return null;
  }
};

export const initialState = (): ShoppingCart => {
  return { productItems: [], totalAmount: 0 };
};

export const ShoppingCartStreamType: StreamType = 'shopping_cart';

export const assertCanAppend = async (eventStore: MongoDBEventStore) => {
  const productItem: PricedProductItem = {
    productId: '123',
    quantity: 10,
    price: 3,
  };
  const shoppingCartId = uuid();
  const streamName = toStreamName(ShoppingCartStreamType, shoppingCartId);

  const result = await eventStore.appendToStream<ShoppingCartEvent>(
    streamName,
    [{ type: 'ProductItemAdded', data: { productItem } }],
    { expectedStreamVersion: STREAM_DOES_NOT_EXIST },
  );

  assertNotEqual(
    result.nextExpectedStreamVersion,
    MongoDBEventStoreDefaultStreamVersion,
  );
};
