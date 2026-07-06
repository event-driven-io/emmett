import {
  CommandHandler,
  STREAM_DOES_NOT_EXIST,
  assertNotEmptyString,
  assertPositiveNumber,
  assertUnsignedBigInt,
  type EventStore,
  type ReadEventMetadataWithGlobalPosition,
} from '@event-driven-io/emmett';
import type { Request, Router } from 'express';
import {
  Created,
  NoContent,
  getETagValueFromIfMatch,
  on,
  toWeakETag,
  type WebApiSetup,
} from '../../';
import {
  decide,
  type AddProductItemToShoppingCart,
  type OpenShoppingCart,
} from '../decider/businessLogic';
import {
  emptyShoppingCart,
  evolve,
  type ProductItem,
} from '../decider/shoppingCart';

export const handle = CommandHandler({
  evolve,
  initialState: () => emptyShoppingCart,
});

const dummyPriceProvider = (_productId: string) => 100;

export const shoppingCartApi =
  (eventStore: EventStore<ReadEventMetadataWithGlobalPosition>): WebApiSetup =>
  (router: Router) => {
    // Open a new shopping cart, requiring the stream not to exist yet
    router.post(
      '/clients/:clientId/shopping-carts/',
      on(async (request: Request) => {
        const clientId = assertNotEmptyString(request.params.clientId);
        const shoppingCartId = clientId;

        const command: OpenShoppingCart = {
          type: 'OpenShoppingCart',
          data: { clientId, shoppingCartId, now: new Date() },
        };

        const result = await handle(
          eventStore,
          shoppingCartId,
          (state) => decide(command, state),
          { expectedStreamVersion: STREAM_DOES_NOT_EXIST },
        );

        return Created({
          createdId: shoppingCartId,
          eTag: toWeakETag(result.nextExpectedStreamVersion),
        });
      }),
    );

    // #region etag-command-handler
    // Add a product item, guarded by the version carried in the If-Match header
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
        const unitPrice = dummyPriceProvider(productItem.productId);

        const command: AddProductItemToShoppingCart = {
          type: 'AddProductItemToShoppingCart',
          data: { shoppingCartId, productItem: { ...productItem, unitPrice } },
        };

        const result = await handle(
          eventStore,
          shoppingCartId,
          (state) => decide(command, state),
          {
            expectedStreamVersion: assertUnsignedBigInt(
              getETagValueFromIfMatch(request),
            ),
          },
        );

        return NoContent({
          eTag: toWeakETag(result.nextExpectedStreamVersion),
        });
      }),
    );
    // #endregion etag-command-handler
  };

type AddProductItemRequest = Request<
  Partial<{ clientId: string; shoppingCartId: string }>,
  unknown,
  Partial<{ productId: string; quantity: number }>
>;
