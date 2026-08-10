# @event-driven-io/emmett-expressjs

Express.js integration for Emmett Web APIs.

Use this package when you want to expose your application through HTTP and you already have an Express API, prefer Express for new services, or want a mature Node.js web framework with a small integration layer. The package helps with route composition, response helpers, Problem Details errors, explicit ETags for optimistic concurrency, trace IDs, and API tests.

Routes remain ordinary Express routes. A command route reads and validates the request, obtains any external data the decision needs, calls the command handler, and chooses a response. A query route reads its parameters, queries the read store, and returns the matching model. The integration supplies the repeated HTTP boundary work around both kinds of route.

The application setup and response helpers can also be used without event sourcing. The command-result, ETag, and event-backed testing helpers are useful when those concerns are part of the API.

## Purpose

This package provides the Express-specific pieces around an HTTP API:

| Concern                | What the package provides                                                                   | What remains in the route or application                  |
| ---------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Express setup          | Request parsing, feature-route registration, optional trace IDs, and Problem Details errors | Authentication and any application-specific middleware    |
| HTTP responses         | Helpers for status codes, bodies, `Location`, ETag, and Problem Details responses           | Choosing the response that represents each route outcome  |
| Command results        | Mapping returned events to success or failure responses                                     | Deciding whether business failures are returned or thrown |
| Optimistic concurrency | Reading `If-Match` and returning stream versions as ETags                                   | Choosing which writes require a client-supplied version   |
| API tests              | Given/when/then tests built on SuperTest                                                    | The requests, initial events, and outcomes to assert      |

It does not dispatch commands by itself, build projections, choose a database, or replace Express middleware. Those choices stay in the application.

## Installation

```bash
npm install @event-driven-io/emmett-expressjs
```

The package declares peer dependencies for Emmett, Express, Problem Details, SuperTest, and their TypeScript types. npm 7 and newer install missing peers automatically. With package managers that do not install peer dependencies automatically, follow the peer dependency warnings they print.

## Quick Start

Start with a feature route setup. The route remains an ordinary Express route: it reads and validates the request, obtains external data the decision needs, calls the command handler, and chooses the HTTP response. This excerpt is copied from the tested Getting Started Web API snippet; the surrounding feature setup supplies the router, event store, command handler, and domain functions.

```typescript
router.post(
  '/clients/:clientId/shopping-carts/current/product-items',
  on(async (request: AddProductItemRequest) => {
    const shoppingCartId = getShoppingCartId(
      assertNotEmptyString(request.params.clientId),
    );
    const productId = assertNotEmptyString(request.body.productId);

    const command: AddProductItemToShoppingCart = {
      type: 'AddProductItemToShoppingCart',
      data: {
        shoppingCartId,
        productItem: {
          productId,
          quantity: assertPositiveNumber(request.body.quantity),
          unitPrice: await getUnitPrice(productId),
        },
      },
      metadata: { now: getCurrentTime() },
    };

    await handle(eventStore, shoppingCartId, (state) =>
      addProductItem(command, state),
    );

    return NoContent();
  }),
);
```

`getApplication` then creates Express, installs the default HTTP middleware, registers the feature routes, and adds shared Problem Details error handling:

```typescript
import { getInMemoryEventStore } from '@event-driven-io/emmett';
import { getApplication, startAPI } from '@event-driven-io/emmett-expressjs';
import type { Application } from 'express';
import type { Server } from 'http';

const eventStore = getInMemoryEventStore();

const shoppingCarts = shoppingCartApi(
  eventStore,
  getUnitPrice,
  () => new Date(),
);

const application: Application = getApplication({
  apis: [shoppingCarts],
});

const server: Server = startAPI(application);
```

That replaces the usual bootstrap code for creating Express, installing body parsers, mounting feature routes, and registering shared error handling. It does not hide the routes, commands, queries, or dependencies that make up the API.

By default, `getApplication` and `configureApplication`:

1. Disable Express-generated ETags, so ETags returned by the API are explicit by default.
2. Install `express.json()` and `express.urlencoded({ extended: true })`.
3. Add the active trace ID to the `x-trace-id` response header when `observability` is provided.
4. Register the supplied API route setups.
5. Install Problem Details error middleware after those routes.

