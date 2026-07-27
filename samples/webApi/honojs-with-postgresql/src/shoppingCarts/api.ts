import {
  assertNotEmptyString,
  assertPositiveNumber,
  CommandHandler,
  type EventsPublisher,
  type EventStore,
} from '@event-driven-io/emmett';
import {
  type ContextWithBody,
  type ContextWithParams,
  NoContent,
  NotFound,
  OK,
  type WebApiSetup,
} from '@event-driven-io/emmett-honojs';
import { type PongoDb } from '@event-driven-io/pongo';
import type { Context, Hono } from 'hono';
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
import { getClientShoppingSummary } from './getClientShoppingSummary';
import { getDetailsById } from './getDetails';
import { evolve, initialState } from './shoppingCart';

export const getShoppingCartId = (clientId: string) =>
  `shopping_cart:${assertNotEmptyString(clientId)}:current`;

const handle = CommandHandler({ evolve, initialState });

export const shoppingCartApi =
  (
    eventStore: EventStore,
    readStore: PongoDb,
    eventPublisher: EventsPublisher,
    getUnitPrice: (_productId: string) => Promise<number>,
    getCurrentTime: () => Date,
  ): WebApiSetup =>
  (router: Hono) => {
    // Add Product Item
    router.post(
      '/clients/:clientId/shopping-carts/current/product-items',
      async (context: AddProductItemContext) => {
        const clientId = assertNotEmptyString(context.req.param('clientId'));
        const shoppingCartId = getShoppingCartId(clientId);
        const body = await context.req.json();
        const productId = assertNotEmptyString(body.productId);

        const command: AddProductItemToShoppingCart = {
          type: 'AddProductItemToShoppingCart',
          data: {
            shoppingCartId,
            clientId,
            productItem: {
              productId,
              quantity: assertPositiveNumber(body.quantity),
              unitPrice: await getUnitPrice(productId),
            },
          },
          metadata: { clientId, now: getCurrentTime() },
        };

        await handle(eventStore, shoppingCartId, (state) =>
          addProductItem(command, state),
        );

        return NoContent({ context });
      },
    );

    // Remove Product Item
    router.delete(
      '/clients/:clientId/shopping-carts/current/product-items',
      async (context: Context) => {
        const clientId = assertNotEmptyString(context.req.param('clientId'));
        const shoppingCartId = getShoppingCartId(
          assertNotEmptyString(context.req.param('clientId')),
        );
        const query = context.req.query();

        const command: RemoveProductItemFromShoppingCart = {
          type: 'RemoveProductItemFromShoppingCart',
          data: {
            shoppingCartId,
            productItem: {
              productId: assertNotEmptyString(query.productId),
              quantity: assertPositiveNumber(Number(query.quantity)),
              unitPrice: assertPositiveNumber(Number(query.unitPrice)),
            },
          },
          metadata: { clientId, now: getCurrentTime() },
        };

        await handle(eventStore, shoppingCartId, (state) =>
          removeProductItem(command, state),
        );

        return NoContent({ context });
      },
    );

    // Confirm Shopping Cart
    router.post(
      '/clients/:clientId/shopping-carts/current/confirm',
      async (context: Context) => {
        const clientId = assertNotEmptyString(context.req.param('clientId'));
        const shoppingCartId = getShoppingCartId(
          assertNotEmptyString(context.req.param('clientId')),
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

        return NoContent({ context });
      },
    );

    // Cancel Shopping Cart
    router.delete(
      '/clients/:clientId/shopping-carts/current',
      async (context: Context) => {
        const clientId = assertNotEmptyString(context.req.param('clientId'));
        const shoppingCartId = getShoppingCartId(
          assertNotEmptyString(context.req.param('clientId')),
        );

        const command: CancelShoppingCart = {
          type: 'CancelShoppingCart',
          data: { shoppingCartId },
          metadata: { clientId, now: getCurrentTime() },
        };

        await handle(eventStore, shoppingCartId, (state) =>
          cancel(command, state),
        );

        return NoContent({ context });
      },
    );

    // Get Shopping Cart
    router.get(
      '/clients/:clientId/shopping-carts/current',
      async (context: Context) => {
        const shoppingCartId = getShoppingCartId(
          assertNotEmptyString(context.req.param('clientId')),
        );

        const result = await getDetailsById(readStore, shoppingCartId);

        if (result === null)
          return NotFound({
            context,
            problemDetails: 'Shopping cart not found',
          });

        if (result.status !== 'Opened')
          return NotFound({
            context,
            problemDetails: 'Shopping cart not found',
          });

        return OK({
          context,
          body: excludeKey(result, '_version'),
        });
      },
    );

    // Get Shopping Cart Summary
    router.get(
      '/clients/:clientId/shopping-carts/summary',
      async (context: Context) => {
        const clientId = assertNotEmptyString(context.req.param('clientId'));

        const result = await getClientShoppingSummary(readStore, clientId);

        if (result === null)
          return NotFound({
            context,
            problemDetails: 'Shopping cart summary not found',
          });

        return OK({
          context,
          body: excludeKey(result, '_version'),
        });
      },
    );
  };

type AddProductItemContext = ContextWithBody<{
  productId?: string;
  quantity?: number;
}> &
  ContextWithParams<{
    clientId?: string;
  }>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const excludeKey = <T extends object, U extends keyof any>(obj: T, key: U) => {
  const { [key]: _, ...newObj } = obj;
  return newObj;
};
