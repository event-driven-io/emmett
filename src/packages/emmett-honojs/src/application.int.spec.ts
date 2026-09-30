import {
  assertDeepEqual,
  assertEqual,
  assertNotEmptyString,
  assertOk,
  logger,
  setupEmmettObservability,
  type LogEvent,
} from '@event-driven-io/emmett';
import { trace, type Span } from '@opentelemetry/api';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { ProblemDocument } from 'http-problem-details';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, it, vi } from 'vitest';
import {
  configureApplication,
  getApplication,
  NotFound,
  OK,
  registerWebApi,
  startAPI,
  type WebApiSetup,
} from '.';

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
});

void describe('observability', () => {
  const traceId = '0123456789abcdef0123456789abcdef';

  const withActiveSpan = async <T>(fn: () => T | Promise<T>): Promise<T> => {
    const getSpan = vi.spyOn(trace, 'getSpan').mockReturnValue({
      spanContext: () => ({
        traceId,
        spanId: '0123456789abcdef',
        traceFlags: 1,
      }),
    } as Span);
    try {
      return await fn();
    } finally {
      getSpan.mockRestore();
    }
  };

  const traceApi: WebApiSetup = (router) =>
    router.get('/trace', (context) => context.body(null, 204));

  afterEach(() => setupEmmettObservability(undefined));

  void it('adds x-trace-id when observability is registered globally', async () => {
    setupEmmettObservability({});
    const application = getApplication({ apis: [traceApi] });

    const response = await withActiveSpan(() => application.request('/trace'));

    assertEqual(response.headers.get('x-trace-id'), traceId);
  });

  void it('adds x-trace-id when observability is passed to the application', async () => {
    const application = getApplication({
      apis: [traceApi],
      observability: {},
    });

    const response = await withActiveSpan(() => application.request('/trace'));

    assertEqual(response.headers.get('x-trace-id'), traceId);
  });

  void it('does not add x-trace-id when disableTraceIdHeader is true', async () => {
    setupEmmettObservability({});
    const application = getApplication({
      apis: [traceApi],
      observability: {},
      disableTraceIdHeader: true,
    });

    const response = await withActiveSpan(() => application.request('/trace'));

    assertEqual(response.headers.get('x-trace-id'), null);
  });

  void it('does not add x-trace-id when no observability is registered', async () => {
    const application = getApplication({ apis: [traceApi] });

    const response = await withActiveSpan(() => application.request('/trace'));

    assertEqual(response.headers.get('x-trace-id'), null);
  });

  void it('startAPI logs Server listening with the port to the configured logger', async () => {
    const records: LogEvent[] = [];
    const application = getApplication({
      apis: [traceApi],
    });

    const server = startAPI(application, {
      port: 0,
      observability: {
        logger: logger({ log: (event) => records.push(event) }),
      },
    });
    try {
      await once(server, 'listening');
      const { port } = server.address() as AddressInfo;

      assertDeepEqual(
        records.map(({ name, data, metadata: { level } }) => ({
          name,
          data,
          level,
        })),
        [
          {
            name: 'Server listening',
            data: {
              body: 'Server listening',
              attributes: { 'server.port': port },
            },
            level: 'info',
          },
        ],
      );
    } finally {
      server.close();
    }
  });

  void it('startAPI logs Server listening to the globally registered logger', async () => {
    const records: LogEvent[] = [];
    setupEmmettObservability({
      logger: logger({ log: (event) => records.push(event) }),
    });
    const application = getApplication({ apis: [traceApi] });

    const server = startAPI(application, { port: 0 });
    try {
      await once(server, 'listening');

      assertDeepEqual(
        records.map(({ name }) => name),
        ['Server listening'],
      );
    } finally {
      server.close();
    }
  });

  void it('startAPI listens on port 3000 when the port is left out', async () => {
    const application = getApplication({ apis: [traceApi] });

    const server = startAPI(application, { observability: {} });
    try {
      await once(server, 'listening');

      assertEqual((server.address() as AddressInfo).port, 3000);
    } finally {
      server.close();
    }
  });

  void it('startAPI prints nothing when nothing is configured', async () => {
    const consoleSpies = (
      ['log', 'info', 'warn', 'error', 'debug'] as const
    ).map((method) => vi.spyOn(console, method));
    const stdout = vi.spyOn(process.stdout, 'write');
    const stderr = vi.spyOn(process.stderr, 'write');
    const application = getApplication({ apis: [traceApi] });

    const server = startAPI(application, { port: 0 });
    try {
      await once(server, 'listening');

      assertDeepEqual(
        [...consoleSpies, stdout, stderr].map((spy) => spy.mock.calls.length),
        [0, 0, 0, 0, 0, 0, 0],
      );
    } finally {
      server.close();
      for (const spy of [...consoleSpies, stdout, stderr]) spy.mockRestore();
    }
  });
});
