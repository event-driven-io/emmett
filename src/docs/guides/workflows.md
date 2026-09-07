---
documentationType: how-to-guide
outline: deep
---

# Workflows {#workflows}

**A workflow coordinates a business process that takes multiple steps.** Take a group checkout in a hotel. A clerk selects a set of guest stays and settles them in one go. Each stay is checked out on its own, the replies come back one at a time, and the group is done once every stay has answered. Nobody can hold an HTTP request open while that happens, so something has to remember which stays have reported and what to do when the last one does.

That something is the workflow. Each group the clerk starts becomes a **run**: one journey through the process, with its own id and its own history. The run receives the messages, keeps track of where it got to, and decides what should happen next.

Group checkout is our example throughout this guide. The shape is the same for a payment that is authorised, captured and sometimes refunded, an onboarding waiting on identity checks from two providers, or an order that reserves stock, charges a card and books a courier. When one of those goes wrong, somebody has to work out where it stopped and why.

Modelling group checkout this way gives you three things:

- **Coordination.** One place decides what the group does next, rather than that logic being spread across the handlers that happen to receive each stay's reply.
- **Predictability.** Decisions come from the arriving message and the current state alone. Nothing is read from a clock or another service, so the same reply always produces the same decision.
- **A record of the process.** Every message a run received and every decision it took is appended to that run's own stream, in order. When you need to know what happened to group checkout 123, you read one stream.

So when should you reach for one? When the next step depends on more than the message that just arrived. Group checkout qualifies: whether the group completed or failed depends on what all of its stays did, and no single reply carries that answer.

