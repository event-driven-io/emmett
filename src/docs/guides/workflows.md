---
documentationType: how-to-guide
outline: deep
---

# Workflows {#workflows}

A workflow makes the decisions that move a business process along when that process cannot be done in one go: settling a dozen guest stays as a single group checkout, onboarding with verification steps, a review with several approvers. It receives a command or an event, decides what should happen next from the state it rebuilt, and records that message together with its decisions in a stream of its own. Nothing outside it has to remember how far the process got. This guide shows you how to define a workflow, write the decisions that hold its business logic, test them, run it, register it with a consumer, and dispatch what it produces. For the full API surface, see the [Workflows reference](/api-reference/workflows).

Reach for a workflow when the process has to track how far it has got, and when one place should be able to answer where a given run stopped and why. A single command against a single stream is a [command handler](/guides/command-handling), a view of what happened is a [projection](/guides/projections), and a step that only follows the one before it is a reactor.

## Define the State {#state}

A workflow is a state machine, so name the states that change what it decides next and leave the rest out. Group checkout waits on a set of stays, so it keeps a status per stay, and gives "not started" and "finished" states of their own rather than leaving them implicit in a status column:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-state

## Write the Decision {#decision}

A decision takes the message and the current state and returns the messages to produce: one, several, or none. It holds your business logic, and it decides what should happen next without performing any of it, which is what makes testing it a function call:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-decide

A workflow has a beginning, a middle and an end, and each is worth writing on its own.

### Begin it {#begin}

The first message starts the run. Return the record that it began and the work to be done in one result, so the stream can never hold one without the other. An already-started group returns nothing, which makes a resubmitted command harmless, and an empty selection returns `GroupCheckoutRejected` so the clerk learns why nothing happened:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-initiate

### Continue it as replies arrive {#continue}

Each reply settles one stay and returns nothing while others are still outstanding. The last one to arrive completes the group, naming the stays that settled and those that refused. A reply for a stay that has already reported returns nothing, so a second copy of it cannot complete the group twice:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-complete{16,27-29}

### End it on a timeout {#end}

Nothing notices a reply that never arrives, so a workflow that waits needs a message to end the wait. Emmett does not schedule that message for you. Send `TimeoutGroupCheckout` from your scheduler once a run has been open longer than you allow, and record which stays were still outstanding when it fired:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-timeout

## Rebuild the State from the Stream {#evolve}

`evolve` moves the state on from one recorded message. Both the messages received and the decisions taken shape it, which is why they share a stream: `GroupCheckoutInitiated` sets up the tally of stays, and each reply marks one off. Return the state unchanged for anything that does not move the machine:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-evolve{14-16,28-33}

Replaying the stream is also how a run resumes after a restart. The state is derived, so there is nothing else to restore.

## Assemble the Workflow {#assemble}

Put the three functions together with a name. The name identifies every stream this workflow writes and prefixes every input it records:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-definition

## Test the Decisions {#test}

A decision needs only a message and a state, so testing it takes no event store, processor, or clock. Give the specification the messages that put the run in the state you want, then the message under test:

<<< @./../packages/emmett/src/testing/workflowSpecification.unit.spec.ts#workflow-specification

<<< @./../packages/emmett/src/testing/workflowSpecification.unit.spec.ts#workflow-test-initiate

**Most messages should decide nothing**, and that is what a happy-path test misses. One stay of two has settled here, so the group stays open:

<<< @./../packages/emmett/src/testing/workflowSpecification.unit.spec.ts#workflow-test-nothing-happened

Cover each way the workflow should hold still: a reply for a group that never started, a second copy of a reply, a reply arriving after the group finished.

## Run It {#run}

`WorkflowHandler` puts one message through the workflow against an event store, with no consumer involved. Use it where the message comes from a caller rather than a subscription, such as the clerk's request that starts the run:

<<< @./../packages/emmett/src/workflows/handleWorkflow.unit.spec.ts#workflow-handler-usage

It resolves the workflow id, reads `emt:workflow:GroupCheckoutWorkflow:<id>`, replays it, runs the decision, and appends the input together with the decisions in a single write. The stream then holds the message that arrived and everything decided because of it:

<<< @./../packages/emmett/src/workflows/handleWorkflow.unit.spec.ts#workflow-stream-contents

Recorded inputs carry the workflow's name as a prefix; outputs do not, because they exist nowhere else. Inputs are copies of messages that already live in their own streams, and the prefix is what keeps a consumer of `GuestCheckedOut` from also seeing every group's copy of it.

## Register the Processor {#register}

The replies arrive in the background, so the rest of the run belongs to a processor. It needs to know which message types concern the workflow and which run each one belongs to. Inputs are mostly events and outputs mostly commands. Both are listed by name, because TypeScript types do not survive to runtime, and both are checked against your unions, so a type that is neither will not compile.

`getWorkflowId` answers the correlation question. Performing a `CheckOut` is what eventually causes a `GuestCheckedOut`, and that event has to find its way back to the run that asked for it. The group id it carries is what identifies that run:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-options{7}

Return `null` for a message that belongs to no run and the workflow leaves it alone. A guest checking out on their own carries no group id, so no stream is created and nothing is appended:

<<< @./../packages/emmett/src/workflows/handleWorkflow.unit.spec.ts#workflow-unrouted-input

Register the options on your store's consumer. PostgreSQL, SQLite, MongoDB, and EventStoreDB each supply the processor wired to their locking and checkpointing:

