# Progress

## Step 1. Push-based `inMemoryMessageSource`

Done. `inMemoryMessageSource` is now built on `subscriptionMessageSource`. Its `subscribe` resolves the start from `'BEGINNING'`, `'END'` or a checkpoint, then scans the array and yields messages after that start, then `MessageSourceCaughtUp`. It waits on a promise that `append(...)` or the read's abort resolves, so no timer runs. It rescans without waiting when messages were appended while the reader was paused at a `yield`. `pullingFrequencyInMs` is removed, and `batchSize` is passed through. `readLastMessageCheckpoint()` now returns a promise.

The spec keeps the existing scenarios and adds 12.1–12.7 plus the three extras. A reader helper parks the reader in its wait before `append`, so the wake path is tested.

Reviews: `reviews/20261119T161645_step1_review.md` (2 Step findings, fixed) and `reviews/20261119T161930_step1_review.md` (second review). Step-3 (no test guards the cleanup of the abort listener and the waiting-reader set) is resolved: the waiting-reader set is gone, and "keeps the same abort listeners on a reader across many batches" in `inMemoryMessageSource.unit.spec.ts` guards the abort listener.

## Step 2. In-memory store consumer and standalone consumer

Done. `getInMemoryEventStore` creates one `inMemoryMessageSource` (the global log) and appends the stored, downcast events to it right after storing them in their stream. `appendToStream` returns `lastEventGlobalPosition`, computed from the event count taken once per append. `InMemoryEventStore` is now an interface with typed `appendToStream` and `consumer(options?)`. The new `src/packages/emmett/src/eventStore/consumers/inMemoryEventStoreConsumer.ts` holds the config, factory types, `InMemoryEventStoreConsumer` and `inMemoryEventStoreConsumer({ source, messageStore, ...config })`, built on the generic `consumer(...)`. It wraps the source so it is never closed, passes `session: { messageStore }` through its scope, maps `stopWhen` and `pulling`, and applies the message-store rule once at creation. `inMemoryWorkflowProcessor` lives in `processors/inMemoryProcessors.ts` and uses the private `inMemoryProcessingScope` and `inMemoryCheckpointer`.

Deviation to confirm: in-memory reactors and projectors used to ignore `checkpoints: 'DISABLED'`. With the store's shared database, the copied SQLite DISABLED scenarios (2.12) failed, so `inMemoryCheckpointer` takes an optional `database`, and DISABLED now uses a fresh private database for the reactor, the projector and the workflow processor.

Tests: six `*.unit.spec.ts` files in `eventStore/consumers/` (base and extra criteria, handling copies, awaiters, in-memory projections, workflow, standalone), plus `testConsumerSchemaVersion` in `emmett-tests`' in-memory spec. Deleted the contract test "accepts a store that does not expose a consumer at all". `inMemoryProjectionSpec.ts` casts its hand-built store through `unknown`.

