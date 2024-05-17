/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  assertNotEmptyString,
  assertPositiveNumber,
  getInMemoryEventStore,
} from '@event-driven-io/emmett';
import { addProductItem } from '../businessLogic';
import type { AddProductItemToShoppingCart } from '../commands';
import { getShoppingCartId, handle } from './simpleApi';

import { Router } from 'express';

const router: Router = Router();

const getUnitPrice = (_productId: string) => {
  return Promise.resolve(100);
};

const eventStore = getInMemoryEventStore();

// #region getting-started-vanilla-router
import type { Request, Response } from 'express';

type AddProductItemRequest = Request<
  Partial<{ clientId: string; shoppingCartId: string }>,
  unknown,
  Partial<{ productId: string; quantity: number }>
>;

router.post(
  '/clients/:clientId/shopping-carts/current/product-items',
  async (request: AddProductItemRequest, response: Response) => {
    // 1. Translate request params to the command
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

    // 2. Handle command
    await handle(eventStore, shoppingCartId, (state) =>
      addProductItem(command, state),
    );

    // 3. Send response status
    response.sendStatus(204);
  },
);

// #endregion getting-started-vanilla-router
