# Durable Object support in emmett-sqlite — Q&A log

## Q1. What's the intended scope of "durable object support" for emmett-sqlite?

Options offered:

1. **Driver parity with D1** — add `durableObjectEventStoreDriver` alongside `d1EventStoreDriver`: append/read, schema migrations, Pongo projections. No new DO-specific APIs.
2. **Parity + DO-native consumers** — plus alarm-driven processors instead of `setTimeout` polling loops, checkpointing, lifecycle tied to the DO instance.
3. **Parity + full DO ergonomics** — plus a DO base class / factory wiring event store and command handling, `blockConcurrencyWhile` for migration, stream-per-DO conventions.

**A1:** Expand on 2 and 3 before deciding.

### Context gathered before asking

- `src/packages/emmett-sqlite/src/cloudflare.ts` exposes only `d1EventStoreDriver`.
- Dumbo already ships `cloudflareDurableObjectSQLiteDumboDriver` (+ client, connection, pool, transaction, SQL executor) from `@event-driven-io/dumbo/cloudflare`.
- Pongo already ships `cloudflareDurableObjectSQLiteDriver` from `@event-driven-io/pongo/cloudflare`.
- Nothing in the Emmett repo mentions Durable Objects today.

## Q2. How much of the Durable Object lifecycle should Emmett own?

Options offered: co-operative (app drives, Emmett never calls `setAlarm`); Emmett owns the alarm; full ownership (factory/base class wiring store, migration and stream-per-DO).

**A2:** Decisions and one open question.

- **Phase 1 excludes consumers.** Ship driver parity first.
- **Blocking migrations make sense** — run schema migration under `blockConcurrencyWhile`.
- **Global event store is the default.** DO-per-stream is an interesting option, but it should be opt-in configuration, not the default.
- **Question raised:** how does alarm-driven polling actually work, given polling is stateful and Workers are stateless? Reference links requested.

### Answer to the question (Cloudflare docs)

Durable Objects are not stateless — that is their point. What is transient is _in-memory_ state; storage is durable.

- A DO is evicted from memory after **70–140 seconds of inactivity**. In-memory variables are lost on eviction, hibernation, or an uncaught exception. SQLite storage is not.
- `setAlarm(scheduledTimeMs)` persists on the platform, survives eviction, and wakes the DO. On wake **the constructor runs before `alarm()`**.
- Each DO has **exactly one alarm slot**; `setAlarm` overrides an existing alarm. Only one `alarm()` runs at a time per instance.
- Alarms are **at-least-once**: a throwing `alarm()` is retried with exponential backoff from 2s, up to 6 retries. `alarmInfo` carries `retryCount` and `isRetry`.
- `blockConcurrencyWhile(cb)` blocks delivery of all other events until `cb` resolves. Cloudflare explicitly recommends it in the constructor for migrations and initialization.

So the polling state never lives in memory between ticks. The cycle is: alarm fires → constructor rebuilds the store → checkpoint read from the SQL table → drain one batch → checkpoint written → `setAlarm(now + frequency)`. Emmett already persists checkpoints this way in `sqliteCheckpointer` → `storeProcessorCheckpoint`, so nothing new is needed for durability — only the loop shape changes.

### Consequence of "global event store by default"

DO SQLite storage is per-instance. A global event store therefore means **one designated DO instance holds every stream**: a single-writer store with natural total ordering and serialized writes, capped by that instance's limits — 10 GB SQL storage per DO, 2 MB max row/BLOB, 100 KB max SQL statement, 30s CPU per request (configurable to 5 min).

