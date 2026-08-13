---
documentationType: reference
outline: deep
---

# Hono Integration

`@event-driven-io/emmett-honojs` provides Hono adapters for exposing commands and read models through a Web API. Use it when you already have a Hono API, prefer Hono for a new service, or want a Fetch-native HTTP boundary with a small integration layer.

Routes remain ordinary Hono routes. A command route reads and validates the request, obtains any external data the decision needs, calls the command handler, and chooses a response. A query route reads its parameters, queries the read store, and returns the matching model. The integration supplies repeated HTTP boundary work around both kinds of route.

Nothing in the application setup or response handling requires event sourcing. Use the command-result, ETag, and event-backed testing helpers only where those concerns are part of the API.

## What the Integration Adds

| Concern                | What the integration provides                                                             | What remains in the route or application                  |
| ---------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Hono setup             | Feature-route registration, generated ETags, and Problem Details errors.                  | Authentication, tracing, and application-specific routes. |
| HTTP responses         | Helpers for status, body, `Location`, ETag, and Problem Details responses.                | Choosing the response that represents each outcome.       |
| Command results        | Mapping returned events to success or failure responses.                                  | Deciding whether business failures are returned or thrown |
| Optimistic concurrency | Reading `If-Match` and returning a stream version as an ETag.                             | Choosing which writes require a client-supplied version.  |
| API tests              | Given/when/then specifications built on Hono's in-process request API and an event store. | The initial events or requests and the outcomes to assert |

The integration does not dispatch commands, build projections, choose a database, or replace Hono middleware. Those choices stay explicit in the feature that defines each route.

## Installation

```bash
npm install @event-driven-io/emmett-honojs
```

## Set Up Hono

A Hono bootstrap for this kind of API usually repeats the same setup: create the application, mount feature routes, and define shared error handling. `getApplication` collects those application-level concerns in one call. It reduces bootstrap code, but it does not hide the routes, commands, queries, or dependencies that make up the API.

The shared error handling is useful once more than one route can fail. Without it, command and query routes each need to catch errors, choose an HTTP status, and maintain their own error-body shape. The default Problem Details error handler translates thrown errors in one place and gives clients the same standard response format across the API.

None of that setup is required. An existing application can receive the same defaults through `configureApplication`, or retain complete control by composing the smaller exports itself.

Choose the level that matches the application:

| Starting point                              | Use                                          | Result                                                                                  |
| ------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------- |
| A new Web API                               | `getApplication(options)`                    | Creates Hono and applies the default HTTP setup.                                        |
| An existing Hono application                | `configureApplication(application, options)` | Adds the default HTTP setup to the provided application.                                |
| An application with its own middleware plan | `registerWebApi(application, apiSetups)`     | Adds only the feature routes, leaving middleware, tracing, ETags, and errors untouched. |

### Start a New Hono API

`getApplication(options)` is the shortest path when the API does not already have a Hono bootstrap:

<<< @./../packages/emmett-honojs/src/application.int.spec.ts#default-application

It replaces repeated application, route, ETag, and error-handler registration with the following defaults:

1. Adds Hono's `etag()` middleware, which generates response-body ETags when a route has not set one explicitly.
2. Registers the supplied feature APIs.
3. Serialises thrown errors from those APIs in the standard Problem Details format, unless disabled.

Hono reads JSON, query string values, and route parameters through `context.req`. The integration does not install Express-style body parsers.

### Add the Defaults to an Existing Hono API

`configureApplication(application, options)` applies the same setup without creating the application. Existing infrastructure routes and middleware stay on the provided app. Here `/health` remains available beside the configured API stack:

<<< @./../packages/emmett-honojs/src/e2e/configureExistingApplication.e2e.spec.ts#configure-existing-application

`configureApplication` calls `application.onError` when Problem Details handling is enabled. Hono has one effective application error handler, so set `disableProblemDetailsMiddleware: true` and call `application.onError` yourself when the application already owns that contract:

<<< @./../packages/emmett-honojs/src/application.int.spec.ts#configure-custom-error-handler

### Compose Only What the Application Needs {#registering-api-routes}

Use `registerWebApi(application, apiSetups)` when the application already has a deliberate Hono stack. It creates and mounts the router for the supplied APIs without adding generated ETags or replacing error handling:

<<< @./../packages/emmett-honojs/src/application.int.spec.ts#route-only-registration

The example keeps `/health` outside authentication, then places authentication before the API router. The application error handler remains caller-owned.

The application can opt into the remaining pieces independently:

