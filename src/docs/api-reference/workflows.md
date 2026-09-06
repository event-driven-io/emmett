---
documentationType: reference
outline: deep
---

# Workflows

## Overview

A workflow coordinates a business process that spans more than one stream. It receives commands and events as inputs, decides what should happen next from the state it rebuilt, and returns commands and events as outputs.

`WorkflowHandler` runs one workflow instance against its own stream. That stream is both the inbox and the outbox of the instance: the handler records the input it was given, then the outputs the decision returned, in a single append. Rebuilding state is reading that stream, so recovery after a crash is the same code path as ordinary processing.

Where a [Command Handler](/api-reference/commandhandler) answers a command against a single aggregate stream, a workflow reacts to events from anywhere in the system and may emit commands other handlers act on. `workflowProcessor` wires the handler into a consumer, so inputs arrive from the message store and outputs are dispatched.

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
| `name`         | `string`                                                         | Identifies the workflow. Used in the stream name, the default processor id, and the prefix given to stored inputs. |
| `decide`       | `(input: Input, state: State) => WorkflowOutput<Output>`         | Business logic. Returns the messages the workflow produces for this input.                                         |
| `evolve`       | `(state: State, event: WorkflowEvent<Input \| Output>) => State` | Applies a recorded message to the state, returning the next state.                                                 |
| `initialState` | `() => State`                                                    | Starting state for an instance whose stream holds no messages.                                                     |

`Input` and `Output` are unions of `Command` and `Event` types. `State` is unconstrained.

### WorkflowOutput

```typescript
type WorkflowOutput<Output> = Output | Output[];
```

A decision returns a single message, an array of messages, or an empty array when it has nothing to produce. The messages are ordinary commands and events: there is no wrapper object around them.

### WorkflowEvent and WorkflowCommand

```typescript
type WorkflowEvent<Output> = Extract<Output, { kind?: 'Event' }>;
type WorkflowCommand<Output> = Extract<Output, { kind?: 'Command' }>;
```

`Event` and `Command` carry an optional `kind` discriminator, so structurally identical types stay distinguishable. These two helpers narrow a mixed input or output union to its event members or its command members. `evolve` takes `WorkflowEvent<Input | Output>`, which is how the compiler keeps commands out of its signature.

## WorkflowHandler

`WorkflowHandler(options)` returns the handler function. Each call rebuilds the instance state, runs `decide`, and appends the input together with the produced outputs.

<<< @./../packages/emmett/src/workflows/handleWorkflow.unit.spec.ts#workflow-handler-usage

The handler is called as `handle(store, message, handleOptions?)`. `message` is an input message, or a `RecordedMessage` delivered by a consumer.

### WorkflowOptions

`WorkflowHandler` and `workflowProcessor` share these options.

