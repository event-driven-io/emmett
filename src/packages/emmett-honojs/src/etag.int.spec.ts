import {
  StreamETags,
  assertDeepEqual,
  assertEqual,
  assertUnsignedBigInt,
} from '@event-driven-io/emmett';
import type { Context } from 'hono';
import { describe, it } from 'vitest';
import { getApplication, OK, type WebApiSetup } from '.';
import {
  getETagValueFromIfMatch,
  getExpectedStreamVersionFromIfMatch,
  setETag,
} from './etag';

const streamNameOf = (shoppingCartId: string) =>
  `shopping_cart-${shoppingCartId}`;

const shoppingCartApi: WebApiSetup = (router) => {
  router.post('/shopping-carts/:shoppingCartId/product-items', (context) => {
    const shoppingCartId = context.req.param('shoppingCartId');
    const streamName = streamNameOf(shoppingCartId);

    const expected = getExpectedStreamVersionFromIfMatch(context, streamName);

    setETag(context, StreamETags.from(streamName, 5n));

    return OK({ context, body: { expected: expected.toString() } });
  });

  router.post(
    '/deprecated/shopping-carts/:shoppingCartId/product-items',
    (context: Context) => {
      const expected = assertUnsignedBigInt(getETagValueFromIfMatch(context));

      return OK({ context, body: { expected: expected.toString() } });
    },
  );
};

const app = getApplication({ apis: [shoppingCartApi] });

const post = (path: string, headers: Record<string, string> = {}) =>
  app.request(`http://localhost${path}`, { method: 'POST', headers });

void describe('getExpectedStreamVersionFromIfMatch in a route', () => {
  void it('answers with the command result for a strong tag holding the stream name', async () => {
    const response = await post('/shopping-carts/cart-123/product-items', {
      'if-match': StreamETags.from(streamNameOf('cart-123'), 4n),
    });

    assertEqual(200, response.status);
    assertDeepEqual(await response.json(), { expected: '4' });
  });

  void it('answers with the command result for the bare strong tag that used to give 500', async () => {
    const response = await post('/shopping-carts/cart-123/product-items', {
      'if-match': '"4"',
    });

    assertEqual(200, response.status);
    assertDeepEqual(await response.json(), { expected: '4' });
  });

  void it('answers with the current version in the ETag header', async () => {
    const response = await post('/shopping-carts/cart-123/product-items', {
      'if-match': '"4"',
    });

    assertEqual('"shopping_cart-cart-123:5"', response.headers.get('etag'));
  });

  void it('runs without a concurrency check when the header is absent', async () => {
    const response = await post('/shopping-carts/cart-123/product-items');

    assertEqual(200, response.status);
    assertDeepEqual(await response.json(), {
      expected: 'NO_CONCURRENCY_CHECK',
    });
  });

  void it('answers with 412 for a value that is not a version tag', async () => {
    const response = await post('/shopping-carts/cart-123/product-items', {
      'if-match': '"2e1f6c58"',
    });

    assertEqual(412, response.status);
  });
});

void describe('getETagValueFromIfMatch in a route', () => {
  void it('still answers with 500 for the bare strong tag, as it returns the raw header', async () => {
    const response = await post(
      '/deprecated/shopping-carts/cart-123/product-items',
      { 'if-match': '"4"' },
    );

    assertEqual(500, response.status);
  });
});
