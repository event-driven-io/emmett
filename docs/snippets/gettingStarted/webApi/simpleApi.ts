import {
  assertNotEmptyString,
  assertPositiveNumber,
  CommandHandler,
  type EventStore,
} from '@event-driven-io/emmett';
import { NoContent, on } from '@event-driven-io/emmett-expressjs';
import { type Request, type Router } from 'express';
import {
  addProductItem,
  cancel,
  confirm,
  removeProductItem,
} from '../businessLogic';
import type {
  AddProductItemToShoppingCart,
  CancelShoppingCart,
  ConfirmShoppingCart,
  RemoveProductItemFromShoppingCart,
} from '../commands';
import { evolve, getInitialState } from '../shoppingCart';

export const handle = CommandHandler(evolve, getInitialState);

export const getShoppingCartId = (clientId: string) =>
  `shopping_cart:${assertNotEmptyString(clientId)}:current`;

const getUnitPrice = (_productId: string) => {
  return Promise.resolve(100);
};

export const shoppingCartApi = (eventStore: EventStore) => (router: Router) => {
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
      };

      await handle(eventStore, shoppingCartId, (state) =>
        cancel(command, state),
      );

      return NoContent();
    }),
  );
};

// Add Product Item
type AddProductItemRequest = Request<
  Partial<{ clientId: string; shoppingCartId: string }>,
  unknown,
  Partial<{ productId: number; quantity: number }>
>;
