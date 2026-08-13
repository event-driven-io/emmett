# @event-driven-io/emmett-honojs

Hono integration for Emmett Web APIs.

Use this package when you want to expose your application through HTTP and you already have a Hono API, prefer Hono for new services, or want a Fetch-native framework with a small integration layer. The package helps with route composition, response helpers, Problem Details errors, explicit ETags for optimistic concurrency, and API tests.

Routes remain ordinary Hono routes. A command route reads and validates the request, obtains any external data the decision needs, calls the command handler, and chooses a response. A query route reads its parameters, queries the read store, and returns the matching model. The integration supplies the repeated HTTP boundary work around both kinds of route.

The application setup and response helpers can also be used without event sourcing. The command-result, ETag, and event-backed testing helpers are useful when those concerns are part of the API.

## Purpose

This package provides the Hono-specific pieces around an HTTP API:

| Concern                | What the package provides                                                         | What remains in the route or application                  |
| ---------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Hono setup             | Feature-route registration, generated ETags, and Problem Details errors           | Authentication, tracing, and application-specific routes  |
| HTTP responses         | Helpers for status codes, bodies, `Location`, ETag, and Problem Details responses | Choosing the response that represents each route outcome  |
| Command results        | Mapping returned events to success or failure responses                           | Deciding whether business failures are returned or thrown |
| Optimistic concurrency | Reading `If-Match` and returning stream versions as ETags                         | Choosing which writes require a client-supplied version   |
| API tests              | Given/when/then tests using Hono's in-process request API and an event store      | The requests, initial events, and outcomes to assert      |

It does not dispatch commands by itself, build projections, choose a database, or replace Hono middleware. Those choices stay in the application.

## Installation

```bash
npm install @event-driven-io/emmett-honojs
```

The package declares peer dependencies for Emmett, Hono, the Hono Node server adapter, and Problem Details. npm 7 and newer install missing peers automatically. With package managers that do not install peer dependencies automatically, follow the peer dependency warnings they print.

## Quick Start

Start with a feature route setup. The route remains an ordinary Hono route: it reads and validates the request, obtains external data the decision needs, calls the command handler, and chooses the HTTP response. This excerpt is copied from the package E2E test; the surrounding feature setup supplies the router, event store, command handler, and domain functions.

```typescript
router.post(
  '/clients/:clientId/shopping-carts/:shoppingCartId/product-items',
  async (context: AddProductItemContext) => {
    const shoppingCartId = assertNotEmptyString(
      context.req.param('shoppingCartId'),
    );
    const body = await context.req.json();
    const productItem: ProductItem = {
      productId: assertNotEmptyString(body.productId),
      quantity: assertPositiveNumber(body.quantity),
    };
    const unitPrice = dummyPriceProvider(productItem.productId);

    const command: AddProductItemToShoppingCart = {
      type: 'AddProductItemToShoppingCart',
      data: {
        shoppingCartId,
        productItem: { ...productItem, unitPrice },
      },
    };

    const result = await handle(eventStore, shoppingCartId, command, {
      expectedStreamVersion: assertUnsignedBigInt(
        getETagValueFromIfMatch(context),
      ),
    });

    return NoContent({
      context,
      eTag: toWeakETag(result.nextExpectedStreamVersion),
    });
  },
);
```

`configureApplication` can add Emmett's defaults to an existing Hono application. This tested setup keeps `/health` on the caller-owned app, then registers the shopping-cart API:

```typescript
const existingApplication = new Hono();

existingApplication.get('/health', (context) => {
  return context.json({ status: 'ok' });
});

const configuredApplication: Hono = configureApplication(existingApplication, {
  apis: [shoppingCarts],
});
```

That replaces the usual Emmett bootstrap code for route registration, generated ETags, and shared Problem Details error handling. It does not hide the routes, commands, queries, or dependencies that make up the API.

By default, `getApplication` and `configureApplication`:

1. Install Hono's `etag()` middleware.
2. Register the supplied API route setups.
3. Register a Problem Details `onError` handler.

Use `registerWebApi` when the application already owns the full middleware stack and only wants route registration.

## Application Setup

Choose the setup function based on how much of the Hono stack the package should configure:

