import {
  StreamETags,
  assertDeepEqual,
  assertEqual,
  NO_CONCURRENCY_CHECK,
} from '@event-driven-io/emmett';
import type { Request, Router } from 'express';
import request from 'supertest';
import { describe, it } from 'vitest';
import { getApplication, getExpectedStreamVersionFromIfMatch, OK, on } from '.';

const shoppingCartApi = (router: Router) =>
  router.post(
    '/shopping-carts/:shoppingCartId/product-items',
    on((request: Request<{ shoppingCartId: string }>) => {
      const streamName = `shopping_cart-${request.params.shoppingCartId}`;
      const expected = getExpectedStreamVersionFromIfMatch(request, streamName);

      const nextExpectedStreamVersion =
        expected === NO_CONCURRENCY_CHECK ? 1n : (expected as bigint) + 1n;

      return OK({
        body: { expected: expected.toString() },
        eTag: StreamETags.from(streamName, nextExpectedStreamVersion),
      });
    }),
  );

const application = getApplication({ apis: [shoppingCartApi] });

void describe('getExpectedStreamVersionFromIfMatch in an Express route', () => {
  void it('answers a strong If-Match with the command result instead of 500', async () => {
    const response = await request(application)
      .post('/shopping-carts/cart-123/product-items')
      .set('If-Match', '"4"')
      .send();

    assertEqual(response.statusCode, 200);
    assertDeepEqual(response.body, { expected: '4' });
    assertEqual(response.headers.etag, '"shopping_cart-cart-123:5"');
  });

  void it('answers a full entity tag with the command result', async () => {
    const response = await request(application)
      .post('/shopping-carts/cart-123/product-items')
      .set('If-Match', '"shopping_cart-cart-123:4"')
      .send();

    assertEqual(response.statusCode, 200);
    assertDeepEqual(response.body, { expected: '4' });
  });

  void it('runs the command with no concurrency check when If-Match is absent', async () => {
    const response = await request(application)
      .post('/shopping-carts/cart-123/product-items')
      .send();

    assertEqual(response.statusCode, 200);
    assertDeepEqual(response.body, { expected: NO_CONCURRENCY_CHECK });
  });
});
