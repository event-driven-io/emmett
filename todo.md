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

## Docs

- [ ] `error-handling.md`: replace `errorCode` with `status`, mark `errorCode` as deprecated
- [ ] Add a section on `code`, `cause` and `details` with snippets from tests
- [ ] Add the rule that `details` holds non-sensitive identifiers only
- [ ] Update the Express, Hono and Fastify framework pages

## Verification

- [ ] `npm run agent:check`
- [ ] `npm run docs:build`
- [ ] `npm run test:unit`
- [ ] `npm test`
- [ ] Report results to Oskar
