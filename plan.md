# Implementation plan: PR #383 review comments

The specification is [summary.md](summary.md). This document turns it into ordered steps and into a
prompt for each step.

## Repository facts this plan relies on

| Fact                                                                                        | Where                                            |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| The workspace root is `src/`. All commands run there.                                       | `src/package.json`                               |
| Build with `npm run build:ts`. Never `npm run build`.                                       | project rule                                     |
| Tests: `npm run test:unit`, `npm run test:int`, `npm run test:e2e`. Vitest picks by suffix. | `src/package.json`                               |
| Lint: `npm run lint`. Fix: `npm run fix`.                                                   | `src/package.json`                               |
| The two `etag.ts` files differ on 3 lines only.                                             | `packages/emmett-{honojs,expressjs}/src/etag.ts` |
| Core has no HTTP module yet.                                                                | `packages/emmett/src/index.ts`                   |
| `EmmettError.Codes` has 400, 403, 404, 412, 500. It has no 428.                             | `packages/emmett/src/errors/index.ts` line 22    |
| `hono` sits in `peerDependencies` as `^4.11.7`, which resolves to 4.13.0 here.              | `packages/emmett-honojs/package.json` line 56    |
| The `samples/` folder never uses an ETag. Only the in-package examples do.                  | grep                                             |
| The docs read code from the in-package examples through `<<< @./../packages/...#region`.    | `docs/frameworks/honojs.md`                      |
| The repository has no `CHANGELOG.md`.                                                       | repository root                                  |

Because there is no changelog file, the behaviour changes in section 1.5 of the specification go into
the PR description and into a short "Behaviour changes" block on both documentation pages.

## Decisions

Oskar decided these four. They are settled. Nothing in this plan is left open.

| Question                                              | Decision                                                                                                                |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `If-None-Match` with a list of entity tags on a write | 412. `*` still gives `STREAM_DOES_NOT_EXIST`. See S2.                                                                   |
| `enableDefaultExpressEtag`                            | Remove it and the `set('etag', ...)` call. Express keeps its own default. Breaking for anyone passing the flag. See S5. |
| The replaced ETag exports                             | Keep every one, marked `@deprecated` with its replacement named. Nothing breaks on upgrade. See S3 and S4.              |
| How the work splits into PRs                          | Three. PR #383 takes phase 1 only. Phase 2 is a new PR. Phase 3 is a third.                                             |

Two facts that decided the first one, so a reviewer does not have to rediscover them.

Nothing in emmett reads `If-None-Match` today. `getETagFromIfNotMatch` reads `if-not-match`, a header
no client sends, so it always throws, and nothing calls it. The three create endpoints hardcode
`STREAM_DOES_NOT_EXIST`. So no existing behaviour changes and no user code breaks.

Adding a "not this version" expectation to the event store is not viable. The EventStoreDB
`AppendExpectedRevision` is `ANY | NO_STREAM | STREAM_EXISTS | bigint`
(`packages/emmett-esdb/src/eventStore/eventstoreDBEventStore.ts` lines 411 to 418). It has no "not
equal", so that store would need a read before the write and would lose the atomic append. Eleven
files branch on the expectation kind, including the postgres and sqlite `appendToStream` SQL.

## Ground rules for every step

1. Write the failing test first. Run it. See it fail for the stated reason.
2. Write the smallest code that makes it pass.
3. Run `npm run build:ts`, then `npm run lint`, then the tests for the packages you touched.
4. All three must be clean before the next step starts. Never assume that a failure predates you.
5. Never commit, add, or stage. Oskar handles git.
6. Add only. Keep every current export alive as a deprecated alias. No step removes one, except
   `enableDefaultExpressEtag` in S5, which Oskar decided to drop.

## Target design

Core gains two framework-free modules: a generic HTTP layer, and the emmett convention on top of it.
Each web package keeps a thin adapter.

```
packages/emmett/src/http/
  index.ts          re-exports
  headers.ts        HeaderNames
  etag.ts           ETag, WeakETag, ETagErrors, ETags = { strong, weak, parse, parseList }
  streamETag.ts     StreamETags = { from, parse, ifMatch, ifNoneMatch }

packages/emmett-{honojs,expressjs}/src/etag.ts
  re-exports the core modules
  getETagFromIfMatch / getETagFromIfNoneMatch     read one header
  getExpectedStreamVersionFromIfMatch             read the header, call StreamETags.ifMatch
  getExpectedStreamVersionFromIfNoneMatch         read the header, call StreamETags.ifNoneMatch
  setETag                                          write one header
  getETagValueFromIfMatch                          deprecated, kept
```

`etag.ts` imports nothing from `eventStore`, throws no `ConcurrencyError`, and knows no stream name.
So `setETag`, `HeaderNames`, and `ETags` serve a plain REST route with no event store. Only
`streamETag.ts` holds the `"{streamName}:{version}"` convention and the `ExpectedStreamVersion`
mapping.

The adapter holds the framework types. The core modules hold every rule and every test of a rule.
That removes the duplication described in finding 9.

## Phases and sequence

