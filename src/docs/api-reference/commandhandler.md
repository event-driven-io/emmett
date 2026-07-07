---
documentationType: reference
outline: deep
---

# Command Handler

## Overview

`CommandHandler` processes a command against a single event stream. Each call builds the current state from the stream's events with `evolve` and `initialState`, runs the decision, and appends the events it returns under an optimistic concurrency check.

It builds on the event store's [`aggregateStream`](/api-reference/eventstore#aggregatestream) and [`appendToStream`](/api-reference/eventstore#appendtostream). The [Decider](/api-reference/decider) keeps `decide`, `evolve`, and `initialState` together as a single object. For setup and usage, see the [Command Handling](/guides/command-handling) guide.

## Construction

`CommandHandler(options)` returns the handler function. It takes three type parameters: `State`, `StreamEvent` (the discriminated union written to the stream), and an optional `EventPayloadType` (the stored shape when it differs from `StreamEvent`, used with schema versioning).

<<< @/snippets/gettingStarted/commandHandler.ts#command-handler

### CommandHandlerOptions

| Property               | Type                                          | Description                                                                        |
| ---------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------- |
| `evolve`               | `(state: State, event: StreamEvent) => State` | Applies an event to the state, returning the next state. Required.                 |
| `initialState`         | `() => State`                                 | Starting state for a stream with no events. Required.                              |
| `mapToStreamId`        | `(id: string) => string`                      | Maps the business id to the stream name. Defaults to the identity function.        |
| `retry`                | `CommandHandlerRetryOptions`                  | Retry policy for version conflicts. See [Retry](#retry).                           |
| `schema.versioning`    | `{ upcast?; downcast? }`                      | Converts stored events to and from `StreamEvent`. See [Advanced](#advanced).       |
| `serialization`        | `{ serializer?; serializerOptions? }`         | Custom serialiser for reading and writing events. See [Advanced](#advanced).       |
| `name` / `commandType` | `string` / `string \| string[]`               | Labels used for observability and as the default command type when none is passed. |
| `observability`        | `CommandObservabilityConfig`                  | Tracing and metrics configuration. See [Advanced](#advanced).                      |

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
| `newState`                  | `State`                                             | State after applying the produced events.                    |
| `newEvents`                 | `StreamEvent[]`                                     | Events appended, empty when the decision produced none.      |
| `nextExpectedStreamVersion` | `StreamPosition` (`bigint` for the built-in stores) | Version to pass as `expectedStreamVersion` on the next call. |
| `createdNewStream`          | `boolean`                                           | Whether this call created the stream.                        |

`nextExpectedStreamVersion` and `createdNewStream` come from the store in use, so their exact type depends on it.

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

Left `undefined`, retries are disabled. A per-call `retry` in the handle options overrides the handler-level policy.

The default policy retries only on `ExpectedVersionConflictError`:

| Field        | Value    |
| ------------ | -------- |
| `retries`    | `3`      |
| `minTimeout` | `100` ms |
| `factor`     | `1.5`    |

<<< @./../packages/emmett/src/commandHandling/handleCommand.unit.spec.ts#retry-on-conflict

<<< @./../packages/emmett/src/commandHandling/handleCommand.unit.spec.ts#custom-retry

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

### Schema versioning

`schema.versioning.upcast` maps a stored event to the current `StreamEvent` shape on read; `schema.versioning.downcast` maps a `StreamEvent` back to its stored shape on write. Together they carry a stream through event schema evolution.

### Serialization

`serialization.serializer` replaces the default JSON serialiser used to read and write events; `serialization.serializerOptions` configures the default one.

### Observability

`name` labels the handler in traces and metrics. `commandType` sets the default command type used when a call passes none. `observability` (`CommandObservabilityConfig`) configures tracing and metrics for the handler.

## Type Source

For the full signatures, see [`handleCommand.ts`](https://github.com/event-driven-io/emmett/blob/main/src/packages/emmett/src/commandHandling/handleCommand.ts) in the source.

## See also {#see-also}

- [Command Handling](/guides/command-handling)
- [Getting Started - Command Handling](/getting-started#command-handling)
- [Command](/api-reference/command)
- [Decider Pattern](/api-reference/decider)
- [Event Store](/api-reference/eventstore)
- [Error Handling](/guides/error-handling)
- [Optimistic Concurrency for Pessimistic Times](https://event-driven.io/en/optimistic_concurrency_for_pessimistic_times/)
