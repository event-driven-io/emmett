# Unified message consumer base — spec

## Goal

Lift the duplicated Layer-2 consumer logic out of all four event-store consumers into a generic factory in core, and reshape the ESDB and MongoDB Layer-1 sources to fix the race conditions that today live in their `pipeline + Transform + Writable + asyncRetry-with-mutating-options` resubscribe path. The PostgreSQL and SQLite consumers already have the cleanest existing shape; the unification standardises around them, and ESDB/Mongo's race conditions die as a side effect of the reshape.

This spec is grounded in a full read of every file it touches. Line numbers are accurate as of the working tree at the time of writing; path, type signatures, and defaults are quoted from source.

## Inventory (current state, all four providers)

### Core (`@event-driven-io/emmett`)

- [src/packages/emmett/src/consumers/consumers.ts](src/packages/emmett/src/consumers/consumers.ts) — 25 lines. Defines `MessageConsumerOptions<ConsumerMessageType>` (just `consumerId`, `processors`) and `MessageConsumer<ConsumerMessageType>` (`consumerId`, `isRunning`, `processors`, `start()`, `stop()`, `close()`). No implementation today — every provider rolls its own.
- [src/packages/emmett/src/consumers/index.ts](src/packages/emmett/src/consumers/index.ts) — single re-export of `./consumers`.
- [src/packages/emmett/src/processors/processors.ts](src/packages/emmett/src/processors/processors.ts) — defines `MessageProcessor<MessageType, MessageMetadataType, HandlerContext>` ([processors.ts:77-97](src/packages/emmett/src/processors/processors.ts#L77-L97)), `CurrentMessageProcessorPosition = { lastCheckpoint: ProcessorCheckpoint } | 'BEGINNING' | 'END'` ([processors.ts:26-29](src/packages/emmett/src/processors/processors.ts#L26-L29)), `ProcessorCheckpoint = Brand<string, 'ProcessorCheckpoint'>` ([processors.ts:241](src/packages/emmett/src/processors/processors.ts#L241)), and the `bigIntProcessorCheckpoint` / `parseBigIntProcessorCheckpoint` helpers ([processors.ts:243-248](src/packages/emmett/src/processors/processors.ts#L243-L248)).
- [src/packages/emmett/src/utils/retry.ts](src/packages/emmett/src/utils/retry.ts) — `AsyncRetryOptions = retry.Options & { shouldRetryResult?, shouldRetryError? }`, `NoRetries = { retries: 0 }`, `asyncRetry(fn, opts)`. This is the existing primitive the base will reuse for the outer restart loop.

### PostgreSQL — the model implementation

**Layer 2 — consumer.** [src/packages/emmett-postgresql/src/eventStore/consumers/postgreSQLEventStoreConsumer.ts](src/packages/emmett-postgresql/src/eventStore/consumers/postgreSQLEventStoreConsumer.ts) — 331 lines. Holds `isRunning`, `isInitialized`, `processors[]`, `abortController`, `messagePuller`, `pool`. Builds an `eachBatch` closure ([postgreSQLEventStoreConsumer.ts:121-152](src/packages/emmett-postgresql/src/eventStore/consumers/postgreSQLEventStoreConsumer.ts#L121-L152)) that filters active processors, runs `Promise.allSettled(activeProcessors.map(s => s.handle(messagesBatch, { connection: { connectionString, pool } })))`, and returns `{ type: 'STOP' }` only when **every** processor is fulfilled with STOP (or rejected). Note the literal `// TODO: Add here filtering to only pass messages that can be handled by processor` at [postgreSQLEventStoreConsumer.ts:135](src/packages/emmett-postgresql/src/eventStore/consumers/postgreSQLEventStoreConsumer.ts#L135) — `canHandle` filtering isn't done at the consumer level today.

`init()` ([postgreSQLEventStoreConsumer.ts:183-195](src/packages/emmett-postgresql/src/eventStore/consumers/postgreSQLEventStoreConsumer.ts#L183-L195)) loops processors and calls `processor.init(processorContext)` where `processorContext = { execute: pool.execute, connection: { connectionString, pool, client: undefined as never, transaction: undefined as never, messageStore: undefined as never } }`.

`start()` ([postgreSQLEventStoreConsumer.ts:269-323](src/packages/emmett-postgresql/src/eventStore/consumers/postgreSQLEventStoreConsumer.ts#L269-L323)) creates `abortController`, builds the `messagePuller`, awaits `init()`, computes `startFrom = zipPostgreSQLEventStoreMessageBatchPullerStartFrom(await Promise.all(processors.map(o => o.start({ execute, connection }))))`, then `await messagePuller.start({ startFrom })`, then `await stopProcessors()`.

`stop()` ([postgreSQLEventStoreConsumer.ts:168-181](src/packages/emmett-postgresql/src/eventStore/consumers/postgreSQLEventStoreConsumer.ts#L168-L181)): `isRunning = false`, `abortController?.abort()`, `await messagePuller.stop()`, `await start`, then `await stopProcessors()`. Note the deliberate `await start` after abort: **wait for the in-flight loop iteration to drain** before declaring stop.

The consumer also exposes `reactor`, `projector`, `workflowProcessor` factory methods ([postgreSQLEventStoreConsumer.ts:204-268](src/packages/emmett-postgresql/src/eventStore/consumers/postgreSQLEventStoreConsumer.ts#L204-L268)) that build a processor and push it onto the local `processors[]` array. These are provider-specific surface and stay on the wrapper after the refactor.

**Layer 1 — puller.** [src/packages/emmett-postgresql/src/eventStore/consumers/messageBatchProcessing/index.ts](src/packages/emmett-postgresql/src/eventStore/consumers/messageBatchProcessing/index.ts) — 158 lines.

```ts
// messageBatchProcessing/index.ts:51-57
export type PostgreSQLEventStoreMessageBatchPuller = {
  isRunning: boolean;
  start(
    options: PostgreSQLEventStoreMessageBatchPullerStartOptions,
  ): Promise<void>;
  stop(): Promise<void>;
};
```

Constructed with `{ executor, batchSize, eachBatch, pullingFrequencyInMs, stopWhen, signal }`. The polling loop ([messageBatchProcessing/index.ts:73-119](src/packages/emmett-postgresql/src/eventStore/consumers/messageBatchProcessing/index.ts#L73-L119)) decodes `startFrom` to a `bigint` via `parseBigIntProcessorCheckpoint`, then:

```ts
while (isRunning && !signal?.aborted) {
  const { messages, currentGlobalPosition, areMessagesLeft } =
    await readMessagesBatch<MessageType>(executor, readMessagesOptions);
  if (messages.length > 0) {
    const result = await eachBatch(messages);
    if (result && result.type === "STOP") {
      isRunning = false;
      break;
    }
  }
  readMessagesOptions.after = currentGlobalPosition;
  await new Promise((resolve) => setTimeout(resolve, waitTime));
  if (stopWhen?.noMessagesLeft === true && !areMessagesLeft) {
    isRunning = false;
    break;
  }
  if (!areMessagesLeft) waitTime = Math.min(waitTime * 2, 1000);
  else waitTime = pullingFrequencyInMs;
}
```

Defaults: `DefaultPostgreSQLEventStoreProcessorBatchSize = 100`, `DefaultPostgreSQLEventStoreProcessorPullingFrequencyInMs = 50` ([messageBatchProcessing/index.ts:16-17](src/packages/emmett-postgresql/src/eventStore/consumers/messageBatchProcessing/index.ts#L16-L17)).

`zipPostgreSQLEventStoreMessageBatchPullerStartFrom` ([messageBatchProcessing/index.ts:143-157](src/packages/emmett-postgresql/src/eventStore/consumers/messageBatchProcessing/index.ts#L143-L157)) takes an array of `(StartFrom | undefined)`, returns `'BEGINNING'` if any element is `undefined` or `'BEGINNING'`, `'END'` if every element is `'END'`, otherwise the lexicographic minimum of the remaining `{ lastCheckpoint }` entries (string sort works because all checkpoints are normalised BigInt strings — see `parseBigIntProcessorCheckpoint`).

**Public re-exports:** [src/packages/emmett-postgresql/src/eventStore/consumers/index.ts](src/packages/emmett-postgresql/src/eventStore/consumers/index.ts) re-exports `messageBatchProcessing`, `postgreSQLEventStoreConsumer`, `postgreSQLProcessor`, `rebuildPostgreSQLProjections`. Anything currently exported from `messageBatchProcessing` is therefore part of the public surface — including `PostgreSQLEventStoreMessageBatchPuller` and the `zip…` function.

**Tests (behavioural contract).**

- [postgreSQLEventStoreConsumer.int.spec.ts](src/packages/emmett-postgresql/src/eventStore/consumers/postgreSQLEventStoreConsumer.int.spec.ts) — 197 lines, lifecycle (start/stop/close, error on no processors, restart, etc.).
- [postgreSQLEventStoreConsumer.handling.int.spec.ts](src/packages/emmett-postgresql/src/eventStore/consumers/postgreSQLEventStoreConsumer.handling.int.spec.ts) — 486 lines, fan-out semantics, STOP propagation, multi-processor.
- [postgreSQLEventStoreConsumer.projections.int.spec.ts](src/packages/emmett-postgresql/src/eventStore/consumers/postgreSQLEventStoreConsumer.projections.int.spec.ts) — 479 lines.
- [postgreSQLEventStoreConsumer.workflow.int.spec.ts](src/packages/emmett-postgresql/src/eventStore/consumers/postgreSQLEventStoreConsumer.workflow.int.spec.ts) — 482 lines.
- [postgreSQLEventStoreConsumer.inMemory.projections.int.spec.ts](src/packages/emmett-postgresql/src/eventStore/consumers/postgreSQLEventStoreConsumer.inMemory.projections.int.spec.ts) — 500 lines.
- Total PG consumer test surface: **2 144 lines**. All must keep passing unchanged.

### SQLite — structurally identical to PG

**Layer 2 — consumer.** [src/packages/emmett-sqlite/src/eventStore/consumers/sqliteEventStoreConsumer.ts](src/packages/emmett-sqlite/src/eventStore/consumers/sqliteEventStoreConsumer.ts) — 354 lines. Same shape as PG, with one notable difference: the `eachBatch` is wrapped in `pool.withConnection(async (connection) => { ... })` ([sqliteEventStoreConsumer.ts:139-166](src/packages/emmett-sqlite/src/eventStore/consumers/sqliteEventStoreConsumer.ts#L139-L166)), so the per-batch handler context is `{ connection, execute: connection.execute }`, freshly built per batch from the dumbo connection. `init` similarly uses `pool.withConnection` ([sqliteEventStoreConsumer.ts:191-208](src/packages/emmett-sqlite/src/eventStore/consumers/sqliteEventStoreConsumer.ts#L191-L208)).

**Layer 1 — puller.** [src/packages/emmett-sqlite/src/eventStore/consumers/messageBatchProcessing/index.ts](src/packages/emmett-sqlite/src/eventStore/consumers/messageBatchProcessing/index.ts) — 167 lines. Byte-identical to PG's puller mod naming and the addition of a `serialization` option. Same `zipSQLiteEventStoreMessageBatchPullerStartFrom` ([messageBatchProcessing/index.ts:152-166](src/packages/emmett-sqlite/src/eventStore/consumers/messageBatchProcessing/index.ts#L152-L166)) — same algorithm as PG (string-sort BigInt checkpoints).

**Tests:** `sqliteEventStoreConsumer.int.spec.ts` (100 lines), `…handling.int.spec.ts` (560), `…workflow.int.spec.ts` (500). Total **1 160 lines**.

### EventStoreDB — Layer 1 is where the race lives

**Layer 2 — consumer.** [src/packages/emmett-esdb/src/eventStore/consumers/eventStoreDBEventStoreConsumer.ts](src/packages/emmett-esdb/src/eventStore/consumers/eventStoreDBEventStoreConsumer.ts) — 222 lines. Holds `isRunning`, `processors[]`, `currentSubscription`, `client`. Builds `eachBatch` ([eventStoreDBEventStoreConsumer.ts:107-138](src/packages/emmett-esdb/src/eventStore/consumers/eventStoreDBEventStoreConsumer.ts#L107-L138)) — same fan-out shape as PG, with `{ client }` as the handler context, plus rejection-error capture for the STOP path.

The `eventStoreDBSubscription` wrapper is constructed at consumer-construction time, **not inside `start()`** ([eventStoreDBEventStoreConsumer.ts:140-147](src/packages/emmett-esdb/src/eventStore/consumers/eventStoreDBEventStoreConsumer.ts#L140-L147)). This is part of the bug surface — it means the wrapper instance and its inner mutable state survive across `start/stop/start` cycles.

`start()` ([eventStoreDBEventStoreConsumer.ts:197-218](src/packages/emmett-esdb/src/eventStore/consumers/eventStoreDBEventStoreConsumer.ts#L197-L218)) computes `startFrom = zipEventStoreDBEventStoreMessageBatchPullerStartFrom(await Promise.all(processors.map(o => o.start(client))))` and calls `subscription.start({ startFrom })`. Note `processors.map(o => o.start(client))` — ESDB passes `client` directly as the start options, not a context object. The processor type expects `Partial<HandlerContext>`, so `client` must satisfy that — it does because ESDB's `MessageProcessor<…, …, { client }>` is the de-facto context shape.

`stop = close` ([eventStoreDBEventStoreConsumer.ts:219-220](src/packages/emmett-esdb/src/eventStore/consumers/eventStoreDBEventStoreConsumer.ts#L219-L220)) — they're literally the same function. No separate close path. No `init()` either — there's no init step for ESDB processors today.

**Layer 1 — subscription.** [src/packages/emmett-esdb/src/eventStore/consumers/subscriptions/index.ts](src/packages/emmett-esdb/src/eventStore/consumers/subscriptions/index.ts) — 322 lines. **This is where the race conditions live.** Concrete file:line for each:

1. **Closure-captured `options` mutated by the Writable.** [subscriptions/index.ts:208-282](src/packages/emmett-esdb/src/eventStore/consumers/subscriptions/index.ts#L208-L282). `pipeMessages(options)` captures `options`. Inside, `_write` does `options.startFrom = { lastCheckpoint: result }` ([subscriptions/index.ts:241-244](src/packages/emmett-esdb/src/eventStore/consumers/subscriptions/index.ts#L241-L244)). The whole thing is wrapped in `asyncRetry(() => new Promise(...), resubscribeOptions)` — so on retry, the inner Promise factory re-runs and reads the **mutated** `options.startFrom`. Whether the most recent checkpoint write has been observed by the closure depends on Writable timing, not on a happens-before edge. Restart can resume from a stale or partially-applied checkpoint.

2. **Module-scoped `subscription` and `processor` reassigned every retry.** Both declared at [subscriptions/index.ts:183-185](src/packages/emmett-esdb/src/eventStore/consumers/subscriptions/index.ts#L183-L185) (`let processor`, `let subscription`). Reassigned inside `pipeMessages` at [subscriptions/index.ts:222](src/packages/emmett-esdb/src/eventStore/consumers/subscriptions/index.ts#L222) and [subscriptions/index.ts:224](src/packages/emmett-esdb/src/eventStore/consumers/subscriptions/index.ts#L224). `stopSubscription` reads them at [subscriptions/index.ts:198-200](src/packages/emmett-esdb/src/eventStore/consumers/subscriptions/index.ts#L198-L200): `if (processor) processor.isRunning = false; return subscription.unsubscribe()...`. If `consumer.stop()` arrives between the moment `pipeMessages` reassigns `subscription` and `processor` and the moment `pipeline()` is wired, the wrong instance is unsubscribed (or the not-yet-assigned one). This is the central race.

3. **`stopSubscription` called from three concurrent paths.** External `consumer.stop()` → `subscription.stop()` → `stopSubscription()` ([subscriptions/index.ts:300-304](src/packages/emmett-esdb/src/eventStore/consumers/subscriptions/index.ts#L300-L304)). Internal STOP path inside the Writable's `_write` ([subscriptions/index.ts:256](src/packages/emmett-esdb/src/eventStore/consumers/subscriptions/index.ts#L256)). Internal pipeline error callback ([subscriptions/index.ts:265-279](src/packages/emmett-esdb/src/eventStore/consumers/subscriptions/index.ts#L265-L279)). All three touch the same `subscription`/`processor`/`isRunning` state with no coordination — `subscription.unsubscribe()` may be called twice, and `isRunning = false` may flip after a new pipeline has already been wired by a concurrent retry.

4. **`shouldRetryError` reads live `isRunning`.** [subscriptions/index.ts:190-194](src/packages/emmett-esdb/src/eventStore/consumers/subscriptions/index.ts#L190-L194). The closure default reads `isRunning` from the outer scope — which is mutated by `stopSubscription`. Whether a retry actually fires depends on the precise interleaving of stop and retry tick.

5. **`SubscriptionSequentialHandler._transform` calls `eachBatch([singleMessage])`** ([subscriptions/index.ts:151](src/packages/emmett-esdb/src/eventStore/consumers/subscriptions/index.ts#L151)). Every event is delivered as a one-element batch. Documented in the qa.md A4 thread; not technically a race, but it's the reason ESDB throughput trails PG and the reason any per-batch-optimised processor is starved here. The new shape will let the source factory yield genuine batches (or at least bigger ones, as soon as the change-stream / subscription provides an obvious grouping).

`zipEventStoreDBEventStoreMessageBatchPullerStartFrom` ([subscriptions/index.ts:308-322](src/packages/emmett-esdb/src/eventStore/consumers/subscriptions/index.ts#L308-L322)) — algorithmically identical to PG/SQLite's zip (string-sort over BigInt checkpoints).

`EventStoreDBResubscribeDefaultOptions` ([subscriptions/index.ts:112-117](src/packages/emmett-esdb/src/eventStore/consumers/subscriptions/index.ts#L112-L117)): `{ forever: true, minTimeout: 100, factor: 1.5, shouldRetryError: (e) => !isDatabaseUnavailableError(e) }`. This is the existing outer-restart shape — already an `AsyncRetryOptions`. The base will accept this as the `restartPolicy`.

**Tests:** `eventStoreDBEventStoreConsumer.int.spec.ts` (153), `…handling.int.spec.ts` (770), `…inMemory.projections.int.spec.ts` (494). Total **1 417 lines**. New regression tests for the race (see step 4 below) ship alongside the reshape PR.

### MongoDB — same race shape as ESDB

**Layer 2 — consumer.** [src/packages/emmett-mongodb/src/eventStore/consumers/mongoDBEventStoreConsumer.ts](src/packages/emmett-mongodb/src/eventStore/consumers/mongoDBEventStoreConsumer.ts) — 231 lines. Same shape as ESDB. One difference from ESDB: the `mongoDBSubscription` wrapper is built **inside `start()`** ([mongoDBEventStoreConsumer.ts:209-217](src/packages/emmett-mongodb/src/eventStore/consumers/mongoDBEventStoreConsumer.ts#L209-L217)) rather than at consumer construction. Doesn't help with the race — the internal mutable state still lives in the wrapper closure.

`stop()` ([mongoDBEventStoreConsumer.ts:145-151](src/packages/emmett-mongodb/src/eventStore/consumers/mongoDBEventStoreConsumer.ts#L145-L151)): `if (stream?.isRunning === true) await stream.stop(); isRunning = false`. **No `await start`** — Mongo doesn't drain the in-flight loop on stop. PG does; ESDB does (via `await start` inside `stop`). Mongo is the outlier. Behavioural difference to flag for the migration: lifting the base behaviour from PG will give Mongo drain-on-stop, which is a small behaviour improvement, not a regression.

`close()` ([mongoDBEventStoreConsumer.ts:223-229](src/packages/emmett-mongodb/src/eventStore/consumers/mongoDBEventStoreConsumer.ts#L223-L229)): `try { await stop(); } finally { if (!options.client) await client.close(); }` — only closes the client if Mongo created it (vs the user passing one in).

**Layer 1 — subscription.** [src/packages/emmett-mongodb/src/eventStore/consumers/subscriptions/index.ts](src/packages/emmett-mongodb/src/eventStore/consumers/subscriptions/index.ts) — 514 lines. Same race-condition pattern as ESDB:

1. **Closure-captured `options` mutated by the Writable.** `_write` mutates `options.startFrom = { lastCheckpoint: result }` at [subscriptions/index.ts:437-441](src/packages/emmett-mongodb/src/eventStore/consumers/subscriptions/index.ts#L437-L441). Wrapped in `asyncRetry` at [subscriptions/index.ts:397](src/packages/emmett-mongodb/src/eventStore/consumers/subscriptions/index.ts#L397).

2. **Module-scoped `subscription` and `processor`.** Declared at [subscriptions/index.ts:352-354](src/packages/emmett-mongodb/src/eventStore/consumers/subscriptions/index.ts#L352-L354), reassigned per retry at [subscriptions/index.ts:415-426](src/packages/emmett-mongodb/src/eventStore/consumers/subscriptions/index.ts#L415-L426).

3. **`stopSubscription` called from three concurrent paths.** External `consumer.stop()` → `stream.stop()` → `stopSubscription()` ([subscriptions/index.ts:504-508](src/packages/emmett-mongodb/src/eventStore/consumers/subscriptions/index.ts#L504-L508)). Internal `_write` STOP path ([subscriptions/index.ts:452](src/packages/emmett-mongodb/src/eventStore/consumers/subscriptions/index.ts#L452)). Internal pipeline error callback ([subscriptions/index.ts:461-484](src/packages/emmett-mongodb/src/eventStore/consumers/subscriptions/index.ts#L461-L484)). The Mongo version additionally swallows the `'ChangeStream is closed' / MongoAPIError` case as a clean stop ([subscriptions/index.ts:470-477](src/packages/emmett-mongodb/src/eventStore/consumers/subscriptions/index.ts#L470-L477)) — meaning today's error path is partly the bug, partly the workaround for the bug.

4. **Per-message delivery.** `_transform` calls `eachBatch(messages)` where `messages` is the change-event's `messages` array — actually a real batch ([subscriptions/index.ts:178-195](src/packages/emmett-mongodb/src/eventStore/consumers/subscriptions/index.ts#L178-L195)). So unlike ESDB, Mongo already delivers true batches. Good — one less thing to migrate.

`zipMongoDBMessageBatchPullerStartFrom` ([mongoDBCheckpoint.ts:129-152](src/packages/emmett-mongodb/src/eventStore/consumers/subscriptions/mongoDBCheckpoint.ts#L129-L152)) — **the only zip that is genuinely different from PG/SQLite/ESDB**. Mongo resume tokens are hex buffers, not normalised BigInt strings, so the comparator is `compareTwoMongoDBCheckpoints` ([mongoDBCheckpoint.ts:88-103](src/packages/emmett-mongodb/src/eventStore/consumers/subscriptions/mongoDBCheckpoint.ts#L88-L103)) which decodes both checkpoints and compares the resume-token hex buffers, then the in-stream position. **Consequence for the spec: `zipStartFrom` cannot be a single function in core. The base must accept it from each source factory.**

**Tests:** `mongoDBEventStoreConsumer.int.spec.ts` (185), `…handling.int.spec.ts` (654), `…inMemory.projections.int.spec.ts` (535), `mongoDBEventStore.subscription.e2e.spec.ts` (247), `zipMongoDBMessageBatchPullerStartFrom.unit.spec.ts` (small unit covering the checkpoint comparator). Total **1 621+ lines**.

## Layer split after the refactor

**Layer 1 — message source** (per provider). Knows the SDK, the wire format, the cursor / resume token, the polling or subscription mechanics, the inner transient-error retry. Owns when to end the stream. Has zero awareness of processors.

**Layer 2 — message consumer** (single generic factory in core). Knows the lifecycle (`start`/`stop`/`close`), processor fan-out, computing `startFrom` from processor checkpoints, abort plumbing, the outer restart loop on non-transient errors. Knows nothing about any provider SDK.

What is duplicated across all four consumers today is Layer 2. After the refactor it lives in core exactly once. Each provider keeps a thin wrapper plus a dedicated source factory.

## Source factory contract (new code in core)

```ts
// new file: src/packages/emmett/src/consumers/messageSource.ts
import type {
  AnyReadEventMetadata,
  AnyMessage,
  RecordedMessage,
} from "../typing";
import type { CurrentMessageProcessorPosition } from "../processors";

export type MessageSourceFactory<
  MessageType extends AnyMessage,
  MessageMetadataType extends AnyReadEventMetadata,
> = {
  start: (options: {
    startFrom: CurrentMessageProcessorPosition;
    signal: AbortSignal;
  }) => AsyncGenerator<RecordedMessage<MessageType, MessageMetadataType>[]>;

  zipStartFrom: (
    positions: (CurrentMessageProcessorPosition | undefined)[],
  ) => CurrentMessageProcessorPosition;
};
```

Why this exact shape:

- **Factory, not a pre-built generator instance.** The base re-calls `start` on every restart with a freshly-recomputed `startFrom`. Each call gets its own closure — no shared mutable state across reconnects. **This is what kills the ESDB/Mongo race conditions:** there is no `pipeMessages` outer scope holding `subscription` and `processor` variables across retries, because each call to `start` creates the generator and its locals from scratch.
- **`startFrom: CurrentMessageProcessorPosition`** is the existing core type from [processors.ts:26-29](src/packages/emmett/src/processors/processors.ts#L26-L29). All four providers already accept structurally compatible shapes today; Mongo's subscription already takes exactly this type ([subscriptions/index.ts:77](src/packages/emmett-mongodb/src/eventStore/consumers/subscriptions/index.ts#L77)). Each source's `start` decodes it: PG/SQLite via `parseBigIntProcessorCheckpoint` to a `bigint`, ESDB via `parseBigIntProcessorCheckpoint` to commit/prepare positions, Mongo via `toMongoDBResumeToken`.
- **`signal: AbortSignal`** is created by the base via `AbortController`, threaded into `start`, and aborted on `consumer.stop()`. Never appears on a public API. Same internal contract as today's PG puller.
- **Each yield is `RecordedMessage<M, Meta>[]`** — the same shape that today's PG `eachBatch` callback receives. PG/SQLite yield real batches as before, Mongo yields the change-event's `messages` array (already a real batch), ESDB yields whatever grouping the SDK provides (likely 1-message arrays at first; revisiting batch grouping is out of scope for this PR series).
- **The source `return`s when done.** PG/SQLite return when `stopWhen.noMessagesLeft === true && !areMessagesLeft`. ESDB/Mongo return when their subscription naturally terminates. The base's `for await` ends naturally; no separate "I'm done" channel.
- **Control messages** (e.g. an end-of-log marker for metrics) flow inline as discriminated entries in the same array — settled in qa.md A8. The exact discriminator (`type` field, base-side filtering, processor visibility) is pinned at implementation time of step 1 below, not here.
- **`zipStartFrom`** lives on the source factory because Mongo's algorithm is genuinely different from PG/SQLite/ESDB (see [mongoDBCheckpoint.ts:129-152](src/packages/emmett-mongodb/src/eventStore/consumers/subscriptions/mongoDBCheckpoint.ts#L129-L152) versus the string-sort PG/SQLite/ESDB use). PG, SQLite, and ESDB will all import the same default helper from core; Mongo passes its own.

```ts
// new file: src/packages/emmett/src/consumers/messageSource.ts (continued)
export const defaultZipStartFrom = (
  positions: (CurrentMessageProcessorPosition | undefined)[],
): CurrentMessageProcessorPosition => {
  if (
    positions.length === 0 ||
    positions.some((o) => o === undefined || o === "BEGINNING")
  )
    return "BEGINNING";

  if (positions.every((o) => o === "END")) return "END";

  return positions
    .filter((o) => o !== undefined && o !== "BEGINNING" && o !== "END")
    .sort((a, b) => (a > b ? 1 : -1))[0]!;
};
```

This is byte-for-byte the existing PG/SQLite/ESDB algorithm, lifted into one place.

### What sources are responsible for

- Own batch size, own cursor / resume token, own polling frequency or subscription wiring.
- **Inner transient retry**: wrap SDK calls in retry for connection blips and provider-specific transient errors. Provider-SDK-specific error classification stays here. The base never sees transient errors. ESDB's `EventStoreDBResubscribeDefaultOptions` and Mongo's `MongoDBResubscribeDefaultOptions` are existing callable shapes the new sources can keep using internally.
- Decide when to end the stream (`return` from the generator).
- Honour `signal` — when aborted, drop in-flight work and return promptly.

### What sources don't do

- Don't know about processors.
- Don't know about handler context.
- Don't manage their own outer restart on non-transient failure — that's the base's job.
- Don't manage `start/stop/close` lifecycle — they're called by the base via `for await`.

## Base consumer (new code in core)

```ts
// updated file: src/packages/emmett/src/consumers/consumers.ts
import type { Message, AnyReadEventMetadata, DefaultRecord } from "../typing";
import type { MessageProcessor } from "../processors";
import type { AsyncRetryOptions } from "../utils/retry";
import type { MessageSourceFactory } from "./messageSource";

// existing exports (MessageConsumerOptions, MessageConsumer) stay as-is

export type CreateMessageConsumerOptions<
  MessageType extends Message,
  MessageMetadataType extends AnyReadEventMetadata,
  HandlerContext extends DefaultRecord | undefined = undefined,
> = {
  consumerId?: string;
  processors: MessageProcessor<
    MessageType,
    MessageMetadataType,
    HandlerContext
  >[];
  source: MessageSourceFactory<MessageType, MessageMetadataType>;
  handlerContext?: Partial<HandlerContext>;
  restartPolicy?: AsyncRetryOptions;
};

export const createMessageConsumer = <
  MessageType extends Message,
  MessageMetadataType extends AnyReadEventMetadata,
  HandlerContext extends DefaultRecord | undefined = undefined,
>(
  options: CreateMessageConsumerOptions<
    MessageType,
    MessageMetadataType,
    HandlerContext
  >,
): MessageConsumer<MessageType> => {
  /* implementation — see lifecycle below */
};
```

### Lifecycle (lifted from PG, mod the source-factory contract)

The base re-implements PG's existing lifecycle dance verbatim, with the only differences being (a) it consumes an `AsyncGenerator` instead of calling an `eachBatch` callback, and (b) it wraps the run loop in `asyncRetry`.

1. **`start()`** ([postgreSQLEventStoreConsumer.ts:269-323](src/packages/emmett-postgresql/src/eventStore/consumers/postgreSQLEventStoreConsumer.ts#L269-L323) is the model)
   - Guard re-entry: if already running, return the existing start promise.
   - Guard empty processors: throw `EmmettError('Cannot start consumer without at least a single processor')` — same wording PG uses today at [postgreSQLEventStoreConsumer.ts:273-275](src/packages/emmett-postgresql/src/eventStore/consumers/postgreSQLEventStoreConsumer.ts#L273-L275).
   - `isRunning = true`. Create `abortController = new AbortController()`.
   - Run `init()` once (idempotent flag): for every processor, call `processor.init(handlerContext ?? {})`. Same loop PG runs at [postgreSQLEventStoreConsumer.ts:183-195](src/packages/emmett-postgresql/src/eventStore/consumers/postgreSQLEventStoreConsumer.ts#L183-L195).
   - Start the run loop (see below) and store the resulting promise in `start`.
   - Return `start`.

2. **Run loop** — wraps the inner loop in `asyncRetry(restartPolicy)`. Default policy: auto-restart with exponential backoff, defaults pinned at implementation time of step 1 (deferred per qa.md A10). Users may override with any `AsyncRetryOptions`, including `NoRetries` to bring back PG's existing bubble-up.

   ```ts
   const run = () =>
     asyncRetry(async () => {
       while (isRunning) {
         const startFrom = source.zipStartFrom(
           await Promise.all(
             processors.map((p) => p.start(handlerContext ?? {})),
           ),
         );
         const generator = source.start({
           startFrom,
           signal: abortController.signal,
         });
         try {
           for await (const messages of generator) {
             if (!isRunning) break;
             const result = await fanOut(processors, messages, handlerContext);
             if (result?.type === "STOP") return; // exits the asyncRetry too
           }
           return; // generator completed naturally — done
         } finally {
           await generator.return?.(undefined).catch(() => {});
         }
       }
     }, restartPolicy);
   ```

   The exact reconciliation of `for await` exit, fatal errors, and `asyncRetry`'s retry loop is an implementation detail of step 1; the contract is "on a non-transient throw, recompute `startFrom` from processor checkpoints (which advanced with each successful `fanOut`) and call `source.start` again with a fresh closure".

3. **`fanOut`** — lifted verbatim from [postgreSQLEventStoreConsumer.ts:121-152](src/packages/emmett-postgresql/src/eventStore/consumers/postgreSQLEventStoreConsumer.ts#L121-L152):

   ```ts
   const fanOut = async (processors, messages, handlerContext) => {
     const activeProcessors = processors.filter((s) => s.isActive);
     if (activeProcessors.length === 0)
       return { type: "STOP", reason: "No active processors" };

     const result = await Promise.allSettled(
       activeProcessors.map((s) => s.handle(messages, handlerContext ?? {})),
     );

     return result.some(
       (r) => r.status === "fulfilled" && r.value?.type !== "STOP",
     )
       ? undefined
       : { type: "STOP" };
   };
   ```

   Behavioural parity with PG: STOP only when **all active processors** return STOP (or reject). Rejected promises are absorbed by `Promise.allSettled` — same as today. **Out of scope for this refactor**: changing this semantic. ESDB and Mongo today additionally pluck the first rejection's error into `EmmettError.mapFrom(error)` ([eventStoreDBEventStoreConsumer.ts:126-137](src/packages/emmett-esdb/src/eventStore/consumers/eventStoreDBEventStoreConsumer.ts#L126-L137), [mongoDBEventStoreConsumer.ts:131-142](src/packages/emmett-mongodb/src/eventStore/consumers/mongoDBEventStoreConsumer.ts#L131-L142)) — the base will preserve this behaviour as a small enhancement, since it's strictly additive (today's PG behaviour also keeps STOP-when-all-stop, just without the error capture, so PG's existing tests stay green).

4. **`stop()`** — model is [postgreSQLEventStoreConsumer.ts:168-181](src/packages/emmett-postgresql/src/eventStore/consumers/postgreSQLEventStoreConsumer.ts#L168-L181):
   - If not running, return.
   - `isRunning = false`.
   - `abortController?.abort()` — the source's `signal` flips, the source generator returns or throws on its next iteration, the `for await` ends.
   - `await start` — wait for the in-flight loop to drain (graceful shutdown). Mongo today **doesn't** do this; lifting PG's behaviour gives Mongo drain-on-stop, which is a small behaviour improvement, not a regression.
   - Run `processor.close(handlerContext ?? {})` for every processor.

5. **`close()`** — call `stop()`. Provider wrappers add resource teardown after delegating: PG/SQLite close the dumbo pool, Mongo closes the client if it owned it.

### Handler context — opaque, threaded through unchanged

Per qa.md A14, the base parameterises on `HandlerContext extends DefaultRecord | undefined = undefined`, accepts a `handlerContext: Partial<HandlerContext>` value, and threads it into `processor.init`, `processor.start`, `processor.handle`, `processor.close` exactly the way PG does today. The base never inspects it. Whatever PG/ESDB/Mongo do today carries over unchanged.

For SQLite, where the per-batch context wraps a fresh dumbo connection, the wrapper builds a thin source factory that internally calls `pool.withConnection(...)` and dispatches via the base — see the SQLite migration step below for the concrete shape.

### Restart policy

- Reuses `AsyncRetryOptions` from [src/packages/emmett/src/utils/retry.ts](src/packages/emmett/src/utils/retry.ts).
- Default: auto-restart with exponential backoff. Concrete numbers picked at implementation time of step 1 (per qa.md A10).
- Users can pass `NoRetries` to bring back PG's existing bubble-up, `shouldRetryError` to exclude specific fatal errors, or a hard cap.
- **Inner transient retry stays inside the source.** The base only standardises the outer restart policy. Provider SDKs need provider-specific error classification, which has no business in core. ESDB's `isDatabaseUnavailableError` ([subscriptions/index.ts:105-110](src/packages/emmett-esdb/src/eventStore/consumers/subscriptions/index.ts#L105-L110)) and Mongo's `isDatabaseUnavailableError` ([subscriptions/index.ts:217-228](src/packages/emmett-mongodb/src/eventStore/consumers/subscriptions/index.ts#L217-L228)) stay where they are.

## Provider wrappers — before / after per file

### PostgreSQL

**Before — [postgreSQLEventStoreConsumer.ts](src/packages/emmett-postgresql/src/eventStore/consumers/postgreSQLEventStoreConsumer.ts) (331 lines)**

Holds `isRunning`, `isInitialized`, `abortController`, `messagePuller`, builds the `eachBatch` closure, runs `start`/`stop`/`close`/`init` lifecycle, calls `zipPostgreSQLEventStoreMessageBatchPullerStartFrom` over processors. Plus the `reactor`/`projector`/`workflowProcessor` factory methods.

**After**

Becomes a thin wrapper. All lifecycle and fan-out delegated to `createMessageConsumer`. Estimated ~80–110 lines.

```ts
export const postgreSQLEventStoreConsumer = <
  ConsumerMessageType extends Message = AnyMessage,
>(
  options: PostgreSQLEventStoreConsumerOptions<ConsumerMessageType>,
): PostgreSQLEventStoreConsumer<ConsumerMessageType> => {
  const processors = options.processors ?? [];
  const pool =
    options.pool ??
    dumbo({
      connectionString: options.connectionString,
      serialization: options.serialization,
    });

  const source = postgreSQLEventStoreMessageSourceFactory<ConsumerMessageType>({
    executor: pool.execute,
    batchSize:
      options.pulling?.batchSize ??
      DefaultPostgreSQLEventStoreProcessorBatchSize,
    pullingFrequencyInMs:
      options.pulling?.pullingFrequencyInMs ??
      DefaultPostgreSQLEventStoreProcessorPullingFrequencyInMs,
    stopWhen: options.stopWhen,
  });

  const handlerContext: Partial<PostgreSQLProcessorHandlerContext> = {
    execute: pool.execute,
    connection: {
      connectionString: options.connectionString,
      pool,
      client: undefined as never,
      transaction: undefined as never,
      messageStore: undefined as never,
    },
  };

  const base = createMessageConsumer({
    consumerId: options.consumerId,
    processors,
    source,
    handlerContext,
    // restartPolicy: defaulted in base — PG had no outer retry today, so this is a strict enhancement
  });

  return {
    ...base,
    reactor: (opts) => {
      const p = postgreSQLReactor(opts);
      processors.push(p as any);
      return p;
    },
    projector: (opts) => {
      const p = postgreSQLProjector(opts);
      processors.push(p as any);
      return p;
    },
    workflowProcessor: (opts) => {
      const p = postgreSQLWorkflowProcessor(opts);
      processors.push(p as any);
      return p;
    },
    close: async () => {
      await base.close();
      await pool.close();
    },
  };
};
```

The reactor/projector/workflowProcessor methods stay (they're public surface and tests call them). The `close` is wrapped to add `pool.close()` after the base's `close()`. The handler-context shape is identical to today's `processorContext` at [postgreSQLEventStoreConsumer.ts:154-163](src/packages/emmett-postgresql/src/eventStore/consumers/postgreSQLEventStoreConsumer.ts#L154-L163).

**Before — [messageBatchProcessing/index.ts](src/packages/emmett-postgresql/src/eventStore/consumers/messageBatchProcessing/index.ts) (158 lines)**

Defines `PostgreSQLEventStoreMessageBatchPuller`, `postgreSQLEventStoreMessageBatchPuller(...)`, `zipPostgreSQLEventStoreMessageBatchPullerStartFrom(...)`, plus `DefaultPostgreSQLEventStoreProcessorBatchSize` and `DefaultPostgreSQLEventStoreProcessorPullingFrequencyInMs`.

**After**

Renamed to `messageSource/postgreSQLEventStoreMessageSourceFactory.ts` (or kept under `messageBatchProcessing/` to keep `git log --follow` happy — I'll pick at implementation time). The `PostgreSQLEventStoreMessageBatchPuller` type goes away — the base owns lifecycle now, so a named puller type is dead weight. The polling-loop body moves into the async generator function:

```ts
export const postgreSQLEventStoreMessageSourceFactory = <
  MessageType extends Message = Message,
>(config: {
  executor: SQLExecutor;
  batchSize: number;
  pullingFrequencyInMs: number;
  stopWhen?: { noMessagesLeft?: boolean };
}): MessageSourceFactory<MessageType, ReadEventMetadataWithGlobalPosition> => ({
  start: async function* ({ startFrom, signal }) {
    let after =
      startFrom === "BEGINNING"
        ? 0n
        : startFrom === "END"
          ? ((await readLastMessageGlobalPosition(config.executor))
              .currentGlobalPosition ?? 0n)
          : parseBigIntProcessorCheckpoint(startFrom.lastCheckpoint);

    let waitTime = 100;

    while (!signal.aborted) {
      const { messages, currentGlobalPosition, areMessagesLeft } =
        await readMessagesBatch<MessageType>(config.executor, {
          after,
          batchSize: config.batchSize,
        });

      if (messages.length > 0) yield messages;

      after = currentGlobalPosition;

      if (config.stopWhen?.noMessagesLeft === true && !areMessagesLeft) return;

      await new Promise((resolve) => setTimeout(resolve, waitTime));

      waitTime = areMessagesLeft
        ? config.pullingFrequencyInMs
        : Math.min(waitTime * 2, 1000);
    }
  },

  zipStartFrom: defaultZipStartFrom,
});
```

This is mechanically what `pullMessages` does today at [messageBatchProcessing/index.ts:73-119](src/packages/emmett-postgresql/src/eventStore/consumers/messageBatchProcessing/index.ts#L73-L119). The two semantic changes:

1. The `if (result.type === 'STOP') break` branch goes away — STOP from `eachBatch` is now STOP from the base's `fanOut`, which exits the base's outer loop. The source generator doesn't see STOP at all; its only termination paths are `signal.aborted`, `stopWhen.noMessagesLeft`, or thrown.
2. The "internal `isRunning` flag" goes away — the source uses `signal.aborted` exclusively. PG today reads both `isRunning` (its puller's local flag) and `signal?.aborted`; lifting the loop into a generator collapses this to one signal.

**Public surface:**

- `postgreSQLEventStoreConsumer` — name and options shape stay.
- `PostgreSQLEventStoreConsumerOptions`, `PostgreSQLEventStoreConsumerConfig`, `PostgreSQLEventStoreConsumer` — stay.
- `DefaultPostgreSQLEventStoreProcessorBatchSize`, `DefaultPostgreSQLEventStoreProcessorPullingFrequencyInMs` — stay (still consumed by users and tests).
- `PostgreSQLEventStoreMessageBatchPuller` (the puller type), `postgreSQLEventStoreMessageBatchPuller` (the puller factory), `zipPostgreSQLEventStoreMessageBatchPullerStartFrom` — **internal renames are allowed** per qa.md A13. Greppable usages outside the consumer file: I'll grep before merging step 2 and rename in lockstep, or keep deprecated re-exports if there's any external dependency. Since the index.ts re-exports `messageBatchProcessing` wholesale, I'll explicitly check downstream usage in the monorepo before deciding.
- New optional consumer option: `restartPolicy?: AsyncRetryOptions`. Additive, default applies if absent.

### SQLite

Same shape as PG with one wrinkle — the per-batch handler context wraps a fresh dumbo connection. Two ways to handle this and they're both clean:

**Option A — wrap the source factory.** The SQLite source factory grabs a connection per yielded batch, builds the per-batch handler context, and hands the batch to the base. But the base only knows about a single `handlerContext` value, not a per-batch builder, so this needs the base to call back into the source for context. Couples the base to a non-PG concept and breaks the "opaque context" rule. Reject.

**Option B — let the SQLite processors handle their own connection acquisition.** The base passes a connection-less `handlerContext = { execute: undefined, connection: undefined }` (matching the existing `processorContext` shape at [sqliteEventStoreConsumer.ts:168-171](src/packages/emmett-sqlite/src/eventStore/consumers/sqliteEventStoreConsumer.ts#L168-L171)). The SQLite processor's `handle` does its own `pool.withConnection(...)` internally. **This is the smaller change** but it touches `sqliteProcessor.ts`.

**Option C — push the per-batch `withConnection` into the SQLite wrapper's source factory.** The wrapper provides a source factory whose `start` does `for await (const messages of innerSource.start(...)) { yield messages }`, and the wrapper additionally provides a `processingScope` that builds the per-batch context. But there's no `processingScope` slot on the base today.

**Decision:** Option B. The SQLite processor already knows about the pool (it's the same pool the consumer constructs); the cleanest fix is for the SQLite processor to acquire its own per-handler connection when called, mirroring how `init` already does it. This is a one-line change inside `sqliteProcessor.ts`. The exact shape is decided in step 3 (SQLite migration), grounded by reading [sqliteProcessor.ts](src/packages/emmett-sqlite/src/eventStore/consumers/sqliteProcessor.ts) before that step lands. **Flagging as the highest-risk part of the SQLite migration** — if Option B turns out to break a test or violate an invariant in `sqliteProcessor.ts`, fall back to extending the base with a `processingScope` slot. I will not commit to one without reading sqliteProcessor end-to-end first; the spec will be amended in-line in step 3 if Option B doesn't fit.

Everything else (Layer 1 polling loop → async generator, `messageBatchProcessing/index.ts` → `messageSource/sqliteEventStoreMessageSourceFactory.ts`, options shape, defaults) is mechanical and identical to PG.

**Public surface stays:** `sqliteEventStoreConsumer`, `SQLiteEventStoreConsumerOptions`, `SQLiteEventStoreConsumerConfig`, `SQLiteEventStoreConsumer`, `DefaultSQLiteEventStoreProcessorBatchSize`, `DefaultSQLiteEventStoreProcessorPullingFrequencyInMs`. Internal renames per the same rule as PG.

### EventStoreDB — the reshape that kills the race

**Before — [eventStoreDBEventStoreConsumer.ts](src/packages/emmett-esdb/src/eventStore/consumers/eventStoreDBEventStoreConsumer.ts) (222 lines)**

Holds `isRunning`, `processors[]`, `currentSubscription`, builds `eachBatch`, constructs `eventStoreDBSubscription` at consumer-construction time, calls `subscription.start({ startFrom })`. `stop = close` are the same function.

**After**

Same wrapper shape as PG — builds the source factory inside the wrapper, hands it to `createMessageConsumer`, exposes the same `reactor`/`projector` factories (in-memory processors today; that doesn't change). Estimated ~80 lines.

```ts
export const eventStoreDBEventStoreConsumer = <
  ConsumerMessageType extends Message = AnyMessage,
>(
  options: EventStoreDBEventStoreConsumerOptions<ConsumerMessageType>,
): EventStoreDBEventStoreConsumer<ConsumerMessageType> => {
  const client =
    "client" in options && options.client
      ? options.client
      : EventStoreDBClient.connectionString(options.connectionString);

  const processors = options.processors ?? [];

  const source = eventStoreDBMessageSourceFactory<ConsumerMessageType>({
    client,
    from: options.from,
    batchSize:
      options.pulling?.batchSize ??
      DefaultEventStoreDBEventStoreProcessorBatchSize,
    transientRetry:
      options.resilience?.resubscribeOptions ??
      EventStoreDBResubscribeDefaultOptions,
  });

  const base = createMessageConsumer({
    consumerId: options.consumerId,
    processors,
    source,
    handlerContext: { client },
    restartPolicy: options.resilience?.resubscribeOptions, // user-provided; default in base
  });

  return {
    ...base,
    reactor: (opts) => {
      const p = inMemoryReactor(opts);
      processors.push(p as any);
      return p;
    },
    projector: (opts) => {
      const p = inMemoryProjector(opts);
      processors.push(p as any);
      return p;
    },
  };
};
```

Note that `stop = close` collapses into the base's lifecycle (which has both methods, identical for ESDB since there's no extra resource to release — the EventStoreDB client is reused across `start/stop/start` cycles when the user provides one).

**Before — [subscriptions/index.ts](src/packages/emmett-esdb/src/eventStore/consumers/subscriptions/index.ts) (322 lines)**

`eventStoreDBSubscription`, `SubscriptionSequentialHandler` (Transform), the inline-Writable, `pipeline(subscription, processor, handler, ...)`, `pipeMessages(options)` wrapped in `asyncRetry`, `stopSubscription`. 322 lines, every one of them part of the bug.

**After**

Replaced by `eventStoreDBMessageSourceFactory` — an async generator that wraps the ESDB SDK's subscription. No `pipeline`, no `Transform`, no `Writable`, no `asyncRetry` (the outer retry moves to the base; the inner transient retry stays here as `transientRetry`). No more `pipeMessages` outer scope. No more `let processor` / `let subscription` declared at the closure level — they're locals inside the generator function, so each call to `start` gets fresh ones. **The race conditions die because the structural pattern that enabled them is gone.**

Sketch of the new shape (exact ESDB SDK calls verified at implementation time of step 4):

```ts
export const eventStoreDBMessageSourceFactory = <
  MessageType extends Message = Message,
>(config: {
  client: EventStoreDBClient;
  from?: EventStoreDBEventStoreConsumerType;
  batchSize: number;
  transientRetry: AsyncRetryOptions;
}): MessageSourceFactory<MessageType, EventStoreDBReadEventMetadata> => ({
  start: async function* ({ startFrom, signal }) {
    const subscription = await asyncRetry(
      () =>
        Promise.resolve(subscribe(config.client, config.from, { startFrom })),
      config.transientRetry,
    );

    try {
      for await (const resolvedEvent of subscription) {
        if (signal.aborted) return;
        if (!resolvedEvent.event) continue;
        const message = mapFromESDBEvent(resolvedEvent, config.from);
        yield [message]; // ESDB delivers one event at a time today; revisit grouping in a follow-up
      }
    } finally {
      await subscription.unsubscribe().catch(() => {});
      try {
        subscription.destroy();
      } catch {
        /* idempotent */
      }
    }
  },

  zipStartFrom: defaultZipStartFrom,
});
```

The for-await over the subscription replaces `pipeline + Transform + Writable`. The `try/finally` replaces the three concurrent paths into `stopSubscription`. The `asyncRetry` around the initial subscribe replaces the inner-retry portion of today's `pipeMessages` (transient connect failure → retry). The outer restart on a non-transient throw is the base's job, called via `source.start` afresh — and _that_ call gets a fresh `subscription` local with no shared state.

**Behavioural notes for the migration:**

- The inline `_write` mutation of `options.startFrom` is gone. The base instead recomputes `startFrom` from processor checkpoints on every restart, exactly like PG does today.
- One-message yields are preserved (`yield [message]`) — qa.md A4/A8 settled that real batch-grouping for push sources is a follow-up, not part of this refactor. `_transform`'s singleton-batch behaviour at [subscriptions/index.ts:151](src/packages/emmett-esdb/src/eventStore/consumers/subscriptions/index.ts#L151) is preserved.
- Whether `subscription` (the SDK return value) is itself an `AsyncIterable<ResolvedEvent>` is verified by reading `@eventstore/db-client`'s type at implementation time. If it isn't, the source uses an internal `Promise<ResolvedEvent>` queue with `subscription.on('data', ...)` plumbing, still confined to the generator's local scope.

**Race-condition regression test (ships with step 4):** explicit test that triggers `consumer.stop()` between an in-flight retry's catch and the next subscribe call, verifies no stale `subscription` is unsubscribed and no orphan event is dispatched. Concrete name and assertions designed during step 4 implementation. Blocks the step-4 PR.

**Public surface stays:** `eventStoreDBEventStoreConsumer`, `EventStoreDBEventStoreConsumerOptions`, `EventStoreDBEventStoreConsumerConfig`, `EventStoreDBEventStoreConsumer`, `EventStoreDBEventStoreConsumerType`, `$all`, `DefaultEventStoreDBEventStoreProcessorBatchSize`. The `EventStoreDBSubscription` type, `eventStoreDBSubscription` factory, `SubscriptionSequentialHandler` class, `EventStoreDBResubscribeDefaultOptions`, `isDatabaseUnavailableError`, `zipEventStoreDBEventStoreMessageBatchPullerStartFrom` — all currently re-exported from the consumers index. Strategy: keep `EventStoreDBResubscribeDefaultOptions` and `isDatabaseUnavailableError` (still useful), drop the rest as internal renames. Grep before merging.

### MongoDB — the same reshape

Structurally identical to ESDB. The same race-fix applies, and the same source-factory shape works. Two Mongo-specific deltas to flag:

1. **`zipStartFrom` is Mongo-specific.** The Mongo source factory passes the existing `zipMongoDBMessageBatchPullerStartFrom` (the algorithm at [mongoDBCheckpoint.ts:129-152](src/packages/emmett-mongodb/src/eventStore/consumers/subscriptions/mongoDBCheckpoint.ts#L129-L152)) as its `zipStartFrom`. Not the default helper. The unit test `zipMongoDBMessageBatchPullerStartFrom.unit.spec.ts` ([zipMongoDBMessageBatchPullerStartFrom.unit.spec.ts](src/packages/emmett-mongodb/src/eventStore/consumers/subscriptions/zipMongoDBMessageBatchPullerStartFrom.unit.spec.ts)) keeps passing unchanged.

2. **Mongo's `stop()` doesn't drain today** ([mongoDBEventStoreConsumer.ts:145-151](src/packages/emmett-mongodb/src/eventStore/consumers/mongoDBEventStoreConsumer.ts#L145-L151)). Lifting PG's drain-on-stop is a small behaviour improvement; ship it as a `BREAKING_CHANGES.md` note (or release-notes line) but no visible API change. The Mongo handling tests must still pass; if any test relies on the no-drain behaviour, that's a test bug to fix in step 5.

3. **Mongo `_transform` already yields real batches** ([subscriptions/index.ts:178-195](src/packages/emmett-mongodb/src/eventStore/consumers/subscriptions/index.ts#L178-L195)) — preserve in the new generator. The change-event's `messages` array is the natural batch; yield it whole.

**Race-condition regression test:** same shape as ESDB's, ships with step 5.

**Public surface stays:** `mongoDBEventStoreConsumer`, `MongoDBConsumerOptions`, `MongoDBEventStoreConsumerConfig`, `MongoDBEventStoreConsumer`, `MongoDBChangeStreamMessageMetadata`. Internal: `mongoDBSubscription`, `MongoDBSubscription`, `SubscriptionSequentialHandler` etc. → renamed/dropped per the same rule.

## Refactor sequence (each step is one independently mergeable PR)

1. **Extract the generic base into core.** Add `messageSource.ts` (the `MessageSourceFactory` type and `defaultZipStartFrom`), update `consumers.ts` to add `createMessageConsumer` plus the lifted `fanOut` helper and the `asyncRetry`-wrapped run loop. Tests against an in-memory fake source factory: cover lifecycle (start/stop/close, double start, stop-during-yield), fan-out (STOP-when-all-stop, rejection absorption), restart policy (default exponential, `NoRetries`, `shouldRetryError`), abort propagation (`signal.aborted` causes the generator to exit promptly), and the `for await` exit on natural source completion. No provider touched yet. Ship with the in-memory test suite covering ≥ the lifecycle assertions PG has today.

2. **Migrate PostgreSQL.** Reshape `messageBatchProcessing/index.ts` → `messageSource/postgreSQLEventStoreMessageSourceFactory.ts` (or rename in place). Replace `postgreSQLEventStoreConsumer.ts` internals with the wrapper sketch above. Existing PG integration tests pass unchanged (~2 144 lines of test surface). Public consumer API stays. The puller-as-named-type goes away; check downstream monorepo usage before deleting.

3. **Migrate SQLite.** Mechanical, modelled on PG. The handler-context-per-batch question (Option B in the SQLite section above) gets resolved by reading `sqliteProcessor.ts` first; if Option B turns out to break a test, fall back to a `processingScope` slot on the base (small additive change to step 1's contract — would require backporting an option, hence the recommendation to read `sqliteProcessor.ts` end-to-end before merging step 2 if possible). Existing SQLite tests pass unchanged (~1 160 lines).

4. **Reshape EventStoreDB.** Replace `subscriptions/index.ts`'s `pipeline + Transform + Writable + asyncRetry-with-mutating-options` with the async-generator factory above. **Race conditions die here** because the new shape doesn't share mutable state across reconnects. Ships with the existing handling tests (~1 417 lines) plus a new regression test for the specific stop-during-retry scenario from race #2.

5. **Reshape MongoDB.** Same surgery on the change-stream subscription, modelled on step 4. Existing handling tests (~1 621 lines) plus a parallel regression test. Ships with the small behaviour note about drain-on-stop.

Each step is its own PR, reviewed in order.

## API stability bar

- User-facing factory names stay: `postgreSQLEventStoreConsumer`, `sqliteEventStoreConsumer`, `eventStoreDBEventStoreConsumer`, `mongoDBEventStoreConsumer`.
- `MessageConsumer<M>` interface in core stays.
- Existing options shapes stay; new options (`restartPolicy`, the source factory slot inside each wrapper) are additive.
- Internal type names change only where the refactor genuinely needs them (per qa.md A13 clarification — no cosmetic renames, every change earns its keep). The puller type names are the obvious example: `PostgreSQLEventStoreMessageBatchPuller` etc. become dead types after step 2 because the base owns lifecycle. Grep downstream usage before deletion.
- Lands in the next minor release.

## Behavioural contract

The existing integration tests for each provider are the behavioural contract for the migration. Each step in the refactor sequence ships with those tests passing unchanged. Total existing test surface for the four consumers: **~6 342 lines**. Steps 4 and 5 additionally ship with regression tests for the ESDB and Mongo race conditions, designed against the concrete `file:line` race scenarios in the inventory above.

## Out of scope

The following are explicit non-goals for this spec. Each is "carry over what the strongest existing implementation does today" and a separate decision for a separate PR if anyone wants to revisit:

- Per-provider real batch grouping for push sources (ESDB still yields one-message arrays). qa.md A4/A8 explicitly deferred this.
- `canHandle` filtering at the consumer level (the literal `// TODO` at [postgreSQLEventStoreConsumer.ts:135](src/packages/emmett-postgresql/src/eventStore/consumers/postgreSQLEventStoreConsumer.ts#L135), [sqliteEventStoreConsumer.ts:151](src/packages/emmett-sqlite/src/eventStore/consumers/sqliteEventStoreConsumer.ts#L151), [eventStoreDBEventStoreConsumer.ts:121](src/packages/emmett-esdb/src/eventStore/consumers/eventStoreDBEventStoreConsumer.ts#L121), [mongoDBEventStoreConsumer.ts:126](src/packages/emmett-mongodb/src/eventStore/consumers/mongoDBEventStoreConsumer.ts#L126)).
- Default retry/backoff numbers — pinned at implementation time of step 1, not in this spec.
- Control-message discriminator details (a `type` field, base filtering, processor visibility) — pinned at implementation time of step 1.
- Per-batch handler context construction (a `processingScope` slot on the base). Only added in step 3 if Option B for SQLite turns out not to fit.
- Per-processor handler context dispatch — qa.md A14 settled this as YAGNI.
- Stop-on-any-slowdown / per-processor queues / explicit throttle signals — qa.md A5 settled the default fan-out as `Promise.allSettled` and deferred everything else.
- Backward-compat re-exports for the dropped puller/subscription types — decided per-provider during the migration step after grepping monorepo usage.