| Starting point                              | Use                                          | Result                                                                          |
| ------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------- |
| A new Web API                               | `getApplication(options)`                    | Creates Hono and applies the default HTTP setup                                 |
| An existing Hono application                | `configureApplication(application, options)` | Adds the same default HTTP setup to the provided Hono application               |
| An application with its own middleware plan | `registerWebApi(application, apiSetups)`     | Registers only the supplied route setups, without changing middleware or errors |

For an existing application that already has middleware, `registerWebApi` lets the caller keep ordering explicit:

```typescript
import { Hono } from 'hono';
import { registerWebApi } from '@event-driven-io/emmett-honojs';

const application = new Hono();

application.get('/health', (context) => {
  return context.json({ status: 'ok' });
});
application.use('*', authenticateRequest);

registerWebApi(application, [echoBodyApi, asyncErrorApi]);

application.onError((error, context) => {
  return context.json(
    { detail: error instanceof Error ? error.message : 'Unknown error' },
    500,
  );
});
```

In that example `/health` stays outside authentication. The API routes use the caller's middleware and error contract.

### Application Options

`getApplication` and `configureApplication` accept `ApplicationOptions`. Omitted boolean options are treated as `false`. For `disableProblemDetailsMiddleware`, that means the default Hono error handler is installed unless the option is set to `true`.

| Option                            | Behaviour                                                                                                         |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `apis`                            | Required. Each setup registers routes on one shared Hono router, which is then mounted on the application         |
| `mapError`                        | Optional error mapper tried before the default Problem Details mapping                                            |
| `disableProblemDetailsMiddleware` | Default `false`. Registers Problem Details error handling. Set to `true` when the application owns error handling |

`configureApplication` also installs Hono's `etag()` middleware. Use `registerWebApi` instead when route registration must not add generated ETags.

## Defining Routes

A `WebApiSetup` is a function that receives a Hono router. A feature can export one setup containing its related command and query endpoints while closing over the event store, read store, and other dependencies it needs.

Command routes call a command handler that loads state, runs the decision, and appends the resulting events. Query routes use the same Hono and response helpers, but read from a read model instead of calling a command handler.

This query route is copied from the package integration test. It reads from an injected read model, returns 404 when the model is absent, and returns the model with 200 when found:

```typescript
const shoppingCartDetailsApi: WebApiSetup = (router) => {
  router.get('/shopping-carts/:shoppingCartId', (context: Context) => {
    const shoppingCartId = context.req.param('shoppingCartId');
    const result = shoppingCartDetails.get(shoppingCartId);

    return result === undefined
      ? NotFound({
          context,
          problemDetails: `Shopping cart ${shoppingCartId} was not found`,
        })
      : OK({ context, body: result });
  });
};
```

The response helper applies the status, body, and headers through the Hono context and returns a Fetch `Response`. The route still chooses the outcome. See the Getting Started and Query Read Models docs for the surrounding command handler, projection, and read-store setup.

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

`Created({ context, createdId })` appends `createdId` to the request URL for the `Location` header and sends `{ id: createdId, ...body }`. `Created({ context, url })` sets `Location` directly. `Accepted` requires `location`; the other success helpers accept it optionally.

Problem responses accept either `problem: ProblemDocument` or `problemDetails: string`.

## Problem Details Errors

`getApplication` and `configureApplication` register a Problem Details `onError` handler by default. It returns `application/problem+json` using the Problem Details format.

That is useful when more than one route can fail. Without shared error handling, every command and query route needs to catch errors, choose an HTTP status, and maintain its own error-body shape. Problem Details keeps the public error contract consistent across routes.

The default mapping uses a numeric `errorCode` from 100 through 599 as the HTTP status. Plain `Error` objects without a valid `errorCode` become 500 responses with the error message as `detail`.

Use `mapError` for errors from libraries or application code that should be translated into a public Problem Details document. Set `disableProblemDetailsMiddleware: true` when the application already has an error contract.

## Command Results from Returned Events

A command handler can return a business failure event without appending it, for example through `rejectOn` or `stopOn`. Because nothing was thrown, Hono error handling does not see that outcome. `ResponseFromEvents` maps the returned events explicitly to the same `Response` shape used by other Hono routes.

`sendResponseFromEvents(context, options)` performs the same selection and returns the response immediately.

## ETags for Optimistic Concurrency

The ETag helpers carry stream versions through HTTP:

