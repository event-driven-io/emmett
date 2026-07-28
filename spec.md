# Unifying consumers around a shared MessageSource

## Context

`processors.ts` already unifies processors. `reactor` / `projector` own message filtering,
upcasting, `canHandle`, `stopAfter`, checkpoint storage and `whenProcessed` waiters, and
each store plugs in through exactly three seams: `processingScope`, `checkpoints`, `hooks`.

Consumers never got that treatment. `src/packages/emmett/src/consumers/consumers.ts` holds
only types plus an observability collector, and `EventStore`
(`src/packages/emmett/src/eventStore/eventStore.ts`) has no consumer or subscribe member.
The only subscription-ish surface there is a commented-out `streamEvents()`. So each store
hand-rolls a consumer and they have drifted.

`postgreSQLEventStoreConsumer.ts` is 463 lines. Reading it against the other three, the
store-specific content is: pool creation and ownership, the `processorContext` shape, the
`whenCaughtUp` tail read, the three processor factory members, and the puller construction.
Everything else, roughly 300 lines, is copied in all four files:

- the closure state block (`isRunning`, `isInitialized`, `start`, `startedAwaiter`)
- `consumerId: options.consumerId ?? uuid()` and the `isRunning` getter
- `whenProcessed`, byte-identical
- the `whenCaughtUp` skeleton around a differing tail read
- processor registration, including the same `// TODO: change that` cast, three times per file
- the `Promise.allSettled` fan-out in `eachBatch` with its `.some(fulfilled && !== 'STOP')`
- the `start()` guards and the "at least a single processor" error
- `stopProcessors`, `stop()`, the `init()` loop
- the `resolve -> earliestPosition -> start({ startFrom, started })` choreography

Below that, the pullers are two families. PG and SQLite are the same poll loop with the same
defaults (batch 100, frequency 50ms, backoff 100 -> min(x2, 1000)). Mongo and ESDB are the
same `stream.pipeline(subscription, Transform, Writable)` with the same
`*ResubscribeDefaultOptions`.

**Outcome intended:** one `MessageSource` abstraction and one generic `consumer()` in core.
Each store contributes only what is genuinely its own. Store-specific consumer factories
stay public and supported.

## Principles

1. **Prefer removal over addition.** Every phase must delete more than it adds in the store
   packages. A phase that leaves the old code path alive "just in case" is not done. Where
   a new core helper exists, the store code it replaces goes in the same commit, not a
   follow-up. Each phase reports lines added and lines removed.
2. **Test first, always.** Write the failing test, watch it fail for the right reason, then
   write the minimum to pass, then refactor. This holds for the core contract (unit tests
   against an in-memory source) and for every store migration (the existing consumer suites
   are the specification, and they must pass unchanged because the store factory signatures
   do not change).
3. **No phase starts until the previous is green:** `npm run build:ts` (never `npm run
   build`), lint, and full tests. Pristine output; a warning is a failure.

## Decisions

Full Q&A is preserved in [qa.md](./qa.md). The settled design:

1. `MessageSource` yields an **async generator of batches**. Pull sources yield from their
   poll loop; push sources feed a bounded queue the generator drains. Backpressure comes
   free from the iterator protocol.
2. **Standalone factory plus an optional `EventStore.messageSource()` member.** Today's
   connectionString-only usage keeps working and non-store sources have a home.
3. **Caught-up travels as per-message control messages**, reusing the existing
   `GlobalStreamCaughtUp` / `isSubscriptionEvent` from `eventStore/events/`. The generic
   consumer strips them exactly once before fan-out, so processors, `canHandle` and
   `wasMessageHandled` never see a non-message.
4. **`scope` is a consumer option**, mirroring `MessageProcessingScope`. `MessageSource`
   stays a pure read abstraction.
5. **Both APIs stay public, neither deprecated.**
6. **Core ships `pollingMessageSource` and `subscriptionMessageSource`.**
7. **`compareCheckpoints` lives on `MessageSource`**, propagated by the consumer.
8. **The consumer owns `until`.** Sources always emit caught-up and never self-stop.
9. **Scope is fixed at construction**, not part of `read()`.

## Contract

New file `src/packages/emmett/src/consumers/messageSource.ts`:

```ts
export type MessageSourceReadOptions = {
  from: CurrentMessageProcessorPosition;
  batchSize?: number;
  signal: AbortSignal;
};

export type MessageSourceBatch<M, Meta> = {
  messages: (RecordedMessage<M, Meta> | GlobalSubscriptionEvent)[];
  lastCheckpoint: ProcessorCheckpoint | null;
};

export type MessageSource<M extends Message = AnyMessage, Meta = AnyReadEventMetadata> = {
  read(options: MessageSourceReadOptions): AsyncIterable<MessageSourceBatch<M, Meta>>;
  readLastCheckpoint(): Promise<ProcessorCheckpoint | null>;
  readLastCommittedCheckpoint?(): Promise<ProcessorCheckpoint | null>;
  compareCheckpoints?: (a: ProcessorCheckpoint, b: ProcessorCheckpoint) => number;
  close?(): Promise<void>;
};
```