Each default parser and the Problem Details middleware can be disabled. Use `registerWebApi` when the application already owns the full middleware stack and only wants route registration.

## Application Setup

Choose the setup function based on how much of the Express stack the package should configure:

| Starting point                              | Use                                          | Result                                                                                    |
| ------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| A new Web API                               | `getApplication(options)`                    | Creates Express and applies the default HTTP setup                                        |
| An existing Express application             | `configureApplication(application, options)` | Adds the same default HTTP setup to the provided Express application                      |
| An application with its own middleware plan | `registerWebApi(application, apiSetups)`     | Registers only the supplied route setups, without changing application settings or errors |

For an existing application that already has middleware, `registerWebApi` lets the caller keep ordering explicit:

```typescript
import express from 'express';
import {
  problemDetailsMiddleware,
  registerWebApi,
  traceIdMiddleware,
} from '@event-driven-io/emmett-expressjs';

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
```

In that example `/health` stays outside authentication. The API routes use the caller's parsers, tracing, and authentication. Problem Details middleware is registered after the routes whose errors it handles.

### Application Options

`getApplication` and `configureApplication` accept `ApplicationOptions`. Omitted boolean options are treated as `false`. For the `disable...` options, that means the default middleware is installed unless the option is set to `true`.

| Option                            | Behaviour                                                                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `apis`                            | Required. Each setup registers routes on one shared router, which is then mounted on the application                                  |
| `mapError`                        | Optional error mapper tried before the default Problem Details mapping                                                                |
| `enableDefaultExpressEtag`        | Default `false`. Keeps Express-generated ETags off. Set to `true` when responses should also receive Express cache validators         |
| `disableJsonMiddleware`           | Default `false`. Installs `express.json()`. Set to `true` when the application configures JSON parsing itself                         |
| `disableUrlEncodingMiddleware`    | Default `false`. Installs `express.urlencoded({ extended: true })`. Set to `true` when the application configures URL-encoded parsing |
| `disableProblemDetailsMiddleware` | Default `false`. Installs Problem Details error middleware. Set to `true` when the application owns error serialisation               |
| `observability`                   | Optional. When provided, adds the active trace ID to the `x-trace-id` response header                                                 |

`configureApplication` also applies the ETag setting. It sets Express's `etag` option to `false` unless `enableDefaultExpressEtag` is `true`. Use `registerWebApi` instead when route registration must not change existing application settings.

## Defining Routes

A `WebApiSetup` is a function that receives an Express router. A feature can export one setup containing its related command and query endpoints while closing over the event store, read store, and other dependencies it needs.

Command routes are where Emmett does most of its work: they call a command handler that loads state, runs the decision, and appends the resulting events. Query routes use the same Express and response helpers, but read from a read model instead of calling a command handler.

This query route is copied from the existing Query Read Models snippet. It uses an injected Pongo read store, returns 404 when the read model is absent or no longer open, and returns the model with 200 when found:

