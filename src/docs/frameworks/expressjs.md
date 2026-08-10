---
documentationType: reference
outline: deep
---

# Express.js Integration

The `@event-driven-io/emmett-expressjs` package integrates Emmett with Express 5. It provides route handlers that return typed HTTP responses, application registration helpers, ETag utilities, and Problem Details error handling.

## Installation

```bash
npm install @event-driven-io/emmett @event-driven-io/emmett-expressjs express http-problem-details
npm install --save-dev @types/express
```

## Define an API

An API setup function receives an Express router. Wrap route handlers with `on` and return one of the response helpers exported by the package.

```typescript
import {
  NotFound,
  OK,
  on,
  type WebApiSetup,
} from '@event-driven-io/emmett-expressjs';
import type { Request } from 'express';

type ShoppingCart = {
  id: string;
  productItems: Array<{ productId: string; quantity: number }>;
};

export const shoppingCartApi = (): WebApiSetup => (router) => {
  router.get(
    '/carts/:cartId',
    on(async (request: Request<{ cartId: string }>) => {
      const cart: ShoppingCart | undefined = await loadCart(
        request.params.cartId,
      );

      return cart !== undefined
        ? OK({ body: cart })
        : NotFound({ detail: 'Shopping cart was not found' });
    }),
  );
};
```

Other response helpers include `Created`, `NoContent`, `BadRequest`, `Forbidden`, `Conflict`, `PreconditionFailed`, and `HttpProblem`.

## Start with the default application

`getApplication` creates an Express application and configures Emmett's default middleware and API routes. `startAPI` starts the HTTP server.

```typescript
import { getApplication, startAPI } from '@event-driven-io/emmett-expressjs';

const application = getApplication({
  apis: [shoppingCartApi()],
});

startAPI(application, { port: 3000 });
```

The default registration order is:

1. ETag configuration.
2. Express JSON parser.
3. Express URL-encoded parser with `extended: true`.
4. Trace response header middleware when observability is configured.
5. API routes.
6. Problem Details error middleware.

## Register Emmett on an existing application

Use `configureApplication` to apply the same conventional setup to an existing Express application. It returns the supplied application and accepts the same options as `getApplication`:

```typescript
import {
  configureApplication,
  startAPI,
} from '@event-driven-io/emmett-expressjs';
import express from 'express';

const application = express();

application.get('/health', (_request, response) => {
  response.status(200).json({ status: 'ok' });
});
application.use(authMiddleware);

configureApplication(application, {
  apis: [shoppingCartApi()],
});

startAPI(application, { port: 3000 });
```

This applies Emmett's ETag setting, enabled request middleware, API routes, and enabled error middleware in the documented default order. Routes and middleware already present on the application keep their existing position.

Use `registerWebApi` instead when every middleware position must be controlled explicitly. It only registers the supplied API routes and returns the application supplied by the caller. It does not configure ETags or install middleware.

```typescript
import {
  problemDetailsMiddleware,
  registerWebApi,
  startAPI,
} from '@event-driven-io/emmett-expressjs';
import express from 'express';

const application = express();

// Infrastructure endpoints registered here are not protected by the auth
// middleware below.
application.get('/health', (_request, response) => {
  response.status(200).json({ status: 'ok' });
});

application.use(express.json());
application.use(express.urlencoded({ extended: true }));
application.use(authMiddleware);

registerWebApi(application, [shoppingCartApi()]);
application.use(problemDetailsMiddleware());

startAPI(application, { port: 3000 });
```

Express executes middleware in registration order. Put middleware before `registerWebApi` to run it before Emmett routes, or after it for routes registered later.

The caller owns all middleware configuration. For example, it can replace Express's default JSON parser without any disable flag:

```typescript
const application = express();

application.use(express.json({ limit: '2mb' }));
application.use(authMiddleware);

registerWebApi(application, [shoppingCartApi()]);
```

## Customize error handling

Applications configured by `getApplication` or `configureApplication` serialize errors as `application/problem+json` by default. Pass `mapError` to customize how errors become Problem Details documents:

```typescript
import { getApplication } from '@event-driven-io/emmett-expressjs';
import { ProblemDocument } from 'http-problem-details';

const application = getApplication({
  apis: [shoppingCartApi()],
  mapError: (error) =>
    error instanceof ShoppingCartNotFound
      ? new ProblemDocument({
          status: 404,
          title: 'Shopping cart not found',
          detail: error.message,
        })
      : undefined,
});
```

With a caller-owned application, register the exported `problemDetailsMiddleware` explicitly after the API routes:

```typescript
import {
  problemDetailsMiddleware,
  registerWebApi,
} from '@event-driven-io/emmett-expressjs';

registerWebApi(application, [shoppingCartApi()]);

application.use(customErrorMiddleware);
application.use(problemDetailsMiddleware());
```

Error middleware must be registered after the routes whose errors it handles.

## Application options

`getApplication` and `configureApplication` accept these options:

| Option                            | Description                                                     |
| --------------------------------- | --------------------------------------------------------------- |
| `apis`                            | API setup functions applied to the Emmett router.               |
| `disableJsonMiddleware`           | Do not install Express's JSON parser.                           |
| `disableUrlEncodingMiddleware`    | Do not install Express's URL-encoded parser.                    |
| `disableProblemDetailsMiddleware` | Do not install the default Problem Details middleware.          |
| `enableDefaultExpressEtag`        | Enable Express's generated ETag responses. Disabled by default. |
| `mapError`                        | Map application errors to Problem Details documents.            |
| `observability`                   | Add tracing support and the trace response header.              |

`configureApplication(application, options)` configures and returns an existing application. `registerWebApi(application, apis)` accepts only the target Express application and a list of API setup functions. For fully caller-composed applications, `problemDetailsMiddleware` and `traceIdMiddleware` are available as independently composable middleware exports.

## Express 5 behavior

The package targets Express 5, so asynchronous Express handlers forward rejected promises to error middleware without `express-async-errors`. Express 5 also uses the current `path-to-regexp` route syntax; for example, a named wildcard is written as `/files/{*path}`.

See the [Express 5 migration guide](https://expressjs.com/en/guide/migrating-5/) for the complete set of framework-level changes.
