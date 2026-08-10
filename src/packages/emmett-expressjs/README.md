# @event-driven-io/emmett-expressjs

Express.js integration for the Emmett event sourcing library, providing HTTP request handling, response helpers, ETag support for optimistic concurrency, RFC 7807 Problem Details middleware, and BDD-style API testing utilities.

## Purpose

This package bridges Emmett's event sourcing capabilities with Express.js web applications. It provides:

- A functional handler pattern with deferred response execution
- Built-in ETag utilities for optimistic concurrency control
- RFC 7807 Problem Details error handling middleware
- BDD-style API specification testing utilities
- Response helpers for common HTTP status codes

## Key Concepts

### Handler Pattern

The package uses an `on()` wrapper function that enables handlers to return `HttpResponse` functions rather than directly manipulating the response object. This creates a clean separation between business logic and HTTP response handling:

```typescript
export type HttpResponse = (response: Response) => void;

export type HttpHandler<RequestType extends Request> = (
  request: RequestType,
) => Promise<HttpResponse> | HttpResponse;

export const on =
  <RequestType extends Request>(handle: HttpHandler<RequestType>) =>
  async (
    request: RequestType,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    const setResponse = await Promise.resolve(handle(request));
    return setResponse(response);
  };
```

### ETag-Based Optimistic Concurrency

Express's default ETag behavior is disabled to enable explicit optimistic concurrency control via `if-match` and `if-not-match` headers. The package provides branded `ETag` and `WeakETag` types for type-safe ETag handling.

### Problem Details

Errors are automatically converted to RFC 7807 Problem Details format. Errors with an `errorCode` property (100-599) map to the corresponding HTTP status code.

## Installation

```bash
npm install @event-driven-io/emmett-expressjs
```

All dependencies are peer dependencies, so you also need to install:

```bash
npm install @event-driven-io/emmett express http-problem-details supertest
npm install -D @types/express @types/supertest
```

## Quick Start

### Creating an Express Application

```typescript
import { getInMemoryEventStore } from '@event-driven-io/emmett';
import { getApplication, startAPI } from '@event-driven-io/emmett-expressjs';
import type { Application } from 'express';

const eventStore = getInMemoryEventStore();

const application: Application = getApplication({
  apis: [shoppingCartApi(eventStore)],
});

startAPI(application, { port: 3000 });
```

### Using an Existing Express Application

Use `configureApplication` to keep ownership of the Express application while applying Emmett's conventional setup:

```typescript
import express from 'express';
import {
  configureApplication,
  startAPI,
} from '@event-driven-io/emmett-expressjs';

const application = express();

application.get('/health', (_request, response) => {
  response.status(200).json({ status: 'ok' });
});
application.use(authMiddleware);

configureApplication(application, {
  apis: [shoppingCartApi(eventStore)],
});

startAPI(application, { port: 3000 });
```

It applies the same ETag setting, middleware, routes, and error handling as `getApplication`, including the middleware disable options.

Use `registerWebApi` when infrastructure routes and middleware must be positioned completely explicitly. It registers only the supplied API routes; it does not configure the application or install middleware:

```typescript
import express from 'express';
import {
  problemDetailsMiddleware,
  registerWebApi,
  startAPI,
} from '@event-driven-io/emmett-expressjs';

const application = express();

application.get('/health', (_request, response) => {
  response.status(200).json({ status: 'ok' });
});

application.use(express.json());
application.use(authMiddleware);

registerWebApi(application, [shoppingCartApi(eventStore)]);
application.use(problemDetailsMiddleware());

startAPI(application, { port: 3000 });
```

Express runs middleware in registration order, so `/health` is outside the authentication middleware in this example. The caller also retains Express's own ETag configuration.

### Defining API Routes

```typescript
import {
  NoContent,
  NotFound,
  OK,
  on,
  type WebApiSetup,
} from '@event-driven-io/emmett-expressjs';
import { CommandHandler, type EventStore } from '@event-driven-io/emmett';
import type { Request, Router } from 'express';

export const shoppingCartApi =
  (eventStore: EventStore): WebApiSetup =>
  (router: Router) => {
    // POST endpoint with command handling
    router.post(
      '/clients/:clientId/shopping-carts/current/product-items',
      on(async (request: Request) => {
        const shoppingCartId = `shopping_cart:${request.params.clientId}:current`;

        await handle(eventStore, shoppingCartId, (state) =>
          addProductItem(
            {
              type: 'AddProductItemToShoppingCart',
              data: {
                shoppingCartId,
                productItem: request.body,
              },
            },
            state,
          ),
        );

        return NoContent();
      }),
    );

    // GET endpoint with state aggregation
    router.get(
      '/clients/:clientId/shopping-carts/current',
      on(async (request: Request) => {
        const shoppingCartId = `shopping_cart:${request.params.clientId}:current`;

        const result = await eventStore.aggregateStream(shoppingCartId, {
          evolve,
          initialState,
        });

        if (result === null) return NotFound();

        return OK({ body: result.state });
      }),
    );
  };
```

