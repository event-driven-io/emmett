import { describe, it } from 'vitest';

// #region imports
import {
  DeciderSpecification,
  type Command,
  type Event,
} from '@event-driven-io/emmett';
// #endregion imports

type PricedProductItem = { productId: string; quantity: number; price: number };

type ProductItemAdded = Event<
  'ProductItemAdded',
  { shoppingCartId: string; productItem: PricedProductItem }
>;
type ProductItemOutOfStock = Event<
  'ProductItemOutOfStock',
  {
    shoppingCartId: string;
    productId: string;
    requestedQuantity: number;
    availableQuantity: number;
    attemptedAt: Date;
  }
>;
type CouponApplied = Event<
  'CouponApplied',
  {
    shoppingCartId: string;
    couponCode: string;
    discountAmount: number;
    appliedAt: Date;
  }
>;
type CouponExpired = Event<
  'CouponExpired',
  {
    shoppingCartId: string;
    couponCode: string;
    expiredAt: Date;
    attemptedAt: Date;
  }
>;
type CouponAlreadyUsed = Event<
  'CouponAlreadyUsed',
  {
    shoppingCartId: string;
    couponCode: string;
    appliedAt: Date;
    attemptedAt: Date;
  }
>;
type CartBelowCouponMinimum = Event<
  'CartBelowCouponMinimum',
  {
    shoppingCartId: string;
    couponCode: string;
    cartAmount: number;
    minimumAmount: number;
    attemptedAt: Date;
  }
>;

type ShoppingCartEvent =
  | ProductItemAdded
  | ProductItemOutOfStock
  | CouponApplied
  | CouponExpired
  | CouponAlreadyUsed
  | CartBelowCouponMinimum;

type ShoppingCart = {
  totalAmount: number;
  appliedCoupons: { code: string; appliedAt: Date }[];
};

const evolve = (
  state: ShoppingCart,
  { type, data }: ShoppingCartEvent,
): ShoppingCart => {
  switch (type) {
    case 'ProductItemAdded':
      return {
        ...state,
        totalAmount:
          state.totalAmount +
          data.productItem.price * data.productItem.quantity,
      };
    case 'CouponApplied':
      return {
        ...state,
        totalAmount: state.totalAmount - data.discountAmount,
        appliedCoupons: [
          ...state.appliedCoupons,
          { code: data.couponCode, appliedAt: data.appliedAt },
        ],
      };
    // the failure events record what was attempted without changing the cart
    case 'ProductItemOutOfStock':
    case 'CouponExpired':
    case 'CouponAlreadyUsed':
    case 'CartBelowCouponMinimum':
      return state;
  }
};

const initialState = (): ShoppingCart => ({
  totalAmount: 0,
  appliedCoupons: [],
});

type AddProductItem = Command<
  'AddProductItem',
  {
    shoppingCartId: string;
    productItem: PricedProductItem;
    availableQuantity: number;
    now: Date;
  }
>;

// #region return-failure-event
const addProductItem = (
  command: AddProductItem,
  _state: ShoppingCart,
): ProductItemAdded | ProductItemOutOfStock => {
  const { shoppingCartId, productItem, availableQuantity, now } = command.data;

  // running out of stock is an outcome the business expects, not a broken rule,
  // so record it as its own event type instead of throwing
  if (productItem.quantity > availableQuantity)
    return {
      type: 'ProductItemOutOfStock',
      data: {
        shoppingCartId,
        productId: productItem.productId,
        requestedQuantity: productItem.quantity,
        availableQuantity,
        attemptedAt: now,
      },
    };

  return {
    type: 'ProductItemAdded',
    data: { shoppingCartId, productItem },
  };
};
// #endregion return-failure-event

type ApplyCoupon = Command<
  'ApplyCoupon',
  {
    shoppingCartId: string;
    couponCode: string;
    discountAmount: number;
    expiresAt: Date;
    minimumCartAmount: number;
    now: Date;
  }
>;

// #region distinct-failure-events
const applyCoupon = (
  command: ApplyCoupon,
  state: ShoppingCart,
):
  | CouponApplied
  | CouponExpired
  | CouponAlreadyUsed
  | CartBelowCouponMinimum => {
  const {
    shoppingCartId,
    couponCode,
    discountAmount,
    expiresAt,
    minimumCartAmount,
    now,
  } = command.data;

  // a coupon can fail in three ways, so each mode gets its own event type,
  // carrying the data that mode's handler needs
  if (now > expiresAt)
    return {
      type: 'CouponExpired',
      data: {
        shoppingCartId,
        couponCode,
        expiredAt: expiresAt,
        attemptedAt: now,
      },
    };

  const alreadyUsed = state.appliedCoupons.find(
    ({ code }) => code === couponCode,
  );

  if (alreadyUsed)
    return {
      type: 'CouponAlreadyUsed',
      data: {
        shoppingCartId,
        couponCode,
        appliedAt: alreadyUsed.appliedAt,
        attemptedAt: now,
      },
    };

  if (state.totalAmount < minimumCartAmount)
    return {
      type: 'CartBelowCouponMinimum',
      data: {
        shoppingCartId,
        couponCode,
        cartAmount: state.totalAmount,
        minimumAmount: minimumCartAmount,
        attemptedAt: now,
      },
    };

  return {
    type: 'CouponApplied',
    data: { shoppingCartId, couponCode, discountAmount, appliedAt: now },
  };
};
// #endregion distinct-failure-events

