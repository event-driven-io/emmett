import {
  CommandHandler,
  assertNotEmptyString,
  assertPositiveNumber,
  getInMemoryEventStore,
} from '@event-driven-io/emmett';
import { NoContent, on } from '@event-driven-io/emmett-expressjs';
import { Router, type Request } from 'express';
import { addProductItem } from '../businessLogic';
import type { AddProductItemToShoppingCart } from '../commands';
import { evolve, initialState } from '../shoppingCart';
import { getShoppingCartId } from './simpleApi';

const handle = CommandHandler(evolve, initialState);
const router: Router = Router();

const getUnitPrice = (_productId: string) => {
  return Promise.resolve(100);
};

const eventStore = getInMemoryEventStore();

type AddProductItemRequest = Request<
  Partial<{ clientId: string; shoppingCartId: string }>,
  unknown,
  Partial<{ productId: string; quantity: number }>
>;

// #region getting-started-on-router
router.post(
  '/clients/:clientId/shopping-carts/current/product-items',
  on(async (request: AddProductItemRequest) => {
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

    // 3. Return response status
    return NoContent();
  }),
);

// #endregion getting-started-on-router