Reviews: `reviews/20261119T163542_step2_review.md` (first review, all findings fixed or resolved as described there) and `reviews/20261119T164226_step2_review.md` (second review). Step-7 (the copied handling and awaiter scenarios kept SQLite's partial matchers) is fixed: neither spec uses `containsOnlyElementsMatching` or `containsElementsMatching` any more.

## Step 3. Required `consumer` on `EventStore`

Done. `consumer` is now a required member of the base `EventStore` interface. The signature and doc comment are unchanged. `consumeStream` in `emmett-tests` `features.ts` calls `eventStore.consumer<MessageType>()` directly, without `assertOk`. The contract spec has two new tests. "requires every store to expose a consumer" checks with `expectTypeOf` that `consumer` is a required function, and it has a `// @ts-expect-error` on assigning an `Omit<EventStore, 'consumer'>` to `EventStore`. "calls consumer on any event store without optional chaining" assigns `getInMemoryEventStore()` to `EventStore` and calls `consumer()`. Step 2's hand-built stores in the standalone spec needed no change, because they spread `getInMemoryEventStore()` and so already carry `consumer`.

Review: `reviews/20261119T165135_step3_review.md`, clean on the first pass.

## Step 4. Durable Objects sample keeps compiling

Done. `clientsEventStore` in `samples/cloudflare/durable-objects/src/shoppingCarts/api.int.spec.ts` now has a `consumer` member that throws `EmmettError('consumer is not implemented for this event store')`. `EmmettError` joins the existing `EventStore` import. The sample stays on its pinned Emmett `0.43.0-beta.50`, where `consumer` is optional, so the member type-checks there and will satisfy the required member later. No test of its own (Q21).

Checks, run in the sample after `npm ci` (`node_modules` is gitignored): `npm run build:ts` and `npm run agent:check` pass with no reformatting, and `npm run test:int` passes 38/38. That run prints 17 "uncaught exception ... Expected version 2 does not match current 3" lines. The same 17 lines appear with the file reverted to HEAD, so they come from the existing concurrency-conflict tests and not from this step.

Review: `reviews/20261119T165607_step4_review.md`, clean on the first pass.

## Step 5. Observability and reactor errors on the in-memory consumer

Done. The store's `consumer()` now passes `observability: mergeObservability(eventStoreOptions?.observability, consumerOptions?.observability)`, as the SQLite store does, so a consumer without its own observability uses the store's, and the consumer's own wins key by key.

Tests: a new "observability" describe in `inMemoryEventStoreConsumer.handling.unit.spec.ts` copies SQLite's three scenarios (lifecycle logs and spans, logging through the store's observability, no observability logs nothing) and adds the extra "a consumer's own observability wins over the store's". In the 6.2 copy, the event is appended through the store created with `observability`, inside `given`, because in-memory stores do not share a log; the assertions are SQLite's. The new `emmett-tests/src/errorHandling/inMemoryReactorErrors.unit.spec.ts` runs `testReactorRecordsFailureAsEvent` and `testReactorSkipsAndStops` with `eventStore.consumer()`; it needs no cast and no teardown.

Review: `reviews/20261119T170114_step5_review.md`, clean on the first pass.

## Step 6. Async projections and the message store in handlers

Done. `InMemoryEventStoreOptions.projections` now accepts `ProjectionRegistration<ProjectionHandlingType, ...>`, so async registrations compile. `appendToStream` still runs only the inline ones. The store's `consumer(options?)` takes `includeAsyncProjections?: boolean`, in the interface and the implementation, and when it is true adds each async projection through `consumer.projector({ projection })`, with the same cast and TODO as SQLite's store. The message store rule from Step 2 gives these projectors the store's database.

Tests: `eventStore/consumers/inMemoryEventStoreConsumer.asyncProjections.unit.spec.ts` covers 9.1-9.5a and the extra checkpoint test (checkpoint id is `getProjectorId({ projectionName })`, `_version: 1n` because the projector handles the batch once). `eventStore/consumers/inMemoryEventStoreConsumer.messageStore.unit.spec.ts` covers 9.6-9.8; they passed before the code change, as the plan expects ("protects existing behaviour after Step 2"). Step 13 removed the handlers' `context.session.messageStore as EventStore` casts.

Review: `reviews/20261119T170736_step6_review.md`. Step-1 (no test checks that inline projections stay out of the consumer) is fixed. Standards-1 (the copied TODO comment on the projection cast) is kept by Oskar's decision: removing the cast needs the store to be generic over its projections' event types in all drivers, and the comment matches SQLite and PostgreSQL.

## Step 7. In-memory consumer docs and runnable snippets

Done. The new `src/docs/snippets/vitest.config.ts` adds the "docs (snippets)" Vitest project, built on `containersShared` like the package configs, and `src/vitest.config.ts` lists it. The suffix scripts now collect every snippet spec: `.unit.spec` (businessLogic, inMemoryConsumer), `.int.spec` (postgreSQLConsumer, apiBDD, simpleApi) and `.e2e.spec` (apiBDD.e2e). All existing snippet specs passed as soon as they ran, so no snippet needed a fix.

