# Todo: PR #383 review comments

Specification: [summary.md](summary.md). Plan and prompts: [plan.md](plan.md).

Mark a step `[x]` only after `npm run build:ts`, `npm run lint`, and the tests of every package it
touched are all clean.

## PR #383, phase 1

- [x] **S1** Raise the hono peer range to `^4.13.1`. Two regression tests: a POST with a matching
      `If-None-Match` keeps its status and `Location`, and a failed request keeps its Problem
      Details response.

## PR two, phase 2: the ETag design

`S3` and `S4` run at the same time. Everything else runs in order.

- [x] **S2** The core HTTP modules: `headers.ts`, a generic `etag.ts` holding `ETags`, and
      `streamETag.ts` holding `StreamETags`. `PreconditionRequiredError` (428), the corrected
      `if-none-match`, the `etagc` validation, and the weak helpers kept and deprecated.
- [x] **S3** The express adapter over the core modules. Runs beside S4.
- [x] **S4** The hono adapter over the core modules. Runs beside S3.
- [x] **S5** `sendProblem` clears a tag it did not set and sets the current version on a concurrency
      conflict, reading the stream name off the error. `ConcurrencyError` gained `streamName`, passed
      at all 14 throw sites. `enableDefaultExpressEtag` and the `set('etag', ...)` call are removed.
- [ ] **S6** The in-package examples and their tests move to the new API. Both documentation pages,
      both README files, and the behaviour-change list.

## PR three, phase 3

All three run at the same time.

- [ ] **S7** Problem Details in both packages. The status order `status`, `statusCode`,
      `errorCode`, 500. `instance`. The headers of an `HTTPException` kept, so `bearerAuth` gives 401
      with `WWW-Authenticate`. `mapError` becomes `(error: unknown, context: Context)`. `onError`
      already calls `sendProblem`, done in S5.
- [ ] **S8** `E extends Env` on every hono type and function, default `Env`. A type test.
- [ ] **S9** The three sub-router `onError` rules. A section in `honojs.md` and an integration test
      that holds them.

## Ruled by Oskar, not open

- [x] Add `streamName` to the concurrency error rather than guessing it from `If-Match`.
- [x] Split the core HTTP layer so `ETags` and `HeaderNames` work without an event store.
- [x] Cut the comments to what explains a decision, and use the module pattern.

Twelve smaller decisions are still unruled. See the "Open items" table in summary.md.

## Issues to open, not in this work

- [ ] `_version` of a Pongo single-stream projection counts document writes, not stream events.
      Section 1.6 of the specification.
- [ ] `registerWebApi` discards the route schema, so hono RPC cannot see the emmett routes. End of
      section 4.
- [ ] `npm run test:unit -w <package>` fails repo-wide. The root `vitest.config.ts` lists `projects`
      as relative paths, and `-w` sets the cwd to the package, so vitest resolves them against the
      package. Predates this work.
