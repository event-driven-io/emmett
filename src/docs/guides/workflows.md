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

Start with the state, because the decisions are written against it. A workflow's state holds what those decisions need and nothing else. For a workflow that waits on several things, that is usually where the run has got to and what it is still waiting for:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-state

Keep it that small. It is rebuilt on every message, and anything the decisions never read is weight for no return. Read more in [Slim your entities with Event Sourcing](https://event-driven.io/en/slim_your_entities_with_event_sourcing/).

## Write the Business Logic {#decision}

Now the decisions. `decide` takes the message that arrived and the current state, and returns what should happen next:

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

Give any workflow that waits a message that ends the wait. **Emmett has no scheduling of its own yet, so nothing in the library will send that message.** It has to come from outside: a cron job, your platform's scheduler, a delayed queue, or whatever your deployment already runs. Send it once a run has been open longer than you allow, and record what was still outstanding when it fired:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-timeout

A timeout arrives at whatever point the run had reached, so its result has to report all three groups: the stays that completed, the ones that failed, and the ones that never came back at all. That last group only exists on this path:

<<< @./../packages/emmett/src/testing/workflowSpecification.unit.spec.ts#workflow-test-timeout

## Build State from Messages {#evolve}

The decisions read a state that nothing has built yet, and `evolve` is what builds it. A workflow's stream holds both sides of the run, the messages it received and the decisions it took, and `evolve` folds them into the state those decisions see:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-evolve{14-16,28-33}

Return the state unchanged for a message that does not apply, rather than throwing. The stream is replayed in full every time the run is read.

That replay is also what recovery is. A process that dies part way through restarts, reads the stream, and carries on from what it finds. There is no separate checkpoint to reconcile.

## Put the Workflow Together {#assemble}

That is all three functions. A workflow is those plus a name:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-definition

The name identifies every stream this workflow writes, and it prefixes every input it records.

## Test the Decisions {#test}

Nothing so far has touched an event store, which is what makes the decisions testable on their own. Testing them needs no event store, no processor and no clock.

::: tip For workflows, the testing pattern looks like this:

- **GIVEN** the messages recorded for the run so far,
- **WHEN** a new message arrives,
- **THEN** we get the decisions the workflow takes.

:::

<<< @./../packages/emmett/src/testing/workflowSpecification.unit.spec.ts#workflow-specification

<<< @./../packages/emmett/src/testing/workflowSpecification.unit.spec.ts#workflow-test-initiate

Then the part a happy-path test never reaches. **Most messages should decide nothing.** A workflow spends most of its life waiting, so the branch that returns an empty result runs far more often than the branch that ends the run. When it is wrong it does not throw: the run either finishes early on a partial count, or stays open forever because the message that should have completed it was ignored. Both look like the workflow is working until someone goes looking:

<<< @./../packages/emmett/src/testing/workflowSpecification.unit.spec.ts#workflow-test-nothing-happened

Then the endings. A run finishes in one of three ways, and they differ in what they can say about the stays. A completed group settled all of them. A failed one settled some and had others refuse, and it names both, because the outcome of each stay is known either way. Here every stay refused:

<<< @./../packages/emmett/src/testing/workflowSpecification.unit.spec.ts#workflow-test-failed

Cover each way a run should hold still too: a message for a run that never started, a duplicate, and one that arrives after the run has finished.

## Decide in the Request or in the Background {#sync-vs-async}

The workflow is complete, and nothing runs it yet. Messages reach it one of two ways, and which one you pick depends on whether anything is waiting for the answer.

Some messages have a caller waiting on it. A clerk pressing "check out group" wants to know the group started and what it is doing; an approver clicking "approve" wants to know the approval registered and whether it was the last one needed. Handle those in the request.

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

## Call External Systems from the Output Handler {#output-handler}

Registering the processor gets messages in and decisions recorded. Nothing yet performs them, which is the job deferred back when `decide` returned messages instead of sending them. The output handler performs them. The consumer reads each recorded decision from the run's stream and routes it by type, so the decision never had to say where its message should go:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-output-handler

The handler is where the workflow reaches anything outside itself, which is broader than calling over the network. It is an ordinary asynchronous function: it can call a service in the same process, handle a command against another stream, write to another database, put a message on a queue, or call an HTTP API. It is also how you reach something that nothing reacts to on its own, since a decision only gets acted on if something handles the message it produced. Whatever the handler returns is appended to the run's stream as the next input, which is how the answer finds its way back into the decision:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-side-effect{3,11,19}

Return failures rather than throwing, because a refusal from the external system is usually an answer the run needs, while a throw stops the processor and everything queued behind it. Carry the workflow id out and back, or the reply cannot be routed to the run that asked for it. And expect the handler to run more than once for the same decision, because a restart before the checkpoint is written redelivers it, so make the call safe to repeat or make the target idempotent.

Give the processor the handler alongside the same options:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-processor

## Keep the Id on Every Message {#correlation}

That round trip only works while the id survives it. A decision goes out as one message and its result comes back as another, handled by different code at different times. The workflow id is the only thing linking them, and it has to survive three legs: the decision puts it on the outgoing message, the code handling that message copies it onto whatever it produces, and `getWorkflowId` reads it back off.

Lose it anywhere along the way and the reply lands in some other stream and stops there. The run stays open and nothing complains, because from the workflow's side a reply that was never correlated looks exactly like one that never happened.

## Read a Run's History {#observability}

Everything above writes to one stream per run, and that stream is what you read when you need to know what a run did. Everything it did is there, in order:

<<< @./../packages/emmett/src/workflows/handleWorkflow.unit.spec.ts#workflow-stream-contents

Inputs and outputs interleave, so the stream is the run's inbox and its outbox at once. Each message also records its part in the run:

<<< @./../packages/emmett/src/workflows/handleWorkflow.unit.spec.ts#workflow-message-actions

`InitiatedBy` marks the message that started the run, `Received` each later arrival, and `Sent` or `Published` each decision taken. A group of three stays where one refuses reads like this:

| #   | Message                                       | Action        | Reads as                                 |
| --- | --------------------------------------------- | ------------- | ---------------------------------------- |
| 1   | `GroupCheckoutWorkflow:InitiateGroupCheckout` | `InitiatedBy` | Clerk started a group of three stays     |
| 2   | `GroupCheckoutInitiated`                      | `Published`   | The run announced itself                 |
| 3   | `CheckOut`                                    | `Sent`        | Stay 1 asked to settle                   |
| 4   | `CheckOut`                                    | `Sent`        | Stay 2 asked to settle                   |
| 5   | `CheckOut`                                    | `Sent`        | Stay 3 asked to settle                   |
| 6   | `GroupCheckoutWorkflow:GuestCheckedOut`       | `Received`    | Stay 1 settled, two still outstanding    |
| 7   | `GroupCheckoutWorkflow:GuestCheckoutFailed`   | `Received`    | Stay 2 refused, balance not settled      |
| 8   | `GroupCheckoutWorkflow:GuestCheckedOut`       | `Received`    | Stay 3 settled, all have now reported    |
| 9   | `GroupCheckoutFailed`                         | `Published`   | Group finished: two settled, one refused |

Rows 6 and 7 decided nothing and are recorded anyway, so the run shows the messages that arrived and changed nothing next to the ones that did. When support asks why one guest is still checked in, row 7 answers it: the stay refused, the balance was not settled, and it happened before the group finished.

The same records are what you need when the workflow decided wrongly. A status field tells you where a run ended up, not what it was told or what it decided from, so fixing a bad decision means reconstructing its inputs from whatever survived. Here they did survive: the message that arrived is in the stream next to the decision it produced, so you can work out what should have been decided from what was actually there at the time. Nothing is overwritten, so a run the bad build touched stays distinguishable from a run that merely moved on during the same window, and a correction is another message appended after the mistake rather than an edit on top of it. See [Fixing bugs in Event Sourcing is hard, for real?](https://www.architecture-weekly.com/p/fixing-bugs-in-event-sourcing-is) for how that plays out on a real incident.

Across runs, the same records support counting how many groups reach `GroupCheckoutTimedOut`, measuring the time between the first and last row, and grouping failures by reason.

Recorded inputs carry the workflow name as a prefix; outputs don't, because they exist nowhere else. An input is a copy of a message that also lives in its source stream, and the prefix keeps a consumer of that message type from picking up every run's copy as well.

### Alert on runs that never finish {#monitoring}

A run that began and never reached an outcome will not tell you about itself. Nothing throws, nothing retries, the stream simply stops. Watch for streams holding an `InitiatedBy` and none of the messages that end a run.

Take the window from the process rather than the framework. A group of stays should settle in minutes, while a review with three approvers may sit for days. A [timeout](#end) ends a stuck run; monitoring is what tells you runs are getting stuck in the first place.

## A Second Shape: One Step at a Time {#traffic-fine}

One example only shows one shape, and group checkout's has coloured how every piece looked so far. It fans out: one message produces work for every stay, and the run waits for all of them to report. Many processes are the other shape: one step at a time, where each reply decides the single next step and nothing runs in parallel.

Yves Reynhout's [The Workflow Pattern](https://blog.bittacklr.be/the-workflow-pattern.html), the article this design comes from, works through one of those, and it is the example here. A published police report that records a speeding violation has to end in a traffic fine being issued. The fine cannot be issued until a system number has been generated, and then a manual identification code, each by a different part of the system.

Three events come in and three commands go out:

<<< @./../packages/emmett/src/workflows/trafficFine.testHelpers.ts#traffic-fine-messages

The states are the steps, and each one carries what the steps after it will need:

<<< @./../packages/emmett/src/workflows/trafficFine.testHelpers.ts#traffic-fine-state

Group checkout's state held a tally, because it waited on many things at once. This one holds a position in a line and the values collected so far.

`decide` reads as the state machine. Each input has one branch:

<<< @./../packages/emmett/src/workflows/trafficFine.testHelpers.ts#traffic-fine-decide

The first message decides whether there is a run at all. A parking violation produces nothing, so the run finishes where it started:

<<< @./../packages/emmett/src/workflows/trafficFine.testHelpers.ts#traffic-fine-report-published

Each later message triggers exactly one next step, and takes from the state what the arriving message does not carry:

<<< @./../packages/emmett/src/workflows/trafficFine.testHelpers.ts#traffic-fine-continue

That is what the state is for in this shape. `IssueTrafficFine` needs the police report id, the system number and the identification code, and no single message carries all three. The system number arrived a step earlier, so `evolve` copies it onto the next state as the run moves along:

<<< @./../packages/emmett/src/workflows/trafficFine.testHelpers.ts#traffic-fine-evolve

The pieces go together the same way:

<<< @./../packages/emmett/src/workflows/trafficFine.testHelpers.ts#traffic-fine-definition

Registering it has one difference worth noticing. Every message here carries the police report id, so the router never has to return `null`, and each input is an event while each output is a command:

<<< @./../packages/emmett/src/workflows/trafficFine.testHelpers.ts#traffic-fine-options

The test for the last step shows the chain from outside. Given a report and a generated system number, one message produces a command holding all three values:

<<< @./../packages/emmett/src/workflows/trafficFine.unit.spec.ts#traffic-fine-test-issue

A completed run reads as a straight alternation, which is the shape Yves writes out as a workflow's event log:

| #   | Message                                                                 | Action        |
| --- | ----------------------------------------------------------------------- | ------------- |
| 1   | `IssueTrafficFineWorkflow:PoliceReportPublished`                        | `InitiatedBy` |
| 2   | `GenerateTrafficFineSystemNumber`                                       | `Sent`        |
| 3   | `IssueTrafficFineWorkflow:TrafficFineSystemNumberGenerated`             | `Received`    |
| 4   | `GenerateTrafficFineManualIdentificationCode`                           | `Sent`        |
| 5   | `IssueTrafficFineWorkflow:TrafficFineManualIdentificationCodeGenerated` | `Received`    |
| 6   | `IssueTrafficFine`                                                      | `Sent`        |

One difference from the article: it has `Began` and `Completed` entries bracketing the run, and a `Complete` decision the workflow returns to end itself. Emmett has neither. A run starts when its first message is recorded as `InitiatedBy`, and it is over when the state says so, which here is `Finished`. Nothing marks the end in the stream, so a run that reached its last step and one that stalled on the step before are told apart by the messages present rather than by a terminal entry.

## Handle Redelivery {#redelivery}

Both examples so far assumed each message arrives once. They do not. **The same message will arrive twice.** A consumer can handle one and restart before writing its checkpoint, and a version conflict re-runs another. Emmett detects the repeat from the message id. Every recorded input keeps the id of the message it came from, and rebuilding the state collects them. A message whose id is already there is dropped before the decision runs, so nothing is appended and the input is not recorded again:

<<< @./../packages/emmett/src/workflows/handleWorkflow.unit.spec.ts#workflow-idempotent-redelivery

This depends on the message carrying an id. Messages delivered by a consumer have one. If you call `WorkflowHandler` yourself with a message that has no `metadata.messageId`, each call gets a fresh id and the workflow handles it again.

That covers the same message arriving twice. Two different messages reporting the same fact carry different ids and both reach the decision, which is why the guard in [Continue it](#continue) is there as well.

## Return a Failure Without Acting on It {#reject-workflow-output}

Redelivery is handled for you. The last two sections are choices you make, and both are exceptions rather than defaults.

A workflow's decisions get dispatched because they were recorded, so anything `decide` returns will be acted on by something. Once in a while you want the opposite: the caller needs to see the outcome, but nothing downstream should do anything about it. An empty selection is one of those. `GroupCheckoutRejected` tells the clerk why the group never started, and no handler should act on it.

`rejectOn` returns the outcome to the caller and keeps it out of the stream:

<<< @./../packages/emmett/src/workflows/handleWorkflow.middleware.unit.spec.ts#workflow-output-rejection

The input is still recorded, so resending the same message is recognised as a repeat rather than starting a second run. Reach for this only when nothing downstream needs the outcome and you do not want it in the run's history. Otherwise let the workflow record it like any other decision.

`skipOn` drops an outcome and continues, `stopOn` drops it and stops, and `stopAfter` records it before stopping. The [Workflows reference](/api-reference/workflows#decision-middleware) has their exact contracts.

## Store the Input Before Deciding {#double-hop}

The second choice is how the write itself is split. By default the input and the decisions it produced are appended together in one write. If the process dies before that write, nothing is recorded, and the consumer redelivers the message because its checkpoint did not move.

`separateInputInboxFromProcessing` splits that into two hops. The first records the input in the run's stream and stops there. The processor then picks its own recorded copy back up and decides on it, which is why it subscribes to the prefixed types as well:

<<< @./../packages/emmett/src/workflows/workflowProcessor.unit.spec.ts#workflow-separate-inbox

The split makes accepting a message and deciding on it two separate, durable steps. The run's stream records what arrived even when deciding on it keeps failing, which is what you want when you need to see what a process was asked to do independently of what it made of it.

It costs an extra write and an extra delivery for every message, so every step takes a second round trip. The decision also no longer happens in the call that accepted the message, so nothing can be returned to a caller from it, which rules the mode out for the request-time path above.

Leave it off, which is the default, unless you need that separation.

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
