import { randomUUID } from 'node:crypto';
import { describe, it } from 'vitest';
import { IllegalStateError } from '../errors';
import {
  ExpectedVersionConflictError,
  getInMemoryEventStore,
} from '../eventStore';
import { assertDeepEqual, assertEqual, assertThrowsAsync } from '../testing';
import type { Event } from '../typing';
import { CommandHandler } from './handleCommand';
import {
  after,
  before,
  rejectOn,
  skipOn,
  stopAfter,
  stopOn,
  throwOn,
} from './middleware';
// Events & Entity

type PricedProductItem = { productId: string; quantity: number; price: number };

type ShoppingCart = {
  productItems: PricedProductItem[];
  totalAmount: number;
  status: 'Opened' | 'Confirmed' | 'Cancelled';
};

type ProductItemAdded = Event<
  'ProductItemAdded',
  { productItem: PricedProductItem }
>;
type DiscountApplied = Event<'DiscountApplied', { percent: number }>;
type ShoppingCartConfirmed = Event<
  'ShoppingCartConfirmed',
  { confirmedAt: Date }
>;
type ShoppingCartCancelled = Event<
  'ShoppingCartCancelled',
  { canceledAt: Date }
>;
type ProductItemOutOfStock = Event<
  'ProductItemOutOfStock',
  {
    productId: string;
    requestedQuantity: number;
    availableQuantity: number;
  }
>;
type ShoppingCartItemLimitReached = Event<
  'ShoppingCartItemLimitReached',
  { maximumItems: number; requestedProductId: string }
>;
type ProductItemAlreadyInCart = Event<
  'ProductItemAlreadyInCart',
  { productId: string }
>;
type ShoppingCartConfirmationFailed = Event<
  'ShoppingCartConfirmationFailed',
  { reason: 'PaymentAuthorizationFailed' }
>;

// #region event-union
type ShoppingCartEvent =
  | ProductItemAdded
  | DiscountApplied
  | ShoppingCartConfirmed
  | ShoppingCartCancelled
  | ProductItemOutOfStock
  | ShoppingCartItemLimitReached
  | ProductItemAlreadyInCart
  | ShoppingCartConfirmationFailed;
// #endregion event-union

const evolve = (
  state: ShoppingCart,
  { type, data }: ShoppingCartEvent,
): ShoppingCart => {
  switch (type) {
    case 'ProductItemAdded': {
      const productItem = data.productItem;
      return {
        ...state,
        productItems: [...state.productItems, productItem],
        totalAmount:
          state.totalAmount + productItem.price * productItem.quantity,
      };
    }
    case 'DiscountApplied':
      return {
        ...state,
        totalAmount: state.totalAmount * (1 - data.percent),
      };
    case 'ShoppingCartConfirmed':
      return { ...state, status: 'Confirmed' };
    case 'ShoppingCartCancelled':
      return { ...state, status: 'Cancelled' };
    case 'ProductItemOutOfStock':
    case 'ShoppingCartItemLimitReached':
    case 'ProductItemAlreadyInCart':
    case 'ShoppingCartConfirmationFailed':
      return state;
  }
};

const initialState = (): ShoppingCart => {
  return { productItems: [], totalAmount: 0, status: 'Opened' };
};

// Decision making

type AddProductItem = Event<
  'AddProductItem',
  { productItem: PricedProductItem }
>;

// #region single-event-decision
const addProductItem = (
  command: AddProductItem,
  _state: ShoppingCart,
): ShoppingCartEvent => {
  return {
    type: 'ProductItemAdded',
    data: { productItem: command.data.productItem },
  };
};

// #region decision-handling-business-logic
const addProductItemWithStock = (
  command: AddProductItem,
  availableQuantity: number,
  state: ShoppingCart,
): ShoppingCartEvent =>
  command.data.productItem.quantity > availableQuantity
    ? {
        type: 'ProductItemOutOfStock',
        data: {
          productId: command.data.productItem.productId,
          requestedQuantity: command.data.productItem.quantity,
          availableQuantity,
        },
      }
    : addProductItem(command, state);

