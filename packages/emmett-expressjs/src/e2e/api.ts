import {
  DeciderCommandHandler,
  STREAM_DOES_NOT_EXIST,
  assertNotEmptyString,
  assertPositiveNumber,
  assertUnsignedBigInt,
  type EventStore,
} from '@event-driven-io/emmett';
import type { Request, Response, Router } from 'express';
import { sendCreated } from '..';
import {
  getETagFromIfMatch,
  getWeakETagValue,
  setETag,
  toWeakETag,
} from '../etag';
import { decider } from './businessLogic';
import { type PricedProductItem, type ProductItem } from './shoppingCart';

export const mapShoppingCartStreamId = (id: string) => `shopping_cart-${id}`;

export const handle = DeciderCommandHandler(decider, mapShoppingCartStreamId);

const dummyPriceProvider = (_productId: string) => {
  return 100;
};

export const getExpectedStreamVersion = (request: Request): bigint => {
  const eTag = getETagFromIfMatch(request);
  const weakEtag = getWeakETagValue(eTag);

  return assertUnsignedBigInt(weakEtag);
};

export const shoppingCartApi = (eventStore: EventStore) => (router: Router) => {
  // Open Shopping cart
  router.post(
    '/clients/:clientId/shopping-carts/',
    async (request: Request, response: Response) => {
      const clientId = assertNotEmptyString(request.params.clientId);
      // We're using here clientId as a shopping cart id (instead a random uuid) to make it unique per client.
      // What potential issue do you see in that?
      const shoppingCartId = clientId;

      const result = await handle(
        eventStore,
        shoppingCartId,
        {
          type: 'OpenShoppingCart',
          data: { clientId, shoppingCartId, now: new Date() },
        },
        { expectedStreamVersion: STREAM_DOES_NOT_EXIST },
      );

      setETag(response, toWeakETag(result.nextExpectedStreamVersion));
      sendCreated(response, shoppingCartId);
    },
  );

  router.post(
    '/clients/:clientId/shopping-carts/:shoppingCartId/product-items',
    async (request: AddProductItemRequest, response: Response) => {
      const shoppingCartId = assertNotEmptyString(
        request.params.shoppingCartId,
      );
      const productItem: ProductItem = {
        productId: assertNotEmptyString(request.body.productId),
        quantity: assertPositiveNumber(request.body.quantity),
      };
      const unitPrice = dummyPriceProvider(productItem.productId);

      const result = await handle(
        eventStore,
        shoppingCartId,
        {
          type: 'AddProductItemToShoppingCart',
          data: {
            shoppingCartId,
            productItem: { ...productItem, unitPrice },
          },
        },
        { expectedStreamVersion: getExpectedStreamVersion(request) },
      );

      setETag(response, toWeakETag(result.nextExpectedStreamVersion));
      response.sendStatus(204);
    },
  );

  // Remove Product Item
  router.delete(
    '/clients/:clientId/shopping-carts/:shoppingCartId/product-items',
    async (request: Request, response: Response) => {
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
        },
        { expectedStreamVersion: getExpectedStreamVersion(request) },
      );

      setETag(response, toWeakETag(result.nextExpectedStreamVersion));
      response.sendStatus(204);
    },
  );

  // Confirm Shopping Cart
  router.post(
    '/clients/:clientId/shopping-carts/:shoppingCartId/confirm',
    async (request: Request, response: Response) => {
      const shoppingCartId = assertNotEmptyString(
        request.params.shoppingCartId,
      );

      const result = await handle(
        eventStore,
        shoppingCartId,
        {
          type: 'ConfirmShoppingCart',
          data: { shoppingCartId, now: new Date() },
        },
        { expectedStreamVersion: getExpectedStreamVersion(request) },
      );

      setETag(response, toWeakETag(result.nextExpectedStreamVersion));
      response.sendStatus(204);
    },
  );

  // Cancel Shopping Cart
  router.delete(
    '/clients/:clientId/shopping-carts/:shoppingCartId',
    async (request: Request, response: Response) => {
      const shoppingCartId = assertNotEmptyString(
        request.params.shoppingCartId,
      );

      const result = await handle(
        eventStore,
        shoppingCartId,
        {
          type: 'CancelShoppingCart',
          data: { shoppingCartId, now: new Date() },
        },
        { expectedStreamVersion: getExpectedStreamVersion(request) },
      );

      setETag(response, toWeakETag(result.nextExpectedStreamVersion));
      response.sendStatus(204);
    },
  );
};

// Add Product Item
type AddProductItemRequest = Request<
  Partial<{ shoppingCartId: string }>,
  unknown,
  Partial<{ productId: number; quantity: number }>
>;
