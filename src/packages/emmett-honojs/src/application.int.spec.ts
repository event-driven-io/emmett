import {
  StreamETags,
  assertDeepEqual,
  assertEqual,
  assertNotEmptyString,
  assertOk,
  ExpectedVersionConflictError,
} from '@event-driven-io/emmett';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { ProblemDocument } from 'http-problem-details';
import { describe, it } from 'vitest';
import {
  configureApplication,
  getApplication,
  NotFound,
  OK,
  registerWebApi,
  type WebApiSetup,
} from '.';

const conflictStreamName = 'shopping_cart-123';

const conflictApi: WebApiSetup = (router) => {
  router.post('/product-items', () => {
    throw new ExpectedVersionConflictError(7n, 4n, conflictStreamName);
  });
};

const echoBodyApi: WebApiSetup = (router) => {
  router.post('/echo', async (context) => {
    const body: unknown = await context.req.json().catch(() => null);
    return context.json({ body });
  });
};

const productApi: WebApiSetup = (router) => {
  router.get('/products/:productId', (context: Context) => {
    const productId = context.req.param('productId');

    return productId === 'missing'
      ? NotFound({
          context,
          problemDetails: `Product ${productId} was not found`,
        })
      : OK({ context, body: { productId, available: true } });
  });
};

// #region query-read-model-route
type ShoppingCartDetails = {
  shoppingCartId: string;
  status: 'Opened' | 'Confirmed';
  productItemsCount: number;
};

const shoppingCartDetails = new Map<string, ShoppingCartDetails>([
  [
    'cart-1',
    {
      shoppingCartId: 'cart-1',
      status: 'Opened',
      productItemsCount: 2,
    },
  ],
]);

const shoppingCartDetailsApi: WebApiSetup = (router) => {
  router.get('/shopping-carts/:shoppingCartId', (context: Context) => {
    const shoppingCartId = assertNotEmptyString(
      context.req.param('shoppingCartId'),
    );
    const result = shoppingCartDetails.get(shoppingCartId);

    return result === undefined
      ? NotFound({
          context,
          problemDetails: `Shopping cart ${shoppingCartId} was not found`,
        })
      : OK({ context, body: result });
  });
};
// #endregion query-read-model-route

const asyncErrorApi: WebApiSetup = (router) => {
  router.get('/async-error', async () => {
    await Promise.resolve();
    throw new Error('Application failed');
  });
};

