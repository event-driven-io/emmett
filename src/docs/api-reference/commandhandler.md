---
documentationType: reference
outline: deep
---

# Command Handler

## Overview

`CommandHandler` processes a command against a single event stream. Each call builds the current state from the stream's events with `evolve` and `initialState`, runs the decision, and appends the events it returns under an optimistic concurrency check.

It builds on the event store's [`aggregateStream`](/api-reference/eventstore#aggregatestream) and [`appendToStream`](/api-reference/eventstore#appendtostream). The [Decider](/api-reference/decider) keeps `decide`, `evolve`, and `initialState` together as a single object. For setup and usage, see the [Command Handling](/guides/command-handling) guide.

## Construction

`CommandHandler(options)` returns the handler function. It takes three type parameters: `State`, `StreamEvent` (the discriminated union written to the stream), and an optional `StoredEvent` (the stored shape when it differs from `StreamEvent`, used with schema versioning).

<<< @/snippets/gettingStarted/commandHandler.ts#command-handler

`DeciderCommandHandler(options)` takes four: `State`, `CommandType`, `StreamEvent`, and an optional `StoredEvent`. On both handlers `StoredEvent` defaults to `StreamEvent`, so leaving it out types `schema.versioning.upcast` as if stored events already had the current shape. See [Schema versioning](#schema-versioning).

### CommandHandlerOptions

| Property               | Type                                                   | Description                                                                                   |
| ---------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `evolve`               | `(state: State, event: StreamEvent) => State`          | Applies an event to the state, returning the next state. Required.                            |
| `initialState`         | `() => State`                                          | Starting state for a stream with no events. Required.                                         |
| `mapToStreamId`        | `(id: string) => string`                               | Maps the business id to the stream name. Defaults to the identity function.                   |
| `retry`                | `CommandHandlerRetryOptions`                           | Retry policy for version conflicts. See [Retry](#retry).                                      |
| `schema.versioning`    | `{ upcast?; downcast? }`                               | Converts stored events to and from `StreamEvent`. See [Advanced](#advanced).                  |
| `serialization`        | `{ serializer?; serializerOptions? }`                  | Custom serialiser for reading and writing events. See [Advanced](#advanced).                  |
| `name` / `commandType` | `string` / `string \| string[]`                        | Labels used for observability and as the default command type when none is passed.            |
| `observability`        | `CommandObservabilityConfig`                           | Tracing and metrics configuration. See [Advanced](#advanced).                                 |
| `middleware`           | `Middleware[] \| { beforeAll?; afterAll?; decision? }` | Configures invocation-wide and per-decision middleware. An array is shorthand for `decision`. |

## Calling the Handler

The handler is called as `handle(eventStore, id, decision, options?)`, with the event store, the business id, the decision, and optional per-call options. The third argument is a single decision or an array of decisions run in order (see [Decisions](#decisions)).

### HandleOptions

| Property                | Type                         | Description                                                                                                     |
| ----------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `expectedStreamVersion` | `ExpectedStreamVersion`      | Version the stream must be at for the append to succeed. Defaults to the version read at the start of the call. |
| `retry`                 | `CommandHandlerRetryOptions` | Retry policy for this call. Overrides the handler-level `retry`.                                                |

## Decisions

A decision receives the current state and returns the events to append. It returns a single event, an array of events, or an empty array when there is nothing to append, and throws to reject the command. It may be synchronous or asynchronous, returning the events or a `Promise` of them.

A single event:

<<< @./../packages/emmett/src/commandHandling/handleCommand.unit.spec.ts#single-event-decision

Several events, appended in one write so the stream is never left holding only some of them:

<<< @./../packages/emmett/src/commandHandling/handleCommand.unit.spec.ts#multiple-events-decision

An array of decisions runs in order. Each receives the state left by the previous one, and all their events are appended in a single write:

<<< @./../packages/emmett/src/commandHandling/handleCommand.unit.spec.ts#sequential-handlers

An empty array is a no-op. The decision returns it when the current state leaves nothing to do:

<<< @./../packages/emmett/src/commandHandling/handleCommand.unit.spec.ts#empty-array-no-op

## Result

Each call resolves to `CommandHandlerResult`:

| Property                    | Type                                                | Description                                                  |
| --------------------------- | --------------------------------------------------- | ------------------------------------------------------------ |
| `newState`                  | `State`                                             | State after applying the appended events.                    |
| `events`                    | `StreamEvent[]`                                     | Every event produced by decisions that ran.                  |
| `appendedEvents`            | `StreamEvent[]`                                     | Events persisted by this call.                               |
| `newEvents`                 | `StreamEvent[]`                                     | Deprecated alias of `appendedEvents`.                        |
| `nextExpectedStreamVersion` | `StreamPosition` (`bigint` for the built-in stores) | Version to pass as `expectedStreamVersion` on the next call. |
| `createdNewStream`          | `boolean`                                           | Whether this call created the stream.                        |

`nextExpectedStreamVersion` and `createdNewStream` come from the store in use, so their exact type depends on it.

## Decision Middleware

Ordinary decision results are treated as `APPEND`. Middleware can change how a complete decision result is handled with `skipOn`, `stopOn`, `rejectOn`, `stopAfter`, or a custom middleware. A predicate may inspect individual events, but a match always applies to every event returned by that decision.

- `APPEND` stages and evolves the events, then continues.
- `SKIP` exposes the events in `events` without staging or evolving them, then continues.
- `STOP` discards the current events, commits earlier staged events, and stops.
- `REJECT` discards every staged event, restores the state from before the batch, and stops.
- `APPEND_AND_STOP` stages and evolves the current events, then commits and stops.

`SKIP`, `STOP`, `REJECT`, and `APPEND_AND_STOP` return normally; they do not throw. Produced events remain in `events` even when they are not present in `appendedEvents`. `throwOn` is the exception-producing helper.

<<< @./../packages/emmett/src/commandHandling/handleCommand.middleware.unit.spec.ts#command-handler-before-all-throw-on

### Configuration

`middleware` accepts a decision middleware array or an object:

| Form                                     | Behavior                                              |
| ---------------------------------------- | ----------------------------------------------------- |
| `middleware: Middleware[]`               | Applies the array to every decision.                  |
| `middleware: { decision: Middleware[] }` | Equivalent to the array form.                         |
| `middleware: { beforeAll, decision }`    | Runs `beforeAll` once before aggregation/retries.     |
| `middleware: { afterAll, decision }`     | Runs `afterAll` once after the successful invocation. |

`beforeAll` receives the complete handler input and an operation context containing `streamName` and `handleOptions`. Raw `CommandHandler` supplies the decision or decision array. `DeciderCommandHandler` supplies the command or command array. `WorkflowHandler` supplies the input message.

`afterAll` receives the final handler result and the operation context. Both lifecycle callbacks run outside retry processing. `afterAll` runs only after a successful invocation; throwing from it does not roll back events or messages that were already appended.

Decision middleware runs for every decision and every retry attempt. Its arguments depend on the handler:

| Handler                 | First argument | Second argument |
| ----------------------- | -------------- | --------------- |
| `CommandHandler`        | Current state  | None            |
| `DeciderCommandHandler` | Command        | Current state   |
| `WorkflowHandler`       | Input message  | Current state   |

### Helpers

| Helper                    | Matching behavior                                               |
| ------------------------- | --------------------------------------------------------------- |
| `before(callback)`        | Runs `callback` before the decision.                            |
| `after(callback)`         | Runs `callback` with the handling result after the decision.    |
| `skipOn(predicate)`       | Returns `SKIP`.                                                 |
| `stopOn(predicate)`       | Returns `STOP`.                                                 |
| `rejectOn(predicate)`     | Returns `REJECT`.                                               |
| `stopAfter(predicate)`    | Returns `APPEND_AND_STOP`.                                      |
| `throwOn(predicate, map)` | Throws the error created by `map` before the batch is appended. |

A helper predicate runs for each output. If one output matches, the helper applies its result to every output returned by that decision.

### Custom middleware

Custom middleware can inspect the input, state, and result before selecting how the decision is handled:

<<< @./../packages/emmett/src/commandHandling/handleCommandWithDecider.middleware.unit.spec.ts#custom-decision-middleware

Use `afterAll` for logging, metrics or other measurements that need the returned result. Use event-store hooks for commit instrumentation that must reflect storage-level behavior.

When the decision returns an empty array, nothing is appended and the result carries `newEvents: []`, `createdNewStream: false`, and the current version:

<<< @./../packages/emmett/src/commandHandling/handleCommand.unit.spec.ts#no-op

## Stream ID Mapping

`mapToStreamId` derives the stream name from the business id; the business id is still passed to the decision. It defaults to the identity function.

<<< @./../packages/emmett/src/commandHandling/handleCommand.unit.spec.ts#stream-id-mapping

## Optimistic Concurrency

The handler appends with an expected version and fails with `ExpectedVersionConflictError` (a `ConcurrencyError`) when the stream has moved on since it was read.

### Version read from the stream {#read-version}

With no `expectedStreamVersion` passed, the handler expects the version it read from the stream at the start of the call. `nextExpectedStreamVersion` in the result is the version after the append.

<<< @./../packages/emmett/src/commandHandling/handleCommand.unit.spec.ts#automatic-version

### Explicit expected version {#explicit-expected-version}

`expectedStreamVersion` sets the expected version explicitly, such as one carried in a client's `If-Match` header. The append succeeds only if the stream is still at that version.

<<< @./../packages/emmett/src/commandHandling/handleCommand.unit.spec.ts#explicit-version

### Expecting a new stream {#new-stream}

`STREAM_DOES_NOT_EXIST` as the expected version makes the append succeed only if the stream does not exist yet.

<<< @./../packages/emmett/src/commandHandling/handleCommand.unit.spec.ts#require-new-stream

## Retry

`retry` re-runs the decision and append when a version conflict is retryable. `CommandHandlerRetryOptions` takes three forms:

- `{ onVersionConflict: true }` applies the default policy.
- `{ onVersionConflict: number }` applies the default policy with a different retry count.
- `AsyncRetryOptions` is a full custom policy, including its own `shouldRetryError`.

Left `undefined`, retries are disabled. A per-call `retry` in the handle options overrides the handler-level policy. For deciding which errors are transient enough to retry, see [Retry a Transient Failure](/guides/error-handling#retry) in the Error Handling guide.

The default policy retries only on `ExpectedVersionConflictError`:

| Field        | Value    |
| ------------ | -------- |
| `retries`    | `3`      |
| `minTimeout` | `100` ms |
| `factor`     | `1.5`    |

<<< @./../packages/emmett/src/commandHandling/handleCommand.unit.spec.ts#retry-on-conflict

<<< @./../packages/emmett/src/commandHandling/handleCommand.unit.spec.ts#custom-retry

## Idempotence {#idempotence}

Re-running a command does not duplicate its effect. Two behaviours combine:

- A decision returns an empty array once its outcome is already present in the state, so a repeat appends nothing. See [Decisions](#decisions).
- Optimistic concurrency rejects a stale write. A retry carrying the version from before the first append, or `STREAM_DOES_NOT_EXIST` for a creation, fails with `ExpectedVersionConflictError` rather than appending twice. See [Optimistic Concurrency](#optimistic-concurrency).

The handler keeps no deduplication store and no idempotency key; idempotence comes from the decision and the expected version.

## Error Handling

A decision throws to reject a command; the handler appends nothing and propagates the error unchanged. A version conflict is thrown by the append.

| Error                                               | Code  | Raised when                                                                |
| --------------------------------------------------- | ----- | -------------------------------------------------------------------------- |
| `ValidationError`                                   | `400` | The command carries invalid input.                                         |
| `IllegalStateError`                                 | `403` | The command is not valid for the current state.                            |
| `ExpectedVersionConflictError` (`ConcurrencyError`) | `412` | The stream moved on; carries `expected` and `current` versions as strings. |

<<< @./../packages/emmett/src/commandHandling/handleCommand.unit.spec.ts#business-error

<<< @./../packages/emmett/src/commandHandling/handleCommand.unit.spec.ts#concurrency-error

## Advanced

### Schema versioning {#schema-versioning}

`schema.versioning.upcast` maps a stored event to the current `StreamEvent` shape on read; `schema.versioning.downcast` maps a `StreamEvent` back to its stored shape on write. Together they carry a stream through event schema evolution.

Pass the stored shape as the last type parameter — `StoredEvent`, on either handler — so both callbacks are checked against it. It defaults to `StreamEvent`, which is only correct while the stored and current shapes still match.

<<< @./../packages/emmett/src/commandHandling/handleCommandWithDecider.versioning.unit.spec.ts#decider-upcasting

### Serialization

`serialization.serializer` replaces the default JSON serialiser used to read and write events; `serialization.serializerOptions` configures the default one.

### Observability

`name` labels the handler in traces and metrics. `commandType` sets the default command type used when a call passes none. `observability` (`CommandObservabilityConfig`) configures tracing and metrics for the handler.

## Type Source

For the full signatures, see [`handleCommand.ts`](https://github.com/event-driven-io/emmett/blob/main/src/packages/emmett/src/commandHandling/handleCommand.ts) and [`handleCommandWithDecider.ts`](https://github.com/event-driven-io/emmett/blob/main/src/packages/emmett/src/commandHandling/handleCommandWithDecider.ts) in the source.

## See also {#see-also}

- [Command Handling](/guides/command-handling)
- [Getting Started - Command Handling](/getting-started#command-handling)
- [Command](/api-reference/command)
- [Decider Pattern](/api-reference/decider)
- [Event Store](/api-reference/eventstore)
- [Error Handling](/guides/error-handling)
- [Optimistic Concurrency for Pessimistic Times](https://event-driven.io/en/optimistic_concurrency_for_pessimistic_times/)