```
Phase 1   S1                                        PR #383, docs plus this one fix

Phase 2   S2 -> [ S3 || S4 ] -> S5 -> S6            new PR, the ETag design

Phase 3   S7 || S8 || S9                            new PR, three independent tracks
```

Five boundaries, each forced by something real.

| Boundary                    | Why it cannot merge                                                    |
| --------------------------- | ---------------------------------------------------------------------- |
| Phase 1 stands alone        | PR #383 is a documentation PR. Only the reported defect belongs in it. |
| S2 before S3 and S4         | Both adapters import the core module.                                  |
| S3 and S4 run together      | The same change in two packages, with no shared file.                  |
| S6 comes last               | The documentation quotes the final code through `#region` markers.     |
| S7, S8, and S9 run together | Three independent concerns, in different files.                        |

Every step leaves the repository buildable, lint clean, and green. No step leaves a partial API. A
new core function is exported and used by a test in the step that adds it, so nothing is orphaned.

## The steps

| Step | What it does                                                                 | PR    | State |
| ---- | ---------------------------------------------------------------------------- | ----- | ----- |
| S1   | Raise the hono peer range to `^4.13.1`. Two regression tests.                | #383  | done  |
| S2   | The core HTTP modules, complete, with their unit tests.                      | two   | done  |
| S3   | The express adapter over the core modules. Runs beside S4.                   | two   | done  |
| S4   | The hono adapter over the core modules. Runs beside S3.                      | two   | done  |
| S5   | `sendProblem` owns the ETag. `enableDefaultExpressEtag` goes away.           | two   | done  |
| S6   | The examples, their tests, both documentation pages, both README files.      | two   | next  |
| S7   | Problem Details in both packages: status order, `instance`, `HTTPException`. | three |       |
| S8   | `E extends Env` on every hono type and function. A type test.                | three |       |
| S9   | The sub-router `onError` rules. Documentation and an integration test.       | three |       |

S1 to S5 landed. The prompts below record what was built, so the remaining steps and any reviewer
read the same design. Four decisions changed during the build, all of them recorded in "Drift from
this plan" at the end.

---

## Prompts

Each prompt is self contained. Give it the specification file and the prompt text.

### S1: raise the hono peer range

```text
Repository: /home/oskar/Repos/emmett. Workspace root: src/. Read summary.md sections 1.4 and
"Order of work" first.

Task. hono 4.13.0 converts a write into a 304. Its etag middleware tests the method and res.ok in
the `If-None-Match: *` branch only. hono fixed this in 4.13.1, commit f6aa913c3. The peer range in
packages/emmett-honojs/package.json is `^4.11.7`, which resolves to 4.13.0 here.

Steps, in this order.

1. Add two failing integration tests to packages/emmett-honojs/src/application.int.spec.ts. Use
   `getApplication` so the etag() middleware is installed. Follow the style of the tests already in
   that file.
   a. A POST route that returns 201 with an explicit ETag and a Location header. Send the request
      with `If-None-Match` set to that same ETag. Assert status 201, a non-empty body, and the
      Location header still present.
   b. A POST route that throws. Send it twice, the second time with `If-None-Match` set to the ETag
      of the first response. Assert that both responses carry the Problem Details status and the
      `application/problem+json` content type.
2. Run `npm run test:int -w packages/emmett-honojs` from src/. Both new tests must fail with 304.
   Record the output.
3. Change the `hono` peer range in packages/emmett-honojs/package.json to `^4.13.1`.
4. Run `npm install` from src/ to update the lock file.
5. Run `npm run build:ts`, `npm run lint`, and the package tests. All must be clean.

Constraints. Do not touch any other file. Do not remove `application.use(etag())`. Do not commit,
add, or stage. Report the failing output from step 2 and the passing output from step 5.
```

### S2: the core ETag module

