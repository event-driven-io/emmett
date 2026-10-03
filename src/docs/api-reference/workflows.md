---
documentationType: reference
outline: deep
---

# Workflows

## Overview

A workflow coordinates a business process that spans more than one stream. Its inputs and outputs are commands and events, and its state is rebuilt from the messages its own stream holds.

`WorkflowHandler` runs one instance against that stream, which serves as both its inbox and its outbox: a call records the input it was given together with the outputs the decision returned, in a single append. `workflowProcessor` wires the handler into a consumer, so inputs arrive from the message store and recorded outputs reach an output handler.

It builds on the event store's [`aggregateStream`](/api-reference/eventstore#aggregatestream) and [`appendToStream`](/api-reference/eventstore#appendtostream), and takes the same decision middleware as the [Command Handler](/api-reference/commandhandler#decision-middleware).

The pattern comes from [Yves Reynhout's The Workflow Pattern](https://blog.bittacklr.be/the-workflow-pattern.html), adapted to Emmett's abstractions. For building one, see the [Workflows](/guides/workflows) guide.

## Type Definitions

### Workflow

```typescript
type Workflow<Input, State, Output, Name extends string = string> = {
  name: Name;
  decide: (input: Input, state: State) => WorkflowOutput<Output>;
  evolve: (currentState: State, event: WorkflowEvent<Input | Output>) => State;
  initialState: () => State;
};
```

| Property       | Type                                                             | Description                                                                                                        |
| -------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `name`         | `string`                                                         | Identifies the workflow. Used in the stream name, the default processor id, and the prefix given to stored inputs. Required. |
| `decide`       | `(input: Input, state: State) => WorkflowOutput<Output>`         | The decision run for one input. See [Decisions](#decisions). Required.                                                      |
| `evolve`       | `(state: State, event: WorkflowEvent<Input \| Output>) => State` | Applies a recorded message to the state, returning the next state. Required.                                                |
| `initialState` | `() => State`                                                    | Starting state for an instance whose stream holds no messages. Required.                                                    |

`Input` and `Output` are unions of `Command` and `Event` types. `State` is unconstrained.

`Workflow(definition)` returns its argument unchanged and exists to infer the type parameters.

### WorkflowOutput

```typescript
type WorkflowOutput<Output extends AnyEvent | AnyCommand | EmmettError> =
  Output | Output[];
```

A decision returns a single message, an array of messages, or an empty array when it has nothing to produce. The messages are ordinary commands and events: there is no wrapper object around them.

### WorkflowEvent and WorkflowCommand

```typescript
type WorkflowEvent<Output> = Extract<Output, { kind?: 'Event' }>;
type WorkflowCommand<Output> = Extract<Output, { kind?: 'Command' }>;
```

`Event` and `Command` carry an optional `kind` discriminator, so structurally identical types stay distinguishable. These two helpers narrow a mixed input or output union to its event members or its command members. `evolve` takes `WorkflowEvent<Input | Output>`, which is how the compiler keeps commands out of its signature.

## Construction

`WorkflowHandler(options)` returns the handler function. It takes five type parameters: `Input` and `Output` (the message unions), `State`, an optional `MessageMetadataType` (the metadata shape of messages delivered by a consumer), and an optional `StoredMessage` (the stored shape when it differs from `Output`, used with [Schema versioning](#schema-versioning)).

<<< @./../packages/emmett/src/workflows/handleWorkflow.unit.spec.ts#workflow-handler-usage

### WorkflowOptions

`WorkflowHandler` and `workflowProcessor` share these options.

| Property                           | Type                             | Description                                                                                                                                                                  |
| ---------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workflow`                         | `Workflow<Input, State, Output>` | The workflow definition. Required.                                                                                                                                           |
| `getWorkflowId`                    | `(input) => string \| null`      | Resolves the instance id from the input. Returning `null` leaves the message unhandled. Required.                                                                            |
| `inputs.commands`                  | `string[]`                       | Command types the workflow receives. Required.                                                                                                                               |
| `inputs.events`                    | `string[]`                       | Event types the workflow receives. Required.                                                                                                                                 |
| `outputs.commands`                 | `string[]`                       | Command types the workflow emits. Outputs listed here are tagged `Sent`; every other output is tagged `Published`. Required.                                                 |
| `outputs.events`                   | `string[]`                       | Event types the workflow emits. Required.                                                                                                                                    |
| `mapWorkflowId`                    | `(workflowId: string) => string` | Maps the instance id to a stream name. Defaults to `emt:workflow:<name>:<workflowId>`.                                                                                       |
| `separateInputInboxFromProcessing` | `boolean`                        | When `true`, an unprefixed input is only recorded, and the decision runs when the consumer delivers it back. See [Processing modes](#processing-modes). Defaults to `false`. |
| `schema.versioning`                | `{ upcast?; downcast? }`         | Converts stored messages to and from the current shapes. See [Schema versioning](#schema-versioning).                                                                        |

The `inputs` and `outputs` entries are typed against the message unions, so a type that is not part of `Input` or `Output` fails to compile. They are listed explicitly because TypeScript types are erased at runtime.

`WorkflowOptions` has no `serialization` option; the event store in use controls serialisation.

### WorkflowHandlerOptions

`WorkflowHandler` accepts `WorkflowOptions` plus:

| Property        | Type                                                   | Description                                                                                   |
| --------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `retry`         | `WorkflowHandlerRetryOptions`                          | Retry policy for version conflicts. See [Retry](#retry).                                      |
| `observability` | `WorkflowObservabilityConfig`                          | Tracer, meter, logger, and context generator for the workflow scope.                          |
| `middleware`    | `Middleware[] \| { beforeAll?; afterAll?; decision? }` | Invocation-wide and per-decision middleware. See [Decision Middleware](#decision-middleware). |

## Calling the Handler

The handler is called as `handle(store, message, handleOptions?)`, with the event store, the input message, and optional per-call options. `message` is an input message, or a `RecordedMessage` delivered by a consumer.

### WorkflowHandleOptions

| Property                | Type                          | Description                                                                                                                                   |
| ----------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `expectedStreamVersion` | `ExpectedStreamVersion`       | Version the workflow stream must be at, checked on the read and on the append. Defaults to `NO_CONCURRENCY_CHECK` on the read, and on the append to the version read, or `STREAM_DOES_NOT_EXIST` for a new instance. |
| `retry`                 | `WorkflowHandlerRetryOptions` | Retry policy for this call. Overrides the handler-level `retry`.                                                                              |

Remaining properties are the append options of the store in use.

## Decisions

`decide` runs once per input, against the state rebuilt from the workflow stream. Its return value is normalised to an array, and `null` and `undefined` entries are dropped before the outputs are tagged and appended. An error thrown out of it propagates to the caller and nothing is appended; see [Error Handling](#error-handling).

The handler calls `decide` without `await`. An `async` decision returns a `Promise`, which is then taken for a single output message, so a decision cannot perform I/O.

A single message, an array of messages, and an empty array are all valid returns, and one decision may use all three:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-initiate{4}

An empty array produces no outputs and leaves `appendedMessages` empty. The input is appended regardless, so the stream records what the instance was asked to do:

<<< @./../packages/emmett/src/workflows/handleWorkflow.unit.spec.ts#workflow-no-output

When `getWorkflowId` returns `null`, the message belongs to no instance. Nothing is read, nothing is appended, and no stream is created:

<<< @./../packages/emmett/src/workflows/handleWorkflow.unit.spec.ts#workflow-unrouted-input

## Result

Each call resolves to `WorkflowHandlerResult`:

| Property                    | Type                                                | Description                                                       |
| --------------------------- | --------------------------------------------------- | ----------------------------------------------------------------- |
| `messages`                  | `Output[]`                                          | Every output the decision produced, including ones not persisted. |
| `appendedMessages`          | `Output[]`                                          | Outputs persisted by this call.                                   |
| `newMessages`               | `Output[]`                                          | Deprecated alias of `appendedMessages`.                           |
| `nextExpectedStreamVersion` | `StreamPosition` (`bigint` for the built-in stores) | Version of the workflow stream after the append.                  |
| `createdNewStream`          | `boolean`                                           | Whether this call created the workflow stream.                    |

`nextExpectedStreamVersion` and `createdNewStream` come from the store in use, so their exact type depends on it.

## Decision Middleware

`WorkflowHandler` accepts the same middleware as [`CommandHandler`](/api-reference/commandhandler#decision-middleware), as an array of decision middleware or as an object with `beforeAll`, `afterAll`, and `decision`. The `APPEND`, `SKIP`, `STOP`, `REJECT`, and `APPEND_AND_STOP` results apply to the workflow's complete output array.

Decision middleware receives the input message as its first argument and the current state as its second. `beforeAll` receives the input message and a context holding `streamName` and `handleOptions`; `afterAll` receives the final result and the same context. Both run outside retry processing, while decision middleware runs on every attempt.

Suppressing or rejecting outputs does not suppress the stored input. `messages` holds every produced output, `appendedMessages` only the persisted ones:

<<< @./../packages/emmett/src/workflows/handleWorkflow.middleware.unit.spec.ts#workflow-output-rejection

## Workflow Stream

Each instance has its own stream, named `emt:workflow:<workflow name>:<workflow id>` unless `mapWorkflowId` overrides it. `workflowStreamName({ workflowName, workflowId })` builds the default name.

The handler records the input before the outputs it produced. A stored input carries the workflow name as a prefix on its type, which keeps it distinct from the same message type in its source stream, so a consumer subscribed to that type does not observe the same fact twice:

<<< @./../packages/emmett/src/workflows/handleWorkflow.unit.spec.ts#workflow-stream-contents

### Message metadata

| Field               | On             | Values                                                                       |
| ------------------- | -------------- | ---------------------------------------------------------------------------- |
| `input`             | Stored inputs  | `true`.                                                                      |
| `originalMessageId` | Stored inputs  | The `messageId` of the message the workflow received.                        |
| `action`            | Stored inputs  | `InitiatedBy` when the append created the stream, `Received` otherwise.      |
| `action`            | Stored outputs | `Sent` when the type is listed in `outputs.commands`, `Published` otherwise. |

`WorkflowMessageAction` is `'InitiatedBy' | 'Received' | 'Sent' | 'Published' | 'Scheduled'`. A tag records what the decision produced, not what has already been dispatched: an output tagged `Sent` has been recorded, and an output handler sends it afterwards. Only outputs from an `APPEND` or `APPEND_AND_STOP` result are tagged.

`Scheduled` is part of the type but is never assigned. Emmett has no scheduler, so a delayed message has to be produced outside the workflow and delivered to it as an ordinary input.

### State rebuilding {#state-rebuilding}

`evolve` is called with every message the workflow stream holds, in order, with the workflow-name prefix stripped from stored inputs. Emitted commands are recorded in the same stream, so a workflow that stores commands reaches `evolve` with them too. `WorkflowEvent<Input | Output>` narrows the parameter type to the event members, which leaves commands to the switch's default branch, where the state is returned unchanged.

With `separateInputInboxFromProcessing` set to `true`, stored inputs are excluded: only outputs reach `evolve`, and the state is built from the workflow's own decisions alone. Input ids are still collected for [Idempotence](#idempotence) in both modes.

## Optimistic Concurrency

The handler appends with an expected version and fails with `ExpectedVersionConflictError` (a `ConcurrencyError`) when the workflow stream has moved on since it was read.

With no `expectedStreamVersion` passed, the append expects the version read at the start of the call, or `STREAM_DOES_NOT_EXIST` when the instance has no stream yet. `nextExpectedStreamVersion` in the result is the version after the append.

The store-only hop of [separated-inbox mode](#processing-modes) is the exception. It records the input without reading the stream, and appends under `NO_CONCURRENCY_CHECK` unless `expectedStreamVersion` is passed.

A processor lock does not stand in for this check. A consumer's lock is held per processor id, not per workflow instance, so a request-time call and a processor deciding on the same instance are serialised by the expected version alone.

## Retry

`retry` re-runs the decision and the append when the workflow stream moved on between the read and the write. `WorkflowHandlerRetryOptions` takes the same forms as the command handler's:

- `{ onVersionConflict: true }` applies the default policy.
- `{ onVersionConflict: number }` applies the default policy with a different retry count.
- `AsyncRetryOptions` is a full custom policy, including its own `shouldRetryError`.

Left `undefined`, retries are disabled. A per-call `retry` in the handle options overrides the handler-level policy. The default policy retries only on `ExpectedVersionConflictError`:

| Field        | Value    |
| ------------ | -------- |
| `retries`    | `3`      |
| `minTimeout` | `100` ms |
| `factor`     | `1.5`    |

A retried attempt re-reads the stream and runs `decide` again, so the decision runs more than once for one message.

## Idempotence

The handler records `originalMessageId` on every stored input and collects those ids while rebuilding state. An input whose `metadata.messageId` is already present returns an empty result without running the decision:

<<< @./../packages/emmett/src/workflows/handleWorkflow.unit.spec.ts#workflow-idempotent-redelivery

This covers redelivery of the same message. A message with no `metadata.messageId` receives a fresh one on each call, so it is not recognised as a repeat. Two distinct messages describing the same fact carry different ids and both reach the decision.

## Error Handling

A decision throws to reject an input; the handler appends nothing and propagates the error unchanged. A version conflict is thrown by the append.

| Error                                               | Code  | Raised when                                                                         |
| --------------------------------------------------- | ----- | ----------------------------------------------------------------------------------- |
| `ValidationError`                                   | `400` | The input carries invalid data.                                                     |
| `IllegalStateError`                                 | `403` | The input is not valid for the current state.                                       |
| `ExpectedVersionConflictError` (`ConcurrencyError`) | `412` | The workflow stream moved on; carries `expected` and `current` versions as strings. |

An output handler that returns an `EmmettError` instead of throwing stops the processor with a `STOP` result. See [Output handler](#output-handler).

## Workflow Processor

`workflowProcessor(options)` returns a `MessageProcessor` that runs the handler over messages a consumer delivers. It accepts `WorkflowOptions`, the processor options of the underlying consumer, and:

| Property        | Type                              | Description                                                                                             |
| --------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `processorId`   | `string`                          | Identifies the processor and its checkpoints. Defaults to `emt:processor:workflow:<workflow name>`.     |
| `outputHandler` | `WorkflowOutputHandlerDefinition` | Dispatches output messages and feeds any reply back as an input. See [Output handler](#output-handler). |
| `retry`         | `WorkflowHandlerRetryOptions`     | Retry policy passed to the handler.                                                                     |
| `stopAfter`     | `(message) => boolean`            | Stops the processor once a produced output matches.                                                     |
| `hooks`         | `{ onStart?; onClose? }`          | Called when the processor starts and closes.                                                            |

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-processor

The processor handles the types in `inputs.commands` and `inputs.events`, the types in `outputHandler.canHandle`, and, when `separateInputInboxFromProcessing` is enabled, the prefixed form of each input type. A message carrying `metadata.input === true` goes to the handler; otherwise a type listed in `outputHandler.canHandle` goes to the output handler.

`getWorkflowId({ workflowName })` builds the default processor id.

Event stores expose the same factory pre-wired with their locking and checkpointing through `consumer.workflowProcessor(...)`, available for PostgreSQL, SQLite, MongoDB, and EventStoreDB.

### Output handler

An output handler is called with the outputs the workflow recorded. Whatever it returns is appended to the workflow stream flagged as an input, which is how a reply reaches the next decision:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-output-handler

| Property      | Type                                                                   | Description                                              |
| ------------- | ---------------------------------------------------------------------- | -------------------------------------------------------- |
| `canHandle`   | `string[]`                                                             | Output types this handler takes.                         |
| `eachMessage` | `(message, context) => Input \| Input[] \| EmmettError \| [] \| void`  | Handles one output. Mutually exclusive with `eachBatch`. |
| `eachBatch`   | `(messages, context) => Input \| Input[] \| EmmettError \| [] \| void` | Handles a batch of outputs.                              |

Returning `[]`, `undefined`, or `void` appends nothing. Returning an `EmmettError` stops the processor with a `STOP` result. The target stream is derived from `getWorkflowId`, not from the output message's own stream name.

An output handler runs again for an output whose delivery was redelivered before the consumer's checkpoint was written.

`workflowOutputHandler(definition)` returns its argument unchanged and exists to infer the handled output type.

### Processing modes {#processing-modes}

With `separateInputInboxFromProcessing` left at `false`, an input is read, decided on, and appended together with its outputs in one operation.

With it set to `true`, an input arriving without the workflow prefix is only stored. The consumer then delivers that stored message back, prefixed and flagged as an input, and the decision runs on the second delivery. The extra hop adds one write and one delivery per message, and the stored input exists before any decision was made. The accepting call returns no outputs, since no decision ran in it.

The mode also changes state rebuilding: stored inputs are not applied to the state. See [State rebuilding](#state-rebuilding).

## Testing

`WorkflowSpecification.for(workflow)` builds test cases against a workflow definition. A case rebuilds state from the given messages through `evolve`, runs `decide` on the input, and asserts on what it returned:

<<< @./../packages/emmett/src/testing/workflowSpecification.unit.spec.ts#workflow-specification

| Method                  | Behaviour                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| `given(messages)`       | Events the instance's stream already holds, as one event or an array. Replayed through `evolve`. |
| `when(input)`           | The input message passed to `decide`.                                                            |
| `then(output)`          | The decision returned exactly the given message or messages, in any order.                       |
| `thenNothingHappened()` | The decision returned no messages.                                                               |
| `thenThrows(...)`       | The decision threw, optionally matching an error type and a condition.                           |

`given` takes `WorkflowEvent<Input | Output>`, so recorded inputs and recorded outputs both qualify while commands do not.

<<< @./../packages/emmett/src/testing/workflowSpecification.unit.spec.ts#workflow-test-initiate

<<< @./../packages/emmett/src/testing/workflowSpecification.unit.spec.ts#workflow-test-nothing-happened

## Advanced

### Schema versioning {#schema-versioning}

`schema.versioning.upcast` maps a stored message to the current `Input` shape on read; `schema.versioning.downcast` maps an `Output` back to its stored shape on write.

Pass the stored shape as the last type parameter, `StoredMessage`, so both callbacks are checked against it. It defaults to `Output`, which is only correct while the stored and current shapes still match.

### Observability

`observability` (`WorkflowObservabilityConfig`) configures the tracer, meter, logger, and context generator used for the workflow scope. The workflow `name` labels the workflow in traces and metrics.

## Type Source

For the full signatures, see [`workflow.ts`](https://github.com/event-driven-io/emmett/blob/main/src/packages/emmett/src/workflows/workflow.ts), [`handleWorkflow.ts`](https://github.com/event-driven-io/emmett/blob/main/src/packages/emmett/src/workflows/handleWorkflow.ts), [`workflowProcessor.ts`](https://github.com/event-driven-io/emmett/blob/main/src/packages/emmett/src/workflows/workflowProcessor.ts), and [`workflowSpecification.ts`](https://github.com/event-driven-io/emmett/blob/main/src/packages/emmett/src/testing/workflowSpecification.ts) in the source.

## See also {#see-also}

- [Workflows](/guides/workflows)
- [Command Handler](/api-reference/commandhandler)
- [Decider Pattern](/api-reference/decider)
- [Event Store](/api-reference/eventstore)
- [Projections](/api-reference/projections)
- [Testing](/guides/testing)
- [The Workflow Pattern](https://blog.bittacklr.be/the-workflow-pattern.html) by Yves Reynhout
- [How TypeScript can help in modelling business workflows](https://event-driven.io/en/how_to_have_fun_with_typescript_and_workflow/)