```typescript
import {
  NotFound,
  OK,
  on,
  type WebApiSetup,
} from '@event-driven-io/emmett-expressjs';
import type { PongoDb } from '@event-driven-io/pongo';
import type { Request, Router } from 'express';

type ShoppingCartShortInfo = {
  productItemsCount: number;
  totalAmount: number;
};

type ShoppingCartDetails = {
  clientId: string;
  productItemsCount: number;
  totalAmount: number;
  status: 'Opened' | 'Confirmed' | 'Cancelled';
  openedAt: Date;
  confirmedAt?: Date | undefined;
  cancelledAt?: Date | undefined;
};

const shoppingCartShortInfoCollectionName = 'shoppingCartShortInfo';
const shoppingCartDetailsCollectionName = 'shoppingCartDetails';

const getShortInfoById = (
  db: PongoDb,
  shoppingCartId: string,
): Promise<ShoppingCartShortInfo | null> =>
  db
    .collection<ShoppingCartShortInfo>(shoppingCartShortInfoCollectionName)
    .findOne({ _id: shoppingCartId });

const getDetailsById = (
  db: PongoDb,
  shoppingCartId: string,
): Promise<ShoppingCartDetails | null> =>
  db
    .collection<ShoppingCartDetails>(shoppingCartDetailsCollectionName)
    .findOne({ _id: shoppingCartId });

const shoppingCartApi =
  (readStore: PongoDb): WebApiSetup =>
  (router: Router) => {
    router.get(
      '/clients/:clientId/shopping-carts/current',
      on(async (request: Request) => {
        const shoppingCartId = `shopping_cart:${String(request.params.clientId)}:current`;

        const result = await getDetailsById(readStore, shoppingCartId);

        if (result === null)
          return NotFound({
            problemDetails: 'No open shopping cart was found',
          });

        if (result.status !== 'Opened')
          return NotFound({
            problemDetails: 'No open shopping cart was found',
          });

        return OK({ body: result });
      }),
    );

    router.get(
      '/clients/:clientId/shopping-carts/current/short-info',
      on(async (request: Request) => {
        const shoppingCartId = `shopping_cart:${String(request.params.clientId)}:current`;

        const result = await getShortInfoById(readStore, shoppingCartId);

        if (result === null)
          return NotFound({
            problemDetails: 'Shopping cart summary was not found',
          });

        return OK({ body: result });
      }),
    );
  };
```

`on` adapts an async route function that returns an `HttpResponse`. The response helper applies the status, body, and headers to the Express response. The route still chooses the outcome. See the Getting Started and Query Read Models docs for the surrounding command handler, projection, and read-store setup.

## Response Helpers

The response helpers give routes one return shape for expected outcomes:

| Helper               | Status | Typical use                                                                 |
| -------------------- | ------ | --------------------------------------------------------------------------- |
| `OK`                 | 200    | Return a representation, with optional `Location` and ETag headers          |
| `Created`            | 201    | Return a newly created resource or ID and set its `Location`                |
| `Accepted`           | 202    | Accept work that continues elsewhere and identify its status resource       |
| `NoContent`          | 204    | Complete a command without returning a body, optionally with an ETag        |
| `HttpResponse`       | Custom | Use another successful or application-specific status                       |
| `BadRequest`         | 400    | Return Problem Details for a request the API cannot accept                  |
| `Forbidden`          | 403    | Return Problem Details when the requested operation is not allowed          |
| `NotFound`           | 404    | Return Problem Details when the requested resource is absent                |
| `Conflict`           | 409    | Return Problem Details when the request conflicts with the current state    |
| `PreconditionFailed` | 412    | Return Problem Details when a condition such as `If-Match` is not satisfied |
| `HttpProblem`        | Custom | Return Problem Details with another error status                            |

`Created({ createdId })` appends `createdId` to the request URL for the `Location` header and sends `{ id: createdId, ...body }`. `Created({ url })` sets `Location` directly. `Accepted` requires `location`; the other success helpers accept it optionally.

Problem responses accept either `problem: ProblemDocument` or `problemDetails: string`.

## Problem Details Errors

`getApplication` and `configureApplication` install `problemDetailsMiddleware` after the API routes by default. Express passes thrown errors and rejected async handlers to it, and the middleware returns `application/problem+json` using the Problem Details format.

That is useful when more than one route can fail. Without shared error middleware, every command and query route needs to catch errors, choose an HTTP status, and maintain its own error-body shape. Problem Details keeps the public error contract consistent across routes.

The default mapping uses a numeric `errorCode` from 100 through 599 as the HTTP status. Plain `Error` objects without a valid `errorCode` become 500 responses with the error message as `detail`. Strings become 500 responses with the string as `detail`. Other values become 500 responses with `Internal Server Error`.

Use `mapError` for errors from libraries or application code that should be translated into a public Problem Details document:

```typescript
import { getApplication, on } from '@event-driven-io/emmett-expressjs';
import type { Router } from 'express';
import { ProblemDocument } from 'http-problem-details';

// an error from a library you do not control
class CardDeclinedError extends Error {
  constructor(public readonly code: string) {
    super(`Card declined: ${code}`);
  }
}

const checkoutApi = (router: Router) =>
  router.post(
    '/charges',
    on(() => {
      throw new CardDeclinedError('insufficient_funds');
    }),
  );

const checkoutApplication = getApplication({
  apis: [checkoutApi],
  // translate a foreign error into Problem Details;
  // return undefined to fall back to the default mapping
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
```

