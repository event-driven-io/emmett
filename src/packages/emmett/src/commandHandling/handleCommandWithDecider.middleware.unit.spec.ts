import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { getInMemoryEventStore } from '../eventStore';
import type { Event } from '../typing';
import { DeciderCommandHandler } from './handleCommandWithDecider';
import {
  DecisionHandling,
  after,
  before,
  rejectOn,
  stopOn,
  type Middleware,
} from './middleware';

type CartCommand =
  | { type: 'AddItem'; data: { productId: string } }
  | {
      type: 'ReserveItem';
      data: { productId: string; quantity: number; availableQuantity: number };
    }
  | { type: 'Confirm'; data: { confirmedAt: Date } };
type CartEvent =
  | Event<'ItemAdded', { productId: string }>
  | Event<'CartConfirmed', { confirmedAt: Date }>
  | Event<'ProductItemAlreadyInCart', { productId: string }>
  | Event<
      'ProductItemOutOfStock',
      {
        productId: string;
        requestedQuantity: number;
        availableQuantity: number;
      }
    >
  | Event<'ShoppingCartConfirmationFailed', { reason: 'EmptyCart' }>
  | Event<
      'ShoppingCartItemLimitReached',
      { maximumItems: number; requestedProductId: string }
    >;
type Cart = { items: string[]; confirmed: boolean };

const maximumItems = 2;
const initialState = (): Cart => ({ items: [], confirmed: false });
const evolve = (state: Cart, event: CartEvent): Cart => {
  if (event.type === 'ItemAdded')
    return { ...state, items: [...state.items, event.data.productId] };
  if (event.type === 'CartConfirmed') return { ...state, confirmed: true };
  return state;
};
const decide = (command: CartCommand, state: Cart): CartEvent => {
  if (command.type === 'AddItem')
    return state.items.includes(command.data.productId)
      ? {
          type: 'ProductItemAlreadyInCart',
          data: { productId: command.data.productId },
        }
      : { type: 'ItemAdded', data: { productId: command.data.productId } };
  if (command.type === 'Confirm')
    return state.items.length === 0
      ? {
          type: 'ShoppingCartConfirmationFailed',
          data: { reason: 'EmptyCart' },
        }
      : { type: 'CartConfirmed', data: command.data };
  if (command.data.quantity > command.data.availableQuantity)
    return {
      type: 'ProductItemOutOfStock',
      data: {
        productId: command.data.productId,
        requestedQuantity: command.data.quantity,
        availableQuantity: command.data.availableQuantity,
      },
    };
  return state.items.length >= maximumItems
    ? {
        type: 'ShoppingCartItemLimitReached',
        data: { maximumItems, requestedProductId: command.data.productId },
      }
    : { type: 'ItemAdded', data: { productId: command.data.productId } };
};

// #region custom-decision-middleware
const { appendAndStop, reject, skip, stop } = DecisionHandling.result;

const selectCartHandling: Middleware<CartCommand, Cart, CartEvent> =
  (next) => async (command, state) => {
    const result = await next(command, state);

    if (
      result.outputs.some((event) => event.type === 'ProductItemAlreadyInCart')
    )
      return skip(result.outputs);
    if (
      result.outputs.some(
        (event) => event.type === 'ShoppingCartConfirmationFailed',
      )
    )
      return stop(result.outputs);
    if (result.outputs.some((event) => event.type === 'ProductItemOutOfStock'))
      return reject(result.outputs);
    if (
      result.outputs.some(
        (event) => event.type === 'ShoppingCartItemLimitReached',
      )
    )
      return appendAndStop(result.outputs);
    return result;
  };
// #endregion custom-decision-middleware

