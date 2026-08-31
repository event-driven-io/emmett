# PR #383 review comments: findings and fixes

I checked the code in this repository. I used `hono@4.13.0`. The range `^4.11.7` gives that version
here. I used `express@5.2.1`. I also installed and ran `hono@4.13.4`. I changed no files.

The `ETag` header keeps its HTTP meaning and also carries the stream version for optimistic
concurrency. Section 1 uses that rule.

## What this is about

Three review comments from Dawid, plus one issue comment. That is the whole ask.

| #   | Comment                                                                                            | Answer                                                                                                      | Fix                                                                     |
| --- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1   | `application.ts:40`. Avoid installing `etag()` globally, or limit it to cacheable GET and HEAD?    | The defect is real. I reproduced it. Hono fixed it in 4.13.1. We resolve to 4.13.0.                         | Bump the dependency. Keep the middleware.                               |
| 2   | `application.ts:49`. Does the Problem Details handler keep the status of a thrown `HTTPException`? | No. It returns 500. `bearerAuth`, `basicAuth`, and `jwt` all throw it, so they all return 500 today.        | Read `status`, keep the headers of the error, always send problem+json. |
| 3   | `honojs.md:68`. A sub-router has its own `onError` and ignores the parent.                         | The mechanism is real. The current code is not affected, because `registerWebApi` creates a plain `Hono()`. | Document it. Add a test.                                                |
| 4   | Issue comment. Generic types and child routers, discussion #2257.                                  | Real. Types only. The runtime is correct.                                                                   | Add `E extends Env`, default `Env`.                                     |

Items 1 to 4 are small and belong in PR #383.

**Then there is a second, separate thread.** You pasted an external comment saying that `W/"4"` in
`If-Match` breaks the HTTP specification. That is correct, and it is not one of the four comments
above. Chasing it turned up more:

| #   | Finding                                                                                                                                                | Source                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- |
| 5   | `W/"4"` in `If-Match` can never match. Section 13.1.1 needs strong comparison.                                                                         | The external comment   |
| 6   | A correct strong tag `"4"` returns **500**. The parse function returns the raw header, and `BigInt('"4"')` throws a `SyntaxError` with no `errorCode`. | Found while checking 5 |
| 7   | `If-Match: *`, a list, and an absent header are all passed to the event store as a version.                                                            | Found while checking 5 |
| 8   | `HeaderNames.IF_NOT_MATCH` is `'if-not-match'`. No such header exists.                                                                                 | Found while checking 5 |
| 9   | The two `etag.ts` files are identical, so 5 to 8 exist twice.                                                                                          | Found while checking 5 |

Items 5 to 9 touch `emmett`, `emmett-expressjs`, and `emmett-honojs`. They need their own PR. Section
1 is the design for them.

**Section 1.6 is out of scope.** It came from a question you asked me, not from any comment. It stays
in this document as a note and gets its own issue.

---

---

## 1. ETag

### 1.1 What the ETag means, and how it fits the framework defaults

One value in one header. It is opaque to every cache, proxy, and client. Only emmett reads inside it.
So the classical use and the concurrency use do not compete. They divide two ways.

**They divide by header.** Framework caching reads `If-None-Match` and writes `ETag`. Emmett
concurrency reads `If-Match`. No framework reads `If-Match`. Therefore concurrency works the same
whether framework caching is on or off. There is no trade-off to settle.

**They divide by endpoint.** Each framework generates a body hash only when the handler set no tag:

- Hono tests `if (!etag)`.
- Express tests `var generateETag = !this.get('ETag') && typeof etagFn === 'function'`
  (`node_modules/express/lib/response.js` line 169).

So an endpoint carries either a version tag or a generated hash. The two can never collide on one
response.

#### The measured result, both frameworks at their defaults

Hono 4.13.4 with `app.use(etag())`. Express 5.2.1 with the `etag` setting untouched, which means
generation is on. `/cart` sets `ETag` in the handler. `/products` sets nothing.

```
== hono 4.13.4, etag() installed ==
GET  /cart                              200  ETag: W/"4"
GET  /cart       If-None-Match: W/"4"   304  ETag: W/"4"
GET  /products                          200  ETag: "e61d70b879a90eba3cf3514d6bd5f68aae3c5ded"
GET  /products   If-None-Match: <hash>  304  ETag: "e61d70b879a90eba3cf3514d6bd5f68aae3c5ded"
POST /cart/items                        201  ETag: W/"5"
POST /cart/items If-None-Match: W/"5"   201  ETag: W/"5"

== express 5.2.1, etag setting at its default ==
GET  /cart                              200  ETag: W/"4"
GET  /cart       If-None-Match: W/"4"   304  ETag: W/"4"
GET  /products                          200  ETag: W/"d-5h1wuHmpDro881FNa9X2iq48Xe0"
GET  /products   If-None-Match: <hash>  304  ETag: W/"d-5h1wuHmpDro881FNa9X2iq48Xe0"
POST /cart/items                        201  ETag: W/"5"
POST /cart/items If-None-Match: W/"5"   201  ETag: W/"5"
```

