import { randomUUID } from 'node:crypto';
import { describe, it } from 'vitest';
import {
  ConcurrencyError,
  IllegalStateError,
  ValidationError,
} from '../errors';
import {
  ExpectedVersionConflictError,
  getInMemoryEventStore,
  STREAM_DOES_NOT_EXIST,
} from '../eventStore';
import {
  assertDeepEqual,
  assertEqual,
  assertFalse,
  assertOk,
  assertThatArray,
  assertThrowsAsync,
  assertTrue,
} from '../testing';
import type { Event } from '../typing';
import { CommandHandler } from './handleCommand';

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

// #region event-union
type ShoppingCartEvent =
  | ProductItemAdded
  | DiscountApplied
  | ShoppingCartConfirmed
  | ShoppingCartCancelled;
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
// #endregion single-event-decision

type ApplyDiscount = Event<'ApplyDiscount', { percent: number }>;

// #region validation-error-decision
const applyDiscount = (
  command: ApplyDiscount,
  _state: ShoppingCart,
): ShoppingCartEvent => {
  // Reject invalid input before producing any event
  if (command.data.percent <= 0 || command.data.percent > 1)
    throw new ValidationError('Discount percent has to be between 0 and 1');

  return { type: 'DiscountApplied', data: { percent: command.data.percent } };
};
// #endregion validation-error-decision

const defaultDiscount = 0.1;

// #region multiple-events-decision
const addProductItemWithDiscount = (
  command: AddProductItem,
  _state: ShoppingCart,
): ShoppingCartEvent[] => {
  return [
    {
      type: 'ProductItemAdded',
      data: { productItem: command.data.productItem },
    },
    { type: 'DiscountApplied', data: { percent: defaultDiscount } },
  ];
};
// #endregion multiple-events-decision

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

type CancelShoppingCart = Event<'CancelShoppingCart', { now: Date }>;

// #region empty-array-no-op
const cancel = (
  command: CancelShoppingCart,
  state: ShoppingCart,
): ShoppingCartEvent[] => {
  // Already cancelled: nothing left to do, so append nothing
  if (state.status === 'Cancelled') return [];

  return [
    { type: 'ShoppingCartCancelled', data: { canceledAt: command.data.now } },
  ];
};
// #endregion empty-array-no-op

const handleCommand = CommandHandler<ShoppingCart, ShoppingCartEvent>({
  evolve,
  initialState,
});

