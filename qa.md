# Unifying consumers: brainstorming Q&A

The design conversation that produced [spec.md](./spec.md). Questions in order, each built
on the previous answer.

## Starting point

> Currently we have unification for processors in
> `src/packages/emmett/src/processors/processors.ts` and types for consumers in
> `src/packages/emmett/src/consumers/consumers.ts`. But each store implements its own
> consumer method which is not part of `src/packages/emmett/src/eventStore/eventStore.ts`.
> I'd like the same consumer abstraction as in processor, then each consumer could apply
> its own specifics like checkpointing, inject puller/subscription. The first step should
> be adding some sort of `MessageSource` that would also be unified, allowing explicit
> implementations, and returning an async generator of messages (or batches of messages).

The four store consumers in question:

- `src/packages/emmett-postgresql/src/eventStore/consumers/postgreSQLEventStoreConsumer.ts`
- `src/packages/emmett-sqlite/src/eventStore/consumers/sqliteEventStoreConsumer.ts`
- `src/packages/emmett-mongodb/src/eventStore/consumers/mongoDBEventStoreConsumer.ts`
- `src/packages/emmett-esdb/src/eventStore/consumers/eventStoreDBEventStoreConsumer.ts`

## Q1: What is the unit `MessageSource` yields?

Options weighed: an async generator of single messages, an async generator of batches, or a
callback-based `onBatch` push interface.

**Answer: async generator of batches.**

Both existing families are batch-shaped underneath. PG and SQLite poll `readMessagesBatch`;
Mongo and ESDB push through a `stream.pipeline` that already groups. Per-message generators
would force the batch back together at every consumer, and processors already take arrays.
Backpressure comes free from the iterator protocol: the source cannot run ahead of the
consumer because `next()` is only called when the consumer is ready.

## Q2: Where does the source come from, a store member or a standalone factory?

**Answer: standalone factory plus an optional `EventStore.messageSource()` member.**

Today's consumers are constructed from a connection string with no event store instance in
sight, and that has to keep working. A standalone `postgreSQLMessageSource({ connectionString })`
covers it. The optional store member is what makes the abstraction visible on the
`EventStore` interface, and it gives non-store sources (in-memory, tests, a future bus) a
home that does not require an event store at all.

## Q3: How does "caught up" travel from source to consumer?

First proposal was an optional `areMessagesLeft` flag on the batch. Rejected in substance:

> I'd either expose hooks or use control messages, so making the API clear, thoughts?

The optional flag was the weak part. Its meaning differs per source (a polling source knows
"the last page was short", a subscription source knows "the server said caught up"), and an
optional boolean whose semantics vary by implementation goes murky fast. Re-asked between a
batch-level control union and per-message control messages.

**Answer: per-message control messages.**

Reuses `GlobalStreamCaughtUp` and `isSubscriptionEvent` from `eventStore/events/`, which
already exist and already flow through the ESDB and Mongo paths. Non-negotiable mitigation:
the generic consumer strips control messages exactly once, before processor fan-out, so no
processor, `canHandle`, or `wasMessageHandled` ever sees a non-message.

## Q4: Where does per-batch store context (a connection, a transaction) come from?

**Answer: a separate `scope` option on the consumer.**

Mirrors `MessageProcessingScope` on the processor side, so the shape is already familiar.
`MessageSource` stays a pure read abstraction with no opinion about handler context. SQLite
is the case this exists for: it needs `pool.withConnection` around each batch, which a
static context object cannot express.

## Q5: Do the store-specific consumer factories get deprecated?

Premise rejected:

> Why do we need to drop it? People should still be able to use specific consumers if they
> want to.

**Answer: both APIs stay public, neither deprecated.**

The store sugar has no home in a generic-only API: PG's advisory locks and
`rebuildPostgreSQLProjections`, SQLite's `workflowProcessor` with `messageStore` omitted,
connection ownership in `close()`. Keeping the store factories also means their existing
test suites remain the specification for the refactor.

## Q6: Does core ship source helpers, or does each store write its own generator?

**Answer: both polling and subscription helpers in core.**

PG and SQLite are the same poll loop with the same defaults (batch 100, frequency 50ms,
backoff 100 then min(x2, 1000)). Mongo and ESDB are the same
`stream.pipeline(subscription, Transform, Writable)` with the same `*ResubscribeDefaultOptions`.
Two helpers, `pollingMessageSource` and `subscriptionMessageSource`, absorb both families;
each store supplies only a `readBatch` or a `subscribe`.

## Q7: Where does a store-specific checkpoint comparator live?

Mongo needs `compareTwoMongoDBCheckpoints`, currently threaded by hand through
`ConsumerStartPositions.resolve` and every processor factory.

**Answer: `compareCheckpoints` on `MessageSource`, propagated by the consumer.**

The comparator is a property of the checkpoint format, which is a property of the source.
Declaring it once at the source and having the consumer push it into `resolve` and into
every registered processor deletes the threading entirely.

## Q8: Who owns stop conditions, the source or the consumer?

**Answer: the consumer owns `until`.**

Sources always emit caught-up and never self-stop. This keeps sources dumb and makes the
existing-but-unread `MessageConsumerOptions.until` real. PG's `stopWhen` maps onto it.

## Q9: Is `scope` fixed at construction or passed per `read()`?

**Answer: fixed at construction.**

Nothing in the four stores varies scope per read, and a per-read scope would put handler
context back into the source, undoing Q4.

## Q10: What about the pre-existing inconsistencies found while reading the four consumers?

**Answer: fix everything found, but file each first and ask what to do with them.**

Ten latent issues, listed in the spec's Phase 0 table. Each gets an issue, an agreed
resolution, and a test that fails before the fix.
