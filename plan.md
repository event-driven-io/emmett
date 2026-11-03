# Plan: `status`, `code`, `cause` and `details` on Emmett errors

## Goal

Emmett errors carry:

- `status: number`: the HTTP status. It replaces `errorCode`.
- `code?: string`: a stable identifier, for example `'ROOM_ALREADY_BOOKED'`.
- `cause?: unknown`: the native ES2022 `Error` cause.
- `details?: Record<string, unknown>`: non-sensitive data about the failure, for example `{ propertyId, eventId }`.

The shape follows Node and framework conventions:

| Consumer                      | Reads status from                       | Reads identifier from              |
| ----------------------------- | --------------------------------------- | ---------------------------------- |
| Fastify default error handler | `error.status`, then `error.statusCode` | `error.code`, sent in the response |
| Express `finalhandler`        | `err.status`, then `err.statusCode`     | none                               |
| Hono `HTTPException`          | `status`                                | none                               |
| RFC 9457 problem details      | `status`                                | `type` or an extension member      |
| Node core                     | none                                    | `error.code`, `error.cause`        |

Request source: thiagomini on Discord, 2026-10-30.

## Decided behavior

1. `EmmettError` accepts `{ status, message?, code?, cause?, details? }`.
2. `cause` goes to `super(message, { cause })`.
3. `errorCode` stays as a deprecated plain property. The constructor assigns it the same value as `status`. The constructor still accepts `{ errorCode, message? }`, a number, and a string.
4. `ValidationError`, `IllegalStateError`, `NotFoundError` and `ConcurrencyError` also accept `code`, `cause` and `details`. Their current arguments keep working.
5. Every `EmmettError` carries the runtime type id `emmettTypeId('EmmettError')`, which is `Symbol.for('@event-driven-io/emmett/EmmettError')`. It is a non-enumerable property, so a copied error does not carry it. The same symbol works across duplicate copies of Emmett.
6. `EmmettError.mapFrom` returns a value with the type id unchanged. It maps every other value to a new `EmmettError` that keeps `message`, `code`, `cause`, `details` and `stack`. The status comes from `status`, then `errorCode`, then 500.
7. `EmmettError.isInstanceOf` matches a numeric `status` or a numeric `errorCode`.
8. The Express and Hono default problem details mappers read `status` first, then `errorCode`. They do not put `code`, `details` or `cause` in the response. Users add them through `mapError`.
9. An `EmmettError` thrown in a Fastify route returns its `status`, and Fastify's default body contains its `code`. Emmett adds no Fastify mapper.
10. Docs state that `details` holds non-sensitive identifiers only, and that Emmett's own errors never put connection data in `message`, `details` or `cause`.

## Not in this plan

- Default `code` values on built-in Emmett errors.
- Using `code` for the Almanac `error.type` span attribute.
- Redaction support in Almanac loggers and tracers.
- Removing `errorCode` (next breaking release).

## Steps

One sequential pass. Every behavior change starts with a failing test.

1. Core errors in `src/packages/emmett/src/errors/index.ts`, with a new `errors.unit.spec.ts` next to it. It covers the new options, native `cause`, the deprecated `errorCode`, the current constructor forms, the subclasses, `mapFrom`, `isInstanceOf`, and `expectTypeOf` type tests. This step comes first because the bindings read `status`.
2. Express (`src/packages/emmett-expressjs`): `problemDetailsMiddleware.ts` reads `status`, then `errorCode`. `etag.ts` uses `status`. `mapError.int.spec.ts` gets cases for `status`, for a legacy `errorCode`, for `code` and `details` not appearing in the default response, and a `mapError` snippet region that adds `code` and `details`.
3. Hono (`src/packages/emmett-honojs`): the same changes as Express, with a new `mapError.int.spec.ts` that has the same cases.
4. Fastify (`src/packages/emmett-fastify`): an integration test where a route throws an `EmmettError` with `status` and `code`. The response has that status and the `code` in its body. No production code change is expected. If one is needed, stop and ask Oskar.
5. Docs: `src/docs/guides/error-handling.md` and the Express, Hono and Fastify framework pages. Replace `errorCode` with `status`, and mark `errorCode` as deprecated. Add a section on `code`, `cause` and `details` with snippets from the tests, and the rule about non-sensitive `details`.

## Verification

- `npm run build:ts` and the relevant test files while working.
- At the end: `npm run agent:check`, `npm run docs:build`, `npm run test:unit` and `npm test`.
- Report the commands and their results to Oskar.