Set `disableProblemDetailsMiddleware: true` when the application already has an error contract.

## Command Results from Returned Events

A command handler can return a business failure event without appending it, for example through `rejectOn` or `stopOn`. Because nothing was thrown, Express error middleware does not see that outcome. `ResponseFromEvents` maps the returned events explicitly to the same `HttpResponse` shape used by other `on` handlers.

The tested route excerpt below shows the integration point. The command handler and event store are supplied by the surrounding application setup:

```typescript
import {
  Conflict,
  ResponseFromEvents,
  on,
} from '@event-driven-io/emmett-expressjs';

const addProductItemApi = (router: Router) => {
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
};
```

`sendResponseFromEvents(response, options)` performs the same selection and applies the response immediately.

## ETags for Optimistic Concurrency

The ETag helpers carry stream versions through HTTP:

1. A successful command response returns the current stream version as an ETag.
2. The client sends that value in `If-Match` with its next update.
3. The route passes the value to the command handler as `expectedStreamVersion`.
4. If another request changed the stream first, the default error mapping returns 412 Precondition Failed.

```typescript
import {
  NoContent,
  getETagValueFromIfMatch,
  on,
  toWeakETag,
} from '@event-driven-io/emmett-expressjs';

// Add a product item, guarded by the version carried in the If-Match header
router.post(
  '/clients/:clientId/shopping-carts/:shoppingCartId/product-items',
  on(async (request: AddProductItemRequest) => {
    const shoppingCartId = assertNotEmptyString(request.params.shoppingCartId);
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
```

`getApplication` and `configureApplication` disable Express-generated ETags by default. This keeps stream-version ETags explicit. Express-generated ETags are content validators, not stream versions. Set `enableDefaultExpressEtag: true` only when the API also wants Express cache validators for responses that do not set an ETag explicitly.

`registerWebApi` does not change the Express ETag setting.

## API Testing

`ApiSpecification` builds SuperTest-based tests around a fresh event store and Express application. It can seed existing streams, execute one HTTP request, assert the response, and assert the events appended by the request:

```typescript
import {
  ApiSpecification,
  HeaderNames,
  existingStream,
  expectNewEvents,
  expectResponse,
  getApplication,
  toWeakETag,
} from '@event-driven-io/emmett-expressjs';
import { getInMemoryEventStore } from '@event-driven-io/emmett';
import { it } from 'vitest';

const apiSpecification = ApiSpecification.for({
  getEventStore: () => getInMemoryEventStore(),
  getApplication: (eventStore) =>
    getApplication({
      apis: [shoppingCartApi(eventStore)],
    }),
});

void it('checks an HTTP response and newly appended events', () => {
  const clientId = 'client-123';
  const shoppingCartId = `shopping_cart:${clientId}:current`;
  const productItem = { productId: 'product-123', quantity: 2 };

  return apiSpecification(
    existingStream<ShoppingCartEvent>(shoppingCartId, [
      {
        type: 'ShoppingCartOpened',
        data: {
          shoppingCartId,
          clientId,
          openedAt: new Date('2024-01-01T00:00:00Z'),
        },
      },
    ]),
  )
    .when((request) =>
      request
        .post(
          `/clients/${clientId}/shopping-carts/${shoppingCartId}/product-items`,
        )
        .set(HeaderNames.IF_MATCH, toWeakETag(1))
        .send(productItem),
    )
    .then([
      expectResponse(204, { headers: { etag: toWeakETag(2) } }),
      expectNewEvents(shoppingCartId, [
        {
          type: 'ProductItemAddedToShoppingCart',
          data: {
            shoppingCartId,
            productItem: { ...productItem, unitPrice: 100 },
          },
        },
      ]),
    ]);
});
```

Use `ApiE2ESpecification` when a test needs to execute setup requests before the request being asserted.

## API Reference

### Application