const shoppingCartId = 'shoppingCart-123';
const now = new Date('2024-06-01T10:00:00Z');
const shoes: PricedProductItem = {
  productId: 'shoes-123',
  quantity: 2,
  price: 100,
};

void describe('Decision returning a success or a failure event', () => {
  const given = DeciderSpecification.for<
    AddProductItem,
    ShoppingCartEvent,
    ShoppingCart
  >({
    decide: addProductItem,
    evolve,
    initialState,
  });

  void it('adds the product item when there is enough stock', () =>
    given([])
      .when({
        type: 'AddProductItem',
        data: { shoppingCartId, productItem: shoes, availableQuantity: 5, now },
      })
      .then([
        {
          type: 'ProductItemAdded',
          data: { shoppingCartId, productItem: shoes },
        },
      ]));

  void it('records the shortfall as an event when stock runs out', () =>
    given([])
      .when({
        type: 'AddProductItem',
        data: { shoppingCartId, productItem: shoes, availableQuantity: 1, now },
      })
      .then([
        {
          type: 'ProductItemOutOfStock',
          data: {
            shoppingCartId,
            productId: 'shoes-123',
            requestedQuantity: 2,
            availableQuantity: 1,
            attemptedAt: now,
          },
        },
      ]));
});

void describe('Decision giving each failure mode its own event', () => {
  const given = DeciderSpecification.for<
    ApplyCoupon,
    ShoppingCartEvent,
    ShoppingCart
  >({
    decide: applyCoupon,
    evolve,
    initialState,
  });

  const couponCode = 'SUMMER10';
  const expiresAt = new Date('2024-07-01T00:00:00Z');

  const applySummerCoupon: ApplyCoupon = {
    type: 'ApplyCoupon',
    data: {
      shoppingCartId,
      couponCode,
      discountAmount: 20,
      expiresAt,
      minimumCartAmount: 100,
      now,
    },
  };

  void it('applies the coupon when the cart qualifies', () =>
    given([
      {
        type: 'ProductItemAdded',
        data: { shoppingCartId, productItem: shoes },
      },
    ])
      .when(applySummerCoupon)
      .then([
        {
          type: 'CouponApplied',
          data: {
            shoppingCartId,
            couponCode,
            discountAmount: 20,
            appliedAt: now,
          },
        },
      ]));

  void it('records an expired coupon as its own event', () => {
    const afterExpiry = new Date('2024-08-01T10:00:00Z');

    return given([
      {
        type: 'ProductItemAdded',
        data: { shoppingCartId, productItem: shoes },
      },
    ])
      .when({
        ...applySummerCoupon,
        data: { ...applySummerCoupon.data, now: afterExpiry },
      })
      .then([
        {
          type: 'CouponExpired',
          data: {
            shoppingCartId,
            couponCode,
            expiredAt: expiresAt,
            attemptedAt: afterExpiry,
          },
        },
      ]);
  });

  void it('records a reused coupon as its own event, with the first use', () => {
    const firstAppliedAt = new Date('2024-05-01T10:00:00Z');

    return given([
      {
        type: 'ProductItemAdded',
        data: { shoppingCartId, productItem: shoes },
      },
      {
        type: 'CouponApplied',
        data: {
          shoppingCartId,
          couponCode,
          discountAmount: 20,
          appliedAt: firstAppliedAt,
        },
      },
    ])
      .when(applySummerCoupon)
      .then([
        {
          type: 'CouponAlreadyUsed',
          data: {
            shoppingCartId,
            couponCode,
            appliedAt: firstAppliedAt,
            attemptedAt: now,
          },
        },
      ]);
  });

  void it('records a cart below the minimum as its own event', () =>
    given([])
      .when(applySummerCoupon)
      .then([
        {
          type: 'CartBelowCouponMinimum',
          data: {
            shoppingCartId,
            couponCode,
            cartAmount: 0,
            minimumAmount: 100,
            attemptedAt: now,
          },
        },
      ]));
});
