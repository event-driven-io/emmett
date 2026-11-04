# Plan: `status`, `code`, `cause` and `details` on Emmett errors

## Goal

Emmett errors carry:

- `status: number`: the HTTP status. It replaces `errorCode`.
- `code: string`: a stable identifier, for example `'ROOM_ALREADY_BOOKED'`. It is optional in the constructor options and always set on the error.
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
8. One default problem details mapping, `defaultErrorToProblemDetailsMapping`, lives in core and is used by Express, Hono and Fastify. It reads the status from `status`, then `statusCode`, then the deprecated `errorCode`, in the range 100-599, else 500. `detail` comes from the `Error` message or from a string. It never puts `code`, `details` or `cause` in the response.
9. `mapError` stays a function. There is no `include` option. Users add `code`, `details` or `cause` through `mapError`, the same way .NET uses `CustomizeProblemDetails` and Spring uses `@ExceptionHandler`.
10. Docs state that `details` holds non-sensitive identifiers only, and that Emmett's own errors never put connection data in `message`, `details` or `cause`.
11. `ProblemDocument` moves into core `emmett`, with the same name and the same `new ProblemDocument(options, extensions)` call. It has no dependencies and uses no Node API. `type` defaults to `about:blank`. `title` uses the given value, else the standard phrase for the status (table for 100-599). Standard members win over extensions with the same name. It is a class, as an approved exception to the module pattern rule. Express, Hono and the Hono sample no longer depend on `http-problem-details`.
12. Fastify: an `EmmettError` thrown in a route returns its `status`, and Fastify's default body contains its `code`. `getApplication` registers an Emmett problem details error handler only when `mapError` is set. Without `mapError`, Fastify keeps its own error format. The handler is also exported, so users can pass it to `app.setErrorHandler`.
13. Docs show how to add `code`, `details` and `cause` in `mapError`, with a warning based on RFC 9457 Section 5: do not expose implementation details or sensitive data.

14. Built-in Emmett errors have a default `code`. A `code` passed by the caller always wins. Defaults: `ValidationError` `EMT_ERR_VALIDATION`, `IllegalStateError` `EMT_ERR_ILLEGAL_STATE`, `NotFoundError` `EMT_ERR_NOT_FOUND`, `ConcurrencyError` `EMT_ERR_CONCURRENCY`, `ExpectedVersionConflictError` `EMT_ERR_EXPECTED_VERSION_CONFLICT`, `ConcurrencyInMemoryDatabaseError` `EMT_ERR_IN_MEMORY_DATABASE_CONCURRENCY`.
15. A plain `EmmettError` without a `code`, including one from `mapFrom`, gets its default code from the status: 400 `EMT_ERR_VALIDATION`, 403 `EMT_ERR_ILLEGAL_STATE`, 404 `EMT_ERR_NOT_FOUND`, 412 `EMT_ERR_CONCURRENCY`, any other status `EMT_ERR_INTERNAL`.
16. All concurrency errors keep status 412, so `EmmettError.isInstanceOf(error, EmmettError.Codes.ConcurrencyError)` matches all of them. `ConcurrencyInMemoryDatabaseError` keeps `EmmettError` as its base class.
17. `ExpectedVersionConflictError` and `ConcurrencyInMemoryDatabaseError` also accept `code`, `cause` and `details`. Their current arguments keep working.
18. The `errorCode` parameter in the Express and Hono testing `apiSpecification.ts` is renamed to `status`.
19. Almanac follows the OTel semantic conventions. The span `error.type` is the constructor name (Oskar approved reverting the earlier use of `code` there). A non-empty string `code` goes to the separate span attribute `emmett.error.code`. The log attribute `exception.type` is the constructor name, not `error.name`.
20. Docs list the default codes and show the concurrency check from item 16.
21. Emmett maps Dumbo errors correctly. Tests in `emmett-tests` use real Dumbo errors, for example `UniqueConstraintError` and `ConcurrencyError`. They check that `EmmettError.mapFrom` keeps the status, `message`, `cause` and `stack`, that `EmmettError.isInstanceOf` matches the status, and that `defaultErrorToProblemDetailsMapping` returns the same status. They pass with the current Dumbo through `errorCode` and guard the switch to `status`. `emmett-tests` gets `@event-driven-io/dumbo` as an explicit dependency.
22. Emmett adds no default code for 409. A test in `emmett-tests` checks that `EmmettError.mapFrom` keeps the Dumbo `code`, for example `DMB_ERR_UNIQUE_CONSTRAINT`. It fails until Emmett bumps to the Dumbo release with `status` and `code`; Oskar accepts that.
23. The `code` property on `EmmettError` has the type `string`, not `string | undefined`, because the constructor always sets it (items 14-15). `code` stays optional in the constructor options.
24. Fastify without `mapError`: a built-in error, for example `NotFoundError`, returns its status and its default code in Fastify's body. A test shows whether Fastify's body contains `cause`. If it does, stop and ask Oskar before any code change.

