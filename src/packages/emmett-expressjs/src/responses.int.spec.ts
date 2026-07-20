import {
  assertEqual,
  assertMatches,
  DeciderCommandHandler,
  getInMemoryEventStore,
  rejectOn,
  type Event,
} from '@event-driven-io/emmett';
import type { Request, Router } from 'express';
import request from 'supertest';
import { describe, it } from 'vitest';
import {
  Conflict,
  getApplication,
  NoContent,
  on,
  ResponseFromEvents,
  sendResponseFromEvents,
  toWeakETag,
} from '.';

type ProductItemAdded = Event<'ProductItemAdded', { productId: string }>;
type ProductItemOutOfStock = Event<
  'ProductItemOutOfStock',
  { availableQuantity: number }
>;
type ShoppingCartEvent = ProductItemAdded | ProductItemOutOfStock;

const successfulResult = {
  events: [
    { type: 'ProductItemAdded', data: { productId: 'product-1' } },
  ] as ShoppingCartEvent[],
  nextExpectedStreamVersion: 4n,
};
const rejectedResult = {
  events: [
    { type: 'ProductItemOutOfStock', data: { availableQuantity: 2 } },
    { type: 'ProductItemAdded', data: { productId: 'product-1' } },
  ] as ShoppingCartEvent[],
};

const shoppingCartApi = (router: Router) => {
  router.get(
    '/success',
    on(() =>
      ResponseFromEvents({
        events: successfulResult,
        success: (result) =>
          NoContent({
            eTag: toWeakETag(result.nextExpectedStreamVersion),
          }),
      }),
    ),
  );
  router.get(
    '/numeric',
    on(() =>
      ResponseFromEvents({ events: successfulResult.events, success: 202 }),
    ),
  );
  router.get(
    '/default',
    on(() => ResponseFromEvents({ events: successfulResult.events })),
  );
  router.get(
    '/numeric-failure',
    on(() =>
      ResponseFromEvents({
        events: rejectedResult,
        failure: (event) =>
          event.type === 'ProductItemOutOfStock' ? 409 : undefined,
      }),
    ),
  );
  router.get('/send', (_request, response) =>
    sendResponseFromEvents(response, {
      events: successfulResult.events,
      success: 204,
    }),
  );
};

const application = getApplication({ apis: [shoppingCartApi] });

type AddProductItem = {
  type: 'AddProductItem';
  data: { productId: string; quantity: number; availableQuantity: number };
};
type Cart = { productIds: string[] };
type AddProductItemRequest = Request<
  { shoppingCartId: string },
  unknown,
  { productId: string; quantity: number }
>;

const handleAddProductItem = DeciderCommandHandler<
  Cart,
  AddProductItem,
  ShoppingCartEvent
>({
  initialState: () => ({ productIds: [] }),
  evolve: (state, event) =>
    event.type === 'ProductItemAdded'
      ? { productIds: [...state.productIds, event.data.productId] }
      : state,
  decide: (command) =>
    command.data.quantity > command.data.availableQuantity
      ? {
          type: 'ProductItemOutOfStock',
          data: { availableQuantity: command.data.availableQuantity },
        }
      : {
          type: 'ProductItemAdded',
          data: { productId: command.data.productId },
        },
  middleware: [rejectOn((event) => event.type === 'ProductItemOutOfStock')],
});
const eventStore = getInMemoryEventStore();

const addProductItemApi = (router: Router) => {
  // #region express-response-from-events-route
  router.post(
    '/shopping-carts/:shoppingCartId/product-items',
    on(async (request: AddProductItemRequest) => {
      const result = await handleAddProductItem(
        eventStore,
        request.params.shoppingCartId,
        {
          type: 'AddProductItem',
          data: {
            productId: String(request.body.productId),
            quantity: Number(request.body.quantity),
            availableQuantity: 2,
          },
        },
      );

      return ResponseFromEvents({
        events: result,
        success: 204,
        failure: (event) => {
          switch (event.type) {
            case 'ProductItemOutOfStock':
              return Conflict({
                problemDetails: `Only ${event.data.availableQuantity} items are available`,
              });
          }
          return undefined;
        },
      });
    }),
  );
  // #endregion express-response-from-events-route
};

const addProductItemApplication = getApplication({
  apis: [addProductItemApi],
});

describe('ResponseFromEvents Express integration', () => {
  it('returns a success response through on', async () => {
    const response = await request(application).get('/success');

    assertEqual(response.statusCode, 204);
    assertEqual(response.headers.etag, 'W/"4"');
  });

  it('maps a failure that is not the last produced event', async () => {
    const response = await request(addProductItemApplication)
      .post('/shopping-carts/cart-1/product-items')
      .send({ productId: 'product-1', quantity: 3 });

    assertEqual(response.statusCode, 409);
    assertMatches(response.body, {
      status: 409,
      detail: 'Only 2 items are available',
    });
  });

  it('accepts a numeric success status', async () => {
    assertEqual((await request(application).get('/numeric')).statusCode, 202);
  });

  it('defaults the success response to no content', async () => {
    assertEqual((await request(application).get('/default')).statusCode, 204);
  });

  it('accepts a numeric failure status', async () => {
    assertEqual(
      (await request(application).get('/numeric-failure')).statusCode,
      409,
    );
  });

  it('supports the imperative send path', async () => {
    assertEqual((await request(application).get('/send')).statusCode, 204);
  });
});