The two frameworks agree, line for line. The version tag survives. A versioned GET revalidates to
304, so the client gets classical caching on the same value it later sends in `If-Match`. An
unversioned GET keeps its generated hash. A write keeps its status.

**The design therefore needs no switch.** Keep `etag()` in hono. Keep the express setting at the
framework default.

#### What the switches actually change

|                            | hono, no `etag()` | hono, `etag()` | express `etag: false` | express `etag: true` |
| -------------------------- | ----------------- | -------------- | --------------------- | -------------------- |
| Handler sets a version tag | tag sent, no 304  | tag sent, 304  | tag sent, **304**     | tag sent, 304        |
| Handler sets nothing       | no tag, no 304    | hash, 304      | no tag, no 304        | hash, 304            |
| Concurrency by `If-Match`  | works             | works          | works                 | works                |

Two things follow.

In hono the middleware is the only source of 304. Removing it does not protect concurrency. It only
removes caching, including caching of our own version tags.

In express the setting controls generation only. The 304 conversion is `if (req.fresh) this.status(304)`
and runs in all conditions, so an explicit version tag still produces a 304 with the setting off:

```
== express 5.2.1, app.set('etag', false) ==
GET /cart      If-None-Match: W/"4"   304  ETag: W/"4"      <- unchanged
GET /products                         200  ETag: absent     <- the only difference
```

So `enableDefaultExpressEtag ?? false` never protected concurrency. It removed caching from the
endpoints that carry no version. Section 1.5 item 8 removes the option.

One defect remains, and it belongs to hono 4.13.0 alone: it converts a write into a 304. Section 1.4
has the run. Hono 4.13.1 fixes it. Express is not affected, because `req.fresh` returns false for any
method other than GET and HEAD (`node_modules/express/lib/request.js` line 461).

A note on measurement. The Node `fetch` client sends `cache-control: no-cache`, and the `fresh`
module then reports stale in all conditions. The express runs above use `node:http`, so they show the
real behaviour. An earlier draft of this document used `fetch` and reported the wrong result.

The runs use `W/"4"`, the tag that the code emits today. Section 1.2 changes the format to a strong
tag. That changes nothing here:

```
GET /cart  If-None-Match: "shopping_cart-123:4"
  hono 4.13.4     304  ETag: "shopping_cart-123:4"
  express 5.2.1   304  ETag: "shopping_cart-123:4"
```

The RFC supports this. Section 8.8.1 defines a strong validator as metadata that changes whenever the
observable content changes. It then ranks the ways to build one, and puts revision identifiers first:

> There are a variety of strong validators used in practice. **The best are based on strict revision
> control**, wherein each change to a representation always results in a unique node name and
> revision identifier being assigned before the representation is made accessible to GET. A
> collision-resistant hash function applied to the representation data is **also** sufficient [...]

An event stream is strict revision control. The stream version is the revision identifier. The same
section closes with:

> Strong validators are usable for all conditional requests, including cache validation, partial
> content ranges, and "lost update" avoidance.

"Lost update avoidance" is optimistic concurrency. So the two uses are one use.

### 1.2 The format

**`ETag: "{streamName}:{version}"`, strong.**

Example: `ETag: "shopping_cart-123:4"`.

Why the stream name is in the tag:

1. The server can check that the tag belongs to this stream. A client that pastes another resource's
   tag gets a 412 instead of a silent append at the wrong version.
2. It cannot collide with a generated body hash. A hash has no `:` segment, so the parse is
   unambiguous.
3. It reads correctly in a log and in a browser inspector.

Why strong and not weak. Section 13.1.1:

> An origin server MUST use the strong comparison function when comparing entity tags for If-Match

Strong comparison needs two strong tags, so `W/"4"` can never match. Our samples send the weak form
today, which is the defect the reviewer reported. Removing `W/` fixes it. A weak tag cannot be made to
work for `If-Match`, and a body hash cannot carry a version, so classical hashing is not an
alternative here. It stays where it belongs, on endpoints with no version.

Two constraints on the value, from the grammar in section 8.8.3:

```
entity-tag = [ weak ] opaque-tag
opaque-tag = DQUOTE *etagc DQUOTE
etagc      = %x21 / %x23-7E / obs-text
```