The new `docs/snippets/eventStores/consumers/inMemoryConsumer.unit.spec.ts` copies the PostgreSQL consumer snippet with an `inMemorySingleStreamProjection`, reads the document from `eventStore.database` and asserts every field (`_id`, `_version: 2n`, `status`, `productItemsCount`). It has the regions `in-memory-consumer` and `in-memory-consumer-close`. The close region has no `eventStore.close()`, because the in-memory store has no `close`. The comparison matrix now says "Inline + Async" for In-Memory. The guide's In-Memory section has a new "Async Consumers" subsection with the consumer region. The API reference's "In-Memory (Testing)" section has both regions.

Review: `reviews/20261119T191552_step7_review.md`, clean on the first pass.

## Step 8. SQLite consumers pass their message store

Done. `sqliteEventStoreConsumer` builds one `messageStore` when it is created, with `getSQLiteEventStore({ driver, pool, schema: { ...processorMetadataSchema, autoMigration: 'None' } })`, and passes it in the session of its scope next to `pool` and `connectionOptions`. Building it runs no query, and nothing is added per batch. SQLite's own processors still build theirs in their processing scope, and theirs replaces the consumer's.

Tests: 16.1 as "in-memory reactor appends through the session's message store" in the sqlite3, D1 and Durable Objects `sqliteEventStoreConsumer.inMemory.projections.int.spec.ts`. An `inMemoryReactor` with `stopAfter` appends a `ProductItemAdded` to a new `order-` stream through `context.session.messageStore` (cast to `EventStore` until Step 13). The test reads that stream back and asserts every field, with `correlationId` and `causationId` taken from the handled event. Before the change, nothing was appended.

Reviews: `reviews/20261119T192532_step8_review.md` (Standards-1, too few asserted fields, fixed) and `reviews/20261119T192846_step8_review.md` (second review, clean).

## Step 9. PostgreSQL consumer passes its message store

Done. `postgreSQLEventStoreConsumer` builds one `messageStore` when it is created, with `getPostgreSQLEventStore({ driver: options.driver ?? pgEventStoreDriver, pool, schema: { ...processorMetadataSchema, autoMigration: 'None' } })`, and puts it in the `session` of `processorContext` next to `pool` and `connectionOptions`. Building it runs no query, and nothing is added per batch. PostgreSQL's own processors still build theirs in their processing scope.

Tests: 17.1 as "in-memory reactor appends through the session's message store" in `postgreSQLEventStoreConsumer.inMemory.projections.int.spec.ts`. The extra test is "appends through the session's message store into the consumer's event schema" in `postgreSQLEventStoreConsumer.schema.int.spec.ts`. It uses a fresh `databaseSchemaName` for both the store and the consumer, and reads the appended event back through that store. Both follow the Step 8 shape and assert every field. Two fields differ from SQLite. PostgreSQL reads `globalPosition` back as the padded `transactionId:position` checkpoint, so the tests check `globalPosition > handled.globalPosition` and `checkpoint === globalPosition` instead of exact values. 17.1 runs on the shared `public` schema, so its handler ignores other streams. Without that guard it appended once for every event left by other tests. Before the change, both tests failed because nothing was appended. Building the store without `...processorMetadataSchema` makes the schema test fail.

Reviews: `reviews/20261119T193806_step9_review.md` (Standards-1, `checkpoint` not asserted, fixed) and `reviews/20261119T194039_step9_review.md` (second review, clean).

## Step 10. MongoDB consumer and processors always have the message store

Done. `MongoDBProcessorHandlerContext` now declares `session.messageStore: MongoDBEventStore` as required. `mongoDBEventStoreConsumer` builds one `messageStore` with `getMongoDBEventStore({ client })` when it is created and passes it in its scope next to `client`. `mongoDBProcessingScope` (MongoDB reactors and projectors) builds its own `messageStore` from the processor's client once, when the processor is created, so `session.client` and `session.messageStore` come from the same client. Building the store runs no query. The workflow scope still builds its store on every call and storage options are untouched; Step 12 changes both.

