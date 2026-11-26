# Plan: In-memory event store consumer and required `consumer()`

Revision: 6. Built from spec r16.

Spec: `spec.md`. Q&A: `qa.md`.

## Terms

- **Global log**: the single `inMemoryMessageSource` an in-memory store creates when the store is created. `appendToStream` adds every appended event to it, in global position order. All consumers of that store read from it.
- **Store consumer**: the consumer returned by `getInMemoryEventStore(...).consumer(...)`. It reads the global log and uses the store as its message store.
- **Standalone consumer**: the consumer returned by `inMemoryEventStoreConsumer({ source, messageStore, ...config })`.
- **Message store**: the `EventStore` a consumer puts in `context.session.messageStore`. Workflow processors append their output through it, and reactors can append through it.
- **Message-store rule**: when the consumer's message store is an in-memory store (it has a `database` member, checked once when the factory is called), in-memory processors the consumer creates from options without their own database get `messageStore.database` through `connectionOptions.database`. Otherwise they keep their own fresh database. Already built processors are not changed.
- **Caught-up signal**: the `MessageSourceCaughtUp` control message a source yields once it has delivered everything it holds.
- **Copied SQLite scenario**: a scenario from a SQLite consumer suite that is not tied to SQL, copied to the in-memory consumer with the same name and outcome.

---

## Step 1. Push-based `inMemoryMessageSource`

```text
Use the `implement-step` skill.

What to build
`inMemoryMessageSource` pushes messages to its readers instead of polling. A reader gets every message after its start position, then a caught-up signal, then waits without a timer. When `append(...)` adds messages, waiting readers wake straight away, get the new messages, then another caught-up signal. The `pullingFrequencyInMs` option is removed.

Context
- `src/packages/emmett/src/consumers/inMemoryMessageSource.ts` builds the source on `pollingMessageSource` today, with options `messages?`, `batchSize?`, `pullingFrequencyInMs?`, and an `append(...)` method.
- Spec decision: build it on `subscriptionMessageSource` (`src/packages/emmett/src/consumers/messageSources/subscriptionMessageSource.ts`). Options become `messages?` and `batchSize?`. `append(...)` and `readLastMessageCheckpoint()` keep their behaviour. `batchSize` is passed to `subscriptionMessageSource`, as the MongoDB source does; the source does no chunking. A read resolves its start from `'BEGINNING'`, `'END'` (the last checkpoint when the read starts) or a checkpoint, yields every message after it, then `MessageSourceCaughtUp`, then waits until `append(...)` adds messages or the read's signal aborts; after each burst it yields the new messages and another `MessageSourceCaughtUp`.
- It keeps scanning its array to find messages after a checkpoint (Out of Scope: no slicing by position).

Similar code
- `subscriptionMessageSource` and how `src/packages/emmett-mongodb/src/eventStore/consumers/messageSource/mongoDBMessageSource.ts` builds a `subscribe` async iterable on it.
- `pollingMessageSource` for when `MessageSourceCaughtUp` is yielded today.
- Existing tests: `src/packages/emmett/src/consumers/inMemoryMessageSource.unit.spec.ts`, `messageSources/subscriptionMessageSource.unit.spec.ts`.

Blocked by
None.

Acceptance criteria
- 12.1 GIVEN messages appended before reading WHEN reading from the beginning THEN the reader gets all of them, then a "caught up" signal.
- 12.2 GIVEN a reader that caught up AND timers that never advance WHEN messages are appended THEN the reader gets them, then another "caught up" signal, without any timer firing.
- 12.2a GIVEN a reader that caught up and is waiting WHEN nothing is appended THEN the source has no pending timer.
- 12.3 GIVEN a read from a checkpoint WHEN reading THEN the reader gets only messages after that checkpoint.
- 12.4 GIVEN messages appended WHEN the last checkpoint is asked for THEN it is the checkpoint of the last appended message; GIVEN an empty source THEN there is none.
- 12.5 GIVEN two readers WHEN both read the same source THEN each gets every message independently.
- 12.6 GIVEN a reader waiting for messages WHEN its signal aborts THEN the read ends.
- 12.7 GIVEN `inMemoryMessageSource` options WHEN `pullingFrequencyInMs` is passed THEN it does not compile.

Tests
- 12.1 (protects existing behaviour): reads everything appended so far from the beginning, then reports caught up - asserts the read yields all messages in order followed by one `MessageSourceCaughtUp`.
- 12.2: delivers appended messages to a caught-up reader without any timer - with Vitest fake timers never advanced, asserts the appended messages and a second `MessageSourceCaughtUp` arrive.
- 12.2a: waiting reader schedules no timer - with fake timers, asserts `vi.getTimerCount()` is 0 while the caught-up reader waits.
- 12.3 (protects existing behaviour): skips everything at or before the requested checkpoint - asserts only later messages are yielded.
- 12.4 (protects existing behaviour): reports the last appended checkpoint - asserts it equals the last message's checkpoint; reports no checkpoint while empty - asserts `null`.
- 12.5 (protects existing behaviour): two readers each get every message - asserts both reads yield the full list independently.
- 12.6 (protects existing behaviour): aborting a waiting reader ends the read - asserts the async iterator completes after the signal aborts.
- 12.7: rejects `pullingFrequencyInMs` - `// @ts-expect-error` on passing it.
- extra: reading from `'END'` yields only messages appended after the read started.
- extra: messages appended in several bursts each end with their own `MessageSourceCaughtUp`.
- extra: an empty source read from the beginning yields only `MessageSourceCaughtUp`.

Existing tests this step changes
- The existing `inMemoryMessageSource.unit.spec.ts` scenarios keep their names and assertions. The injected-source unit specs of the PostgreSQL, SQLite, MongoDB and EventStoreDB consumers use `inMemoryMessageSource` without `pullingFrequencyInMs`, so they need no change; run them to confirm.
```

---

## Step 2. In-memory store consumer and standalone consumer

```text
Use the `implement-step` skill.

What to build
`getInMemoryEventStore().consumer()` returns a typed in-memory consumer whose reactors, projectors and workflow processors run over what the store records, from a global log that `appendToStream` fills. `inMemoryEventStoreConsumer({ source, messageStore })` gives the same consumer over any source. The append result carries `lastEventGlobalPosition`. Tests can wait with `whenCaughtUp()` and `whenProcessed(...)`. The lifecycle matches the other stores' consumers. Processors keep checkpoints and read models in the message store's database when it is an in-memory store.