| Property                           | Type                             | Description                                                                                                                                                                  |
| ---------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workflow`                         | `Workflow<Input, State, Output>` | The workflow definition. Required.                                                                                                                                           |
| `getWorkflowId`                    | `(input) => string \| null`      | Resolves the instance id from the input. Returning `null` leaves the message unhandled. Required.                                                                            |
| `mapWorkflowId`                    | `(workflowId: string) => string` | Maps the instance id to a stream name. Defaults to `emt:workflow:<name>:<workflowId>`.                                                                                       |
| `inputs.commands`                  | `string[]`                       | Command types the workflow receives.                                                                                                                                         |
| `inputs.events`                    | `string[]`                       | Event types the workflow receives.                                                                                                                                           |
| `outputs.commands`                 | `string[]`                       | Command types the workflow emits. Outputs listed here are tagged `Sent`; every other output is tagged `Published`.                                                           |
| `outputs.events`                   | `string[]`                       | Event types the workflow emits.                                                                                                                                              |
| `separateInputInboxFromProcessing` | `boolean`                        | When `true`, an unprefixed input is only recorded, and the decision runs when the consumer delivers it back. See [Processing modes](#processing-modes). Defaults to `false`. |
| `schema.versioning`                | `{ upcast?; downcast? }`         | Converts stored messages to and from the current shapes.                                                                                                                     |

The `inputs` and `outputs` entries are typed against the message unions, so a type that is not part of `Input` or `Output` fails to compile. They are listed explicitly because TypeScript types are erased at runtime.

### WorkflowHandlerOptions

`WorkflowHandler` accepts `WorkflowOptions` plus:

| Property        | Type                                                   | Description                                                                                   |
| --------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `retry`         | `WorkflowHandlerRetryOptions`                          | Retry policy for version conflicts. See [Retry](#retry).                                      |
| `observability` | `WorkflowObservabilityConfig`                          | Tracer, meter, logger, and context generator for the workflow scope.                          |
| `middleware`    | `Middleware[] \| { beforeAll?; afterAll?; decision? }` | Invocation-wide and per-decision middleware. See [Decision Middleware](#decision-middleware). |

### WorkflowHandleOptions

| Property                | Type                          | Description                                                                                                                                   |
| ----------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `expectedStreamVersion` | `ExpectedStreamVersion`       | Version the workflow stream must be at. Defaults to the version read at the start of the call, or `STREAM_DOES_NOT_EXIST` for a new instance. |
| `retry`                 | `WorkflowHandlerRetryOptions` | Retry policy for this call. Overrides the handler-level `retry`.                                                                              |

Remaining properties are the append options of the store in use.

### WorkflowHandlerResult

| Property                    | Type                                                | Description                                                       |
| --------------------------- | --------------------------------------------------- | ----------------------------------------------------------------- |
| `messages`                  | `Output[]`                                          | Every output the decision produced, including ones not persisted. |
| `appendedMessages`          | `Output[]`                                          | Outputs persisted by this call.                                   |
| `newMessages`               | `Output[]`                                          | Deprecated alias of `appendedMessages`.                           |
| `nextExpectedStreamVersion` | `StreamPosition` (`bigint` for the built-in stores) | Version of the workflow stream after the append.                  |
| `createdNewStream`          | `boolean`                                           | Whether this call created the workflow stream.                    |

## Workflow Stream

Each instance has its own stream, named `emt:workflow:<workflow name>:<workflow id>` unless `mapWorkflowId` overrides it. `workflowStreamName({ workflowName, workflowId })` builds the default name.

The handler records the input before the outputs it produced. Stored inputs carry the workflow name as a prefix, which keeps them apart from the same message type arriving from its original stream:

<<< @./../packages/emmett/src/workflows/handleWorkflow.unit.spec.ts#workflow-stream-contents

### Message metadata

| Field               | On             | Values                                                                       |
| ------------------- | -------------- | ---------------------------------------------------------------------------- |
| `input`             | Stored inputs  | `true`.                                                                      |
| `originalMessageId` | Stored inputs  | The `messageId` of the message the workflow received.                        |
| `action`            | Stored inputs  | `InitiatedBy` when the append created the stream, `Received` otherwise.      |
| `action`            | Stored outputs | `Sent` when the type is listed in `outputs.commands`, `Published` otherwise. |

`WorkflowMessageAction` is `'InitiatedBy' | 'Received' | 'Sent' | 'Published' | 'Scheduled'`. The past tense records what the workflow decided, not what has already happened: an output tagged `Sent` has been recorded, and an output handler sends it afterwards.

The workflow-name prefix on stored inputs keeps them distinct from the same message type in its source stream, so a consumer subscribed to that type does not observe the same fact twice.

### State rebuilding

`evolve` is called with every message the workflow stream holds, in order, with the workflow-name prefix stripped from stored inputs. Emitted commands are recorded in the same stream, so a workflow that stores commands reaches `evolve` with them too. `WorkflowEvent<Input | Output>` narrows the parameter type to the event members, which leaves commands to the switch's default branch, where returning the state unchanged is the correct behaviour.

## Empty Decisions

A decision that returns an empty array produces no outputs, and `appendedMessages` is empty. The input is still recorded, so the instance retains what it was asked to do and when:

<<< @./../packages/emmett/src/workflows/handleWorkflow.unit.spec.ts#workflow-no-output

When `getWorkflowId` returns `null`, the message belongs to no instance. Nothing is read, nothing is appended, and no stream is created:

<<< @./../packages/emmett/src/workflows/handleWorkflow.unit.spec.ts#workflow-unrouted-input

## Idempotence

The handler records `originalMessageId` on every stored input and collects those ids while rebuilding state. An input whose `metadata.messageId` is already present returns an empty result without running the decision:

<<< @./../packages/emmett/src/workflows/handleWorkflow.unit.spec.ts#workflow-idempotent-redelivery

This covers redelivery of the same message. Two distinct messages describing the same fact carry different ids, so guarding against them belongs in the decision, which returns an empty array once the state shows the work is done.

## Retry

`retry` re-runs the decision and the append when the workflow stream moved on between the read and the write. `WorkflowHandlerRetryOptions` takes the same forms as the command handler's:

- `{ onVersionConflict: true }` applies the default policy.
- `{ onVersionConflict: number }` applies the default policy with a different retry count.
- `AsyncRetryOptions` is a full custom policy, including its own `shouldRetryError`.

Left `undefined`, retries are disabled. The default policy retries only on `ExpectedVersionConflictError`:

| Field        | Value    |
| ------------ | -------- |
| `retries`    | `3`      |
| `minTimeout` | `100` ms |
| `factor`     | `1.5`    |

## Decision Middleware

`WorkflowHandler` accepts the same middleware as [`CommandHandler`](/api-reference/commandhandler#decision-middleware), as an array of decision middleware or as an object with `beforeAll`, `afterAll`, and `decision`. The `APPEND`, `SKIP`, `STOP`, `REJECT`, and `APPEND_AND_STOP` results apply to the workflow's complete output array.

Decision middleware receives the input message as its first argument and the current state as its second. `beforeAll` receives the input message and a context holding `streamName` and `handleOptions`; `afterAll` receives the final result and the same context. Both run outside retry processing, while decision middleware runs on every attempt.

Suppressing or rejecting outputs does not suppress the stored input. `messages` holds every produced output, `appendedMessages` only the persisted ones:

<<< @./../packages/emmett/src/workflows/handleWorkflow.middleware.unit.spec.ts#workflow-output-rejection

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

Event stores expose the same factory pre-wired with their locking and checkpointing through `consumer.workflowProcessor(...)`, available for PostgreSQL, SQLite, MongoDB, and EventStoreDB.

### Output handler

An output handler receives the outputs the workflow recorded and performs the work they ask for. Whatever it returns is appended to the workflow stream as a new input, which is how a reply reaches the next decision:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-output-handler

| Property      | Type                                                                   | Description                                              |
| ------------- | ---------------------------------------------------------------------- | -------------------------------------------------------- |
| `canHandle`   | `string[]`                                                             | Output types this handler takes.                         |
| `eachMessage` | `(message, context) => Input \| Input[] \| EmmettError \| [] \| void`  | Handles one output. Mutually exclusive with `eachBatch`. |
| `eachBatch`   | `(messages, context) => Input \| Input[] \| EmmettError \| [] \| void` | Handles a batch of outputs.                              |

Returning `[]`, `undefined`, or `void` appends nothing. Returning an `EmmettError` stops the processor with a `STOP` result. The target stream is derived from `getWorkflowId`, not from the output message's own stream name.

`workflowOutputHandler(definition)` returns its argument unchanged and exists to infer the handled output type.

### Processing modes {#processing-modes}

With `separateInputInboxFromProcessing` left at `false`, an input is read, decided on, and appended together with its outputs in one operation.

With it set to `true`, an input arriving without the workflow prefix is only stored. The consumer then delivers that stored message back, prefixed and flagged as an input, and the decision runs on the second delivery. The extra hop costs latency and buys a durable record of the input that exists before any decision was made.

## Testing

`WorkflowSpecification.for(workflow)` builds a specification from the workflow definition. It rebuilds state from the given messages through `evolve`, then runs `decide` on the input:

<<< @./../packages/emmett/src/testing/workflowSpecification.unit.spec.ts#workflow-specification

| Method                  | Assertion                                                                  |
| ----------------------- | -------------------------------------------------------------------------- |
| `then(output)`          | The decision returned exactly the given message or messages, in any order. |
| `thenNothingHappened()` | The decision returned no messages.                                         |
| `thenThrows(...)`       | The decision threw, optionally matching an error type and a condition.     |

<<< @./../packages/emmett/src/testing/workflowSpecification.unit.spec.ts#workflow-test-initiate

<<< @./../packages/emmett/src/testing/workflowSpecification.unit.spec.ts#workflow-test-nothing-happened

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