- `:` is `%x3A`, inside `%x23-7E`, so it is legal.
- Space `%x20` and double quote `%x22` are not legal. A stream name that holds either produces a
  malformed header.

`mapToStreamId` is user supplied, so a stream name can hold anything. `ETags.strong` validates the
value and throws when it holds a character outside `etagc`. That fails at development time instead of
shipping a broken header. Percent encoding the name is the alternative if arbitrary ids matter more
than a readable tag.

Parse the version from the segment after the **last** `:`, so a stream name that holds a `:` still
works.

### 1.3 Reading the request

| Request                                | Result                     |
| -------------------------------------- | -------------------------- |
| `If-Match` absent                      | `NO_CONCURRENCY_CHECK`     |
| `If-Match` absent, endpoint opted in   | 428                        |
| `If-Match: *`                          | `STREAM_EXISTS`            |
| `If-Match: "cart-123:4"`, name matches | `4n`                       |
| `If-Match: "cart-999:4"`, name differs | 412                        |
| `If-Match: "4"` or `W/"4"`             | `4n`, the old forms        |
| `If-Match: "3", "4"`                   | true when a member matches |
| `If-Match:` any other value            | 412                        |
| `If-None-Match: *`                     | `STREAM_DOES_NOT_EXIST`    |
| `If-None-Match:` a list, unsafe method | 412                        |

Six notes on the table.

**Absent means no check.** Emmett already holds the value:

```ts
expected ??= NO_CONCURRENCY_CHECK;
```

The current code throws when the header is absent, so every endpoint that reads `If-Match` makes it
mandatory. That is the wrong default. An endpoint that wants the header asks for it on the call, not
through an application setting, because a concurrency requirement belongs to an endpoint:

```ts
getExpectedStreamVersionFromIfMatch(context, streamName);
getExpectedStreamVersionFromIfMatch(context, streamName, { required: true });
```

**428, not 412, when the header is required and absent.** 412 means that a condition in the request
evaluated to false. No header means no condition. RFC 6585 section 3 names the case, and its example
body says `try using "If-Match"`. It also says a 428 must not be stored by a cache.

**412, not 400, for every bad value.** You are right that a syntax error is usually 400. `If-Match`
has a more specific rule that overrides the general one. Section 13.1.1:

> 1. If the field value is "\*", the condition is true if the origin server has a current
>    representation for the target resource.
> 2. If the field value is a list of entity tags, the condition is true if any of the listed tags
>    match the entity tag of the selected representation.
> 3. **Otherwise, the condition is false.**

Step 3 covers a value that fails the grammar. Section 13.2.2 then says a false `If-Match` gives 412.
So a malformed value, a body hash, a wrong stream name, and a stale version all give 412. One rule,
one status.

**`If-None-Match: *` is the create idiom.** Section 13.1.2 gives it the meaning "only if the resource
does not exist". That is `STREAM_DOES_NOT_EXIST`. The `Created` sample hard codes that value today and
can read the header instead.

**The response always carries the resulting tag.** The precondition on the request and the validator
on the response are separate. Whatever the client sent, a successful append returns
`nextExpectedStreamVersion`, and that becomes the `ETag`:

| Request                  | Response on success  |
| ------------------------ | -------------------- |
| `If-Match` absent        | `ETag: "cart-123:5"` |
| `If-Match: *`            | `ETag: "cart-123:5"` |
| `If-Match: "cart-123:4"` | `ETag: "cart-123:5"` |

So `*` is the bootstrap. A client with no version writes once with `*`, and the response hands it a
concrete version. From then on it sends the exact tag. The same holds for an absent header. A client
never needs a GET to obtain its first version.

**A 412 carries the current version in its `ETag`.** This is the useful part of a conflict. Without
it the client must issue a GET before it can retry.

The exchange. The client holds version 4. Another writer has moved the stream to 7.

```http
POST /clients/c1/shopping-carts/cart-123/product-items
If-Match: "cart-123:4"
```

```http
HTTP/1.1 412 Precondition Failed
ETag: "cart-123:7"
Content-Type: application/problem+json

{
  "type": "about:blank",
  "title": "Precondition Failed",
  "status": 412,
  "detail": "Expected version 4 does not match current 7"
}
```

The client reads the `ETag`, retries with `If-Match: "cart-123:7"`, and needs no extra round trip.

This is correct, not a trick. Section 8.8.3 says:

> The "ETag" field in a response provides the current entity tag for **the selected representation**,
> as determined at the conclusion of handling the request.

