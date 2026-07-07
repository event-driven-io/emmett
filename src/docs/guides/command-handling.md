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

## Integrate with Express {#express}

`emmett-expressjs` wraps a handler with `on`. Fetch any data the decision needs, such as the unit price, before calling the handler and pass it into the command, which keeps the decision pure. The first write creates the stream:

<<< @/snippets/gettingStarted/webApi/simpleApi.ts#add-product-item-endpoint{17,23-25}

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