```text
Repository: /home/oskar/Repos/emmett. Workspace root: src/. Read summary.md sections 1.2, 1.3, and
5, and findings 5 to 9.

Task. packages/emmett-honojs/src/etag.ts and packages/emmett-expressjs/src/etag.ts are the same file
except for three lines that touch the framework types. Move every framework-free part into core, add
the new strong tag format, and add the two header parsers. This step touches no web package.

Create these files, and export them from packages/emmett/src/index.ts.

    packages/emmett/src/http/index.ts
    packages/emmett/src/http/headers.ts       + headers.unit.spec.ts
    packages/emmett/src/http/etag.ts          + etag.unit.spec.ts
    packages/emmett/src/http/streamETag.ts    + streamETag.unit.spec.ts

`etag.ts` is generic RFC 9110. It imports nothing from `eventStore`, throws no `ConcurrencyError`,
and knows no stream name, so a plain REST route can use it. `streamETag.ts` holds the emmett
convention and sits on top of it.

Write each unit test file before its implementation. Core must never import hono or express.

--- Part 1: the 428 error, in packages/emmett/src/errors/index.ts

That file holds `EmmettError`, its `Codes` map, `ConcurrencyError` (412), and `ValidationError`
(400). It has no 428. Add `PreconditionRequiredError: 428` to `Codes`, and the class next to
`ValidationError`. Match the surrounding style, including the `Object.setPrototypeOf` line and its
comment. Its default message names the `If-Match` header, per RFC 6585 section 3. Change no existing
member of `Codes`.

--- Part 2: headers.ts and etag.ts

headers.ts holds `HeaderNames` and nothing else, with `IF_MATCH: 'if-match'`,
`IF_NONE_MATCH: 'if-none-match'`, `ETag: 'etag'`, and `IF_NOT_MATCH` kept as a deprecated alias whose
value is now the correct `'if-none-match'`.

etag.ts holds the generic entity tag, with no event sourcing in it:

- `ETag` and `WeakETag` branded types, moved as they are.
- `WeakETagRegex`, `isWeakETag`, `getWeakETagValue`, `toWeakETag`, moved as they are and marked
  `@deprecated` with a one-line JSDoc that names the replacement.
- `ETagErrors` gaining `MISSING_IF_NONE_MATCH_HEADER`, keeping `MISSING_IF_NOT_MATCH_HEADER`.
- `ETags.strong(value: string): ETag` and `ETags.weak(value: string): WeakETag`. Both validate the
  value against `etagc` and throw a `ValidationError`.
- `ETags.parse(headerValue: string): { value: string; weak: boolean } | undefined`. The opaque value
  inside the quotation marks, and whether the tag was weak. Undefined for anything that is not an
  entity tag. It never throws.
- `ETags.parseList(headerValue: string): '*' | ETag[]`. The wildcard as itself, or the members of a
  comma separated list.

Rules for `ETags.strong`, from RFC 9110 section 8.8.3.

    entity-tag = [ weak ] opaque-tag
    opaque-tag = DQUOTE *etagc DQUOTE
    etagc      = %x21 / %x23-7E / obs-text

A colon is %x3A, so it is legal. A space (%x20) and a double quote (%x22) are not. `mapToStreamId`
is user supplied, so a stream name can hold anything, and `ETags.strong` throws a `ValidationError`
when the value holds a character outside `etagc`. That fails during development instead of shipping a
malformed header. obs-text is %x80-FF, so the check ends at U+00FF: Node throws ERR_INVALID_CHAR
above that.

--- Part 3: streamETag.ts

`StreamETags.from(streamName, version)` returns `"{streamName}:{version}"` through `ETags.strong`,
strong, no `W/` prefix.

`StreamETags.parse(headerValue)` returns `{ streamName?: string; version: bigint } | undefined`. It
reads the opaque value through `ETags.parse`, then takes the segment after the LAST colon, so a
stream name that holds a colon still works. It accepts the strong form `"name:4"`, the bare strong
form `"4"`, and the weak form `W/"4"`. Undefined for anything else, and it never throws. A negative
version gives undefined.

Test rows for `StreamETags.parse`.

    '"cart-123:4"'      -> { streamName: 'cart-123', version: 4n }
    '"a:b:7"'           -> { streamName: 'a:b',      version: 7n }
    '"4"'               -> { version: 4n }
    'W/"4"'             -> { version: 4n }
    '"cart-123:abc"'    -> undefined
    '"2e1f6c58"'        -> undefined
    '*'                 -> undefined
    ''                  -> undefined
    'cart-123:4'        -> undefined   (no quotation marks, so not an entity tag)

`StreamETags.ifMatch`:

    ifMatch(
      headerValue: string | undefined,
      streamName: string,
      options?: { required?: boolean },
    ): ExpectedStreamVersion

Rows.

    absent                              -> NO_CONCURRENCY_CHECK
    absent, options.required            -> throws PreconditionRequiredError (428)
    '*'                                 -> STREAM_EXISTS
    '"cart-123:4"', stream cart-123     -> 4n
    '"cart-123:4"', stream cart-999     -> throws ConcurrencyError (412)
    '"4"'                               -> 4n            (the old bare form, accepted)
    'W/"4"'                             -> 4n            (the old weak form, accepted)
    '"3", "4"'                          -> 3n            (the first member that parses and matches)
    '"cart-999:3", "cart-123:4"'        -> 4n            (a member naming another stream is skipped)
    '"2e1f6c58"'                        -> throws ConcurrencyError (412)
    'garbage'                           -> throws ConcurrencyError (412)
    ''                                  -> throws ConcurrencyError (412)

Two comments the code needs, because neither reason is obvious.

Why 412 and not 400 for a malformed value. RFC 9110 section 13.1.1 step 3 makes any value that is
neither `*` nor a matching entity tag a false condition, and section 13.2.2 makes a false `If-Match`
a 412. The specific rule beats the general one.

Why the weak form is accepted. Section 13.1.1 needs strong comparison, so accepting `W/"4"` is a
deliberate deviation. An old client sends it, and a proxy can weaken our tag in flight. We never
emit one. S6 documents the deviation.

The function never returns a raw header value. That is the defect in section 1.4.

`StreamETags.ifNoneMatch`:

    ifNoneMatch(headerValue: string | undefined): ExpectedStreamVersion

Rows.

    absent          -> NO_CONCURRENCY_CHECK
    '*'             -> STREAM_DOES_NOT_EXIST
    '"cart-123:4"'  -> throws ConcurrencyError (412)
    '"3", "4"'      -> throws ConcurrencyError (412)
    'W/"4"'         -> throws ConcurrencyError (412)
    'garbage'       -> throws ConcurrencyError (412)

The third row onward needs a comment. A list of entity tags means "proceed only if the current
version is none of these". `ExpectedStreamVersion` holds one expected value, `STREAM_EXISTS`,
`STREAM_DOES_NOT_EXIST`, or `NO_CONCURRENCY_CHECK`, so it cannot express that. Section 13.2.2 makes
a precondition that the server cannot show true a 412, and S5 puts the current version on that 412,
so the client reads it and retries with `If-Match`. Refusing is also the safe direction: the client
asked us to guard a write, and refusing never loses an update, while ignoring the header could.

`*` needs no special handling beyond the mapping. The helper does not know whether the stream exists.
The event store evaluates `STREAM_DOES_NOT_EXIST` and raises the 412 itself.

One more comment, on precedence. RFC 9110 section 13.2.2 evaluates `If-Match` first. When both
headers arrive, `If-None-Match` is not evaluated at all, so an endpoint that calls the `If-Match`
helper must not also call this one.

--- Finish

Both parsers end on the common path, so a guard throws early and the last statement is the return.

Run `npm run build:ts`, `npm run lint`, and `npx vitest run --root . packages/emmett/src/http`. All
clean. `npm run test:unit -w <pkg>` is broken repo-wide: the root vitest.config.ts lists `projects`
as relative paths and `-w` changes the cwd. Do not change that config.

Constraints. Do not change either web package in this step. Add no comment that only restates the
code. Do not commit, add, or stage.
```

