---
documentationType: how-to-guide
outline: deep
---

# Workflows {#workflows}

**A workflow coordinates a business process that takes more than one step.** Take a group checkout in a hotel: a clerk picks a set of guest stays and settles them in one go. Each stay is checked out on its own, replies come back one at a time, and the group is done once they have all reported. Nobody can hold a request open while that happens, so something has to keep track of how far it got.

That something is the workflow. It receives a message, decides what should happen next, and writes both the message and its decisions into a stream of its own. The state is rebuilt from that stream, so the workflow always knows where the process stands. And because everything about a run lives in one place, you can read that stream afterwards and see what the process actually did.

Workflows orchestrate: one place makes the decisions for the whole process. That is what separates them from sagas, where each participant reacts to the previous one's event and nobody holds the full picture. Reach for a workflow when the process has an outcome of its own that something has to determine, like a group checkout that must know nine stays settled and one refused.

You don't need one for everything. A single command against a single stream is a [command handler](/guides/command-handling). A view over what happened is a [projection](/guides/projections). A step that only ever follows the one before it is a reactor.

We'll build the group checkout workflow through this guide, then run it, register it with a consumer, and dispatch what it decides. For the full API surface, see the [Workflows reference](/api-reference/workflows).

## Define the State {#state}

A workflow's state holds what its decisions need and nothing else. For a workflow that waits on several things, that is usually where the run has got to and what it is still waiting for:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-state