This is one step because Emmett's generic `consumer(...)` needs the reactor, projector and workflow processor factories together (`src/packages/emmett/src/consumers/consumers.ts:156-158`), and no placeholder factory is allowed.

Context
- `src/packages/emmett/src/eventStore/inMemoryEventStore.ts`: `getInMemoryEventStore` keeps events in a private `streams` map and returns `database`, `aggregateStream`, `readStream`, `appendToStream`, `streamExists`. `appendToStream` stores downcast events in the stream, then runs inline projections, then after-commit hooks.
- Spec decisions:
  - The store creates one `inMemoryMessageSource` (the global log) when it is created. `appendToStream` appends the new events to it at the same point it stores them in their stream (after expected-version checks, before inline projections and after-commit hooks), in the same stored form. Extra work per append: one `append(...)` call and waking waiting readers (Q8, Q19).
  - Global position may be computed from the global log's length.
  - `appendToStream` returns `AppendToStreamResultWithGlobalPosition`; `InMemoryEventStore`'s type reflects it.
  - `InMemoryEventStore` declares `consumer(options?)` returning the typed in-memory consumer.
  - The store's `consumer()` builds the consumer through a new standalone factory `inMemoryEventStoreConsumer({ source, messageStore, ...config })` with the global log as `source` and the store as `messageStore`. The factory is built on Emmett's generic `consumer(...)` (`src/packages/emmett/src/consumers/consumers.ts`) and never closes the injected source.
  - Config: `MessageConsumerOptions` plus `stopWhen.noMessagesLeft` plus `pulling: { batchSize, batchDeadlineInMs }`; no `pullingFrequencyInMs`.
  - Consumer type: `MessageConsumer` with in-memory reactor, projector and workflow processor factory types, following `SQLiteEventStoreConsumer`. `reactor(...)` uses the existing `inMemoryReactor` (`src/packages/emmett/src/processors/inMemoryProcessors.ts`).
  - Message-store rule (see Terms): the factory checks once whether `messageStore` has a `database` member and passes `messageStore.database` through `connectionOptions.database` to in-memory processors it creates without their own database.
  - The store's consumer does not close the global log when it closes.
- Put the consumer next to the in-memory event store in the core package and export it from the core package index.
- `projector(...)` uses the existing `inMemoryProjector`.
- The consumer's `scope` passes `session: { messageStore }`, as `sqliteEventStoreConsumer` passes its session. `inMemoryProcessingScope` already forwards the consumer's session into the handler context. No new options on `inMemoryReactor` / `inMemoryProjector` (Q32).
- `workflowProcessor(...)` is a real workflow processor built on the generic `workflowProcessor` (`src/packages/emmett/src/workflows/workflowProcessor.ts`), with in-memory checkpoints (`inMemoryCheckpointer`) and the database from the message-store rule. It reads `context.session.messageStore`, which keeps its required `MessageStoreSession` type.
- Until Step 13 types `session.messageStore`, test handlers on in-memory processors that append through it cast it to `EventStore`.

Similar code
- `src/packages/emmett-sqlite/src/eventStore/consumers/sqliteEventStoreConsumer.ts` (config type, factories, source wiring, `stopWhen`, `pulling`) and the store's `consumer()` in `src/packages/emmett-sqlite/src/eventStore/SQLiteEventStore.ts`.
- Tests to copy: `src/packages/emmett-sqlite/src/storage/sqlite3/eventStore/consumers/sqliteEventStoreConsumer.int.spec.ts`, `.handling.int.spec.ts` (starting and closing resilience, consumer created by the event store, eachMessage), `.awaiters.int.spec.ts`.
- Shared scenarios: `testConsumerSchemaVersion` in `src/packages/emmett-tests/src/eventStore/features.ts`, run for SQLite from `src/packages/emmett-tests/src/eventStore/sqlite/sqliteEventStore.e2e.spec.ts`.
- `src/packages/emmett-sqlite/src/storage/sqlite3/eventStore/consumers/sqliteEventStoreConsumer.inMemory.projections.int.spec.ts`; in-memory projections in `src/packages/emmett/src/eventStore/projections/inMemory/inMemoryProjection.ts`.
- `sqliteWorkflowProcessor` in `src/packages/emmett-sqlite/src/eventStore/consumers/sqliteProcessor.ts`; tests to copy: `sqliteEventStoreConsumer.workflow.int.spec.ts`; helpers in `src/packages/emmett/src/workflows/workflow.testHelpers.ts`.
- `src/packages/emmett-sqlite/src/storage/sqlite3/eventStore/consumers/sqliteEventStoreConsumer.unit.spec.ts` (injected source, does NOT close the injected source, registers an existing processor).

Blocked by
Step 1.

