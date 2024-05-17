import {
  assertNotEmptyString,
  assertPositiveNumber,
  CommandHandler,
  type EventStore,
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
  getInitialState,
  type ProductItem,
  type ShoppingCart,
  type ShoppingCartEvent,
} from './shoppingCart';

export const handle = CommandHandler(evolve, getInitialState);

export const getShoppingCartId = (clientId: string) =>
  `shopping_cart:${assertNotEmptyString(clientId)}:current`;

export const shoppingCartApi =
  (
    eventStore: EventStore,
    getUnitPrice: (_productId: string) => Promise<number>,
    getCurrentTime: () => Date,
  ): WebApiSetup =>
  (router: Router) => {
    // Add Product Item
    router.post(
      '/clients/:clientId/shopping-carts/current/product-items',
      on(async (request: AddProductItemRequest) => {
        const shoppingCartId = getShoppingCartId(
          assertNotEmptyString(request.params.clientId),
        );
        const productId = assertNotEmptyString(request.body.productId);

        const command: AddProductItemToShoppingCart = {
          type: 'AddProductItemToShoppingCart',
          data: {
            shoppingCartId,
            productItem: {
              productId,
              quantity: assertPositiveNumber(request.body.quantity),
              unitPrice: await getUnitPrice(productId),
            },
          },
          metadata: { now: getCurrentTime() },
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
          metadata: { now: getCurrentTime() },
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
        const shoppingCartId = getShoppingCartId(
          assertNotEmptyString(request.params.clientId),
        );

        const command: ConfirmShoppingCart = {
          type: 'ConfirmShoppingCart',
          data: { shoppingCartId },
          metadata: { now: getCurrentTime() },
        };

        await handle(eventStore, shoppingCartId, (state) =>
          confirm(command, state),
        );

        return NoContent();
      }),
    );

    // Cancel Shopping Cart
    router.delete(
      '/clients/:clientId/shopping-carts/current',
      on(async (request: Request) => {
        const shoppingCartId = getShoppingCartId(
          assertNotEmptyString(request.params.clientId),
        );

        const command: CancelShoppingCart = {
          type: 'CancelShoppingCart',
          data: { shoppingCartId },
          metadata: { now: getCurrentTime() },
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

        const result = await eventStore.aggregateStream<
          ShoppingCart,
          ShoppingCartEvent
        >(shoppingCartId, {
          evolve,
          getInitialState,
        });

        if (result === null) return NotFound();

        if (result.state.status !== 'Opened') return NotFound();

        const productItems: ProductItem[] = [...result.state.productItems].map(
          ([productId, quantity]) => ({
            productId,
            quantity,
          }),
        );

        return OK({
          body: {
            clientId: assertNotEmptyString(request.params.clientId),
            id: shoppingCartId,
            productItems,
            status: result.state.status,
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
