# Q&A: in-memory event store consumer and mandatory `consumer()`

Source: https://github.com/event-driven-io/emmett/issues/427

## Q1

**Question:** Should "mandatory" mean removing the `?` from `consumer` on the base `EventStore` interface? That would make it a compile error for any store that implements `EventStore` without a consumer, including user-written stores and wrappers. Or did you mean something narrower, such as every built-in store providing one while the interface stays as it is?

**Answer (verbatim):** "yes, I think that all built in stores provide consumers, right?"

**Interpretation:** `consumer` becomes a required member of the base `EventStore` interface.

**Findings:** PostgreSQL, SQLite, MongoDB and EventStoreDB already declare `consumer` as required on their own store interfaces. The in-memory store is the only built-in store without one (issue #427). The test "accepts a store that does not expose a consumer at all" in `eventStoreContract.unit.spec.ts` guards the optional member and gets reversed by this decision. The Cloudflare Durable Objects sample (`samples/cloudflare/durable-objects/src/shoppingCarts/api.int.spec.ts`, `clientsEventStore`) hand-writes an `EventStore` that routes calls to Durable Objects and has no consumer, so it stops compiling.

## Q2

**Question:** In the Cloudflare sample, `clientsEventStore` sends each call to a different Durable Object store based on the stream name, so there is no single store whose messages a consumer could read. Once `consumer` is required, what should that sample do?

**Reply (verbatim):** "why df the durable objects have handwritten clientseventstore?"

**Explanation given:** The adapter exists only in the integration test. The sample keeps a separate SQLite event store per client inside that client's Durable Object (`shoppingCarts.getByName(clientId)` + `getShoppingCartEventStore(ctx.storage)`), so no single global store exists. `ApiSpecification.for` takes one `getEventStore` to seed `given` events and check `then` events, so `clientsEventStore` acts as one store: it reads the client id from the stream name and runs each call on that client's store with `runInDurableObject`. Added in 3522ef3d ("Ported Pongo cloudflare samples into Emmett"). `WrapEventStore` copies the inner store with `...eventStore`, so a required `consumer` carries over and that wrapper needs no change.

Q2 stays open; asked again below.

**Answer (verbatim):** "ok, then nvm just add in memory consumer for now"

**Interpretation:** This overrides Q1. `consumer` stays optional on the base `EventStore` interface. The scope is issue #427 only: add `consumer()` to the in-memory event store. The Cloudflare sample stays as it is. Making `consumer` mandatory is a possible follow-up.

## Q3

**Question:** The test "accepts a store that does not expose a consumer at all" in `eventStoreContract.unit.spec.ts` uses `getInMemoryEventStore()` as its example of a store without a consumer. Once the in-memory store has a consumer, that assertion fails. Should it be deleted, or kept with a different store that has no consumer, such as a hand-written object literal like the Cloudflare adapter?

**Reply (verbatim):** "ok, but does durable object and cloudflare have consumer or not?"

**Explanation given:** Yes. Both Cloudflare drivers (D1 and Durable Objects) go through `getSQLiteEventStore`, which always returns a store with `consumer()`. Consumer integration tests exist under `emmett-sqlite/src/storage/durableObject/eventStore/consumers/` and `storage/d1/`. The Cloudflare samples don't start a consumer; both use only inline projections. The only code without a consumer is the test-only `clientsEventStore` adapter in the Durable Objects integration test, which routes to one store per client. If `consumer` became mandatory, that adapter is the only code that stops compiling.

Q3 stays open; asked again below.

**Follow-up (verbatim):** "Check if all built-in have consumer"

**Findings:** Every built-in store except the in-memory one has `consumer()`. PostgreSQL (`getPostgreSQLEventStore`, and its `withSession` store, built by another `getPostgreSQLEventStore` call), SQLite (`getSQLiteEventStore` for the sqlite3, D1 and Durable Objects drivers, and its `withSession` store, built by another `getSQLiteEventStore` call), MongoDB (`getMongoDBEventStore`) and EventStoreDB (`getEventStoreDBEventStore`). In-memory (`getInMemoryEventStore`) has none (issue #427). `WrapEventStore` keeps whatever consumer the inner store has. After #427, the only code without a consumer is the test-only `clientsEventStore` adapter in the Durable Objects sample.

Q3 stays open; replaced below by a scope question, since its answer decides what happens to the contract test.

## Q4

**Question:** Should this spec cover only the in-memory `consumer()` (issue #427), with `consumer` still optional on `EventStore`? Or should it also make `consumer` required on `EventStore`? Making it required means the Durable Objects `clientsEventStore` adapter must change to compile, and the contract test for "a store without a consumer" goes away.

**Reply (verbatim):** "I asked you question"

**Explanation given:** Direct answers to the earlier questions. Durable Objects and D1 stores have a consumer (both use `getSQLiteEventStore`); only the test-only `clientsEventStore` adapter lacks one. All built-in stores have a consumer except in-memory (issue #427). PostgreSQL and SQLite `withSession` stores have one too.

**Answer (verbatim):** "Then yes, all eventstores should get consumer then"

**Interpretation:** Back to Q1. The spec covers both: add `consumer()` to the in-memory store (issue #427) and make `consumer` a required member of the base `EventStore` interface. This overrides the Q2 answer "just add in memory consumer for now".

## Q5

**Question:** `clientsEventStore` is the hand-written adapter in the Durable Objects integration test. It sends each `aggregateStream`, `readStream`, `appendToStream` and `streamExists` call to one client's Durable Object store, using the client id from the stream name. Once `consumer` is required, it won't compile without one. Each client has its own store, so there is no single message log for a consumer to read. What should `clientsEventStore` do once `consumer` is required?

**Reply (verbatim):** "forward to regular event store consumer, right?"

**Explanation given:** Not directly. (1) `consumer(options?)` takes no stream name, so the adapter can't pick which client's Durable Object to forward to. (2) `consumer()` returns a `MessageConsumer` synchronously, while `runInDurableObject(stub, callback)` returns `Promise<R>`. Cloudflare docs: it "temporarily replaces your Durable Object's `fetch()` handler with `callback`, then sends a request to it, returning the result". (3) The store is built from `state.storage` inside that one request, so a background polling consumer would outlive the request that gave it storage access. The test never calls `consumer()`; `ApiSpecification` uses only `appendToStream` and `readStream` (via `setup` and `appendedEvents`).

Q5 stays open; asked again below.

**Answer (verbatim):** "Then it can throw an error if it's not used, still, it's a disputable decision to wrap event store like that"

**Interpretation:** `clientsEventStore.consumer()` throws an error. The test doesn't call it, so the throw never runs in the current tests. Oskar thinks wrapping the event store this way is questionable in the first place; whether to rework it is asked next.

## Q6

**Question:** You said wrapping the event store like that is questionable. Should reworking that Durable Objects test, so it no longer needs a hand-written `EventStore`, be part of this spec? Or should it go in as a follow-up, with this spec only adding the throwing `consumer()`?

**Reply (verbatim):** "But I still don't understand why wouldn't it work"

**Explanation given:** Example: the test appends to `shopping_cart-A:1` (runs in Durable Object "A") and `shopping_cart-B:1` (runs in Durable Object "B"), so each lands in a different SQLite database. `consumer()` has no stream name or client id, so the adapter can't pick a store. Forwarding to A's store gives a consumer that never sees B's events; no single store holds both. Correction to Q5: the sync/async and lifetime points can be worked around (a wrapper `MessageConsumer` whose `start()` runs the real consumer inside `runInDurableObject`), but it still needs a client, so the core problem is the same. In the real app, a consumer would run inside each Durable Object over its own store; only the adapter's "one store for all clients" view has no matching consumer.

Q6 stays open; asked again below.

**Answer (verbatim):** "No it does not. but for now throw exception as not implemented, we won't be also reworking this sample in this PR, only in the follow up"

**Interpretation:** `clientsEventStore.consumer()` throws a "not implemented" error. Reworking the Durable Objects sample test is a follow-up, out of scope for this PR. My explanation of why forwarding doesn't work did not land for Oskar; it doesn't block this spec because the rework is a follow-up.

## Q7

**Question:** How should the in-memory consumer get the store's events? Should it reuse `inMemoryMessageSource`, with the store passing appended events into it, or should it read directly from the store's `streams` map?

**Answer (verbatim):** "it should reuse"

**Interpretation:** The in-memory consumer uses `inMemoryMessageSource`, and the store passes appended events into it through `append(...)`.

## Q8

**Question:** Should the in-memory store create one `inMemoryMessageSource` when the store is created, fill it on every `appendToStream`, and share it between all its consumers? Or should each `consumer()` call get its own source? With its own source, the store has to keep a list of open consumers so it can pass each new event to all of them.

**Answer (verbatim):** "in memory event store should get a global log and the consumer should read from it, or (an ennumerable ordering based on the global position, whatever is more efficient)."

**Interpretation:** The in-memory store keeps one global log, and all consumers read from it. Oskar left the efficiency choice to me. Chosen: a single append-only global log, the store's shared `inMemoryMessageSource`, filled on every `appendToStream` (combined with the Q7 answer). Reason: appending is one `push`, and the log stays ordered because global positions only grow. Ordering events from the `streams` map would mean collecting and sorting all events on every poll, O(n log n) per poll per consumer, against an O(n) scan of one array. `inMemoryMessageSource` keeps its existing `filter` scan per poll; replacing it with a slice by position would change `inMemoryMessageSource` itself and was not asked for.

## Q9

**Question:** Should the in-memory store now also accept async projections and offer `includeAsyncProjections` on its consumer? Or should its consumer run only the processors added to it explicitly, like `consumer.projector(...)` and `consumer.reactor(...)`?

**Answer (verbatim):** "Yes"

**Interpretation:** The first option. The in-memory store's `projections` option accepts `'async'` registrations as well as `'inline'`, and `consumer({ includeAsyncProjections: true })` adds those async projections to the consumer as projectors, as PostgreSQL and SQLite do today. MongoDB and EventStoreDB don't offer `includeAsyncProjections`.

## Q10

**Question:** Should the in-memory consumer's `workflowProcessor(...)` run workflows for real, using the in-memory store for workflow and output streams? Or should it use `unsupportedWorkflowProcessor` and throw for now?

**Reply (verbatim):** "it should use it"

**Note:** Ambiguous: "use it" can mean the in-memory store (real workflows) or `unsupportedWorkflowProcessor` (throw). Asked to confirm.

**Answer (verbatim):** "dude, run for real"

**Interpretation:** The in-memory consumer's `workflowProcessor(...)` runs workflows for real, using the in-memory store for workflow and output streams. It doesn't use `unsupportedWorkflowProcessor`.

## Q11

**Question:** Which of these should the in-memory consumer copy: only `testConsumerSchemaVersion`, the shared reactor error scenarios too, or also the per-driver consumer suites that aren't tied to SQL?

**Answer (verbatim):** "Do all that SQLite has that aren't tied to SQL"

**Interpretation:** The in-memory store copies every SQLite consumer scenario that isn't tied to SQL. That covers `testConsumerSchemaVersion` and the `reactorErrors.features.ts` scenarios from `emmett-tests`, plus the SQLite consumer suites `sqliteEventStoreConsumer.int`, `.handling`, `.awaiters`, `.projections`, `.inMemory.projections`, `.workflow` and `.unit`. The unit suite covers an injected message source, registering an existing processor through `reactor`, and the store returning a strongly typed consumer, so the in-memory consumer also accepts an injected `source`. Skipped as tied to SQL: `.schema`, `sqliteProcessor.transactions`, `sqliteProcessor.pool` and `rebuildSQLiteProjections`.

## Q12

**Question:** What should replace the test "accepts a store that does not expose a consumer at all" in `eventStoreContract.unit.spec.ts`? The options are: deleting it with nothing in its place, or turning it into a type-level check that a store without `consumer` no longer compiles as `EventStore` (a `// @ts-expect-error` case).

**Reply (verbatim):** "this test is just to ensure we're able to inject the soure for testing."

**Note:** Unclear which test "this test" refers to. The contract test doesn't inject a source. SQLite's `.unit` test "handles messages read from the injected source" does, and Q11's interpretation used it to add an injected `source` option. Asked to clarify.

**Reply (verbatim):** "then ask questions so I could give clear answer"

**Note:** The clarification packed two questions into one. Split into Q13 (injected `source` option) and Q14 (contract test), asked one at a time.

## Q13

**Question:** Should the in-memory consumer accept an injected `source` option, the way SQLite's consumer does? Yes or no.

**Answer (verbatim):** "yes and cut this passive agressive tone"

**Interpretation:** Yes. The in-memory consumer accepts an injected `source` option, and the copy of SQLite's "handles messages read from the injected source" test covers it.

## Q14

**Question:** `eventStoreContract.unit.spec.ts` has a test, "accepts a store that does not expose a consumer at all". Once `consumer` is required, it no longer holds. Should it be deleted, or replaced with a check that a store without `consumer` fails to compile as `EventStore`?

**Answer (verbatim):** "yes, it should be deleted"

**Interpretation:** Delete the test, with nothing in its place. The other contract test, "accepts a store that narrows the consumer member", stays.

## Q15

**Question:** Should this PR update those two pages (`guides/choosing-event-store.md` and `api-reference/eventstore.md`), adding async projections and a consumer example for the in-memory store, backed by a snippet test like PostgreSQL's?

**Answer (verbatim):** "yes"

**Interpretation:** Update both pages. In the comparison matrix, In-Memory's "Built-in Projections" changes from "Inline" to "Inline + Async". The In-Memory sections get a consumer example drawn from a snippet test, the way the PostgreSQL page uses `postgreSQLConsumer.int.spec.ts`.

## Q16 (spec r1)

**Question:** Is `getInMemoryEventStore().consumer(...)` the only seam you want, or should the in-memory store also get a standalone consumer factory, like `sqliteEventStoreConsumer`?

**Answer (verbatim):** "it should get it"

**Interpretation:** The in-memory store also gets a standalone consumer factory, `inMemoryEventStoreConsumer(...)`, named like `sqliteEventStoreConsumer`, `postgreSQLEventStoreConsumer`, `mongoDBEventStoreConsumer` and `eventStoreDBEventStoreConsumer`. Tests use both seams, the way the SQLite tests do.

## Q17 (spec r1)

**Question:** What should `inMemoryEventStoreConsumer(...)` take to find events when no `source` is passed? The choices are: the in-memory event store itself (`inMemoryEventStoreConsumer({ eventStore })`), or nothing, in which case `source` is required for the standalone factory.

**Answer (verbatim):** "It needs to have either source (then it could be also used as the default consumer for new supporting only END startFrom) or eventstore"

**Interpretation (partial):** `inMemoryEventStoreConsumer(...)` takes either `source` or `eventStore`, one of the two. The parenthetical is unclear; asked to clarify.

## Q18 (spec r1)

**Question:** Which reading of the bracket did you mean? A: for now, the `source`-only form works as a general default consumer, but only with `startFrom: 'END'`. B: a store that has no consumer of its own, like the Durable Objects `clientsEventStore`, can use `inMemoryEventStoreConsumer({ source })` as its default consumer, limited to `startFrom: 'END'`.

**Answer (verbatim):** "I mean both could be fine, but I don't think that we can easily limit it to startFrom: 'END' so rather A, right?"

**Interpretation:** A, with no `startFrom` limit. `inMemoryEventStoreConsumer({ source })` is a general consumer over whatever source it gets. Confirmed with evidence: each processor resolves `startFrom` inside its own `start()` (`processors.ts`), so the consumer can't enforce `'END'` without reaching into processor internals. The limit isn't needed either, because `inMemoryMessageSource` keeps every message, so `'BEGINNING'` and checkpoints work. `clientsEventStore.consumer()` still throws "not implemented" (Q6).

## Q19 (spec r1)

**Question:** Where should the polling frequency for the in-memory store's consumers be set? The choices are: in the store options (`getInMemoryEventStore({ ... })`, applying to all its consumers), or not configurable, always using the default of 50 ms with back-off.

**Answer (verbatim):** "The polling for now doesn't make sense as we can push it right after we get append event from source, right? Also, when I think then just passing event store doesn't make much sense, as we don't have readall method for now"

**Interpretation:**
1. No polling. The global log pushes appended messages to the reading consumers right after the append. Evidence: `subscriptionMessageSource` already exists as a push-based source (used by MongoDB and EventStoreDB) and wraps a `subscribe({ from, batchSize, signal })` async iterable. No test or caller passes `pullingFrequencyInMs` to `inMemoryMessageSource`; its users are its own unit spec and the injected-source unit specs of the four store consumers.
2. This replaces part of Q17. `inMemoryEventStoreConsumer(...)` takes only `source`, which is required. `EventStore` has no `readAll`, and the global log is private to the in-memory store, so passing the event store gives the factory nothing public to read. The store's own `consumer()` passes its global log as the source.

## Q20 (spec r1)

**Question:** Should `inMemoryMessageSource` itself switch from polling to push, built on `subscriptionMessageSource` with `pullingFrequencyInMs` removed? Yes or no.

**Answer (verbatim):** "I think so, wouldn't that make sense?"

**Interpretation:** Yes. `inMemoryMessageSource` is built on `subscriptionMessageSource`, and the `pullingFrequencyInMs` option is removed. Reasons given: appended messages reach consumers straight away instead of after up to 50 ms (1 s with back-off); an idle consumer waits on a promise instead of waking on a timer and scanning the array; the existing `inMemoryMessageSource` unit spec scenarios describe behaviour, not polling, so they stay valid. Constraint kept: the source sends the "caught up" control message (`MessageSourceCaughtUp`) each time it has delivered everything it holds, after the first catch-up and after each burst of appends, so `whenCaughtUp()` keeps working.

## Q21 (spec r1)

**Question:** Do these seams match what you expect? (1) `getInMemoryEventStore(...).consumer(...)` as the main seam; (2) `inMemoryEventStoreConsumer({ source })` as the standalone seam; (3) `inMemoryMessageSource` unit spec plus push scenarios; (4) type level: `EventStore` contract spec with the "no consumer" test deleted, and an `expectTypeOf` check that `getInMemoryEventStore().consumer()` returns the typed in-memory consumer. The Durable Objects `clientsEventStore` throw gets no test of its own.

**Answer (verbatim):** "OK"

## Q22 (spec r1)

**Question:** Where should the standalone consumer's `workflowProcessor(...)` get its message store? A: each `workflowProcessor({ ..., messageStore })` call takes it. B: `inMemoryEventStoreConsumer({ source, messageStore })` takes an optional one, used only for writing. C: the standalone consumer's `workflowProcessor` throws, so only the store's `consumer()` runs workflows.

**Answer (verbatim):** "I think that B would be consistent, isn't it?"

**Interpretation:** B. `inMemoryEventStoreConsumer({ source, messageStore? })` takes an optional `messageStore` (an `EventStore`), which workflow processors use as `context.session.messageStore` for writing output. Confirmed consistent: SQLite's standalone factory takes its connection at consumer level and uses it for both reading and the workflow message store; the name matches the field the workflow reads. The store's own `consumer()` passes the store itself as `messageStore`.

## Q23 (spec r1)

**Question:** When `messageStore` wasn't passed, should the standalone consumer's `workflowProcessor(...)` throw an `EmmettError` straight away, at the call? Yes or no.

**Answer (verbatim):** "man, if it's required to pass it, then we should pass it then, right?"

**Interpretation:** `messageStore` is a required option of `inMemoryEventStoreConsumer({ source, messageStore })`, not optional, so there is no missing-store path to handle. This tightens the Q22 answer. Consequence: every standalone use passes a message store, including reactor-only ones such as the copied injected-source tests (they pass, for example, `getInMemoryEventStore()`).

## Q24 (spec r3)

Context: spec r1 review findings Q&A-1 and Quality-1.

**Question:** Should processors on the store's own `consumer()` use the store's `InMemoryDatabase` for checkpoints and read models, unless a processor names its own database? Yes or no.

**Answer (verbatim):** "yes, but only in memory store has database, so how would you do it for others?"

**Interpretation:** Yes. Processors on the in-memory store's `consumer()` use the store's `InMemoryDatabase` unless a processor names its own database.

**Explanation given:** Nothing changes for other stores; each already keeps checkpoints in its own storage. PostgreSQL and SQLite use a processors table in the same database; MongoDB uses a checkpoints collection in the same database (`mongoDBCheckpointer.ts`); EventStoreDB uses a checkpoint stream per processor in the same EventStoreDB (`getEventStoreDBCheckpointStreamName` in `eventStoreDBCheckpointer.ts`). The in-memory store's own storage for non-event data is its `InMemoryDatabase`, which inline projections already use, so this brings the in-memory store in line with the others.

## Q25 (spec r3)

Context: spec r1 review findings Q&A-1 and Quality-1.

**Question:** Should `inMemoryEventStoreConsumer` take an optional `database` option, used for every processor that doesn't name its own, with each processor creating its own database when the option is left out, as today? Yes or no.

**Reply (verbatim):** "This would be a weird design tbt"

**Note:** Rejected as proposed. Asked which source of the database Oskar wants instead.

**Question (asked again):** Where should the standalone consumer's processors get their database? A: a required `database` option on `inMemoryEventStoreConsumer`. B: from `messageStore` when it's an in-memory store (`messageStore.database`), and a fresh database otherwise. C: each processor on its own, as today, with the store's `consumer()` passing its database to each processor it creates.

**Answer (verbatim):** "Let's start with B, remember that inmemory consumer can get non-inmemory processors"

**Interpretation:** B. When the consumer's `messageStore` is an in-memory store, in-memory processors created through the consumer's `reactor(...)`, `projector(...)` and `workflowProcessor(...)` options, which don't name their own database, use `messageStore.database` for checkpoints and read models. Otherwise they keep today's default, their own fresh database. The store's `consumer()` passes the store as `messageStore`, so its processors use the store's database (Q24). Processors registered already built, such as non-in-memory processors passed to `consumer.reactor(processor)`, keep their own storage; the consumer doesn't touch them. "Let's start with" marks this as the current choice, open to change later.

## Q26 (spec r3)

Context: spec r1 review finding Quality-2.

**Question:** Should the in-memory `appendToStream` also return `lastEventGlobalPosition`, as PostgreSQL and SQLite do? Yes or no.

**Answer (verbatim):** "yes"

**Interpretation:** The in-memory `appendToStream` returns `AppendToStreamResultWithGlobalPosition`: `lastEventGlobalPosition` is the global position (checkpoint) of the last appended event. The copied SQLite scenarios keep using it unchanged.

## Q27 (spec r3)

Context: spec r1 review finding Quality-5.

**Question (first form):** For the new in-memory consumer snippet, which should this PR do? A: follow the existing snippets, type-checked only, not run. B: add a Vitest project that runs the unit snippet specs under `docs/snippets`. C: something else.

**Reply (verbatim):** "and i told you to cut the passive agressive tone

snippets should be from tests"

**Follow-up (verbatim):** "and why do you claimeventStores/consumers/postgreSQLConsumer.int.spec.ts - is not executed?"

**Explanation given:** Checked directly. `npx vitest list --filesOnly` from `src` lists 360 test files, none under `docs/snippets`. The root `src/vitest.config.ts` lists per-package projects plus `bundle` and `agents`; none includes `docs/snippets`, and no package Vitest config mentions `docs` or `snippets`. CI `build_and_test.yml` runs `npm run test` over those projects; `build_and_deploy_docs.yml` runs only `build:ts` and `lint` for code. So the snippet specs are type-checked (root `tsconfig.json` includes `docs/**/*.ts`) but never run.

**Question (asked again):** Should this PR add a Vitest project that runs the spec files under `docs/snippets`, so the in-memory consumer snippet test, and the existing ones, actually execute? Yes or no.

**Answer (verbatim):** "then they should be run"

**Interpretation:** Yes. This PR adds a Vitest project to the root `src/vitest.config.ts` that collects the spec files under `docs/snippets`. The existing scripts select by suffix (`test:unit` = `.unit.spec`, `test:int` = `.int.spec`, `test:e2e` = `.e2e.spec`), so unit snippets run with `npm run test:unit` and the PostgreSQL consumer snippet runs with `npm run test:int`. The existing snippet specs then run too and have to pass.

## Q28 (spec r3)

Context: spec r1 review finding Quality-10.

**Question:** Should async projections run by the in-memory store's `consumer({ includeAsyncProjections: true })` also get `context.eventStore` set to the store, the same as inline ones? Yes or no.

**Reply (verbatim):** "Dude, I told you dozen of time to cut this passive agressive tone didn't i?"

**Note:** Tone complaint about the "Yes or no." endings and answer recaps. Question asked again without them.

**Question (asked again):** Inline in-memory projections get `context.eventStore` and `context.database`. A projection run by `inMemoryProjector` gets only `context.database`. Should async projections run through `consumer({ includeAsyncProjections: true })` also get `context.eventStore`, set to the store?

**Answer (verbatim):** "ok"

**Interpretation:** Yes. Async projections run by the store's consumer get `context.eventStore` set to the store and `context.database` set to the store's database, the same as inline projections.

## Q29 (spec r4)

Context: spec r3 review findings Q&A-1 and Quality-1.

**Question:** The standalone consumer's `messageStore` is typed as a plain `EventStore`. Nothing in the code marks a store as in-memory today. Only `InMemoryEventStore` has a `database` member. How should the consumer decide that `messageStore` is an in-memory store and use its `database`? A: check whether `messageStore` has a `database` member. B: add a marker to what `getInMemoryEventStore` returns, and check for that. C: give the factory a typed overload, so an `InMemoryEventStore` is recognised from its type.

**Answer (verbatim):** "A"

**Interpretation:** The consumer checks whether `messageStore` has a `database` member and, if so, uses it as the database for the in-memory processors it creates. The `messageStore` is fixed when the factory is called, so the check runs once, there.

## Q30 (spec r4)

Context: spec r3 review finding Quality-2.

**Question:** Async projections added through `includeAsyncProjections` will get `context.eventStore` set to the store. Should only those get it? Or should every processor on the store's consumer get it, including projections passed to `consumer.projector(...)` and reactors? The second option would also cover a standalone consumer whose `messageStore` is an in-memory store.

**Reply (verbatim):** "I thought that context already has such field, does it?"

**Explanation given:** In-memory processors don't get it today. Two similar fields exist: (1) `context.eventStore`, given only to inline in-memory projections (`inMemoryProjection.ts:59-64`, type `InMemoryProjectionHandlerContext` with optional `eventStore`); (2) `context.session.messageStore` (`MessageStoreSession`, `workflowProcessor.ts:59-61`), which workflows use to append output and which SQLite's processing scope fills for every SQLite processor (`sqliteProcessor.ts:249`). `InMemoryProcessorHandlerContext` has only `{ database, session, observabilityScope }`, and `session` stays empty unless the consumer passes something.

Q30 stays open; asked again below.

**Question (asked again):** For in-memory processors on the consumer, which should carry the store? A: `context.session.messageStore` for every processor, as SQLite does, set to the consumer's `messageStore`, with `includeAsyncProjections` projectors also getting `context.eventStore`. B: `context.eventStore` only, for the `includeAsyncProjections` projectors. C: something else.

**Answer (verbatim):** "Dude, it should just behave consistently to how sqlite and postgresl behaves"

**Interpretation:** Match SQLite and PostgreSQL. Their processing scopes fill `context.session.messageStore` for every processor, whether reactor, projector or workflow (`sqliteProcessor.ts:249`, `postgreSQLProcessor.ts:369`). Their projections get the same storage handle whether inline or async (`execute`, `connection` etc.), and no `context.eventStore`. For the in-memory consumer:
- every in-memory processor it creates gets `context.session.messageStore` set to the consumer's `messageStore`;
- every one gets `context.database`, the in-memory storage handle (Q24/Q25 rule);
- async projections get no extra `context.eventStore`.
This overrides Q28.

## Q31 (spec r6)

Context: spec r5 review findings Q&A-1, Q&A-2, Quality-1, Quality-2.

**Question:** In SQLite, each processor builds `session.messageStore` in its own processing scope from its own connection (`sqliteProcessor.ts:237-255`), so a SQLite processor has it whether the consumer created it or it was passed in already built; processors from other packages don't get it. For in-memory processors to work the same way, `inMemoryReactor` and `inMemoryProjector` would need a new option to know the store, set by the consumer. The other way is for the consumer's scope to pass `session.messageStore` to every processor. Which should the in-memory consumer do?

**Reply (verbatim):** "why would projector need to know the store? If they really need, we can put messageStore consistently, but I don't understand"

**Explanation given:** Projectors don't need it; spec r5 was wrong to give it to every processor. Readers of `session.messageStore` in core: workflow processors append output through it (`workflowProcessor.ts:245`, `:316`) and need it; `withScopedMessageStore` (`processors.ts:432-479`) wraps it for any handler that appends through it, so appended messages continue the trace, which is useful for reactors but optional (the reactor error scenarios append through a captured store, `reactorErrors.features.ts:93`); projectors never read it, they write to `context.database` or `execute`. SQLite projectors get it only because all SQLite processors share one processing scope.

Q31 stays open; asked again below.

**Question (asked again):** Workflow processors on the in-memory consumer get `session.messageStore`, since they need it, and projectors don't. Should in-memory reactors get it too, as SQLite reactors do, so a reactor can append through it and keep the trace?

**Answer (verbatim):** "Yes, reactors should get it too"

**Interpretation:** `session.messageStore` goes to in-memory reactors and workflow processors, not to projectors. This narrows the r5 spec statement that every processor gets it.

## Q32 (spec r6)

**Question:** To match SQLite, `inMemoryReactor` would get an optional `messageStore` next to `connectionOptions.database`, set by the consumer on the reactors it creates; a reactor passed in already built keeps whatever it was created with; the handler type would have an optional `session.messageStore: EventStore`. Does that match what you want?

**Reply (verbatim):** "Dude, options should be consistent across context, is your proposal consistent or monkey patching?"

**Explanation given:** Not monkey patching, but inconsistent. SQLite reactors have no `messageStore` option: reactors and projectors share one option shape (`SQLiteProcessorOptionsBase`) with only `connectionOptions` (`connection`, `pool`). `sqliteEventStoreConsumer` passes `pool` and `connectionOptions` through its `scope` (`sqliteEventStoreConsumer.ts:259-267`), and each processor's scope builds `session.messageStore` from them. The consistent in-memory way needs no new processor option: the in-memory consumer passes `session: { messageStore }` through its `scope`, and `inMemoryProcessingScope` already forwards the consumer's `session` into the handler context (`inMemoryProcessors.ts:179-183`). Every processor on the consumer then sees it, projectors included (they don't use it), as in SQLite.

Q32 stays open; asked again below.

**Question (asked again):** Should the in-memory consumer pass `session.messageStore` through its `scope`, as SQLite's consumer passes its session, with no new options on `inMemoryReactor` or `inMemoryProjector`?

**Answer (verbatim):** "yes"

**Interpretation:** The in-memory consumer's `scope` passes `session: { messageStore }`, set to the consumer's `messageStore`, so every processor on the consumer sees it, as on SQLite. That includes processors passed in already built, and projectors, which don't use it. `inMemoryReactor` and `inMemoryProjector` get no new options. This refines Q31: reactors and workflow processors get it as Q31 asked, and projectors also see it for consistency with SQLite.

**Derived typing (flagged to Oskar in the spec summary):** `InMemoryProcessorHandlerContext`'s session declares `messageStore?: EventStore`, optional, because an in-memory processor run outside a consumer has an empty session. SQLite declares it as required because its processors always build it. The workflow processor keeps its required `MessageStoreSession`.

## Q33 (spec r7)

**Question:** Should `session.messageStore` be optional in the in-memory handler type, as I wrote it, or required as in SQLite?

**Answer (verbatim):** "Man, how many times do I need to tell you that it has to be consistent?"

**Interpretation:** Required, as in SQLite. `InMemoryProcessorHandlerContext`'s session declares `messageStore: EventStore`. This replaces the derived optional typing in Q32.

## Q34 (spec r8)

Context: spec r7 review findings Q&A-1 and Quality-2.

**Question:** Making `session.messageStore` required (Q33) collides with in-memory processors hosted by other stores' consumers, which pass no `messageStore`: the type promises an `EventStore`, the handler gets `undefined`. EventStoreDB declares `messageStore?` optional. A: optional, as EventStoreDB. B: required, with every consumer that hosts in-memory processors passing its store as `session.messageStore`.

**Reply (verbatim):** "I don't understand, why ESDB has it optional?"

**Explanation given:** Correction: EventStoreDB is not a precedent for optional. Its processing scope always sets `messageStore: getEventStoreDBEventStore(options.client)` (`eventStoreDBProcessor.ts:99`), built from the processor's own `client`, as SQLite builds it from its connection. The `?` on the type has no runtime reason found; it came in with d3a783a8 ("Aligned the event store driver handling across stores"). Every store's processors build `messageStore` themselves and always have it. In-memory processors are the exception: their only "connection" is `connectionOptions.database`, and a store can't be built from a database, so they get it only from the hosting consumer (Q32). SQLite, PostgreSQL, MongoDB and EventStoreDB consumers that host in-memory processors (as some existing tests do) pass no `messageStore` today.

Q34 stays open; asked again below.

**Question (asked again):** When an in-memory processor runs on another store's consumer, for example an `inMemoryProjector` on a SQLite consumer, where should its `session.messageStore` come from? A: that consumer passes its own store through its scope, so the type stays required and the value is always there. B: it stays missing there, and the in-memory type makes `messageStore` optional.

**Answer (verbatim):** "A"

**Interpretation:** The SQLite, PostgreSQL, MongoDB and EventStoreDB consumers each add `messageStore` to the session they pass through their `scope`. They build it from the consumer's own connection, the same way their processors build it in their processing scopes. In-memory processors hosted by any consumer then always have `session.messageStore`, and the type stays required (Q33).

**Follow-up note (verbatim):** "still, remember that processors eventually may not have event store if e.g. they come from kafka, sqs, etc"

**Note:** A consumer reading from Kafka or SQS may have no event store, so `session.messageStore` could be missing there. Asked whether this changes the required typing now or is a note for later.

## Q35 (spec r8)

**Question:** Should the Kafka/SQS case change the typing now, making `session.messageStore` optional for in-memory processors? Or should the spec keep it required and record the Kafka/SQS case as a follow-up?

**Answer (verbatim):** "The latter"

**Interpretation:** Keep `session.messageStore` required. Record as a follow-up: consumers whose source isn't an event store (Kafka, SQS, etc.) may have no message store, so the required typing has to be revisited when such consumers are added.

## Q36 (spec r11)

Context: spec r9 review finding Q&A-2.

**Question:** A MongoDB `messageStore` built from a client alone uses the default storage settings, so with custom `storage` options, events appended through `session.messageStore` land in the default storage (the MongoDB workflow processor already behaves this way). Default storage fine for this PR, with custom storage as a follow-up? Or should the MongoDB consumer pass the store's `storage` options through?

**Reply (verbatim):** "how pg does it?"

**Explanation given:** PostgreSQL passes the store's settings through. The store's `consumer()` passes its schema settings (`...databaseSchema`) to the consumer (`postgreSQLEventStore.ts:725-731`); the consumer passes them to each processor as `migrationOptions`; each processor builds `messageStore` with `schema: { ...options.migrationOptions, autoMigration: 'None' }` (`postgreSQLProcessor.ts:369-378`). So a processor's message store always writes to the store's schema.

**Resolution (by the standing consistency rule):** MongoDB does the same with `storage`: the store's `consumer()` passes its `storage` options to the consumer, the consumer passes them to the processors it creates, and every MongoDB `messageStore` (consumer scope, reactor/projector scope, workflow scope) is built from the client plus those options.

## Q37 (spec r12)

Context: spec r11 review findings (MongoDB `storage`).

**Question:** The MongoDB consumer already ignores custom `storage`: its change-stream source watches the default database and keeps only `emt:`-prefixed collections. Should this PR keep MongoDB on default storage and move custom `storage` support (source, message stores, processor options) to a follow-up, or do all of it?

**Answer (verbatim):** "if it's a simple change do it now"

**Explanation given:** `databaseName` is simple: all storage shapes have it, and the source already takes `dbName` (`mongoDBMessageSource.ts:49`). Custom collection names are not: the change stream filters `^emt:` (`mongoDBSubscription.ts:199`); defaults match, but `SINGLE_COLLECTION` `collectionName` and `CUSTOM` `collectionFor` can return any name, and `CUSTOM` can return a different database per stream type, which one watch can't follow.

## Q38 (spec r12)

**Question:** Should this PR do the `databaseName` part (source plus message stores) and record custom collection names and per-stream-type databases as a follow-up?

**Answer (verbatim):** "yes"

**Interpretation:** This PR: the MongoDB consumer passes `storage.databaseName` to its source and builds every `messageStore` with the store's `storage`. MongoDB processors get an optional `storage` option, filled by the consumer's factories when the caller gave none, as PostgreSQL's consumer fills `migrationOptions` (`postgreSQLProcessor.ts:319`, `postgreSQLEventStoreConsumer.ts:224-236`); the standalone `mongoDBEventStoreConsumer` gets an optional `storage` option. Follow-up: custom collection names not prefixed `emt:` and `CUSTOM` per-stream-type databases.

## Note (spec r13)

Spec r12 review: MongoDB checkpoints follow `storage.databaseName`, resolved by the standing consistency rule (PostgreSQL's checkpointer follows `migrationOptions.databaseSchemaName`). No new question asked.

## Note (spec r15, plan r2)

Plan r1 review: Oskar approved ("ok") the proposed resolutions. Spec r15: new 2.12 (copy SQLite handling-suite eachMessage and store-created scenarios, except the SQLITE_BUSY one and the pool teardown part); 8.2 narrowed to SQLite's in-memory projections suite; 9.5 drops the append through `session.messageStore` (Q31: projectors don't use it); 9.7 asserts `messageId`, `correlationId`, `causationId` as the core processor observability test does; `inMemoryMessageSource` keeps `batchSize` and passes it to `subscriptionMessageSource`. Plan r2: steps 2, 6, 7, 9 merged (the generic consumer needs all three processor factories at once); tests in steps before the required-type step cast `context.session.messageStore` to `EventStore`, and that step removes the casts.

## Note (plan r6)

**Question:** In our in-memory copies, should we keep the `finally` that closes the consumer, but drop the `catch` and assert order and every field? And should I file a GitHub issue for the assertion-swallowing `catch` blocks in the PostgreSQL and SQLite consumer suites?

**Answer (verbatim):** "ok, then drop this and tell me if it doesn't work"

**Interpretation:** The copies drop the swallowing `catch`, keep `finally`, and assert order and every field. If a copy fails without the `catch`, the implementer stops and reports it. The GitHub issue question wasn't answered, so no issue is filed.

## Note (run-plan, Step 2 deviation)

**Question:** Step 2 made `checkpoints: 'DISABLED'` work for in-memory processors: the checkpoint goes to a private `InMemoryDatabase` instead of the shared `connectionOptions.database`, so a restarted processor starts fresh, as on SQLite (spec 2.12). Keep it and continue with Step 3?

**Replies (verbatim):** "We can store it in in memory dastabase, right?" then, after the explanation that it is still stored in memory but in a private database, "ok".

**Interpretation:** Keep the deviation.


## Note: partial matchers in other drivers' consumer specs

Question: The SQLite, PostgreSQL, MongoDB and EventStoreDB consumer specs check received events with `containsOnlyElementsMatching` / `containsElementsMatching` (about 160 assertions in 13 files). Fix them in this PR after Step 13, or file an issue?

Answer: "in this"

Decision: after Step 13, replace them with ordered full-event assertions, the same way as the in-memory consumer specs.

## Note (run-plan, Step 6 review)

**Question:** No test checks that `includeAsyncProjections` leaves inline projections out; and should the copied `// TODO: Fix this cast...` comment stay?

**Answer (verbatim):** "1. Add test. 2. Can this be easily fixed?"

**Interpretation:** Test added. The cast can't be removed without making the store generic over projection event types in all drivers, so the cast and TODO stay, matching SQLite and PostgreSQL.

## Note (after Step 9): open review findings

**Question:** Step 1 has no test for the abort-listener cleanup; Step 2 copied scenarios use partial matchers.

**Answer (verbatim):** "1. Could you add such test? 2. Wot? could you fix and align it checking if other drivers don't have such issue?"

**Interpretation:** Listener cleanup test added. In-memory partial matchers replaced; other drivers surveyed (then fixed, see the partial matchers note).

## Note: EventStoreDB processor scope builds a store per handler call

**Question:** Move `getEventStoreDBEventStore(client)` in `eventStoreDBProcessingScope` to processor creation, as Step 10 did for MongoDB?

**Answer (verbatim):** "Yes."

## Note: workflow commands stored as `kind: 'Event'`

**Question:** MongoDB reads workflow commands back as `kind: 'Event'`; file an issue?

**Answers (verbatim):** "Wasn't that already fixed on main?" / "if not, then fix it, and check other stores" / "Inputs skip the kind ?? ... fallback because the store fills in 'Event' first - shouldn't we fix the root cause?" / "We shouldn't try to hack, the message stored is the state of the art, we shouldn't change their kind and ignore it" / "if the tests are not setting kind as they should then we should do it"

**Interpretation:** No library change. `handleWorkflow.ts` stays as on main: stored messages keep the kind they carry; no inference from `inputs`/`outputs` lists. Test code sets `kind: 'Command'` on commands (inputs and `decide` outputs).

## Note: hacks

**Answer (verbatim):** "Then drop all those \"real hacks\" and do a proper resaearch if there's something more"

**Interpretation:** Output kind fallback removed; fake store in `InMemoryProjectionSpec` replaced with `getInMemoryEventStore({ database })`; `globalLog` cast still open (see item 5 below); a read-only audit of the whole diff was run.

## Note: audit follow-ups

1. **Question:** Should `eventStore.consumer()` pass the store itself as `session.messageStore` (so appends get the store's projections and hooks), with consumers created without a store building one from their connection?
   **Answer (verbatim):** "a)"
   **Interpretation:** Yes. This changes the earlier spec decision (consumers build the message store from their own connection). Consumers created directly, without a store, keep building one from their connection.
2. **Question:** Tests append raw commands to feed workflows, which needs `as unknown as Event[]` or leaves `kind` out. How should tests feed commands?
   **Answers (verbatim):** "Workflows are hiding that behind abstraction. Why do you want to append raw command?" / "Then do the case for step 2 or use handleWorkflow" / "and do it consistently"
   **Interpretation:** Tests give command inputs to workflows through `handleWorkflow`, the same way in every store. Tests that exist to show the consumer handling the initiating command are listed for Oskar before changing them.
3. **Question:** Driver specs copy the received checkpoint into the expected events.
   **Answer (verbatim):** "This is bs, why would you copy from expected to actual instead of excluding it from test?"
   **Interpretation:** Exclude subscription-assigned checkpoint fields from the comparison, consistently across stores.
4. **Question:** The MongoDB test "stops processing on unhandled error in handler" has no stream filter and gets another test's event first.
   **Answers (verbatim):** "which reactor? And if most has that line then why didn't this one have it?" / "Ok, then add it"
   **Interpretation:** Add the stream filter.
5. **Question:** The in-memory store keeps both a global log and a streams map.
   **Answer (verbatim):** "We shouldn't keep both global log and streams map, isn't that duplicating the memory?" / "what would be the memory efficient way?" / "I want the memory efficient structure without overengineering"
   **Interpretation:** The global log is the only storage. No streams map; `readStream` filters the log by stream name. Global position is the index in the log plus 1.
6. **Question:** The in-memory consumer finds its database by checking for a `database` member on the message store (Q25 B).
   **Answer (verbatim):** "I don't see a reason why would consumer get database, it's orthogonal."
   **Interpretation:** No separate `database` option on the consumer. The Q25 B / Q29 rule stays as it is.
   **Follow-up (verbatim):** "where did I say that? We were discussingg this 100 times" (after I wrongly read the answer as reversing Q25 B)
7. **Question:** Async projections get no `context.eventStore`, while inline projections do.
   **Answer (verbatim):** "why event store? This doesn't sounds consistent and we already discussed that we should make it consistent, chec qa"
   **Follow-up (verbatim):** "why is it waiting on me?"
   **Interpretation:** Q30 already decided it: projections get only their storage handle, as in SQLite/PostgreSQL. `eventStore` is removed from `InMemoryProjectionHandlerContext`; inline and async in-memory projections both get `database`.

## Note: driver processors append without the store's options

**Question:** A SQLite/PostgreSQL/MongoDB/EventStoreDB reactor appending through `context.session.messageStore` uses a store its processor scope builds, without the user's inline `projections`, `hooks` or observability (pre-existing on main). File an issue and keep it out of this PR?

**Answer (verbatim):** "And why can't you fix it now?"

**Interpretation:** Fix it in this PR. How to fix it is not agreed yet.

**Follow-up (verbatim):** "Did we agree on something? I didn't notice" (after I started a design he hadn't approved)

**Later answer (verbatim):** "This should go through /brainstorm and /specification flow, but B" / "ok, let's keep it outtside, file a GH issue"

**Interpretation:** Direction B (processors build their store with the store's options), but out of this PR: filed as a GitHub issue, brainstorm in `brainstorms/processor-message-store-options/`.

Issue: https://github.com/event-driven-io/emmett/issues/432

## Note: regular-mode workflow test

**Question:** "processes messages directly in regular mode (separateInputInboxFromProcessing: false)" needs a raw command in an ordinary stream, which `handleWorkflow` can't set up. Keep, rewrite or drop?

**Answer (verbatim):** "Then just append it with cast if it adds value"

**Interpretation:** It's the only test of regular mode, so it adds value. In all seven workflow specs, append the command with `kind: 'Command'` and `as unknown as Event[]`, and assert the stored input copy is `'Command'`.

## Note: `inMemoryMessageSource` mutates the caller's array (final review finding 3)

**Question:** After the single-array change, `inMemoryMessageSource({ messages })` pushes into the caller's array on `append`, which spec.md says keeps its current behaviour. Keep that, or another way?

**Answers (verbatim):** "can't it pass async enumerable?" / "would it solve your issue?" / "do we need append then ?" / "yup, I think so, thoughts?"

**Interpretation:** Not agreed yet. The `append` removal and an async-iterable input are under discussion.

**Follow-up (verbatim):** "I don't understand this shape, plus we didn't agree on anything"

**Follow-up (verbatim):** "How can I tell you that this is tle flip if we didn't agree on caught up?"

**Question:** Caught-up with an async-iterable input: the store hands over groups of events (the source sends the marker after each group), or the store puts the `MessageSourceCaughtUp` marker into the sequence itself?

**Answer (verbatim):** "I want it to be done the simplest way and I don't understand why would store need to know about the caught up, this is madness"

**Interpretation:** The store must not know about caught-up; only the source decides it. Pick the simplest way.

**Question:** Accept that `inMemoryMessageSource` now uses the array passed in, without copying it?

**Answer (verbatim):** "Didn't I say that I don't want to double memory size?"

**Interpretation:** No double memory: one array only. The rest is not agreed yet.

**Follow-up (verbatim):** "Dude, store in memory to never proceed without explicit approval after discussion about some ssue. If the array is passed and it's the same array, then why do you call append? This is weird api"

**Follow-up (verbatim):** "DThat's why I said and suggested async enumerable as it'd be waken on the append."

**Question:** The source takes a function from the store, `read(after)`, that returns an async iterable of event arrays: the stored events after `after` first, then one array per append. The source sends caught-up after each array; `append` goes away. Is that the shape?

**Answer (verbatim):** "makes sense. Unless you see some issue with that"

**Interpretation:** Shape accepted unless there are issues. Issues raised next; not agreed yet.

**Question:** Remove `messages` and `append` from `inMemoryMessageSource` (reverses spec.md's "append keeps its behaviour", breaks the public API; the core and driver unit specs that use it move to `getInMemoryEventStore()` + `appendToStream`)? The source takes `read(after, signal)` returning an async iterable of event arrays, and `readLastCheckpoint()` for `from: 'END'` and the last checkpoint.

**Answer (verbatim):** "yes"

**Interpretation:** Agreed. Implement it.

**Correction found while checking usages:** driver consumer unit specs pass fixed lists with driver metadata (`messages`), they never call `append`, and they can't move to `getInMemoryEventStore()`. `whenCaughtUp()` uses `readLastMessageCheckpoint`, not the caught-up marker; the marker serves `stopWhen: { noMessagesLeft }`.

**Question:** Why does it need `read` and `readLastCheckpoint`? (explained: every `MessageSource` must answer the last position, for `whenCaughtUp()` and `'END'` starts)

**Answer (verbatim):** "Why does it need read and readlast checkpoint, that I don't get" / "That sounds like a weird api tbt"

**Interpretation:** The `read` + `readLastCheckpoint` shape is rejected as weird. The earlier "yes" no longer stands as an agreed design. Not agreed yet.

**Question:** Source owns the log, store reads it through a read-only `messages`?

**Answer (verbatim):** "Isn't that even weirder?"

**Question:** Follow the PostgreSQL/SQLite pattern (store gives the source a read function and a last-position function), woken on append instead of a timer?

**Answer (verbatim):** "Are you joking, we went the whole round to make this push based"

**Interpretation:** Push-based stays (already agreed in spec). Rejected. Not agreed yet.

**Question:** Store owns the array and calls `notifyAppended()`; the source reads that array without copying?

**Answer (verbatim):** "ok, but I think it's super weird, and I don't understand why in the same way we cant use the async iterable. Plus i don't think that'll work with Mongo and stop running in circles!"

**Interpretation:** Not agreed. Look at the push-based precedent (MongoDB) and use the async iterable.

## Note: status after rebase onto main (2026-11-26)

The branch is rebased onto `origin/main` (05d67de5, with #437 and #446). The one conflict was in the imports of `workflowProcessor.unit.spec.ts`, and both sides were kept. `build:ts`, lint, unit, int and e2e pass.

**Question:** What is the status and the consensus on `inMemoryMessageSource`?

**Answer (verbatim):** "ok, so what's the current status and consensus, we were circlicling about notifying and why can't we just pass asyncenumerable. And we wanted to have push based inmemorymessagesource"

**Status at that point:** Agreed: push-based with no timer, one array in memory, the store does not know about caught-up. Not agreed: how the store hands appended events to the source. The code still passes `allEvents` as `messages` and calls `globalLog.append(...)`, which pushes into that same array.

**Question:** Is `subscribe` (an open async iterable) plus `readLastMessageCheckpoint` still push-based? Every `MessageSource` needs `readLastMessageCheckpoint`: `processorStartPositions.ts` asks it once for processors that start from `'END'`, and `whenCaughtUp()` uses it. MongoDB passes it too, next to its `subscribe`.

**Answer (verbatim):** "I don't want any blame game, read + readLastCheckpoint would be back to pull based, maybe thats fine, but I don't think that's solving the use case Wouldn't it?"

**Interpretation:** A `read` that returns and ends is pull. A `subscribe` that stays open and gets events when they are appended is push. `readLastMessageCheckpoint` is a single question, not a loop. Not decided by this answer.

## Q: `inMemoryMessageSource` in tests, and where the store keeps its events

**Question:** "also the inmemoryMessageSource is used also in tests, right? So if we go your suggested way then we'd need some syntactic sugar on top to pass an away, or am I'm wrong? Where would the messages be stored then for in memory event store?"

**Finding:** Yes. `inMemoryMessageSource` is public (exported from `consumers/index.ts` on main). Seven test files build it from a fixed list with `{ messages }`: the PostgreSQL, SQLite, MongoDB and EventStoreDB consumer unit specs (they need driver metadata, so they can't use `getInMemoryEventStore()`), the standalone in-memory consumer spec, `inMemoryProcessors.unit.spec.ts` and its own spec. Only the store and its own spec call `append`. A `subscribe`-based `inMemoryMessageSource` would need a helper in each of those tests.

**Proposal:** Split the two uses, as MongoDB has its own source next to its store. `inMemoryMessageSource({ messages })` stays the test helper. The store builds its own push-based source on `subscriptionMessageSource`. The store's one array, `allEvents`, stays the only storage.

**Answer (verbatim):** "that makes sense, but why not both?"

**Follow-up:** I proposed an internal core shared by both, with a `waitForMore` that `appendToStream` resolves.

**Answer (verbatim):** "getInMemoryEventStore calls the core with allEvents, its one array, and its own waitForMore, which appendToStream resolves after it stores the events. - wot?! I didn't mean to add 3rd option, but more use both inmemorymessagesource and pushbasedsubscription together, thoughts?"

**Interpretation:** No new abstraction (no shared core, no `waitForMore`). Use both existing pieces together:

- `inMemoryMessageSource({ messages })` stays the test helper, built on `subscriptionMessageSource`. Its API and the tests that use it do not change.
- The store uses `subscriptionMessageSource` with `boundedMessageQueue`, both already on main, and does not use `inMemoryMessageSource`. `allEvents` is the one array, and `readStream` filters it. `subscribe({ from, signal })` creates a queue for that reader, yields the events in `allEvents` after `from`, then `MessageSourceCaughtUp`, then iterates the queue. `appendToStream` pushes the stored events into the array, then into each open reader's queue. `readLastMessageCheckpoint` takes the last event in `allEvents`. A queue holds references to events the reader has not handled yet, not copies.

**Status:** Proposed. Waiting for Oskar to confirm.

**Open points:**

1. Caught-up after live events. The queue yields single events, so `subscribe` must send `MessageSourceCaughtUp` when the queue is drained. Proposal: `appendToStream` pushes the batch, and `subscribe` sends caught-up after the last event of each batch. `appendToStream` does not know about caught-up.
2. Backpressure. `push` waits when a queue is full (capacity 100 by default). If `appendToStream` awaits it, a slow reactor slows appends; if not, the queue grows. Proposal: await it, as MongoDB's change stream gets backpressure through the same queue.

## Note: recording the discussion

**Answer (verbatim):** "and yes, you should be storing our discussing"

**Interpretation:** Every question, verbatim answer and finding goes into this file as the discussion happens, not afterwards.

**Answer (verbatim):** "Dude, i asked you a question" / "Dude, I asked you thoughts on how could it work, you gave me nothing precise here, I'm discussing what could we do, stop bs me"

**Proposal (precise shape, under discussion):**

- `inMemoryMessageSource` stays as on the branch. Tests keep `{ messages }`; its own spec keeps `append`.
- The store keeps `allEvents` and a `Set` of reader queues, `boundedMessageQueue<InMemoryReadEvent[]>`, one per open `subscribe`.
- The store's source is `subscriptionMessageSource`. Its `subscribe` adds a queue to the set and takes a snapshot of `allEvents` after `from` in the same synchronous step (no `await` between them), yields the snapshot, then `MessageSourceCaughtUp`, then for each batch from the queue yields its events and then `MessageSourceCaughtUp` of the batch's last checkpoint. `finally` removes the queue from the set.
- `appendToStream` pushes the stored events into `allEvents`, then `void reader.push(storedEvents)` for each queue. Not awaited: a reactor appending to the same store from its handler would wait on its own full queue, which drains only after the handler returns.
- `readLastMessageCheckpoint` returns the checkpoint of the last event in `allEvents`.

**Question (verbatim):** "I mean if that works okay, but does MessageSourceCaughtUp is use in other places? Also would it be useful to unify this subscribe code somewhere? Sounds like a bit off the line to keep it inside in memory message store"

**Finding:** Every source sends `MessageSourceCaughtUp`: `pollingMessageSource.ts:109` (PostgreSQL, SQLite), `mongoDBMessageSource.ts:86`, `eventStoreDBMessageSource.ts:97`, PostgreSQL `caughtUpTransformStream.ts` and the branch's `inMemoryMessageSource.ts:78`. Only `splitControlMessages` in `consumers.ts:191` reads it, so processors never see it, and `consumers.ts:507` uses it to stop the consumer for `until: { noMessagesLeft: true }` or `{ caughtUp: true }`. `whenCaughtUp()` uses `readLastMessageCheckpoint`, not the marker.

**Proposal:** The queue, snapshot and caught-up logic is source logic, not storage logic, and the test helper needs the same logic for `append`. Put it in one piece in `consumers/messageSources/`, built on `subscriptionMessageSource` (name to be chosen, `pushMessageSource` for now): it takes `readAfter(after)` (history, read once when a reader subscribes, not polled) and `readLastMessageCheckpoint()`, and returns a `MessageSource` with `push(messages)`. The store passes functions that read `allEvents` and calls `globalLog.push(storedEvents)` after it stores them. `inMemoryMessageSource({ messages })` keeps its API and is built on the same piece; its `append` pushes into its own array and calls `push`. MongoDB and EventStoreDB would not use it, as their clients deliver history and live events in one subscription.

**Status:** Proposed. Waiting for Oskar.

**Answer (verbatim):** "sounds fine to me, why not?"

**Interpretation:** Not a decision. The shared source was then rejected as a separate `pushMessageSource` (next answer).

**Costs found:**

1. A new abstraction. AGENTS.md asks for none unless requested; Oskar asked for the unification, so it is requested. Keep it internal (not exported from `consumers/index.ts`) until someone outside the core needs it.
2. No backpressure. `push` is not awaited (a reactor appending to the same store would wait on its own full queue), so a stalled reader's queue grows. In memory it holds references to the stored batches, not copies.
3. `readAfter` filters the whole array each time a reader subscribes or resubscribes. That is once per subscription, not per append.
4. spec.md and plan.md describe the store calling `globalLog.append(...)` on `inMemoryMessageSource`. They need a short update so they don't describe the old shape.

**Answer (verbatim):** "Dude, wtf does it mean to be \"pushmessagesource\" are you joking? Why wouldn't it be part of in memory?!"

**Interpretation:** No separate `pushMessageSource`. The queue-based delivery goes inside `inMemoryMessageSource.ts`, and the store uses `inMemoryMessageSource`.

**Answer (verbatim):** "Could you stop circling totally?"

**Proposal (not agreed):** `inMemoryMessageSource` keeps its API (`{ messages, batchSize }`, `append`). Inside, each reader gets a `boundedMessageQueue` of batches: it reads the past after `from`, sends caught-up, then yields each appended batch followed by caught-up. `append` pushes into the array and hands the batch to every reader's queue without awaiting. No rescans, no timer. The store stays as it is. Tests: event appended during the past read arrives once, caught-up after each batch, abort removes the reader, and a reactor appending to the same store with more than 100 events finishes.

**Answer (verbatim):** "and stop bs me with ideas we rejected" / "Where's decision, no decision has been made"

**Status:** No decision. The last proposal kept the store passing `allEvents` and calling `append`, which was rejected earlier ("If the array is passed and it's the same array, then why do you call append? This is weird api"). Open: how the store hands appended events to `inMemoryMessageSource` without that shape.

**Answer (verbatim):** "Dude, reread what I asked you and stop be syncopath and stop repeating yourself"

**Reread:** Oskar asked for: an async enumerable that wakes on append ("DThat's why I said and suggested async enumerable as it'd be waken on the append."); to the `notifyAppended()` shape: "I don't understand why in the same way we cant use the async iterable"; "use both inmemorymessagesource and pushbasedsubscription together"; the subscribe code not inside the store, but part of `inMemoryMessageSource`.

**Proposal (not agreed):** The store owns `allEvents` and an async iterable of appended batches (a `boundedMessageQueue` it pushes to after storing). It passes both to `inMemoryMessageSource({ messages: allEvents, appended })`. The source only reads the array and is woken by `appended`; it never writes to the array, and there is no `append` or notify call. Tests pass only `messages`.

**Answer (verbatim):** "Dude, this was already rejected. Stop bs me." / "Why can't in memory message source to take either array or enumerable with this read last message position?"

**Finding:** It can. `messages` takes an array (tests) or an async iterable of batches (store), next to `readLastMessageCheckpoint`. Conditions: the iterable must start again on each `[Symbol.asyncIterator]()` call, so every reader and every resubscribe gets all events from the beginning without the source keeping a copy; it yields batches, so the source sends caught-up after each batch and the store stays unaware of it. `append` is no longer needed.

**Status:** Proposed. Waiting for Oskar.

**Answer (verbatim):** "Dude, this should be union"

**Interpretation:** The options are a union type, so the compiler requires `readLastMessageCheckpoint` with an async iterable and rejects it with an array, instead of an optional field explained in a comment.

**Answer (verbatim):** "Dude, wtf. We have an async iterator not needing to read it again and again. WTF"

**Interpretation:** One async iterator, read once. The store's `consumer()` creates the source and its iterator for that consumer (today all consumers share one `globalLog`). The iterator yields the stored events, then each append. The source skips what is at or before `from` and keeps reading the same iterator; a resubscribe continues it instead of starting over. Nothing is read twice and nothing is copied.

**Open check:** stopping a consumer ends its read; if the read loop closes the iterator (`return()`), a `start()` after `stop()` on the same consumer can't continue it. Check whether in-memory consumers must support restart.

**Answer (verbatim):** "stop bs me and give straightforward explanations" / "So how the coude would look like?! What are you precisely suggesting?!"

**Proposal (code shape, not agreed):** Options are the union from above, and the async-iterable side also takes an optional `close`, which is passed to `subscriptionMessageSource`. Array side: each read yields the array after `from`, then caught-up, then waits for abort. Iterable side: the source takes the iterator once and calls `next()` itself (no `for await`, so stopping does not close it), keeps a pending `next()` across reads, skips events at or before the last delivered checkpoint, and sends caught-up after each batch. The store keeps `allEvents` and a set of per-consumer `boundedMessageQueue`s; `appendToStream` pushes into the array and into each queue. `consumer()` registers a queue and passes `async function* () { yield allEvents; yield* queue.iterate(closed.signal); }` with `readLastMessageCheckpoint` and a `close` that unregisters the queue. Events in both `allEvents` and the queue are dropped by the checkpoint filter, so the array is not copied. The consumer no longer wraps the source with a no-op `close`, because each consumer has its own source. `start()` after `stop()` continues the same iterator.

**Question:** How does it work with just a messages array?

**Answer given:** Each read yields the array after `from`, then caught-up, then waits for abort (ending would make `subscriptionMessageSource` resubscribe and deliver again). Two reads each get the whole array. `append` goes; only `inMemoryMessageSource.unit.spec.ts` used it, and those cases move to the async iterable option.

**Answer (verbatim):** "ok, then do it"

**Decision:** Implement the shape above: union options (array, or async iterable with `readLastMessageCheckpoint` and optional `close`), no `append`, per-consumer iterator from the store, no no-op `close` wrapper in the in-memory consumer.

**Question:** With `append` gone, how do the source's tests add messages after a read has started?

**Answer given:** A test helper that builds a live iterable.

**Answer (verbatim):** "where does this live message leave? Also what does it even check?" / "what is this test checking? it just checks if livemessages work"

**Finding:** The helper only tested itself: it copied the store's wiring into the test, so a broken store would still pass. The source's spec tests the iterable option with fixed batches (`async function* (...values) { yield* values; }`): caught-up after each batch, skipping at or before `from`, `'END'` from `readLastMessageCheckpoint`, the read ending with the batches, and the next read continuing the same batches. Where a read must wait for a batch (abort listeners, no timers, a batch that arrives after a waiting read stopped), the spec uses `boundedMessageQueue`, the queue the store uses. Live appends are tested through the store in `inMemoryEventStoreConsumer.unit.spec.ts`: events appended between `consumer()` and `start()` arrive once, a restarted consumer continues, a reactor appending 150 times to the same store does not block, and closing one consumer keeps delivering to the others.

**Answer (verbatim):** "ok, implement it"

**Finding (implementation):** The earlier answer said that an array read must wait for abort because ending would make `subscriptionMessageSource` resubscribe. That is wrong for the default resilience: without `shouldRetryResult`, an ended `subscribe` ends the read. The array read still waits for abort, so it behaves as before and a consumer does not stop when the array is read.

**Finding (implementation):** Removing the no-op `close` wrapper in `inMemoryEventStoreConsumer` fails "does NOT close the injected source when consumer is closed" in `inMemoryEventStoreConsumer.standalone.unit.spec.ts`. That test guards spec 11.3 ("GIVEN an injected source WHEN the consumer is closed THEN the source is not closed"), which matches the SQLite consumer. The decision above removes the wrapper but did not say that it reverses 11.3. Keeping 11.3 means the store's `consumer()` must close its own per-consumer source in another way. The generic `consumer()` has `hooks.onClose`, but `inMemoryEventStoreConsumer` does not take hooks, so that is a new option.

**Finding (implementation):** Calling `whenProcessed` straight after the `start()` of a restarted consumer rejects with "Processor … was closed before reaching checkpoint …", because the processor is still in its closed state from `stop()`. After `whenStarted()` it works. This is consumer behaviour, not part of this change.

**Status:** 11.3 waiting for Oskar.

**Question:** Removing the no-op `close` wrapper reverses spec 11.3. Keep 11.3 or reverse it?

**Answer (verbatim):** "I don't know why this was written. Could you check? also it seems to me that it'd be better to not close it as it's externally created and should be managed externally"

**Finding:** 11.3 comes from SQLite. Commit dd68ab37 ("Plugged fully consumer into the base event store type", 2026-07-29) made `sqliteEventStoreConsumer` wrap an injected `source` with a no-op `close`, so it closes only the source it creates itself, and added "does NOT close the injected source when consumer is closed". The in-memory test is the copy of that SQLite test (Q11: copy every SQLite consumer scenario not tied to SQL).

**Decision:** Keep 11.3. `inMemoryEventStoreConsumer` does not close an injected source; whoever creates it closes it. The no-op `close` wrapper stays.

**Open point:** The store's `consumer()` creates a source per consumer and must close it when that consumer closes, or the closed consumer's queue keeps receiving every append.

**Proposal (not agreed):** `inMemoryEventStoreConsumer` takes `hooks` and the store's `consumer()` passes `hooks: { onClose: source.close }`.

**Answer (verbatim):** "I think that's bs, why would you add this just for tests?" / "Do we even need to close it?"

**Finding:** The close is not for tests; its only job is to remove the closed consumer's queue from the store's set. Without it, a closed consumer's queue stays in the store and every later append adds one batch to it, so memory grows with closed consumers times appends. It is freed with the store, because only the store holds the set. In-memory stores live for a test or a sample, and their consumers are created once, so the growth stays small. Without a close, the store's source needs no `close` and no `AbortController`, and the iterable option's `close` has no user.

**Status:** Waiting for Oskar.

**Answer (verbatim):** "It shouldn't grow, so if consumer is detached then it shouldn't acumulate, also if we have consumer, then it shouldn't grow. messages should be freed once consumer, right?"

**Finding:** With a running consumer, nothing grows: the queue removes each batch when the consumer reads it, and the events stay only in `allEvents`, which is the store's data. With the implemented shape, a stopped consumer's queue grows until `start()` drains it, and a closed consumer's queue grows forever. The cause is that the queue is registered once per consumer, for its whole life, so that `start()` after `stop()` can continue the same iterator.

**Proposal (not agreed, reverses "one iterator per consumer, resumed across stop/start"):** The iterable option becomes `messages: ({ signal }) => AsyncIterable<batch[]>`, called once per read. The store registers a queue when the read starts and removes it in `finally` when the read ends; `queue.iterate(signal)` returns on abort, so the `finally` runs on `stop()`. No queue exists while no read runs, so nothing accumulates for a stopped or closed consumer. The source loses `pending`, the abort race and `close`; the store loses `close` and its `AbortController`. Cost: each `start()` and each resubscribe filters `allEvents` from the checkpoint again (a scan, no copy).

**Status:** Waiting for Oskar.

**Answer (verbatim):** "But I don't understand inmemorymessagesource is internal to in memory consumer, it's not provided externally, for that case it should be closed. Only if it's passed externally it shouldn't be closed, right?!"

**Interpretation:** Yes. Same rule as SQLite: the consumer closes a source it owns and never closes an injected one. The store's `consumer()` creates its source, so that consumer owns it and closes it. Only a source passed to the standalone `inMemoryEventStoreConsumer` stays open.

**Finding:** Today the store goes through the standalone factory, so its own source is treated as injected and wrapped with the no-op `close`. The factory cannot tell the two apart.

**Proposal (not agreed):** Split the factory in `inMemoryEventStoreConsumer.ts`. The shared body takes the source as-is and closes it with the consumer. The public `inMemoryEventStoreConsumer` calls it with the injected source wrapped in the no-op `close`. The store's `consumer()` calls the shared body with its own source. The shared body is not exported from `consumers/index.ts`.

**Open point:** With close fixed, a closed consumer's queue is removed. A stopped consumer's queue still collects appends until `start()` reads them.

**Status:** Waiting for Oskar.

**Answer (verbatim):** "I don't understand the proposal."

**Clarification given:** One function, `inMemoryEventStoreConsumer`, serves two callers: the store's `consumer()` with a source it created, and a user with an injected source. It replaces `close` of every source with a no-op, so both stay open. The proposal gives each caller its own function: the store's one closes the source, the public one keeps the no-op.

**Status:** Waiting for Oskar.

**Answer (verbatim):** "Are you fng kidding me? Then just add close param optional as you said." / "(hook)"

**Decision:** `InMemoryEventStoreConsumerOptions` takes an optional `hooks?: ConsumerHooks`, passed to the generic `consumer()`. The store's `consumer()` passes `hooks: { onClose: () => Promise.resolve(source.close()) }`, so closing a store consumer removes its queue from the store. An injected source still is not closed (11.3). Test: "calls the onClose hook when the consumer is closed" in `inMemoryEventStoreConsumer.standalone.unit.spec.ts`.

**Open point:** A stopped (not closed) consumer's queue still collects appends until `start()` reads them. Registering the queue per read would stop that, but reverses "one iterator per consumer, resumed across stop/start". Not decided.

**Answer (verbatim):** "Why is it open?!"

**Finding:** It should not be open. A stopped consumer is not detached: it still has to read every event appended while it was stopped, and `start()` reads them from its queue, because its iterator already yielded `allEvents`. The queue holds only references to the events in `allEvents`, one array per append, and frees each batch when `start()` reads it. That is the same backlog a slow running consumer has, not a leak. The only leak was a closed consumer's queue, and the `onClose` hook removes it.
