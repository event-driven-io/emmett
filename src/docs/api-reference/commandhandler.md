---
documentationType: reference
outline: deep
---

# Command Handler

## Overview

A command handler processes a command against a single event stream. The command is an intention, such as adding an item to a cart; your business logic decides what should happen; the events it returns are the outcome that gets stored.

Use it whenever a command writes to a single stream. It saves you from repeating this flow by hand, and it applies the optimistic concurrency check that stops two commands on the same stream from overwriting each other.

On each call it loads the stream and folds its events into the current state with `evolve` and `initialState`, runs your decision function, and appends the returned events using the version it read as the expected version. It builds on the event store's [`aggregateStream`](/api-reference/eventstore#aggregatestream) and [`appendToStream`](/api-reference/eventstore#appendtostream); when you'd rather keep `decide`, `evolve`, and `initialState` together as one object, the [Decider](/api-reference/decider) is the more structured alternative.

## Basic Usage

Configure a handler once with `evolve` and `initialState`, then reuse it across the app, calling it for each command with a stream id and one or more decision functions.

### Creating a handler {#create}

<<< @/snippets/gettingStarted/commandHandler.ts#command-handler

### Handling a command {#handle}

<<< @/snippets/gettingStarted/commandHandling.ts#command-handling

## Type Definitions

