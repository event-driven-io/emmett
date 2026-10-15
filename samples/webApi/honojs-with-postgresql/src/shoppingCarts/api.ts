import {
  assertNotEmptyString,
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
  addProductItemToCurrentShoppingCart,
  cancelCurrentShoppingCart,
  confirmCurrentShoppingCart,
  getShoppingCartId,
  removeProductItemFromCurrentShoppingCart,
} from './application';
import { getClientShoppingSummary } from './getClientShoppingSummary';
import { getDetailsById } from './getDetails';

export { getShoppingCartId } from './application';

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
        const body = await context.req.json();

        await addProductItemToCurrentShoppingCart({
          eventStore,
          getUnitPrice,
          getCurrentTime,
          clientId: context.req.param('clientId'),
          productId: body.productId,
          quantity: body.quantity,
        });

        return NoContent({ context });
      },
    );

    // Remove Product Item
    router.delete(
      '/clients/:clientId/shopping-carts/current/product-items',
      async (context: Context) => {
        const query = context.req.query();

        await removeProductItemFromCurrentShoppingCart({
          eventStore,
          getCurrentTime,
          clientId: context.req.param('clientId'),
          productItem: {
            productId: query.productId,
            quantity: Number(query.quantity),
            unitPrice: Number(query.unitPrice),
          },
        });

        return NoContent({ context });
      },
    );

    // Confirm Shopping Cart
    router.post(
      '/clients/:clientId/shopping-carts/current/confirm',
      async (context: Context) => {
        await confirmCurrentShoppingCart({
          eventStore,
          eventPublisher,
          getCurrentTime,
          clientId: context.req.param('clientId'),
        });

        return NoContent({ context });
      },
    );

    // Cancel Shopping Cart
    router.delete(
      '/clients/:clientId/shopping-carts/current',
      async (context: Context) => {
        await cancelCurrentShoppingCart({
          eventStore,
          getCurrentTime,
          clientId: context.req.param('clientId'),
        });

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