Acceptance criteria
- 1.1 GIVEN an in-memory store WHEN `consumer()` is called THEN it returns a consumer that has not started and has `reactor`, `projector` and `workflowProcessor`.
- 1.2 GIVEN an in-memory store WHEN `consumer()` is called THEN its static type is the typed in-memory consumer, not the generic `MessageConsumer`.
- 1.3 GIVEN two started consumers from the same in-memory store WHEN the first is closed and then an event is appended THEN the second consumer's reactor receives that event.
- 1.4 GIVEN a consumer from an in-memory store WHEN the consumer is closed THEN the store stays usable: appends and reads still work.
- 2.1 GIVEN events appended before the consumer starts AND a reactor that starts from the beginning WHEN the consumer starts and catches up THEN the reactor received all of them, in global position order.
- 2.2 GIVEN a started, caught-up consumer WHEN events are appended THEN the reactor receives them without any polling wait.
- 2.3 GIVEN events appended to several streams WHEN the reactor receives them THEN each message has its stream name, stream position, global position, checkpoint and message id, and they arrive in global position order across streams.
- 2.4 GIVEN a reactor starting from `'END'` WHEN events were appended before start and more are appended after THEN the reactor receives only the later ones.
- 2.5 GIVEN a reactor with a stored checkpoint WHEN the consumer starts again THEN the reactor continues after that checkpoint.
- 2.6 GIVEN events appended with a downcaster that changes how they are stored WHEN a reactor without an upcaster receives them THEN it receives the stored form, the same form `readStream` returns without an upcaster.
- 2.7 GIVEN an inline projection that throws during an append WHEN a started consumer catches up THEN its reactor receives the events of that append, the same events `readStream` returns for that stream.
- 2.8 GIVEN `pulling: { batchSize: 2 }` AND five appended events WHEN a reactor with `eachBatch` processes them THEN no batch has more than two messages, and all five are processed.
- 2.9 GIVEN `pulling: { batchSize: 10, batchDeadlineInMs: 20 }` AND three appended events WHEN the deadline passes THEN `eachBatch` receives the three events in one batch.
- 2.10 GIVEN an in-memory store WHEN two events are appended to an empty store THEN the append result has `lastEventGlobalPosition` equal to the checkpoint of global position 2, and a consumer's `whenProcessed(lastEventGlobalPosition)` resolves once its processor has handled both.
- 2.11 GIVEN a reactor on the store's consumer with checkpoints enabled WHEN it processes an event THEN its checkpoint is stored in the store's `database`.
- 3.1 GIVEN an appended event with `schemaVersion: 2` WHEN a consumer receives it THEN the message has `schemaVersion: 2`.
- 3.2 GIVEN a consumer with an upcaster that returns `schemaVersion: 2` WHEN it receives a version `1` event THEN the message has `schemaVersion: 2`.
- 4.1 GIVEN a started consumer WHEN all appended messages were processed THEN `whenCaughtUp()` resolves.
- 4.2 GIVEN a caught-up consumer WHEN more events are appended and processed THEN a later `whenCaughtUp()` call resolves again.
- 4.3 GIVEN a consumer and processor in the same situations as the SQLite awaiter scenarios WHEN the test waits THEN it gets the same outcomes as on SQLite.
- 5.1 GIVEN a consumer with no processors WHEN it starts THEN start fails, and `whenStarted()` rejects.
- 5.2 GIVEN a consumer with processors WHEN it starts THEN `whenStarted()` resolves.
- 5.3 GIVEN a consumer that never started WHEN it is stopped once or several times THEN nothing fails.
- 5.4 GIVEN a started consumer WHEN it is stopped THEN the promise returned by `start()` resolves, and an event appended after the stop is not delivered to its reactor.
- 5.5 GIVEN the starting and closing resilience scenarios that SQLite covers WHEN they run on the in-memory consumer THEN they have the same outcomes.
- 5.6 GIVEN `stopWhen: { noMessagesLeft: true }` WHEN the consumer has processed everything in the log THEN it stops by itself.
- 2.12 GIVEN the "eachMessage" and "consumer created by the event store" scenarios of SQLite's consumer handling suite, except "handles concurrent writes ... without SQLITE_BUSY errors" and the pool teardown part of "leaves the event store usable...", which are tied to SQLite WHEN they run on the in-memory consumer THEN they have the same outcomes.
- 8.1 GIVEN a projector registered with `consumer.projector(...)` WHEN events are appended and the consumer catches up THEN the read model in the store's database reflects them.
- 8.2 GIVEN the scenarios of SQLite's in-memory projections suite WHEN they run on the in-memory consumer THEN they have the same outcomes.
- 10.1 GIVEN a workflow processor on the store's consumer WHEN its input events are appended THEN its output messages are appended to the same in-memory store.
- 10.2 GIVEN the workflow scenarios that SQLite's workflow suite covers WHEN they run on the in-memory consumer THEN they have the same outcomes.
- 11.1 GIVEN `inMemoryEventStoreConsumer({ source, messageStore })` WHEN it is created THEN it has not started.
- 11.2 GIVEN an injected source holding messages WHEN the consumer starts and catches up THEN its reactor received those messages.
- 11.3 GIVEN an injected source WHEN the consumer is closed THEN the source is not closed.
- 11.4 GIVEN an existing processor WHEN it is registered through `consumer.reactor(processor)` THEN the same processor is returned and is listed in `consumer.processors`.
- 11.5 GIVEN a workflow processor on a standalone consumer WHEN it produces output THEN the output is appended to the `messageStore` passed to the factory.
- 11.6 GIVEN a call to `inMemoryEventStoreConsumer` without `source` or without `messageStore` THEN it does not compile.
- 11.7 GIVEN a standalone consumer whose `messageStore` is an in-memory store AND a projector created through `consumer.projector(...)` without its own database WHEN it processes events THEN its read model and checkpoint are in `messageStore.database`.
- 11.8 GIVEN a standalone consumer whose `messageStore` is an in-memory store AND a reactor created through `consumer.reactor(...)` with its own `connectionOptions.database` WHEN it processes an event THEN its checkpoint is in its own database, not in `messageStore.database`.
- 11.9 GIVEN a standalone consumer whose `messageStore` is not an in-memory store AND a reactor created through `consumer.reactor(...)` without its own database WHEN it processes an event THEN it stores its checkpoint in its own fresh database, as in-memory reactors do today.
- 11.10 GIVEN a standalone consumer whose `messageStore` is an in-memory store AND an already built processor passed to `consumer.reactor(processor)` WHEN it processes events THEN it keeps its own checkpoint and read model storage, not `messageStore.database`, and its handlers still see `context.session.messageStore` (9.8).
- 11.11 GIVEN a workflow processor on a standalone consumer whose `messageStore` is an in-memory store WHEN it processes an input THEN its checkpoint is in `messageStore.database`.