### S3: the express adapter

```text
Repository: /home/oskar/Repos/emmett. Workspace root: src/. Read summary.md sections 1.3, 1.4, and
5. Step S2 is done, so packages/emmett/src/http/etag exists and is exported from
`@event-driven-io/emmett`.

Task. Reduce packages/emmett-expressjs/src/etag.ts to an adapter. It keeps only the parts that touch
`Request` and `Response`. It re-exports the rest from core, so no current import breaks.

Write the tests first, in packages/emmett-expressjs/src/etag.unit.spec.ts. Build a fake request with
a `headers` object. Cover the same rows as the core ifMatch and ifNoneMatch tests, through the
adapter.

The file after the change.

- Re-export the named ETag members from core explicitly, not with a bare `export *`, so the public
  surface of the package stays readable.
- `getETagFromIfMatch(request): ETag`. Unchanged behaviour: it throws when the header is absent.
  Mark it `@deprecated` and name `getExpectedStreamVersionFromIfMatch` as the replacement.
- `getETagFromIfNoneMatch(request): ETag`. New. Reads `HeaderNames.IF_NONE_MATCH`. Throws
  `ETagErrors.MISSING_IF_NONE_MATCH_HEADER` when absent.
- `getETagFromIfNotMatch(request)`. Keep it as a deprecated alias of the new function. Its header
  name is now correct, so it stops always throwing. That is the fix for section 5.
- `getExpectedStreamVersionFromIfMatch(request, streamName, options?)`. New. Reads the header and
  calls `StreamETags.ifMatch`.
- `getExpectedStreamVersionFromIfNoneMatch(request)`. New. Reads the header and calls
  `StreamETags.ifNoneMatch`.
- `setETag(response, etag)`. Unchanged.
- `getETagValueFromIfMatch(request)`. Keep it, unchanged, marked `@deprecated`. Section 1.4 shows
  that it returns a raw header, and that a correct strong tag then reaches `BigInt` and gives a 500.
  Do not fix it. Point its JSDoc at `getExpectedStreamVersionFromIfMatch`.

Add an integration test that proves the 500 is gone: a route that uses
`getExpectedStreamVersionFromIfMatch` and receives `If-Match: "4"` answers with the command result,
not with 500.

Then run `npm run build:ts`, `npm run lint`, and all three test levels for the package.

Constraints. Every export that the package has today must still exist. Do not touch
packages/emmett-honojs in this step. Do not commit, add, or stage.
```

### S4: the hono adapter

```text
Repository: /home/oskar/Repos/emmett. Workspace root: src/. Read summary.md sections 1.3, 1.4, and
5. Step S2 is done.

Task. The same change as S3, in packages/emmett-honojs/src/etag.ts. The adapter takes a hono
`Context` instead of an express `Request`, and reads a header with `context.req.header(name)`.
Express normalises `string | string[] | undefined` and joins a repeated header with `', '`, which is
the list form the parser wants. Hono needs no such helper.
`setETag` calls `context.header(HeaderNames.ETag, etag)`.

Follow the S3 prompt for the export list, the deprecations, and the tests. Write
packages/emmett-honojs/src/etag.unit.spec.ts first. Use `new Hono()` and `app.request(...)` for the
integration test, following the style of the tests already in the package.

Then run `npm run build:ts`, `npm run lint`, and all three test levels for the package.

Constraints. Every export that the package has today must still exist. Do not touch
packages/emmett-expressjs in this step. Do not commit, add, or stage.
```

