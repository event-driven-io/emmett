---
documentationType: how-to-guide
outline: deep
---

# Error Handling {#error-handling}

When something goes wrong, your business logic makes one choice: record the outcome as an event, or raise an error. What happens to that choice depends on where the code runs. A command handler behind an HTTP endpoint, the usual setup, can let a raised error unwind into a response; a projection or reactor working through events in the background has no caller to unwind to, so the same throw stops it. This guide starts with the choice in the business logic and follows it into both settings, the synchronous request and the asynchronous processing, ending with how a raised error becomes an HTTP response.

## Return a Failure Event {#failures-as-events}

Start in the business logic, where a decision faces a negative outcome. A checkout that could not complete, a payment the bank declined, a booking that clashed with another: each is a fact about what happened, and the recommended default is to record it as its own event type, next to the success one. The decision then returns whichever event fits:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#return-failure-event

Returning different event types keeps the failure inside the normal flow of events. A projection can count failed checkouts, a workflow can compensate, and nothing downstream has to catch an exception to notice that something went wrong.

### Give Each Failure Its Own Event {#distinct-failures}

When a decision can fail in more than one way, give each mode its own event rather than folding them into a single generic error. A group checkout does not only fail when a guest's checkout is rejected; it can also run past its deadline with guests still pending. That timeout is a different fact, so a separate decision records it as `GroupCheckoutTimedOut`:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#timeout-failure-event

The workflow now has two failure events, `GroupCheckoutFailed` and `GroupCheckoutTimedOut`, each carrying the data its handler needs: the timeout lists which checkouts were still pending, the rejection lists which ones failed. A consumer can tell them apart and react to each on its own terms, retrying after a timeout and refunding after a rejection.

## Throw for Broken Invariants {#throw-invariants}

Returning an event fits an outcome the business expects. A broken rule is different: a command that should never have been issued, such as an illegal state transition or invalid input. Throw before building any event, so a bad command never records one.

Emmett ships error types for the common cases, each carrying an HTTP status code used later when the error reaches the web layer:

| Error type          | Status | Raise it when                                              |
| ------------------- | ------ | ---------------------------------------------------------- |
| `ValidationError`   | 400    | The command carries invalid input                          |
| `IllegalStateError` | 403    | The command violates a business rule or illegal transition |
| `NotFoundError`     | 404    | The state the command needs does not exist                 |
| `ConcurrencyError`  | 412    | The stream version no longer matches                       |

Guard an invalid transition by throwing before the event is built:

<<< @./../packages/emmett/src/commandHandling/handleCommand.unit.spec.ts#confirm-decision

Reject bad input the same way:

<<< @./../packages/emmett/src/commandHandling/handleCommand.unit.spec.ts#validation-error-decision