It describes the representation of the target resource, not the body of this response. That is the
same wording that makes an `ETag` on a 304 correct, where the body is empty. On a 412 the selected
representation is the current cart, so `"cart-123:7"` is an accurate statement. A 412 is also not
heuristically cacheable, so no cache stores it.

`ConcurrencyError` already holds the value, so the mapping has it:

```ts
export class ConcurrencyError extends EmmettError {
  constructor(
    public current: string | undefined,
    public expected: string,
```

**What `sendProblem` must clear is a generated tag.** Express hashes the problem document when
generation is on, which is the default that item 8 of section 1.5 restores:

```
POST /cart/items If-Match: "3" (stale)   412  ETag: W/"3f-un0ADY0XevDHIpOVtkUwVsSMc28"
```

That value is a hash of the error document. It is not the validator of the cart, and a client that
puts it in `If-Match` gets another 412. So `sendProblem` clears any tag it did not set, and sets the
current version when the error is a concurrency conflict. Those are two different actions on the same
header, and an earlier draft of this document ran them together and said to clear it in every case.

Hono reaches the same rule from the other side. Its middleware skips a response that is not ok, so a
412 carries no tag at all:

```
POST /x  (hono 4.13.4, etag() installed)   412  ETag: absent
```

`sendProblem` must therefore supply the version itself. One rule covers both frameworks: clear a tag
you did not set, then set the current version on a conflict.

### 1.4 What is broken today

**The middleware turns a command into a 304.** `configureApplication` calls `application.use(etag())`.
In hono 4.13.0 the middleware tests the method and `res.ok` only in the `If-None-Match: *` branch:

```
POST /command  -> 304 | executed: true | Location: null
POST /boom     -> 500 with a generated ETag "cd54f918..."
POST /boom     -> 304 on the second request with a matching If-None-Match
```

