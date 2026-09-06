---
documentationType: how-to-guide
outline: deep
---

# Workflows {#workflows}

**A workflow coordinates a business process that takes more than one step.** Take a group checkout in a hotel: a clerk picks a set of guest stays and settles them in one go. Each stay is checked out on its own, replies come back one at a time, and the group is done once they have all reported. Nobody can hold a request open while that happens, so something has to keep track of how far it got.

Group checkout is a small example, and it is the one used throughout this guide, but the shape is the same for the processes that hurt when they go wrong: a payment authorised, captured and sometimes refunded; an onboarding waiting on identity checks from two providers; an order that reserves stock, charges a card and books a courier; an approval that sits until a person acts on it. In all of them the process matters more than any single step, somebody will ask later why it ended the way it did, and a half-finished one has to be findable.

Decisions come from the message and the current state alone, so a run behaves the same way every time and can be tested by calling a function. Every message received and every decision taken is recorded in order in the run's own stream, so its history is a stream read rather than a search across service logs. And a run that stopped halfway is visible, because the stream shows what it was waiting for.

Workflows orchestrate: one place makes the decisions for the whole process. That is what separates them from sagas, where each participant reacts to the previous one's event and nobody holds the full picture. Reach for a workflow when the process has an outcome of its own that something has to determine, like a group checkout that must know nine stays settled and one refused.

You don't need one for everything. A single command against a single stream is a [command handler](/guides/command-handling). A view over what happened is a [projection](/guides/projections). A step that only ever follows the one before it is a reactor.

For the full API surface, see the [Workflows reference](/api-reference/workflows).

## Define the State {#state}

A workflow's state holds what its decisions need and nothing else. For a workflow that waits on several things, that is usually where the run has got to and what it is still waiting for:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-state