## How-to Guides

### Working with ETags

Use ETags for optimistic concurrency control in update operations:

```typescript
import {
  getETagFromIfMatch,
  getWeakETagValue,
  toWeakETag,
  NoContent,
  PreconditionFailed,
} from '@event-driven-io/emmett-expressjs';

router.put(
  '/carts/:id',
  on(async (request: Request) => {
    const expectedVersion = getWeakETagValue(getETagFromIfMatch(request));

    const result = await handle(
      eventStore,
      request.params.id,
      (state) => updateCart(request.body, state),
      { expectedStreamVersion: BigInt(expectedVersion) },
    );

    return NoContent({ eTag: toWeakETag(result.nextExpectedStreamVersion) });
  }),
);
```

### Custom Error Mapping

Map domain errors to specific Problem Details responses:

```typescript
import { getApplication } from '@event-driven-io/emmett-expressjs';
import { ProblemDocument } from 'http-problem-details';

const application = getApplication({
  apis: [myApi],
  mapError: (error, request) => {
    if (error instanceof CartNotFoundError) {
      return new ProblemDocument({
        type: 'https://example.com/problems/cart-not-found',
        title: 'Cart Not Found',
        detail: error.message,
        status: 404,
      });
    }
    return undefined; // Fall back to default mapping
  },
});
```

### BDD-Style API Testing

Write declarative API tests using the given-when-then pattern:

```typescript
import {
  ApiSpecification,
  existingStream,
  expectNewEvents,
  expectResponse,
  expectError,
  getApplication,
} from '@event-driven-io/emmett-expressjs';
import {
  getInMemoryEventStore,
  type EventStore,
} from '@event-driven-io/emmett';
import { describe, it } from 'node:test';

describe('ShoppingCart API', () => {
  const given = ApiSpecification.for<ShoppingCartEvent>(
    (): EventStore => getInMemoryEventStore(),
    (eventStore: EventStore) =>
      getApplication({
        apis: [shoppingCartApi(eventStore)],
      }),
  );

  it('should add product to empty cart', () => {
    return given()
      .when((request) =>
        request
          .post('/clients/123/shopping-carts/current/product-items')
          .send({ productId: 'shoes', quantity: 1 }),
      )
      .then([
        expectResponse(204),
        expectNewEvents('shopping_cart:123:current', [
          {
            type: 'ProductItemAddedToShoppingCart',
            data: { productId: 'shoes', quantity: 1 },
          },
        ]),
      ]);
  });

  it('should not add to confirmed cart', () => {
    return given(
      existingStream('shopping_cart:123:current', [
        { type: 'ShoppingCartConfirmed', data: { confirmedAt: new Date() } },
      ]),
    )
      .when((request) =>
        request
          .post('/clients/123/shopping-carts/current/product-items')
          .send({ productId: 'shoes', quantity: 1 }),
      )
      .then(
        expectError(403, {
          detail: 'Shopping Cart already closed',
          status: 403,
        }),
      );
  });
});
```

### E2E API Testing

For end-to-end tests that execute multiple requests in sequence:

```typescript
import { ApiE2ESpecification } from '@event-driven-io/emmett-expressjs';

const given = ApiE2ESpecification.for(
  () => getEventStoreDBEventStore(client),
  (eventStore) => getApplication({ apis: [shoppingCartApi(eventStore)] }),
);

it('should confirm cart after adding products', () => {
  return given((request) =>
    request
      .post('/clients/123/shopping-carts/current/product-items')
      .send({ productId: 'shoes', quantity: 1 }),
  )
    .when((request) =>
      request.post('/clients/123/shopping-carts/current/confirm'),
    )
    .then([expectResponse(204)]);
});
```

## API Reference

### Application

| Export                 | Type                       | Description                                                             |
| ---------------------- | -------------------------- | ----------------------------------------------------------------------- |
| `WebApiSetup`          | `(router: Router) => void` | Function type for registering API routes                                |
| `ApplicationOptions`   | Object                     | Configuration for Express app (apis, error mapping, middleware toggles) |
| `configureApplication` | Function                   | Applies the conventional Emmett setup to an existing application        |
| `getApplication`       | Function                   | Creates configured Express application                                  |
| `registerWebApi`       | Function                   | Registers only Emmett API routes on an existing Express application     |
| `StartApiOptions`      | Object                     | Server startup configuration                                            |
| `startAPI`             | Function                   | Starts HTTP server on specified port                                    |