void describe('registerWebApi', () => {
  void it('registers API routes on and returns the provided application', async () => {
    const application = new Hono();

    const registered = registerWebApi(application, [
      (router) => router.get('/orders', (context) => context.body(null, 204)),
    ]);

    assertOk(registered === application);

    const response = await application.request('/orders');
    assertEqual(response.status, 204);
  });

  void it('runs an API setup using response helpers', async () => {
    const application = new Hono();

    registerWebApi(application, [productApi]);

    const response = await application.request('/products/product-1');
    assertEqual(response.status, 200);
    assertDeepEqual(await response.json(), {
      productId: 'product-1',
      available: true,
    });

    const missingResponse = await application.request('/products/missing');
    assertEqual(missingResponse.status, 404);
    assertEqual(
      ((await missingResponse.json()) as ProblemDocument).detail,
      'Product missing was not found',
    );
  });

  void it('runs a query route against a read model', async () => {
    const application = new Hono();

    registerWebApi(application, [shoppingCartDetailsApi]);

    const response = await application.request('/shopping-carts/cart-1');
    assertEqual(response.status, 200);
    assertDeepEqual(await response.json(), {
      shoppingCartId: 'cart-1',
      status: 'Opened',
      productItemsCount: 2,
    });

    const missingResponse = await application.request(
      '/shopping-carts/missing',
    );
    assertEqual(missingResponse.status, 404);
  });

  void it('composes caller-owned infrastructure and middleware around API routes', async () => {
    // #region route-only-registration
    const application = new Hono();

    application.get('/health', (context) => {
      return context.json({ status: 'ok' });
    });
    application.use('*', async (context, next) => {
      if (context.req.header('authorization') !== 'Bearer valid-token') {
        return context.body(null, 401);
      }
      await next();
      return;
    });

    registerWebApi(application, [echoBodyApi, asyncErrorApi]);

    application.onError((error, context) => {
      return context.json(
        { detail: error instanceof Error ? error.message : 'Unknown error' },
        500,
      );
    });
    // #endregion route-only-registration

    const healthResponse = await application.request('/health');
    assertEqual(healthResponse.status, 200);

    const unauthorizedResponse = await application.request('/echo', {
      method: 'POST',
      body: JSON.stringify({ productId: 'shoes' }),
      headers: { 'Content-Type': 'application/json' },
    });
    assertEqual(unauthorizedResponse.status, 401);

    const bodyResponse = await application.request('/echo', {
      method: 'POST',
      body: JSON.stringify({ productId: 'shoes' }),
      headers: {
        Authorization: 'Bearer valid-token',
        'Content-Type': 'application/json',
      },
    });
    assertDeepEqual(((await bodyResponse.json()) as { body: unknown }).body, {
      productId: 'shoes',
    });

    const errorResponse = await application.request('/async-error', {
      headers: { Authorization: 'Bearer valid-token' },
    });
    assertEqual(errorResponse.status, 500);
    assertDeepEqual(await errorResponse.json(), {
      detail: 'Application failed',
    });
  });

  void it('does not add generated ETags', async () => {
    const application = new Hono();
    registerWebApi(application, [
      (router) => router.get('/body', (context) => context.text('body')),
    ]);

    const response = await application.request('/body');

    assertEqual(response.headers.get('etag'), null);
  });
});

void describe('configureApplication', () => {
  void it('applies the default Emmett setup to and returns an existing application', async () => {
    const application = new Hono();

    application.get('/health', (context) => {
      return context.json({ status: 'ok' });
    });

    const configured = configureApplication(application, {
      apis: [echoBodyApi],
    });

    assertOk(configured === application);
    assertEqual((await application.request('/health')).status, 200);
    const response = await application.request('/echo', {
      method: 'POST',
      body: JSON.stringify({ productId: 'shoes' }),
      headers: { 'Content-Type': 'application/json' },
    });

    assertDeepEqual(((await response.json()) as { body: unknown }).body, {
      productId: 'shoes',
    });
  });

  void it('uses caller-provided error handling when the default is disabled', async () => {
    // #region configure-custom-error-handler
    const application = new Hono();
    configureApplication(application, {
      apis: [asyncErrorApi],
      disableProblemDetailsMiddleware: true,
    });
    application.onError((error, context) => {
      return context.json(
        { detail: error instanceof Error ? error.message : 'Unknown error' },
        422,
      );
    });
    // #endregion configure-custom-error-handler

    const response = await application.request('/async-error');
    assertEqual(response.status, 422);
    assertDeepEqual(await response.json(), { detail: 'Application failed' });
  });

  void it('adds generated ETags by default', async () => {
    const application = new Hono();
    configureApplication(application, {
      apis: [
        (router) => router.get('/body', (context) => context.text('body')),
      ],
    });

    const response = await application.request('/body');

    assertOk(typeof response.headers.get('etag') === 'string');
  });

  void it('uses custom error mapping before the default Problem Details mapping', async () => {
    // #region custom-error-mapping
    class CardDeclinedError extends Error {
      constructor(public readonly code: string) {
        super(`Card declined: ${code}`);
      }
    }

    const checkoutApi: WebApiSetup = (router) =>
      router.post('/charges', () => {
        throw new CardDeclinedError('insufficient_funds');
      });

    const checkoutApplication = getApplication({
      apis: [checkoutApi],
      mapError: (error) =>
        error instanceof CardDeclinedError
          ? new ProblemDocument({
              type: 'https://errors.example.com/card-declined',
              status: 402,
              title: 'Card Declined',
              detail: error.message,
            })
          : undefined,
    });
    // #endregion custom-error-mapping

    const response = await checkoutApplication.request('/charges', {
      method: 'POST',
    });

    assertEqual(response.status, 402);
    assertEqual(
      ((await response.json()) as ProblemDocument).title,
      'Card Declined',
    );
  });
});