### S5: the ETag on a problem response, and the express setting

```text
Repository: /home/oskar/Repos/emmett. Workspace root: src/. Read summary.md section 1.1, the block
"What the switches actually change", section 1.3, the note that begins "What `sendProblem` must
clear is a generated tag", and items 7 and 8 of section 1.5. Steps S2, S3, and S4 are done.

Two changes. They are unrelated, but they land in the same two packages, so one build and test cycle
covers both.

--- Part 1: sendProblem owns the ETag, both packages

A problem response must not carry a body hash in its ETag, and a 412 from a concurrency conflict
should carry the current stream version. Two measured facts drive this.

    express, generation on   POST -> 412  ETag: W/"3f-un0ADY0XevDHIpOVtkUwVsSMc28"   a body hash
    hono 4.13.4, etag()      POST -> 412  ETag: absent                                nothing at all

One rule covers both: clear a tag that the caller did not set, then set the current version when the
error is a `ConcurrencyError`.

1. Write failing integration tests in both packages. A route throws an
   `ExpectedVersionConflictError` with a known current version. Assert status 412, content type
   `application/problem+json`, and `ETag` equal to `StreamETags.from(streamName, current)`. A second test
   throws a non-concurrency error and asserts that the response carries no `ETag` at all.
2. Change `sendProblem` in packages/emmett-expressjs/src/responses.ts and
   packages/emmett-honojs/src/responses.ts. Keep an explicit `options.eTag`. Otherwise remove the
   header. When the error is a `ConcurrencyError` and the caller passed the stream name, set the
   current version.
3. Wire the concurrency case through the error path that produces the problem document, so a route
   that just throws gets the header. Use `isExpectedVersionConflictError` from core, and read
   `error.current`.

RFC note, worth one comment. Section 8.8.3 says the `ETag` field gives the current entity tag for
the selected representation, as determined at the conclusion of handling the request. That is the
representation of the target resource, not the body of this response. It is the same wording that
makes an `ETag` on a 304 correct. A 412 is not heuristically cacheable, so no cache stores it.

Do not change the shape of `HttpProblemResponseOptions` in a way that breaks a current caller.

Express writes the hash into the `ETag` inside `res.send` and flushes headers with the body in the
same synchronous call, so a generated tag cannot be removed afterwards. `sendProblem` therefore
serializes the document, sets `Content-Length`, and calls `response.end`. The wire `Content-Type`
becomes `application/problem+json` with no `; charset=utf-8`, which matches the hono package. That
goes in the behaviour-change list.

The hono `onError` handler repeats the body of `sendProblem`, so wiring the error through it means
calling `sendProblem` instead. That was S7 Part 3; do it here.

--- Part 2: remove enableDefaultExpressEtag

packages/emmett-expressjs/src/application.ts line 50 says:

    // disabling default etag behaviour
    // to use etags in if-match and if-not-match headers
    application.set('etag', enableDefaultExpressEtag ?? false);

The comment is wrong. The setting controls hash generation only. Express never reads `If-Match`, and
`if (req.fresh) this.status(304)` in express/lib/response.js runs in all conditions, so an explicit
version tag still produces a 304 with the setting off. Measured:

    app.set('etag', false)
    GET /cart      If-None-Match: W/"4"   304  ETag: W/"4"      unchanged
    GET /products                         200  ETag: absent     the only difference

So the option protects nothing and removes caching from every endpoint that carries no version.
Oskar decided to remove it. Express then keeps its own default. An application that wants generation
off calls `app.set('etag', false)` itself, which is the express way to say it. This is a breaking
change for anyone who passes the flag.

1. Write failing integration tests in packages/emmett-expressjs/src/application.int.spec.ts. Use
   `node:http` for the requests, not `fetch`. Node `fetch` sends `cache-control: no-cache`, and the
   `fresh` module then reports stale in all conditions, which hides the real behaviour.
   a. A GET that sets no ETag returns a generated one, and a second request with `If-None-Match` set
      to it returns 304.
   b. A GET that sets an explicit version ETag returns that value, not a hash.
   c. `configureApplication` on an application that already called `app.set('etag', false)` leaves
      that setting alone, so route (a) returns no ETag.
2. Remove `enableDefaultExpressEtag` from `ApplicationOptions`, from the destructuring in
   `configureApplication`, and remove the `application.set('etag', ...)` line and its comment.
3. packages/emmett-expressjs/src/application.int.spec.ts line 342 passes
   `enableDefaultExpressEtag: true`. Remove that option from the test and keep what the test asserts.

--- Finish

Run `npm run build:ts`, `npm run lint`, and all three test levels for both packages. Fix any test
that assumed no generated ETag.

Constraints. Do not commit, add, or stage.
```

### S6: the examples and the documentation

```text
Repository: /home/oskar/Repos/emmett. Workspace root: src/. Read summary.md sections 1.2, 1.3, 1.5,
and item 7 of "Order of work". Steps S1 to S5 are done, so the code is final.

Two changes, in this order. The documentation quotes the examples through `#region` markers, so the
examples must move first.

