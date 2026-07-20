---
documentationType: how-to-guide
outline: deep
---

# Error Handling {#error-handling}

When something goes wrong, your business logic makes one choice: record the outcome as an event, or raise an error. What happens to that choice depends on where the code runs. A command handler behind an HTTP endpoint, the usual setup, can let a raised error unwind into a response; a projection or reactor working through events in the background has no caller to unwind to, so the same throw stops it. This guide starts with the choice in the business logic and follows it into both settings, the synchronous request and the asynchronous processing, ending with how a raised error becomes an HTTP response.

## Return a Failure Event {#failures-as-events}

Start in the business logic, where a decision faces a negative outcome. A checkout that could not complete, a payment the bank declined, a booking that clashed with another: each is a fact about what happened, and the recommended default is to record it as its own event type, next to the success one. The decision then returns whichever event fits:

<<< @./../packages/emmett-tests/src/errorHandling/failureEvents.unit.spec.ts#return-failure-event{9-11}

Returning different event types keeps the failure inside the normal flow of events. A projection can count failed checkouts, a workflow can compensate, and nothing downstream has to catch an exception to notice that something went wrong.

### Give Each Failure Its Own Event {#distinct-failures}

When a decision can fail in more than one way, give each mode its own event rather than folding them into a single generic rejection with a reason field. A coupon does not only fail because it lapsed; it can also have been used already, or the cart can sit below the coupon's minimum. Each is a different fact, so each gets its own event:

<<< @./../packages/emmett-tests/src/errorHandling/failureEvents.unit.spec.ts#distinct-failure-events{5-8}

Every _failure_ event carries the data its own handler needs, which a shared `CouponRejected` could not: `CouponAlreadyUsed` carries when the coupon was first applied, `CartBelowCouponMinimum` carries both the cart total and the minimum it missed. A consumer can tell them apart and react to each on its own terms, emailing a fresh coupon after an expiry and suggesting more items after a near miss.

### Return a Failure Without Recording It {#selective-failure-events}

Whether a failure event belongs in the stream depends on who needs it after the current request finishes. Record it when it changes how the aggregate is rebuilt, when another component must react to it, or when it forms part of the history you need to retain. The earlier checkout examples use that model: the failure remains available to projections and workflows long after the caller receives its response.

Some failed attempts do not change the aggregate and do not need to trigger any later processing. The endpoint still needs enough information to tell the client why the command was not applied. When the requested product quantity is unavailable, the decision can return `ProductItemOutOfStock` with the requested and available quantities while leaving the cart unchanged. If no downstream consumer needs that attempt, the event does not need to be appended to the cart stream.

Configure `rejectOn` when that outcome should leave the stream unchanged while remaining available to the caller:

<<< @./../packages/emmett/src/commandHandling/handleCommand.middleware.unit.spec.ts#command-handler-reject-on

`rejectOn` does not turn the event into an exception. The decision returns `ProductItemOutOfStock`, and the handler returns that event to the caller without saving changes from the command batch. The cart remains as it was before the request, and later commands in the batch do not run. The endpoint can use the event's data to build a specific conflict response.

You can instead configure `throwOn` to translate the produced event into an exception before anything is appended. The exception enters the application's centralized error mapping, and the handler does not return a normal result.

