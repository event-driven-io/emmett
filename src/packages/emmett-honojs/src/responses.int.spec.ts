import {
  assertEqual,
  assertMatches,
  type Event,
} from '@event-driven-io/emmett';
import { Hono } from 'hono';
import { describe, it } from 'vitest';
import {
  Conflict,
  NoContent,
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

const application = new Hono();
application.get('/success', (context) =>
  ResponseFromEvents({
    context,
    events: successfulResult,
    success: (result) =>
      NoContent({
        context,
        eTag: toWeakETag(result.nextExpectedStreamVersion),
      }),
  }),
);
application.get('/failure', (context) =>
  ResponseFromEvents({
    context,
    events: rejectedResult,
    failure: (event) =>
      event.type === 'ProductItemOutOfStock'
        ? Conflict({
            context,
            problemDetails: `Only ${event.data.availableQuantity} items are available`,
          })
        : undefined,
  }),
);
application.get('/numeric', (context) =>
  ResponseFromEvents({
    context,
    events: successfulResult.events,
    success: 202,
  }),
);
application.get('/default', (context) =>
  ResponseFromEvents({ context, events: successfulResult.events }),
);
application.get('/numeric-failure', (context) =>
  ResponseFromEvents({
    context,
    events: rejectedResult,
    failure: (event) =>
      event.type === 'ProductItemOutOfStock' ? 409 : undefined,
  }),
);
application.get('/send', (context) =>
  sendResponseFromEvents(context, {
    events: successfulResult.events,
    success: 204,
  }),
);

describe('ResponseFromEvents Hono integration', () => {
  it('returns a success response', async () => {
    const response = await application.request('/success');

    assertEqual(response.status, 204);
    assertEqual(response.headers.get('etag'), 'W/"4"');
  });

  it('maps a failure that is not the last produced event', async () => {
    const response = await application.request('/failure');

    assertEqual(response.status, 409);
    assertMatches(await response.json(), {
      status: 409,
      detail: 'Only 2 items are available',
    });
  });

  it('accepts a numeric success status', async () => {
    assertEqual((await application.request('/numeric')).status, 202);
  });

  it('defaults the success response to no content', async () => {
    assertEqual((await application.request('/default')).status, 204);
  });

  it('accepts a numeric failure status', async () => {
    assertEqual((await application.request('/numeric-failure')).status, 409);
  });

  it('supports the imperative send path', async () => {
    assertEqual((await application.request('/send')).status, 204);
  });
});