## Not in this plan (decided by Oskar)

- Redaction support in Almanac loggers and tracers: later, separate work.
- Removing `errorCode`: next breaking release.
- Dumbo and Pongo error changes: see `plan.md` in the Pongo repository.

## Steps

Every behavior change starts with a failing test.

1. Core errors in `src/packages/emmett/src/errors/index.ts`, with a new `errors.unit.spec.ts` next to it. It covers the new options, native `cause`, the deprecated `errorCode`, the current constructor forms, the subclasses, `mapFrom`, `isInstanceOf`, and `expectTypeOf` type tests. This step comes first because the bindings read `status`.
2. Express (`src/packages/emmett-expressjs`): `problemDetailsMiddleware.ts` reads `status`, then `errorCode`. `etag.ts` uses `status`. `mapError.int.spec.ts` gets cases for `status`, for a legacy `errorCode`, for `code` and `details` not appearing in the default response, and a `mapError` snippet region that adds `code` and `details`.
3. Hono (`src/packages/emmett-honojs`): the same changes as Express, with a new `mapError.int.spec.ts` that has the same cases.
4. Fastify (`src/packages/emmett-fastify`): an integration test where a route throws an `EmmettError` with `status` and `code`. The response has that status and the `code` in its body. No production code change is expected. If one is needed, stop and ask Oskar.
5. Core problem details (`src/packages/emmett/src/http/`): `ProblemDocument` and `defaultErrorToProblemDetailsMapping`, test-first in a `.unit.spec.ts` next to them. This step comes before 6-8 because they use it.
6. Express: switch to the core `ProblemDocument` and default mapping, and remove `http-problem-details`.
7. Hono: the same as Express, including the Hono sample `package.json`.
8. Fastify: test-first, add the exported error handler and register it in `getApplication` when `mapError` is set. Cover a thrown `EmmettError`, a Fastify validation error (400 from `statusCode`), and the case without `mapError`.
9. Docs: `src/docs/guides/error-handling.md` and the Express, Hono and Fastify framework pages. Replace `errorCode` with `status`, and mark `errorCode` as deprecated. Add a section on `code`, `cause` and `details` with snippets from the tests, the `mapError` customization with the warning, and the rule about non-sensitive `details`. Replace `http-problem-details` imports in docs and READMEs with the core import.

10. Core default codes and options (items 14-17), test-first in `errors.unit.spec.ts` and the `expectedVersion` tests.
11. In parallel after step 10: the testing helpers rename (item 18), Almanac `error.type` (item 19), and docs (item 20).

Steps 6, 7 and 8 are independent and can run in parallel through subagents, if Oskar approves. Steps 5 and 9 are sequential. Step 10 comes before step 11.

## Verification

- `npm run build:ts` and the relevant test files while working.
- At the end: `npm run agent:check`, `npm run docs:build`, `npm run test:unit` and `npm test`.
- Report the commands and their results to Oskar.