Keep it that small. It is rebuilt on every message, and anything the decisions never read is weight for no return. Read more in [Slim your entities with Event Sourcing](https://event-driven.io/en/slim_your_entities_with_event_sourcing/).

## Write the Business Logic {#decision}

`decide` takes the message that arrived and the current state, and returns what should happen next:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-decide

Notice what it does not do. It decides that a checkout should happen, but it does not perform one. No room is released, no API is called, nothing is sent. Carrying decisions out is a separate job that we'll come to later. That is what keeps this an ordinary function, and why a test needs nothing but a message and a state.

Each branch handles one phase of a run: the message that starts it, the messages that move it along, and the one that ends it.

### Begin it {#begin}

The first message creates the run. Return the record that it began and the work it triggers in one result, so the stream cannot end up holding one without the other:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-initiate

A workflow can receive its first message more than once, so a run that already exists returns nothing. And a request that cannot start a run has to say so, otherwise the caller cannot tell a rejection from a message that went missing.

### Continue it {#continue}

In the middle, most messages finish nothing. They record progress and the workflow keeps waiting:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-complete{16,27-29}

Whichever message happens to arrive last is the one that completes the run, so completing it belongs in the same branch as waiting. Guard against a participant reporting twice as well, or a duplicate can finish the run on the wrong count.

### End it on a timeout {#end}

A message that never arrives raises no error anywhere. There is no request left to fail, so a run waiting for it simply stops, and nobody is told.

Give any workflow that waits a message that ends the wait. Emmett does not schedule it for you: send it from your scheduler once a run has been open longer than you allow, and record what was still outstanding when it fired:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-timeout

## Build State from Messages {#evolve}

A workflow's stream holds both sides of the run, the messages it received and the decisions it took, and `evolve` folds them into the state:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-evolve{14-16,28-33}

Return the state unchanged for a message that does not apply, rather than throwing. The stream is replayed in full every time the run is read.

That replay is also what recovery is. A process that dies part way through restarts, reads the stream, and carries on from what it finds. There is no separate checkpoint to reconcile.

## Put the Workflow Together {#assemble}

The three functions and a name:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-definition

The name identifies every stream this workflow writes, and it prefixes every input it records.

## Test the Decisions {#test}

Because decisions perform nothing, testing them needs no event store, no processor and no clock.

::: tip For workflows, the testing pattern looks like this:

- **GIVEN** the messages recorded for the run so far,
- **WHEN** a new message arrives,
- **THEN** we get the decisions the workflow takes.

:::

<<< @./../packages/emmett/src/testing/workflowSpecification.unit.spec.ts#workflow-specification

<<< @./../packages/emmett/src/testing/workflowSpecification.unit.spec.ts#workflow-test-initiate

Then the part a happy-path test never reaches. **Most messages should decide nothing**:

<<< @./../packages/emmett/src/testing/workflowSpecification.unit.spec.ts#workflow-test-nothing-happened

Cover each way a run should hold still: a message for a run that never started, a duplicate, and one that arrives after the run has finished.

## Decide in the Request or in the Background {#sync-vs-async}

Some messages have a caller waiting on the answer. A clerk pressing "check out group" wants to know the group started and what it is doing; an approver clicking "approve" wants to know the approval registered and whether it was the last one needed. Handle those in the request.

The rest arrive later and on their own schedule, from other systems or from your own output handlers. Nothing is waiting on them, so handle those in the background.

Most workflows use both. The clerk's `InitiateGroupCheckout` is decided in the request, and the stay replies that follow are decided in the background. Both go through the same `decide` against the same stream, so this is a choice about who is waiting, not about the business logic.

### Decide in the request {#run}

`WorkflowHandler` puts a single message through the workflow against an event store, with no consumer involved:

<<< @./../packages/emmett/src/workflows/handleWorkflow.unit.spec.ts#workflow-handler-usage

It works out which run the message belongs to, reads that run's stream, replays it, runs the decision, and appends the input and the decisions together in one write. The result holds the decisions, so the endpoint can answer with them. Use this anywhere a person is waiting: starting a run, registering an approval, cancelling one.

### Decide in the background {#register}

A consumer supplies what the workflow itself does not. It delivers messages one at a time and in order, so two replies for the same run are decided one after the other rather than together. It stores a checkpoint, so a restart picks up from the last message it handled instead of replaying the run from the start or skipping past it. And it holds a lock on the processor id, so you can run several instances of your application for availability without two of them deciding for the same workflow.

The processor needs to know which message types concern the workflow, and which run each one belongs to. Inputs are mostly events and outputs mostly commands. Both are listed by name, because TypeScript types do not survive to runtime. They are checked against your unions, so a type belonging to neither will not compile.

`getWorkflowId` is the router. The id it returns is the run's identity:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-options{7}

Return `null` for a message that belongs to no run. Nothing is read and no stream is created:

<<< @./../packages/emmett/src/workflows/handleWorkflow.unit.spec.ts#workflow-unrouted-input

Then register the options on your store's consumer. PostgreSQL, SQLite, MongoDB and EventStoreDB each supply the processor wired to their own locking and checkpointing:

<<< @./../packages/emmett-postgresql/src/eventStore/consumers/postgreSQLEventStoreConsumer.workflow.int.spec.ts#workflow-consumer-registration

A request-time decision and a background one can still collide, because they run in different processes and the consumer's lock covers only its own. Every append to a workflow stream is guarded by the version the stream was read at, so the second one fails with `ExpectedVersionConflictError` rather than appending decisions taken from a state that has since moved on. Set `retry` to have Emmett re-read and decide again rather than surfacing the conflict.

## Store the Input Before Deciding {#double-hop}

By default the input and the decisions it produced are appended together in one write. If the process dies before that write, nothing is recorded, and the consumer redelivers the message because its checkpoint did not move.

`separateInputInboxFromProcessing` splits that into two hops. The first records the input in the run's stream and stops there. The processor then picks its own recorded copy back up and decides on it, which is why it subscribes to the prefixed types as well:

<<< @./../packages/emmett/src/workflows/workflowProcessor.unit.spec.ts#workflow-separate-inbox

The split makes accepting a message and deciding on it two separate, durable steps. The run's stream records what arrived even when deciding on it keeps failing, which is what you want when you need to see what a process was asked to do independently of what it made of it.

It costs an extra write and an extra delivery for every message, so every step takes a second round trip. The decision also no longer happens in the call that accepted the message, so nothing can be returned to a caller from it, which rules the mode out for the request-time path above.

Leave it off, which is the default, unless you need that separation.

## Call External Systems from the Output Handler {#output-handler}

This is the job we deferred. The workflow recorded what should happen; the output handler is what makes it happen. The consumer reads each recorded decision from the run's stream and routes it by type, so the decision never had to say where its message should go:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-output-handler

The handler is the only place in a workflow where external calls belong. It can do whatever an ordinary asynchronous function can: call an HTTP API, write to another database, put a message on a queue. Whatever it returns is appended to the run's stream as the next input, which is how the answer finds its way back into the decision:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-side-effect{3,11,19}

Return failures rather than throwing, because a refusal from the external system is usually an answer the run needs, while a throw stops the processor and everything queued behind it. Carry the workflow id out and back, or the reply cannot be routed to the run that asked for it. And expect the handler to run more than once for the same decision, because a restart before the checkpoint is written redelivers it, so make the call safe to repeat or make the target idempotent.

Give the processor the handler alongside the same options:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-processor

## Keep the Id on Every Message {#correlation}

A decision goes out as one message and its result comes back as another, handled by different code at different times. The workflow id is the only thing linking them, and it has to survive three legs: the decision puts it on the outgoing message, the code handling that message copies it onto whatever it produces, and `getWorkflowId` reads it back off.

Lose it anywhere along the way and the reply lands in some other stream and stops there. The run stays open and nothing complains, because from the workflow's side a reply that was never correlated looks exactly like one that never happened.

## Read a Run's History {#observability}

Everything one run did is in one stream, in order:

<<< @./../packages/emmett/src/workflows/handleWorkflow.unit.spec.ts#workflow-stream-contents

Inputs and outputs interleave, so the stream is the run's inbox and its outbox at once. Each message also records its part in the run:

<<< @./../packages/emmett/src/workflows/handleWorkflow.unit.spec.ts#workflow-message-actions

`InitiatedBy` marks the message that started the run, `Received` each later arrival, and `Sent` or `Published` each decision taken. A group of three stays where one refuses reads like this:

| #   | Message                                       | Action        | Reads as                                       |
| --- | --------------------------------------------- | ------------- | ---------------------------------------------- |
| 1   | `GroupCheckoutWorkflow:InitiateGroupCheckout` | `InitiatedBy` | Clerk started a group of three stays           |
| 2   | `GroupCheckoutInitiated`                      | `Published`   | The run announced itself                       |
| 3   | `CheckOut`                                    | `Sent`        | Stay 1 asked to settle                         |
| 4   | `CheckOut`                                    | `Sent`        | Stay 2 asked to settle                         |
| 5   | `CheckOut`                                    | `Sent`        | Stay 3 asked to settle                         |
| 6   | `GroupCheckoutWorkflow:GuestCheckedOut`       | `Received`    | Stay 1 settled, two still outstanding          |
| 7   | `GroupCheckoutWorkflow:GuestCheckoutFailed`   | `Received`    | Stay 2 refused, balance not settled            |
| 8   | `GroupCheckoutWorkflow:GuestCheckedOut`       | `Received`    | Stay 3 settled, all have now reported          |
| 9   | `GroupCheckoutFailed`                         | `Published`   | Group finished: two settled, one refused       |

Rows 6 and 7 decided nothing, and they are recorded anyway, which is what makes the gaps readable. Somebody on a help desk asked why a guest was still checked in can answer it from row 7 without reading any code. Somebody analysing the process can ask how many groups reach `GroupCheckoutTimedOut`, how long runs take between row 1 and their last row, and which failure reason comes up most. All of it is a query over streams, with no correlation across service logs and no tracing spans to line up.

Recorded inputs carry the workflow name as a prefix; outputs don't, because they exist nowhere else. An input is a copy of a message that also lives in its source stream, and the prefix keeps a consumer of that message type from picking up every run's copy as well.

### Alert on runs that never finish {#monitoring}

A run that began and never reached an outcome will not tell you about itself. Nothing throws, nothing retries, the stream simply stops. Watch for streams holding an `InitiatedBy` and none of the messages that end a run.

Take the window from the process rather than the framework. A group of stays should settle in minutes, while a review with three approvers may sit for days. A [timeout](#end) ends a stuck run; monitoring is what tells you runs are getting stuck in the first place.

## Keep an Outcome Out of the Stream {#reject-workflow-output}

Recording a decision is what causes it to be dispatched, which is usually what you want. Sometimes it is not: an outcome the caller needs in its response, but that no handler should act on. `rejectOn` returns it to the caller and keeps it out of the stream:

<<< @./../packages/emmett/src/workflows/handleWorkflow.middleware.unit.spec.ts#workflow-output-rejection

The input is still recorded, so resending the same message is recognised as a repeat rather than starting a second run. Use this only when nothing downstream needs the outcome; otherwise let the workflow record it like any other decision.

`skipOn` drops an outcome and continues, `stopOn` drops it and stops, and `stopAfter` records it before stopping. The [Workflows reference](/api-reference/workflows#decision-middleware) has their exact contracts.

## Handle Redelivery {#redelivery}

**The same message will arrive twice.** A consumer can handle one and restart before writing its checkpoint, and a version conflict re-runs another. Emmett detects the repeat from the message id. Every recorded input keeps the id of the message it came from, and rebuilding the state collects them. A message whose id is already there is dropped before the decision runs, so nothing is appended and the input is not recorded again:

<<< @./../packages/emmett/src/workflows/handleWorkflow.unit.spec.ts#workflow-idempotent-redelivery

This depends on the message carrying an id. Messages delivered by a consumer have one. If you call `WorkflowHandler` yourself with a message that has no `metadata.messageId`, each call gets a fresh id and the workflow handles it again.

That covers the same message arriving twice. Two different messages reporting the same fact carry different ids and both reach the decision, which is why the guard in [Continue it](#continue) is there as well.

## Best Practices {#best-practices}

### Decide From the Message and State Alone {#keep-pure}

A decision that reads a clock or calls a service answers differently on each attempt, and attempts are common: a version conflict retries it, and a redelivered message runs it again. Each `CheckOut` above carries the timestamp from the clerk's command rather than reading the clock, which is also what lets the tests assert exact times. Work that has to reach outside belongs in an output handler.

### Let the Decision Return Nothing {#return-nothing}

A message that concerns the run but changes nothing should still reach the decision and come back empty, rather than being filtered out on the way in. The input is recorded either way:

<<< @./../packages/emmett/src/workflows/handleWorkflow.unit.spec.ts#workflow-no-output

When a run stalls, that record is what separates a message that arrived and changed nothing from one that never arrived at all.

### Report Failures as Events {#failures-as-events}

An unpaid balance is not a fault, it is the answer the run needs in order to finish. Throwing turns it into one, and because an output handler runs in the background with no caller to unwind to, the throw stops the processor and everything queued behind it goes unattempted. Return the failure as a message and let the decision settle it. See [Error Handling](/guides/error-handling#no-throw-async).

## Troubleshooting {#troubleshooting}

### The Workflow Never Starts {#never-starts}

If no stream appears for a run, the message never reached the decision, and there are two causes. Either its type is not among the registered inputs, so the processor ignored it, or `getWorkflowId` found no id on it and returned `null`. The second is easy to miss, because it is also correct behaviour: a guest checking out on their own belongs to no group. Check that the message you appended carries the id the router reads.

### Decisions Are Recorded but Nothing Runs {#outputs-not-dispatched}

If a decision sits in the stream and nothing happens, no output handler claimed it. The workflow records decisions and a handler performs them, but only for the types in its `canHandle`. Add the type there, as [Call External Systems from the Output Handler](#output-handler) shows.

### A Run Stalls Halfway {#stalls}

A run that stays open is waiting for a reply that never came, so read its stream. If the outgoing message is there and no reply follows it, either an output handler threw instead of reporting a failure, which stops the processor and leaves everything behind it unattempted, or the reply was produced without the workflow id and never found its way back, as [Keep the Id on Every Message](#correlation) describes. If the reply is there and the run still did not finish, the guard in the decision is wrong.

## Further Readings {#readings}

- [API Reference: Workflows](/api-reference/workflows)
- [Command Handling](/guides/command-handling)
- [Testing](/guides/testing)
- [Error Handling](/guides/error-handling)
- [The Workflow Pattern](https://blog.bittacklr.be/the-workflow-pattern.html) by Yves Reynhout
- [How TypeScript can help in modelling business workflows](https://event-driven.io/en/how_to_have_fun_with_typescript_and_workflow/)
- [Event-driven distributed processes by example](https://event-driven.io/en/event_driven_distributed_processes_by_example/)
- [How to build an in-memory Message Bus in TypeScript](https://event-driven.io/en/inmemory_message_bus_in_typescript/)