| Export                 | Description                                                                     |
| ---------------------- | ------------------------------------------------------------------------------- |
| `WebApiSetup`          | Function type for registering routes on an Express router                       |
| `ApplicationOptions`   | Options for route setup, middleware defaults, ETags, error mapping, and tracing |
| `getApplication`       | Creates a configured Express application                                        |
| `configureApplication` | Applies the default setup to an existing Express application                    |
| `registerWebApi`       | Registers only the supplied route setups on an existing Express application     |
| `StartApiOptions`      | Server startup options                                                          |
| `startAPI`             | Creates an HTTP server and starts listening                                     |

### Handlers and Responses

| Export                    | Description                                                                   |
| ------------------------- | ----------------------------------------------------------------------------- |
| `HttpResponse`            | Response function type and custom status response helper                      |
| `HttpHandler`             | Route function type that returns an `HttpResponse` or `Promise<HttpResponse>` |
| `on`                      | Express handler adapter for `HttpHandler` functions                           |
| `OK`, `Created`           | 200 and 201 success response helpers                                          |
| `Accepted`, `NoContent`   | 202 and 204 success response helpers                                          |
| `BadRequest`, `Forbidden` | 400 and 403 Problem Details helpers                                           |
| `NotFound`, `Conflict`    | 404 and 409 Problem Details helpers                                           |
| `PreconditionFailed`      | 412 Problem Details helper                                                    |
| `HttpProblem`             | Custom status Problem Details helper                                          |
| `ResponseFromEvents`      | Maps returned events to a success or failure response                         |
| `sendResponseFromEvents`  | Applies `ResponseFromEvents` directly to an Express response                  |

### ETags

| Export                    | Description                                                                  |
| ------------------------- | ---------------------------------------------------------------------------- |
| `HeaderNames`             | Header-name constants for `if-match`, `if-not-match`, and `etag`             |
| `ETag`, `WeakETag`        | Branded ETag string types                                                    |
| `WeakETagRegex`           | Regular expression used by the weak ETag parser                              |
| `ETagErrors`              | Error identifiers for missing and invalid ETag headers                       |
| `toWeakETag`              | Formats a number, bigint, or string as a weak ETag                           |
| `isWeakETag`              | Type guard for weak ETags                                                    |
| `getWeakETagValue`        | Returns the value inside a weak ETag or throws a concurrency error           |
| `getETagFromIfMatch`      | Reads `If-Match` or throws a concurrency error when the header is absent     |
| `getETagFromIfNotMatch`   | Reads `If-Not-Match` or throws a concurrency error when the header is absent |
| `getETagValueFromIfMatch` | Unwraps a weak `If-Match` value and returns any other ETag value unchanged   |
| `setETag`                 | Sets the response `ETag` header                                              |

### Middleware

| Export                                | Description                                                        |
| ------------------------------------- | ------------------------------------------------------------------ |
| `problemDetailsMiddleware`            | Express error middleware that serialises errors as Problem Details |
| `defaultErrorToProblemDetailsMapping` | Default error-to-Problem Details mapper                            |
| `traceIdMiddleware`                   | Adds the active trace ID to the `x-trace-id` response header       |
| `ErrorToProblemDetailsMapping`        | Type for a custom error mapper                                     |

### Testing

| Export                | Description                                                           |
| --------------------- | --------------------------------------------------------------------- |
| `ApiSpecification`    | Given/when/then API test builder with event-store seeding and asserts |
| `ApiE2ESpecification` | Given/when/then API test builder for multi-request flows              |
| `existingStream`      | Defines a stream and events to seed before a request                  |
| `expectNewEvents`     | Asserts events appended by the request                                |
| `expectResponse`      | Asserts response status, body, and headers                            |
| `expectError`         | Asserts a Problem Details error response                              |
| `TestRequest`         | Type for a SuperTest request setup function                           |

## Documentation

- [Express.js Integration](https://event-driven-io.github.io/emmett/frameworks/expressjs.html)
- [Getting Started](https://event-driven-io.github.io/emmett/getting-started.html)
- [Command Handling](https://event-driven-io.github.io/emmett/guides/command-handling.html)
- [Query Read Models](https://event-driven-io.github.io/emmett/guides/projections.html#query)