const addProductItemWithinLimit = (
  command: AddProductItem,
  maximumItems: number,
  state: ShoppingCart,
): ShoppingCartEvent =>
  state.productItems.length >= maximumItems
    ? {
        type: 'ShoppingCartItemLimitReached',
        data: {
          maximumItems,
          requestedProductId: command.data.productItem.productId,
        },
      }
    : addProductItem(command, state);

const addProductItemOnce = (
  command: AddProductItem,
  state: ShoppingCart,
): ShoppingCartEvent =>
  state.productItems.some(
    (item) => item.productId === command.data.productItem.productId,
  )
    ? {
        type: 'ProductItemAlreadyInCart',
        data: { productId: command.data.productItem.productId },
      }
    : addProductItem(command, state);

const confirmAfterPaymentAuthorization = (
  command: ConfirmShoppingCart,
  paymentAuthorized: boolean,
  state: ShoppingCart,
): ShoppingCartEvent[] | ShoppingCartEvent =>
  paymentAuthorized
    ? confirm(command, state)
    : {
        type: 'ShoppingCartConfirmationFailed',
        data: { reason: 'PaymentAuthorizationFailed' },
      };
// #endregion decision-handling-business-logic
// #endregion single-event-decision

type ConfirmShoppingCart = Event<'ConfirmShoppingCart', { now: Date }>;

// #region confirm-decision
const confirm = (
  command: ConfirmShoppingCart,
  state: ShoppingCart,
): ShoppingCartEvent[] => {
  // Already confirmed: nothing left to do, so append nothing
  if (state.status === 'Confirmed') return [];

  if (state.productItems.length === 0)
    throw new IllegalStateError('Cannot confirm an empty shopping cart');

  return [
    { type: 'ShoppingCartConfirmed', data: { confirmedAt: command.data.now } },
  ];
};
// #endregion confirm-decision