Tests
All in-memory tests are `*.unit.spec.ts` in the core package unless noted. Assert every field of received events.
- 1.1: event store returns a not-started consumer with reactor, projector and workflowProcessor - asserts `typeof` of each is `'function'` and nothing was processed.
- 1.2: event store returns the strongly typed in-memory consumer - `expectTypeOf(store.consumer()).toEqualTypeOf<InMemoryEventStoreConsumer>()`.
- 1.3: covered by the copied SQLite scenario "returns distinct consumers with separate checkpoints" (2.12) - asserts the second consumer's reactor gets an event appended after the first closed, as the SQLite scenario already does.
- 1.4: covered by the copied SQLite scenario "leaves the event store usable after the consumer was closed" (2.12, without the pool teardown part) - asserts append and `readStream` still work.
- 2.1: covered by the copied SQLite scenario "handles all events appended to event store BEFORE processor was started" (2.12) - asserts all events, ordered by global position.
- 2.2: covered by the copied SQLite scenario "handles all events appended to event store AFTER processor was started" (2.12) - asserts the reactor gets them, waiting with `whenCaughtUp()` and no sleeps.
- 2.3: messages carry stream and global metadata across streams - asserts stream name, stream position, global position, checkpoint, message id and order across two streams.
- 2.4: covered by the copied SQLite scenario "handles only new events when startFrom END is specified" (2.12) - asserts only events appended after start.
- 2.5: covered by the copied SQLite scenario "handles only new events when CURRENT position is stored for restarted consumer" (2.12) - asserts no event is handled twice.
- 2.6: reactor receives the downcast stored form - asserts it equals what `readStream` returns without an upcaster.
- 2.7: events of an append whose inline projection threw still reach the consumer - asserts they match `readStream` for that stream.
- 2.8: batch size limits eachBatch - asserts no batch over 2 and 5 messages total.
- 2.9: batch deadline flushes a partial batch - with Vitest fake timers, append three events, advance 20 ms, and assert `eachBatch` was called once with all three (the 50 ms default deadline would not have flushed yet).
- 2.10: append returns lastEventGlobalPosition - asserts it equals the checkpoint of global position 2 and `whenProcessed(...)` resolves after both are handled.
- 2.11: reactor checkpoint lives in the store's database - asserts the `emt_processor_checkpoints` document for the processor id is in `store.database`.
- 3.1, 3.2: run `testConsumerSchemaVersion` from the existing `src/packages/emmett-tests/src/eventStore/inMemory/inMemoryEventStore.unit.spec.ts` - asserts `schemaVersion: 2` in both scenarios.
- 4.1, 4.2: whenCaughtUp resolves after processing, and again after more appends - asserts the reactor saw all events each time.
- 4.3: copies of every scenario in `sqliteEventStoreConsumer.awaiters.int.spec.ts`, same names and outcomes.
- 5.1: fails to start if there are no processors - asserts `start()` and `whenStarted()` reject.
- 5.2: whenStarted resolves after successful start.
- 5.3: stopping a not-started consumer doesn't fail, and is idempotent.
- 5.4: stopping a started consumer resolves start and stops delivery - asserts the `start()` promise resolves; then appends one event, waits until a second consumer on the same store processes it (`whenProcessed(result.lastEventGlobalPosition)`), and asserts the stopped consumer's reactor did not receive it.
- 5.5: copies of SQLite's "starting and closing resilience" scenarios, same names and outcomes.
- 5.6: stopWhen noMessagesLeft stops after the log is processed - asserts `start()` resolves by itself.
- extra: an append that fails the expected-version check reaches no consumer - after the rejected append, appends one valid event, waits with `whenProcessed(result.lastEventGlobalPosition)`, and asserts the reactor received only the valid event (the log is ordered, so a leaked event would have arrived first).
- extra: global positions keep increasing across streams after many appends - asserts consecutive values.
- extra: closing the store's consumer twice doesn't fail.
- 2.12: copies of every "eachMessage" and "consumer created by the event store" scenario in `sqliteEventStoreConsumer.handling.int.spec.ts`, same names and outcomes, each written once and built with `eventStore.consumer()` where SQLite builds `sqliteEventStoreConsumer({ driver, fileName })`, because the global log is private (the six named under 1.3, 1.4, 2.1, 2.2, 2.4 and 2.5 count for those criteria too), except "handles concurrent writes ... without SQLITE_BUSY errors" and the pool teardown part of "leaves the event store usable..." (the in-memory store has no `close()`). Where a SQLite scenario wraps its assertion in `try { ... } catch (error) { console.log(error); } finally { ... }`, the copy keeps the `finally` that closes the consumer but drops the `catch`, and asserts order and every field of the received events. If a copied scenario fails once the `catch` is gone, stop and report it to Oskar instead of weakening the assertion.
- 8.1: projector on the store's consumer updates the read model in the store's database - asserts the document in `store.database` after catch-up.
- 8.2: copies of every scenario in SQLite's in-memory projections suite, same names and outcomes.
- extra: a projector with its own `connectionOptions.database` writes there, not to the store's database.
- 10.1: workflow output is appended to the same in-memory store - asserts the output stream read from the store.
- 10.2: copies of every scenario in SQLite's workflow suite, same names and outcomes.
- extra: workflow checkpoint is stored in the store's database.
- 11.1: creates a not-started consumer.
- 11.2: handles messages read from the injected source - asserts the reactor got the source's messages.
- 11.3: does NOT close the injected source when consumer is closed - asserts the source's close count is 0.
- 11.4: registers an existing processor through reactor - asserts the same instance is returned and listed.
- 11.5: workflow output goes to the given message store - asserts it can be read from that store.
- 11.6: `// @ts-expect-error` on calls without `source` and without `messageStore`.
- 11.7: projector uses messageStore.database - asserts read model and checkpoint are there.
- 11.8: reactor with its own database keeps it - asserts the checkpoint is in its own database only.
- 11.9: non in-memory messageStore leaves reactors on their own fresh database - with a hand-built `EventStore` without `database`, asserts the checkpoint is in the reactor's own `processor.database`.
- 11.10: built processor keeps its own storage and sees the session's message store - asserts checkpoint location and a successful append through it.
- 11.11: workflow checkpoint is in messageStore.database.
- extra: a `messageStore` object that has a `database` member but isn't from `getInMemoryEventStore` is treated as in-memory (Q29 rule).

Existing tests this step changes
- `src/packages/emmett/src/eventStore/eventStoreContract.unit.spec.ts` "accepts a store that does not expose a consumer at all" now fails, because the in-memory store has a consumer. Delete it here, as the spec decides (Contract spec decision); the narrowing test stays.
- In-memory tests asserting the exact append result shape gain `lastEventGlobalPosition`; update their expectations.
```

## Step 3. Required `consumer` on `EventStore`

```text
Use the `implement-step` skill.

What to build
`consumer` becomes a required member of the base `EventStore` interface, so code that takes any `EventStore` calls `eventStore.consumer()` directly.

Context
- `src/packages/emmett/src/eventStore/eventStore.ts`: `consumer?<ConsumerMessageType>(options?): MessageConsumer<...>` with a doc comment. Spec: drop the `?`; signature and doc comment otherwise unchanged.
- `src/packages/emmett-tests/src/eventStore/features.ts` (`consumeStream`) calls `eventStore.consumer?.<MessageType>()` then `assertOk(consumer)`. Spec: call `eventStore.consumer()` directly.
- All four store packages already declare `consumer` as required on their own interfaces.

Similar code
- `src/packages/emmett/src/eventStore/eventStoreContract.unit.spec.ts` for type-level checks.

Blocked by
Step 2.

