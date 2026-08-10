---
documentationType: reference
outline: deep
---

# Express.js Integration

`@event-driven-io/emmett-expressjs` provides the Express adapters for exposing commands and read models through a Web API. Use it when you already have an Express API, prefer Express for new development, or are unsure which Node.js web framework to choose and want a long-established, mature option.

Routes remain ordinary Express routes. A command route reads and validates the request, obtains any external data the decision needs, calls the command handler, and chooses a response. A query route reads its parameters, queries the read store, and returns the matching model. The integration supplies the repeated HTTP boundary work around both kinds of route.

Nothing in the application setup or response handling requires event sourcing. Use the command-result, ETag, and event-backed testing helpers only where those concerns are part of the API.

## What the Integration Adds

| Concern                | What the integration provides                                                                   | What remains in the route or application                   |
| ---------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Express setup          | Request parsing, feature-route registration, optional trace IDs, and Problem Details responses. | Authentication and any application-specific middleware.    |
| HTTP responses         | A common return type with helpers for status, body, `Location`, ETag, and error responses.      | Choosing the response that represents each outcome.        |
| Command results        | Mapping returned events to success or failure responses.                                        | Deciding whether business failures are returned or thrown. |
| Optimistic concurrency | Reading `If-Match` and returning a stream version as an ETag.                                   | Choosing which writes require a client-supplied version.   |
| API tests              | Given/when/then specifications built on SuperTest.                                              | The initial events or requests and the outcomes to assert. |

The integration does not dispatch commands, build projections, or choose a database. Those choices stay explicit in the feature that defines each route.

## Installation

```bash
npm install @event-driven-io/emmett-expressjs
```

## Set Up Express

An Express bootstrap for this kind of API usually repeats the same setup: create the application, install body parsers, mount the feature routes, and put shared error handling after those routes. Traced APIs also need middleware that exposes the active trace ID. `getApplication` collects those application-level concerns in one call. It reduces bootstrap code, but it does not hide the routes, commands, queries, or dependencies that make up the API.

The shared error handling is useful once more than one route can fail. Without it, command and query routes each need to catch errors, choose an HTTP status, and maintain their own error-body shape. The default Problem Details middleware does that translation in one place and gives clients the same standard response format across the API.

None of that setup is required. Each default body parser and the Problem Details middleware can be disabled independently. An existing application can receive the same defaults through `configureApplication`, or retain complete control by composing the smaller exports itself.

Choose the level that matches the application:

| Starting point                              | Use                                          | Result                                                                                        |
| ------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------- |
| A new Web API                               | `getApplication(options)`                    | Creates Express and applies the default HTTP setup.                                           |
| An existing Express application             | `configureApplication(application, options)` | Adds the default HTTP setup after the application's existing routes and middleware.           |
| An application with its own middleware plan | `registerWebApi(application, apiSetups)`     | Adds only the feature routes, leaving parsers, tracing, authentication, and errors untouched. |

### Start a New Express API

`getApplication(options)` is the shortest path when the API does not already have an Express bootstrap:

<<< @./../packages/emmett-expressjs/src/application.int.spec.ts#default-application

It replaces the repeated `express()`, parser, router, and error-middleware registration with the following defaults, in order:

1. Keeps ETags explicit by turning off Express's automatic response-body ETags. This avoids presenting a cache validator where an API may use an ETag as a stream version; enable `enableDefaultExpressEtag` when automatic ETags are also wanted for HTTP caching.
2. Parses JSON and URL-encoded requests, unless either parser is disabled.
3. Adds the active trace ID to responses when `observability` is provided.
4. Registers the supplied feature APIs.
5. Serialises errors from those APIs in the standard Problem Details format, unless disabled.

These defaults provide a working HTTP boundary, not an application architecture. Authentication, request validation, command mapping, read-store queries, and other application-specific work remain in caller-owned middleware and routes.

### Add the Defaults to an Existing Express API

