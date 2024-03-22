/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  CommandHandler,
  IllegalStateError,
  assertNotEmptyString,
  assertPositiveNumber,
  type Command,
  type EventStore,
} from '@event-driven-io/emmett';
import {
  NoContent,
  on,
  type WebApiSetup,
} from '@event-driven-io/emmett-expressjs';
import { Router, type Request } from 'express';
import type { ProductItemAddedToShoppingCart } from '../events';
import { type PricedProductItem } from '../events';
import { evolve, getInitialState, type ShoppingCart } from '../shoppingCart';
import { getShoppingCartId } from './simpleApi';

// #region vertical-slice

const handle = CommandHandler(evolve, getInitialState);

type AddProductItemRequest = Request<
  Partial<{ clientId: string; shoppingCartId: string }>,
  unknown,
  Partial<{ productId: number; quantity: number }>
>;

////////////////////////////////////////////////////
// Web Api
////////////////////////////////////////////////////

export const shoppingCartApi =
  (
    // external dependencies
    eventStore: EventStore,
    getUnitPrice: (productId: string) => Promise<number>,
  ): WebApiSetup =>
  (router: Router): void => {
    ////////////////////////////////////////////////////
    // Endpoint
    ////////////////////////////////////////////////////
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
    // (...) other endpoints
  };

////////////////////////////////////////////////////
// Business Logic
////////////////////////////////////////////////////

export type AddProductItemToShoppingCart = Command<
  'AddProductItemToShoppingCart',
  {
    shoppingCartId: string;
    productItem: PricedProductItem;
  }
>;

export const addProductItem = (
  command: AddProductItemToShoppingCart,
  state: ShoppingCart,
): ProductItemAddedToShoppingCart => {
  if (state.status === 'Closed')
    throw new IllegalStateError('Shopping Cart already closed');

  const {
    data: { shoppingCartId, productItem },
    metadata,
  } = command;

  return {
    type: 'ProductItemAddedToShoppingCart',
    data: {
      shoppingCartId,
      productItem,
      addedAt: metadata?.now ?? new Date(),
    },
  };
};

// #endregion vertical-slice