void describe('getApplication', () => {
  void it('creates a Hono application with the default setup', async () => {
    // #region default-application
    const application = getApplication({
      apis: [
        (router) => {
          router.post('/echo', async (context) => {
            const body: unknown = await context.req.json();
            return context.json({ body });
          });
        },
      ],
    });
    // #endregion default-application

    const response = await application.request('/echo', {
      method: 'POST',
      body: JSON.stringify({ productId: 'shoes' }),
      headers: { 'Content-Type': 'application/json' },
    });

    assertDeepEqual(((await response.json()) as { body: unknown }).body, {
      productId: 'shoes',
    });
  });

  void it('installs Problem Details error handling by default', async () => {
    const application = getApplication({ apis: [asyncErrorApi] });

    const response = await application.request('/async-error');

    assertEqual(response.status, 500);
    assertEqual(
      response.headers.get('content-type'),
      'application/problem+json',
    );
    assertEqual(
      ((await response.json()) as ProblemDocument).detail,
      'Application failed',
    );
  });

  void it('keeps the created response when If-None-Match matches its ETag', async () => {
    const eTag = 'W/"1"';
    const application = getApplication({
      apis: [
        (router) =>
          router.post('/shopping-carts', (context) => {
            context.header('ETag', eTag);
            context.header('Location', '/shopping-carts/cart-1');
            return context.json({ id: 'cart-1' }, 201);
          }),
      ],
    });

    const response = await application.request('/shopping-carts', {
      method: 'POST',
      headers: { 'If-None-Match': eTag },
    });

    assertEqual(response.status, 201);
    assertEqual(response.headers.get('location'), '/shopping-carts/cart-1');
    assertOk((await response.text()).length > 0);
  });

  void it('reports the current stream version in the ETag of a concurrency conflict', async () => {
    const application = getApplication({ apis: [conflictApi] });

    const response = await application.request('/product-items', {
      method: 'POST',
      headers: { 'If-Match': StreamETags.from(conflictStreamName, 4) },
    });

    assertEqual(response.status, 412);
    assertEqual(
      response.headers.get('content-type'),
      'application/problem+json',
    );
    assertEqual(
      response.headers.get('etag'),
      StreamETags.from(conflictStreamName, 7),
    );
  });

  void it('sends no ETag with a problem that is not a concurrency conflict', async () => {
    const application = getApplication({ apis: [asyncErrorApi] });

    const response = await application.request('/async-error');

    assertEqual(response.status, 500);
    assertEqual(response.headers.get('etag'), null);
  });

  void it('keeps Problem Details when If-None-Match matches the failed response ETag', async () => {
    const application = getApplication({
      apis: [
        (router) =>
          router.post('/failing', () => {
            throw new Error('Application failed');
          }),
      ],
    });

    const firstResponse = await application.request('/failing', {
      method: 'POST',
    });

    assertEqual(firstResponse.status, 500);
    assertEqual(
      firstResponse.headers.get('content-type'),
      'application/problem+json',
    );

    // The middleware sets no tag on a failed response, so the wildcard is the
    // only value a client can send back here.
    assertEqual(firstResponse.headers.get('etag'), null);

    const secondResponse = await application.request('/failing', {
      method: 'POST',
      headers: { 'If-None-Match': '*' },
    });

    assertEqual(secondResponse.status, 500);
    assertEqual(
      secondResponse.headers.get('content-type'),
      'application/problem+json',
    );
  });
});