1. A successful command response returns the current stream version as an ETag.
2. The client sends that value in `If-Match` with its next update.
3. The route passes the value to the command handler as `expectedStreamVersion`.
4. If another request changed the stream first, the default error mapping returns 412 Precondition Failed.

```typescript
const result = await handle(
  eventStore,
  shoppingCartId,
  {
    type: 'AddProductItemToShoppingCart',
    data: {
      shoppingCartId,
      productItem: { ...productItem, unitPrice },
    },
  },
  {
    expectedStreamVersion: assertUnsignedBigInt(
      getETagValueFromIfMatch(context),
    ),
  },
);

return NoContent({
  context,
  eTag: toWeakETag(result.nextExpectedStreamVersion),
});
```

`getApplication` and `configureApplication` install Hono's generated `etag()` middleware by default. Explicit stream-version ETags from response helpers take precedence over generated response-body ETags. Use `registerWebApi` when the application should mount routes without adding generated ETags.

## API Testing

`ApiSpecification` builds tests around a fresh event store and Hono application. It can seed existing streams, execute one HTTP request, assert the response, and assert the events appended by the request:

```typescript
const apiSpecification = ApiSpecification.for({
  getEventStore: () => getInMemoryEventStore(),
  getApplication: (eventStore) =>
    getApplication({
      apis: [shoppingCartApi(eventStore)],
    }),
});
```

Use `ApiE2ESpecification` when a test needs to execute setup requests before the request being asserted.

## API Reference

### Application

| Export                 | Description                                                              |
| ---------------------- | ------------------------------------------------------------------------ |
| `WebApiSetup`          | Function type for registering routes on a Hono router                    |
| `ApplicationOptions`   | Options for route setup, generated ETags, and error mapping              |
| `getApplication`       | Creates a configured Hono application                                    |
| `configureApplication` | Applies the default setup to an existing Hono application                |
| `registerWebApi`       | Registers only the supplied route setups on an existing Hono application |
| `StartApiOptions`      | Server startup options                                                   |
| `startAPI`             | Starts the Hono application through `@hono/node-server`                  |

### Handlers and Responses

| Export                    | Description                                             |
| ------------------------- | ------------------------------------------------------- |
| `ContextWithBody`         | Context helper type for a typed JSON body               |
| `ContextWithQuery`        | Context helper type for a typed query object            |
| `ContextWithParams`       | Context helper type for typed route parameters          |
| `OK`, `Created`           | 200 and 201 success response helpers                    |
| `Accepted`, `NoContent`   | 202 and 204 success response helpers                    |
| `BadRequest`, `Forbidden` | 400 and 403 Problem Details helpers                     |
| `NotFound`, `Conflict`    | 404 and 409 Problem Details helpers                     |
| `PreconditionFailed`      | 412 Problem Details helper                              |
| `HttpProblem`             | Custom status Problem Details helper                    |
| `ResponseFromEvents`      | Maps returned events to a success or failure response   |
| `sendResponseFromEvents`  | Applies `ResponseFromEvents` directly to a Hono context |

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

| Export                                | Description                             |
| ------------------------------------- | --------------------------------------- |
| `defaultErrorToProblemDetailsMapping` | Default error-to-Problem Details mapper |
| `ErrorToProblemDetailsMapping`        | Type for a custom error mapper          |

### Testing

| Export                | Description                                                           |
| --------------------- | --------------------------------------------------------------------- |
| `ApiSpecification`    | Given/when/then API test builder with event-store seeding and asserts |
| `ApiE2ESpecification` | Given/when/then API test builder for multi-request flows              |
| `existingStream`      | Defines a stream and events to seed before a request                  |
| `expectNewEvents`     | Asserts events appended by the request                                |
| `expectResponse`      | Asserts response status, body, and headers                            |
| `expectError`         | Asserts a Problem Details error response                              |
| `TestRequest`         | Type for a Hono request setup function                                |

## Documentation

- [Hono Integration](https://event-driven-io.github.io/emmett/frameworks/honojs.html)
- [Hono + PostgreSQL sample](https://github.com/event-driven-io/emmett/tree/main/samples/webApi/honojs-with-postgresql)
- [Getting Started](https://event-driven-io.github.io/emmett/getting-started.html)
- [Command Handling](https://event-driven-io.github.io/emmett/guides/command-handling.html)
- [Query Read Models](https://event-driven-io.github.io/emmett/guides/projections.html#query)
