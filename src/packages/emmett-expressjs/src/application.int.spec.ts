import {
  assertDeepEqual,
  assertEqual,
  assertFalse,
  assertOk,
  assertTrue,
} from '@event-driven-io/emmett';
import { trace, type Span } from '@opentelemetry/api';
import express, {
  type ErrorRequestHandler,
  type Request,
  type RequestHandler,
  type Router,
} from 'express';
import type { ProblemDocument } from 'http-problem-details';
import request from 'supertest';
import { describe, it, vi } from 'vitest';
import {
  configureApplication,
  getApplication,
  NotFound,
  OK,
  on,
  problemDetailsMiddleware,
  registerWebApi,
  traceIdMiddleware,
  type HttpResponse,
  type WebApiSetup,
} from '.';

const echoBodyApi: WebApiSetup = (router) => {
  router.post('/echo', (req, res) => {
    const body: unknown = req.body;
    res.status(200).json({ body: body ?? null });
  });
};

const productApi: WebApiSetup = (router) => {
  router.get(
    '/products/:productId',
    on((request: Request<{ productId: string }>) => {
      const productId = request.params.productId;

      return productId === 'missing'
        ? NotFound({ problemDetails: `Product ${productId} was not found` })
        : OK({ body: { productId, available: true } });
    }),
  );
};

const authenticateRequest: RequestHandler = (request, response, next) => {
  if (request.get('authorization') !== 'Bearer valid-token') {
    response.sendStatus(401);
    return;
  }
  next();
};

void describe('registerWebApi', () => {
  void it('registers API routes on and returns the provided application', async () => {
    const application = express();

    const registered = registerWebApi(application, [
      (router) => router.get('/orders', (_req, res) => res.sendStatus(204)),
    ]);

    assertOk(registered === application);

    const response = await request(application).get('/orders').send();
    assertEqual(response.statusCode, 204);
  });

  void it('runs an API setup using on and response helpers', async () => {
    const application = express();

    registerWebApi(application, [productApi]);

    const response = await request(application)
      .get('/products/product-1')
      .send();

    assertEqual(response.statusCode, 200);
    assertDeepEqual(response.body, {
      productId: 'product-1',
      available: true,
    });

    const missingResponse = await request(application)
      .get('/products/missing')
      .send();

    assertEqual(missingResponse.statusCode, 404);
    assertEqual(
      (missingResponse.body as ProblemDocument).detail,
      'Product missing was not found',
    );
  });

  void it('supports named wildcard route parameters', async () => {
    const application = express();

    registerWebApi(application, [
      (router) => {
        router.get('/files/{*path}', (req, res) => {
          res.status(200).json({ path: req.params.path });
        });
      },
    ]);

    const response = await request(application).get('/files/a/b').send();

    assertEqual(response.statusCode, 200);
    assertDeepEqual(response.body, { path: ['a', 'b'] });
  });

  void it('composes caller-owned infrastructure and middleware around API routes', async () => {
    // #region route-only-registration
    const application = express();

    application.get('/health', (_request, response) => {
      response.status(200).json({ status: 'ok' });
    });
    application.use(express.json({ limit: '2mb' }));
    application.use(express.urlencoded({ extended: true }));
    application.use(traceIdMiddleware);
    application.use(authenticateRequest);

    registerWebApi(application, [echoBodyApi, asyncErrorApi]);

    application.use(problemDetailsMiddleware());
    // #endregion route-only-registration

    const healthResponse = await request(application).get('/health').send();
    assertEqual(healthResponse.statusCode, 200);

    const unauthorizedResponse = await request(application)
      .post('/echo')
      .send({ productId: 'shoes' });
    assertEqual(unauthorizedResponse.statusCode, 401);

    const bodyResponse = await request(application)
      .post('/echo')
      .set('Authorization', 'Bearer valid-token')
      .send({ productId: 'shoes' });
    assertDeepEqual((bodyResponse.body as { body: unknown }).body, {
      productId: 'shoes',
    });

    const errorResponse = await request(application)
      .get('/async-error')
      .set('Authorization', 'Bearer valid-token')
      .send();
    assertEqual(errorResponse.statusCode, 500);
    assertEqual(
      (errorResponse.body as ProblemDocument).detail,
      'Application failed',
    );
  });

  void it('uses body parsing explicitly installed by the caller', async () => {
    const application = express();
    application.use(express.text({ type: 'application/json' }));
    registerWebApi(application, [echoBodyApi]);

    const response = await request(application)
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send('{"productId":"shoes"}');

    assertEqual(
      (response.body as { body: unknown }).body,
      '{"productId":"shoes"}',
    );
  });

  void it('uses error middleware explicitly installed by the caller', async () => {
    const application = express();
    registerWebApi(application, [asyncErrorApi]);
    application.use(((error, _req, res, next) => {
      res.setHeader('x-error-observed', 'true');
      next(error);
    }) satisfies ErrorRequestHandler);
    application.use(problemDetailsMiddleware());

    const response = await request(application).get('/async-error').send();

    assertEqual(response.statusCode, 500);
    assertEqual(response.headers['x-error-observed'], 'true');
    assertEqual(
      (response.body as ProblemDocument).detail,
      'Application failed',
    );
  });
});

