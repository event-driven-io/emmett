/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import {
  DeciderCommandHandler,
  assertNotEmptyString,
  assertPositiveNumber,
  assertUnsignedBigInt,
  type EventStore,
} from '@event-driven-io/emmett';
import {
  NoContent,
  getETagValueFromIfMatch,
  on,
  toWeakETag,
} from '@event-driven-io/emmett-expressjs';
import { type Request, type Router } from 'express';
import { decider } from '../businessLogic';
import { type PricedProductItem, type ProductItem } from './shoppingCart';

export const handle = DeciderCommandHandler(decider);

const priceProvider = (_productId: string) => {
  return 100;
};

export const shoppingCartApi = (eventStore: EventStore) => (router: Router) => {
  router.post(
    '/clients/:clientId/shopping-carts/:shoppingCartId/product-items',
    on(async (request: AddProductItemRequest) => {
      const shoppingCartId = assertNotEmptyString(
        request.params.shoppingCartId,
      );
      const productItem: ProductItem = {
        productId: assertNotEmptyString(request.body.productId),
        quantity: assertPositiveNumber(request.body.quantity),
      };
      const unitPrice = priceProvider(productItem.productId);

      const result = await handle(
        eventStore,
        shoppingCartId,
        {
          type: 'AddProductItemToShoppingCart',
          data: {
            shoppingCartId,
            productItem: { ...productItem, unitPrice },
          },
          metadata: { now: new Date() },
        },
        {
          expectedStreamVersion: assertUnsignedBigInt(
            getETagValueFromIfMatch(request),
          ),
        },
      );

      return NoContent({ eTag: toWeakETag(result.nextExpectedStreamVersion) });
    }),
  );

  // Remove Product Item
  router.delete(
    '/clients/:clientId/shopping-carts/:shoppingCartId/product-items',
    on(async (request: Request) => {
      const shoppingCartId = assertNotEmptyString(
        request.params.shoppingCartId,
      );
      const productItem: PricedProductItem = {
        productId: assertNotEmptyString(request.query.productId),
        quantity: assertPositiveNumber(Number(request.query.quantity)),
        unitPrice: assertPositiveNumber(Number(request.query.unitPrice)),
      };

      const result = await handle(
        eventStore,
        shoppingCartId,
        {
          type: 'RemoveProductItemFromShoppingCart',
          data: { shoppingCartId, productItem },
          metadata: { now: new Date() },
        },
        {
          expectedStreamVersion: assertUnsignedBigInt(
            getETagValueFromIfMatch(request),
          ),
        },
      );

      return NoContent({ eTag: toWeakETag(result.nextExpectedStreamVersion) });
    }),
  );

  // Confirm Shopping Cart
  router.post(
    '/clients/:clientId/shopping-carts/:shoppingCartId/confirm',
    on(async (request: Request) => {
      const shoppingCartId = assertNotEmptyString(
        request.params.shoppingCartId,
      );

      const result = await handle(
        eventStore,
        shoppingCartId,
        {
          type: 'ConfirmShoppingCart',
          data: { shoppingCartId },
          metadata: { now: new Date() },
        },
        {
          expectedStreamVersion: assertUnsignedBigInt(
            getETagValueFromIfMatch(request),
          ),
        },
      );

      return NoContent({ eTag: toWeakETag(result.nextExpectedStreamVersion) });
    }),
  );

  // Cancel Shopping Cart
  router.delete(
    '/clients/:clientId/shopping-carts/:shoppingCartId',
    on(async (request: Request) => {
      const shoppingCartId = assertNotEmptyString(
        request.params.shoppingCartId,
      );

      const result = await handle(
        eventStore,
        shoppingCartId,
        {
          type: 'CancelShoppingCart',
          data: { shoppingCartId },
          metadata: { now: new Date() },
        },
        {
          expectedStreamVersion: assertUnsignedBigInt(
            getETagValueFromIfMatch(request),
          ),
        },
      );

      return NoContent({ eTag: toWeakETag(result.nextExpectedStreamVersion) });
    }),
  );
};

// Add Product Item
type AddProductItemRequest = Request<
  Partial<{ shoppingCartId: string }>,
  unknown,
  Partial<{ productId: number; quantity: number }>
>;