Acceptance criteria
- 13.1 GIVEN a value typed as `EventStore` WHEN `consumer()` is called without optional chaining THEN it compiles.
- 13.2 GIVEN an in-memory store WHEN it is assigned to `EventStore` THEN it compiles.
- 13.3 (Protects existing behaviour.) GIVEN a store that narrows `consumer` to its own config and consumer types WHEN it is assigned to `EventStore` THEN it compiles. The existing contract test "accepts a store that narrows the consumer member" covers this.
- 13.4 (Protects existing behaviour.) GIVEN the PostgreSQL, SQLite (sqlite3, D1, Durable Objects), MongoDB and EventStoreDB stores WHEN `npm run build:ts` runs THEN it passes. Each store's interface extends `EventStore`, so this checks them against the required member.

Tests
- 13.1: `expectTypeOf<EventStore['consumer']>()` is a required function, and calling `store.consumer()` on a value typed `EventStore` compiles without optional chaining.
- 13.2 (protects existing behaviour after Step 2): assigning `getInMemoryEventStore()` to `EventStore` compiles.
- 13.3: the existing "accepts a store that narrows the consumer member" test keeps passing.
- 13.4: `npm run build:ts` passes.
- extra: `expectTypeOf<EventStore>().toHaveProperty('consumer')` and it isn't optional (a `// @ts-expect-error` on assigning an object without `consumer` to `EventStore`).

Existing tests this step changes
- `features.ts` `consumeStream`: replace `consumer?.()` + `assertOk` with a direct call.
- Step 2's hand-built `EventStore`s (the 11.9 store without `database` and the Q29 extra store with a `database` member) stop compiling without `consumer`; give them a `consumer` member.
```

---

## Step 4. Durable Objects sample keeps compiling

```text
Use the `implement-step` skill.

What to build
The Cloudflare Durable Objects sample's hand-written `clientsEventStore` adapter gets a `consumer` member that throws, so the sample keeps compiling once it moves to an Emmett version with the required `consumer`.

Context
- `samples/cloudflare/durable-objects/src/shoppingCarts/api.int.spec.ts`, `clientsEventStore` returns an object with `aggregateStream`, `readStream`, `appendToStream`, `streamExists`.
- Spec: add `consumer` that throws `EmmettError` with a "not implemented" message. No test of its own (Q21). Dependencies stay at their pinned published Emmett version.

Similar code
- `src/packages/emmett/src/workflows/unsupportedWorkflowProcessor.ts` throws `EmmettError` for an unsupported feature.

Blocked by
None.

Acceptance criteria
- 14.1 GIVEN the sample at its pinned Emmett version WHEN it type-checks THEN it compiles.
- 14.2 GIVEN the sample's existing integration tests WHEN they run THEN they pass unchanged.

Tests
- 14.1: the sample type-checks (its `build:ts` / `tsc` script).
- 14.2: the sample's existing integration tests pass unchanged.
- extra: none; the throw has no test by decision (Q21).

Existing tests this step changes
- None.
```

---

## Step 5. Observability and reactor errors on the in-memory consumer

```text
Use the `implement-step` skill.

What to build
The in-memory consumer traces and logs like the other stores' consumers, uses the store's observability when it has none of its own, and handles reactor errors the same way as SQLite.

Context
- Spec: the store's `consumer()` merges the store's `observability` option with the consumer's own, as `SQLiteEventStore.ts` does with `mergeObservability(options.observability, consumerOptions?.observability)`.
- `src/packages/emmett-tests/src/errorHandling/reactorErrors.features.ts` exports `testReactorRecordsFailureAsEvent`, `testReactorSkipsAndStops` with a `ConsumerFactory`.

Similar code
- Observability scenarios in `src/packages/emmett-sqlite/src/storage/sqlite3/eventStore/consumers/sqliteEventStoreConsumer.handling.int.spec.ts` ("observability" describe).
- `src/packages/emmett-tests/src/errorHandling/sqliteReactorErrors.int.spec.ts` wiring.

Blocked by
Step 2.

Acceptance criteria
- 6.1 GIVEN the observability scenarios that SQLite's consumer handling suite covers WHEN they run on the in-memory consumer THEN they have the same outcomes.
- 6.2 GIVEN an in-memory store created with an `observability` option AND a consumer created from it without one WHEN the consumer runs THEN it logs through the store's observability.
- 7.1 GIVEN a reactor that records a failure as an event WHEN its handler fails THEN the failure event is appended to the in-memory store.
- 7.2 GIVEN a reactor configured to skip and stop WHEN its handler fails THEN it skips or stops as on SQLite.

Tests
- 6.1 (protects existing behaviour after Step 2): copies of every scenario in SQLite's handling "observability" describe except "a consumer created from an event store logs through the store's observability", which is the 6.2 test.
- 6.2: a consumer created from an event store logs through the store's observability - asserts the store's logger/collector received the consumer's entries.
- 7.1, 7.2 (protect existing behaviour after Step 2): a new `inMemoryReactorErrors.unit.spec.ts` in `src/packages/emmett-tests/src/errorHandling/` runs `testReactorRecordsFailureAsEvent` and `testReactorSkipsAndStops` with an in-memory `ConsumerFactory`.
- extra: a consumer's own observability wins over the store's when both are given.

Existing tests this step changes
- None.
```

---

## Step 6. Async projections and the message store in handlers

```text
Use the `implement-step` skill.

What to build
The in-memory store accepts async projections, and `consumer({ includeAsyncProjections: true })` runs them. Handlers on the consumer can append through `context.session.messageStore`, and the trace continues from the handled message.

Context
- `InMemoryEventStoreOptions.projections` accepts only `'inline'` registrations today. Spec: accept async ones; `appendToStream` keeps running only inline ones; the store's `consumer({ includeAsyncProjections: true })` adds each async projection as a projector, the same way as any other projector.
- No `context.eventStore` for processors (Q30). The session's `messageStore` comes from the consumer scope (Step 2). `withScopedMessageStore` in `src/packages/emmett/src/processors/processors.ts` wraps it so appends continue the trace.

Similar code
- `includeAsyncProjections` in `src/packages/emmett-sqlite/src/eventStore/SQLiteEventStore.ts` and `src/packages/emmett-postgresql/src/eventStore/postgreSQLEventStore.ts`.
- Trace continuation: `src/packages/emmett/src/processors/processors.observability.unit.spec.ts:182-241` ("the message store on the handler context appends into the handled message flow").

Blocked by
Step 2.