| Export                                | What it adds                                                                 |
| ------------------------------------- | ---------------------------------------------------------------------------- |
| `registerWebApi`                      | One router containing the supplied feature APIs.                             |
| `defaultErrorToProblemDetailsMapping` | Default translation from an error with `errorCode` to Problem Details.       |
| Response helpers                      | Route helpers that return a Fetch `Response` with status, body, and headers. |
| ETag helpers                          | Explicit `If-Match` parsing and response ETags for optimistic concurrency.   |

### Start the HTTP Server

`startAPI(application, options?)` starts the Hono application through `@hono/node-server`. Omitting the options uses port 3000.

### Application Options

`getApplication` and `configureApplication` accept `ApplicationOptions`. Omitted boolean options are treated as `false`. For `disableProblemDetailsMiddleware`, that means Problem Details handling is installed unless the option is set to `true`.

| Option                            | Behaviour                                                                                                                        |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `apis`                            | Required. Each setup registers routes on one shared Hono router, which is then mounted on the application.                       |
| `mapError`                        | Optional error mapper tried before the default Problem Details mapping.                                                          |
| `disableProblemDetailsMiddleware` | Default `false`. Registers a Hono `onError` handler for Problem Details. Set to `true` when the application owns error handling. |

## Define the Web API

### Keep Routes with Their Feature

A `WebApiSetup` is a function that receives a Hono router. A feature can export one setup containing its related command and query endpoints, while closing over the event store, read store, and other dependencies it needs. The application bootstrap composes those setups through `apis` without taking ownership of the endpoints themselves.

The command and query examples below are both ordinary Hono routes registered inside a setup. The response helpers receive the active Hono `context` and return a Fetch `Response`. The route remains responsible for reading the request, calling the application dependency it needs, and choosing the outcome.

All setups receive the same router in array order. The integration mounts that router once.

### Handle a Command

Command routes keep the complete application flow visible. This endpoint validates request data, obtains the current product price, builds a command, invokes the command handler, and returns 204 No Content with the next stream version as an ETag:

<<< @./../packages/emmett-honojs/src/e2e/decider/api.ts#etag-command-handler

The integration does not infer the command or decision from the route. For handler setup, decisions, retries, and idempotence, see [Command Handling](/guides/command-handling).

### Query a Read Model

Query routes use the same Hono and response abstractions without a command handler. This API queries a read model, returns 404 when the model is absent, and returns the model with 200 when found:

<<< @./../packages/emmett-honojs/src/application.int.spec.ts#query-read-model-route

The read store is an application choice rather than a Hono integration requirement. See [Read Models](/guides/projections) for the query and projection setup.

### Return HTTP Responses {#response-helpers}

Each expected outcome returns a Fetch `Response`: `OK` or `NotFound` for a query, and `NoContent` after the command completes. Each helper captures the status, body, and headers to send. The route remains responsible for choosing it.

The built-in response helpers are:

| Helper               | Status | Typical use                                                                  |
| -------------------- | ------ | ---------------------------------------------------------------------------- |
| `OK`                 | 200    | Return a representation, with optional `Location` and ETag headers.          |
| `Created`            | 201    | Return a newly created resource or ID and set its `Location`.                |
| `Accepted`           | 202    | Accept work that continues elsewhere and identify its status resource.       |
| `NoContent`          | 204    | Complete a command without returning a body, optionally with an ETag.        |
| `HttpResponse`       | Custom | Use another successful or application-specific status.                       |
| `BadRequest`         | 400    | Return Problem Details for a request the API cannot accept.                  |
| `Forbidden`          | 403    | Return Problem Details when the requested operation is not allowed.          |
| `NotFound`           | 404    | Return Problem Details when the requested resource is absent.                |
| `Conflict`           | 409    | Return Problem Details when the request conflicts with the current state.    |
| `PreconditionFailed` | 412    | Return Problem Details when a condition such as `If-Match` is not satisfied. |
| `HttpProblem`        | Custom | Return Problem Details with another error status.                            |

`Created({ context, createdId })` appends `createdId` to the request URL for the `Location` header and sends `{ id: createdId, ...body }`. Its `url` form supplies `Location` directly. `Accepted` requires `location`; the other success helpers accept it optionally.

Problem responses accept either `problem: ProblemDocument` or `problemDetails: string`. The latter creates a `ProblemDocument` with the helper's status code and the supplied string as `detail`.

## Return Consistent Errors

Successful routes choose their response explicitly. Thrown errors need a separate path: validation can fail, a decision can reject an invalid transition, a queried dependency can be unavailable, or a read model can be missing unexpectedly. Handling each case inside every route repeats `try`/`catch`, status selection, and response-body construction, and makes it easy for endpoints to drift into different error formats.