Sources: [Alarms API](https://developers.cloudflare.com/durable-objects/api/alarms/), [DO lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/), [In-memory state](https://developers.cloudflare.com/durable-objects/reference/in-memory-state/), [Limits](https://developers.cloudflare.com/durable-objects/platform/limits/)

## Q3. What does the app hand to `getSQLiteEventStore`, and who calls `blockConcurrencyWhile`?

Options offered: (1) `storage`, app blocks; (2) `ctx`, Emmett blocks; (3) `storage` required, `ctx` optional.

**A3:** Not yet decided. Recommendation requested, plus two clarifications and one constraint.

- "Does it need `storage` to pass to Dumbo and Pongo?" — yes. Confirmed: `CloudflareDurableObjectSQLitePoolSource = { storage: DurableObjectStorage }` (Dumbo) and `DurableObjectSQLiteDriverSource = { storage: DurableObjectStorage }` (Pongo). `ctx.storage` is a read-only `DurableObjectStorage`, so `ctx` is a superset of what the lower layers need.
- **"Global" means per DO, not one global DO.** A DO is not a single stream by default; it holds a whole feature with multiple streams inside. This retracts the single-writer-for-the-whole-system reading from A2.
- **Alarms are acceptable** provided they survive eviction and do not block operations.

### Consequence of "global = per DO"

Each DO instance owns an independent event store. So:

- The 10 GB SQL cap, 2 MB row cap and 30s CPU limit apply per feature/tenant DO, not to the system.
- `globalPosition` is totally ordered **within one DO only**. There is no cross-DO global order, so a subscription spanning DOs is a separate problem, not something the driver provides.
- Stream-per-DO becomes a narrowing of the same model (one stream in the DO), which is why it fits as configuration rather than a separate driver.

### On alarms surviving and not blocking

Both hold, with one nuance. Alarms are persisted by the platform, survive eviction and wake the DO (constructor first, then `alarm()`). An `alarm()` handler is an ordinary event: it holds no lock, and other requests interleave at every `await`. But a DO is single-threaded, so CPU-bound work inside `alarm()` does delay incoming requests, and anything wrapped in `blockConcurrencyWhile` blocks them outright. Relevant to the later consumer phase, not to phase 1.

### `blockConcurrencyWhile` facts that bear on the decision

- Signature: `blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>`.
- **If the callback throws, the Durable Object is terminated and reset.**
- A **30-second timeout** applies; exceeding it also triggers a reset.
- Legal outside the constructor, but Cloudflare recommends constructor use for initialization.

## Q4. Given that, how should the blocking migration be expressed?

Options offered: documented idiom (recommended); explicit named helper; driver takes `ctx` and blocks itself.

**A4: Documented idiom.**

The driver takes `storage` only. Blocking migration is two lines the app writes, shown in docs and samples:

```ts
constructor(ctx: DurableObjectState, env: Env) {
  super(ctx, env);

  this.store = getSQLiteEventStore({
    driver: durableObjectEventStoreDriver,
    storage: ctx.storage,
    schema: { autoMigration: 'None' },
  });

  ctx.blockConcurrencyWhile(() => this.store.schema.migrate());
}
```

Rationale for rejecting the `ctx` variant: `getSQLiteEventStore` is synchronous, so blocking inside it is a hidden async side effect whose failure mode is DO termination rather than a catchable error; Emmett cannot detect whether it was called from the constructor (the only context where `blockConcurrencyWhile` is well-behaved); and `mapToDumboOptions` is a pure data mapping for sqlite3 and D1, which `ctx` would break.

### Research: how Pongo already tests the DO driver (the reference to mirror)

Found in the sibling checkout at `/home/oskar/repos/Pongo`:

- `src/vitest.cloudflare.config.ts` — a separate config using `cloudflareTest()` from `@cloudflare/vitest-plugin`, pointed at a wrangler config, listing the DO spec globs explicitly.
- `src/packages/dumbo/wrangler.durable-object-sqlite.jsonc` — declares a `TEST_OBJECT` binding and a `new_sqlite_classes` migration.
- `src/packages/dumbo/src/storage/sqlite/durableObject/testing/durableObjectSQLiteTestWorker.ts` — a four-line worker exporting `class DumboDurableObjectSQLiteTestObject extends DurableObject {}`.
- Specs get real storage via `runInDurableObject` from `cloudflare:test`:

```ts
const stub = env.TEST_OBJECT.get(env.TEST_OBJECT.newUniqueId());
await runInDurableObject(stub, async (_instance, state) => {
  storage = state.storage;
  await runTest();
});
```

- `src/vitest.shared.ts` **excludes** the DO spec globs, and the root exposes a separate `test:int:cloudflare` script plus `types:cloudflare` / `types:cloudflare:check` wrangler-types scripts. Root devDependency: `@cloudflare/vitest-plugin` 1.1.3.

### Why Emmett cannot reuse its existing D1 test approach

Emmett's D1 specs run in the Node environment and call `new Miniflare({ d1Databases })` then `mf.getD1Database('DB')`. That works because a `D1Database` handle can cross into Node. `DurableObjectStorage` cannot — `ctx.storage` exists only inside workerd. Miniflare's `unsafeGetDurableObjectStorage()` returns only `{ exec() }`, a raw SQL escape hatch, not something Dumbo can take.

So DO specs must run inside the workers runtime under `@cloudflare/vitest-plugin`. That is new infrastructure for this repo: a dev dependency, a wrangler config, a test worker, a second vitest config and a script.

Incidental find for the later consumer phase: Miniflare exposes `unsafeEvictDurableObject()`, which makes eviction and alarm-wake behaviour testable.

## Q5. How should the DO test infrastructure land in Emmett, and does it run in `npm test`?

Options offered: mirror Pongo with a separate script; mirror Pongo wired into `npm test`; avoid the new pool and test through RPC.

**A5:** Challenged the premise — "how can the Pongo test be forgotten? Why would we do it differently? Is Pongo testing overkill?"

**The challenge was correct. Corrected finding:** Pongo's root `src/vitest.config.ts` registers `'vitest.cloudflare.config.ts'` as a **project**, alongside `packages/dumbo` and `packages/pongo`. So `vitest run ".int.spec"` at the root fans out across every project including the Cloudflare one, and the DO specs already run as part of `npm test`. The standalone `test:int:cloudflare` script is only a convenience for running that project alone; the exclusions in `vitest.shared.ts` exist so the node-environment projects do not pick up DO specs and fail.

Pongo's setup is not overkill — it is the minimum that works, because a `DurableObjectStorage` handle cannot leave workerd. Options 1 and 2 as posed were the same option and option 3 was strictly worse.

**Decision: mirror Pongo exactly.** Emmett's `src/vitest.config.ts` has the identical `projects` array, so registering the new config there is a one-line change and DO specs join `npm test` automatically.

### Resulting layout

```
src/
  vitest.config.ts                    # + 'vitest.cloudflare.config.ts' project
  vitest.cloudflare.config.ts         # new: cloudflareTest() plugin, DO globs
  vitest.shared.ts                    # + exclude DO globs from node projects
  package.json                        # + @cloudflare/vitest-plugin devDependency
                                      # + test:int:cloudflare convenience script
                                      # + types:cloudflare / types:cloudflare:check
  packages/emmett-sqlite/
    wrangler.durable-object.jsonc     # new: TEST_OBJECT binding, new_sqlite_classes
    src/testing/durableObjectTestWorker.ts   # new: 4-line DurableObject subclass
```

CI needs `npm run types:cloudflare:check` added to `build_and_test.yml`, matching Pongo.

### Incidental findings

- Pongo also ships `samples/cloudflare/durable-objects` with its own CI workflow (`build_and_test_sample_cloudflare-durable-objects.yml`), next to `samples/cloudflare/d1`. Emmett has neither.
- Dumbo's DO transactions run through `client.storage.transaction(...)`. `CloudflareDurableObjectSQLiteTransactionOptions = Omit<DatabaseTransactionOptions, 'readonly'>` — so unlike D1 there is **no `mode`** (`session_based`/`strict`) and **no `readonly`**. Nesting is guarded by `allowNestedTransactions`, defaulting to `false`. So the DO `mapToDumboOptions` sets `allowNestedTransactions: true` and nothing more.
- Dumbo's `canHandle` accepts `'storage' in options || 'client' in options || 'connection' in options`, confirming `storage` is the natural source to expose.

### Existing Emmett test coverage, for sizing the next question

- Driver-specific specs are thin: three for D1 (`appendToStream.d1`, `readLastMessageGlobalPosition.d1`, `SQLiteEventStore.d1.e2e`) and three matching ones for sqlite3.
- The bulk of the suite — projections, Pongo projections, consumers, schema, migrations — is file-based sqlite3 only, via `deleteSQLiteDatabaseFiles` in `testing/sqliteTestDatabase.ts`. None of it is parameterised by driver.

## Q6. How deep should phase-1 DO test coverage go?

Options offered: D1 parity plus what is new; match D1 exactly; parameterise the whole suite.

**A6: D1 parity plus the DO-specific concerns — and use sqlite3 as the reference, since DO mechanics are closer to it than to D1. Do not parameterise now; that is a separate task.**

### Why sqlite3 is the right reference — a concrete fork

Comparing the two existing append specs surfaces one directly contradictory assertion:

- `appendToStream.sqlite3.int.spec.ts`: _"should be allowed to throw exception inline and everything, including the events being stored are rolled back"_
- `appendToStream.d1.int.spec.ts`: _"throwing exception inline and everything, including the events being stored are NOT rolled back"_

D1 cannot roll back because it has no interactive transactions and runs in `session_based` mode. DO runs through `client.storage.transaction(...)`, which is a real SQLite transaction, so **the DO spec must assert rollback, following sqlite3**. The D1 spec cannot be cloned for DO.

### Delta between the two existing e2e suites

`SQLiteEventStore.sqlite3.e2e.spec.ts` (836 lines) has, and the D1 suite (567 lines) does not:

- `should tell whether a stream exists`
- `should create the sqlite connection in memory, and not close the connection` — sqlite3-specific, not applicable to DO
- five observability specs: appending, reading, inline projections, aggregating stream, plus causationId/correlationId rooting

The D1 suite has, and sqlite3 does not:

- `should keep processor checkpoints in the configured schema`

**Phase-1 DO suite** = the sqlite3 e2e suite minus the in-memory-connection test, plus D1's processor-checkpoint-schema test, plus the DO-specific specs below.

### Planned spec files

```
appendToStream.durableObject.int.spec.ts          # sqlite3 variant, asserts rollback
readLastMessageGlobalPosition.durableObject.int.spec.ts
SQLiteEventStore.durableObject.e2e.spec.ts        # from the sqlite3 e2e suite
pongoProjection.durableObject.int.spec.ts         # never exercised on DO before
transactions.durableObject.int.spec.ts            # storage.transaction() nesting and rollback
migration.durableObject.int.spec.ts               # schema.migrate() under blockConcurrencyWhile
```

## Q7. Where does the DO driver live and what is it called?

Options offered: `./cloudflare` with short names; `./cloudflare` with Dumbo/Pongo verbose names; its own published subpath.

**A7:** Examples requested first, then: _"It should have its own subpath imported in `./cloudflare`, d1 should be aligned."_

### Reference: how Dumbo and Pongo are laid out

`src/cloudflare.ts` in both is nothing but a barrel:

```ts
export * from './storage/sqlite/core';
export * from './storage/sqlite/d1';
export * from './storage/sqlite/durableObject';
```

The real code sits in `src/storage/sqlite/d1/` and `src/storage/sqlite/durableObject/`. Emmett-sqlite is flat by comparison — `src/cloudflare.ts` holds the D1 driver inline and `src/sqlite3.ts` holds the sqlite3 driver inline.

Also confirmed: neither Dumbo nor Pongo publishes nested export entries. Dumbo's exports are `.`, `./postgresql`, `./pg`, `./sqlite`, `./sqlite3`, `./cloudflare`; Pongo's are `.`, `./shim`, `./cli`, `./pg`, `./sqlite3`, `./cloudflare`.

## Q8. "Own subpath" — source folders only, or published export entries too?

Options offered: source folders with one published export; folders plus nested published exports; folders mirroring Dumbo's literal `storage/sqlite/` path.

**A8: Source folders, single published `./cloudflare` export — and the folder convention is `src/storage/{driver}/`, with existing drivers moved to match.**

The reason for `storage/{driver}` rather than `drivers/{driver}`: the folder is meant to hold more than the driver object. DO-specific machinery such as the alarm-based consumers discussed earlier belongs there too.

Note this drops the redundant `sqlite` segment from Dumbo's `storage/sqlite/{driver}`, since emmett-sqlite is already the SQLite package.

### Resulting layout

```
src/
  cloudflare.ts               # barrel: re-exports d1 + durableObject
  sqlite3.ts                  # barrel: re-exports sqlite3
  storage/
    d1/index.ts               # moved out of cloudflare.ts
    durableObject/index.ts    # new
    sqlite3/index.ts          # moved out of sqlite3.ts
```

`package.json` exports stay as they are: `.`, `./cli`, `./sqlite3`, `./cloudflare`.

Naming follows Emmett's existing terse style — `durableObjectEventStoreDriver` beside `d1EventStoreDriver` — since a `cloudflare` barrel already disambiguates.

**This makes moving the existing D1 and sqlite3 drivers part of phase 1**, which is a pure refactor and should land as its own step before the new driver.

## Q9. If a user configures nothing, should the DO driver create tables on first use?

Background: the event store needs its tables before it can append. Two moments are possible — on first use (what every driver does today), or at startup via `autoMigration: 'None'` plus `ctx.blockConcurrencyWhile(() => store.schema.migrate())` in the constructor. Both are correct; the difference is whether a user request or DO startup pays for table creation.

Checked and confirmed: lazy migration is **not** racy inside a DO. `migrateSchema = migration` is assigned synchronously right after `createEventStoreSchema(...)` returns, with no await between the guard and the assignment (`SQLiteEventStore.ts:199-250`), so concurrent callers in one isolate share a single promise.

**A9: Yes — same default as the other drivers.**

`getSQLiteEventStore` behaves identically on sqlite3, D1 and DO. Docs and samples show the startup form as the production recommendation:

```ts
this.store = getSQLiteEventStore({
  driver: durableObjectEventStoreDriver,
  storage: ctx.storage,
  schema: { autoMigration: 'None' },
});
ctx.blockConcurrencyWhile(() => this.store.schema.migrate());
```

This supersedes the `autoMigration: 'None'` shown in A4's snippet: that setting is a documented production choice, not a requirement of the driver.

## Q10. Is DO-per-stream part of phase 1, and does it need code?

Framing: "one DO per stream" is mostly an application topology decision. You name the DO id after the aggregate and the event store inside that DO happens to hold one stream. Nothing in the driver changes. The only thing a library could add is binding the stream name once so it is not repeated.

**A10: Later, and mostly docs.**

Not in phase 1. When it comes, it is a documented pattern plus a sample — name the DO after the aggregate, use the store normally. No driver change, nothing to configure.

```ts
export class ShoppingCartDO extends DurableObject {
  private streamId = `ShoppingCart:${this.ctx.id}`;

  addItem = (item: PricedProductItem) =>
    this.store.appendToStream(this.streamId, [
      { type: 'ProductItemAdded', data: { item } },
    ]);
}
```

## Q11. What should phase 1 ship for docs and samples?

Findings that framed the question: `src/docs/event-stores/sqlite.md` is 385 lines and **never mentions D1 or Cloudflare** — the D1 driver shipped undocumented. `samples/` holds only `webApi/*`; Pongo by contrast has `samples/cloudflare/d1` and `samples/cloudflare/durable-objects`, each with its own CI workflow.

**A11: a DO section in `sqlite.md`, and backfill the D1 docs at the same time. No samples in phase 1.**

Documenting both Cloudflare drivers together also makes the rollback difference between them explicit, which is the thing most likely to surprise someone moving from one to the other.

### Schema compatibility check (no question needed)

Verified that nothing in the event store schema needs DO-specific handling:

- `eventStoreSchemaSQL.ts` is 23 lines composing four table definitions, with no `PRAGMA`, `AUTOINCREMENT`, `WITHOUT ROWID`, triggers or generated columns.
- `appendToStream.ts` goes through `execute.batchCommand(...)`, and Dumbo already supports and tests `batchCommand` on the DO driver (`durableObject/execute/batchCommand.int.spec.ts`).
- There is no driver-type branching in the schema layer.

So the DO driver is expected to need no schema changes.

## Q12. How should phase 1 be split into steps?

The five pieces of work:

- **A.** Restructure the existing drivers into `src/storage/sqlite3/` and `src/storage/d1/`; entry files become barrels. No behaviour change.
- **B.** Set up the Cloudflare test runner: `@cloudflare/vitest-plugin`, `wrangler.durable-object.jsonc`, test worker, `vitest.cloudflare.config.ts`, project registration, shared exclusions, scripts, CI check.
- **C.** Write the DO driver in `src/storage/durableObject/index.ts`, re-exported from `cloudflare.ts`.
- **D.** Write the six specs.
- **E.** Write the docs: DO section in `event-stores/sqlite.md` plus D1 backfill.

**A12: three steps — A+B, then C+D, then E.**

Both infrastructure changes land together, since neither alters behaviour and neither is reviewed for it. Then the driver with its specs, tests first. Docs last, once behaviour is settled.

### Type details confirmed for the implementation

- `CloudflareDurableObjectSQLitePoolOptions = ConnectionOptions<CloudflareDurableObjectSQLiteConnection> & CloudflareDurableObjectSQLitePoolSource & JSONSerializationOptions`, where the source is a union of `{ storage }`, `{ client }` or `{ connection }`.
- `ConnectionOptions` carries `driverType` and `transactionOptions`; for DO that resolves to `Omit<DatabaseTransactionOptions, 'readonly'>`.
- So `mapToDumboOptions` sets `allowNestedTransactions: true` and nothing else — no `mode`, no `readonly`, unlike D1.
