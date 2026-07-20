---
documentationType: how-to-guide
outline: deep
---

# Command Handling {#command-handling}

A command is an intention to run business logic: add an item to a cart, confirm an order. Handling it means loading the stream, rebuilding the current state from its events, running your decision, and appending the events the decision returns under an optimistic concurrency check. This guide shows you how to set up a command handler, write the decision that holds your business logic, and control the concurrency, retries, and HTTP layer around it. For the full API surface, see the [Command Handler reference](/api-reference/commandhandler).

## Create a Handler {#create-handler}

Configure a handler once with `evolve` and `initialState`, then reuse it across the application:

<<< @/snippets/gettingStarted/commandHandler.ts#command-handler

## Write the Decision {#decision}

A decision receives the current state and the command, and returns the events to append. It holds your business logic: it decides what happens, and it is the one place a business rule is enforced.

### Return one event {#single-event}

When a command produces a single outcome, return one event:

<<< @./../packages/emmett/src/commandHandling/handleCommand.unit.spec.ts#single-event-decision

### Return several events {#multiple-events}

Return an array when one command produces several outcomes. The handler appends them together in a single write, so the stream cannot be left holding only some of them:

<<< @./../packages/emmett/src/commandHandling/handleCommand.unit.spec.ts#multiple-events-decision

### Guard against an invalid state {#guard-state}

Throw `IllegalStateError` before building any event, so an invalid transition never produces one. The same decision returns an empty array when the state leaves nothing to do, which keeps re-sending the command safe:

<<< @./../packages/emmett/src/commandHandling/handleCommand.unit.spec.ts#confirm-decision

### Validate the input {#validate-input}

Throw `ValidationError` when the command carries bad input, again before producing any event:

<<< @./../packages/emmett/src/commandHandling/handleCommand.unit.spec.ts#validation-error-decision

## Handle a Command {#handle}

Call the handler with the event store, the stream id, and your decision. It loads the stream, runs the decision, and appends the result, returning `nextExpectedStreamVersion` to carry into the next call:

<<< @/snippets/gettingStarted/commandHandling.ts#command-handling

## Run Several Decisions in Order {#sequential}

Pass an array of decisions to run them in sequence. Each runs on the state left by the ones before it, and all their events are appended in a single write:

<<< @./../packages/emmett/src/commandHandling/handleCommand.unit.spec.ts#sequential-handlers

## Control Which Decision Results Are Appended {#decision-middleware}

Suppose a command reports that a product is out of stock. You may need to return that outcome to the caller without appending it, or stop the remaining commands after appending the changes made so far.

You can configure a reusable rule on either `CommandHandler` or `DeciderCommandHandler`. The rule runs for each command outcome and chooses whether to append it, continue with the next command, or reject the whole batch. Outcomes that are not appended are still returned, so you can use them in the response.

Emmett calls these rules _decision middleware_. Use the helpers below for the common cases, or write custom middleware when you need different behavior.

The business logic remains responsible only for describing what happened. These decisions return ordinary cart events for unavailable stock, duplicate products, item limits, and failed payment authorization:

<<< @./../packages/emmett/src/commandHandling/handleCommand.middleware.unit.spec.ts#decision-handling-business-logic

The handler configuration below decides which of those events belong in the shopping-cart stream and whether the rest of a command batch should run.

<a id="reject-output"></a>

**Reject the complete batch**

Use `rejectOn` when none of the changes from the current call should be appended after a matching outcome. This configuration rejects the complete batch when a decision returns `ProductItemOutOfStock`:

<<< @./../packages/emmett/src/commandHandling/handleCommand.middleware.unit.spec.ts#command-handler-reject-on-setup