describe('DeciderCommandHandler middleware', () => {
  it('runs invocation hooks once and decision hooks for every command', async () => {
    const eventStore = getInMemoryEventStore();
    const shoppingCartId = randomUUID();
    const lifecycle: string[] = [];
    const authorizeCommands = (commands: CartCommand | CartCommand[]) => {
      lifecycle.push(`batch:${Array.isArray(commands) ? commands.length : 1}`);
    };
    const authorizeCommand = (command: CartCommand) => {
      lifecycle.push(`command:${command.type}`);
    };
    const logResult = (command: CartCommand, result: { type: string }) => {
      lifecycle.push(`decision:${command.type}:${result.type}`);
    };
    const recordInvocation = (result: { appendedEvents: CartEvent[] }) => {
      lifecycle.push(`appended:${result.appendedEvents.length}`);
    };

    // #region decider-command-middleware
    const handle = DeciderCommandHandler<Cart, CartCommand, CartEvent>({
      evolve,
      initialState,
      decide,
      middleware: {
        beforeAll: authorizeCommands,
        afterAll: recordInvocation,
        decision: [
          before(authorizeCommand),
          after((result, command) => {
            logResult(command, result);
            return result;
          }),
        ],
      },
    });

    const commands: CartCommand[] = [
      { type: 'AddItem', data: { productId: 'product-1' } },
      { type: 'Confirm', data: { confirmedAt: new Date() } },
    ];
    const result = await handle(eventStore, shoppingCartId, commands);
    // #endregion decider-command-middleware

    expect(result.appendedEvents.map((event) => event.type)).toEqual([
      'ItemAdded',
      'CartConfirmed',
    ]);
    expect(lifecycle).toEqual([
      'batch:2',
      'command:AddItem',
      'decision:AddItem:APPEND',
      'command:Confirm',
      'decision:Confirm:APPEND',
      'appended:2',
    ]);
  });

  it('passes rebuilt state to each command middleware call', async () => {
    const itemCounts: number[] = [];
    const handle = DeciderCommandHandler({
      evolve,
      initialState,
      decide,
      middleware: [
        before((_command, state) => {
          itemCounts.push(state.items.length);
        }),
      ],
    });

    await handle(getInMemoryEventStore(), randomUUID(), [
      { type: 'AddItem', data: { productId: 'product-1' } },
      { type: 'AddItem', data: { productId: 'product-2' } },
    ]);

    expect(itemCounts).toEqual([0, 1]);
  });

  it('distinguishes stopping a batch from rejecting it', async () => {
    const commands: CartCommand[] = [
      { type: 'AddItem', data: { productId: 'product-1' } },
      {
        type: 'ReserveItem',
        data: {
          productId: 'product-2',
          quantity: 3,
          availableQuantity: 2,
        },
      },
      { type: 'Confirm', data: { confirmedAt: new Date() } },
    ];
    const createHandler = (
      middleware: Middleware<CartCommand, Cart, CartEvent>,
    ) =>
      DeciderCommandHandler({
        evolve,
        initialState,
        decide,
        middleware: [middleware],
      });

    const stopped = await createHandler(
      stopOn((event) => event.type === 'ProductItemOutOfStock'),
    )(getInMemoryEventStore(), randomUUID(), commands);
    const rejected = await createHandler(
      rejectOn((event) => event.type === 'ProductItemOutOfStock'),
    )(getInMemoryEventStore(), randomUUID(), commands);

    expect(stopped.appendedEvents.map((event) => event.type)).toEqual([
      'ItemAdded',
    ]);
    expect(rejected.appendedEvents).toEqual([]);
  });

  it('supports all handling results from custom middleware', async () => {
    const handle = DeciderCommandHandler({
      evolve,
      initialState,
      decide,
      middleware: [selectCartHandling],
    });

    const duplicate = await handle(getInMemoryEventStore(), randomUUID(), [
      { type: 'AddItem', data: { productId: 'product-1' } },
      { type: 'AddItem', data: { productId: 'product-1' } },
    ]);
    const stopped = await handle(getInMemoryEventStore(), randomUUID(), {
      type: 'Confirm',
      data: { confirmedAt: new Date() },
    });
    const rejected = await handle(getInMemoryEventStore(), randomUUID(), {
      type: 'ReserveItem',
      data: {
        productId: 'product-1',
        quantity: 2,
        availableQuantity: 1,
      },
    });
    const terminal = await handle(getInMemoryEventStore(), randomUUID(), [
      { type: 'AddItem', data: { productId: 'product-1' } },
      { type: 'AddItem', data: { productId: 'product-2' } },
      {
        type: 'ReserveItem',
        data: {
          productId: 'product-3',
          quantity: 1,
          availableQuantity: 1,
        },
      },
      { type: 'Confirm', data: { confirmedAt: new Date() } },
    ]);

    expect(duplicate.appendedEvents.map((event) => event.type)).toEqual([
      'ItemAdded',
    ]);
    expect(stopped.appendedEvents).toEqual([]);
    expect(rejected.appendedEvents).toEqual([]);
    expect(terminal.appendedEvents.map((event) => event.type)).toEqual([
      'ItemAdded',
      'ItemAdded',
      'ShoppingCartItemLimitReached',
    ]);
  });
});