Tests: 18.1 as "in-memory reactor appends through the session's message store" in `mongoDBEventStoreConsumer.inMemory.projections.int.spec.ts`. 18.2 as "MongoDB reactor appends through the session's message store" and the extra "MongoDB reactor created with its own client gets the session client and message store from that client" in a new "message store" describe in `mongoDBEventStoreConsumer.handling.int.spec.ts`. The extra test gives the reactor a client on a second `sharedMongoDBDatabase()`, checks `session.client` is that client, that the event is in that database, and that the consumer's store has none. 18.3 is an `expectTypeOf(...).toEqualTypeOf<MongoDBEventStore>()` in `mongoDBEventStoreConsumer.unit.spec.ts`. The tests assert `type, kind, schemaVersion, data, streamName, streamPosition, correlationId, causationId`; MongoDB events have no `globalPosition` or `checkpoint`. Before the change, the three runtime tests failed because nothing was appended, and `build:ts` failed on the type test.

Review: `reviews/20261119T195150_step10_review.md`, clean on the first pass.

## Step 11. EventStoreDB consumer passes its message store

Done. `EventStoreDBProcessorHandlerContext` now declares `session.messageStore: EventStoreDBEventStore` as required. `eventStoreDBEventStoreConsumer` builds one `messageStore` with `getEventStoreDBEventStore(client)` when it is created and passes it in a new scope, `{ session: { client, messageStore } }`. Building it runs no query, and nothing is added per batch. EventStoreDB's own processors still set their client and store in `eventStoreDBProcessingScope`, which replaces the consumer's; that scope still builds its store on every call, as before.

Tests: 19.1 as "in-memory reactor appends through the session's message store" and the extra "in-memory projector created through the consumer sees the session client" in `eventStoreDBEventStoreConsumer.inMemory.projections.int.spec.ts`. 19.1 follows the PostgreSQL shape (guard on `streamName`, `stopAfter` on `lastEventGlobalPosition`, every field asserted, `globalPosition > handled` and `checkpoint === globalPosition`); EventStoreDB stream revisions start at `0n`. The extra test registers a projection with `consumer.projector(...)` on a consumer given a client and checks `context.session.client` is that client. 19.2 is an `expectTypeOf(...).toEqualTypeOf<EventStoreDBEventStore>()` in `eventStoreDBEventStoreConsumer.unit.spec.ts`. Before the change, both runtime tests failed (nothing appended, `session.client` undefined) and `build:ts` failed on the type test.

Review: `reviews/20261119T195758_step11_review.md`, clean on the first pass.

## Step 12. MongoDB custom `databaseName`

Done. `mongoDBEventStoreConsumer` takes an optional `storage`, and the store's `consumer()` passes its own. The consumer builds its `messageStore` from the client plus `storage`, and passes `storage.databaseName` to `mongoDBMessageSource` as `dbName`. Its reactor, projector and workflow factories fill `storage` with the consumer's when the caller gave none. Processors passed in already built keep their own. MongoDB processor options get optional `storage` through `MongoDBConnectionOptions`. Both processing scopes build their `messageStore` from client plus `storage` once, at creation (the workflow scope no longer builds one per call), and put `storage` in the handler context. `MongoDBProcessorHandlerContext` has a new optional top-level `storage`. `mongoDBCheckpointer()` still takes no arguments and reads and stores checkpoints in `context.storage`'s database, as PostgreSQL's checkpointer reads `context.migrationOptions`.

Tests: new `consumers/mongoDBEventStoreConsumer.storage.int.spec.ts` covers 20.1-20.8. After the first review it also covers: a reactor resuming from its checkpoint in the custom database, and projector and workflow processor checkpoints landing in the custom database and not the default one. Each custom database comes from `sharedMongoDBDatabase()`, so the run drops it afterwards. Before the change, all 8 original tests timed out. I broke each new piece on purpose and checked that the matching test fails. The plan's extra (default storage behaves as before) is covered by the existing MongoDB suites, which pass. The workflow output test asserts `type` and `data` but not `kind`, because the MongoDB store reads the workflow's commands back as `kind: 'Event'`. That is existing store behaviour, outside this step.

