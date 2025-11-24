import {
  CommandHandler,
  assertNotEmptyString,
  assertPositiveNumber,
  type EventStore,
  type EventsPublisher,
} from '@event-driven-io/emmett';
import {
  NoContent,
  NotFound,
  OK,
  on,
  type WebApiSetup,
} from '@event-driven-io/emmett-expressjs';
import type { SQLiteConnectionPool } from '@event-driven-io/emmett-sqlite';
import { type Request, type Router } from 'express';
import {
  addProductItem,
  cancel,
  confirm,
  removeProductItem,
  type AddProductItemToShoppingCart,
  type CancelShoppingCart,
  type ConfirmShoppingCart,
  type RemoveProductItemFromShoppingCart,
} from './businessLogic';
import { getDetailsById } from './getDetails';
import { evolve, initialState } from './shoppingCart';

export const handle = CommandHandler({ evolve, initialState });

export const getShoppingCartId = (clientId: string) =>
  `shopping_cart:${assertNotEmptyString(clientId)}:current`;

export const shoppingCartApi =
  (
    eventStore: EventStore,
    pool: SQLiteConnectionPool,
    eventPublisher: EventsPublisher,
    getUnitPrice: (_productId: string) => Promise<number>,
    getCurrentTime: () => Date,
  ): WebApiSetup =>
  (router: Router) => {
    // Add Product Item
    router.post(
      '/clients/:clientId/shopping-carts/current/product-items',
      on(async (request: AddProductItemRequest) => {
        const clientId = assertNotEmptyString(request.params.clientId);
        const shoppingCartId = getShoppingCartId(clientId);
        const productId = assertNotEmptyString(request.body.productId);

        const command: AddProductItemToShoppingCart = {
          type: 'AddProductItemToShoppingCart',
          data: {
            shoppingCartId,
            clientId,
            productItem: {
              productId,
              quantity: assertPositiveNumber(request.body.quantity),
              unitPrice: await getUnitPrice(productId),
            },
          },
          metadata: { clientId, now: getCurrentTime() },
        };

        await handle(eventStore, shoppingCartId, (state) =>
          addProductItem(command, state),
        );

        return NoContent();
      }),
    );

    // Remove Product Item
    router.delete(
      '/clients/:clientId/shopping-carts/current/product-items',
      on(async (request: Request) => {
        const clientId = assertNotEmptyString(request.params.clientId);
        const shoppingCartId = getShoppingCartId(
          assertNotEmptyString(request.params.clientId),
        );

        const command: RemoveProductItemFromShoppingCart = {
          type: 'RemoveProductItemFromShoppingCart',
          data: {
            shoppingCartId,
            productItem: {
              productId: assertNotEmptyString(request.query.productId),
              quantity: assertPositiveNumber(Number(request.query.quantity)),
              unitPrice: assertPositiveNumber(Number(request.query.unitPrice)),
            },
          },
          metadata: { clientId, now: getCurrentTime() },
        };

        await handle(eventStore, shoppingCartId, (state) =>
          removeProductItem(command, state),
        );

        return NoContent();
      }),
    );

    // Confirm Shopping Cart
    router.post(
      '/clients/:clientId/shopping-carts/current/confirm',
      on(async (request: Request) => {
        const clientId = assertNotEmptyString(request.params.clientId);
        const shoppingCartId = getShoppingCartId(
          assertNotEmptyString(request.params.clientId),
        );

        const command: ConfirmShoppingCart = {
          type: 'ConfirmShoppingCart',
          data: { shoppingCartId },
          metadata: { clientId, now: getCurrentTime() },
        };

        const {
          newEvents: [confirmed, ..._rest],
        } = await handle(eventStore, shoppingCartId, (state) =>
          confirm(command, state),
        );

        // This is just example, it'll run in-proc
        // so don't do that if you care about delivery guarantees
        await eventPublisher.publish(confirmed);

        return NoContent();
      }),
    );

    // Cancel Shopping Cart
    router.delete(
      '/clients/:clientId/shopping-carts/current',
      on(async (request: Request) => {
        const clientId = assertNotEmptyString(request.params.clientId);
        const shoppingCartId = getShoppingCartId(
          assertNotEmptyString(request.params.clientId),
        );

        const command: CancelShoppingCart = {
          type: 'CancelShoppingCart',
          data: { shoppingCartId },
          metadata: { clientId, now: getCurrentTime() },
        };

        await handle(eventStore, shoppingCartId, (state) =>
          cancel(command, state),
        );

        return NoContent();
      }),
    );

    // Get Shopping Cart
    router.get(
      '/clients/:clientId/shopping-carts/current',
      on(async (request: GetShoppingCartRequest) => {
        const shoppingCartId = getShoppingCartId(
          assertNotEmptyString(request.params.clientId),
        );

        const result = await pool.withConnection((readStore) =>
          getDetailsById(readStore, shoppingCartId),
        );

        if (result === null) return NotFound();

        if (result.status !== 'Opened') return NotFound();

        return OK({
          body: excludeKey(result, '_version'),
        });
      }),
    );

    // // Get Shopping Cart Summary
    // router.get(
    //   '/clients/:clientId/shopping-carts/summary',
    //   on(async (request: GetShoppingCartRequest) => {
    //     const clientId = assertNotEmptyString(request.params.clientId);

    //     const result = await pool.withConnection((connection) =>
    //       getClientShoppingSummary(connection, shoppingCartId)
    //     );

    //     if (result === null) return NotFound();

    //     return OK({
    //       body: excludeKey(result, '_version'),
    //     });
    //   }),
    // );
  };

// Add Product Item
type AddProductItemRequest = Request<
  Partial<{ clientId: string; shoppingCartId: string }>,
  unknown,
  Partial<{ productId: string; quantity: number }>
>;

type GetShoppingCartRequest = Request<
  Partial<{ clientId: string }>,
  unknown,
  unknown
>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const excludeKey = <T extends object, U extends keyof any>(obj: T, key: U) => {
  const { [key]: _, ...newObj } = obj;
  return newObj;
};
