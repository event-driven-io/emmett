# Q&A: processors' message store carries the store's options

Context: found during the in-memory consumer work (see `brainstorms/in-memory-consumer/qa.md`, "driver processors append without the store's options"). SQLite, PostgreSQL, MongoDB and EventStoreDB processors build their own `session.messageStore` in their processing scope, without the user's store options (inline `projections`, `hooks`, observability). A reactor appending through `context.session.messageStore` therefore skips the store's inline projections and hooks. This was already the case on main.

## Q0: direction

**Question:** A: the processor uses the user's store itself, passed down by `eventStore.consumer()` (for SQLite/PostgreSQL the append would leave the processor's transaction, so append and checkpoint no longer commit together). B: the processor gets the store's options and builds its store with them, as today; SQLite/PostgreSQL keep it bound to the processor's transaction (precedent: SQLite `withSession`).

**Answer (verbatim):** "This should go through /brainstorm and /specification flow, but B"

**Interpretation:** Direction B. Brainstorm and specify it before implementing.

## Q1: which store options should the processor's store get?

**Question:** Of `projections`, `observability`, `schema`, `hooks` (schema hooks, commit hooks), which should the reactor's store get?

**Answer (verbatim):** "ok, let's keep it outtside, file a GH issue"

**Interpretation:** Out of the in-memory consumer PR. Filed as a GitHub issue; the brainstorm continues from there later.

Issue: https://github.com/event-driven-io/emmett/issues/432

## Note: #432 branch review (2026-11-26)

The `session_store_runs_inline_projections` branch was rebased onto main (277c44c0). It passes `projections`, `hooks.onBeforeCommit` and `observability` from the store to its consumer, through the new `PostgreSQLMessageStoreOptions` and SQLite types, and the processing scope builds its store with them. Its JSDoc, docs paragraph and commit body said that a processor store's `onBeforeCommit` "can see events that are rolled back or appended again by a retried handler".

**Answer (verbatim):** "onBeforeCommit` of a processor's store runs inside the processor's transaction, so it can see events that are rolled back or appended again by a retried handler. - wtf?!"

**Answer (verbatim):** "why rolled back?!"

**Finding:** The hook runs inside `appendToStream` with `context.transaction` (`postgreSQLEventStore.ts:512-545`). For a processor that transaction is the batch transaction, which #437 rolls back as a whole when a handler throws. All the hook writes through `context.transaction` rolls back with the events, so nothing is left inconsistent; only side effects outside the database can't be undone, which is true of `onBeforeCommit` in general. The comment, the docs paragraph and the commit sentence warn about nothing specific to this change. Proposal: remove all three.

## Q2: pass the store's options, or the store itself?

**Answer (verbatim):** "Ok, i think that we should probably finish in_memory_consumer branch, it has better way to pass event store"

**Answer (verbatim):** "it's weird to me pass message store options, but maybe it's not that bad"

**Finding:** On `in_memory_consumer`, every store already passes itself to its consumer (`messageStore: eventStore` in `postgreSQLEventStore.ts` and `SQLiteEventStore.ts`, `this` in MongoDB, `store` in EventStoreDB; audit item 1 in `../in-memory-consumer/qa.md`, answer "a)"). The PostgreSQL and SQLite processing scopes still replace it with a store built without the user's options (`postgreSQLProcessor.ts:369`, `sqliteProcessor.ts:249`). `withSession` on main already builds a copy of the store bound to one connection, with all its options and `autoMigration: 'None'`.

**Proposal:** The processing scope asks the store it got for a copy bound to the processor's transaction, as `withSession` does for a connection. The options stay inside the store, the `...MessageStoreOptions` types are not needed, and an option added to the store later reaches processors without a change. This needs one new store method in each SQL store. It replaces the options approach of the #432 branch and is done on `in_memory_consumer`.

**Status:** Not decided. The `inMemoryMessageSource` shape comes first.