Hono corrected this in [`f6aa913c3`](https://github.com/honojs/hono/commit/f6aa913c3), released in
**`hono@4.13.1`**. On 4.13.4 the same run gives 204 with `Location` intact and no ETag on the 500. The
dependency says `^4.11.7`, which resolves to 4.13.0 here.

**The parse function returns the raw header.** I ran the current logic over the forms a client can
send. The right column is what the event store receives as the expected version:

```
  If-Match: W/"4"        -> 4              correct
  If-Match: "4"          -> "4"            quotation marks kept
  If-Match: 4            -> 4              invalid syntax, works by accident
  If-Match: "3", "4"     -> "3", "4"       list passed through whole
  If-Match: *            -> *              passed through
  If-Match: W/"abc"      -> W/"abc"        the regex needs digits, so no match
  If-Match: "2e1f6c58"   -> "2e1f6c58"     a generated hash reaches the event store
```

Only the first row is right. The cause is that the two branches return different things:

```ts
return isWeakETag(eTagValue) ? getWeakETagValue(eTagValue) : eTagValue;
```

The weak branch returns capture group 1, which is the text inside the quotation marks. The other
branch returns the whole header field value.

**A correct strong tag gives 500.** The caller does
`assertUnsignedBigInt(getETagValueFromIfMatch(context))`, and that calls `BigInt(value)`.
`BigInt('"4"')` throws a native `SyntaxError`. `defaultErrorToProblemDetailsMapping` reads only
`errorCode`, and a native error has none, so it falls to its default:

```
thrown: SyntaxError | has errorCode: false
mapped -> {"detail":"Cannot convert \"4\" to a BigInt","status":500}
```

`ValidationError` carries `errorCode: 400`, so emmett can report a client fault. This path never
reaches it. That is the defect: a client fault is reported as a server fault, and the form the
specification requires is the form that fails.

**The two files are one file.** `packages/emmett-expressjs/src/etag.ts` and
`packages/emmett-honojs/src/etag.ts` are the same, byte for byte, except for three lines that touch
`Request` or `Context`. One implementation is copied, so one defect is copied.

**Express disables the wrong thing.** The comment above `application.set('etag', false)` says that
the default behaviour is off so that `if-match` and `if-not-match` work. The setting controls
generation only. Express still converts a response to 304 for an explicit tag, and it never reads
`If-Match`. The measurement is in section 1.1. So the setting protects nothing and costs the caching
of every endpoint that carries no version.

### 1.5 The proposal

1. Change the dependency to `hono@^4.13.1`. Keep `app.use(etag())` in `configureApplication`. The two
   styles coexist, so nothing needs to be removed.
2. Move the ETag code into `@event-driven-io/emmett` core, split into a generic HTTP layer and an
   event-sourcing layer on top of it. Each package keeps an adapter that reads a request header,
   writes a response header, and reads the method.

   ```
   packages/emmett/src/http/
     headers.ts       HeaderNames
     etag.ts          ETags = { strong, weak, parse, parseList }, generic RFC 9110
     streamETag.ts    StreamETags = { from, parse, ifMatch, ifNoneMatch }
   ```

   `etag.ts` imports nothing from `eventStore`, so `setETag`, `HeaderNames`, and `ETags` work in a
   plain REST route with no event store. Only `streamETag.ts` knows the
   `"{streamName}:{version}"` convention and `ExpectedStreamVersion`.

3. Add `StreamETags.from(streamName, version)`, which emits `"{streamName}:{version}"`, strong. It
   validates the value against `etagc` through `ETags.strong`. Keep `toWeakETag` as a deprecated
   export.
4. Add `getExpectedStreamVersionFromIfMatch(context, streamName, options?)`. It calls
   `StreamETags.ifMatch`, returns an `ExpectedStreamVersion`, and implements the table in 1.3. It
   never returns a raw header.
5. Accept the old forms `"4"` and `W/"4"` on input. Section 13.1.1 needs strong comparison, so
   accepting the weak form is a deliberate deviation. We take it because an old client sends it and
   because a proxy can weaken our tag in flight. Record the deviation in the documentation.
6. Answer `If-None-Match` on an unsafe method. `*` becomes `STREAM_DOES_NOT_EXIST`, and the event
   store evaluates existence. A list of entity tags gives 412, because it means "proceed only if the
   current version is none of these", and `ExpectedStreamVersion` holds one expected value and cannot
   express that. Section 13.2.2 makes an unsatisfied precondition a 412, and item 7 puts the current
   version on that 412, so the client can switch to `If-Match` and retry. Both frameworks skip this
   test today.
7. `sendProblem` clears an ETag the caller did not set. On a concurrency conflict it sets the
   current version instead, so the client can retry without a GET. It reads both the version and the
   stream name off the error, so no HTTP middleware has to know about streams. `ConcurrencyError`
   gains an optional `streamName`, which every event store fills in at the point it throws.
8. Remove `enableDefaultExpressEtag` and the `application.set('etag', ...)` call. Express then keeps
   its own default. The option protected nothing, and it removed caching from the endpoints that
   carry no version. An application that still wants generation off calls `app.set('etag', false)`
   itself, which is the express way to say it.
9. Fix the `If-Not-Match` header name. See section 5. It is the same file.

**This changes behaviour. Say so in the changelog:**

- The emitted tag becomes `"shopping_cart-123:4"` instead of `W/"4"`.
- An absent `If-Match` returns 412 today and will return a normal response.
- A malformed or foreign `If-Match` returns 500 today and will return 412.
- `If-Not-Match` was never a real header, so `getETagFromIfNotMatch` always threw. It now reads
  `If-None-Match`.
- `enableDefaultExpressEtag` is gone. Express keeps its own default, so an unversioned GET starts to
  answer 304 on revalidation. An application that wants generation off calls `app.set('etag', false)`
  itself.
- An express problem response sends `Content-Type: application/problem+json` with no
  `; charset=utf-8`. `sendProblem` writes the body itself, because express hashes a body into the
  `ETag` inside `res.send` and flushes headers with it in the same call, so a generated tag cannot be
  removed afterwards. JSON is UTF-8 by definition (RFC 8259), and this matches what the hono package
  already sends.
- A repeated `If-Match` header on express is joined with `', '` instead of taking the first value,
  which is the list form that `StreamETags.ifMatch` parses.

### 1.6 Out of scope, recorded for a separate issue

Nothing above needs this. No review comment touches a query endpoint, no sample GET returns an ETag,
and an ETag is not mandatory. I record it here only because it came up and it is a real defect.

If a query endpoint ever returns a version tag, it cannot take the value from `_version`. That field
counts document writes, not stream events.

`handleDocument` folds every handler for one document into a single change:

```js
const handlers = Array.isArray(handle) ? handle : [handle];
let result = existing ? { ...existing } : null;
for (const handler of handlers) result = await handler(result, id);
return toDocumentChange(id, existing, result);
```

`executeStorageChanges` then writes that change once. A new document gets `newVersion: 1n`. An
existing one gets `_version = _version + 1` in SQL. `packages/emmett/src/database/inMemoryDatabase.ts`
line 225 does the same, so this is a property of the design, not of one store.

`pongoSingleStreamProjection` delegates to `pongoMultiStreamProjection`, which groups a batch by
document id and folds all events for one document before it writes. So a batch of 3 events into a new
document gives `_version` 1 while the stream is at 3.

The value a query endpoint would need is on every event already. `CommonRecordedMessageMetadata` has
`streamPosition` and `streamName` (`packages/emmett/src/typing/message.ts` line 78). A single stream
projection could store them. That is a change to the stored document shape and needs a rebuild, so it
belongs in its own issue, not in this work.

---

## 2. `HTTPException` and Problem Details

### The defect

`app.onError(handler)` sets `this.errorHandler = handler`. It replaces the handler. It does not add
to it. `configureApplication` installs the Problem Details handler. Hono then loses its default
handler for `HTTPException`:

```js
// the hono default, now unreachable
var errorHandler = (err, c) => {
  if ("getResponse" in err) {
    const res = err.getResponse();
    return c.newResponse(res.body, res);
  }
  console.error(err);
  return c.text("Internal Server Error", 500);
};
```

`defaultErrorToProblemDetailsMapping` reads only `errorCode`. `HTTPException` holds `status`.
Therefore `throw new HTTPException(403, { message: 'Forbidden' })` returns status **500**. The detail
is `Forbidden`.

This is not a rare condition. The hono middlewares `bearerAuth`, `basicAuth`, and `jwt` all throw
`HTTPException`. An application that uses them receives 500 today. It must receive 401.

### The correct response

Always send `application/problem+json`. Build the document from the error. For
`throw new HTTPException(403, { message: 'Forbidden' })`:

```http
HTTP/1.1 403 Forbidden
Content-Type: application/problem+json

{
  "type": "about:blank",
  "title": "Forbidden",
  "status": 403,
  "detail": "Forbidden",
  "instance": "/products/1/price"
}
```

`ProblemDocument` sets `type` to `about:blank`. It also sets `title` from the status name. It does
both when you give it `status`. Therefore the compliant body needs no work. Two items are missing
today. The first is the status. The second is `instance`. Take `instance` from `c.req.path`.

Read the status in this order. Use the same order in both packages.

1. `error.status`. The hono `HTTPException` uses this. The `http-errors` convention on the Express
   side also uses this.
2. `error.statusCode`. This is the second half of the `http-errors` convention.
3. `error.errorCode`. This is the emmett convention. The code supports it today.
4. 500.

### Keep the headers from the error

This is the part that I did not explain well before. It is also the part that follows the hono
convention.

The hono auth middlewares do not throw a plain `HTTPException`. They throw one that holds a response.
That response exists only to hold `WWW-Authenticate`:

```js
// hono/middleware/bearer-auth
const res = new Response(null, { status, headers: {
  'WWW-Authenticate': `${wwwAuthenticatePrefix}${...}`
}});
throw new HTTPException(status, { res });
```

`basicAuth` and `jwt` do the same. RFC 9110 section 11.6.1 says that a 401 response must hold
`WWW-Authenticate`. We build a Problem Details body. If we discard `error.res`, we send an incorrect 401. We also break all hono auth middlewares.

Do this instead:

1. Build the Problem Details body from the error.
2. Copy the headers from `error.res` onto the response.
3. Remove `Content-Type` and `Content-Length`. We own those two headers.
4. Discard the body of `error.res`. The problem document replaces it.

Return the response with `c.newResponse(body, { status, headers })`. Do not use a plain
`new Response`. Then hono merges the headers from `c.header(...)`. The default hono handler does the
same.

Test with `'getResponse' in error`. Do not test with `instanceof HTTPException`. Hono tests the
property on purpose. A copy of the class from another realm then still works. This costs nothing.

### Two more items in the same file

`configureApplication` repeats the body of `sendProblem`. The `Content-Type` rule is then in two
places. Call `sendProblem` instead.

The `mapError` types are different in the two packages:

```ts
// emmett-expressjs
type ErrorToProblemDetailsMapping = (
  error: unknown,
  request: Request,
) => ProblemDocument | undefined;

// emmett-honojs (this PR)
type ErrorToProblemDetailsMapping = (
  error: Error,
) => ProblemDocument | undefined;
```

The hono type removes the context. A mapper then cannot read the path, the method, or `c.var`. The
type also limits the error to `Error`, and user code can call this function with any value. Change
it to `(error: unknown, context: Context) => ProblemDocument | undefined`.

---

## 3. A sub-router has its own `onError` (honojs.md line 68)

Dawid is correct about the mechanism. The current code does not have the problem. This is `route()`:

```js
route(path, app) {
  const subApp = this.basePath(path);
  app.routes.map((r) => {
    let handler;
    if (app.errorHandler === errorHandler) {   // the child never called .onError()
      handler = r.handler;                      // raw: the onError of the parent applies
    } else {
      handler = async (c, next) =>
        (await compose([], app.errorHandler)(c, () => r.handler(c, next))).res;
    }
    subApp.#addRoute(r.method, r.path, handler, r.basePath);
  });
}
```

`registerWebApi` creates a new `Hono()`. That router keeps the default handler. The identity test
passes. Therefore the Problem Details handler of the parent applies to all routes. The current tests
are correct.

The problem is in user code. A `WebApiSetup` can mount a sub-`Hono` that has its own `onError`.
Problem Details then stops for that subtree. There is no error and no warning.

The same code has two more traps. Both give incorrect behaviour without a failure:

- Hono runs the test `app.errorHandler === errorHandler` at the time of the `route()` call. Hono
  ignores a `sub.onError(...)` call that comes after `app.route('/sub', sub)`.
- `route()` copies the routes of the child at the time of the call. Hono ignores routes that you add
  to the child after that call.

**Fix: change the documentation, not the code.** Add a short section under "Compose Only What the
Application Needs". State these three rules:

1. Problem Details is an `onError` handler at the application level.
2. A sub-router with its own `onError` owns the errors from its handlers.
3. Register the `onError` handler and the routes of a child before you call `app.route(...)`.

Add an integration test for these rules. The test then holds them.

---

## 4. Generic types and child routers (discussion #2257)

The problem is real. It affects the types only. The API shape in this PR makes it worse.

```ts
export type WebApiSetup = (router: Hono) => void;
export const registerWebApi = (application: Hono, apis: WebApiSetup[]): Hono => {
  const router = new Hono();
  ...
};
```

Each `Hono` type here has no generic parameter. The `Env` of the application is lost. `Env` holds
`Bindings` and `Variables`.

The runtime is correct. yusukebe gives the reason in the discussion. One instance handles the
request. That instance inherits the env.

The types are not correct. A user writes `new Hono<{ Variables: { user: User } }>()`. In a setup
function, `c.var.user` then has the type `unknown`. The user has no place to add the generic
parameter.

**Fix: add `E extends Env` to each type and function. Use `Env` as the default.** Then no existing
code breaks.

```ts
export type WebApiSetup<E extends Env = Env> = (router: Hono<E>) => void;
export type ApplicationOptions<E extends Env = Env> = { apis: WebApiSetup<E>[]; ... };
export const registerWebApi = <E extends Env>(application: Hono<E>, apis: WebApiSetup<E>[]): Hono<E> => ...;
export const configureApplication = <E extends Env>(application: Hono<E>, options: ApplicationOptions<E>): Hono<E> => ...;
export const getApplication = <E extends Env = Env>(options: ApplicationOptions<E>): Hono<E> => ...;
```

Add a type test with a `Variables` env. The test then holds the inference.

`registerWebApi` also discards the route schema of the router, so hono RPC (`hc<typeof app>`) cannot
see the emmett routes. A fix must carry the composed type out of `route()`. That is a large type
change. I will open an issue for it.

---

## 5. A defect I found: `If-Not-Match` is not a header

This defect is in both packages. It is also in both documentation pages and both README files.

```ts
export const HeaderNames = {
  IF_MATCH: "if-match",
  IF_NOT_MATCH: "if-not-match", // no such header
  ETag: "etag",
};
```

The header is `If-None-Match`. No client sends `If-Not-Match`. Therefore `getETagFromIfNotMatch`
always throws `MISSING_IF_NOT_MATCH_HEADER`. The request header has no effect on the result. Both
packages ship this code in `dist`.

**Fix: correct the value. Only add to the public surface.**

- Add `HeaderNames.IF_NONE_MATCH = 'if-none-match'` in `packages/emmett/src/http/headers.ts`. Keep
  `IF_NOT_MATCH` as a deprecated alias with the same correct value.
- Add `getETagFromIfNoneMatch`. Keep `getETagFromIfNotMatch` as a deprecated export.
- Add `ETagErrors.MISSING_IF_NONE_MATCH_HEADER`. Keep the old member.
- Correct `expressjs.md` line 253, `honojs.md` lines 214 and 223, and both README files.

A change to the header name is a change of behaviour. The current behaviour always fails. Therefore
no user depends on it.

Do this item inside the core move in section 1. It is the same duplicated file.

---

## Order of work

**Phase 1. Sequential. Stays in PR #383.** This corrects the reported defect and nothing else.

1. Change the dependency to `hono@^4.13.1` and update the lock file. Add two tests: a POST with a
   matching `If-None-Match` keeps its response and its `Location` header, and a second failed request
   keeps its Problem Details response.

**Phase 2. Sequential. A new PR. Done.** This builds the ETag design from section 1.5. It touches
`emmett`, `emmett-expressjs`, `emmett-honojs`, and, for the `streamName` on the error, the four store
packages.

2. Move the ETag code into core, split into `headers.ts`, a generic `etag.ts`, and `streamETag.ts`.
   Fix the `If-Not-Match` header name from section 5 in the same move.
3. Reduce both `etag.ts` adapters to the parts that touch `Request` or `Context`. Every export the
   packages had stays alive, deprecated where it is replaced.
4. `sendProblem` clears an ETag it did not set, and sets the current version on a concurrency
   conflict. `ConcurrencyError` gains an optional `streamName`, filled in at all 14 places that throw
   it. Remove `enableDefaultExpressEtag` and the `application.set('etag', ...)` call.
5. Update both in-package examples, their tests, both README files, and both documentation pages.
   Record the behaviour changes from section 1.5 in the PR description, since the repository has no
   changelog. The blocks that change in `honojs.md`, and their twins in `expressjs.md`:
   - Lines 197 to 200, the four step list. Add the absent case, `*`, and the new tag format.
   - Line 206. It says `getETagValueFromIfMatch` reports a missing `If-Match` as 412. Absent now
     means no check.
   - Line 224. It says the function "returns any other ETag value unchanged". That sentence
     documents the defect in 1.4 as intended behaviour.
   - Lines 212 to 225, the function table. `toWeakETag`, `WeakETagRegex`, `isWeakETag`, and
     `getWeakETagValue` become deprecated rows. Add `ETags`, `StreamETags`, and
     `getExpectedStreamVersionFromIfMatch`.
   - Line 208 stays. It already says an explicit tag takes precedence over a generated one, which is
     the rule in 1.1.

Item 5 is the only part of phase 2 that is not done.

**Phase 3. Parallel.** These three items need nothing from phase 2 or from each other.

6. `HTTPException` support, the status order, the header copy, and the `mapError` type. Do this in
   both packages. The hono `onError` already calls `sendProblem`, which phase 2 needed.
7. The `E extends Env` generic parameters and the type tests.
8. Documentation: the sub-router `onError` rules from section 3.

Section 1.6 is not in this list. It gets its own issue.

---

## Open items

Twelve decisions made during phase 2 that Oskar has not ruled on. Each one is live in the code.

| #   | Decision                                                                                          | Recommendation         |
| --- | ------------------------------------------------------------------------------------------------- | ---------------------- |
| 1   | Express `sendProblem` uses `response.end`, so `Content-Type` loses `; charset=utf-8`              | keep                   |
| 2   | `HttpProblemResponseOptions` gained `error?: unknown`                                             | keep                   |
| 3   | Hono `onError` calls `sendProblem`, which phase 3 had planned                                     | keep                   |
| 4   | `StreamETags.parse` rejects a negative version. `WeakETagRegex` allowed one                       | keep                   |
| 5   | Express joins a repeated header with `', '`. The old code took the first value                    | keep                   |
| 6   | `PreconditionRequiredError` re-exported from both adapters                                        | keep or drop from both |
| 7   | The `etagc` check ends at `\u00FF`, since Node throws above that                                  | keep                   |
| 8   | Every step ran `npx vitest run --root .`, because `npm run test:int -w <pkg>` is broken repo-wide | own issue              |
| 9   | The S1 regression test asserts no ETag on the 500, then sends `*`                                 | keep                   |
| 10  | `responses.unit.spec.ts` went from object identity to deep equal, since the body is now a string  | keep                   |
| 11  | Both web packages gained an `etag.int.spec.ts` beyond what the plan asked                         | keep                   |
| 12  | mongodb, sqlite, postgresql, esdb are edited but untested. Docker. `tsc -b` only                  | Oskar runs them        |

Item 8 is a defect in its own right. The root `vitest.config.ts` lists `projects` as relative paths,
and `-w` sets the cwd to the package, so vitest resolves them against the package and fails. It
predates this work.

Section 1.6 held the only open question in an earlier draft. It is out of scope for these comments, so
it moves to its own issue and the question moves with it.

Two corrections to earlier drafts, so the history is clear:

- 400 has no place in `If-Match` handling. A syntax error is usually 400, but section 13.1.1 step 3
  makes any value that is not `*` and not a matching entity tag a false condition, and section 13.2.2
  makes a false condition a 412. The specific rule wins over the general one.
- An earlier draft said to remove the ETag middleware. The runs in section 1.1 show that the two
  styles coexist at the framework defaults, so it stays.
- An earlier draft measured express with the Node `fetch` client, which sends `cache-control: no-cache`
  and forces a stale result. Section 1.1 now uses `node:http`.
