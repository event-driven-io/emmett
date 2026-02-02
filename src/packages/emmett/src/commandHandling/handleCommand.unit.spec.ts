import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  ExpectedVersionConflictError,
  getInMemoryEventStore,
} from '../eventStore';
import {
  assertDeepEqual,
  assertEqual,
  assertFalse,
  assertThatArray,
  assertThrowsAsync,
  assertTrue,
} from '../testing';
import { type Event } from '../typing';
import { CommandHandler } from './handleCommand';

// Events & Entity

type PricedProductItem = { productId: string; quantity: number; price: number };

type ShoppingCart = {
  productItems: PricedProductItem[];
  totalAmount: number;
};

type ProductItemAdded = Event<
  'ProductItemAdded',
  { productItem: PricedProductItem }
>;
type DiscountApplied = Event<'DiscountApplied', { percent: number }>;

type ShoppingCartEvent = ProductItemAdded | DiscountApplied;

const evolve = (
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
        totalAmount: state.totalAmount * (1 - data.percent),
      };
  }
};

const initialState = (): ShoppingCart => {
  return { productItems: [], totalAmount: 0 };
};

// Decision making

type AddProductItem = Event<
  'AddProductItem',
  { productItem: PricedProductItem }
>;

const addProductItem = (
  command: AddProductItem,
  _state: ShoppingCart,
): ShoppingCartEvent => {
  return {
    type: 'ProductItemAdded',
    data: { productItem: command.data.productItem },
  };
};

const defaultDiscount = 0.1;

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

    const { nextExpectedStreamVersion, newState, newEvents, createdNewStream } =
      await handleCommand(eventStore, shoppingCartId, (state) =>
        addProductItem(command, state),
      );

    assertTrue(createdNewStream);
    assertThatArray(newEvents).hasSize(1);
    assertDeepEqual(newState, {
      productItems: [productItem],
      totalAmount: productItem.price * productItem.quantity,
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

    const { nextExpectedStreamVersion, newState, newEvents, createdNewStream } =
      await handleCommand(
        eventStore,
        shoppingCartId,
        (state) => addProductItem(command, state),
        { expectedStreamVersion: 'STREAM_DOES_NOT_EXIST' },
      );

    assertTrue(createdNewStream);
    assertThatArray(newEvents).hasSize(1);
    assertDeepEqual(newState, {
      productItems: [productItem],
      totalAmount: productItem.price * productItem.quantity,
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

    const { newState: state1, nextExpectedStreamVersion } = await handleCommand(
      eventStore,
      shoppingCartId,
      (state) => addProductItem(command, state),
    );

    assertDeepEqual(state1, {
      productItems: [productItem],
      totalAmount: productItem.price * productItem.quantity,
    });
    assertEqual(nextExpectedStreamVersion, 1n);

    const { nextExpectedStreamVersion: version2 } = await handleCommand(
      eventStore,
      shoppingCartId,
      (state) => addProductItem(command, state),
      { expectedStreamVersion: nextExpectedStreamVersion },
    );

    assertEqual(version2, 2n);
  });

  void it('can handle multiple commands at once', async () => {
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

    const { newState: state1, nextExpectedStreamVersion } = await handleCommand(
      eventStore,
      shoppingCartId,
      [
        (state) => addProductItem(command, state),
        (state) => addProductItem(command, state),
      ],
    );

    assertDeepEqual(state1, {
      productItems: [productItem, productItem],
      totalAmount: productItem.price * productItem.quantity * 2,
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
          if (tried++ === 0) throw new ExpectedVersionConflictError(0, 1);
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

      const {
        nextExpectedStreamVersion,
        newState,
        newEvents,
        createdNewStream,
      } = await handleCommand(eventStore, shoppingCartId, (state) =>
        addProductItemWithDiscount(command, state),
      );

      assertTrue(createdNewStream);
      assertThatArray(newEvents).hasSize(2);
      assertDeepEqual(newState, {
        productItems: [productItem],
        totalAmount:
          productItem.price * productItem.quantity * (1 - defaultDiscount),
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
              throw new ExpectedVersionConflictError(0, 1);
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
          if (tried++ < 3) throw new ExpectedVersionConflictError(0, 1);
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
            throw new ExpectedVersionConflictError(0, 1);
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
      | ProductItemAddedFromDB
      | DiscountAppliedFromDB;

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
      | ShoppingCartOpened
      | ProductItemAdded
      | DiscountApplied;

    type ShoppingCartOpenedFromDB = Event<
      'ShoppingCartOpened',
      { clientId: string; openedAt: string; loyaltyPoints: string }
    >;

    type ShoppingCartEventFromDB =
      | ShoppingCartOpenedFromDB
      | ProductItemAdded
      | DiscountApplied;

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
