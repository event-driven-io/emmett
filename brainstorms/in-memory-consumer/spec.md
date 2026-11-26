# In-memory event store consumer and required `consumer()`

Revision: 16

Source: [issue #427](https://github.com/event-driven-io/emmett/issues/427), Q&A in `qa.md`.

## Problem Statement

The PostgreSQL, SQLite, MongoDB and EventStoreDB event stores each have `consumer()`. It runs projectors, reactors and workflow processors in the background over the messages the store records. The in-memory event store has no `consumer()`. Because of that:

- Code that consumes appended events cannot run against the in-memory store, even though the in-memory store is the one people use for unit tests, learning and prototyping.
- Shared consumer scenarios cannot run on all stores. While adding the numeric message schema version, the scenarios "a consumer receives the message with its `schemaVersion`" and "a consumer upcaster sets `schemaVersion`" were left out for the in-memory store.
- `consumer` is optional on the base `EventStore` interface only because the in-memory store lacked it. Code that takes any `EventStore` has to write `eventStore.consumer?.()` and check the result, although every real store provides it.

`inMemoryMessageSource` already exists, but nothing connects it to the in-memory store. Messages get into it only by calling `append(...)` by hand. It also polls on a timer, although in memory the source can know about an append the moment it happens.

The goal: every built-in event store, the in-memory one included, provides `consumer()`, and the base `EventStore` interface requires it.

## Solution

### The in-memory store keeps a global log

The in-memory store gets one global log of all appended messages, ordered by global position. Each `appendToStream` call stores the events in their stream, as today, and also adds them to the end of the global log. Global positions only grow, so the log stays ordered without sorting.

The global log is an `inMemoryMessageSource` that the store creates once, when the store is created. Every consumer of that store reads from the same log. Each read keeps its own position, so consumers don't affect each other.

```
appendToStream('cart-1', [A, B])        appendToStream('cart-2', [C])
        │                                         │
        ▼                                         ▼
 streams: cart-1 → [A, B]               streams: cart-2 → [C]
        │                                         │
        └──────────────► global log: [A(1), B(2), C(3)] ◄── consumer 1 reads from its own position
                                                      ◄── consumer 2 reads from its own position
```

### Messages are pushed, not polled

`inMemoryMessageSource` changes from polling to push. A reader first gets every message after its start position, then a "caught up" signal, then waits. When `append(...)` adds messages, waiting readers wake up straight away, get the new messages, and get another "caught up" signal. No timer runs, and an idle consumer does no work. The `pullingFrequencyInMs` option goes away.

### Two ways to get an in-memory consumer

The store's own consumer reads from the store's global log:

```ts
const eventStore = getInMemoryEventStore();
const consumer = eventStore.consumer<ShoppingCartEvent>();

consumer.reactor({ processorId: 'notify', eachMessage: (message) => { ... } });

await consumer.start();
```

The standalone factory, `inMemoryEventStoreConsumer`, takes a `source` and a `messageStore`, both required. The `source` is where messages come from. The `messageStore` is the event store that workflow processors append their output to. This works like `sqliteEventStoreConsumer`, which takes a connection that serves both reading and workflow output. The standalone factory does not take an event store to read from, because `EventStore` has no "read all" operation and the store's global log is private.

### Processors

The in-memory consumer offers the same three kinds of processors as the other stores:

- `reactor(...)` and `projector(...)` use Emmett's existing in-memory processors, which keep their checkpoints in an `InMemoryDatabase`.
- `workflowProcessor(...)` runs workflows for real. Workflow output is appended to the consumer's message store, so with the store's own consumer the output goes back into the same in-memory store.

Every store keeps processor checkpoints in its own storage: PostgreSQL and SQLite in a table, MongoDB in a collection, EventStoreDB in a stream. For the in-memory store, that storage is its `InMemoryDatabase`, which inline projections already use. So when the consumer's message store is an in-memory store, the in-memory processors the consumer creates use that store's database for checkpoints and read models, unless a processor names its own database. The store's own consumer passes the store as its message store, so its processors use the store's database. A processor that is passed in already built, including one from another store package, keeps its own storage.

The handler context works the same way as on SQLite and PostgreSQL. The consumer passes `session.messageStore`, set to its message store, through its scope, as SQLite's consumer passes its session. Every processor on the consumer therefore sees `context.session.messageStore`. Reactors can append through it and keep the trace of the message they handle. Workflow processors append their output through it. Projectors see it too but don't need it. In-memory processors also get `context.database`. `inMemoryReactor` and `inMemoryProjector` get no new options. Async projections get no extra `context.eventStore`. Neither do SQLite and PostgreSQL projections.

### Append result

The in-memory `appendToStream` also returns `lastEventGlobalPosition`, as PostgreSQL and SQLite do, so a test can wait with `consumer.whenProcessed(result.lastEventGlobalPosition)`.

### Async projections

The in-memory store's `projections` option accepts async projection registrations as well as inline ones. `appendToStream` still runs only the inline ones. `consumer({ includeAsyncProjections: true })` adds the async ones to the consumer as projectors, as PostgreSQL and SQLite do.

### `consumer` becomes required

With the in-memory consumer in place, every built-in store has `consumer()`, so the base `EventStore` interface makes `consumer` a required member. Code that takes an `EventStore` can call `eventStore.consumer()` directly.

The only code without a consumer is the hand-written `clientsEventStore` adapter in the Cloudflare Durable Objects sample's integration test. It sends each call to one client's Durable Object store, so no single store exists that a consumer could read. Its `consumer()` throws a "not implemented" error. The test never calls it. Reworking that test is a follow-up.

## Acceptance criteria

### In-memory store consumer

1. A developer gets a consumer from the in-memory store, so they can run processors over what the store records.
   1.1. GIVEN an in-memory store WHEN `consumer()` is called THEN it returns a consumer that has not started and has `reactor`, `projector` and `workflowProcessor`.
   1.2. GIVEN an in-memory store WHEN `consumer()` is called THEN its static type is the typed in-memory consumer, not the generic `MessageConsumer`.
   1.3. GIVEN two started consumers from the same in-memory store WHEN the first is closed and then an event is appended THEN the second consumer's reactor receives that event.
   1.4. GIVEN a consumer from an in-memory store WHEN the consumer is closed THEN the store stays usable: appends and reads still work.

2. A developer's reactor receives what was appended, so side effects run.
   2.1. GIVEN events appended before the consumer starts AND a reactor that starts from the beginning WHEN the consumer starts and catches up THEN the reactor received all of them, in global position order.
   2.2. GIVEN a started, caught-up consumer WHEN events are appended THEN the reactor receives them without any polling wait.
   2.3. GIVEN events appended to several streams WHEN the reactor receives them THEN each message has its stream name, stream position, global position, checkpoint and message id, and they arrive in global position order across streams.
   2.4. GIVEN a reactor starting from `'END'` WHEN events were appended before start and more are appended after THEN the reactor receives only the later ones.
   2.5. GIVEN a reactor with a stored checkpoint WHEN the consumer starts again THEN the reactor continues after that checkpoint.
   2.6. GIVEN events appended with a downcaster that changes how they are stored WHEN a reactor without an upcaster receives them THEN it receives the stored form, the same form `readStream` returns without an upcaster.
   2.7. GIVEN an inline projection that throws during an append WHEN a started consumer catches up THEN its reactor receives the events of that append, the same events `readStream` returns for that stream.
   2.8. GIVEN `pulling: { batchSize: 2 }` AND five appended events WHEN a reactor with `eachBatch` processes them THEN no batch has more than two messages, and all five are processed.
   2.9. GIVEN `pulling: { batchSize: 10, batchDeadlineInMs: 20 }` AND three appended events WHEN the deadline passes THEN `eachBatch` receives the three events in one batch.
   2.10. GIVEN an in-memory store WHEN two events are appended to an empty store THEN the append result has `lastEventGlobalPosition` equal to the checkpoint of global position 2, and a consumer's `whenProcessed(lastEventGlobalPosition)` resolves once its processor has handled both.
   2.11. GIVEN a reactor on the store's consumer with checkpoints enabled WHEN it processes an event THEN its checkpoint is stored in the store's `database`.
   2.12. GIVEN the "eachMessage" and "consumer created by the event store" scenarios of SQLite's consumer handling suite, except "handles concurrent writes ... without SQLITE_BUSY errors" and the pool teardown part of "leaves the event store usable...", which are tied to SQLite WHEN they run on the in-memory consumer THEN they have the same outcomes.

3. A consumer receives the message schema version, so versioned events can be handled (from issue #427).
   3.1. GIVEN an appended event with `schemaVersion: 2` WHEN a consumer receives it THEN the message has `schemaVersion: 2`.
   3.2. GIVEN a consumer with an upcaster that returns `schemaVersion: 2` WHEN it receives a version `1` event THEN the message has `schemaVersion: 2`.

4. A test waits for the consumer to catch up, so it can assert without sleeping.
   4.1. GIVEN a started consumer WHEN all appended messages were processed THEN `whenCaughtUp()` resolves.
   4.2. GIVEN a caught-up consumer WHEN more events are appended and processed THEN a later `whenCaughtUp()` call resolves again.
   4.3. GIVEN a consumer and processor in the same situations as the SQLite awaiter scenarios WHEN the test waits THEN it gets the same outcomes as on SQLite.

5. A developer controls the consumer lifecycle, so it behaves like the other stores' consumers.
   5.1. GIVEN a consumer with no processors WHEN it starts THEN start fails, and `whenStarted()` rejects.
   5.2. GIVEN a consumer with processors WHEN it starts THEN `whenStarted()` resolves.
   5.3. GIVEN a consumer that never started WHEN it is stopped once or several times THEN nothing fails.
   5.4. GIVEN a started consumer WHEN it is stopped THEN the promise returned by `start()` resolves, and an event appended after the stop is not delivered to its reactor.
   5.5. GIVEN the starting and closing resilience scenarios that SQLite covers WHEN they run on the in-memory consumer THEN they have the same outcomes.
   5.6. GIVEN `stopWhen: { noMessagesLeft: true }` WHEN the consumer has processed everything in the log THEN it stops by itself.

6. Observability works on the in-memory consumer, so traces and metrics look like those of other stores.
   6.1. GIVEN the observability scenarios that SQLite's consumer handling suite covers WHEN they run on the in-memory consumer THEN they have the same outcomes.
   6.2. GIVEN an in-memory store created with an `observability` option AND a consumer created from it without one WHEN the consumer runs THEN it logs through the store's observability.

7. Reactor errors are handled the same way as on SQLite.
   7.1. GIVEN a reactor that records a failure as an event WHEN its handler fails THEN the failure event is appended to the in-memory store.
   7.2. GIVEN a reactor configured to skip and stop WHEN its handler fails THEN it skips or stops as on SQLite.

### Projections

8. A developer runs a projector on the in-memory consumer, so read models update in the background.
   8.1. GIVEN a projector registered with `consumer.projector(...)` WHEN events are appended and the consumer catches up THEN the read model in the store's database reflects them.
   8.2. GIVEN the scenarios of SQLite's in-memory projections suite WHEN they run on the in-memory consumer THEN they have the same outcomes.

9. A developer registers async projections on the in-memory store, so the store's consumer can run them.
   9.1. GIVEN an in-memory store with an async projection WHEN events are appended THEN `appendToStream` does not run that projection.
   9.2. GIVEN an in-memory store with an async projection WHEN `consumer({ includeAsyncProjections: true })` starts and catches up THEN the projection's read model reflects the appended events.
   9.3. GIVEN an in-memory store with an async projection WHEN `consumer()` is called without `includeAsyncProjections` THEN the projection is not added to it.
   9.4. GIVEN an in-memory store with both inline and async projections WHEN events are appended THEN the inline projection runs during the append, as today.
   9.5. GIVEN an async projection whose handler reads `context.database` WHEN the store's consumer runs it THEN `context.database` is the store's database.
   9.5a. GIVEN a projection registered as async on the in-memory store whose handler reads `context.eventStore` WHEN the store's consumer runs it THEN `context.eventStore` is undefined.
   9.6. GIVEN a reactor created through the store's `consumer.reactor(...)` whose handler appends an event to a new stream through `context.session.messageStore` WHEN it handles a message THEN that event can be read from the store.
   9.7. GIVEN a reactor on the store's consumer that appends an event through `context.session.messageStore` WHEN it handles a message THEN the appended event is in the store with a new `messageId`, the handled message's `correlationId`, and the handled message's `messageId` as its `causationId`, as the core processor observability test asserts.
   9.8. GIVEN an in-memory reactor built with `inMemoryReactor(...)` and passed to the store's `consumer.reactor(reactor)` whose handler appends an event to a new stream through `context.session.messageStore` WHEN it handles a message THEN that event can be read from the store.

### Workflows

10. A developer runs a workflow processor on the in-memory consumer, so workflows can be tested without a database.
    10.1. GIVEN a workflow processor on the store's consumer WHEN its input events are appended THEN its output messages are appended to the same in-memory store.
    10.2. GIVEN the workflow scenarios that SQLite's workflow suite covers WHEN they run on the in-memory consumer THEN they have the same outcomes.

### Standalone consumer

11. A developer builds an in-memory consumer from a source, so they can feed it any messages.
    11.1. GIVEN `inMemoryEventStoreConsumer({ source, messageStore })` WHEN it is created THEN it has not started.
    11.2. GIVEN an injected source holding messages WHEN the consumer starts and catches up THEN its reactor received those messages.
    11.3. GIVEN an injected source WHEN the consumer is closed THEN the source is not closed.
    11.4. GIVEN an existing processor WHEN it is registered through `consumer.reactor(processor)` THEN the same processor is returned and is listed in `consumer.processors`.
    11.5. GIVEN a workflow processor on a standalone consumer WHEN it produces output THEN the output is appended to the `messageStore` passed to the factory.
    11.6. GIVEN a call to `inMemoryEventStoreConsumer` without `source` or without `messageStore` THEN it does not compile.
    11.7. GIVEN a standalone consumer whose `messageStore` is an in-memory store AND a projector created through `consumer.projector(...)` without its own database WHEN it processes events THEN its read model and checkpoint are in `messageStore.database`.
    11.8. GIVEN a standalone consumer whose `messageStore` is an in-memory store AND a reactor created through `consumer.reactor(...)` with its own `connectionOptions.database` WHEN it processes an event THEN its checkpoint is in its own database, not in `messageStore.database`.
    11.9. GIVEN a standalone consumer whose `messageStore` is not an in-memory store AND a reactor created through `consumer.reactor(...)` without its own database WHEN it processes an event THEN it stores its checkpoint in its own fresh database, as in-memory reactors do today.
    11.10. GIVEN a standalone consumer whose `messageStore` is an in-memory store AND an already built processor passed to `consumer.reactor(processor)` WHEN it processes events THEN it keeps its own checkpoint and read model storage, not `messageStore.database`, and its handlers still see `context.session.messageStore` (9.8).
    11.11. GIVEN a workflow processor on a standalone consumer whose `messageStore` is an in-memory store WHEN it processes an input THEN its checkpoint is in `messageStore.database`.

### `inMemoryMessageSource`

12. A reader of `inMemoryMessageSource` gets messages pushed, so it doesn't wait for a timer.
    12.1. GIVEN messages appended before reading WHEN reading from the beginning THEN the reader gets all of them, then a "caught up" signal.
    12.2. GIVEN a reader that caught up AND timers that never advance WHEN messages are appended THEN the reader gets them, then another "caught up" signal, without any timer firing.
    12.2a. GIVEN a reader that caught up and is waiting WHEN nothing is appended THEN the source has no pending timer.
    12.3. GIVEN a read from a checkpoint WHEN reading THEN the reader gets only messages after that checkpoint.
    12.4. GIVEN messages appended WHEN the last checkpoint is asked for THEN it is the checkpoint of the last appended message; GIVEN an empty source THEN there is none.
    12.5. GIVEN two readers WHEN both read the same source THEN each gets every message independently.
    12.6. GIVEN a reader waiting for messages WHEN its signal aborts THEN the read ends.
    12.7. GIVEN `inMemoryMessageSource` options WHEN `pullingFrequencyInMs` is passed THEN it does not compile.

### Required `consumer` on `EventStore`

13. Code that takes any `EventStore` calls `consumer()` directly, so it doesn't need optional checks.
    13.1. GIVEN a value typed as `EventStore` WHEN `consumer()` is called without optional chaining THEN it compiles.
    13.2. GIVEN an in-memory store WHEN it is assigned to `EventStore` THEN it compiles.
    13.3. (Protects existing behaviour.) GIVEN a store that narrows `consumer` to its own config and consumer types WHEN it is assigned to `EventStore` THEN it compiles. The existing contract test "accepts a store that narrows the consumer member" covers this.
    13.4. (Protects existing behaviour.) GIVEN the PostgreSQL, SQLite (sqlite3, D1, Durable Objects), MongoDB and EventStoreDB stores WHEN `npm run build:ts` runs THEN it passes. Each store's interface extends `EventStore`, so this checks them against the required member.

14. The Durable Objects sample still builds. (Protects existing behaviour.)
    14.1. GIVEN the sample at its pinned Emmett version WHEN it type-checks THEN it compiles.
    14.2. GIVEN the sample's existing integration tests WHEN they run THEN they pass unchanged.

### Documentation

15. A reader learns that the in-memory store has a consumer and async projections.
    15.1. GIVEN the event store comparison matrix WHEN read THEN In-Memory's "Built-in Projections" says "Inline + Async".
    15.2. GIVEN the In-Memory sections of the guide and the API reference WHEN read THEN each shows a consumer example taken from a snippet test.
    15.3. GIVEN the in-memory consumer snippet test WHEN `npm run test:unit` runs THEN it is collected and passes.
    15.4. GIVEN the existing snippet specs under the docs snippets WHEN `npm run test:unit`, `npm run test:int` and `npm run test:e2e` run THEN each is collected by the suite matching its suffix and passes.

### Other stores' consumers and the message store

Each criterion below keeps its spec r13 number in brackets.

16. In-memory processors on a SQLite consumer can append through the consumer's store.
    16.1. [was 9.10, SQLite part] GIVEN an in-memory reactor hosted by a SQLite consumer (one scenario per SQLite driver: sqlite3, D1 and Durable Objects) whose handler appends an event to a new stream through `context.session.messageStore` WHEN it handles a message THEN that event can be read from that consumer's store.

17. In-memory processors on a PostgreSQL consumer can append through the consumer's store.
    17.1. [was 9.10, PostgreSQL part] GIVEN an in-memory reactor hosted by a PostgreSQL consumer whose handler appends an event to a new stream through `context.session.messageStore` WHEN it handles a message THEN that event can be read from that consumer's store.

18. MongoDB processors and in-memory processors on a MongoDB consumer always have the store's message store.
    18.1. [was 9.10, MongoDB part] GIVEN an in-memory reactor hosted by a MongoDB consumer whose handler appends an event to a new stream through `context.session.messageStore` WHEN it handles a message THEN that event can be read from that consumer's store.
    18.2. [was 9.11] GIVEN a MongoDB reactor on the MongoDB consumer whose handler appends an event to a new stream through `context.session.messageStore` WHEN it handles a message THEN that event can be read from the MongoDB store.
    18.3. [was 9.12, MongoDB part] GIVEN `MongoDBProcessorHandlerContext` WHEN its type is checked with `expectTypeOf` THEN `session.messageStore` is required.

19. In-memory processors on an EventStoreDB consumer can append through the consumer's store.
    19.1. [was 9.10, EventStoreDB part] GIVEN an in-memory reactor hosted by an EventStoreDB consumer whose handler appends an event to a new stream through `context.session.messageStore` WHEN it handles a message THEN that event can be read from that consumer's store.
    19.2. [was 9.12, EventStoreDB part] GIVEN `EventStoreDBProcessorHandlerContext` WHEN its type is checked with `expectTypeOf` THEN `session.messageStore` is required.

20. A MongoDB store with a custom `databaseName` works with its consumer.
    20.1. [was 9.11a] GIVEN a MongoDB store created with `storage: { type: 'COLLECTION_PER_STREAM_TYPE', databaseName: 'custom_db' }` AND a started consumer from it WHEN an event is appended to the store THEN the consumer's reactor receives it.
    20.2. [was 9.11b] GIVEN that store AND a MongoDB reactor on its consumer that appends an event to a new stream through `context.session.messageStore` WHEN it handles a message THEN that event can be read from that store.
    20.3. [was 9.11c] GIVEN that store AND an in-memory reactor on its consumer that appends an event to a new stream through `context.session.messageStore` WHEN it handles a message THEN that event can be read from that store.
    20.4. [was 9.11d] GIVEN that store AND a MongoDB workflow processor on its consumer WHEN it handles an input THEN its output can be read from that store.
    20.5. [was 9.11e] GIVEN that store AND a MongoDB reactor with checkpoints on its consumer WHEN it processes an event THEN its checkpoint is stored in `custom_db`'s `emt:processors` collection, not in the default database.
    20.6. [was 9.11f] GIVEN a standalone `mongoDBEventStoreConsumer` created with `storage: { type: 'COLLECTION_PER_STREAM_TYPE', databaseName: 'custom_db' }` WHEN an event is appended to a MongoDB store with the same storage THEN the consumer's reactor receives it, and an event its reactor appends through `context.session.messageStore` can be read from that store.
    20.7. [was 9.11g] GIVEN a consumer with `databaseName: 'custom_db'` AND a MongoDB reactor created through `consumer.reactor({ ..., storage: { type: 'COLLECTION_PER_STREAM_TYPE', databaseName: 'other_db' } })` WHEN it appends through `context.session.messageStore` THEN the event is in `other_db`, not `custom_db`.
    20.8. [was 9.11h] GIVEN a consumer with `databaseName: 'custom_db'` AND a MongoDB reactor built with `changeStreamReactor({ ..., storage: { ..., databaseName: 'other_db' } })` and passed to `consumer.reactor(reactor)` WHEN it appends through `context.session.messageStore` THEN the event is in `other_db`.

21. In-memory processors always have a message store.
    21.1. [was 9.9] GIVEN `InMemoryProcessorHandlerContext` WHEN its type is checked with `expectTypeOf` THEN `session.messageStore` is a required `EventStore`.
    21.2. [was 9.13] GIVEN an in-memory reactor on the generic `consumer(...)` created without a `scope`, so its session has no `messageStore`, WHEN the consumer starts THEN `start()` and `whenStarted()` reject with an `EmmettError` naming the missing message store.

## Implementation Decisions

### Base interface

- `consumer` on the base `EventStore` interface loses its `?`. Its signature and doc comment stay otherwise the same: it takes optional `MessageConsumerOptions` and returns a `MessageConsumer`.
- Shared test code that calls `eventStore.consumer?.()` and then asserts the result exists calls `eventStore.consumer()` directly.

### In-memory store

- The store creates one `inMemoryMessageSource` when it is created. It is the global log.
- `appendToStream` adds the new events to the global log at the same point where it stores them in their stream: after expected-version checks, before inline projections and after-commit hooks. The log holds the same stored form as the stream, after downcasting. Today an append whose inline projection fails keeps its events in the stream; the log follows the stream, so those events stay in the log too.
- Extra work per append: one `append(...)` call on the global log and waking any waiting readers. Q8 and Q19 allow it. The log holds references to the same event objects as the streams, not copies.
- The global position of a new event may be computed from the global log's length instead of summing all stream lengths. Both give the same numbers.
- `appendToStream` returns `AppendToStreamResultWithGlobalPosition`. `lastEventGlobalPosition` is the checkpoint of the last appended event. `InMemoryEventStore`'s type reflects this.
- The store's `projections` option accepts async registrations as well as inline ones. `appendToStream` keeps running only inline ones.
- `InMemoryEventStore` declares `consumer(options?)`. Its options are the in-memory consumer config plus `includeAsyncProjections?: boolean`, and it returns the typed in-memory consumer.
- The store's `consumer()` builds the consumer through `inMemoryEventStoreConsumer`, with the global log as its source and the store itself as its message store. Its processors therefore use the store's database by the message-store rule below. With `includeAsyncProjections: true`, it adds each async projection as a projector, the same way as any other projector on the consumer.
- The store's consumer does not close the global log when the consumer closes.
- The store's `consumer()` merges the store's `observability` option with the consumer's own, as SQLite's store does, so a consumer without its own observability uses the store's.

### In-memory consumer

- Config: the generic `MessageConsumerOptions`, plus `stopWhen.noMessagesLeft`, plus `pulling: { batchSize, batchDeadlineInMs }`, the parts of SQLite's consumer config that are not tied to SQL. There is no `pullingFrequencyInMs`.
- Standalone factory: `inMemoryEventStoreConsumer({ source, messageStore, ...config })`. `source` is a `MessageSource` and `messageStore` is an `EventStore`; both are required. The factory never closes the injected source.
- Types: an in-memory consumer type that is `MessageConsumer` with in-memory reactor, projector and workflow processor factories, following how `SQLiteEventStoreConsumer` is built from SQLite factories.
- `reactor(...)` and `projector(...)` use the existing `inMemoryReactor` and `inMemoryProjector`.
- `workflowProcessor(...)` runs a real workflow processor built on Emmett's generic `workflowProcessor`, with in-memory checkpoints. It reads the consumer's message store from `context.session.messageStore`, which the consumer's scope provides.
- Handler context: the consumer's `scope` passes `session: { messageStore }`, set to the consumer's `messageStore`, the same way `sqliteEventStoreConsumer` passes its session through its scope. `inMemoryProcessingScope` already forwards the consumer's `session` into the handler context, so every processor on the consumer sees it, including processors passed in already built. `inMemoryReactor` and `inMemoryProjector` get no new options (Q32). There is no `context.eventStore` for processors (Q30).
- Handler context type: `InMemoryProcessorHandlerContext` declares `session.messageStore: EventStore` as required, the same as SQLite's and PostgreSQL's processor contexts declare their message store (Q33). The workflow processor keeps its required `MessageStoreSession`.
- Other consumers: the SQLite, PostgreSQL, MongoDB and EventStoreDB consumers each add `messageStore` to the session they pass through their `scope`, so in-memory processors they host always have it (Q34).
  - SQLite and PostgreSQL build it from the consumer's pool with the consumer's event store schema options and `autoMigration: 'None'`, the same way their processors build it in their processing scopes.
  - MongoDB builds it from the consumer's client and the store's `storage` options, next to the `client` it already passes (Q36, Q38):
    - The MongoDB store's `consumer()` passes its `storage` options to the consumer. The standalone `mongoDBEventStoreConsumer` gets an optional `storage` option.
    - The consumer passes `storage.databaseName` to its change-stream source as `dbName`, as PostgreSQL passes its schema name to its source.
    - MongoDB reactors, projectors and workflow processors get an optional `storage` option. The consumer's factories fill it with the consumer's `storage` when the caller gave none, as PostgreSQL's consumer fills `migrationOptions`. A processor passed in already built keeps its own.
    - Every MongoDB `messageStore`, in the consumer scope and in the reactor, projector and workflow scopes, is built from the client plus those `storage` options, once, when the consumer or processor is created. This also moves the workflow scope's build from every call to creation.
    - MongoDB processor checkpoints follow `storage.databaseName`: `mongoDBCheckpointer` reads and stores them in that database's `emt:processors` collection instead of the client's default database, as PostgreSQL's checkpointer follows `migrationOptions.databaseSchemaName`.
  - EventStoreDB passes no scope today. It gets one passing `{ session: { client, messageStore } }`, matching what its processing scope sets and how MongoDB's consumer passes its client.
  - Each consumer builds its `messageStore` once, when the consumer is created, as PostgreSQL's consumer builds its scope context once today. No work is added per batch.
  - Their own processors keep building it in their processing scopes as today. The exception is MongoDB reactors and projectors: their processing scope builds no store today and only spreads the consumer's session. It now builds `messageStore` from the processor's own client, as the MongoDB workflow processing scope already does. It builds it once, when the processor is created, not on every call. So `session.client` and `session.messageStore` always come from the same client.
- Message store type in other stores: `MongoDBProcessorHandlerContext` and `EventStoreDBProcessorHandlerContext` declare `session.messageStore` as required, as SQLite, PostgreSQL and in-memory do (Q33 consistency).
- Missing message store: `inMemoryProcessingScope` throws `EmmettError` when the session has no `messageStore`, the same way it throws for a missing `database`. The scope also runs when the processor starts, so the error shows up as `start()` rejecting. This only happens when an in-memory processor runs without a store consumer, for example on the generic `consumer(...)` without a scope.
- In-memory store check: the consumer treats `messageStore` as an in-memory store when it has a `database` member. The check runs once, when the factory is called (Q29).
- Message-store rule for the database: when the consumer's `messageStore` is an in-memory store, every in-memory processor the consumer creates from options (`reactor`, `projector`, `workflowProcessor`) and whose options don't name a database gets `messageStore.database` through `connectionOptions.database`. It must go through `connectionOptions.database`, because the in-memory processors prefer their own database over one in the handler context. When the `messageStore` is not an in-memory store, those processors keep today's default, their own fresh database. Already built processors passed in are not changed. The factory has no separate `database` option (Q25).
- The consumer is built on Emmett's generic `consumer(...)`, the same way the store consumers are.

### `inMemoryMessageSource`

- Built on `subscriptionMessageSource` instead of `pollingMessageSource`.
- Options: `messages?` and `batchSize?`. `pullingFrequencyInMs` is removed. `batchSize` is passed to `subscriptionMessageSource`, as the MongoDB source does; the source does no chunking of its own, and the consumer batches. `append(...)` and `readLastMessageCheckpoint()` keep their current behaviour.
- A read resolves its start position from `'BEGINNING'`, `'END'` (the last checkpoint when the read starts) or a checkpoint. It yields every message after that position, then a `MessageSourceCaughtUp` message. Then it waits until `append(...)` adds messages or the read's signal aborts. After each burst of appends it yields the new messages and another `MessageSourceCaughtUp`.

### Durable Objects sample

- `clientsEventStore` gets a `consumer` member that throws `EmmettError` with a "not implemented" message. Nothing calls it, so it has no acceptance criterion or test (Q21). The member keeps the sample compiling once it moves to an Emmett version with the required `consumer`.
- The sample's dependencies stay at their pinned published Emmett version. Nothing else in the sample changes.

### Contract spec

- The test "accepts a store that does not expose a consumer at all" is deleted, with nothing in its place. The test "accepts a store that narrows the consumer member" stays.

### Documentation

- In the comparison matrix of the event store guide, In-Memory's "Built-in Projections" changes from "Inline" to "Inline + Async".
- The In-Memory sections of the event store guide and the event store API reference each get a short consumer example, included from a new in-memory consumer snippet test under the docs snippets, as the PostgreSQL page does.
- A Vitest project for the docs snippets is added to the root Vitest config, so snippet spec files run. The existing scripts select files by suffix, so `.unit.spec` snippets run with `npm run test:unit`, `.int.spec` snippets, such as the PostgreSQL consumer one, run with `npm run test:int`, and `.e2e.spec` snippets, such as the web API BDD one, run with `npm run test:e2e`. Existing snippet specs must pass once they run.

## Testing Decisions

- Tests check observable behaviour through the seams below: what processors receive, what lands in the store or database, and what the consumer's promises do. They don't check internal fields. Assert every field of received events, as the existing consumer tests do.
- Seams:
  - `getInMemoryEventStore(...).consumer(...)`: the main seam.
  - `inMemoryEventStoreConsumer({ source, messageStore })`: the standalone seam.
  - `inMemoryMessageSource`: its existing unit spec plus the push scenarios.
  - Type level: `expectTypeOf` inside the regular `*.unit.spec.ts` files, and `// @ts-expect-error` only for calls that must not compile.
- Copy every SQLite consumer scenario that is not tied to SQL, keeping SQLite's scenario names and outcomes. Prior art: SQLite's consumer suites for the base consumer, handling, awaiters, in-memory projections, workflow, and the unit suite with an injected source. Skipped as tied to SQL: schema, processor transactions, processor pool, projection rebuild, and the projections suite, which uses Pongo/SQLite projections (8.2).
- The in-memory tests make no external I/O, so all of them are unit tests (`*.unit.spec.ts`) and run with `npm run test:unit`:
  - The copied SQLite consumer suites and the `inMemoryMessageSource` scenarios live in the core package, next to the code they test.
  - `testConsumerSchemaVersion` runs from the existing in-memory unit spec in `emmett-tests`, which already runs `testSchemaVersion` for the in-memory store.
  - The `reactorErrors.features.ts` scenarios run from a new in-memory unit spec in `emmett-tests`' error handling folder, next to the SQLite and PostgreSQL ones.
- 12.2 and 12.2a use Vitest fake timers to show no timer is involved.
- The Durable Objects `clientsEventStore` throw gets no test of its own, because nothing calls it. The sample's existing tests must still pass.
- The docs snippet for the in-memory consumer is a unit test, so it runs without Docker.

## Out of Scope

- Follow-up: MongoDB custom collection names that don't start with `emt:` (a `SINGLE_COLLECTION` `collectionName` or a `CUSTOM` `collectionFor`), and `CUSTOM` storage returning a different database per stream type. The change-stream filter keeps only `emt:` collections in one database, so these need a subscription redesign (Q38).
- Follow-up: consumers whose source isn't an event store, such as Kafka or SQS, may have no message store to put in `session.messageStore`. The required typing (Q33) has to be revisited when such consumers are added (Q35).
- Reworking the Cloudflare Durable Objects sample's integration test so it doesn't need the hand-written `clientsEventStore` adapter. This is a follow-up (Q6).
- Adding a "read all" operation to `EventStore`.
- Changing how `inMemoryMessageSource` finds messages after a checkpoint. It keeps scanning its array; slicing by position was not asked for (Q8).

## Further Notes

- Removing `pullingFrequencyInMs` from `inMemoryMessageSource` and making `consumer` required on `EventStore` are breaking changes for code that passes that option or implements `EventStore` without a consumer.
- The message-store rule for the database is the current choice (Q25: "Let's start with B"), open to change later.
- MongoDB and EventStoreDB don't offer `includeAsyncProjections`. This spec doesn't change that.