When nothing more than that message is needed, simpler tools do the job: a [command handler](/guides/command-handling) for one command against one stream, a [projection](/guides/projections) to turn events into something you can query, and a [reactor](/guides/error-handling#no-throw-async) to answer an event by sending the next command.

A **saga** coordinates a whole process from one place, the way a workflow does, but it keeps no state between steps. Each event becomes the next command from that event's data alone, and a failed step becomes a compensating command that undoes the work already done. Group checkout can't be written that way: `GuestCheckedOut` says one stay is settled and says nothing about the others, so no reply on its own can tell the group it's finished. **Choreography** drops the coordinator entirely and lets each service react to the event the previous one published. [Saga and Process Manager](https://event-driven.io/en/saga_process_manager_distributed_transactions/) compares them in depth.

Let's build the group checkout. For the full API surface, see the [Workflows reference](/api-reference/workflows).

## Model the Messages {#messages}

**Start with what goes in and what comes out.** Those two sets define the workflow:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-messages

The clerk's `InitiateGroupCheckout` starts a run. After that, a `GuestCheckedOut` or `GuestCheckoutFailed` arrives for each stay as the individual checkouts finish. `TimeoutGroupCheckout` ends a group that has been waiting too long.

Going the other way, `CheckOut` asks for one stay to be settled, and a run sends one per stay the clerk picked. The remaining outputs are the group's own outcomes: `GroupCheckoutInitiated` when it starts, `GroupCheckoutRejected` when it can't, and `GroupCheckoutCompleted`, `GroupCheckoutFailed` or `GroupCheckoutTimedOut` when it ends.

Inputs tend to be events and outputs tend to be commands, because a workflow reacts to what has already happened elsewhere and asks for what should happen next. It's a tendency rather than a rule, and both sets here mix the two. `InitiateGroupCheckout` is a command coming in. `GroupCheckoutCompleted` is an event going out, because it isn't a request to anyone: it's the fact the front desk and the reporting system are waiting for.

Notice that none of the outputs says where it should go. `CheckOut` carries no address and no queue name, because in Emmett deciding and dispatching are separate jobs. We'll come to the dispatching in [Carry the Decisions Out](#output-handler).

## Model the State {#state}

**Next, model what a run has to remember.** A group checkout hasn't started, is waiting for its stays, or is over:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-state

Every run begins at `NotExisting`, which `initialState` returns, and ends at `Finished`. Only `Pending` carries anything: one entry per stay the clerk selected, each holding that stay's `GuestStayStatus`.

A run needs that map to answer two questions. Is any stay still `Pending`? That tells the run whether the group can finish yet. And when none is, did every stay come back `Completed`, or did some come back `Failed`? That tells it how the group finishes.

It's keyed by stay id because replies come back one stay at a time, and the run has to find that particular stay's entry. A counter of replies would be smaller, but it wouldn't tell you which stay a reply belongs to, so a stay reporting twice would count twice and a stay that never reported would be invisible.

Keep the state this small. Emmett rebuilds it from the stream on every message, so a field no decision reads is work repeated for nothing. Read more in [Slim your entities with Event Sourcing](https://event-driven.io/en/slim_your_entities_with_event_sourcing/).

## Take the Decisions {#decision}

**Now the business logic itself.** `decide` takes the message that arrived and the current state, and returns the messages that should follow:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-decide

One branch per input, and `GroupCheckoutInput` keeps that complete: TypeScript checks the switch against the union, so an input you haven't handled stops the build.

**`decide` chooses what should happen. It never makes it happen.** It returns a `CheckOut` for each stay, but no room is released and no property management system is called. It doesn't send the command anywhere either, and it never reads the clock.

Emmett runs this function more than once for the same message. A version conflict re-runs it, and a redelivered message runs it again. A decision that read the clock or called a service would answer differently on each attempt. With only the message and the state to work from, the same input always gives the same result, and a test needs nothing but those two arguments.

Yves Reynhout, whose [Workflow Pattern](https://blog.bittacklr.be/the-workflow-pattern.html) this design comes from, suggests taking each stage of a run separately: what begins it, what keeps it going, and what ends it. Group checkout has one branch for each.

### Starting the group {#begin}

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-initiate

`initiateGroupCheckout` checks two things before it builds anything, and it answers them differently.

**If the run already exists, it decides nothing at all.** A clerk can double-click, and a message can be redelivered. Starting a second round would settle stays that are already settled and release rooms that may have been re-let since, so any status other than `NotExisting` returns an empty result.

**If the clerk picked no stays, it rejects the group.** That's a mistake at the front desk rather than a failure in the system, and deciding nothing here would look identical to a group that started fine. `GroupCheckoutRejected` names the reason, `NoGuestStays`, so the screen can tell the clerk what went wrong.

With both guards passed, it returns `GroupCheckoutInitiated` followed by one `CheckOut` per stay. They come back in a single result because Emmett appends them in a single write. Recording the group without its checkouts would leave a run waiting for replies nobody asked for; recording the checkouts without the group would settle stays with nothing tracking them.

Each `CheckOut` carries the timestamp from the clerk's command rather than a fresh `new Date()`. The stream then shows when the clerk acted rather than when the code happened to run, and the tests can assert exact values.

### Collecting the replies {#continue}

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-complete{16,27-29}

`completeGroupCheckout` runs for every `GuestCheckedOut` and `GuestCheckoutFailed` in the system, so it starts by working out whether the reply concerns a group at all. Guests check out on their own all day, and those events are the same type as these. Only the `groupCheckoutId` tells them apart, so a reply without one produces nothing, and so does a reply for a run that hasn't started or has already finished.

Next, `isAlreadyClosed` on the first highlighted line drops a reply from a stay that has already reported. Checkouts do get reported twice, either because the property management system retried or because the same message was delivered twice. A stay counted twice would make the group look complete while another guest is still checked in. The repeat is visible only because the run holds a `GuestStayStatus` per stay rather than a count.

Only then does the reply get recorded, and `areAnyOngoingCheckouts` decides what follows. **You can't know in advance which reply will be the last one.** Any of them might be, so every reply has to be able to finish the group. That's what the highlighted return does. If any stay is still `Pending`, it returns nothing and the run keeps waiting. When none is left, `finished` picks the ending: `GroupCheckoutCompleted` when every stay settled, `GroupCheckoutFailed` when any refused.

### Ending it {#end}

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-timeout

A reply that never arrives raises no error anywhere. There's no request left open to fail, so the run keeps waiting and no part of the system notices. Ending that wait takes a message of its own.

`TimeoutGroupCheckout` arrives at whatever point the group had reached, so `GroupCheckoutTimedOut` reports the stays three ways: `completedCheckouts`, `failedCheckouts`, and `incompleteCheckouts` for the ones that never came back. `incompleteCheckouts` appears on no other ending, because everywhere else all the stays have answered.

::: warning Emmett doesn't schedule messages yet

Nothing in the library will send `TimeoutGroupCheckout`. It has to come from outside: a cron job, your platform's scheduler, a delayed queue, or whatever already runs on a schedule where you deploy. It then reaches the workflow like any other input.

:::

## Build the State from Messages {#evolve}

**`decide` needs the current state, and `evolve` produces it.** Before every decision, Emmett replays the run's stream through `evolve`. That stream holds both the messages the run received and the decisions it took, so the state comes from the run's own history rather than from a row somebody has to keep up to date:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-evolve{14-16,28-33}

`GroupCheckoutInitiated` builds the map, one entry per stay the clerk selected. Each reply marks its own stay `Completed` or `Failed`. `GroupCheckoutCompleted`, `GroupCheckoutFailed` and `GroupCheckoutTimedOut` all move the run to `Finished`, because once it's over nothing needs to know how it got there.

`GroupCheckoutRejected` returns the state untouched. A rejected group never started, so there's nothing to move.

**Every case checks the current status first, and none of them throws.** The whole stream is replayed on every message, including messages written months ago by an older version of your code. A reply arriving after the group closed leaves it closed instead of reopening it or blowing up the run. Read more in [Should you throw an exception when rebuilding state from events?](https://event-driven.io/en/should_you_throw_exception_when_rebuilding_state_from_events/).

The `never` in the default branch is a compile-time check. Add an output to the union and forget to handle it here, and this stops building.

Replaying is also how a run recovers. A process that dies part way through reads the stream on restart and carries on from what it finds, with no checkpoint of the workflow's own to reconcile.

## Put the Workflow Together {#assemble}

We now have `decide`, `evolve` and the `initialState` from [Model the State](#state). A workflow definition bundles the three under a name:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-definition

The name ties the workflow to its storage. Each run gets its own stream called `emt:workflow:GroupCheckoutWorkflow:<groupCheckoutId>`, and the name also prefixes every input recorded there. [Read a Run's History](#observability) comes back to that.

## Test the Decisions {#test}

Nothing so far has touched an event store, so we can test the decisions on their own, with no storage and nothing running in the background.

::: tip For workflows, the testing pattern looks like this:

- **GIVEN** the messages recorded for the run so far,
- **WHEN** a new message arrives,
- **THEN** we get the decisions the workflow takes.

:::

<<< @./../packages/emmett/src/testing/workflowSpecification.unit.spec.ts#workflow-specification

The `given` messages are the ones the run's stream already holds: the inputs it received and the decisions it took. `WorkflowSpecification` replays them through `evolve` for us, so a test starts from a real point in the process rather than a state we put together by hand. Starting a group therefore begins with an empty `given`:

<<< @./../packages/emmett/src/testing/workflowSpecification.unit.spec.ts#workflow-test-initiate

Then there's the case a happy-path test never reaches. A group of two where only one stay has reported decides nothing, and that's correct:

<<< @./../packages/emmett/src/testing/workflowSpecification.unit.spec.ts#workflow-test-nothing-happened

A run spends most of its life in that branch, so it runs far more often than the branch that finishes a group. When it's wrong, nothing throws. The group either finishes on a partial count, with a guest still checked in, or never finishes at all because the reply that should have completed it was ignored. Both look like a working system from the outside. `thenNothingHappened` catches them.

Now the endings. Here both stays refuse, and the group fails:

<<< @./../packages/emmett/src/testing/workflowSpecification.unit.spec.ts#workflow-test-failed

`completedCheckouts` is empty here and `failedCheckouts` holds both stays. The failure event carries both lists because by then every stay's outcome is known, so whoever picks it up doesn't have to go looking for which ones went through.

`GroupCheckoutTimedOut` is the one ending where some stays are still unknown:

<<< @./../packages/emmett/src/testing/workflowSpecification.unit.spec.ts#workflow-test-timeout

Three stays, one settled, one refused, one never heard from. `guest-3` lands in `incompleteCheckouts`, the list of guests still checked in when the wait was cut off.

## Run the Workflow {#running}

The workflow's complete, and nothing runs it yet. Messages reach it in two ways, and the difference between them is whether anybody's waiting for the answer.

A clerk pressing "check out group" is waiting: they want to see the group start and which stays it covers. The stay replies that follow arrive minutes later on their own schedule, and nothing is waiting on them.

Most workflows use both. `InitiateGroupCheckout` is decided in the request, and the replies are decided in the background. Both go through the same `decide` against the same stream, so this is a choice about who's waiting, not about the business logic.

### Decide in the request {#run}

`WorkflowHandler` puts a single message through the workflow against an event store, with nothing running in the background:

<<< @./../packages/emmett/src/workflows/handleWorkflow.unit.spec.ts#workflow-handler-usage

::: info Handling a workflow message goes through these steps:

1. **Find the run.** `getWorkflowId` reads the id off the message.
2. **Rebuild its state.** Emmett reads that run's stream and folds it through `evolve`.
3. **Decide.** `decide` gets the message and that state.
4. **Record both.** The input and the decisions it produced are appended in a single write.

:::

The result holds the decisions, so the endpoint can answer with them: the group started, and here are the stays it's settling. Use it wherever a person is waiting: starting a run, registering an approval, or cancelling one.

### Decide in the background {#register}

For everything else, the workflow runs inside a **consumer**: the background process that reads messages out of your event store and hands them to whatever is registered to handle them. It supplies three things the workflow doesn't have on its own.

It delivers messages **one at a time and in order**, so two replies for the same run are decided one after the other rather than at once. It stores a **checkpoint**, so a restart picks up from the last message it handled instead of replaying the run from the beginning or skipping past it. And it holds a **lock on the processor**, so you can run several instances of your application for availability without two of them deciding for the same run.

Registering the workflow with it means saying which message types concern the workflow, and which run each message belongs to:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-options{7}

`inputs` and `outputs` list the types as strings because TypeScript types are erased at runtime, so the consumer has nothing else to match on. They're still checked against your unions, so a name belonging to neither won't compile.

`getWorkflowId` is the router, and the id it returns is the run's identity. Returning `null` means the message belongs to no run at all, which for group checkout is a guest checking out on their own. Nothing is read and no stream is created:

<<< @./../packages/emmett/src/workflows/handleWorkflow.unit.spec.ts#workflow-unrouted-input

Then hand those options to your store's consumer. PostgreSQL, SQLite, MongoDB and EventStoreDB each supply the processor wired to their own locking and checkpointing:

<<< @./../packages/emmett-postgresql/src/eventStore/consumers/postgreSQLEventStoreConsumer.workflow.int.spec.ts#workflow-consumer-registration

A request-time decision and a background one can still collide, because they run in different processes and the consumer's lock covers only its own. Every append to a workflow stream is guarded by the version that stream was read at. The second write therefore fails with `ExpectedVersionConflictError` rather than appending decisions taken from a state that has already moved on. Set `retry` to have Emmett read the stream again and decide from the current state.

## Carry the Decisions Out {#output-handler}

Runs now record `CheckOut` decisions and nothing performs them. **`decide` deferred that job when it returned messages instead of sending them, and an output handler takes it on.** The consumer reads each recorded decision from the run's stream and routes it by type. That's why the decision never had to say where its message should go:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-output-handler

Here `checkoutFromPms` handles `CheckOut` by calling the property management system to release the room:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-side-effect{3,11,19}

An output handler is where a workflow reaches anything outside itself, and that means more than an HTTP call. It's an ordinary asynchronous function, so it can just as well handle a command against another stream, write to another database, or put a message on a queue. It's how you reach a system that will never react to your messages on its own, such as a third-party API or an older service that only takes a direct call.

Three things about this handler matter.

**It returns a message rather than throwing.** The highlighted return type is `GuestCheckedOut | GuestCheckoutFailed`, and whatever comes back is appended to the run's stream as the next input, which is how the answer reaches the next decision. An unsettled bar tab isn't a fault, it's the answer the group is waiting for. Throwing instead would stop the processor and leave every message queued behind it unattempted, so one unpaid tab would strand the rest of the group. See [Error Handling](/guides/error-handling#no-throw-async).

**It copies the run's id onto the reply.** Both highlighted `groupCheckoutId` lines put it back on the message they return. That id is the only thing linking a decision to the answer it produces, and it has to survive three legs. `decide` puts it on the outgoing message, the code handling that message copies it onto whatever it produces, and `getWorkflowId` reads it back off. Drop it anywhere along the way and the guest is still checked out correctly, but the reply lands in some other stream and stops there. The run then waits for an answer that already came back, and nothing complains, because a reply that was never correlated looks exactly like one that never happened.

**It can run twice for the same decision.** A restart before the checkpoint is written redelivers it, so make the call safe to repeat or make the target idempotent.

Give the processor the handler alongside the same options:

<<< @./../packages/emmett/src/workflows/workflow.testHelpers.ts#workflow-processor

## Read a Run's History {#observability}

Everything so far writes to one stream per run, and you read that stream when you need to know what a run did:

<<< @./../packages/emmett/src/workflows/handleWorkflow.unit.spec.ts#workflow-stream-contents

Inputs and outputs interleave, so the stream is the run's inbox and its outbox at once. Each entry also records its part in the run:

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

When support asks why one guest is still checked in, row 7 answers it on its own: the stay refused, the balance wasn't settled, and it happened before the group finished.

Rows 6 and 7 decided nothing and are recorded anyway. So is a message that reached a run that doesn't exist:

<<< @./../packages/emmett/src/workflows/handleWorkflow.unit.spec.ts#workflow-no-output

Nothing's appended as an outcome, but the input is in the stream. **That separates a message that arrived and changed nothing from one that never arrived at all**, and when a run has stalled it's usually the first thing you want to know.

You need the same records when the workflow decided wrongly. A status column tells you where a run ended up. It doesn't tell you what the run was told or what it knew at the time, so fixing a bad decision means piecing its inputs back together from whatever survived. Here they did survive: the message that arrived sits next to the decision it produced, so you can work out what should have been decided from what was actually there. Nothing is overwritten either, so you can tell which runs the faulty build actually decided for rather than guessing from every run that happened to change while it was deployed. A correction goes in as another message after the mistake, rather than as an edit on top of it. See [Fixing bugs in Event Sourcing is hard, for real?](https://www.architecture-weekly.com/p/fixing-bugs-in-event-sourcing-is) for how that plays out on a real incident.

Across runs, the same records answer how many groups reach `GroupCheckoutTimedOut`, how long the average group takes from its first row to its last, and which reasons come up most often in the failures.

One detail in the table needs explaining. Recorded inputs carry the workflow name as a prefix, while outputs don't. An input is a copy of a message that also lives in its source stream, and the prefix keeps a consumer of `GuestCheckedOut` from picking up every group's copy as well as the original. Outputs need no prefix, because the run's stream is the only place they exist.

### Runs that never finish {#monitoring}

A run that began and never reached an outcome won't report itself. Nothing throws and nothing retries, and the stream stops at the last message it received. Watch for streams holding an `InitiatedBy` and none of the messages that end a run, and take the window from the process rather than from the framework. A group of stays should settle in minutes, while a review with three approvers may sit for days.

## A Second Workflow: One Step at a Time {#traffic-fine}

Group checkout fans out. One message produces work for every stay, and the run waits for all of them. Plenty of processes are the opposite shape: a line, where each reply decides the single next step and nothing runs in parallel. The state does a different job there, so let's build one.

Yves Reynhout works through exactly that in [The Workflow Pattern](https://blog.bittacklr.be/the-workflow-pattern.html), the article Emmett's design comes from. His example, written with Emmett's abstractions, goes like this. A police report recording a speeding violation has to end with a traffic fine issued to whoever the vehicle is registered to. Before the fine can go out, two things have to be generated, one after the other: a system number that identifies the fine across the rest of the system, then a manual identification code. The code exists because the person the car is registered to may have no digital identity, and they still need something to quote when they want to view, pay or contest the fine.

Three events come in and three commands go out:

<<< @./../packages/emmett/src/workflows/trafficFine.testHelpers.ts#traffic-fine-messages

Each state is a step of the process:

<<< @./../packages/emmett/src/workflows/trafficFine.testHelpers.ts#traffic-fine-state

Group checkout's state held a tally because it waited on many things at once. A traffic fine waits on one thing at a time, so its state holds a position in the line plus the values gathered so far. `IssueTrafficFine` explains why: it needs the police report id, the system number and the manual identification code together, and no single message carries all three. The report id arrives first and the system number a step later, so the state has to carry them forward.

`decide` is that state machine written out, one branch per input:

<<< @./../packages/emmett/src/workflows/trafficFine.testHelpers.ts#traffic-fine-decide

`reportPublished` decides whether there is a run at all:

<<< @./../packages/emmett/src/workflows/trafficFine.testHelpers.ts#traffic-fine-report-published

Not every police report is about speeding. A parking violation produces nothing, and the run is over where it started. It still has a stream holding the report that arrived, which is how you tell a report the workflow considered and dismissed from one that never reached it.

Each later message triggers exactly one next step:

<<< @./../packages/emmett/src/workflows/trafficFine.testHelpers.ts#traffic-fine-continue{25-27}

Look at where the three values on `IssueTrafficFine` come from. Two are read off `state` and only the third off the arriving message, because `TrafficFineManualIdentificationCodeGenerated` reports the code and the report id and nothing else.

`evolve` put them there:

<<< @./../packages/emmett/src/workflows/trafficFine.testHelpers.ts#traffic-fine-evolve{21-22}

Each transition copies forward what the steps after it will need. The highlighted lines take the report id off the previous state and the system number off the message that just arrived. By the time the code is generated, the state already holds everything the fine needs.

The definition looks the same as before:

<<< @./../packages/emmett/src/workflows/trafficFine.testHelpers.ts#traffic-fine-definition

Registering it differs in two ways:

<<< @./../packages/emmett/src/workflows/trafficFine.testHelpers.ts#traffic-fine-options

Every message here carries the police report id, so `getWorkflowId` never returns `null`. There's no equivalent of a guest checking out on their own. And `inputs` is all events while `outputs` is all commands, where group checkout mixed the two.

The test for the last step shows the whole chain from outside. Given a report and a generated system number, one message produces a command holding all three values:

<<< @./../packages/emmett/src/workflows/trafficFine.unit.spec.ts#traffic-fine-test-issue

A completed run reads as a straight alternation, which is the event log Yves writes out in the article:

| #   | Message                                                                 | Action        |
| --- | ----------------------------------------------------------------------- | ------------- |
| 1   | `IssueTrafficFineWorkflow:PoliceReportPublished`                        | `InitiatedBy` |
| 2   | `GenerateTrafficFineSystemNumber`                                       | `Sent`        |
| 3   | `IssueTrafficFineWorkflow:TrafficFineSystemNumberGenerated`             | `Received`    |
| 4   | `GenerateTrafficFineManualIdentificationCode`                           | `Sent`        |
| 5   | `IssueTrafficFineWorkflow:TrafficFineManualIdentificationCodeGenerated` | `Received`    |
| 6   | `IssueTrafficFine`                                                      | `Sent`        |

One difference from the article: it brackets the run with `Began` and `Completed` entries, and the workflow returns a `Complete` decision to end itself. Emmett has neither. A run starts when its first message is recorded as `InitiatedBy`, and it's over when the state says so, which here is `Finished`. Nothing marks the ending in the stream, so you tell a run that reached its last step from one that stalled on the step before by which messages are there.

## Handle Redelivery {#redelivery}

Both examples so far read as if each message arrives once. **Some of them will arrive twice.** A consumer can handle a message and restart before writing its checkpoint, and a version conflict re-runs the decision.

Emmett recognises the repeat from the message id. Every recorded input keeps the id of the message it came from, and rebuilding the state collects them. A message whose id is already there is dropped before `decide` runs, so nothing is appended and the input isn't recorded a second time:

<<< @./../packages/emmett/src/workflows/handleWorkflow.unit.spec.ts#workflow-idempotent-redelivery

This works as long as the message carries an id. Messages delivered by a consumer have one. If you call `WorkflowHandler` yourself with a message that has no `metadata.messageId`, each call gets a fresh id and the workflow handles it again.

That covers the same message arriving twice. Two different messages reporting the same fact carry different ids and both reach the decision, so the `isAlreadyClosed` guard from [Collecting the replies](#continue) still has to be there.

## Return an Outcome Without Recording It {#reject-workflow-output}

Redelivery is handled for you. The two settings below are yours to choose, and both are exceptions rather than defaults.

Anything `decide` returns is recorded, and anything recorded gets dispatched. Sometimes you want the opposite: the caller needs the outcome, but nothing downstream should act on it. `GroupCheckoutRejected` is one of those. It's there to tell the clerk why the group never started, and no handler should pick it up.

`rejectOn` returns the outcome to the caller and keeps it out of the stream:

<<< @./../packages/emmett/src/workflows/handleWorkflow.middleware.unit.spec.ts#workflow-output-rejection

The input is still recorded, so resending the same command is still recognised as a repeat rather than starting a second run. Use this only when nothing downstream needs the outcome and you don't want it in the run's history. Otherwise let the workflow record it like any other decision.

`skipOn` drops an outcome and continues, `stopOn` drops it and stops, and `stopAfter` records it before stopping. The [Workflows reference](/api-reference/workflows#decision-middleware) has their exact contracts.

## Record the Input Before Deciding {#double-hop}

The other setting changes how the write itself is split. By default the input and the decisions it produced are appended together in one write. If the process dies before that write, nothing's recorded, and the consumer redelivers the message because its checkpoint didn't move.

`separateInputInboxFromProcessing` splits that into two hops. The first records the input in the run's stream and stops there. The processor then picks its own recorded copy back up and decides on it, which is why it subscribes to the prefixed types as well:

<<< @./../packages/emmett/src/workflows/workflowProcessor.unit.spec.ts#workflow-separate-inbox

Accepting a message and deciding on it become two separate durable steps. The run's stream then shows what arrived even when deciding on it keeps failing. A message the workflow can't handle stays visible in the run's own history, not only in the consumer's error log.

The mode changes what `evolve` sees. In the default mode it replays the recorded inputs and the decisions together. Here the recorded inputs are skipped, and the state is built from the run's own decisions alone.

It costs an extra write and an extra delivery for every message, so every step takes a second round trip. The decision also no longer happens in the call that accepted the message, so nothing can be returned to a caller, which rules the mode out for the request-time path. Leave it off, which is the default, unless you need that separation.

## Troubleshooting {#troubleshooting}

### The Workflow Never Starts {#never-starts}

If no stream appears for a run, the message never reached the decision, and there are two causes. Either its type isn't among the registered `inputs`, so the processor ignored it, or `getWorkflowId` found no id on it and returned `null`. A `null` is easy to miss, because it's also correct behaviour: a guest checking out on their own belongs to no group. Check that the message you appended carries the id the router reads.

### Decisions Are Recorded but Nothing Runs {#outputs-not-dispatched}

If a decision sits in the stream and nothing happens, no output handler claimed it. The workflow records decisions and a handler performs them, but only for the types in its `canHandle`. Add the type there, as [Carry the Decisions Out](#output-handler) shows.

### A Run Stalls Halfway {#stalls}

A run that stays open is waiting for a reply that never came, so read its stream. If the outgoing message is there and no reply follows it, look at the output handler first. A throw instead of a returned failure stops the processor and leaves everything queued behind it unattempted. The other possibility is that the reply was produced without the run's id, so it never found its way back. If the reply is there and the run still didn't finish, the guard in the decision is wrong.

## Further Readings {#readings}

- [API Reference: Workflows](/api-reference/workflows)
- [Command Handling](/guides/command-handling)
- [Testing](/guides/testing)
- [Error Handling](/guides/error-handling)
- [The Workflow Pattern](https://blog.bittacklr.be/the-workflow-pattern.html) by Yves Reynhout
- [Saga and Process Manager - distributed processes in practice](https://event-driven.io/en/saga_process_manager_distributed_transactions/)
- [How TypeScript can help in modelling business workflows](https://event-driven.io/en/how_to_have_fun_with_typescript_and_workflow/)
- [Event-driven distributed processes by example](https://event-driven.io/en/event_driven_distributed_processes_by_example/)
- [How to build an in-memory Message Bus in TypeScript](https://event-driven.io/en/inmemory_message_bus_in_typescript/)