Acceptance criteria
- 9.1 GIVEN an in-memory store with an async projection WHEN events are appended THEN `appendToStream` does not run that projection.
- 9.2 GIVEN an in-memory store with an async projection WHEN `consumer({ includeAsyncProjections: true })` starts and catches up THEN the projection's read model reflects the appended events.
- 9.3 GIVEN an in-memory store with an async projection WHEN `consumer()` is called without `includeAsyncProjections` THEN the projection is not added to it.
- 9.4 GIVEN an in-memory store with both inline and async projections WHEN events are appended THEN the inline projection runs during the append, as today.
- 9.5 GIVEN an async projection whose handler reads `context.database` WHEN the store's consumer runs it THEN `context.database` is the store's database.
- 9.5a GIVEN a projection registered as async on the in-memory store whose handler reads `context.eventStore` WHEN the store's consumer runs it THEN `context.eventStore` is undefined.
- 9.6 GIVEN a reactor created through the store's `consumer.reactor(...)` whose handler appends an event to a new stream through `context.session.messageStore` WHEN it handles a message THEN that event can be read from the store.
- 9.7 GIVEN a reactor on the store's consumer that appends an event through `context.session.messageStore` WHEN it handles a message THEN the appended event is in the store with a new `messageId`, the handled message's `correlationId`, and the handled message's `messageId` as its `causationId`, as the core processor observability test asserts.
- 9.8 GIVEN an in-memory reactor built with `inMemoryReactor(...)` and passed to the store's `consumer.reactor(reactor)` whose handler appends an event to a new stream through `context.session.messageStore` WHEN it handles a message THEN that event can be read from the store.

Tests
- 9.1: append doesn't run async projections - asserts no read model document after append.
- 9.2: consumer with includeAsyncProjections runs them - asserts the read model after catch-up.
- 9.3: consumer without includeAsyncProjections doesn't add them - asserts `consumer.processors` is empty.
- 9.4: inline projections still run during append - asserts the inline read model right after append.
- 9.5: async projection gets the store's database - asserts `context.database` is `store.database`.
- 9.5a: async projection has no eventStore in its context - asserts `context.eventStore` is undefined.
- 9.6 (protects existing behaviour after Step 2): reactor appends through the session's message store - asserts the event can be read from the store.
- 9.7 (protects existing behaviour after Step 2): reactor appends continue the handled message flow - asserts the appended event has a new `messageId`, the handled message's `correlationId`, and the handled message's `messageId` as `causationId`.
- 9.8 (protects existing behaviour after Step 2): built inMemoryReactor passed to consumer.reactor appends through the session's message store - asserts the event can be read from the store.
- extra: an async projection's checkpoint is in the store's database.

Existing tests this step changes
- None. Handlers appending through `context.session.messageStore` cast it to `EventStore` until Step 13.
```

---

## Step 7. In-memory consumer docs and runnable snippets

```text
Use the `implement-step` skill.

What to build
The docs say the in-memory store has async projections and a consumer, with an example taken from a snippet test, and every snippet spec under the docs snippets actually runs.

Context
- `src/docs/guides/choosing-event-store.md`: comparison matrix row "Built-in Projections", In-Memory column says "Inline"; In-Memory section has setup only.
- `src/docs/api-reference/eventstore.md`: "In-Memory (Testing)" section has setup only.
- `src/docs/snippets/eventStores/consumers/postgreSQLConsumer.int.spec.ts` with `#region` markers, included by `src/docs/event-stores/postgresql.md` via `<<< @/snippets/...#region`.
- `src/vitest.config.ts` lists projects; none collects `docs/snippets`. Scripts select by suffix (`test:unit` = `.unit.spec`, `test:int` = `.int.spec`, `test:e2e` = `.e2e.spec`).
- Spec: add a Vitest project for the docs snippets; existing snippet specs (`gettingStarted/businessLogic.unit.spec.ts`, `eventStores/consumers/postgreSQLConsumer.int.spec.ts`, `gettingStarted/webApi/apiBDD.int.spec.ts`, `gettingStarted/webApi/simpleApi.int.spec.ts`, `gettingStarted/webApi/apiBDD.e2e.spec.ts`) must pass once they run.

Similar code
- The PostgreSQL consumer snippet and its page section.
- Package-level Vitest configs listed in `src/vitest.config.ts` for project shape.

Blocked by
Step 2, Step 6.

Acceptance criteria
- 15.1 GIVEN the event store comparison matrix WHEN read THEN In-Memory's "Built-in Projections" says "Inline + Async".
- 15.2 GIVEN the In-Memory sections of the guide and the API reference WHEN read THEN each shows a consumer example taken from a snippet test.
- 15.3 GIVEN the in-memory consumer snippet test WHEN `npm run test:unit` runs THEN it is collected and passes.
- 15.4 GIVEN the existing snippet specs under the docs snippets WHEN `npm run test:unit`, `npm run test:int` and `npm run test:e2e` run THEN each is collected by the suite matching its suffix and passes.

Tests
- 15.1: docs check - `npm run docs:build` passes and the matrix row reads "Inline + Async".
- 15.2: both pages include regions from the new in-memory consumer snippet - `npm run docs:build` passes.
- 15.3: `npx vitest list --filesOnly` lists the new snippet, and `npm run test:unit` runs it green.
- 15.4: `npx vitest list --filesOnly` lists every existing snippet spec under the suite matching its suffix, and each passes in `test:unit`, `test:int`, `test:e2e`.
- extra: the in-memory snippet asserts every field of what its reactor or projection produced.

