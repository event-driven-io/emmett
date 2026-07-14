---
documentationType: how-to-guide
outline: deep
---

# Error Handling {#error-handling}

An event-sourced system has two ways to signal that something went wrong: record it as an event, or raise an error. This guide shows when to reach for each, how a raised error becomes an HTTP response, and how to map your own error types. The rule to start from: model expected business outcomes as events, and keep errors for broken invariants and bad input.

## Model Expected Failures as Events {#failures-as-events}

A negative business outcome is still a fact about what happened. A checkout that could not complete, a payment the bank declined, a booking that clashed with another: each is worth recording, and later projections, workflows, and analytics all want to see it. Give it its own event type next to the success one, and let the decision return whichever fits the outcome.

This output handler releases a room through an external property-management system. On success it returns `GuestCheckedOut`; when the call fails it returns `GuestCheckoutFailed` instead of throwing, so the failure is captured as a fact the workflow can act on:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#failure-as-event

Returning different event types keeps the failure inside the normal flow of events. A workflow can then compensate, a projection can count failed checkouts, and nothing has to catch an exception to notice that something went wrong.

## Throw for Broken Invariants {#throw-invariants}

Keep exceptions for the cases a command should never have reached: an illegal state transition or invalid input. Throw before building any event, so a bad command never records one.

Emmett ships error types for the common cases, each carrying an HTTP status code used when the error reaches the web layer:

| Error type          | Status | Raise it when                                              |
| ------------------- | ------ | ---------------------------------------------------------- |
| `ValidationError`   | 400    | The command carries invalid input                          |
| `IllegalStateError` | 403    | The command violates a business rule or illegal transition |
| `NotFoundError`     | 404    | The state the command needs does not exist                 |
| `ConcurrencyError`  | 412    | The stream version no longer matches                       |

`ValidationError` and `IllegalStateError` take a message string. `NotFoundError` takes `{ id, type, message? }`. `ConcurrencyError` exposes `current` and `expected` versions; Emmett throws its subclass `ExpectedVersionConflictError` on a failed optimistic-concurrency check, covered in [Guard Against Concurrency Conflicts](#concurrency).

Guard an invalid transition by throwing before the event is built:

<<< @./../packages/emmett/src/commandHandling/handleCommand.unit.spec.ts#confirm-decision

Reject bad input the same way:

<<< @./../packages/emmett/src/commandHandling/handleCommand.unit.spec.ts#validation-error-decision

The command handler runs inside the request, so an error thrown here unwinds to the web layer, where it becomes a [Problem Details](#problem-details) response. See [Command Handling](/guides/command-handling#decision) for writing decisions in full.

## Never Throw Inside Reactors and Workflows {#no-throw-async}

An error thrown inside an asynchronous message handler, a projection, a reactor, or a workflow output handler, is not wrapped in a request. It propagates up and stops the processor, so the handler makes no further progress and later events go unprocessed. Two options keep processing under control.

The first is to return a failure event, as [Model Expected Failures as Events](#failures-as-events) shows. The second is to return a handler result. Returning an `EmmettError` tells the processor to stop deliberately, with a reason, rather than crash:

<<< @./../packages/emmett/src/workflows/workflowProcessor.unit.spec.ts#handler-error-stops

The processor returns `{ type: 'STOP' }` and halts cleanly. A handler can also return `{ type: 'SKIP', reason }` to pass over a message it cannot act on, or `{ type: 'ACK' }` to accept it. See [Workflows & Sagas](/guides/workflows) for the wider pattern.

## Map Errors to Problem Details {#problem-details}

Behind `emmett-expressjs`, `getApplication` installs middleware that turns a thrown error into an [RFC 9457 Problem Details](https://www.rfc-editor.org/rfc/rfc9457.html) response. An `IllegalStateError` becomes a 403:

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

## Guard Against Concurrency Conflicts {#concurrency}

A failed optimistic-concurrency check throws `ExpectedVersionConflictError`, a `ConcurrencyError` with status 412. Over HTTP it surfaces as `412 Precondition Failed` through the ETag round-trip: the client sends the version it last saw in an `If-Match` header, and the append succeeds only if the stream still matches. For wiring the version through ETags and retrying on conflict, see [Control Concurrency](/guides/command-handling#concurrency) in the Command Handling guide.

## Why Not Railway-Oriented Programming {#railway}

Some languages model failures with a result type threaded through every step, an approach known as railway-oriented programming. In JavaScript and TypeScript it is a poorer fit, because the language already throws and any call might, so a result type sits alongside exceptions rather than replacing them. Scott Wlaschin, who popularised the pattern, [makes the same case against leaning on it too hard](https://fsharpforfunandprofit.com/posts/against-railway-oriented-programming/).

Emmett does not force either style. Throw for a broken invariant and let the Problem Details middleware map it, or return a value, a failure event or a handler `ACK` / `SKIP` / `STOP` result, where returning reads better. Choose per case; Emmett will not tell you how to live.

## Testing Error Scenarios {#testing}

Assert a thrown rule with `thenThrows`, checking the error type, the message, or both:

<<< @/snippets/gettingStarted/businessLogic.unit.spec.ts#unit-error

At the HTTP layer, assert the Problem Details response with `expectError`. See [Testing](/guides/testing#assert-error) for both levels in full.

## Further Reading {#readings}

- [Command Handling](/guides/command-handling) - writing decisions that throw or return events
- [Workflows & Sagas](/guides/workflows) - handling failures across streams
- [Testing](/guides/testing) - asserting errors and Problem Details responses
- [Express.js Integration](/frameworks/expressjs) - response helpers and Problem Details
- [API Reference: Event Store](/api-reference/eventstore) - concurrency errors
- [Against Railway-Oriented Programming](https://fsharpforfunandprofit.com/posts/against-railway-oriented-programming/)
- [Problem Details for HTTP APIs (RFC 9457)](https://www.rfc-editor.org/rfc/rfc9457.html)
