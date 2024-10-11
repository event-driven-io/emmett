/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  CommandHandler,
  assertNotEmptyString,
  assertPositiveNumber,
  getInMemoryEventStore,
  type EventStore,
} from '@event-driven-io/emmett';
import { NoContent, on } from '@event-driven-io/emmett-expressjs';
import { addProductItem } from '../businessLogic';
import type { AddProductItemToShoppingCart } from '../commands';
import { getShoppingCartId } from './simpleApi';

// #region getting-started-api-setup
import { type WebApiSetup } from '@event-driven-io/emmett-expressjs';
import { Router } from 'express';
import { evolve, initialState } from '../shoppingCart';

// Let's setup the command handler, we'll use it in endpoints
const handle = CommandHandler({ evolve, initialState });

export const shoppingCartApi =
  (
    // external dependencies
    eventStore: EventStore,
    getUnitPrice: (productId: string) => Promise<number>,
  ): WebApiSetup =>
  (router: Router): void => {
    // We'll setup routes here
  };

// #endregion getting-started-api-setup

const router: Router = Router();

const getUnitPrice = (_productId: string) => {
  return Promise.resolve(100);
};

const eventStore = getInMemoryEventStore();

import { type Request } from 'express';

type AddProductItemRequest = Request<
  Partial<{ clientId: string; shoppingCartId: string }>,
  unknown,
  Partial<{ productId: string; quantity: number }>
>;

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