`configureApplication(application, options)` applies the same setup without creating the application. Existing infrastructure routes and middleware stay before the Emmett routes. Here `/health` remains available outside the configured API stack:

<<< @./../packages/emmett-expressjs/src/e2e/configureExistingApplication.e2e.spec.ts#configure-existing-application

Each default can be replaced independently. This application installs its own JSON body parser, then disables the default parser so Express does not process the body twice:

<<< @./../packages/emmett-expressjs/src/application.int.spec.ts#configure-custom-json-middleware

`configureApplication` intentionally replaces the existing application's ETag setting with Emmett's default. Express normally generates weak ETags for response bodies, but Emmett disables them so every ETag exposed by default was assigned explicitly and can safely represent a stream version. Set `enableDefaultExpressEtag: true` when the application also needs Express-generated ETags for HTTP caching. Use `registerWebApi` instead when the integration should mount routes without changing this or any other application setting.

### Compose Only What the Application Needs {#registering-api-routes}

Use `registerWebApi(application, apiSetups)` when the application already has a deliberate Express stack. It creates and mounts the router for the supplied APIs without changing application settings or adding middleware:

<<< @./../packages/emmett-expressjs/src/application.int.spec.ts#route-only-registration

The example keeps `/health` outside authentication, then places parsing, tracing, and authentication before the API router. Problem Details middleware follows the routes whose errors it handles.

The application can opt into the remaining pieces independently:

| Export                     | What it adds                                                                        |
| -------------------------- | ----------------------------------------------------------------------------------- |
| `registerWebApi`           | One router containing the supplied feature APIs.                                    |
| `problemDetailsMiddleware` | One standard error-response contract for errors from routes registered before it.   |
| `traceIdMiddleware`        | The active OpenTelemetry trace ID in the `x-trace-id` response header.              |
| `on` and response helpers  | Route handlers that return an explicit HTTP response instead of mutating it inline. |
| ETag helpers               | Explicit `If-Match` parsing and response ETags for optimistic concurrency.          |

Express's own `express.json()` and `express.urlencoded()` remain available when the application needs different parser options. This granular path is also useful when existing authentication, observability, or error middleware already defines the required conventions.

### Start the HTTP Server

`startAPI(application, options?)` creates a Node HTTP server and starts listening. Omitting the options uses port 3000. The returned `http.Server` can be used for shutdown or other server-level integration.

### Application Options

`getApplication` and `configureApplication` accept `ApplicationOptions`. Omitted boolean options are treated as `false`. For the `disable...` options, that means the default middleware is installed unless the option is set to `true`.

| Option                            | Behaviour                                                                                                                                 |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `apis`                            | Required. Each setup registers routes on one shared router, which is then mounted on the application.                                     |
| `mapError`                        | Optional error mapper tried before the default Problem Details mapping.                                                                   |
| `enableDefaultExpressEtag`        | Default `false`. Keeps Express-generated ETags off; set to `true` when the API also wants Express cache validators for implicit ETags.    |
| `disableJsonMiddleware`           | Default `false`. Installs `express.json()`; set to `true` when the application configures JSON parsing itself.                            |
| `disableUrlEncodingMiddleware`    | Default `false`. Installs `express.urlencoded({ extended: true })`; set to `true` when the application configures URL-encoded parsing.    |
| `disableProblemDetailsMiddleware` | Default `false`. Installs Problem Details error middleware; set to `true` when the application owns error serialisation.                  |
| `observability`                   | Optional. When provided, adds the active trace ID to the `x-trace-id` response header. Omitted means no trace ID middleware is installed. |

## Define the Web API

### Keep Routes with Their Feature

A `WebApiSetup` is a function that receives an Express router. A feature can export one setup containing its related command and query endpoints, while closing over the event store, read store, and other dependencies it needs. The application bootstrap composes those setups through `apis` without taking ownership of the endpoints themselves.