Existing tests this step changes
- Existing snippet specs start running; if any fails, fix the snippet (not the assertion's intent) and note it.
```

---

## Step 8. SQLite consumers pass their message store

```text
Use the `implement-step` skill.

What to build
In-memory processors hosted by a SQLite consumer can append through `context.session.messageStore`, which the consumer now passes through its scope.

Context
- `src/packages/emmett-sqlite/src/eventStore/consumers/sqliteEventStoreConsumer.ts` scope passes `{ session: { pool, connectionOptions } }`.
- Spec: add `messageStore`, built once when the consumer is created, from the consumer's pool with the consumer's event store schema options and `autoMigration: 'None'`, as `sqliteProcessor.ts` builds it in its processing scope. SQLite's own processors keep building theirs.

Similar code
- `messageStore: getSQLiteEventStore(...)` in `src/packages/emmett-sqlite/src/eventStore/consumers/sqliteProcessor.ts`.
- `sqliteEventStoreConsumer.inMemory.projections.int.spec.ts` for sqlite3, D1 and Durable Objects under `src/packages/emmett-sqlite/src/storage/*/eventStore/consumers/`.

Blocked by
None.

Acceptance criteria
- 16.1 [was 9.10, SQLite part] GIVEN an in-memory reactor hosted by a SQLite consumer (one scenario per SQLite driver: sqlite3, D1 and Durable Objects) whose handler appends an event to a new stream through `context.session.messageStore` WHEN it handles a message THEN that event can be read from that consumer's store.

Tests
- 16.1: in-memory reactor on a SQLite consumer appends through the session's message store - one scenario each in the sqlite3, D1 and Durable Objects in-memory projection specs; asserts the event can be read from the store.

Existing tests this step changes
- Test handlers on in-memory processors cast `context.session.messageStore` to `EventStore` until Step 13. None expected otherwise; run the SQLite consumer suites for all drivers.
```

---

## Step 9. PostgreSQL consumer passes its message store

```text
Use the `implement-step` skill.

What to build
In-memory processors hosted by a PostgreSQL consumer can append through `context.session.messageStore`.

Context
- `src/packages/emmett-postgresql/src/eventStore/consumers/postgreSQLEventStoreConsumer.ts` builds `processorContext` once and passes it through `scope`.
- Spec: add `messageStore` to that context, built once from the consumer's pool with the event store schema options and `autoMigration: 'None'`, as `postgreSQLProcessor.ts` builds it.

Similar code
- `messageStore: getPostgreSQLEventStore(...)` in `src/packages/emmett-postgresql/src/eventStore/consumers/postgreSQLProcessor.ts`.
- `postgreSQLEventStoreConsumer.inMemory.projections.int.spec.ts`.

Blocked by
None.

Acceptance criteria
- 17.1 [was 9.10, PostgreSQL part] GIVEN an in-memory reactor hosted by a PostgreSQL consumer whose handler appends an event to a new stream through `context.session.messageStore` WHEN it handles a message THEN that event can be read from that consumer's store.

Tests
- 17.1: in-memory reactor on a PostgreSQL consumer appends through the session's message store - asserts the event can be read from the store.
- extra: with a custom `databaseSchemaName`, the appended event is in that schema.

Existing tests this step changes
- Test handlers on in-memory processors cast `context.session.messageStore` to `EventStore` until Step 13. None expected otherwise; run the PostgreSQL consumer suites.
```

---

## Step 10. MongoDB consumer and processors always have the message store

```text
Use the `implement-step` skill.

What to build
The MongoDB consumer passes its message store through its scope, MongoDB reactors and projectors build their own from their client, and `messageStore` is required in the MongoDB handler context type.

Context
- `src/packages/emmett-mongodb/src/eventStore/consumers/mongoDBEventStoreConsumer.ts` scope: `handler({ session: { client } })`.
- `src/packages/emmett-mongodb/src/eventStore/consumers/mongoDBProcessor.ts`: `MongoDBProcessorHandlerContext` has `messageStore?`; the reactor/projector `mongoDBProcessingScope` only spreads the consumer session and adds `client`; the workflow scope builds `getMongoDBEventStore(...)` on every call.
- Spec: the consumer adds `messageStore` built once at creation from its client; the reactor/projector scope builds `messageStore` from the processor's own client, once at processor creation; the type becomes required.

Similar code
- The MongoDB workflow processing scope in `mongoDBProcessor.ts`.
- `mongoDBEventStoreConsumer.handling.int.spec.ts` (hosts `inMemoryReactor`) and `.inMemory.projections.int.spec.ts`.

Blocked by
None.

Acceptance criteria
- 18.1 [was 9.10, MongoDB part] GIVEN an in-memory reactor hosted by a MongoDB consumer whose handler appends an event to a new stream through `context.session.messageStore` WHEN it handles a message THEN that event can be read from that consumer's store.
- 18.2 [was 9.11] GIVEN a MongoDB reactor on the MongoDB consumer whose handler appends an event to a new stream through `context.session.messageStore` WHEN it handles a message THEN that event can be read from the MongoDB store.
- 18.3 [was 9.12, MongoDB part] GIVEN `MongoDBProcessorHandlerContext` WHEN its type is checked with `expectTypeOf` THEN `session.messageStore` is required.

Tests
- 18.1: in-memory reactor on a MongoDB consumer appends through the session's message store - asserts the event can be read from the store.
- 18.2: MongoDB reactor appends through the session's message store - asserts the event can be read from the store.
- 18.3: `expectTypeOf<MongoDBProcessorHandlerContext['session']['messageStore']>()` is not optional (in a MongoDB `*.unit.spec.ts`).
- extra: a MongoDB reactor created with its own client gets `session.client` and `session.messageStore` from that same client.

Existing tests this step changes
- Test handlers on in-memory processors cast `context.session.messageStore` to `EventStore` until Step 13. None expected otherwise; run the MongoDB consumer suites.
```

---

## Step 11. EventStoreDB consumer passes its message store

```text
Use the `implement-step` skill.

What to build
In-memory processors hosted by an EventStoreDB consumer, including its in-memory projectors, can append through `context.session.messageStore`, and the type is required.

Context
- `src/packages/emmett-esdb/src/eventStore/consumers/eventStoreDBEventStoreConsumer.ts` passes no `scope`; `projectorFactory` is `inMemoryProjector`.
- `src/packages/emmett-esdb/src/eventStore/consumers/eventStoreDBProcessor.ts`: `EventStoreDBProcessorHandlerContext` has `messageStore?`; its processing scope always sets `{ client, messageStore }`.
- Spec: the consumer gets a scope passing `{ session: { client, messageStore } }`, built once at creation; the type becomes required.

Similar code
- The MongoDB consumer scope; `eventStoreDBProcessingScope`.
- `eventStoreDBEventStoreConsumer.inMemory.projections.int.spec.ts`, `eventStoreDBEventStoreConsumer.unit.spec.ts`.

Blocked by
None.

Acceptance criteria
- 19.1 [was 9.10, EventStoreDB part] GIVEN an in-memory reactor hosted by an EventStoreDB consumer whose handler appends an event to a new stream through `context.session.messageStore` WHEN it handles a message THEN that event can be read from that consumer's store.
- 19.2 [was 9.12, EventStoreDB part] GIVEN `EventStoreDBProcessorHandlerContext` WHEN its type is checked with `expectTypeOf` THEN `session.messageStore` is required.

Tests
- 19.1: in-memory reactor on an EventStoreDB consumer appends through the session's message store - asserts the event can be read from the store.
- 19.2: `expectTypeOf<EventStoreDBProcessorHandlerContext['session']['messageStore']>()` is not optional.
- extra: an in-memory projector created through `consumer.projector(...)` sees `session.client`.

Existing tests this step changes
- Test handlers on in-memory processors cast `context.session.messageStore` to `EventStore` until Step 13. None expected otherwise; run the EventStoreDB consumer suites.
```

---

## Step 12. MongoDB custom `databaseName`

```text
Use the `implement-step` skill.

What to build
A MongoDB store with a custom `databaseName` works with its consumer: the source watches that database, every message store and checkpoint uses it, and processors can override it.

Context
- `MongoDBEventStoreOptions.storage` (`src/packages/emmett-mongodb/src/eventStore/mongoDBEventStore.ts`, shapes in `storage/mongoDBEventStoreStorage.ts`); the store's `consumer()` passes only client and observability.
- `mongoDBMessageSource` takes `dbName` but the consumer doesn't pass it; `mongoDBCheckpointer` uses `client.db(undefined)`.
- Spec decisions (Q36–Q38): the store's `consumer()` passes `storage`; standalone `mongoDBEventStoreConsumer` gets optional `storage`; the consumer passes `storage.databaseName` to the source as `dbName`; MongoDB reactors, projectors and workflow processors get optional `storage`, filled by the consumer's factories when the caller gave none, built processors keep their own; every MongoDB `messageStore` is built from client plus `storage` once at creation (the workflow scope moves from per call to creation); checkpoints go to `storage.databaseName`'s `emt:processors`.

Similar code
- PostgreSQL: `migrationOptions` on processors filled by `postgreSQLEventStoreConsumer.ts` factories; schema name passed to `postgreSQLMessageSource`; `postgreSQLProcessor.ts` checkpointer using `migrationOptions.databaseSchemaName`.

Blocked by
Step 10.

Acceptance criteria
- 20.1 [was 9.11a] GIVEN a MongoDB store created with `storage: { type: 'COLLECTION_PER_STREAM_TYPE', databaseName: 'custom_db' }` AND a started consumer from it WHEN an event is appended to the store THEN the consumer's reactor receives it.
- 20.2 [was 9.11b] GIVEN that store AND a MongoDB reactor on its consumer that appends an event to a new stream through `context.session.messageStore` WHEN it handles a message THEN that event can be read from that store.
- 20.3 [was 9.11c] GIVEN that store AND an in-memory reactor on its consumer that appends an event to a new stream through `context.session.messageStore` WHEN it handles a message THEN that event can be read from that store.
- 20.4 [was 9.11d] GIVEN that store AND a MongoDB workflow processor on its consumer WHEN it handles an input THEN its output can be read from that store.
- 20.5 [was 9.11e] GIVEN that store AND a MongoDB reactor with checkpoints on its consumer WHEN it processes an event THEN its checkpoint is stored in `custom_db`'s `emt:processors` collection, not in the default database.
- 20.6 [was 9.11f] GIVEN a standalone `mongoDBEventStoreConsumer` created with `storage: { type: 'COLLECTION_PER_STREAM_TYPE', databaseName: 'custom_db' }` WHEN an event is appended to a MongoDB store with the same storage THEN the consumer's reactor receives it, and an event its reactor appends through `context.session.messageStore` can be read from that store.
- 20.7 [was 9.11g] GIVEN a consumer with `databaseName: 'custom_db'` AND a MongoDB reactor created through `consumer.reactor({ ..., storage: { type: 'COLLECTION_PER_STREAM_TYPE', databaseName: 'other_db' } })` WHEN it appends through `context.session.messageStore` THEN the event is in `other_db`, not `custom_db`.
- 20.8 [was 9.11h] GIVEN a consumer with `databaseName: 'custom_db'` AND a MongoDB reactor built with `changeStreamReactor({ ..., storage: { ..., databaseName: 'other_db' } })` and passed to `consumer.reactor(reactor)` WHEN it appends through `context.session.messageStore` THEN the event is in `other_db`.

Tests
- 20.1: consumer of a custom-database store receives appended events.
- 20.2: MongoDB reactor appends into the custom database - asserts read back from the store.
- 20.3: in-memory reactor on that consumer appends into the custom database.
- 20.4: workflow output lands in the custom database.
- 20.5: checkpoint is in `custom_db`'s `emt:processors`, not the default database.
- 20.6: standalone consumer with `storage` receives and appends in the custom database.
- 20.7: caller-given processor `storage` wins - asserts the event is in `other_db`.
- 20.8: built `changeStreamReactor` keeps its own storage - asserts the event is in `other_db`.
- extra: a store with default storage behaves as before (existing MongoDB suites).

Existing tests this step changes
- The 20.3 in-memory reactor handler casts `context.session.messageStore` to `EventStore` until Step 13.
- MongoDB workflow tests that relied on a per-call store build need no change in assertions; run them.
```

---

## Step 13. In-memory processors require a message store

```text
Use the `implement-step` skill.

What to build
`session.messageStore` is required in the in-memory handler context type, and an in-memory processor without one fails at start with a clear error.

Context
- `src/packages/emmett/src/processors/inMemoryProcessors.ts`: `InMemoryProcessorHandlerContext = MessageHandlerContext<{ database }>`; `inMemoryProcessingScope` passes `session: partialContext?.session ?? {}` and throws `EmmettError` for a missing database.
- Spec: declare `session.messageStore: EventStore` required; throw `EmmettError` when the session has no `messageStore`. The scope runs at start, so `start()` rejects. All store consumers pass it after Steps 2 and 8–11.

Similar code
- The missing-database throw in the same scope.

Blocked by
Step 2, Step 6, Step 8, Step 9, Step 10, Step 11, Step 12.

Acceptance criteria
- 21.1 [was 9.9] GIVEN `InMemoryProcessorHandlerContext` WHEN its type is checked with `expectTypeOf` THEN `session.messageStore` is a required `EventStore`.
- 21.2 [was 9.13] GIVEN an in-memory reactor on the generic `consumer(...)` created without a `scope`, so its session has no `messageStore`, WHEN the consumer starts THEN `start()` and `whenStarted()` reject with an `EmmettError` naming the missing message store.

Tests
- 21.1: `expectTypeOf<InMemoryProcessorHandlerContext['session']['messageStore']>().toEqualTypeOf<EventStore>()`.
- 21.2: in-memory reactor on the generic `consumer(...)` without a scope fails to start - asserts `start()` and `whenStarted()` reject with `EmmettError` whose message names the missing message store.
- extra: the in-memory projection suites of every store still pass.

Existing tests this step changes
- Remove the `EventStore` casts of `context.session.messageStore` added in Steps 2, 6 and 8–12.
- Tests that run in-memory processors on the generic `consumer(...)` without a scope, if any, must pass a scope with a message store; search `src/packages` for them.