`ValidationError` and `IllegalStateError` take a message string. `NotFoundError` takes `{ id, type, message? }`. See [Command Handling](/guides/command-handling#decision) for writing decisions in full.

## Guard Concurrency in the Command Handler {#concurrency}

A decision hands its events, or its error, to the command handler. The handler loads the stream, runs the decision, and appends the result under an optimistic-concurrency check, and that check is the one error the handler raises on its own. When the stream has moved on since you read it, the append throws `ExpectedVersionConflictError`, a `ConcurrencyError` with status 412. It exposes the `current` and `expected` versions so you can see how far apart they drifted.

Over HTTP this surfaces as `412 Precondition Failed` through an ETag round-trip: the client sends the version it last saw in an `If-Match` header, and the append succeeds only if the stream still matches. For wiring the version through ETags and retrying on conflict, see [Control Concurrency](/guides/command-handling#concurrency) in the Command Handling guide.

## Never Throw in Asynchronous Event Handlers {#no-throw-async}

Whether throwing is safe depends on what sits above the code to catch it. A command handler behind an HTTP endpoint, its usual home, has the request: a thrown error unwinds into a response. Asynchronous handlers, the projections, reactors, and workflows that react to events, have nothing above them. A throw propagates up, stops the processor, and leaves later events unhandled. The endpoint is only the usual home, not a rule: a command handler run from a reactor loses the same safety net. Instead of throwing, turn the problem into data, in one of two ways.

The first is to return a failure event, as [Return a Failure Event](#failures-as-events) showed. This reactor releases a room through an external property-management system; when the call fails it returns `GuestCheckoutFailed` instead of throwing, so the workflow keeps running and can compensate:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#failure-as-event

The second is to return a handler result. Returning an `EmmettError` tells the processor to stop deliberately, with a reason, rather than crash:

<<< @./../packages/emmett/src/workflows/workflowProcessor.unit.spec.ts#handler-error-stops

The processor returns `{ type: 'STOP' }` and halts cleanly. A handler can also return `{ type: 'SKIP', reason }` to pass over a message it cannot act on, or `{ type: 'ACK' }` to accept it. See [Workflows & Sagas](/guides/workflows) for the wider pattern.

### Never Reject an Event in a Projection {#projection-errors}

A projection is a special case. It builds a read model from events that are already recorded, and a recorded event is a fact: the projection only interprets it, so it has nothing to reject. If an event carries a value the read model did not expect, throwing does not undo it. The check that should have stopped it belongs in the [business logic](#throw-invariants), before the event was ever recorded; by the time the projection runs, it is too late.

So accept the event and build the best read model you can from it. Skip a duplicate, fall back to a default, clamp a value back into range, whatever keeps the read model sensible and moving. Here a discount is already a fact, so rather than throw when the running total would go negative, the projection clamps it to zero and carries on:

<<< @/snippets/errorHandling/copingProjection.ts#coping-projection

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

### Map Your Own Errors {#custom-mapping}

Pass `mapError` to `getApplication` to translate custom error types. Return a `ProblemDocument` to set the response, or `undefined` to fall back to the default mapping:

<<< @/snippets/errorHandling/customErrorMapping.ts#custom-error-mapping

For returning Problem responses directly from a route with helpers such as `NotFound` and `BadRequest`, see the [Express.js Integration](/frameworks/expressjs#response-helpers) guide.

## Why Not Railway-Oriented Programming {#railway}

You have now seen both styles: return a value, or throw. Some languages fold failures into the return value at every step, threading a result type through the whole flow, an approach known as railway-oriented programming. In JavaScript and TypeScript it is less ergonomic, because the language already throws and any call might, so a result type sits alongside exceptions rather than replacing them. Scott Wlaschin, who popularised the pattern, [makes the same case against leaning on it too hard](https://fsharpforfunandprofit.com/posts/against-railway-oriented-programming/).

Emmett does not force either style, and returning a failure event already gives you what a result type reaches for: a failure carried as a value rather than thrown. Distinct event types go further than a result's two tracks. Each failure mode is a named, recorded fact, which is far more observable, and downstream code can react to each outcome on its own terms instead of branching on a binary success or error, as [Give Each Failure Its Own Event](#distinct-failures) showed. Throw for a broken invariant and let the Problem Details middleware map it, or return a value, a failure event or a handler `ACK` / `SKIP` / `STOP` result, where returning reads better. Reach for whichever fits the case at hand.

## Test Error Scenarios {#testing}

Assert a thrown rule with `thenThrows`, checking the error type, the message, or both:

<<< @/snippets/gettingStarted/businessLogic.unit.spec.ts#unit-error

At the HTTP layer, assert the Problem Details response with `expectError`. See [Testing](/guides/testing#assert-error) for both levels in full.

## Troubleshooting {#troubleshooting}

### A Projection or Reactor Stopped Processing {#projection-stopped}

If a read model stops updating and later events go unhandled, an asynchronous handler either threw or returned `STOP`. Both halt the processor, a throw by crashing it and `STOP` by design, so neither gets you past a single event a handler cannot process. Reserve `STOP` for a message the pipeline must genuinely not move past. Otherwise make the handler cope and carry on, as [Never Throw in Asynchronous Event Handlers](#no-throw-async) shows: a projection absorbs the event, a reactor returns a failure event or `SKIP`s the message to advance the checkpoint.

### A Custom Error Returns 500 {#custom-error-500}

If your own error type comes back as a 500 rather than the status you intended, the default mapping found no status on it. A plain `Error` carries none, so it falls through to 500. Return a `ProblemDocument` for it from `mapError`, or have it extend `EmmettError` with the right code, as [Map Your Own Errors](#custom-mapping) shows.

## Further Readings {#readings}

- [Command Handling](/guides/command-handling) - writing decisions that throw or return events
- [Workflows & Sagas](/guides/workflows) - handling failures across streams
- [Testing](/guides/testing) - asserting errors and Problem Details responses
- [Express.js Integration](/frameworks/expressjs) - response helpers and Problem Details
- [API Reference: Event Store](/api-reference/eventstore) - concurrency errors
- [Against Railway-Oriented Programming](https://fsharpforfunandprofit.com/posts/against-railway-oriented-programming/)
- [Problem Details for HTTP APIs (RFC 9457)](https://www.rfc-editor.org/rfc/rfc9457.html)