`getApplication` and `configureApplication` therefore register a Hono `onError` handler by default. The handler returns `application/problem+json` using the [Problem Details standard (RFC 9457)](https://www.rfc-editor.org/rfc/rfc9457.html). Clients can handle the same fields, including `status`, `title`, and `detail`, instead of learning a different error shape for each endpoint. For example, an `IllegalStateError` becomes:

```json
{
  "type": "about:blank",
  "title": "Forbidden",
  "status": 403,
  "detail": "Cannot confirm an empty shopping cart"
}
```

The default mapping uses a numeric `errorCode` from 100 through 599 as the HTTP status. Errors without a valid `errorCode` become 500 responses with the error message as `detail`. Emmett's built-in validation, illegal-state, not-found, and concurrency errors carry status codes 400, 403, 404, and 412 respectively.

Pass `mapError(error)` to translate an application-specific error into a `ProblemDocument`. Returning `undefined` delegates to the default mapping:

<<< @./../packages/emmett-honojs/src/application.int.spec.ts#custom-error-mapping

When the application already has an error contract, set `disableProblemDetailsMiddleware: true` and register the replacement with `application.onError`.

For deciding whether business logic should throw or return a failure event, see [Error Handling](/guides/error-handling).

### Map Returned Events to HTTP Responses {#mapping-events-to-responses}

A command handler can return a business failure event without appending it, for example through `rejectOn` or `stopOn`. Because nothing was thrown, Hono error handling does not see that outcome. `ResponseFromEvents(options)` maps it explicitly to the same `Response` returned by other Hono routes:

<<< @./../packages/emmett-honojs/src/responses.int.spec.ts#hono-response-from-events-route

| Option    | Type                                                 | Behaviour                                                                                   |
| --------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `context` | `Context`                                            | Supplies the Hono context used to create the response.                                      |
| `events`  | `Event[] \| { events: Event[] }`                     | Supplies the events or complete command-handler result.                                     |
| `success` | `number \| (source => number \| Response)`           | Selects the success response. Defaults to 204.                                              |
| `failure` | `(event, source) => number \| Response \| undefined` | Checks events from newest to oldest. The first defined result selects the failure response. |

`sendResponseFromEvents(context, options)` performs the same selection and returns the response immediately.

## Carry Stream Versions over HTTP {#etags}

An update based on stale state must not silently overwrite a newer stream version. The ETag helpers carry the optimistic concurrency check through HTTP:

1. A successful response returns the current stream version as an ETag.
2. The client sends that ETag in `If-Match` with its next update.
3. The route passes the value to the command handler as `expectedStreamVersion`.
4. If another request changed the stream first, the default error mapping returns 412 Precondition Failed.

This endpoint reads the version the client last saw and returns the version produced by the successful command:

<<< @./../packages/emmett-honojs/src/e2e/decider/api.ts#etag-command-handler

`getETagValueFromIfMatch` reports a missing `If-Match` header as a 412 error. `getWeakETagValue` does the same for a value that does not match `WeakETagRegex`. A version conflict raised by the event store follows the same Problem Details path.

`getApplication` and `configureApplication` add Hono's generated `etag()` middleware by default. An explicit stream-version ETag from a response helper takes precedence over a generated response-body ETag. Use `registerWebApi` when the application should mount routes without adding generated ETags.

### ETag Functions and Types

| Export                             | Type or result              | Behaviour                                                                             |
| ---------------------------------- | --------------------------- | ------------------------------------------------------------------------------------- |
| `HeaderNames`                      | Header-name constants       | Contains `if-match`, `if-not-match`, and `etag`.                                      |
| `ETag`                             | Branded `string`            | Represents an ETag value.                                                             |
| `WeakETag`                         | Branded `` `W/${string}` `` | Represents a weak ETag value.                                                         |
| `WeakETagRegex`                    | `RegExp`                    | Matches the weak ETag format accepted by `getWeakETagValue`.                          |
| `ETagErrors`                       | String enum                 | Contains invalid-format and missing-header error identifiers.                         |
| `toWeakETag(value)`                | `WeakETag`                  | Formats a number, bigint, or string as a weak ETag.                                   |
| `isWeakETag(etag)`                 | Type guard                  | Tests an ETag with `WeakETagRegex`.                                                   |
| `getWeakETagValue(etag)`           | `string`                    | Returns the value inside a weak ETag or throws a concurrency `EmmettError`.           |
| `getETagFromIfMatch(context)`      | `ETag`                      | Reads `If-Match` or throws a concurrency `EmmettError` when the header is absent.     |
| `getETagFromIfNotMatch(context)`   | `ETag`                      | Reads `if-not-match` or throws a concurrency `EmmettError` when the header is absent. |
| `getETagValueFromIfMatch(context)` | `string`                    | Unwraps a weak `If-Match` value and returns any other ETag value unchanged.           |
| `setETag(context, etag)`           | `void`                      | Sets the response `ETag` header.                                                      |

## Test the Web API

Unit tests cover a decision or query function on its own. An HTTP-level test covers the boundary around it: request mapping, middleware, error serialisation, response headers, and access to the configured stores.

The package provides two Hono request-based specifications:

| Specification         | Starting state                                  | Assertions                                   | Use it for                                                                     |
| --------------------- | ----------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------ |
| `ApiSpecification`    | Events written directly to one or more streams. | The HTTP response and newly appended events. | An event-backed integration test of a command endpoint.                        |
| `ApiE2ESpecification` | Requests sent in order through the application. | The final HTTP response.                     | A black-box flow where setup passes through the same public API as the action. |

### Start from Recorded Events

`ApiSpecification.for({ getEventStore, getApplication })` creates a fresh event store and application for each specification invocation:

<<< @./../packages/emmett-honojs/src/testing/apiSpecification.int.spec.ts#api-specification-setup

Streams passed to the given phase are written before the request. The specification wraps the event store so the assertion can check both the response observed by the caller and the events appended by that request:

<<< @./../packages/emmett-honojs/src/testing/apiSpecification.int.spec.ts#api-specification-example

### Start from Previous Requests

`ApiE2ESpecification.for({ getEventStore?, getApplication })` prepares state through requests instead of writing directly to the event store. It sends the given requests in order, sends the request under test, and checks the final response. `getEventStore` defaults to `getInMemoryEventStore`.

<<< @./../packages/emmett-honojs/src/testing/apiE2ESpecification.int.spec.ts#api-e2e-specification-setup

This example opens a cart, adds a product, and then confirms it through the public API:

<<< @./../packages/emmett-honojs/src/testing/apiE2ESpecification.int.spec.ts#api-e2e-specification-example

### Assertion Helpers

| Export            | Behaviour                                                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| `existingStream`  | Creates a `[streamId, events]` tuple that `ApiSpecification` writes before the request.                              |
| `expect`          | Creates a `[streamId, events]` tuple to match against events appended during the request.                            |
| `expectNewEvents` | An equivalent, more explicit name for `expect`.                                                                      |
| `expectResponse`  | Checks the exact status code and, when supplied, matches the specified body and header fields.                       |
| `expectError`     | Calls `expectResponse` with an error status and optional Problem Details fields.                                     |
| `TestRequest`     | A function receiving a Hono test agent and returning its configured request. It is used for given and when requests. |

`ApiSpecification.then` accepts a response assertion, expected event streams, or a response assertion followed by expected event streams. `ApiE2ESpecification.then` accepts one response assertion in a one-element array.

For choosing between decision, API, and infrastructure-backed tests, see [Testing](/guides/testing).

## Compatibility

The package peer dependencies are Hono `^4.11.7` and `@hono/node-server` `^1.19.9`. `startAPI` uses the Node server adapter. The application object remains a Hono application, so tests can call `application.request(...)` or use the package testing utilities without opening a network port.

## Type Sources

- [Application configuration](https://github.com/event-driven-io/emmett/blob/main/src/packages/emmett-honojs/src/application.ts)
- [Handlers and response helpers](https://github.com/event-driven-io/emmett/blob/main/src/packages/emmett-honojs/src/handler.ts)
- [ETag utilities](https://github.com/event-driven-io/emmett/blob/main/src/packages/emmett-honojs/src/etag.ts)
- [Response types and sending](https://github.com/event-driven-io/emmett/blob/main/src/packages/emmett-honojs/src/responses.ts)
- [Middleware](https://github.com/event-driven-io/emmett/tree/main/src/packages/emmett-honojs/src/middlewares)
- [Testing utilities](https://github.com/event-driven-io/emmett/tree/main/src/packages/emmett-honojs/src/testing)

## See Also

- [Hono + PostgreSQL sample](/samples/#hono-postgresql)
- [Express.js Integration](/frameworks/expressjs)
- [Command Handling](/guides/command-handling)
- [Read Models](/guides/projections)
- [Error Handling](/guides/error-handling)
- [Testing](/guides/testing)
- [How to use ETag header for optimistic concurrency](https://event-driven.io/pl/how_to_use_etag_header_for_optimistic_concurrency/)