`rejectOn` leaves the cart unchanged and does not run later decisions. It still returns `ProductItemOutOfStock`, so the endpoint can use the available quantity to return status 409. Use this when the commands belong to one operation and a failure in any of them should cancel the whole operation. [Map Returned Events to Error Responses](/guides/error-handling#map-returned-events) shows the complete Express route.

If one command produces several events, they remain one unit. A match rejects all events produced by that command.

<a id="stop-output"></a>

**Commit earlier decisions and stop**

Use `stopOn` when earlier changes should be appended, but the matching outcome and later commands should not be. This configuration stops when payment authorization returns `ShoppingCartConfirmationFailed`:

<<< @./../packages/emmett/src/commandHandling/handleCommand.middleware.unit.spec.ts#command-handler-stop-on-setup

Use `stopOn` when earlier commands may stand on their own. The caller still receives `ShoppingCartConfirmationFailed`, so it can explain why processing stopped. Use `rejectOn` instead when those earlier changes must also be cancelled.

<a id="skip-output"></a>

**Skip one outcome and continue**

Use `skipOn` when you want to ignore the matching outcome and continue. This configuration skips `ProductItemAlreadyInCart` and runs the next decision:

<<< @./../packages/emmett/src/commandHandling/handleCommand.middleware.unit.spec.ts#command-handler-skip-on-setup

The caller receives `ProductItemAlreadyInCart`, but that event is not appended to the shopping-cart stream. Processing continues, and the confirmation sees a cart with one copy of the product.

<a id="stop-after-output"></a>

**Record a terminal failure and stop**

Use `stopAfter` when the matching outcome should be appended and no later command should run. This configuration appends `ShoppingCartItemLimitReached` before stopping:

<<< @./../packages/emmett/src/commandHandling/handleCommand.middleware.unit.spec.ts#command-handler-stop-after-setup

`ProductItemAdded` and `ShoppingCartItemLimitReached` are appended together. The third product decision does not run. `stopOn` would omit `ShoppingCartItemLimitReached`; `stopAfter` includes it.

<a id="throw-on-output"></a>

**Turn a produced event into an exception**

Use `throwOn` when the matching outcome should enter an existing exception-based error path, such as HTTP Problem Details mapping:

<<< @./../packages/emmett/src/commandHandling/handleCommand.middleware.unit.spec.ts#command-handler-before-all-throw-on

Nothing from the call is appended. Unlike `rejectOn`, `throwOn` does not return the matching event to the caller; the created error follows the application's exception-handling path.

<a id="before-all"></a>

**Check the complete input before handling**

Use `middleware.beforeAll` when a check should run once for the whole call instead of once per command. Request authorization is one example. It runs before the current state is read. If it throws, no commands run and nothing is appended.

For `CommandHandler`, it receives the decision or decision array. For `DeciderCommandHandler`, it receives the command or command array. For `WorkflowHandler`, it receives the input message. The second argument contains the resolved stream name and handle options.

Put checks that need a command or rebuilt state in `middleware.decision`. Pass the decision middleware array directly as `middleware` when `beforeAll` is not needed.

<a id="after-all"></a>

**Observe the completed result**

Use `middleware.afterAll` when a measurement or notification should describe the completed operation rather than each command separately. It receives the final result, so it can record values such as the number of appended events or the resulting stream version. The decider example below records the appended-event count.

Do not use `afterAll` for validation or for anything that must prevent the append. The operation has already completed, so an error from this callback cannot undo it. Use the event-store hooks when you need to observe each store commit rather than the completed handler result.

<a id="decider-middleware"></a>

**Use middleware with `DeciderCommandHandler`**

The handling choices shown above work the same way with `CommandHandler` and `DeciderCommandHandler`. The difference is what each middleware receives. Raw command handling supplies the current state because the command is captured by the decision function. `DeciderCommandHandler` supplies the command and current state, so a shared handler can authorize or measure commands without wrapping every call.

Use `before` for work before `decide`, and `after` for work based on its result:

<<< @./../packages/emmett/src/commandHandling/handleCommandWithDecider.middleware.unit.spec.ts#decider-command-middleware

Callbacks may omit state, as `authorizeCommand` does here. Accept it as the second argument when needed: `before((command, state) => ...)`. Decision middleware runs again on concurrency retry.

<a id="custom-decision-middleware"></a>

**Write custom decision middleware**

Use custom middleware when one handler needs several handling rules or when a helper predicate is not enough. The middleware receives `next`, calls it with the command and current state, then returns the handling selected for the produced outcome:

<<< @./../packages/emmett/src/commandHandling/handleCommandWithDecider.middleware.unit.spec.ts#custom-decision-middleware

This middleware uses the same rules as the preceding examples:

- `ProductItemAlreadyInCart` is returned but not appended, and the next command runs.
- `ShoppingCartConfirmationFailed` is returned without being appended; earlier changes are appended and later commands do not run.
- `ProductItemOutOfStock` rejects the complete command batch.
- `ShoppingCartItemLimitReached` is appended before the remaining commands are stopped.
- Other outcomes keep the default append-and-continue behavior returned by `next`.

The first configured middleware is the outermost wrapper. Put authorization or timing middleware before outcome-selection middleware when it must observe the complete decision call.

## Control Concurrency {#concurrency}

By default the handler reuses the version it read from the stream, so you do not pass one and concurrent writers cannot overwrite each other:

<<< @./../packages/emmett/src/commandHandling/handleCommand.unit.spec.ts#automatic-version

### Guard with a client's version {#explicit-version}

When the version comes from outside, such as a client's `If-Match` header, pass it as `expectedStreamVersion`. The append then succeeds only if the stream is still at that version:

<<< @./../packages/emmett/src/commandHandling/handleCommand.unit.spec.ts#explicit-version

### Create a stream exactly once {#create-once}

Pass `STREAM_DOES_NOT_EXIST` so the append succeeds only when the stream does not exist yet:

<<< @./../packages/emmett/src/commandHandling/handleCommand.unit.spec.ts#require-new-stream

A stale version throws `ExpectedVersionConflictError`. See [Optimistic Concurrency](/api-reference/commandhandler#optimistic-concurrency) in the reference for the full behaviour.

## Retry on Conflict {#retry}

Set `retry` so Emmett re-runs the handler when a version conflict occurs. `{ onVersionConflict: true }` applies the default policy:

<<< @./../packages/emmett/src/commandHandling/handleCommand.unit.spec.ts#retry-on-conflict

For a different backoff, or to retry on errors other than version conflicts, pass your own `shouldRetryError`:

<<< @./../packages/emmett/src/commandHandling/handleCommand.unit.spec.ts#custom-retry

### Make decision middleware retry-safe {#middleware-retry}

`beforeAll` runs once before retry processing. Decision middleware and the decision run again for every attempt:

<<< @./../packages/emmett/src/commandHandling/handleCommand.middleware.unit.spec.ts#command-middleware-retry

The caller receives only the outcome of the attempt that completes. Any external work performed by decision middleware may run more than once, so make it safe to repeat. Use `beforeAll` for a check that must run once and does not need the rebuilt state. `afterAll` runs once after an attempt completes and receives its final result.

## Make It Idempotent {#idempotence}

**The same command can reach the handler twice.** A shopper double-clicks "Add to cart", a request times out and the browser sends it again, a [retry](#retry) re-runs it after a conflict. Handling it twice shouldn't add the product twice, and two things you already have keep it safe.

First, a decision that returns `[]` once its outcome is already in the state. Cancelling a cart that is already cancelled, for instance, has nothing left to do:

<<< @./../packages/emmett/src/commandHandling/handleCommand.unit.spec.ts#empty-array-no-op

Resending the command is then a no-op: the second call appends nothing and returns the version unchanged.

<<< @./../packages/emmett/src/commandHandling/handleCommand.unit.spec.ts#idempotent-resend

Second, [optimistic concurrency](#concurrency). When you carry the version, a duplicate write that lost the race fails with `ExpectedVersionConflictError` instead of appending twice, and `STREAM_DOES_NOT_EXIST` makes stream creation happen exactly once. The no-op decision and the version guard together make a resent command safe.

## Integrate with Express {#express}

`emmett-expressjs` wraps a handler with `on`. Fetch any data the decision needs, such as the unit price, before calling the handler and pass it into the command, which keeps the decision pure. The first write creates the stream:

<<< @/snippets/gettingStarted/webApi/simpleApi.ts#add-product-item-endpoint{17,23-25}

When decision middleware returns a business failure, use `ResponseFromEvents` to return the response expected by Express `on` without assuming the failure is the final event. The `failure` callback returns an ordinary response helper such as `Conflict(...)`. If no event selects a failure response, `success` may be a status code or a callback returning `NoContent(...)`, `Created(...)`, or another response helper. The callback receives the complete handler result when headers such as an ETag depend on it:

<<< @./../packages/emmett-expressjs/src/responses.int.spec.ts#express-response-from-events-route

### Carry the version in an ETag {#etag}

To expose optimistic concurrency over HTTP, read the client's version from the `If-Match` header with `getETagValueFromIfMatch`, pass it as `expectedStreamVersion`, and return the new version with `toWeakETag`. A stale `If-Match` maps to HTTP 412 Precondition Failed:

<<< @./../packages/emmett-expressjs/src/e2e/commandHandler/api.ts#etag-command-handler

## Best Practices {#best-practices}

### Keep the Decision Pure {#keep-pure}

A decision that only reads state and returns events is easy to test and safe to retry. When it needs external data, such as a price or an exchange rate, fetch it before the handler and pass it in. Avoid I/O inside the decision: on a version conflict the whole handler re-runs, so the call fires again on every retry:

<<< @./../packages/emmett/src/commandHandling/handleCommand.unit.spec.ts#async-handler

### Type Events as a Discriminated Union {#type-events}

Declare your events as a discriminated union and pass it as the handler's `StreamEvent`. `evolve` and every decision are then checked against it, and unknown event types surface at compile time:

<<< @./../packages/emmett/src/commandHandling/handleCommand.unit.spec.ts#event-union

## Troubleshooting {#troubleshooting}

### Version Conflict on Every Write {#always-conflicts}

If every write throws `ExpectedVersionConflictError`, the expected version you pass is stale. When you track the version yourself, pass the `nextExpectedStreamVersion` from the previous result into the next call. When a client supplies it, return the new version as an ETag so the next request carries the current one. To let Emmett recover on its own, set [`retry`](#retry).

### Nothing Is Appended {#nothing-appended}

If a command runs without error yet no events land, the decision returned an empty array. That is the no-op path, taken when the state leaves nothing to do, such as confirming an already-confirmed cart. Check the guard that returns `[]`.

### A Side Effect Fires Twice {#double-side-effect}

If an external call inside a decision fires more than once, a version conflict retried the handler and re-ran the decision. Move the I/O out of the decision and pass its result in, as [Keep the Decision Pure](#keep-pure) shows.

## Further Readings {#readings}

- [Getting Started - Command Handling](/getting-started#command-handling)
- [API Reference: Command Handler](/api-reference/commandhandler)
- [API Reference: Command](/api-reference/command)
- [Decider Pattern](/api-reference/decider)
- [Event Store](/api-reference/eventstore)
- [Error Handling](/guides/error-handling)
- [Testing](/guides/testing)
- [Optimistic Concurrency for Pessimistic Times](https://event-driven.io/en/optimistic_concurrency_for_pessimistic_times/)
