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
import {
  evolve,
  initialState,
  type PricedProductItem,
  type ShoppingCartEvent,
  type ShoppingCart,
} from './shoppingCart';

export const handle = CommandHandler({ evolve, initialState });

export const getShoppingCartId = (clientId: string) =>
  `shopping_cart:${assertNotEmptyString(clientId)}:current`;

export const shoppingCartApi =
  (
    eventStore: EventStore,
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

    // Get Shopping Cart (using aggregateStream — no projections needed)
    router.get(
      '/clients/:clientId/shopping-carts/current',
      on(async (request: GetShoppingCartRequest) => {
        const clientId = assertNotEmptyString(request.params.clientId);
        const shoppingCartId = getShoppingCartId(clientId);

        const result = await eventStore.aggregateStream<
          ShoppingCart,
          ShoppingCartEvent
        >(shoppingCartId, {
          evolve,
          initialState,
        });

        if (!result.streamExists) return NotFound();

        const state = result.state;

        if (state.status !== 'Opened') return NotFound();

        const productItems: (PricedProductItem & { totalPrice: number })[] = [];
        for (const [productId, item] of state.productItems) {
          productItems.push({
            productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.quantity * item.unitPrice,
          });
        }

        return OK({
          body: {
            clientId,
            id: shoppingCartId,
            productItems,
            status: 'Opened',
          },
        });
      }),
    );
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