<<< @./../packages/emmett-postgresql/src/eventStore/consumers/postgreSQLEventStoreConsumer.workflow.int.spec.ts#workflow-consumer-registration

## Carry Out the Decisions {#output-handler}

A workflow records what should happen; making it happen is a separate job. Because the decisions sit in the workflow's own stream, that stream doubles as an outbox: the consumer reads it and hands each recorded decision to a handler that performs it. Name the types the handler claims:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-output-handler

Here the handler settles one stay against the property management system and returns what happened, either `GuestCheckedOut` or `GuestCheckoutFailed`. Whatever it returns is appended to the workflow's stream as the next input, so the group id travels out with the request and back with the reply:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-side-effect{3,11,19}

Give the processor the handler along with the same options:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-processor

## Keep an Outcome Out of the Stream {#reject-workflow-output}

Recording a decision is what causes it to be dispatched, which is usually what you want. Sometimes it is not: an empty selection produces `GroupCheckoutRejected`, which the clerk needs in the response but which no handler should act on. `rejectOn` returns it to the caller and keeps it out of the stream:

<<< @./../packages/emmett/src/workflows/handleWorkflow.middleware.unit.spec.ts#workflow-output-rejection

The input is still recorded, so resending the same command is recognised as a repeat rather than starting a second run. Use this only when nothing downstream needs the outcome; otherwise let the workflow record it like any other decision.

`skipOn` drops an outcome and continues, `stopOn` drops it and stops, and `stopAfter` records it before stopping. The [Workflows reference](/api-reference/workflows#decision-middleware) has their exact contracts.

## Handle Redelivery {#redelivery}

**The same message will arrive twice.** A consumer can handle one and restart before writing its checkpoint, and a version conflict re-runs another. The message's own id closes the gap: every recorded input keeps the id of the message it came from, and rebuilding the state collects them. A message whose id is already among them is dropped before the decision runs, so nothing is appended and the input is not recorded a second time:

<<< @./../packages/emmett/src/workflows/handleWorkflow.unit.spec.ts#workflow-idempotent-redelivery

This works on the id the message carries. Messages delivered by a consumer have one. If you call `WorkflowHandler` yourself with a message that has no `metadata.messageId`, each call gets a fresh id and the workflow handles it again.

That covers one message arriving twice. Two different messages reporting the same stay carry different ids and both reach the decision, which is why the guard in [Continue it as replies arrive](#continue) is there as well.

## Best Practices {#best-practices}

### Decide From the Message and State Alone {#keep-pure}

A decision that reads a clock or calls a service answers differently on each attempt, and attempts are common: a version conflict retries it, and a redelivered message runs it again. Each `CheckOut` above carries the timestamp from the clerk's command instead of reading the clock, which is also what lets the tests assert exact times. Work that has to reach outside belongs in an output handler.

### Let the Decision Return Nothing {#return-nothing}

A message that concerns the run but changes nothing should still reach the decision and come back empty, rather than be filtered out on the way in. The input is recorded either way:

<<< @./../packages/emmett/src/workflows/handleWorkflow.unit.spec.ts#workflow-no-output

A `GuestCheckedOut` for a group that was never initiated leaves `GroupCheckoutWorkflow:GuestCheckedOut` in the stream and nothing after it. When a run stalls, that record is what separates a reply that arrived and changed nothing from one that never arrived.

### Report Failures as Events {#failures-as-events}

An unpaid balance is not a fault, it is the answer the group needs in order to finish. Throwing turns it into one, and because an output handler runs in the background with no caller to unwind to, the throw stops the processor and the stays queued behind it go unattempted. Return `GuestCheckoutFailed` and let the decision settle it. See [Error Handling](/guides/error-handling#no-throw-async).

## Troubleshooting {#troubleshooting}

### The Workflow Never Starts {#never-starts}

If no stream appears for a run, the message never reached the decision, and there are two causes. Either its type is not among the registered inputs, so the processor ignored it, or `getWorkflowId` found no id on it and returned `null`. The second is easy to miss, because it is also correct behaviour: a guest checking out on their own belongs to no group. Check that the message you appended carries the id the router reads.

### Decisions Are Recorded but Nothing Runs {#outputs-not-dispatched}

If a `CheckOut` sits in the stream and no checkout happens, no output handler claimed it. The workflow records decisions and a handler performs them, but only for the types in its `canHandle`. Add the type there, as [Carry Out the Decisions](#output-handler) shows.

### A Run Stalls Halfway {#stalls}

A run that stays open is waiting for a reply that never came. The usual cause is an output handler that threw instead of reporting a failure: the throw stopped the processor, so the stays behind it were never attempted. The other cause is a system that never answers, which no error handling can fix, so give the run a [timeout](#end). Either way, watch for runs that began and never finished within the time you expect, because nothing else will report them.

## Further Readings {#readings}

- [API Reference: Workflows](/api-reference/workflows)
- [Command Handling](/guides/command-handling)
- [Testing](/guides/testing)
- [Error Handling](/guides/error-handling)
- [The Workflow Pattern](https://blog.bittacklr.be/the-workflow-pattern.html) by Yves Reynhout
- [How TypeScript can help in modelling business workflows](https://event-driven.io/en/how_to_have_fun_with_typescript_and_workflow/)
- [Event-driven distributed processes by example](https://event-driven.io/en/event_driven_distributed_processes_by_example/)
- [How to build an in-memory Message Bus in TypeScript](https://event-driven.io/en/inmemory_message_bus_in_typescript/)