`CommandHandler` takes three type parameters: `State`, `StreamEvent` (the discriminated union written to the stream), and an optional `EventPayloadType` (the stored shape when it differs from `StreamEvent`, used with schema versioning). It returns an async function whose third argument is either a single handler or an **array** of handlers. The full signatures are shown under [Type Source](#type-source); the tables below summarise them.

### CommandHandlerOptions

| Property               | Type                                          | Description                                                                        |
| ---------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------- |
| `evolve`               | `(state: State, event: StreamEvent) => State` | Folds an event into state. Required.                                               |
| `initialState`         | `() => State`                                 | Starting state for a stream with no events. Required.                              |
| `mapToStreamId`        | `(id: string) => string`                      | Maps the business id to the stream name. Defaults to the identity function.        |
| `retry`                | `CommandHandlerRetryOptions`                  | Retry policy for version conflicts. See [Retry Configuration](#retries).           |
| `schema.versioning`    | `{ upcast?; downcast? }`                      | Converts stored events to and from `StreamEvent` for schema evolution.             |
| `serialization`        | `{ serializer?; ... }`                        | Custom serialiser for reading and writing events.                                  |
| `name` / `commandType` | `string` / `string \| string[]`               | Labels used for observability and as the default command type when none is passed. |
| `observability`        | `CommandObservabilityConfig`                  | Tracing and metrics configuration.                                                 |

### CommandHandlerResult

Each call returns the new state, the events it appended, and the version to pass on the next call. For the stores shipped with Emmett:

| Property                    | Type                                                | Description                                                      |
| --------------------------- | --------------------------------------------------- | ---------------------------------------------------------------- |
| `newState`                  | `State`                                             | State after applying the newly produced events.                  |
| `newEvents`                 | `StreamEvent[]`                                     | Events that were appended, empty when the handler produced none. |
| `nextExpectedStreamVersion` | `StreamPosition` (`bigint` for the built-in stores) | Pass this as `expectedStreamVersion` on the next call.           |
| `createdNewStream`          | `boolean`                                           | Whether this call created the stream.                            |

`nextExpectedStreamVersion` and `createdNewStream` come from the store you're using, so their exact type depends on it.

## Stream ID Mapping

The id you pass to the handler is not always the stream's name. A cart id, for example, might map to a stream named `shopping_cart:{id}`. Set `mapToStreamId` to build the stream name from the id; you keep passing the business id, and the handler applies the mapping.

<<< @./../packages/emmett/src/commandHandling/handleCommand.unit.spec.ts#stream-id-mapping

## Handler Functions

A handler receives the current state and returns one or more events to append.

### Single event {#single-event}

A decision that produces one outcome returns a single event:

<<< @./../packages/emmett/src/commandHandling/handleCommand.unit.spec.ts#single-event-decision

The handler appends it and reports the new state:

<<< @./../packages/emmett/src/commandHandling/handleCommand.unit.spec.ts#single-event

### Multiple events {#multiple-events}

Return an array when a decision produces several events:

<<< @./../packages/emmett/src/commandHandling/handleCommand.unit.spec.ts#multiple-events-decision

The call is unchanged; the events are appended in a single operation, so the stream cannot be left holding only some of them:

<<< @./../packages/emmett/src/commandHandling/handleCommand.unit.spec.ts#multiple-events

### Sequential handlers {#sequential-handlers}

Pass an array of handlers to run several decisions in order. Each runs on the state produced by the handlers before it, and all their events are appended in a single write:

<<< @./../packages/emmett/src/commandHandling/handleCommand.unit.spec.ts#sequential-handlers

## Optimistic Concurrency

The handler keeps the version it read from the stream and requires the stream to still be at that version when it appends. If another writer has changed the stream in between, the append fails with `ExpectedVersionConflictError` (a `ConcurrencyError`) instead of overwriting their events.

### Automatic version tracking {#automatic-version}

By default the handler reuses the version it read, so you don't need to pass one:

<<< @./../packages/emmett/src/commandHandling/handleCommand.unit.spec.ts#automatic-version

`nextExpectedStreamVersion` in the result is the stream's version after this append. The [ETag concurrency](#etag) example returns it to the client, which sends it back to guard its next write.

### Explicit version {#explicit-version}

Pass `expectedStreamVersion` when the version to check comes from outside the handler, such as a client's `If-Match` header. The append then succeeds only if the stream is still at that version:

<<< @./../packages/emmett/src/commandHandling/handleCommand.unit.spec.ts#explicit-version

### New-stream requirement {#require-new-stream}

Pass `STREAM_DOES_NOT_EXIST` as the expected version so the append succeeds only if the stream does not exist yet. This enforces that the stream is created exactly once:

<<< @./../packages/emmett/src/commandHandling/handleCommand.unit.spec.ts#require-new-stream

## Retry Configuration {#retries}

Set `retry` so Emmett re-runs the handler when a version conflict occurs.

`{ onVersionConflict: true }` applies Emmett's default conflict policy (**3 retries, a 100&nbsp;ms minimum timeout, and a 1.5× backoff factor**), retrying only on `ExpectedVersionConflictError`:

<<< @./../packages/emmett/src/commandHandling/handleCommand.unit.spec.ts#retry-on-conflict

Pass a number (`{ onVersionConflict: 5 }`) to keep that policy but change the retry count. For full control, such as a different backoff or retrying on errors other than version conflicts, pass `AsyncRetryOptions` with your own `shouldRetryError`:

<<< @./../packages/emmett/src/commandHandling/handleCommand.unit.spec.ts#custom-retry

You can also set `retry` per call in the handle options, which overrides the handler-level policy for that call.

## No-Op Handling

A decision returns an empty array when the current state leaves it nothing to do. Confirming a cart that is already confirmed is the common case:

<<< @./../packages/emmett/src/commandHandling/handleCommand.unit.spec.ts#confirm-decision

The handler then appends nothing and returns the current version with `newEvents: []` and `createdNewStream: false`, so re-sending the command is safe:

<<< @./../packages/emmett/src/commandHandling/handleCommand.unit.spec.ts#no-op

## Error Handling

### Business-rule errors {#business-errors}

If a command breaks a business rule, throw from the decision: `IllegalStateError` for an invalid state transition, `ValidationError` for bad input. Nothing gets appended, and the error reaches the caller unchanged:

<<< @./../packages/emmett/src/commandHandling/handleCommand.unit.spec.ts#business-error

### Concurrency errors {#concurrency-errors}

A version conflict throws `ExpectedVersionConflictError`, which extends `ConcurrencyError`. Both carry the `expected` and `current` versions as strings, so you can report what happened to the caller:

<<< @./../packages/emmett/src/commandHandling/handleCommand.unit.spec.ts#concurrency-error

## Integration with Web Frameworks

### Express.js {#express}

`emmett-expressjs` wraps a handler with `on`: call the command handler, then return a response helper. Fetch any data the decision needs, such as the unit price, **before** calling the handler and pass it into the command; this keeps the decision pure. The first write creates the stream:

<<< @/snippets/gettingStarted/webApi/simpleApi.ts#add-product-item-endpoint{17,23-25}

### ETag concurrency {#etag}

To expose optimistic concurrency over HTTP, carry the version in a weak ETag. Read the client's version from the `If-Match` header with `getETagValueFromIfMatch`, pass it as `expectedStreamVersion`, and return the new version via `toWeakETag(result.nextExpectedStreamVersion)`:

<<< @./../packages/emmett-expressjs/src/e2e/commandHandler/api.ts#etag-command-handler

A stale `If-Match` makes the handler throw `ExpectedVersionConflictError`, which `emmett-expressjs` maps to **HTTP 412 Precondition Failed**.

## Best Practices {#best-practices}

### Keep the Decision Pure {#best-practices-keep-pure}

A handler that only reads state and returns events is easy to test and safe to retry. When a decision needs external data, such as a price or an exchange rate, fetch it **before** the handler and pass it in, as the [Express.js example](#express) does with the unit price.

The handler can be `async`, and Emmett awaits it. Avoid I/O inside it, because on a version conflict the whole handler re-runs, so the call is made again on every retry:

<<< @./../packages/emmett/src/commandHandling/handleCommand.unit.spec.ts#async-handler

### Guard Before Deciding {#best-practices-guard-first}

Throw `IllegalStateError` or `ValidationError` before building any event, so an invalid command never produces one. The [`confirm` decision](#no-op-handling) does this: it refuses to confirm an empty cart. See [Error Handling](#error-handling) for how those errors reach the caller.

### Type Events as a Discriminated Union {#best-practices-type-events}

Declare your events as a discriminated union and pass it as `CommandHandler`'s `StreamEvent`:

<<< @./../packages/emmett/src/commandHandling/handleCommand.unit.spec.ts#event-union

`evolve` and every handler's return value are then checked against that union, and unknown event types surface at compile time.

## Type Source

For the full signatures, see [`handleCommand.ts`](https://github.com/event-driven-io/emmett/blob/main/src/packages/emmett/src/commandHandling/handleCommand.ts) in the source.

## See also {#see-also}

- [Getting Started - Command Handling](/getting-started#command-handling)
- [Command](/api-reference/command)
- [Decider Pattern](/api-reference/decider)
- [Event Store](/api-reference/eventstore)
- [Error Handling](/guides/error-handling)
- [Optimistic Concurrency for Pessimistic Times](https://event-driven.io/en/optimistic_concurrency_for_pessimistic_times/)