--- Part 1: the in-package examples and their tests

The examples still emit `toWeakETag(...)` and still call
`assertUnsignedBigInt(getETagValueFromIfMatch(context))`. The documentation reads these files, so
they are the public example of the API. The `samples/` folder does not use ETags, so it needs no
change.

Files.

    packages/emmett-honojs/src/e2e/decider/api.ts
    packages/emmett-expressjs/src/e2e/decider/api.ts
    packages/emmett-expressjs/src/e2e/commandHandler/api.ts
    packages/emmett-honojs/src/e2e/testing.ts
    packages/emmett-expressjs/src/e2e/testing.ts
    every *.int.spec.ts that asserts on an ETag

Changes.

- Replace `toWeakETag(result.nextExpectedStreamVersion)` with
  `StreamETags.from(shoppingCartId, result.nextExpectedStreamVersion)`.
- Replace `expectedStreamVersion: assertUnsignedBigInt(getETagValueFromIfMatch(context))` with
  `expectedStreamVersion: getExpectedStreamVersionFromIfMatch(context, shoppingCartId)`. The new
  function returns an `ExpectedStreamVersion` already, so the assert goes away.
- In the `Created` route, read the header instead of hard coding `STREAM_DOES_NOT_EXIST`. Use
  `getExpectedStreamVersionFromIfNoneMatch`, and keep `STREAM_DOES_NOT_EXIST` as the value the route
  passes when the header is absent, so the current behaviour of the sample holds.
- `expectNextRevisionInResponseEtag` in both e2e/testing.ts matches `/W\/"\d+.*"/` and calls
  `getWeakETagValue`. Change it to `StreamETags.parse` and assert on the strong format.
- Keep the `#region` markers exactly where they are. The documentation points at them by name.

Every test must pass. An absent `If-Match` no longer gives 412, so a test that asserted that must
change to the new behaviour, and the change must be deliberate, not a weakened assertion.

--- Part 2: the documentation

Keep the house style: user centric, no hard-wrapped prose, code always pulled from a test or an
example through `<<< @./../packages/...#region`, and the same phrasing on both pages.

    docs/frameworks/honojs.md
    docs/frameworks/expressjs.md
    packages/emmett-honojs/README.md
    packages/emmett-expressjs/README.md

In the "Carry Stream Versions over HTTP" section of both pages.

- The four-step list gains the absent case, the `*` case, and the new tag format
  `"{streamName}:{version}"`.
- The sentence that says `getETagValueFromIfMatch` reports a missing `If-Match` as 412 is now wrong.
  An absent header means no check. An endpoint that needs the header passes `{ required: true }` and
  gets 428.
- The sentence that says the function "returns any other ETag value unchanged" documents the defect.
  Remove it.
- The function table gains `ETags`, `StreamETags`, `getExpectedStreamVersionFromIfMatch`,
  `getExpectedStreamVersionFromIfNoneMatch`, and `getETagFromIfNoneMatch`. The rows for `toWeakETag`,
  `WeakETagRegex`, `isWeakETag`, `getWeakETagValue`, `getETagFromIfNotMatch`, and
  `getETagValueFromIfMatch` become deprecated rows that name their replacement.
- The `HeaderNames` row says `if-match`, `if-none-match`, and `etag`.
- Say that `ETags` and `HeaderNames` carry no event sourcing, so a plain REST route can use them, and
  that `StreamETags` and `getExpectedStreamVersionFromIfMatch` are the event sourcing entry points.
- Say what `If-None-Match` does on a write: `*` is the create idiom, and a list of entity tags gives
  412 because the expected-version model holds one value and cannot express "none of these".
- The sentence about generated ETags taking second place to an explicit one stays. It is correct.
- Add one short paragraph recording the deliberate deviation: RFC 9110 section 13.1.1 needs strong
  comparison for `If-Match`, and we still accept `W/"4"` on input, because an old client sends it and
  a proxy can weaken a tag in flight. We never emit a weak tag.

On the express page and the express README only, remove `enableDefaultExpressEtag`. Six places name
it, and all six say that emmett turns express ETags off to keep stream versions explicit. That claim
is wrong, so rewrite the surrounding prose rather than only deleting the option name:

    docs/frameworks/expressjs.md lines 56, 74, 108, 234
    packages/emmett-expressjs/README.md lines 148, 154, 423

Say instead that emmett leaves the express `etag` setting alone. Express generates a body ETag for a
response that sets none, and a response helper that sets a stream-version ETag takes precedence. An
application that wants generation off calls `app.set('etag', false)` itself. `If-Match` handling is
emmett's own code and no express setting affects it.

Add a short "Behaviour changes" block to both pages, because the repository has no CHANGELOG file:

- The emitted tag is `"shopping_cart-123:4"` instead of `W/"4"`.
- An absent `If-Match` gave 412 and now gives a normal response.
- A malformed or foreign `If-Match` gave 500 and now gives 412.
- `If-Not-Match` was never a real header, so `getETagFromIfNotMatch` always threw. It now reads
  `If-None-Match`.