### Handler & Responses

| Export                     | Type                           | Description                               |
| -------------------------- | ------------------------------ | ----------------------------------------- |
| `HttpResponse`             | `(response: Response) => void` | Deferred response function                |
| `HttpHandler<RequestType>` | Function                       | Async handler returning HttpResponse      |
| `on`                       | Function                       | Wrapper for HttpHandler functions         |
| `OK`                       | Function                       | Returns 200 response                      |
| `Created`                  | Function                       | Returns 201 response with Location header |
| `Accepted`                 | Function                       | Returns 202 response                      |
| `NoContent`                | Function                       | Returns 204 response                      |
| `BadRequest`               | Function                       | Returns 400 Problem Details               |
| `Forbidden`                | Function                       | Returns 403 Problem Details               |
| `NotFound`                 | Function                       | Returns 404 Problem Details               |
| `Conflict`                 | Function                       | Returns 409 Problem Details               |
| `PreconditionFailed`       | Function                       | Returns 412 Problem Details               |
| `HttpProblem`              | Function                       | Returns custom status Problem Details     |

### ETag Utilities

| Export                    | Type           | Description                             |
| ------------------------- | -------------- | --------------------------------------- |
| `ETag`                    | Branded string | Strong ETag type                        |
| `WeakETag`                | Branded string | Weak ETag type (W/"...")                |
| `toWeakETag`              | Function       | Creates WeakETag from version number    |
| `getETagFromIfMatch`      | Function       | Extracts ETag from if-match header      |
| `getETagFromIfNotMatch`   | Function       | Extracts ETag from if-not-match header  |
| `getWeakETagValue`        | Function       | Extracts version value from WeakETag    |
| `getETagValueFromIfMatch` | Function       | Gets version value from if-match header |
| `setETag`                 | Function       | Sets ETag response header               |
| `isWeakETag`              | Function       | Type guard for WeakETag                 |

### Testing

| Export                | Type     | Description                                 |
| --------------------- | -------- | ------------------------------------------- |
| `ApiSpecification`    | Object   | BDD test builder for unit testing           |
| `ApiE2ESpecification` | Object   | BDD test builder for E2E testing            |
| `existingStream`      | Function | Defines pre-existing event stream for tests |
| `expectNewEvents`     | Function | Asserts expected new events in stream       |
| `expectResponse`      | Function | Asserts response status and body            |
| `expectError`         | Function | Asserts error response with Problem Details |
| `TestRequest`         | Type     | Function type for supertest requests        |

### Middleware

| Export                                | Type     | Description                              |
| ------------------------------------- | -------- | ---------------------------------------- |
| `problemDetailsMiddleware`            | Function | Express error middleware for RFC 7807    |
| `defaultErrorToProblemDetailsMapping` | Function | Default error to ProblemDocument mapping |
| `traceIdMiddleware`                   | Function | Adds the active trace ID response header |
| `ErrorToProblemDetailsMapping`        | Type     | Custom error mapping function type       |

## Architecture

```
src/
├── index.ts                              # Package entry point
├── application.ts                        # Express app factory and server startup
├── handler.ts                            # HttpResponse, on() wrapper, response helpers
├── etag.ts                               # ETag utilities for optimistic concurrency
├── responses.ts                          # Low-level HTTP response sending
├── middlewares/
│   └── problemDetailsMiddleware.ts       # RFC 7807 error handling
└── testing/
    ├── index.ts                          # Testing module entry point
    ├── apiSpecification.ts               # BDD unit test specification
    └── apiE2ESpecification.ts            # BDD E2E test specification
```

### Request Flow

1. Request arrives at Express router
2. `on()` wrapper invokes the `HttpHandler`
3. Handler processes request and returns an `HttpResponse` function
4. `on()` wrapper calls the `HttpResponse` function with the Express response
5. On error, `problemDetailsMiddleware` converts to RFC 7807 format

### Testing Architecture

The `ApiSpecification` wraps the event store to track appended events, enabling assertions on both HTTP responses and event store state changes. Test streams can be pre-populated using `existingStream()`.

## Dependencies

### Peer Dependencies (must be installed separately)

| Package                   | Version        | Purpose                     |
| ------------------------- | -------------- | --------------------------- |
| `@event-driven-io/emmett` | 0.43.0-beta.38 | Core event sourcing library |
| `express`                 | ^5.2.1         | Web framework               |
| `http-problem-details`    | ^0.1.7         | RFC 7807 Problem Details    |
| `supertest`               | ^7.2.2         | HTTP testing library        |
| `@types/express`          | ^5.0.6         | Express type definitions    |
| `@types/supertest`        | ^7.2.0         | Supertest type definitions  |