Reviews: `reviews/20261119T201230_step12_review.md` (first review; it came back `blocked` because two findings were tagged `plan`. spec.md decides both cases, so I fixed them as implementation findings, together with the checkpointer-signature and public-helper findings) and `reviews/20261119T202036_step12_review.md` (second review). Both findings are fixed: "caller-given projector storage wins" and "caller-given workflow processor storage wins" cover Step-1, and the workflow checkpoint test asserts the checkpoint value (Standards-1).

Follow-up on the second review: both open findings are fixed. "caller-given projector storage wins" and "caller-given workflow processor storage wins" cover `consumer.projector` and `consumer.workflowProcessor`, with the same shape as 20.7. The workflow checkpoint test now asserts the stored checkpoint value. That value is the checkpoint of the inbox input the workflow handled last, and a reactor on the same consumer records it. The test can't take it from `stopAfter`, because the workflow processor calls `stopAfter` on output messages that are not yet recorded and have no checkpoint. I broke each matching piece of code on purpose (the projector factory, the workflow factory, and the workflow scope's `storage` in the context), and each new test failed. No further review was run. Both findings are marked fixed in `reviews/20261119T202036_step12_review.md`.

## Step 13. In-memory processors require a message store

Done. `InMemoryProcessorHandlerContext` is now `MessageHandlerContext<{ database }, { messageStore: EventStore }>`, so `session.messageStore` is a required `EventStore`. `inMemoryProcessingScope` takes `PartialHandlerContext<InMemoryProcessorHandlerContext>`, as SQLite's scope does, and throws `EmmettError` ("InMemory processor '<id>' is missing message store ...") next to the missing-database throw when the session has no `messageStore`. The scope runs when the processor starts, so `start()` and `whenStarted()` reject.

Tests: new `processors/inMemoryProcessors.unit.spec.ts` with 21.1 (`expectTypeOf` on `session.messageStore`) and 21.2 (an in-memory reactor on the generic `consumer(...)` without a scope, with `until: { noMessagesLeft: true }`, so the test fails fast instead of hanging when `start()` resolves). 21.2 calls `whenStarted()` after `start()`, because `start()` resets the started awaiter. Before the change, 21.1 failed `build:ts` and 21.2 failed because `start()` resolved. Removed every `as EventStore` cast of `context.session.messageStore` from Steps 2, 6 and 8-12, plus the `EventStore` imports they left unused. No other test runs in-memory processors on the generic consumer without a scope. The EventStoreDB consumer is the only other caller, and it already passes one.

Review: `reviews/20261119T203731_step13_review.md`, clean on the first pass.

## Step 14. Source from an array or an async iterable

Done. `inMemoryMessageSource` options are a union: an array of messages, or an async iterable of batches with a required `readLastMessageCheckpoint` and an optional `close`. `append` is gone. The iterable is read through one iterator, which a resubscribe or a `start()` after `stop()` continues. The store keeps `allEvents` and a queue per consumer, and each `consumer()` gets its own source: the stored events, then each later append. `inMemoryEventStoreConsumer` takes `hooks`, and the store's `consumer()` closes its own source through `onClose`, which removes the queue. An injected source is still not closed (11.3).

Tests: the source spec uses fixed batches (`asyncIterable`) and `boundedMessageQueue` where a read must wait. `inMemoryEventStoreConsumer.unit.spec.ts` has "appends while consuming" (appended between `consumer()` and `start()` arrive once, a restarted consumer continues, a reactor appending 150 times does not block, closing one consumer keeps delivering to the others). The standalone spec has "calls the onClose hook when the consumer is closed". build:ts, lint, and the unit, int and e2e suites pass.