- `enableDefaultExpressEtag` is gone. Express keeps its own default, so an unversioned GET answers
  304 on revalidation.
- An express problem response sends `Content-Type: application/problem+json` with no
  `; charset=utf-8`.
- A repeated `If-Match` header on express is joined with `', '` instead of taking the first value.

Put the same list in the PR description.

--- Finish

Run `npm run build:ts`, `npm run lint`, all three test levels for both packages, and
`npm run docs:build`. All clean.

Constraints. Do not paste code into the pages. Pull it from a region. Do not commit, add, or stage.
```

### S7: Problem Details in both packages

```text
Repository: /home/oskar/Repos/emmett. Workspace root: src/. Read summary.md section 2 in full. This
step needs nothing from phase 2.

Four changes, in this order. They are one concern across two packages.

--- Part 1: the status order and instance, hono

packages/emmett-honojs/src/middlewares/problemDetailsMiddleware.ts reads `errorCode` only, and takes
`Error`. A hono `HTTPException` holds `status`, so `throw new HTTPException(403, {...})` gives 500
today. `bearerAuth`, `basicAuth`, and `jwt` all throw one, so an application that uses them gets 500
where it must get 401.

Write failing unit tests first, one per row.

    new HTTPException(403, { message: 'Forbidden' })  -> status 403, detail 'Forbidden'
    { status: 404, message: 'nope' }                  -> 404
    { statusCode: 409, message: 'clash' }             -> 409   (the http-errors convention)
    new ValidationError('bad')                        -> 400   (errorCode, the emmett convention)
    new Error('boom')                                 -> 500
    'a plain string'                                  -> 500, detail is the string
    an instance path is passed                        -> the document holds `instance`

Change `defaultErrorToProblemDetailsMapping` to take `unknown`, and to read the status in this
order: `status`, `statusCode`, `errorCode`, then 500. Accept an optional instance argument and put
it on the `ProblemDocument`. `ProblemDocument` already sets `type` to `about:blank` and `title` from
the status name when you give it `status`, so the body needs no other work.

--- Part 2: keep the response headers of an HTTPException, hono

The hono auth middlewares throw an `HTTPException` that carries a `Response`. That response exists
only to hold `WWW-Authenticate`:

    const res = new Response(null, { status, headers: {
      'WWW-Authenticate': `${wwwAuthenticatePrefix}${...}`
    }});
    throw new HTTPException(status, { res });

RFC 9110 section 11.6.1 says a 401 must hold `WWW-Authenticate`. We replace the body with a Problem
Details document, so we must keep that header or we break every hono auth middleware.

Write a failing integration test first: build an application with `getApplication` and `bearerAuth`,
send a request with no token, and assert status 401, a `WWW-Authenticate` header, content type
`application/problem+json`, and a body whose `status` is 401.

Then change the `onError` handler in packages/emmett-honojs/src/application.ts:

  a. Build the Problem Details document from the error, as in part 1. Take `instance` from
     `c.req.path`.
  b. Test with `'getResponse' in error`, not `instanceof HTTPException`. Hono tests the property on
     purpose, so a copy of the class from another realm still works.
  c. Copy the headers of `error.res` onto the response.
  d. Delete `Content-Type` and `Content-Length` from the copy. We own those two.
  e. Discard the body of `error.res`.
  f. Return through `c.newResponse(body, { status, headers })`, not `new Response`, so hono merges
     the headers set with `c.header(...)`. The default hono handler does the same.

--- Part 3: one smaller item in the same hono file

S5 already made `configureApplication` call `sendProblem` instead of repeating its body, so that half
of this part is done. What remains is the `mapError` type.

The `mapError` type is `(error: Error) => ProblemDocument | undefined`. The express package passes
the request as a second argument. The hono type gives the mapper no context, so it cannot read the
path, the method, or `c.var`. It also narrows the error to `Error`, and user code can throw anything.
Change it to `(error: unknown, context: Context) => ProblemDocument | undefined`.

Write a failing integration test first: a custom `mapError` reads `context.req.path` and puts it in
the document, and a thrown string reaches the mapper.

--- Part 4: the same status order in express

packages/emmett-expressjs/src/middlewares/problemDetailsMiddleware.ts reads `errorCode` only. Give
it the same status order and the same `instance`, taken from `request.path`. Write unit tests that
mirror part 1, minus the `HTTPException` row, plus a row for an `http-errors` style error:
`{ status: 403 }` and `{ statusCode: 403 }` both give 403. Keep
`defaultErrorToProblemDetailsMapping` exported with its current name and its current single-argument
call shape working.

--- Finish

Run `npm run build:ts`, `npm run lint`, and all three test levels for both packages.

Constraints. Do not commit, add, or stage.
```

### S8: `E extends Env`

```text
Repository: /home/oskar/Repos/emmett. Workspace root: src/. Read summary.md section 4. This step
needs nothing from phase 2 and nothing from S7 or S9.

Task. Every `Hono` type in packages/emmett-honojs/src/application.ts has no generic parameter, so the
`Env` of the application is lost. `Env` holds `Bindings` and `Variables`. A user who writes
`new Hono<{ Variables: { user: User } }>()` gets `unknown` for `c.var.user` inside a setup function,
and has no place to add the parameter.