void describe('configureApplication', () => {
  void it('applies the default Emmett setup to and returns an existing application', async () => {
    const application = express();

    application.get('/health', (_request, response) => {
      response.status(200).json({ status: 'ok' });
    });

    const configured = configureApplication(application, {
      apis: [echoBodyApi],
    });

    assertOk(configured === application);
    assertEqual((await request(application).get('/health')).statusCode, 200);
    const response = await request(application)
      .post('/echo')
      .send({ productId: 'shoes' });

    assertDeepEqual((response.body as { body: unknown }).body, {
      productId: 'shoes',
    });
  });

  void it('uses a caller-provided JSON parser when the default is disabled', async () => {
    // #region configure-custom-json-middleware
    const application = express();
    application.use(express.text({ type: 'application/json' }));

    configureApplication(application, {
      apis: [echoBodyApi],
      disableJsonMiddleware: true,
    });
    // #endregion configure-custom-json-middleware

    const bodyResponse = await request(application)
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send('{"productId":"shoes"}');
    assertEqual(
      (bodyResponse.body as { body: unknown }).body,
      '{"productId":"shoes"}',
    );
  });

  void it('uses caller-provided error middleware when the default is disabled', async () => {
    // #region configure-custom-error-middleware
    const application = express();
    configureApplication(application, {
      apis: [asyncErrorApi],
      disableProblemDetailsMiddleware: true,
    });
    application.use(((error, _req, response, _next) => {
      response.status(422).json({ detail: (error as Error).message });
    }) satisfies ErrorRequestHandler);
    // #endregion configure-custom-error-middleware

    const errorResponse = await request(application).get('/async-error').send();
    assertEqual(errorResponse.statusCode, 422);
    assertDeepEqual(errorResponse.body, { detail: 'Application failed' });
  });
});

void describe('getApplication', () => {
  void it('parses JSON bodies by default', async () => {
    // #region default-application
    const application = getApplication({
      apis: [
        (router) => {
          router.post('/echo', (request, response) => {
            const body: unknown = request.body;
            response.status(200).json({ body });
          });
        },
      ],
    });
    // #endregion default-application

    const response = await request(application)
      .post('/echo')
      .send({ productId: 'shoes' });

    assertDeepEqual((response.body as { body: unknown }).body, {
      productId: 'shoes',
    });
  });

  void it('can disable the default JSON middleware', async () => {
    const application = getApplication({
      apis: [echoBodyApi],
      disableJsonMiddleware: true,
    });

    const response = await request(application)
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send('{"productId":"shoes"}');

    assertEqual((response.body as { body: unknown }).body, null);
  });

  void it('parses extended URL-encoded bodies by default', async () => {
    const application = getApplication({ apis: [echoBodyApi] });

    const response = await request(application)
      .post('/echo')
      .type('form')
      .send({ 'cart[item]': 'shoes' });

    assertDeepEqual((response.body as { body: unknown }).body, {
      cart: { item: 'shoes' },
    });
  });

  void it('can disable the default URL-encoded middleware', async () => {
    const application = getApplication({
      apis: [echoBodyApi],
      disableUrlEncodingMiddleware: true,
    });

    const response = await request(application)
      .post('/echo')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('cart%5Bitem%5D=shoes');

    assertEqual((response.body as { body: unknown }).body, null);
  });

  void it('preserves disabled generated ETags as the Emmett default', async () => {
    const application = getApplication({
      apis: [
        (router) =>
          router.get('/body', (_req, res) => res.status(200).send('body')),
      ],
    });

    const response = await request(application).get('/body').send();

    assertFalse('etag' in response.headers);
  });

  void it('can enable generated Express ETags', async () => {
    const application = getApplication({
      apis: [
        (router) =>
          router.get('/body', (_req, res) => res.status(200).send('body')),
      ],
      enableDefaultExpressEtag: true,
    });

    const response = await request(application).get('/body').send();

    assertTrue(typeof response.headers.etag === 'string');
  });

  void it('adds the active trace ID when observability is provided', async () => {
    const traceId = '0123456789abcdef0123456789abcdef';
    const getSpan = vi.spyOn(trace, 'getSpan').mockReturnValue({
      spanContext: () => ({
        traceId,
        spanId: '0123456789abcdef',
        traceFlags: 1,
      }),
    } as Span);
    const application = getApplication({
      apis: [
        (router) =>
          router.get('/trace', (_request, response) =>
            response.sendStatus(204),
          ),
      ],
      observability: {},
    });

    try {
      const response = await request(application).get('/trace').send();

      assertEqual(response.headers['x-trace-id'], traceId);
    } finally {
      getSpan.mockRestore();
    }
  });

  void it('installs Problem Details middleware by default', async () => {
    const application = getApplication({ apis: [asyncErrorApi] });

    const response = await request(application).get('/async-error').send();

    assertEqual(response.statusCode, 500);
    assertEqual(
      (response.body as ProblemDocument).detail,
      'Application failed',
    );
  });

  void it('forwards errors rejected by on handlers', async () => {
    const application = getApplication({ apis: [onErrorApi] });

    const response = await request(application).get('/on-error').send();

    assertEqual(response.statusCode, 500);
    assertEqual((response.body as ProblemDocument).detail, 'On handler failed');
  });

  void it('can disable the default Problem Details middleware', async () => {
    const application = getApplication({
      apis: [asyncErrorApi],
      disableProblemDetailsMiddleware: true,
    });
    application.use(((error, _req, res, _next) => {
      res.status(418).json({ detail: (error as Error).message });
    }) satisfies ErrorRequestHandler);

    const response = await request(application).get('/async-error').send();

    assertEqual(response.statusCode, 418);
    assertDeepEqual(response.body, { detail: 'Application failed' });
  });
});

const asyncErrorApi = (router: Router) => {
  router.get('/async-error', async (_request: Request) => {
    await Promise.resolve();
    throw new Error('Application failed');
  });
};

const onErrorApi = (router: Router) => {
  router.get(
    '/on-error',
    on(async (_request: Request): Promise<HttpResponse> => {
      await Promise.resolve();
      throw new Error('On handler failed');
    }),
  );
};