void describe('CommandHandler middleware', () => {
  const eventStore = getInMemoryEventStore();

  void it('rejects a complete shopping-cart batch on an out-of-stock outcome', async () => {
    const shoppingCartId = randomUUID();
    const availableProduct: AddProductItem = {
      type: 'AddProductItem',
      data: {
        productItem: { productId: 'product-1', quantity: 1, price: 10 },
      },
    };
    const unavailableProduct: AddProductItem = {
      type: 'AddProductItem',
      data: {
        productItem: { productId: 'product-2', quantity: 3, price: 15 },
      },
    };
    const confirmCart: ConfirmShoppingCart = {
      type: 'ConfirmShoppingCart',
      data: { now: new Date() },
    };

    // #region command-handler-reject-on
    const addAvailableProduct = (state: ShoppingCart) =>
      addProductItemWithStock(availableProduct, 5, state);

    const addUnavailableProduct = (state: ShoppingCart) =>
      addProductItemWithStock(unavailableProduct, 2, state);

    const confirmTheCart = (state: ShoppingCart) => confirm(confirmCart, state);

    // #region command-handler-reject-on-setup
    const handle = CommandHandler<ShoppingCart, ShoppingCartEvent>({
      evolve,
      initialState,
      // An out-of-stock result cancels every change made by this batch.
      middleware: [rejectOn((event) => event.type === 'ProductItemOutOfStock')],
    });
    // #endregion command-handler-reject-on-setup

    const result = await handle(eventStore, shoppingCartId, [
      // Saved only if the complete batch can finish.
      addAvailableProduct,
      // This reports ProductItemOutOfStock and rejects the complete batch.
      addUnavailableProduct,
      // Rejection stops the batch, so confirmation is not called.
      confirmTheCart,
    ]);
    // #endregion command-handler-reject-on

    assertDeepEqual(
      result.events.map((event) => event.type),
      ['ProductItemAdded', 'ProductItemOutOfStock'],
    );
    assertDeepEqual(result.appendedEvents, []);
    assertDeepEqual(result.newState, initialState());
  });

  void it('stops a batch while retaining earlier accepted decisions', async () => {
    const shoppingCartId = randomUUID();
    const availableProduct: AddProductItem = {
      type: 'AddProductItem',
      data: {
        productItem: { productId: 'product-1', quantity: 1, price: 10 },
      },
    };
    const confirmCart: ConfirmShoppingCart = {
      type: 'ConfirmShoppingCart',
      data: { now: new Date() },
    };

    // #region command-handler-stop-on
    const addAvailableProduct = (state: ShoppingCart) =>
      addProductItemWithStock(availableProduct, 5, state);

    const confirmWithoutPayment = (state: ShoppingCart) =>
      confirmAfterPaymentAuthorization(confirmCart, false, state);

    const addAnotherProduct = (state: ShoppingCart) =>
      addProductItem(availableProduct, state);

    // #region command-handler-stop-on-setup
    const handle = CommandHandler<ShoppingCart, ShoppingCartEvent>({
      evolve,
      initialState,
      middleware: [
        stopOn((event) => event.type === 'ShoppingCartConfirmationFailed'),
      ],
    });
    // #endregion command-handler-stop-on-setup

    const result = await handle(eventStore, shoppingCartId, [
      addAvailableProduct,
      confirmWithoutPayment,
      addAnotherProduct,
    ]);
    // #endregion command-handler-stop-on

    assertDeepEqual(
      result.appendedEvents.map((event) => event.type),
      ['ProductItemAdded'],
    );
    assertDeepEqual(result.newState.productItems, [
      availableProduct.data.productItem,
    ]);
  });

  void it('skips a duplicate product and continues the cart batch', async () => {
    const shoppingCartId = randomUUID();
    const availableProduct: AddProductItem = {
      type: 'AddProductItem',
      data: {
        productItem: { productId: 'product-1', quantity: 1, price: 10 },
      },
    };
    const confirmCart: ConfirmShoppingCart = {
      type: 'ConfirmShoppingCart',
      data: { now: new Date() },
    };

    // #region command-handler-skip-on
    const addAvailableProduct = (state: ShoppingCart) =>
      addProductItemOnce(availableProduct, state);

    const addTheSameProductAgain = (state: ShoppingCart) =>
      addProductItemOnce(availableProduct, state);

    const confirmTheCart = (state: ShoppingCart) => confirm(confirmCart, state);

    // #region command-handler-skip-on-setup
    const handle = CommandHandler<ShoppingCart, ShoppingCartEvent>({
      evolve,
      initialState,
      middleware: [
        skipOn((event) => event.type === 'ProductItemAlreadyInCart'),
      ],
    });
    // #endregion command-handler-skip-on-setup

    const result = await handle(eventStore, shoppingCartId, [
      addAvailableProduct,
      addTheSameProductAgain,
      confirmTheCart,
    ]);
    // #endregion command-handler-skip-on

    assertDeepEqual(
      result.events.map((event) => event.type),
      ['ProductItemAdded', 'ProductItemAlreadyInCart', 'ShoppingCartConfirmed'],
    );
    assertDeepEqual(
      result.appendedEvents.map((event) => event.type),
      ['ProductItemAdded', 'ShoppingCartConfirmed'],
    );
  });

  void it('records a terminal business failure and stops later decisions', async () => {
    const shoppingCartId = randomUUID();
    const firstProduct: AddProductItem = {
      type: 'AddProductItem',
      data: {
        productItem: { productId: 'product-1', quantity: 1, price: 10 },
      },
    };
    const productOverTheLimit: AddProductItem = {
      type: 'AddProductItem',
      data: {
        productItem: { productId: 'product-2', quantity: 1, price: 15 },
      },
    };
    const productThatMustNotBeAdded: AddProductItem = {
      type: 'AddProductItem',
      data: {
        productItem: { productId: 'product-3', quantity: 1, price: 20 },
      },
    };
    const maximumItems = 1;

    // #region command-handler-stop-after
    const addFirstProduct = (state: ShoppingCart) =>
      addProductItemWithinLimit(firstProduct, maximumItems, state);

    const reachTheItemLimit = (state: ShoppingCart) =>
      addProductItemWithinLimit(productOverTheLimit, maximumItems, state);

    const addAnotherProduct = (state: ShoppingCart) =>
      addProductItemWithinLimit(productThatMustNotBeAdded, maximumItems, state);

    // #region command-handler-stop-after-setup
    const handle = CommandHandler<ShoppingCart, ShoppingCartEvent>({
      evolve,
      initialState,
      middleware: [
        stopAfter((event) => event.type === 'ShoppingCartItemLimitReached'),
      ],
    });
    // #endregion command-handler-stop-after-setup

    const result = await handle(eventStore, shoppingCartId, [
      addFirstProduct,
      reachTheItemLimit,
      addAnotherProduct,
    ]);
    // #endregion command-handler-stop-after

    assertDeepEqual(
      result.appendedEvents.map((event) => event.type),
      ['ProductItemAdded', 'ShoppingCartItemLimitReached'],
    );
    assertDeepEqual(result.newState.productItems, [
      firstProduct.data.productItem,
    ]);
  });

  void it('authorizes once and can turn a failure event into an exception', async () => {
    const shoppingCartId = randomUUID();
    const unavailableProduct: AddProductItem = {
      type: 'AddProductItem',
      data: {
        productItem: { productId: 'product-2', quantity: 3, price: 15 },
      },
    };
    class ProductItemOutOfStockError extends Error {}
    const authorizeRequest = (): Promise<void> => Promise.resolve();

    // #region command-handler-before-all-throw-on
    const addUnavailableProduct = (state: ShoppingCart) =>
      addProductItemWithStock(unavailableProduct, 2, state);

    const handle = CommandHandler<ShoppingCart, ShoppingCartEvent>({
      evolve,
      initialState,
      middleware: {
        beforeAll: authorizeRequest,
        decision: [
          throwOn(
            (event) => event.type === 'ProductItemOutOfStock',
            (event) => new ProductItemOutOfStockError(event.type),
          ),
        ],
      },
    });

    // #endregion command-handler-before-all-throw-on

    await assertThrowsAsync(
      () => handle(eventStore, shoppingCartId, addUnavailableProduct),
      (error) => error instanceof ProductItemOutOfStockError,
    );

    assertDeepEqual((await eventStore.readStream(shoppingCartId)).events, []);
  });

  void it('runs beforeAll once and decision middleware for each retry attempt', async () => {
    const shoppingCartId = randomUUID();
    const product: AddProductItem = {
      type: 'AddProductItem',
      data: {
        productItem: { productId: 'product-1', quantity: 1, price: 10 },
      },
    };
    let authorizationChecks = 0;
    let measuredDecisions = 0;
    let measuredInvocations = 0;

    const authorizeRequest = () => {
      authorizationChecks++;
    };
    const recordDecisionMetric = () => {
      measuredDecisions++;
    };

    // #region command-middleware-retry
    const handleWithRetrySafeMiddleware = CommandHandler<
      ShoppingCart,
      ShoppingCartEvent
    >({
      evolve,
      initialState,
      middleware: {
        beforeAll: authorizeRequest,
        afterAll: () => {
          measuredInvocations++;
        },
        decision: [before(recordDecisionMetric)],
      },
      retry: { onVersionConflict: true },
    });

    await handleWithRetrySafeMiddleware(eventStore, shoppingCartId, (state) =>
      addProductItem(product, state),
    );
    // #endregion command-middleware-retry

    authorizationChecks = 0;
    measuredDecisions = 0;
    measuredInvocations = 0;
    const handleThatSimulatesAConflict = CommandHandler<
      ShoppingCart,
      ShoppingCartEvent
    >({
      evolve,
      initialState,
      middleware: {
        beforeAll: authorizeRequest,
        afterAll: () => {
          measuredInvocations++;
        },
        decision: [
          before(recordDecisionMetric),
          after((result) => {
            if (measuredDecisions === 1)
              throw new ExpectedVersionConflictError(0n, 1n);
            return result;
          }),
        ],
      },
      retry: {
        retries: 1,
        minTimeout: 1,
        factor: 1,
        shouldRetryError: (error) =>
          error instanceof ExpectedVersionConflictError,
      },
    });

    await handleThatSimulatesAConflict(eventStore, randomUUID(), (state) =>
      addProductItem(product, state),
    );

    assertEqual(authorizationChecks, 1);
    assertEqual(measuredDecisions, 2);
    assertEqual(measuredInvocations, 1);
  });
});