The command and query examples below are both ordinary Express routes registered inside a setup. `on` adapts an async route function that returns an `HttpResponse`. `NoContent`, `OK`, and `NotFound` apply the status, body, and headers to the Express response. The route remains responsible for reading the request, calling the application dependency it needs, and choosing the outcome.

All setups receive the same router in array order. The integration mounts that router once.

### Handle a Command

Command routes keep the complete application flow visible. This endpoint validates request data, obtains the current product price, builds a command, invokes the command handler, and returns 204 No Content:

<<< @/snippets/gettingStarted/webApi/simpleApi.ts#add-product-item-endpoint

The integration does not infer the command or decision from the route. For handler setup, decisions, retries, and idempotence, see [Command Handling](/guides/command-handling).

### Query a Read Model

Query routes use the same Express and response abstractions without a command handler. This API queries an injected Pongo read store, returns 404 when a model is absent, and returns the model with 200 when found:

<<< @/guides/projections/queryingReadModels.snippet.ts#api-routes

The read store is an application choice rather than an Express integration requirement. See [Query Read Models](/guides/projections#query) for the query and projection setup.

### Return HTTP Responses {#response-helpers}

The examples above return an `HttpResponse` from every expected outcome: `OK` or `NotFound` for a query, and `NoContent` after the command completes. Each helper captures the status, body, and headers to send. `on` applies that choice to the Express response; the route remains responsible for choosing it.

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

`Created({ createdId })` appends `createdId` to the request URL for the `Location` header and sends `{ id: createdId, ...body }`. Its `url` form supplies `Location` directly. `Accepted` requires `location`; the other success helpers accept it optionally.

Problem responses accept either `problem: ProblemDocument` or `problemDetails: string`. The latter creates a `ProblemDocument` with the helper's status code and the supplied string as `detail`.

## Return Consistent Errors

Successful routes choose their response explicitly. Thrown errors need a separate path: validation can fail, a decision can reject an invalid transition, a queried dependency can be unavailable, or a read model can be missing unexpectedly. Handling each case inside every route repeats `try`/`catch`, status selection, and response-body construction, and makes it easy for endpoints to drift into different error formats.

`getApplication` and `configureApplication` therefore install `problemDetailsMiddleware` after the API routes by default. Express passes thrown errors and rejected async handlers to it, and the middleware returns `application/problem+json` using the [Problem Details standard (RFC 9457)](https://www.rfc-editor.org/rfc/rfc9457.html). Clients can handle the same fields, including `status`, `title`, and `detail`, instead of learning a different error shape for each endpoint. For example, an `IllegalStateError` becomes:

```json
{
  "type": "about:blank",
  "title": "Forbidden",
  "status": 403,
  "detail": "Cannot confirm an empty shopping cart"
}
```

The middleware handles exceptions. A business failure returned as an event is still a normal command result, so the route maps it explicitly with `ResponseFromEvents` or its own response selection.

The default mapping is:

| Error value                                                      | Status      | Detail                  |
| ---------------------------------------------------------------- | ----------- | ----------------------- |
| `Error` with `errorCode` from 100 through 599                    | `errorCode` | `error.message`         |
| `Error` without a valid `errorCode`                              | 500         | `error.message`         |
| `string`                                                         | 500         | The string value        |
| Object other than `Error`, with `errorCode` from 100 through 599 | `errorCode` | `Internal Server Error` |
| Any other value                                                  | 500         | `Internal Server Error` |

Emmett's built-in validation, illegal-state, not-found, and concurrency errors carry status codes 400, 403, 404, and 412 respectively.

Pass `mapError(error, request)` to translate an application-specific error into a `ProblemDocument`. This keeps library errors and application-specific error classes behind the same public HTTP contract. Returning `undefined` delegates to the default mapping:

<<< @./../packages/emmett-expressjs/src/mapError.int.spec.ts#custom-error-mapping

When the application already has an error contract, set `disableProblemDetailsMiddleware: true` and register the replacement after the API routes:

<<< @./../packages/emmett-expressjs/src/application.int.spec.ts#configure-custom-error-middleware

For a manually composed stack, call `problemDetailsMiddleware(mapError?)` directly after `registerWebApi`. Omitting it leaves error serialisation entirely to the application.

For deciding whether business logic should throw or return a failure event, see [Error Handling](/guides/error-handling).

### Map Returned Events to HTTP Responses {#mapping-events-to-responses}

A command handler can return a business failure event without appending it, for example through `rejectOn` or `stopOn`. Because nothing was thrown, Express error middleware does not see that outcome. `ResponseFromEvents(options)` maps it explicitly to the same `HttpResponse` returned by other `on` handlers:

<<< @./../packages/emmett-expressjs/src/responses.int.spec.ts#express-response-from-events-route

| Option    | Type                                                     | Behaviour                                                                                   |
| --------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `events`  | `Event[] \| { events: Event[] }`                         | Supplies the events or complete command-handler result.                                     |
| `success` | `number \| (source => number \| HttpResponse)`           | Selects the success response. Defaults to 204.                                              |
| `failure` | `(event, source) => number \| HttpResponse \| undefined` | Checks events from newest to oldest. The first defined result selects the failure response. |

`sendResponseFromEvents(response, options)` performs the same selection and applies the response immediately.

## Carry Stream Versions over HTTP {#etags}

An update based on stale state must not silently overwrite a newer stream version. The ETag helpers carry the optimistic concurrency check through HTTP:

1. A successful response returns the current stream version as an ETag.
2. The client sends that ETag in `If-Match` with its next update.
3. The route passes the value to the command handler as `expectedStreamVersion`.
4. If another request changed the stream first, the default error mapping returns 412 Precondition Failed.

This endpoint reads the version the client last saw and returns the version produced by the successful command:

<<< @./../packages/emmett-expressjs/src/e2e/commandHandler/api.ts#etag-command-handler

`getETagValueFromIfMatch` reports a missing `If-Match` header as a 412 error. `getWeakETagValue` does the same for a value that does not match `WeakETagRegex`. A version conflict raised by the event store follows the same Problem Details path.

`getApplication` and `configureApplication` disable Express-generated ETags by default so stream-version ETags remain explicit. Setting `enableDefaultExpressEtag` to `true` restores Express-generated ETags. `registerWebApi` does not change that Express setting.

Express generates an ETag only when the response has not already set one, so an explicit stream-version ETag from an Emmett response helper takes precedence. Generated ETags are still content hashes rather than stream versions. Enable them for ordinary HTTP caching only when clients can distinguish those values from the ETags used as `If-Match` versions on command endpoints.

The `eTag` option on success and Problem Details responses sets an explicit ETag independently of the application setting.

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
| `getETagFromIfMatch(request)`      | `ETag`                      | Reads `If-Match` or throws a concurrency `EmmettError` when the header is absent.     |
| `getETagFromIfNotMatch(request)`   | `ETag`                      | Reads `if-not-match` or throws a concurrency `EmmettError` when the header is absent. |
| `getETagValueFromIfMatch(request)` | `string`                    | Unwraps a weak `If-Match` value and returns any other ETag value unchanged.           |
| `setETag(response, etag)`          | `void`                      | Sets the response `ETag` header.                                                      |

## Include Trace IDs in Responses

When OpenTelemetry has an active span, `traceIdMiddleware` copies its trace ID to the `x-trace-id` response header. This gives API clients an identifier they can include when reporting a failed request. With no active span, the middleware adds no header.

Providing `observability` to `getApplication` or `configureApplication` installs this middleware before the API routes. An application using `registerWebApi` can place the exported middleware directly in its own stack.

## Test the Web API

Unit tests cover a decision or query function on its own. An HTTP-level test covers the boundary around it: request mapping, middleware, error serialisation, response headers, and access to the configured stores.

The package provides two SuperTest-based specifications:

| Specification         | Starting state                                  | Assertions                                   | Use it for                                                                     |
| --------------------- | ----------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------ |
| `ApiSpecification`    | Events written directly to one or more streams. | The HTTP response and newly appended events. | An event-backed integration test of a command endpoint.                        |
| `ApiE2ESpecification` | Requests sent in order through the application. | The final HTTP response.                     | A black-box flow where setup passes through the same public API as the action. |

### Start from Recorded Events

`ApiSpecification.for({ getEventStore, getApplication })` creates a fresh event store and application for each specification invocation:

<<< @./../packages/emmett-expressjs/src/testing/apiSpecification.int.spec.ts#api-specification-setup

Streams passed to the given phase are written before the request. The specification wraps the event store so the assertion can check both the response observed by the caller and the events appended by that request:

<<< @./../packages/emmett-expressjs/src/testing/apiSpecification.int.spec.ts#api-specification-example

### Start from Previous Requests

`ApiE2ESpecification.for({ getEventStore?, getApplication })` prepares state through requests instead of writing directly to the event store. It sends the given requests in order, sends the request under test, and checks the final response. `getEventStore` defaults to `getInMemoryEventStore`.

<<< @./../packages/emmett-expressjs/src/testing/apiE2ESpecification.int.spec.ts#api-e2e-specification-setup

This example opens a cart, adds a product, and then confirms it through the public API:

<<< @./../packages/emmett-expressjs/src/testing/apiE2ESpecification.int.spec.ts#api-e2e-specification-example

### Assertion Helpers

| Export            | Behaviour                                                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| `existingStream`  | Creates a `[streamId, events]` tuple that `ApiSpecification` writes before the request.                              |
| `expect`          | Creates a `[streamId, events]` tuple to match against events appended during the request.                            |
| `expectNewEvents` | An equivalent, more explicit name for `expect`.                                                                      |
| `expectResponse`  | Checks the exact status code and, when supplied, matches the specified body and header fields.                       |
| `expectError`     | Calls `expectResponse` with an error status and optional Problem Details fields.                                     |
| `TestRequest`     | A function receiving a SuperTest agent and returning its configured request. It is used for given and when requests. |

`ApiSpecification.then` accepts a response assertion, expected event streams, or a response assertion followed by expected event streams. `ApiE2ESpecification.then` accepts one response assertion in a one-element array.

For choosing between decision, API, and infrastructure-backed tests, see [Testing](/guides/testing).

## Compatibility

The package peer dependency is Express `^5.2.1`. Rejected promises from asynchronous handlers reach Express error middleware without `express-async-errors`. Express 5 route syntax requires named wildcards such as `/files/{*path}`. Applications migrating from Express 4 can consult the [Express 5 migration guide](https://expressjs.com/en/guide/migrating-5/).

## Type Sources

- [Application configuration](https://github.com/event-driven-io/emmett/blob/main/src/packages/emmett-expressjs/src/application.ts)
- [Handlers and response helpers](https://github.com/event-driven-io/emmett/blob/main/src/packages/emmett-expressjs/src/handler.ts)
- [ETag utilities](https://github.com/event-driven-io/emmett/blob/main/src/packages/emmett-expressjs/src/etag.ts)
- [Response types and sending](https://github.com/event-driven-io/emmett/blob/main/src/packages/emmett-expressjs/src/responses.ts)
- [Middleware](https://github.com/event-driven-io/emmett/tree/main/src/packages/emmett-expressjs/src/middlewares)
- [Testing utilities](https://github.com/event-driven-io/emmett/tree/main/src/packages/emmett-expressjs/src/testing)

## See Also

- [Getting Started: Application Setup](/getting-started#application-setup)
- [Command Handling](/guides/command-handling)
- [Read Models](/guides/projections)
- [Error Handling](/guides/error-handling)
- [Testing](/guides/testing)
- [How to use ETag header for optimistic concurrency](https://event-driven.io/pl/how_to_use_etag_header_for_optimistic_concurrency/)