void describe('Command Handler', () => {
  const eventStore = getInMemoryEventStore();

  void it('When called successfully returns new state for a single returned event', async () => {
    const productItem: PricedProductItem = {
      productId: '123',
      quantity: 10,
      price: 3,
    };

    const shoppingCartId = randomUUID();
    const command: AddProductItem = {
      type: 'AddProductItem',
      data: { productItem },
    };

    // #region single-event
    const { nextExpectedStreamVersion, newState, newEvents, createdNewStream } =
      await handleCommand(eventStore, shoppingCartId, (state) =>
        addProductItem(command, state),
      );
    // #endregion single-event

    assertTrue(createdNewStream);
    assertThatArray(newEvents).hasSize(1);
    assertDeepEqual(newState, {
      productItems: [productItem],
      totalAmount: productItem.price * productItem.quantity,
      status: 'Opened',
    });
    assertEqual(nextExpectedStreamVersion, 1n);
  });

  void it('When called with STREAM_DOES_NOT_EXIST returns new state for a single returned event', async () => {
    const productItem: PricedProductItem = {
      productId: '123',
      quantity: 10,
      price: 3,
    };

    const shoppingCartId = randomUUID();
    const command: AddProductItem = {
      type: 'AddProductItem',
      data: { productItem },
    };

    // #region require-new-stream
    const { nextExpectedStreamVersion, newState, newEvents, createdNewStream } =
      await handleCommand(
        eventStore,
        shoppingCartId,
        (state) => addProductItem(command, state),
        { expectedStreamVersion: 'STREAM_DOES_NOT_EXIST' },
      );
    // #endregion require-new-stream

    assertTrue(createdNewStream);
    assertThatArray(newEvents).hasSize(1);
    assertDeepEqual(newState, {
      productItems: [productItem],
      totalAmount: productItem.price * productItem.quantity,
      status: 'Opened',
    });
    assertEqual(nextExpectedStreamVersion, 1n);
  });

  void it('Returns initial state when no events are returned from the handler', async () => {
    const entityId = randomUUID();

    const { newEvents, newState, nextExpectedStreamVersion, createdNewStream } =
      await handleCommand(eventStore, entityId, () => {
        return [];
      });

    assertThatArray(newEvents).isEmpty();
    assertDeepEqual(newState, initialState());
    assertEqual(nextExpectedStreamVersion, 0n);
    assertFalse(createdNewStream);
  });

  void it('appends nothing when a decision is a no-op on the current state', async () => {
    const productItem: PricedProductItem = {
      productId: '123',
      quantity: 10,
      price: 3,
    };

    const shoppingCartId = randomUUID();
    const addProduct: AddProductItem = {
      type: 'AddProductItem',
      data: { productItem },
    };
    const confirmCart: ConfirmShoppingCart = {
      type: 'ConfirmShoppingCart',
      data: { now: new Date() },
    };

    // open, add an item, and confirm the cart
    const { nextExpectedStreamVersion: confirmedVersion } = await handleCommand(
      eventStore,
      shoppingCartId,
      [
        (state) => addProductItem(addProduct, state),
        (state) => confirm(confirmCart, state),
      ],
    );

    // #region no-op
    // Confirming an already-confirmed cart is a no-op, so nothing is appended
    const { newEvents, nextExpectedStreamVersion, createdNewStream } =
      await handleCommand(eventStore, shoppingCartId, (state) =>
        confirm(confirmCart, state),
      );
    // #endregion no-op

    assertThatArray(newEvents).isEmpty();
    assertFalse(createdNewStream);
    assertEqual(nextExpectedStreamVersion, confirmedVersion);
  });

  void it('appends nothing when a decision returns an empty array', async () => {
    const shoppingCartId = randomUUID();
    const cancelCart: CancelShoppingCart = {
      type: 'CancelShoppingCart',
      data: { now: new Date() },
    };

    // #region idempotent-resend
    // cancel once
    const { nextExpectedStreamVersion: cancelledVersion } = await handleCommand(
      eventStore,
      shoppingCartId,
      (state) => cancel(cancelCart, state),
    );

    // resending the same command is a no-op: the cart is already cancelled,
    // so the decision returns [] and nothing is appended
    const { newEvents, nextExpectedStreamVersion, createdNewStream } =
      await handleCommand(eventStore, shoppingCartId, (state) =>
        cancel(cancelCart, state),
      );
    // #endregion idempotent-resend

    assertThatArray(newEvents).isEmpty();
    assertFalse(createdNewStream);
    assertEqual(nextExpectedStreamVersion, cancelledVersion);
  });

  void it('Creates new stream on first command and follows up with next expected version', async () => {
    const productItem: PricedProductItem = {
      productId: '123',
      quantity: 10,
      price: 3,
    };

    const shoppingCartId = randomUUID();
    const command: AddProductItem = {
      type: 'AddProductItem',
      data: { productItem },
    };

    // #region automatic-version
    const { newState: state1, nextExpectedStreamVersion } = await handleCommand(
      eventStore,
      shoppingCartId,
      (state) => addProductItem(command, state),
    );
    // #endregion automatic-version

    assertDeepEqual(state1, {
      productItems: [productItem],
      totalAmount: productItem.price * productItem.quantity,
      status: 'Opened',
    });
    assertEqual(nextExpectedStreamVersion, 1n);

    // #region explicit-version
    const { nextExpectedStreamVersion: version2 } = await handleCommand(
      eventStore,
      shoppingCartId,
      (state) => addProductItem(command, state),
      { expectedStreamVersion: nextExpectedStreamVersion },
    );
    // #endregion explicit-version

    assertEqual(version2, 2n);
  });

  void it('runs several decisions in order and appends their events together', async () => {
    const productItem: PricedProductItem = {
      productId: '123',
      quantity: 10,
      price: 3,
    };

    const shoppingCartId = randomUUID();
    const addProduct: AddProductItem = {
      type: 'AddProductItem',
      data: { productItem },
    };
    const confirmCart: ConfirmShoppingCart = {
      type: 'ConfirmShoppingCart',
      data: { now: new Date() },
    };

    // #region sequential-handlers
    const { newState, newEvents, nextExpectedStreamVersion } =
      await handleCommand(eventStore, shoppingCartId, [
        (state) => addProductItem(addProduct, state),
        (state) => confirm(confirmCart, state),
      ]);
    // #endregion sequential-handlers

    assertThatArray(newEvents).hasSize(2);
    assertDeepEqual(newState, {
      productItems: [productItem],
      totalAmount: productItem.price * productItem.quantity,
      status: 'Confirmed',
    });
    assertEqual(nextExpectedStreamVersion, 2n);
  });

  void it('Does not create a new stream if no events are produced on first command', async () => {
    const entityId = randomUUID();

    const { createdNewStream, newEvents, nextExpectedStreamVersion } =
      await handleCommand(eventStore, entityId, () => []);

    assertFalse(createdNewStream);
    assertThatArray(newEvents).isEmpty();
    assertEqual(nextExpectedStreamVersion, 0n);
  });

  void it('maps the business id to a custom stream name', async () => {
    const productItem: PricedProductItem = {
      productId: '123',
      quantity: 10,
      price: 3,
    };

    const shoppingCartId = randomUUID();
    const command: AddProductItem = {
      type: 'AddProductItem',
      data: { productItem },
    };

    // #region stream-id-mapping
    const handle = CommandHandler<ShoppingCart, ShoppingCartEvent>({
      evolve,
      initialState,
      mapToStreamId: (id) => `shopping_cart-${id}`,
    });
    // #endregion stream-id-mapping

    await handle(eventStore, shoppingCartId, (state) =>
      addProductItem(command, state),
    );

    const { events } = await eventStore.readStream<ShoppingCartEvent>(
      `shopping_cart-${shoppingCartId}`,
    );
    assertThatArray(events).hasSize(1);
  });

  void it('awaits an async handler before appending', async () => {
    const shoppingCartId = randomUUID();
    const command: AddProductItem = {
      type: 'AddProductItem',
      data: { productItem: { productId: '123', quantity: 10, price: 0 } },
    };

    const getPrice = (_productId: string): Promise<number> =>
      Promise.resolve(3);

    // #region async-handler
    const { newState, newEvents } = await handleCommand(
      eventStore,
      shoppingCartId,
      async (state) => {
        // ❌ Avoid: on a version-conflict retry the whole handler re-runs, so this call fires again
        const price = await getPrice(command.data.productItem.productId);
        return addProductItem(
          {
            ...command,
            data: { productItem: { ...command.data.productItem, price } },
          },
          state,
        );
      },
    );
    // #endregion async-handler

    assertThatArray(newEvents).hasSize(1);
    assertEqual(newState.totalAmount, 30);
  });

  void it('accepts a per-call retry policy for version conflicts', async () => {
    const productItem: PricedProductItem = {
      productId: '123',
      quantity: 10,
      price: 3,
    };

    const shoppingCartId = randomUUID();
    const command: AddProductItem = {
      type: 'AddProductItem',
      data: { productItem },
    };

    // #region retry-on-conflict
    const { newEvents } = await handleCommand(
      eventStore,
      shoppingCartId,
      (state) => addProductItem(command, state),
      { retry: { onVersionConflict: true } },
    );
    // #endregion retry-on-conflict

    assertThatArray(newEvents).hasSize(1);
  });

  void it('accepts custom retry options with a shouldRetryError predicate', async () => {
    const productItem: PricedProductItem = {
      productId: '123',
      quantity: 10,
      price: 3,
    };

    const shoppingCartId = randomUUID();
    const command: AddProductItem = {
      type: 'AddProductItem',
      data: { productItem },
    };

    // #region custom-retry
    const handle = CommandHandler<ShoppingCart, ShoppingCartEvent>({
      evolve,
      initialState,
      retry: {
        retries: 5,
        minTimeout: 50,
        factor: 2,
        shouldRetryError: (error) => error instanceof ConcurrencyError,
      },
    });
    // #endregion custom-retry

    const { newEvents } = await handle(eventStore, shoppingCartId, (state) =>
      addProductItem(command, state),
    );

    assertThatArray(newEvents).hasSize(1);
  });

  void it('exposes expected and current versions on a version conflict', async () => {
    const productItem: PricedProductItem = {
      productId: '123',
      quantity: 10,
      price: 3,
    };

    const shoppingCartId = randomUUID();
    const command: AddProductItem = {
      type: 'AddProductItem',
      data: { productItem },
    };

    // seed the stream so a STREAM_DOES_NOT_EXIST expectation will conflict
    await handleCommand(eventStore, shoppingCartId, (state) =>
      addProductItem(command, state),
    );

    let caught: ConcurrencyError | undefined;

    // #region concurrency-error
    try {
      await handleCommand(
        eventStore,
        shoppingCartId,
        (state) => addProductItem(command, state),
        { expectedStreamVersion: STREAM_DOES_NOT_EXIST },
      );
    } catch (error) {
      if (error instanceof ConcurrencyError) {
        // error.expected: the version the command required
        // error.current:  the version the stream is actually at
        caught = error;
      }
    }
    // #endregion concurrency-error

    assertOk(caught);
    assertOk(caught.expected);
  });

  void it('propagates a business error thrown by the handler', async () => {
    const shoppingCartId = randomUUID();

    const run = () =>
      // #region business-error
      handleCommand(eventStore, shoppingCartId, () => {
        throw new IllegalStateError('Shopping Cart already closed');
      });
    // #endregion business-error

    await assertThrowsAsync(run, (error) => error instanceof IllegalStateError);
  });

  void it('propagates a validation error thrown by the handler', async () => {
    const shoppingCartId = randomUUID();
    const applyInvalidDiscount: ApplyDiscount = {
      type: 'ApplyDiscount',
      data: { percent: 1.5 },
    };

    const run = () =>
      handleCommand(eventStore, shoppingCartId, (state) =>
        applyDiscount(applyInvalidDiscount, state),
      );

    await assertThrowsAsync(run, (error) => error instanceof ValidationError);
  });

  void describe('retries', () => {
    void it('retries handling for wrong version and succeeds if conditions are correct', async () => {
      // Given
      const productItem: PricedProductItem = {
        productId: '123',
        quantity: 10,
        price: 3,
      };

      const shoppingCartId = randomUUID();
      const command: AddProductItem = {
        type: 'AddProductItem',
        data: { productItem },
      };

      // Create the stream
      await handleCommand(
        eventStore,
        shoppingCartId,
        (state) => addProductItem(command, state),
        { expectedStreamVersion: 'STREAM_DOES_NOT_EXIST' },
      );

      let tried = 0;

      const {
        nextExpectedStreamVersion,
        newState,
        newEvents,
        createdNewStream,
      } = await handleCommand(
        eventStore,
        shoppingCartId,
        (state) => {
          // This should be thrown in parallel operations not in the business logic
          // but for this test needs, that's the simplest way to do it
          if (tried++ === 0) throw new ExpectedVersionConflictError(0n, 1n);
          return addProductItem(command, state);
        },
        {
          retry: { onVersionConflict: 10 },
        },
      );

      assertEqual(2, tried);
      assertFalse(createdNewStream);
      assertThatArray(newEvents).hasSize(1);
      assertDeepEqual(newState, {
        productItems: [productItem, productItem],
        totalAmount: productItem.price * productItem.quantity * 2,
        status: 'Opened',
      });
      assertEqual(nextExpectedStreamVersion, 2n);
    });

    void it('does NOT retry handling for wrong explicit version', async () => {
      // Given
      const productItem: PricedProductItem = {
        productId: '123',
        quantity: 10,
        price: 3,
      };

      const shoppingCartId = randomUUID();
      const command: AddProductItem = {
        type: 'AddProductItem',
        data: { productItem },
      };

      // Create the stream
      await handleCommand(
        eventStore,
        shoppingCartId,
        (state) => addProductItem(command, state),
        { expectedStreamVersion: 'STREAM_DOES_NOT_EXIST' },
      );

      let tried = 0;

      await assertThrowsAsync(
        async () => {
          await handleCommand(
            eventStore,
            shoppingCartId,
            (state) => {
              tried++;
              return addProductItem(command, state);
            },
            { expectedStreamVersion: 'STREAM_DOES_NOT_EXIST' },
          );
        },
        (error) => error instanceof ExpectedVersionConflictError,
      );

      // 0 as it should fail already on aggregating stream
      assertEqual(0, tried);
    });

    void it('When called successfuly returns new state for multiple returned events', async () => {
      const productItem: PricedProductItem = {
        productId: '123',
        quantity: 10,
        price: 3,
      };

      const shoppingCartId = randomUUID();
      const command: AddProductItem = {
        type: 'AddProductItem',
        data: { productItem },
      };

      // #region multiple-events
      const {
        nextExpectedStreamVersion,
        newState,
        newEvents,
        createdNewStream,
      } = await handleCommand(eventStore, shoppingCartId, (state) =>
        addProductItemWithDiscount(command, state),
      );
      // #endregion multiple-events

      assertTrue(createdNewStream);
      assertThatArray(newEvents).hasSize(2);
      assertDeepEqual(newState, {
        productItems: [productItem],
        totalAmount:
          productItem.price * productItem.quantity * (1 - defaultDiscount),
        status: 'Opened',
      });
      assertEqual(nextExpectedStreamVersion, 2n);
    });

    void it('When returning an empty array of events returns the same state', async () => {
      const productItem: PricedProductItem = {
        productId: '123',
        quantity: 10,
        price: 3,
      };

      const shoppingCartId = randomUUID();
      const command: AddProductItem = {
        type: 'AddProductItem',
        data: { productItem },
      };

      const {
        nextExpectedStreamVersion,
        newState,
        newEvents,
        createdNewStream,
      } = await handleCommand(eventStore, shoppingCartId, (state) =>
        command.data.productItem.price > 100
          ? addProductItemWithDiscount(command, state)
          : [],
      );

      assertFalse(createdNewStream);
      assertEqual(nextExpectedStreamVersion, 0n);
      assertDeepEqual(newEvents, []);
      assertDeepEqual(newState, initialState());
    });

    void it('Fails after retrying multiple times due to version conflicts', async () => {
      const productItem: PricedProductItem = {
        productId: '123',
        quantity: 10,
        price: 3,
      };

      const shoppingCartId = randomUUID();
      const command: AddProductItem = {
        type: 'AddProductItem',
        data: { productItem },
      };

      // Create the stream
      await handleCommand(
        eventStore,
        shoppingCartId,
        (state) => addProductItem(command, state),
        { expectedStreamVersion: 'STREAM_DOES_NOT_EXIST' },
      );

      let tried = 0;

      await assertThrowsAsync(
        async () => {
          await handleCommand(
            eventStore,
            shoppingCartId,
            () => {
              tried++;
              throw new ExpectedVersionConflictError(0n, 1n);
            },
            {
              retry: { onVersionConflict: 2 },
            },
          );
        },
        (error) => error instanceof ExpectedVersionConflictError,
      );

      assertEqual(3, tried);
    });

    void it('Succeeds after retrying with custom retry options', async () => {
      const productItem: PricedProductItem = {
        productId: '123',
        quantity: 10,
        price: 3,
      };

      const shoppingCartId = randomUUID();
      const command: AddProductItem = {
        type: 'AddProductItem',
        data: { productItem },
      };

      // Create the stream
      await handleCommand(
        eventStore,
        shoppingCartId,
        (state) => addProductItem(command, state),
        { expectedStreamVersion: 'STREAM_DOES_NOT_EXIST' },
      );

      let tried = 0;

      const { newState, newEvents } = await handleCommand(
        eventStore,
        shoppingCartId,
        (state) => {
          if (tried++ < 3) throw new ExpectedVersionConflictError(0n, 1n);
          return addProductItem(command, state);
        },
        {
          retry: {
            onVersionConflict: { retries: 3, factor: 1, minTimeout: 10 },
          },
        },
      );

      assertEqual(4, tried);
      assertThatArray(newEvents).hasSize(1);
      assertDeepEqual(newState, {
        productItems: [productItem, productItem],
        totalAmount: productItem.price * productItem.quantity * 2,
        status: 'Opened',
      });
    });

    void it('Does not retry if version conflict error is not thrown', async () => {
      const productItem: PricedProductItem = {
        productId: '123',
        quantity: 10,
        price: 3,
      };

      const shoppingCartId = randomUUID();
      const command: AddProductItem = {
        type: 'AddProductItem',
        data: { productItem },
      };

      let tried = 0;

      const { newState, newEvents } = await handleCommand(
        eventStore,
        shoppingCartId,
        (state) => {
          tried++;
          return addProductItem(command, state);
        },
        {
          retry: { onVersionConflict: 5 },
        },
      );

      assertEqual(1, tried);
      assertThatArray(newEvents).hasSize(1);
      assertDeepEqual(newState, {
        productItems: [productItem],
        totalAmount: productItem.price * productItem.quantity,
        status: 'Opened',
      });
    });

    void it('Correctly handles no retries on version conflict when retry is disabled', async () => {
      const productItem: PricedProductItem = {
        productId: '123',
        quantity: 10,
        price: 3,
      };

      const shoppingCartId = randomUUID();
      const command: AddProductItem = {
        type: 'AddProductItem',
        data: { productItem },
      };

      // Create the stream
      await handleCommand(
        eventStore,
        shoppingCartId,
        (state) => addProductItem(command, state),
        { expectedStreamVersion: 'STREAM_DOES_NOT_EXIST' },
      );

      let tried = 0;

      await assertThrowsAsync(
        async () => {
          await handleCommand(eventStore, shoppingCartId, () => {
            tried++;
            throw new ExpectedVersionConflictError(0n, 1n);
          });
        },
        (error) => error instanceof ExpectedVersionConflictError,
      );

      assertEqual(1, tried);
    });
  });

  void describe('upcasting', () => {
    type ProductItemFromDB = {
      productId: string;
      quantity: string;
      price: string;
    };

    type ProductItemAddedFromDB = Event<
      'ProductItemAdded',
      { productItem: ProductItemFromDB }
    >;
    type DiscountAppliedFromDB = Event<'DiscountApplied', { percent: string }>;

    type ShoppingCartEventFromDB =
      ProductItemAddedFromDB | DiscountAppliedFromDB;

    const upcast = (event: Event): ShoppingCartEvent => {
      switch (event.type) {
        case 'ProductItemAdded': {
          const e = event as ProductItemAddedFromDB;
          return {
            type: 'ProductItemAdded',
            data: {
              productItem: {
                productId: e.data.productItem.productId,
                quantity: Number(e.data.productItem.quantity),
                price: Number(e.data.productItem.price),
              },
            },
          };
        }
        case 'DiscountApplied': {
          const e = event as DiscountAppliedFromDB;
          return {
            type: 'DiscountApplied',
            data: { percent: Number(e.data.percent) },
          };
        }
        default:
          return event as ShoppingCartEvent;
      }
    };

    const handleCommandWithUpcast = CommandHandler<
      ShoppingCart,
      ShoppingCartEvent
    >({
      evolve,
      initialState,
      schema: { versioning: { upcast } },
    });

    void it('upcasts string to number when aggregating', async () => {
      const shoppingCartId = randomUUID();

      await eventStore.appendToStream<ShoppingCartEventFromDB>(shoppingCartId, [
        {
          type: 'ProductItemAdded',
          data: {
            productItem: { productId: '123', quantity: '10', price: '3' },
          },
        },
      ]);

      const { newState, nextExpectedStreamVersion } =
        await handleCommandWithUpcast(eventStore, shoppingCartId, () => []);

      assertEqual(nextExpectedStreamVersion, 1n);
      assertDeepEqual(newState, {
        productItems: [{ productId: '123', quantity: 10, price: 3 }],
        totalAmount: 30,
        status: 'Opened',
      });
    });
  });

  void describe('upcasting dates and bigints from JSON', () => {
    type ShoppingCartWithDatesAndBigInt = {
      productItems: PricedProductItem[];
      totalAmount: number;
      openedAt: Date;
      loyaltyPoints: bigint;
    };

    type ShoppingCartOpened = Event<
      'ShoppingCartOpened',
      { clientId: string; openedAt: Date; loyaltyPoints: bigint }
    >;

    type ShoppingCartEventWithDatesAndBigInt =
      ShoppingCartOpened | ProductItemAdded | DiscountApplied;

    type ShoppingCartOpenedFromDB = Event<
      'ShoppingCartOpened',
      { clientId: string; openedAt: string; loyaltyPoints: string }
    >;

    type ShoppingCartEventFromDB =
      ShoppingCartOpenedFromDB | ProductItemAdded | DiscountApplied;

    const upcastDatesAndBigInt = (
      event: Event,
    ): ShoppingCartEventWithDatesAndBigInt => {
      switch (event.type) {
        case 'ShoppingCartOpened': {
          const e = event as ShoppingCartOpenedFromDB;
          return {
            type: 'ShoppingCartOpened',
            data: {
              clientId: e.data.clientId,
              openedAt: new Date(e.data.openedAt),
              loyaltyPoints: BigInt(e.data.loyaltyPoints),
            },
          };
        }
        default:
          return event as ShoppingCartEventWithDatesAndBigInt;
      }
    };

    const evolveDatesAndBigInt = (
      state: ShoppingCartWithDatesAndBigInt,
      { type, data }: ShoppingCartEventWithDatesAndBigInt,
    ): ShoppingCartWithDatesAndBigInt => {
      switch (type) {
        case 'ShoppingCartOpened':
          return {
            ...state,
            openedAt: data.openedAt,
            loyaltyPoints: data.loyaltyPoints,
          };
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
      }
    };

    const handleCommandWithUpcast = CommandHandler<
      ShoppingCartWithDatesAndBigInt,
      ShoppingCartEventWithDatesAndBigInt
    >({
      evolve: evolveDatesAndBigInt,
      initialState: () => ({
        productItems: [],
        totalAmount: 0,
        openedAt: new Date(0),
        loyaltyPoints: 0n,
      }),
      schema: { versioning: { upcast: upcastDatesAndBigInt } },
    });

    void it('upcasts ISO string to Date and string to BigInt when aggregating', async () => {
      const shoppingCartId = randomUUID();
      const openedAtString = '2024-01-15T10:30:00.000Z';
      const loyaltyPointsString = '9007199254740993';

      await eventStore.appendToStream<ShoppingCartEventFromDB>(shoppingCartId, [
        {
          type: 'ShoppingCartOpened',
          data: {
            clientId: 'client-1',
            openedAt: openedAtString,
            loyaltyPoints: loyaltyPointsString,
          },
        },
        {
          type: 'ProductItemAdded',
          data: { productItem: { productId: '123', quantity: 2, price: 10 } },
        },
      ]);

      const { newState, nextExpectedStreamVersion } =
        await handleCommandWithUpcast(eventStore, shoppingCartId, () => []);

      assertEqual(nextExpectedStreamVersion, 2n);
      assertDeepEqual(newState.openedAt, new Date(openedAtString));
      assertEqual(newState.loyaltyPoints, BigInt(loyaltyPointsString));
      assertEqual(newState.totalAmount, 20);
    });
  });

  void describe('readStream upcasting', () => {
    type ProductItemFromDB = {
      productId: string;
      quantity: string;
      price: string;
    };

    type ProductItemAddedFromDB = Event<
      'ProductItemAdded',
      { productItem: ProductItemFromDB }
    >;

    type ShoppingCartEventFromDB = ProductItemAddedFromDB | DiscountApplied;

    const upcast = (event: Event): ShoppingCartEvent => {
      switch (event.type) {
        case 'ProductItemAdded': {
          const e = event as ProductItemAddedFromDB;
          return {
            type: 'ProductItemAdded',
            data: {
              productItem: {
                productId: e.data.productItem.productId,
                quantity: Number(e.data.productItem.quantity),
                price: Number(e.data.productItem.price),
              },
            },
          };
        }
        default:
          return event as ShoppingCartEvent;
      }
    };

    void it('upcasts events when reading stream directly', async () => {
      const shoppingCartId = randomUUID();

      await eventStore.appendToStream<ShoppingCartEventFromDB>(shoppingCartId, [
        {
          type: 'ProductItemAdded',
          data: {
            productItem: { productId: '123', quantity: '10', price: '3' },
          },
        },
        {
          type: 'ProductItemAdded',
          data: {
            productItem: { productId: '456', quantity: '5', price: '2' },
          },
        },
      ]);

      const { events, currentStreamVersion } =
        await eventStore.readStream<ShoppingCartEvent>(shoppingCartId, {
          schema: { versioning: { upcast } },
        });

      assertEqual(currentStreamVersion, 2n);
      assertThatArray(events).hasSize(2);

      const firstEvent = events[0]!;
      assertEqual(firstEvent.type, 'ProductItemAdded');
      if (firstEvent.type === 'ProductItemAdded') {
        assertEqual(firstEvent.data.productItem.quantity, 10);
        assertEqual(firstEvent.data.productItem.price, 3);
      }

      const secondEvent = events[1]!;
      assertEqual(secondEvent.type, 'ProductItemAdded');
      if (secondEvent.type === 'ProductItemAdded') {
        assertEqual(secondEvent.data.productItem.quantity, 5);
        assertEqual(secondEvent.data.productItem.price, 2);
      }
    });

    void it('upcasts ISO string to Date and string to BigInt when reading stream directly', async () => {
      type ShoppingCartOpened = Event<
        'ShoppingCartOpened',
        { clientId: string; openedAt: Date; loyaltyPoints: bigint }
      >;

      type ShoppingCartOpenedFromDB = Event<
        'ShoppingCartOpened',
        { clientId: string; openedAt: string; loyaltyPoints: string }
      >;

      const upcastDatesAndBigInt = (event: Event): ShoppingCartOpened => {
        if (event.type === 'ShoppingCartOpened') {
          const e = event as ShoppingCartOpenedFromDB;
          return {
            type: 'ShoppingCartOpened',
            data: {
              clientId: e.data.clientId,
              openedAt: new Date(e.data.openedAt),
              loyaltyPoints: BigInt(e.data.loyaltyPoints),
            },
          };
        }
        return event as ShoppingCartOpened;
      };

      const shoppingCartId = randomUUID();
      const openedAtString = '2024-01-15T10:30:00.000Z';
      const loyaltyPointsString = '9007199254740993';

      await eventStore.appendToStream<ShoppingCartOpenedFromDB>(
        shoppingCartId,
        [
          {
            type: 'ShoppingCartOpened',
            data: {
              clientId: 'client-1',
              openedAt: openedAtString,
              loyaltyPoints: loyaltyPointsString,
            },
          },
        ],
      );

      const { events, currentStreamVersion } =
        await eventStore.readStream<ShoppingCartOpened>(shoppingCartId, {
          schema: { versioning: { upcast: upcastDatesAndBigInt } },
        });

      assertEqual(currentStreamVersion, 1n);
      assertThatArray(events).hasSize(1);

      const event = events[0]!;
      assertEqual(event.type, 'ShoppingCartOpened');
      assertDeepEqual(event.data.openedAt, new Date(openedAtString));
      assertEqual(event.data.loyaltyPoints, BigInt(loyaltyPointsString));
    });
  });
});