The runtime is already correct. One instance handles the request, and it inherits the env. This is a
types-only change.

Steps.

1. Write a failing type test. Follow whatever type-test convention the repository already uses; if
   there is none, write a `.unit.spec.ts` that uses `expectTypeOf` from vitest. Assert that inside a
   `WebApiSetup<{ Variables: { user: { id: string } } }>`, `c.var.user` has that type, and that
   `getApplication` returns `Hono<E>`.
2. Add the parameter, with `Env` as the default so no current code breaks:

       export type WebApiSetup<E extends Env = Env> = (router: Hono<E>) => void;
       export type ApplicationOptions<E extends Env = Env> = { apis: WebApiSetup<E>[]; ... };
       export const registerWebApi = <E extends Env>(application: Hono<E>, apis: WebApiSetup<E>[]): Hono<E> => ...;
       export const configureApplication = <E extends Env>(application: Hono<E>, options: ApplicationOptions<E>): Hono<E> => ...;
       export const getApplication = <E extends Env = Env>(options: ApplicationOptions<E>): Hono<E> => ...;

3. Apply the same parameter to the testing helpers in packages/emmett-honojs/src/testing if they
   name `Hono` without one.

Then run `npm run build:ts`, `npm run lint`, and all three test levels for the package.

Out of scope, and worth its own issue: `registerWebApi` discards the route schema of the router, so
hono RPC (`hc<typeof app>`) cannot see the emmett routes. Fixing that means carrying the composed
type out of `route()`, which is a large type change. Note it, do not do it.

Constraints. Change no runtime behaviour. Do not commit, add, or stage.
```

### S9: the sub-router `onError` rules

```text
Repository: /home/oskar/Repos/emmett. Workspace root: src/. Read summary.md section 3. This step
needs nothing from phase 2 and nothing from S7 or S8.

Task. Dawid is right about the mechanism, and the current code is not affected. `registerWebApi`
creates a plain `new Hono()`, which keeps the default error handler, so the identity test inside
hono's `route()` passes and the parent `onError` applies:

    if (app.errorHandler === errorHandler) { handler = r.handler; }
    else { handler = async (c, next) => (await compose([], app.errorHandler)(c, () => r.handler(c, next))).res; }

The problem is in user code. A `WebApiSetup` can mount a sub-`Hono` that has its own `onError`, and
Problem Details then stops for that subtree with no error and no warning. The same code has two more
traps: hono runs the identity test at the moment of the `route()` call, so a later `sub.onError(...)`
is ignored, and `route()` copies the child's routes at that moment, so routes added later are
ignored.

This is a documentation fix, not a code fix.

Steps.

1. Add an integration test to packages/emmett-honojs/src/application.int.spec.ts, in the style of
   the tests already there, that holds all three rules:
   a. A sub-router with its own `onError` owns the errors from its handlers, and the parent Problem
      Details handler does not run for them.
   b. A sub-router with no `onError` gets the parent Problem Details handler.
   c. An `onError` registered on the child after `app.route(...)` has no effect.
2. Add a short section to docs/frameworks/honojs.md under "Compose Only What the Application Needs",
   stating the three rules:
   - Problem Details is an `onError` handler at the application level.
   - A sub-router with its own `onError` owns the errors from its handlers.
   - Register the `onError` handler and the routes of a child before you call `app.route(...)`.
3. Pull the example in the documentation from the region markers of the new test.

Then run `npm run build:ts`, `npm run lint`, the package tests, and `npm run docs:build`.

Constraints. Change no code in packages/emmett-honojs/src/application.ts. Do not commit, add, or
stage.
```

---

## Drift from this plan

Four design decisions changed while S1 to S5 were built. The prompts above already carry the change;
this records why, so nobody re-litigates it.

| Change                                                                                       | Why                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One `http/etag` folder of five files became `headers.ts`, `etag.ts`, `streamETag.ts`         | Five files for 175 lines. More importantly the module mixed HTTP with event sourcing, so `ETags` was unusable without an event store.                                |
| Flat `toETag` / `parseETag` / `parseIfMatch` became `ETags` and `StreamETags` module objects | The repo already uses the module pattern (`MessageProcessor`, `FusionStreams`). It also gave the split above somewhere to land.                                      |
| `sendProblem` reads the stream name off the error, not from an option                        | The first cut read it back out of the request's `If-Match`, which is HTTP middleware reverse engineering a domain identifier. `ConcurrencyError` carries it instead. |
| The row `'"3", "4"'` gives `3n`, not `4n`                                                    | The plan row contradicted its own first-match rule. `"3"` is the bare form and matches any stream.                                                                   |

Twelve smaller decisions are unruled. They are listed in the "Open items" table of summary.md.

## What this plan does not cover

Section 1.6 of the specification, the `_version` of a Pongo single-stream projection. No review
comment touches a query endpoint, no example GET returns an ETag, and an ETag is not mandatory. It
gets its own issue.

The hono RPC type loss noted at the end of section 4. It gets its own issue.
