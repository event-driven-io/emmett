# Todo: `status`, `code`, `cause` and `details` on Emmett errors

See `plan.md` for the decided behavior.

## Core errors

- [x] Test and implement `EmmettError` with `{ status, message?, code?, cause?, details? }`
- [x] Test and implement native `cause` through `super(message, { cause })`
- [x] Test and implement the deprecated `errorCode` property that the constructor assigns from `status`
- [x] Test that `{ errorCode }`, a number, and a string still construct the same errors
- [x] Type tests with `expectTypeOf` for the options shape
- [x] Test and implement `code`, `cause` and `details` on `ValidationError`, `IllegalStateError`, `NotFoundError` and `ConcurrencyError`
- [x] Test that the current subclass arguments keep working
- [x] Test and implement `emmettTypeId` and `hasTypeId`, and the type id on every `EmmettError`
- [x] Test and implement `mapFrom` that returns errors with the type id unchanged and maps the rest with `status`, `errorCode`, `code`, `cause`, `details` and `stack`
- [x] Test and implement `isInstanceOf` with `status` or `errorCode`

## Express

- [x] Test and implement: default mapper reads `status`, then `errorCode`
- [x] Test: default response has no `code`, `details` or `cause`
- [x] Test and snippet region: `mapError` adds `code` and `details`
- [x] Switch `etag.ts` to `status`

## Hono

- [x] Add `mapError.int.spec.ts` with the same cases as Express
- [x] Test and implement: default mapper reads `status`, then `errorCode`
- [x] Switch `etag.ts` to `status`

## Fastify

- [x] Integration test: a thrown `EmmettError` returns its `status` and its `code` in the body
- [x] If production code must change, stop and ask Oskar (no change needed)

## Core problem details

- [x] Test and implement `ProblemDocument` in core: `type` defaults to `about:blank`, `title` from the status table (100-599), standard members win over extensions
- [x] Test and implement core `defaultErrorToProblemDetailsMapping`: status from `status`, then `statusCode`, then `errorCode`, else 500; `detail` from message; no `code`, `details` or `cause`
- [x] Export both from `@event-driven-io/emmett`

## Switch bindings to core (parallel, if approved)

- [x] Express: use core `ProblemDocument` and default mapping, remove `http-problem-details`
- [x] Hono: the same, plus the Hono sample `package.json`
- [x] Fastify: test and implement the exported problem details error handler
- [x] Fastify: test a Fastify validation error returns 400
- [x] Fastify: test and implement registration in `getApplication` only when `mapError` is set; the current test without `mapError` stays

## Docs

- [x] `error-handling.md`: replace `errorCode` with `status`, mark `errorCode` as deprecated
- [x] Add a section on `code`, `cause` and `details` with snippets from tests
- [x] Add the rule that `details` holds non-sensitive identifiers only
- [x] Add the `mapError` customization for `code`, `details` and `cause`, with the RFC 9457 Section 5 warning
- [x] Update the Express, Hono and Fastify framework pages, including Fastify `mapError`
- [x] Replace `http-problem-details` imports in docs and READMEs
- [x] Point `honojs.md` to the Hono `mapError.int.spec.ts` region and remove the duplicate region in `emmett-honojs/src/application.int.spec.ts`

## Default codes

- [x] Test and implement default codes on the built-in errors; a passed `code` wins
- [x] Test and implement the status-based default code on a plain `EmmettError` and on `mapFrom`
- [x] Test and implement `code`, `cause` and `details` on `ExpectedVersionConflictError` and `ConcurrencyInMemoryDatabaseError`
- [x] Test that `EmmettError.isInstanceOf(error, 412)` matches all three concurrency errors
- [x] Rename the `errorCode` parameter to `status` in the Express and Hono testing `apiSpecification.ts`
- [x] Test and implement Almanac `error.type` from `code`, else the constructor name
- [x] Docs: default codes table and the concurrency check

## Almanac OTel conventions

- [x] Test and implement span `error.type` from the constructor name and `emmett.error.code` from `code`
- [x] Test and implement log `exception.type` from the constructor name in `otelLogger.ts` and `otelLogFormatter.ts`
- [ ] Re-run verification

## Verification

- [x] `npm run agent:check`
- [x] `npm run docs:build`
- [x] `npm run test:unit`
- [x] `npm test`
- [ ] Report results to Oskar
