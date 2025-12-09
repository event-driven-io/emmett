import {
  assertNotEmptyString,
  assertPositiveNumber,
  assertUnsignedBigInt,
  DeciderCommandHandler,
  type EventStore,
  type ReadEventMetadataWithGlobalPosition,
  STREAM_DOES_NOT_EXIST,
} from '@event-driven-io/emmett';
import type { Context, Hono } from 'hono';
import {
  type ContextWithBody,
  type ContextWithParams,
  Created,
  getETagValueFromIfMatch,
  NoContent,
  toWeakETag,
} from '../..';
import { decider } from './businessLogic';
import { type PricedProductItem, type ProductItem } from './shoppingCart';

type AddProductItemContext = ContextWithBody<{
  productId: string;
  quantity: number;
}> &
  ContextWithParams<{
    shoppingCartId: string;
    clientId: string;
  }>;

export const handle = DeciderCommandHandler(decider);

const dummyPriceProvider = (_productId: string) => {
  return 100;
};

export const shoppingCartApi =
  (eventStore: EventStore<ReadEventMetadataWithGlobalPosition>) =>
  (router: Hono) => {
    // Open Shopping cart
    // #region created-example
    router.post(
      '/clients/:clientId/shopping-carts/',
      async (context: Context) => {
        const clientId = assertNotEmptyString(context.req.param('clientId'));
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

        return Created({
          context,
          createdId: shoppingCartId,
          eTag: toWeakETag(result.nextExpectedStreamVersion),
        });
      },
    );
    // #endregion created-example

    router.post(
      '/clients/:clientId/shopping-carts/:shoppingCartId/product-items',
      async (context: AddProductItemContext) => {
        const shoppingCartId = assertNotEmptyString(
          context.req.param('shoppingCartId'),
        );
        const body = await context.req.json();
        const productItem: ProductItem = {
          productId: assertNotEmptyString(body.productId),
          quantity: assertPositiveNumber(body.quantity),
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
          {
            expectedStreamVersion: assertUnsignedBigInt(
              getETagValueFromIfMatch(context),
            ),
          },
        );

        return NoContent({
          context,
          eTag: toWeakETag(result.nextExpectedStreamVersion),
        });
      },
    );

    // Remove Product Item
    router.delete(
      '/clients/:clientId/shopping-carts/:shoppingCartId/product-items',
      async (context: Context) => {
        const shoppingCartId = assertNotEmptyString(
          context.req.param('shoppingCartId'),
        );
        const query = context.req.query();
        const productItem: PricedProductItem = {
          productId: assertNotEmptyString(query.productId),
          quantity: assertPositiveNumber(Number(query.quantity)),
          unitPrice: assertPositiveNumber(Number(query.unitPrice)),
        };

        const result = await handle(
          eventStore,
          shoppingCartId,
          {
            type: 'RemoveProductItemFromShoppingCart',
            data: { shoppingCartId, productItem },
          },
          {
            expectedStreamVersion: assertUnsignedBigInt(
              getETagValueFromIfMatch(context),
            ),
          },
        );

        return NoContent({
          context,
          eTag: toWeakETag(result.nextExpectedStreamVersion),
        });
      },
    );

    // Confirm Shopping Cart
    router.post(
      '/clients/:clientId/shopping-carts/:shoppingCartId/confirm',
      async (context: Context) => {
        const shoppingCartId = assertNotEmptyString(
          context.req.param('shoppingCartId'),
        );

        const result = await handle(
          eventStore,
          shoppingCartId,
          {
            type: 'ConfirmShoppingCart',
            data: { shoppingCartId, now: new Date() },
          },
          {
            expectedStreamVersion: assertUnsignedBigInt(
              getETagValueFromIfMatch(context),
            ),
          },
        );

        return NoContent({
          context,
          eTag: toWeakETag(result.nextExpectedStreamVersion),
        });
      },
    );

    // Cancel Shopping Cart
    router.delete(
      '/clients/:clientId/shopping-carts/:shoppingCartId',
      async (context: Context) => {
        const shoppingCartId = assertNotEmptyString(
          context.req.param('shoppingCartId'),
        );

        const result = await handle(
          eventStore,
          shoppingCartId,
          {
            type: 'CancelShoppingCart',
            data: { shoppingCartId, now: new Date() },
          },
          {
            expectedStreamVersion: assertUnsignedBigInt(
              getETagValueFromIfMatch(context),
            ),
          },
        );

        return NoContent({
          context,
          eTag: toWeakETag(result.nextExpectedStreamVersion),
        });
      },
    );
  };
