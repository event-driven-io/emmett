import {
  assertDeepEqual,
  assertEqual,
  assertFalse,
  assertOk,
  assertTrue,
} from '@event-driven-io/emmett';
import express, {
  type ErrorRequestHandler,
  type Request,
  type Router,
} from 'express';
import type { ProblemDocument } from 'http-problem-details';
import request from 'supertest';
import { describe, it } from 'vitest';
import {
  configureApplication,
  getApplication,
  on,
  problemDetailsMiddleware,
  registerWebApi,
  type HttpResponse,
  type WebApiSetup,
} from '.';

const echoBodyApi: WebApiSetup = (router) => {
  router.post('/echo', (req, res) => {
    const body: unknown = req.body;
    res.status(200).json({ body: body ?? null });
  });
};

void describe('registerWebApi', () => {
  void it('registers API routes on and returns the provided application', async () => {
    const application = express();
    application.set('trust proxy', 1);

    const registered = registerWebApi(application, [
      (router) => router.get('/orders', (_req, res) => res.sendStatus(204)),
    ]);

    assertOk(registered === application);
    assertEqual(registered.get('trust proxy'), 1);

    const response = await request(application).get('/orders').send();
    assertEqual(response.statusCode, 204);
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

  void it('respects middleware and infrastructure route ordering owned by the caller', async () => {
    const calls: string[] = [];
    const application = express();

    application.get('/health', (_req, res) => {
      calls.push('health');
      res.status(200).json({ status: 'ok' });
    });
    application.use((_req, _res, next) => {
      calls.push('authentication');
      next();
    });

    registerWebApi(application, [
      (router) => {
        router.get('/orders', (_req, res) => {
          calls.push('orders');
          res.sendStatus(204);
        });
      },
    ]);

    const healthResponse = await request(application).get('/health').send();
    assertEqual(healthResponse.statusCode, 200);
    assertDeepEqual(calls, ['health']);

    calls.length = 0;
    const ordersResponse = await request(application).get('/orders').send();
    assertEqual(ordersResponse.statusCode, 204);
    assertDeepEqual(calls, ['authentication', 'orders']);
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
    application.set('trust proxy', 1);

    const configured = configureApplication(application, {
      apis: [echoBodyApi, asyncErrorApi],
    });

    assertOk(configured === application);
    assertEqual(configured.get('trust proxy'), 1);

    const bodyResponse = await request(application)
      .post('/echo')
      .send({ productId: 'shoes' });
    assertDeepEqual((bodyResponse.body as { body: unknown }).body, {
      productId: 'shoes',
    });
    assertFalse('etag' in bodyResponse.headers);

    const errorResponse = await request(application).get('/async-error').send();
    assertEqual(errorResponse.statusCode, 500);
    assertEqual(
      (errorResponse.body as ProblemDocument).detail,
      'Application failed',
    );
  });

  void it('supports replacing disabled defaults on an existing application', async () => {
    const application = express();
    application.use(express.text({ type: 'application/json' }));

    configureApplication(application, {
      apis: [echoBodyApi, asyncErrorApi],
      disableJsonMiddleware: true,
      disableProblemDetailsMiddleware: true,
    });
    application.use(((error, _req, res, _next) => {
      res.status(422).json({ detail: (error as Error).message });
    }) satisfies ErrorRequestHandler);

    const bodyResponse = await request(application)
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send('{"productId":"shoes"}');
    assertEqual(
      (bodyResponse.body as { body: unknown }).body,
      '{"productId":"shoes"}',
    );

    const errorResponse = await request(application).get('/async-error').send();
    assertEqual(errorResponse.statusCode, 422);
    assertDeepEqual(errorResponse.body, { detail: 'Application failed' });
  });
});

void describe('getApplication', () => {
  void it('parses JSON bodies by default', async () => {
    const application = getApplication({ apis: [echoBodyApi] });

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