`readLastCheckpoint` resolves an `'END'` start position and feeds
`ConsumerStartPositions.resolve`. `readLastCommittedCheckpoint` backs `whenCaughtUp` and
exists solely because PG needs the distinction (`readLastMessageCheckpoint` applies the
`pg_snapshot_xmin` filter, `readLastCommittedMessageCheckpoint` does not). It defaults to
`readLastCheckpoint`.

New file `src/packages/emmett/src/consumers/consumer.ts`:

```ts
export type MessageConsumerScope<Ctx> =
  <R>(handler: (context: Partial<Ctx>) => Promise<R>) => Promise<R>;

export type ConsumerOptions<M, Meta, Ctx> = MessageConsumerOptions<M> & {
  source: MessageSource<M, Meta>;
  scope?: MessageConsumerScope<Ctx>;   // defaults to (h) => h({})
  batchSize?: number;
  hooks?: { onClose?: () => Promise<void> };
};

export type Consumer<M, Meta, Ctx> = MessageConsumer<M> & Readonly<{
  whenProcessed: (position: ProcessorCheckpoint, options?: WaitOptions) => Promise<void>;
  whenCaughtUp: (options?: WaitOptions) => Promise<void>;
  register: <P extends MessageProcessor<any, any, any>>(processor: P) => P;
}>;

export const consumer = <M, Meta, Ctx>(options: ConsumerOptions<M, Meta, Ctx>)
  : Consumer<M, Meta, Ctx>;
```

`scope` is used everywhere the consumer needs a store context: `init()`, the fan-out in the
read loop, `ConsumerStartPositions.resolve`, `stopProcessors`, and the `whenCaughtUp` tail
read. PG passes its `processorContext`; SQLite passes `pool.withConnection`, which is the
case this seam exists for; Mongo passes `{ client }`; ESDB uses the default identity scope.

`register` replaces the triplicated `processors.push(processor as unknown as ...)` with its
`// TODO: change that` comment, and is where the consumer injects
`source.compareCheckpoints` and `mergeObservability(options.observability, ...)`.

The read loop:

```ts
for await (const batch of source.read({ from: startPositions.earliestPosition, batchSize, signal })) {
  const { messages, caughtUp } = splitControlMessages(batch.messages);
  if (messages.length > 0 && await handleBatch(messages) === 'STOP') break;
  if (caughtUp) {
    notifyCaughtUpWaiters(batch.lastCheckpoint);
    if (until?.noMessagesLeft) break;
    if (until?.caughtUp && reachedStartTail()) break;
  }
}
```

Breaking runs the generator's `finally`, which is how a source tears down. `stop()` aborts
the signal, which does the same.

## Phases

### Phase 0 (sequential, with Oskar): file and triage the latent issues

Exploration found pre-existing inconsistencies the refactor will touch. Per your call: file
each as a GitHub issue, agree the resolution with you, then fix them as part of the phase
that owns the code. Nothing here gets silently changed.

| # | Issue | Package |
|---|-------|---------|
| 1 | Subscription built eagerly at factory time and the stopped instance reused after `stop()`, so restart differs from the other three | esdb |
| 2 | `AbortController` created but never observed | esdb |
| 3 | `close()` is `stop`, so a client the consumer created is never closed (Mongo closes its own) | esdb |
| 4 | `pulling.batchSize` accepted but dead: the handler does `eachBatch([message])` | esdb |
| 5 | `eachBatch` drops the rejection reason (`{ type: 'STOP' }`) while Mongo/ESDB attach `EmmettError.mapFrom(error)` | postgresql, sqlite |
| 6 | `consumerId` uses uuid v4 where the others use v7 | mongodb |
| 7 | Only PG closes the failing processor when `init()` throws | sqlite, mongodb, esdb |
| 8 | `MessageConsumerOptions.until` and `MessageConsumerStartOptions` declared and read by nobody | emmett |
| 9 | `DefaultProcessotCheckpointCollectionName` typo | mongodb |
| 10 | `stop()` swallows a start rejection in PG but not in SQLite | postgresql, sqlite |

Each fix lands with a test that fails before it.

### Phase 1: core (sequential; only the test-writing research fans out)

New files in `src/packages/emmett/src/consumers/`: `messageSource.ts`, `consumer.ts`,
`pollingMessageSource.ts`, `subscriptionMessageSource.ts`, `inMemoryMessageSource.ts`.

Test first. `consumer.unit.spec.ts` against `inMemoryMessageSource` (a source whose batches
the test drives directly), covering:

- caught-up control message notifies `whenCaughtUp` waiters and never reaches a processor
- `until.noMessagesLeft` and `until.caughtUp` each terminate the loop, and the generator's
  `finally` runs