`rejectOn` and `throwOn` can therefore produce the same HTTP error response through different control flow. `rejectOn` returns the failure event, and the endpoint maps that known outcome explicitly. This keeps expected failures in a deterministic result pipeline without using exceptions for control flow. Use `throwOn` when the endpoint already relies on centralized exception mapping or when returning the event would not be useful. See [Turn a Produced Event into an Exception](/guides/command-handling#throw-on-output) for the exception form and [Reject the Complete Batch](/guides/command-handling#reject-output) for the batch behavior.

#### Keep Earlier Changes and Stop {#stop-on-failure}

Use `stopOn` when commands earlier in the batch made independent changes that should remain saved. The matching failure is returned without being appended, and later commands do not run. Use `rejectOn` instead when the complete batch must be all-or-nothing. [Commit Earlier Decisions and Stop](/guides/command-handling#stop-output) shows the configuration alongside the other handling choices.

## Throw for Broken Invariants {#throw-invariants}

Returning an event fits an outcome the business expects. A broken rule is different: a command that should never have been issued, such as an illegal state transition or invalid input. Throw before building any event, so a bad command never records one.

Throw whatever error type you like: your own class, a plain `Error`, one from a library. Emmett does not require its own. Yet, it ships is a set of error types for the common cases, each carrying a HTTP-based error code, so that an error thrown deep in a decision maps to the right response by convention rather than by wiring:

| Error type          | Status | Raise it when                                              |
| ------------------- | ------ | ---------------------------------------------------------- |
| `ValidationError`   | 400    | The command carries invalid input                          |
| `IllegalStateError` | 403    | The command violates a business rule or illegal transition |
| `NotFoundError`     | 404    | The state the command needs does not exist                 |
| `ConcurrencyError`  | 412    | The stream version no longer matches                       |

Guard an invalid transition by throwing before the event is built:

<<< @./../packages/emmett/src/commandHandling/handleCommand.unit.spec.ts#confirm-decision{8-9}

Reject bad input the same way:

<<< @./../packages/emmett/src/commandHandling/handleCommand.unit.spec.ts#validation-error-decision{6-7}

Reach for your own type when none of these fits, and [Map Your Own Errors](#custom-mapping) shows how to give it a status. See [Command Handling](/guides/command-handling#decision) for writing decisions in full.

## Guard Concurrency in the Command Handler {#concurrency}

A decision hands its events, or its error, to the command handler. The handler loads the stream, runs the decision, and appends the result under an optimistic-concurrency check, and that check is the one error the handler raises on its own. When the stream has moved on since you read it, the append throws `ExpectedVersionConflictError`, a `ConcurrencyError` with status 412. It exposes the `current` and `expected` versions so you can see how far apart they drifted.

Over HTTP this surfaces as `412 Precondition Failed` through an ETag round-trip: the client sends the version it last saw in an `If-Match` header, and the append succeeds only if the stream still matches. For wiring the version through ETags, see [Control Concurrency](/guides/command-handling#concurrency) in the Command Handling guide.

## Retry a Transient Failure {#retry}

Not every error the handler raises has to reach the caller. Some are transient: run the same command again and it goes through. The version conflict from the last section is the clearest case. The append lost an optimistic-concurrency race, so the events it collided with are already in the stream, and re-running the handler rebuilds the state from them before appending on top. Set `retry` and Emmett does that for you, re-running the whole handler when the append throws `ExpectedVersionConflictError`:

<<< @./../packages/emmett/src/commandHandling/handleCommand.unit.spec.ts#retry-on-conflict{5}

`retry` sits on the handler config, or on a single call as here, so recovery covers every command or just the one in hand. `{ onVersionConflict: true }` is the shorthand for the built-in policy: a bounded run of attempts, each after a longer pause, retrying only the version conflict and giving up once the attempts run out, so a write that stays stuck still surfaces rather than looping. Pass a count in place of `true`, as in `{ onVersionConflict: 5 }`, to keep that policy but change how many attempts it makes. For the exact backoff figures and every form `retry` accepts, see [Retry](/api-reference/commandhandler#retry) in the reference.

Each attempt re-runs the decision from the top, so the same command reaches your logic again. That is safe when the decision only reads state and returns events, and unsafe when it performs I/O, which then fires on every attempt. Keep the decision pure, as [Keep the Decision Pure](/guides/command-handling#keep-pure) shows, and the [idempotence](/guides/command-handling#idempotence) that makes a resent command safe covers a retried one too.

A version conflict is not the only transient failure. A read model briefly unreachable, a session dropped mid-append: these clear on a retry too, while a broken invariant or invalid input would fail the same way every time and should surface at once. Pass a full policy with a `shouldRetryError` predicate to decide which errors earn another attempt:

<<< @./../packages/emmett/src/commandHandling/handleCommand.unit.spec.ts#custom-retry{8}

The predicate runs on each thrown error: return `true` and the attempt repeats under the given `retries` and backoff, return `false` and the error unwinds straight away. Match the types you know are transient, here a `DatabaseConnectionError` from your own infrastructure, and let a `ValidationError` or `IllegalStateError` fall through. The wider it reaches, the more paths re-run the decision, so the same purity caution holds.

## Never Throw in Asynchronous Event Handlers {#no-throw-async}

Whether throwing is safe depends on what sits above the code to catch it. A command handler behind an HTTP endpoint, its usual home, has the request: a thrown error unwinds into a response. Asynchronous handlers, the projections, reactors, and workflows that react to events, have nothing above them. A throw propagates up, stops the processor, and leaves later events unhandled. The endpoint is only the usual home, not a rule: a command handler run from a reactor loses the same safety net. Instead of throwing, turn the problem into data. You have two ways to do that.

Return a failure event, as [Return a Failure Event](#failures-as-events) showed. This reactor charges an order through an external payment gateway; when the gateway declines, it appends `PaymentFailed` instead of throwing, so the reactor keeps running and a workflow can compensate:

<<< @./../packages/emmett-tests/src/errorHandling/reactorErrors.features.ts#failure-as-event{15,27}

Or catch the error and return a handler result. `MessageProcessor.result` gives you `skip` and `stop`. `skip` passes over a single message and lets the reactor carry on; `stop` halts the whole reactor, so a later run resumes from the same point. Reach for `skip` in the ordinary case, and reserve `stop` for a critical path where continuing past the failure would do more harm than halting. Here a free order has nothing to charge, so the reactor skips it, while a failed charge sits on the revenue path, so it stops rather than let the pipeline drop a charge:

<<< @./../packages/emmett-tests/src/errorHandling/reactorErrors.features.ts#reactor-skip-stop{3,12,19}

Returning nothing accepts the message and moves on. See [Workflows & Sagas](/guides/workflows) for the wider pattern.

### Never Reject an Event in a Projection {#projection-errors}

A projection is a special case. It builds a [read model](/guides/projections) from events that are already recorded, and a recorded event is a fact: the projection only interprets it, so it has nothing to reject. If an event carries a value the read model did not expect, throwing does not undo it. The check that should have stopped it belongs in the [business logic](#throw-invariants), before the event was ever recorded; by the time the projection runs, it is too late.

So accept the event and build the best read model you can from it. Skip a duplicate, fall back to a default, clamp a value back into range, whatever keeps the read model sensible and moving. Here a discount is already a fact, so rather than throw when the running total would go negative, the projection clamps it to zero and carries on:

<<< @./../packages/emmett/src/eventStore/projections/inMemory/inMemoryProjection.unit.spec.ts#coping-projection{29-32}

The read model stays consistent and the processor keeps running. A total that drifts below zero is a sign that a rule is missing upstream, so fix it in the decision that records the event, not in the projection that reads it.

## Map Errors to Problem Details {#problem-details}

When the error unwinds to an HTTP endpoint, it still needs a shape the caller can read. Behind `emmett-expressjs`, `getApplication` installs middleware that turns it into a [Problem Details](https://www.rfc-editor.org/rfc/rfc9457.html) body. Problem Details is the IETF standard (RFC 9457) for describing an HTTP error in the response body: a small, agreed set of fields (`type`, `title`, `status`, `detail`) so clients get one consistent, machine-readable error shape instead of each API inventing its own. Emmett gives you that shape for free. An `IllegalStateError` becomes a 403:

```json
{
  "type": "about:blank",
  "title": "Forbidden",
  "status": 403,
  "detail": "Cannot confirm an empty shopping cart"
}
```

The status comes from the error's code, the title from that HTTP status, and the detail from the error message. Emmett's built-in errors carry their status code, so they map without any configuration: `ValidationError` to 400, `IllegalStateError` to 403, `NotFoundError` to 404, `ConcurrencyError` to 412. Anything else becomes a 500.

### Map Returned Events to Error Responses {#map-returned-events}

An event returned through `rejectOn` or `stopOn` does not enter exception middleware. At the web API boundary, the endpoint must map that business outcome to HTTP explicitly. It can use an ordinary switch, or use `ResponseFromEvents` from the Express and Hono integrations.

This Express route calls the command handler, passes its result to `ResponseFromEvents`, and returns the same `Conflict(...)` or success response that an `on` route normally returns:

<<< @./../packages/emmett-expressjs/src/responses.int.spec.ts#express-response-from-events-route

The `failure` callback is checked for each produced event, from newest to oldest, until it returns a response. Returning `undefined` leaves that event unmapped. If no failure response is selected, `success` provides the normal status or response callback. The Hono helper uses the same mapping and additionally receives its `context`.

### Map Your Own Errors {#custom-mapping}

The default mapping reads a numeric `errorCode` off the error it caught, so the shortest route to your own status is to carry one. Derive from `EmmettError` and hand the code to its constructor:

<<< @./../packages/emmett-expressjs/src/mapError.int.spec.ts#derive-emmett-error{5}

The base class is a convenience rather than a requirement. Any error with a numeric `errorCode` maps the same way, which keeps your own hierarchy free of Emmett:

<<< @./../packages/emmett-expressjs/src/mapError.int.spec.ts#error-with-code{3}

For an error you cannot change, one thrown by a library you do not own, pass `mapError` to `getApplication`. Return a `ProblemDocument` to shape the response, or `undefined` to fall back to the default mapping:

<<< @./../packages/emmett-expressjs/src/mapError.int.spec.ts#custom-error-mapping{20,22}

Give the document an explicit `type` URI whenever you set your own `title`. Under the default `about:blank` type, Problem Details replaces the title with the standard reason phrase for the status, and your wording is lost.

For returning Problem responses directly from a route with helpers such as `NotFound` and `BadRequest`, see the [Express.js Integration](/frameworks/expressjs#response-helpers) guide.

## Why Not Returning Result {#result}

You have now seen both styles: return a value, or throw. Some languages fold failures into the return value at every step, threading a `Result` type through the whole flow, an approach known as [railway-oriented programming](https://fsharpforfunandprofit.com/rop/). In JavaScript and TypeScript it is less ergonomic, because the language already throws and any call might, so a result type sits alongside exceptions rather than replacing them. Scott Wlaschin, who popularised the pattern, [makes the same case against leaning on it too hard](https://fsharpforfunandprofit.com/posts/against-railway-oriented-programming/).

Emmett does not force either style, and returning a failure event already gives you what a result type reaches for: a failure carried as a value rather than thrown. Distinct event types go further than a result's two tracks. Each failure mode is a named, recorded fact, which is far more observable, and downstream code can react to each outcome on its own terms instead of branching on a binary success or error, as [Give Each Failure Its Own Event](#distinct-failures) showed. Throw for a broken invariant and let the Problem Details middleware map it, or return a value, a failure event or a handler `ACK` / `SKIP` / `STOP` result, where returning reads better. Reach for whichever fits the case at hand.

## Test Error Scenarios {#testing}

Assert a thrown rule with `thenThrows`, checking the error type, the message, or both:

<<< @/snippets/gettingStarted/businessLogic.unit.spec.ts#unit-error{24-26}

At the HTTP layer, assert the Problem Details response with `expectError`. See [Testing](/guides/testing#assert-error) for both levels in full.

## Troubleshooting {#troubleshooting}

### A Projection or Reactor Stopped Processing {#projection-stopped}

If a read model stops updating and later events go unhandled, an asynchronous handler either threw or returned `STOP`. Both halt the processor, a throw by crashing it and `STOP` by design, so neither gets you past a single event a handler cannot process. Reserve `STOP` for a message the pipeline must genuinely not move past. Otherwise make the handler cope and carry on, as [Never Throw in Asynchronous Event Handlers](#no-throw-async) shows: a projection absorbs the event, a reactor returns a failure event or `SKIP`s the message to advance the checkpoint.

### A Custom Error Returns 500 {#custom-error-500}

If your own error type comes back as a 500 rather than the status you intended, the default mapping found no status on it. A plain `Error` carries none, so it falls through to 500. Give the error a numeric `errorCode`, either through `EmmettError` or as a field of its own, or return a `ProblemDocument` for it from `mapError`, as [Map Your Own Errors](#custom-mapping) shows.

## Further Readings {#readings}

- [Command Handling](/guides/command-handling) - writing decisions that throw or return events
- [Workflows & Sagas](/guides/workflows) - handling failures across streams
- [Testing](/guides/testing) - asserting errors and Problem Details responses
- [Express.js Integration](/frameworks/expressjs) - response helpers and Problem Details
- [API Reference: Event Store](/api-reference/eventstore) - concurrency errors
- [Against Railway-Oriented Programming](https://fsharpforfunandprofit.com/posts/against-railway-oriented-programming/)
- [Problem Details for HTTP APIs (RFC 9457)](https://www.rfc-editor.org/rfc/rfc9457.html)