Keep it that small. It is rebuilt on every message, and anything the decisions never read is weight for no return. Read more in [Slim your entities with Event Sourcing](https://event-driven.io/en/slim_your_entities_with_event_sourcing/).

## Business Logic and Decisions {#decision}

`decide` takes the message that arrived and the current state, and returns what should happen next:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-decide

Notice what it does not do. It decides that a checkout should happen, but it does not perform one. No room is released, no API is called, nothing is sent. Carrying decisions out is a separate job that we'll come to later. That is what keeps this an ordinary function, and why a test needs nothing but a message and a state.

Each branch handles one phase of a run: the message that starts it, the messages that move it along, and the one that ends it.

### Beginning it {#begin}

The first message creates the run. Return the record that it began and the work it triggers in one result, so the stream cannot end up holding one without the other:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-initiate

Two things guard it. A workflow can receive its first message more than once, so a run that already exists returns nothing. And a request that cannot start a run has to say so, otherwise the caller cannot tell a rejection from a message that went missing.

### Continuing it {#continue}

In the middle, most messages finish nothing. They record progress and the workflow keeps waiting:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-complete{16,27-29}

Whichever message happens to arrive last is the one that completes the run, so completing it belongs in the same branch as waiting. Guard against a participant reporting twice as well, or a duplicate can finish the run on the wrong count.

### Ending it on a timeout {#end}

A message that never arrives raises no error anywhere. There is no request left to fail, so a run waiting for it simply stops, and nobody is told.

Give any workflow that waits a message that ends the wait. Emmett does not schedule it for you: send it from your scheduler once a run has been open longer than you allow, and record what was still outstanding when it fired:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-timeout

## Building State from Messages {#evolve}

A workflow's stream holds both sides of the run, the messages it received and the decisions it took, and `evolve` folds them into the state:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-evolve{14-16,28-33}

Return the state unchanged for a message that does not apply, rather than throwing. The stream is replayed in full every time the run is read.

That replay is also what recovery is. A process that dies part way through restarts, reads the stream, and carries on from what it finds. There is no separate checkpoint to reconcile.

## Putting the Workflow Together {#assemble}

The three functions and a name:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-definition

The name identifies every stream this workflow writes, and it prefixes every input it records. Both show up shortly.

## Unit Testing {#test}

Because decisions perform nothing, testing them needs no event store, no processor and no clock.

::: tip For workflows, the testing pattern looks like this:

- **GIVEN** the messages recorded for the run so far,
- **WHEN** a new message arrives,
- **THEN** we get the decisions the workflow takes.

:::

<<< @./../packages/emmett/src/testing/workflowSpecification.unit.spec.ts#workflow-specification

<<< @./../packages/emmett/src/testing/workflowSpecification.unit.spec.ts#workflow-test-initiate

Then the part a happy-path test never reaches. **Most messages should decide nothing**, and that is where the bugs live:

<<< @./../packages/emmett/src/testing/workflowSpecification.unit.spec.ts#workflow-test-nothing-happened

Cover each way a run should hold still: a message for a run that never started, a duplicate, and one that arrives after the run has finished.

## Running It {#run}

`WorkflowHandler` puts a single message through the workflow against an event store, with no consumer involved. Use it when the message comes from a caller rather than a subscription, as the clerk's request does:

<<< @./../packages/emmett/src/workflows/handleWorkflow.unit.spec.ts#workflow-handler-usage

It works out which run the message belongs to, reads that run's stream, replays it, runs the decision, and appends the input and the decisions together in one write:

<<< @./../packages/emmett/src/workflows/handleWorkflow.unit.spec.ts#workflow-stream-contents

Inputs and outputs interleave from here on, so the stream serves as the run's inbox and its outbox at once. Every message also records what it was, which is what lets the stream be read as a story: the message that started the run is marked `InitiatedBy`, later arrivals `Received`, and decisions `Sent` or `Published`:

<<< @./../packages/emmett/src/workflows/handleWorkflow.unit.spec.ts#workflow-message-actions

The workflow name comes back here as a prefix on the recorded inputs. Outputs don't carry it, because they exist nowhere else. An input is a copy of a message that also lives in its source stream, and the prefix keeps a consumer of that message type from picking up every run's copy as well.

## Registering the Processor {#register}

Messages that arrive from a caller can be handled in the request. The ones that arrive later cannot, so a processor delivers them as they come in. It needs to know which message types concern the workflow, and which run each one belongs to.

Inputs are mostly events and outputs mostly commands. Both are listed by name, because TypeScript types do not survive to runtime. They are checked against your unions, so a type belonging to neither will not compile.

`getWorkflowId` is the router. The id it returns is the run's identity:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-options{7}

Return `null` for a message that belongs to no run. Nothing is read and no stream is created:

<<< @./../packages/emmett/src/workflows/handleWorkflow.unit.spec.ts#workflow-unrouted-input

Then register the options on your store's consumer. PostgreSQL, SQLite, MongoDB and EventStoreDB each supply the processor wired to their own locking and checkpointing:

<<< @./../packages/emmett-postgresql/src/eventStore/consumers/postgreSQLEventStoreConsumer.workflow.int.spec.ts#workflow-consumer-registration

## Carrying Out the Decisions {#output-handler}

This is the job we deferred. The workflow recorded what should happen; now something has to do it. The consumer reads the run's stream as an outbox and hands each recorded decision to a handler. The decision never said where its message should go, so the message type picks the handler:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-output-handler

The handler is where external work belongs, and whatever it returns is appended to the run's stream as the next input. That is how a workflow talks to the outside world and hears back:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-side-effect{3,11,19}

Give the processor the handler alongside the same options:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-processor

## Keeping the Id on Every Message {#correlation}

A decision goes out as one message and its result comes back as another, handled by different code at different times. The workflow id is the only thing linking them, and it has to survive three legs: the decision puts it on the outgoing message, the code handling that message copies it onto whatever it produces, and `getWorkflowId` reads it back off.

Lose it anywhere along the way and the reply lands in some other stream and stops there. The run stays open and nothing complains, because from the workflow's side a reply that was never correlated looks exactly like one that never happened.

## Keeping an Outcome Out of the Stream {#reject-workflow-output}

Recording a decision is what causes it to be dispatched, which is usually what you want. Sometimes it is not: an outcome the caller needs in its response, but that no handler should act on. `rejectOn` returns it to the caller and keeps it out of the stream:

<<< @./../packages/emmett/src/workflows/handleWorkflow.middleware.unit.spec.ts#workflow-output-rejection

The input is still recorded, so resending the same message is recognised as a repeat rather than starting a second run. Use this only when nothing downstream needs the outcome; otherwise let the workflow record it like any other decision.

`skipOn` drops an outcome and continues, `stopOn` drops it and stops, and `stopAfter` records it before stopping. The [Workflows reference](/api-reference/workflows#decision-middleware) has their exact contracts.

## Handling Redelivery {#redelivery}

**The same message will arrive twice.** A consumer can handle one and restart before writing its checkpoint, and a version conflict re-runs another. The message's own id closes that gap. Every recorded input keeps the id of the message it came from, and rebuilding the state collects them. A message whose id is already there is dropped before the decision runs, so nothing is appended and the input is not recorded again:

<<< @./../packages/emmett/src/workflows/handleWorkflow.unit.spec.ts#workflow-idempotent-redelivery

This depends on the message carrying an id. Messages delivered by a consumer have one. If you call `WorkflowHandler` yourself with a message that has no `metadata.messageId`, each call gets a fresh id and the workflow handles it again.

That covers the same message arriving twice. Two different messages reporting the same fact carry different ids and both reach the decision, which is why the guard in [Continuing it](#continue) is there as well.

## Watching for Runs That Never Finish {#monitoring}

A run that began and never reached an outcome will not tell you about itself. Nothing throws, nothing retries, the stream simply stops. Watch for streams holding an `InitiatedBy` and none of the messages that end a run.

Take the window from the process rather than the framework. A group of stays should settle in minutes, while a review with three approvers may sit for days. A [timeout](#end) ends a stuck run; monitoring is what tells you runs are getting stuck in the first place.

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

If a decision sits in the stream and nothing happens, no output handler claimed it. The workflow records decisions and a handler performs them, but only for the types in its `canHandle`. Add the type there, as [Carrying Out the Decisions](#output-handler) shows.

### A Run Stalls Halfway {#stalls}

A run that stays open is waiting for a reply that never came, so read its stream. If the outgoing message is there and no reply follows it, either an output handler threw instead of reporting a failure, which stops the processor and leaves everything behind it unattempted, or the reply was produced without the workflow id and never found its way back, as [Keeping the Id on Every Message](#correlation) describes. If the reply is there and the run still did not finish, the guard in the decision is wrong.

## Further Readings {#readings}

- [API Reference: Workflows](/api-reference/workflows)
- [Command Handling](/guides/command-handling)
- [Testing](/guides/testing)
- [Error Handling](/guides/error-handling)
- [The Workflow Pattern](https://blog.bittacklr.be/the-workflow-pattern.html) by Yves Reynhout
- [How TypeScript can help in modelling business workflows](https://event-driven.io/en/how_to_have_fun_with_typescript_and_workflow/)
- [Event-driven distributed processes by example](https://event-driven.io/en/event_driven_distributed_processes_by_example/)
- [How to build an in-memory Message Bus in TypeScript](https://event-driven.io/en/inmemory_message_bus_in_typescript/)