- `stop()` aborts mid-batch and the source tears down
- a processor returning `STOP` deactivates it; all processors stopping ends the loop
- restart after `stop()` resolves start positions again
- `start()` with no processors rejects with the existing `EmmettError` message
- `source.compareCheckpoints` reaches both `resolve` and registered processors
- `scope` wraps init, fan-out, resolve and close

Then `pollingMessageSource.unit.spec.ts` (backoff schedule, caught-up emission on an empty
poll, `batchSize` honoured, abort mid-wait) and `subscriptionMessageSource.unit.spec.ts`
(resubscribe on retryable error, no resubscribe on unavailable, bounded queue applies
backpressure, checkpoint carried across resubscribe).

Then the implementations. Reused unchanged: `ConsumerStartPositions.resolve`
(`processors/processorStartPositions.ts:111`), `Checkpointer`
(`processors/checkpoints.ts`), `CurrentMessageProcessorPosition` and `wasMessageHandled`
(`processors/processors.ts`), `consumerCollector` (`consumers/observability/`),
`asyncAwaiter`, `GlobalStreamCaughtUp` / `isSubscriptionEvent` (`eventStore/events/`),
`mergeObservability`.

Also: add the optional `messageSource?()` member to the `EventStore` interface, and make
`until` real (issue 8).

**Removal in this phase:** none yet in stores; this is the only additive phase.

### Phase 2: emmett-postgresql

Test first: the existing consumer suites are the specification and must pass unchanged.
Add tests for issues 5 and 10 before fixing them.

- Add `postgreSQLMessageSource` on `pollingMessageSource`, supplying one `readBatch`
  (`readMessagesBatch`) plus the two tail reads from `schema/readLastMessageCheckpoint.ts`.
- Rewrite `postgreSQLEventStoreConsumer` on core `consumer()`, keeping its exported
  signature, its `reactor` / `projector` / `workflowProcessor` members (now via `register`),
  pool ownership in `close()`, advisory locks through `wrapHooksWithProcessorLocks`, and
  `rebuildPostgreSQLProjections`. `stopWhen` maps to `until`.
- **Delete** the poll loop in `consumers/messageBatchProcessing/index.ts` and the ~300 lines
  of generic consumer body. Expected: `postgreSQLEventStoreConsumer.ts` drops from 463 lines
  to roughly 120, almost all of it the three typed processor members.

### Phase 3: emmett-sqlite

Same shape, and the easier of the pair since PG proved the contract against composite
checkpoints. `sqliteMessageSource` on `pollingMessageSource`; `scope` is
`pool.withConnection`. **Delete** `consumers/messageBatchProcessing/index.ts`, which after
phase 2 is a near-duplicate of a file that no longer exists.

### Phase 4: emmett-mongodb

`mongoDBMessageSource` on `subscriptionMessageSource`, keeping the change stream, the
`emt:` collection pipeline, `toMongoDBResumeToken`, `oplogChangeToMessages` and
`toMongoDBCheckpoint`. Declares `compareCheckpoints: compareTwoMongoDBCheckpoints` once,
**deleting** the threading through `resolve` and every processor factory.
`readLastCommittedCheckpoint` keeps the momentary-change-stream drain. **Delete** the
`stream.pipeline(subscription, Transform, Writable)` wiring and the resubscribe loop.
Fix issues 6, 7 and 9.

### Phase 5: emmett-esdb

`eventStoreDBMessageSource` on `subscriptionMessageSource`, scoped at construction by
`from: { stream }`. `readLastCommittedCheckpoint` keeps the three-way dispatch including
`waitForProjection` for `$ce-` / `$et-` link streams. Checkpointing stays in-memory, which
the contract already permits since checkpointing belongs to processors. Fix issues 1 to 4
and 7, most of which disappear structurally: the source is built inside `start()`, the
abort signal is what stops the generator, and `batchSize` becomes real through
`subscriptionMessageSource`.

### Phase 6: docs and samples

Document `MessageSource` and core `consumer()`; state plainly that store-specific consumers
remain first-class. Remove the commented-out `streamEvents()` from `eventStore.ts:54-56`
and `testing/wrapEventStore.ts:88-90`, now that `messageSource()` supersedes it.

## Verification

- After every phase: `npm run build:ts` from `src` (never `npm run build`), lint, full test
  run. Output must be pristine.
- Core: the new unit suites above, with no database.
- Per store: existing consumer and integration suites pass unchanged. Because the store
  factory signatures do not change, any failure is a refactor bug, which is the whole point
  of keeping them.
- Each phase 0 fix has a test that fails before it and passes after.
- End to end: run a sample per store, append events, assert a projection catches up through
  the new source.
- Each phase reports lines added and removed per package, per principle 1.

## Deliberately out of scope

- Pushing a `canHandle`-derived `messageTypes` hint into SQL to reduce rows fetched.
- Unifying the checkpointers (`postgreSQLCheckpointer` and `sqliteCheckpointer` are
  functionally identical files). Real duplication, but a separate change from this one.
