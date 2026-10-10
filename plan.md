# Plan: bundled relational schema migrations

Spec: [spec.md](spec.md). State: [todo.md](todo.md). The clean baseline is `21802d7c`. Commit `19fe3b37` ("f") holds Codex's and Claude's work; it stays only where it matches section 2.

## 1. Facts that shape the design

**Pongo and Dumbo `beta.57`** (`pongoDb.ts`, `pongoDatabaseComponent.ts`, `pongoCollection.ts`, `schemaComponentMigrator.ts`, `transaction.ts`):

- The owner holds one migrator. When its graph changes, it composes a new graph and replaces the migrator (`replaceComponent`).
- The graph root is `databaseComponent({ defaultSchemaName })`. The owner places tables with `withTable({ [name]: table }, schemaName)`. A collection component knows no pool and no placement. Placement adds a `CREATE SCHEMA` migration.
- Migration names contain schema and table names, not the database name.
- Automatic assurance: `autoMigration === 'None' ? migrator.ensureMigrated() : migrator.migrate()`. The migrator memoizes success. Concurrent first calls are not shared.
- Explicit migration in a session: `migrator.migrate({ execute })`. It is not memoized. `migrate({ dryRun: true })` ignores `execute`.
- A child gets the owner's assurance through an internal parameter: `pongoCollection({ ensureSchema })`.
- The driver supplies `migrationOptions: MigratorOptions`. D1: `d1MigrationOptions(pool) = { execute: pool.execute, transactionOptions: { mode: 'strict' } }`.
- `withTransaction` rolls back and returns the result when the handler returns `{ success: false, result }`.
- A Pongo client under `None` runs `ensureMigrated()` on its first operation. Each client has its own migrator.

**Emmett at `21802d7c`:**

- The store migrates lazily, once per instance, through a shared promise. One transaction runs:
  1. `onBeforeSchemaCreated`;
  2. the event-store migrations;
  3. inline `init` (PG reports `'inline'`; SQLite reports `'async'` and runs it before the migrations);
  4. `onAfterSchemaCreated`.

  The hooks run once per instance even when nothing is pending (`postgreSQLEventStore.e2e.spec.ts:112`). Under `None`, nothing runs, so inline projections are never registered.

- PG `dryRun` commits: the test asserts that the migration table exists after the dry run.
- The store has no registration after construction.
- Projection `init` is lifecycle. The relational wrapper calls `registerProjection` first: an upsert on `(name, partition, version)` that keeps `type` and serializes the whole definition. Then it calls the definition's `init`. Only the Pongo multi-stream `init` does DDL (`collection.schema.migrate()`).
- An async projector's `onInit` calls `projection.init` (hardcoded `'async'`) under every `autoMigration` value. Async Pongo tables are created there.
- The consumer migrates nothing. Checkpoint and registration tables are event-store migrations.
- Core `register` dedupes by identity. `ConsumerHooks` has only `onClose`.
- Consumer defaults (merged observability; the PG factory's `driver` and `migrationOptions`) reach only factory-created processors. Array processors are pushed as they are.
- A PG processor fixes `migrationOptions` at creation: the lock uses its `databaseSchemaName`, and the processing scope overwrites the consumer's context value. `driver` already falls back to the context.
- Core `reactor()` builds the processor object. `projector()` calls `reactor()`.
- The processing scope creates a nested store per batch, and `withSession` creates one per call, both with `autoMigration: 'None'`.

## 2. Target design

**Core** (no Dumbo import):

- `ProjectionDefinition`, `ProjectionRegistration` and `projection()` get `Schema = unknown` and `schema?: Schema`.
- `AutoMigration = 'None' | 'EnsureMigrated' | 'CreateOrUpdate'` (D8). Core, PG and SQLite options use it instead of Dumbo's `MigrationStyle` until Emmett uses the Dumbo release that has `EnsureMigrated`.
- `MessageProcessor` and the processor options get `schema?: Schema` and `autoMigration?: AutoMigration`. Every processor accepts both. `projector()` takes its projection's schema when its options set none.
- `projections.async()` returns `type: 'async'`.
- `ConsumerHooks.onInit` sits next to `onClose`. It runs once before processor init. When it fails, no processor inits, and the next start retries.
- `register` replaces a processor with the same ID at its position (D3). It does not track where a processor came from.
- `resolveAutoMigration(own, inherited)` returns `own ?? inherited ?? 'CreateOrUpdate'`.

**PG and SQLite** (same shape; SQLite in shared code):

- **Reusable event-store schema component**, one per owner instance, modeled on `PongoDatabaseComponent`:
  - It starts from the event-store migrations (`eventStoreSchemaMigrationsFor(options)`, same names and SQL).
  - `add(schema)` adds the component as a child, unchanged, and replaces its migrator. It places no tables: each component provides its full schema, including `CREATE SCHEMA` for a non-default database schema. Dumbo dedupes equal migrations and rejects conflicting SQL for one name when the migrations are read.
  - It exposes `component`, `migrations` and `migrator`. The driver's `migrationOptions` are spread into each new migrator.
  - The event store, the consumer and an own-pool processor each hold one instance.
- **Default schema for projections:** the PG and SQLite adapters define `withDefaultSchemaName(databaseSchemaName)` on Pongo and raw SQL projections. It returns a rebuilt definition; an explicit schema in the definition wins. The event store calls it on each registration that has it, with `projectionsDatabaseSchemaName ?? databaseSchemaName`, and skips the call when both are unset. Core types stay as in 2.1.
- **Pongo projections:** `schema` is the component a Pongo client db with the projection's default schema name holds for its collection (`definition?.withTableName(name) ?? pongoSchema.collection(name)`, in `collectionOptions.databaseSchemaName` when set). Build it as `PongoDatabaseComponent` does, from a Pongo database definition rebased with `withDefaultSchemaName`; no pool is needed. The handler's Pongo database uses the same default schema name. `pongoProjection` passes `schema` through. `init` stays until G6.
- **Raw SQL projections:** `schema` is a Dumbo database component; `withDefaultSchemaName` rebuilds it with the component's `withDefaultSchemaName`.
- **Pongo client reuse (D5):** one Pongo client per storage instead of one per batch. Inline: one client on the store's database. Async: one client created from the projector's pool in its init. First check how the batch transaction reaches a reused client. When it costs too much, stop and report; it moves to the spec's future improvements.
- **Projection registration** serializes the definition without `schema`.
- **Processors:**
  - Without their own migration options, they take the consumer's at init. This covers the lock schema, the checkpoints and the nested `messageStore`.
  - A processor that shares the consumer's pool exposes its `schema` for grouping.
  - A processor with its own pool is a child owner. Its migrator covers only its own schema under `databaseComponent({ defaultSchemaName })`; no event-store tables on that storage (Q3). Its `schema` value is the owner shape `{ component, sql, print, migrate, ensureMigrated }`, which is how the consumer recognizes it (Q1). It runs assurance in `onInit` before `projection.init`, with `resolveAutoMigration(options.autoMigration, consumer's effective value)` (D6).
- **Event store:**
  - It accepts inline and async registrations.
  - Graph: its event-store schema component instance with all registration schemas added at construction, after `withDefaultSchemaName`. One migrator.
  - `migrate(options)`: one transaction with `onBeforeSchemaCreated`, `migrator.migrate({ execute: tx.execute })` and `onAfterSchemaCreated`. A dry run returns `{ success: false, result }`. A successful non-dry run sets a once-per-instance flag, so the hooks run once. No shared promise (spec non-goal 54).
  - Public `init()`, once per instance; the first operation calls it when nobody did:
    1. automatic assurance: `migrate()` under `CreateOrUpdate` (skipped when the flag is set), `migrator.ensureMigrated()` under `EnsureMigrated`, nothing under `None`;
    2. `init` for each inline registration in its own transaction, with `registrationType: 'inline'`, under every `autoMigration` value (D7).
  - `schema = { component, sql, print, migrate, ensureMigrated, dangerous }`.
  - A local function inside `getPostgreSQLEventStore` builds the store object for a pool. The store uses it with its own pool; `withSession` uses it with the session's connection instead of calling `getPostgreSQLEventStore`. The session shares the store's `init()`, so it runs no assurance and no inline `init` of its own (D8).
  - The processing-scope `messageStore` keeps `autoMigration: 'None'`, no `projections` and no `hooks`, so its `init()` does nothing.
  - `consumer()` passes `autoMigration`. When `processors` is omitted, it passes one projector per async registration in `processors`: `postgreSQLProjector({ projection, observability })`, with the observability the consumer would merge.
- **Consumer:**
  - It has an `autoMigration` option, resolved against the inherited value.
  - Graph: its event-store schema component instance. It adds each processor `schema` that passes Dumbo's `isSchemaComponent` at construction (the `processors` array) and on each later registration. A `schema` with the owner shape is kept in a child-owner list, not added.
  - `schema = { component, sql, print, migrate, ensureMigrated }`. `migrate()` and `ensureMigrated()` run on its own graph first, then call the same method on each child owner. `sql()` and `print()` show its grouped graph only (Q4).
  - `hooks.onInit` runs automatic assurance on its own graph. Child owners run theirs in their own init.
  - A store-created consumer runs its own assurance; the second history read is accepted (spec future improvements).
- **Driver:** `migrationOptions?(pool): MigratorOptions`, as in Pongo. The reusable component spreads it into `schemaComponentMigrator`.

**Driver types** (GT): each root exports the driver types; PG defaults are `AnyPostgreSQLEventStoreDriver`; `AnyPostgreSQLConnection` uses `AnyDatabaseTransaction`; the deprecated options name `PgEventStoreDriver`; `driverType` still rejects mixing.

**Not in the design** (present in `19fe3b37`):

- Separate `<db>EventStoreSchemaComponent` and `projectionsSchemaComponent` functions, or migrator code repeated in each owner.
- `projections` on the core consumer options, and `projections: undefined` in the PG consumer.
- A per-call migrator (`usesConfiguredSchema`), `hasInitialization` branches, `ensureMigrated()` after `migrate()`, and `init` inside the migration transaction.
- `isPongoCollectionComponent` or `databaseSchemaComponent` placement in stores.
- `ensureSchema` in handler contexts, and an internal factory or option that passes the owner's assurance to nested stores.
- Direct `pongoCollection` or a per-batch `dumbo` pool in Pongo projections.

## 3. Decisions (Oskar)

Decided on 2026-10-09:

- **D1:** already in spec non-goal "Do not share concurrent first calls through an in-flight promise". Not a decision.
- **D3 (simplified):** any later registration with the same ID replaces the earlier processor. Automatically registered processors are ordinary processors. Throwing on explicit duplicates is a future improvement.
- **D5:** reuse Pongo clients per storage (inline: the store's database; async: the projector's pool, created in init). Pongo's `None` executing nothing comes with the separate `EnsureMigrated` change in Dumbo and Pongo (D8). Either part may become a follow-up if it costs too much.
- **D6:** every processor accepts `autoMigration`; the default comes from the top (consumer, then event store, then `CreateOrUpdate`). It takes effect where the processor owns a run (own pool). On the consumer's pool, the consumer's call covers its schema, as a PongoDb covers its collections.
- **D7:** inline `init` runs under every `autoMigration` value, in `eventStore.init()`.

Decided on 2026-10-10:

- **D8:** `autoMigration` gets `EnsureMigrated`. `None` runs no assurance and reads no history; `EnsureMigrated` calls `ensureMigrated()`; `CreateOrUpdate` calls `migrate()`. Emmett core defines the union until Dumbo ships it; Dumbo and Pongo get the same change in parallel. `withSession` reuses the store through a local function of the pool, not a second store instance.
- **Owners:** event store `init()`; recursive owners (a processor with its own pool is a child owner of its consumer); one reusable event-store schema component per event store and consumer; any processor may contribute `schema`.
- **Q1:** the shape of `schema` tells grouped processors from child owners (`isSchemaComponent`).
- **Q3:** on another storage, a processor migrates only its own schema; the user sets up checkpointing there. Metadata storage is a future improvement.
- **Q4:** an owner's `sql()` and `print()` show its grouped graph only.

## 4. Rules

- One subagent per step. Steps marked ∥ run in parallel. Groups run in order.
- Follow TDD. Name tests after observable behavior. Use the module pattern. Write no new comments. Use no em-dashes, no monkey-patching and no Pongo internals.
- Follow the Pongo pattern from section 1 for owners, placement, assurance and child delegation.
- Run no git command that changes state. Oskar handles Git.
- **Gate after each group:** from `src`, `npm run build:ts`, `npm run agent:check`, the touched integration specs, and `npm run test:unit`.
- After `npm run test:bundle`, run `npm run build:ts -- --force`: tsdown replaces `packages/*/dist`, and eslint then reports error types.

## 5. Groups

| Group | Steps                   | Needs              |
| ----- | ----------------------- | ------------------ |
| GT    | T.1                     | done, gate pending |
| G0    | 0.1                     | none               |
| G1    | 1.1 ∥ 1.2 ∥ 1.3         | G0                 |
| G2    | 2.1 ∥ 2.2 ∥ 2.3         | G1                 |
| G3    | 3.1 ∥ 3.2 ∥ 3.3         | G2                 |
| G4    | 4.1 ∥ 4.2               | G3                 |
| G5    | (5.1 → 5.2 → 5.3) ∥ 5.4 | G4                 |
| G6    | 6.1 → 6.2               | G5                 |
| G7    | 7.1 ∥ 7.2 ∥ 7.3         | G6                 |
| G8    | 8.1 → 8.2               | G7                 |

## 6. Prompts

Every prompt starts with this preamble: _Read spec.md and plan.md sections 1-4. Report files changed, test names, and commands with results. Stop and report when the code differs from what the prompt says._

### T.1 Driver types in consumer declarations (done)

```text
Test first: e2e/declarationEmit.bundle.spec.ts in the bundle project. buildBundles also builds emmett-postgresql and emmett-sqlite. For CommonJS nodenext, ESM nodenext and bundler resolution, run tsc with declaration emit on a consumer that exports a PG and an SQLite raw SQL projection and a Pongo projection without annotations. Expect no errors. The same consumer has @ts-expect-error for an SQLite projection in a PG store and a D1 projection in an sqlite3 store. Then export the driver types from both package roots, change the PG generic defaults to AnyPostgreSQLEventStoreDriver, type the AnyPostgreSQLConnection transaction as AnyDatabaseTransaction, and use PgEventStoreDriver in PostgresEventStoreConnectionStringOptions.
```

### 0.1 Classify the working tree

```text
From the repository root, run `git diff 21802d7c -- . > ../codex-working-tree.patch`. For each file changed since 21802d7c, compare the change with plan.md section 2 and write a row in todo.md "G0 classification": file, matches / does not match, kept hunks. Expected matches: the T.1 hunks, the Dumbo createFunctionIfDoesNotExistSQL swap, the schemaObjects.ts removal and helper swaps, the registrationType line in postgreSQLProjection.ts, asyncProjections returning 'async', and the PG dry run returning { success: false, result } from the transaction. Inputs for later steps: the Pongo projection `schema` (3.3; the multi-stream `init` must come back) and the SQLite driver `migratorOptions` hook (4.2; rename to `migrationOptions` with `MigratorOptions`). Edit no source. After Oskar restores, run the gate and report.
```

### 1.1 `projections.async()` returns async

```text
packages/emmett/src/projections/index.ts. Test first: the value has type 'async', and the result is typed ProjectionRegistration<'async'> (match the repo's type-test style). Change only the return type and value. Keep AnyEvent.
```

### 1.2 Real registration types

```text
PG postgreSQLProjection init: registerProjection uses options.registrationType. SQLite store inline init: registrationType 'inline'. Tests first: the PG registration row type is 'inline' for inline and 'async' for a projector, and the sqlite3 inline init receives 'inline'.
```

### 1.3 Dumbo helpers

```text
Delete PG createFunctionIfDoesNotExist.ts. Use createFunctionIfDoesNotExistSQL from '@event-driven-io/dumbo/postgresql' with { databaseSchemaName }, and add a test that the migration SQL is unchanged (capture a fixture before the change). Delete testing/schemaObjects.ts. Use the '@event-driven-io/dumbo/pg' helpers with { databaseSchemaName }, and columnExists in 0_42_0. Change the SQLite specs to tableExists/indexExists(execute, name, { databaseSchemaName }). The existing tests stay green.
```

### 2.1 Core schema generic and `autoMigration`

```text
Section 2 Core, first two bullets and the last. Type tests use a structural component fixture (no Dumbo): a projection definition and registration carry schema; projector({ schema }) exposes it; projector without schema exposes its projection's schema; reactor({ schema }) and the workflow processor expose theirs; every processor option accepts autoMigration. Existing inference is unchanged. resolveAutoMigration: own, then inherited, then CreateOrUpdate. All call sites compile unchanged.
```

### 2.2 Consumer init hook and one processor per ID

```text
consumers.ts. Tests first: onInit runs before processor init; when it fails, no processor inits and the next start retries; a later registration replaces a processor with the same ID at its position, from the array or from a factory; different IDs are kept.
```

### 2.3 Processors take the consumer's migration options

```text
PG and SQLite processors. Test first, per database: a projector built with postgreSQLProjector({ projection }) and passed in a consumer's processors array, where the consumer has a custom databaseSchemaName, stores its lock and checkpoint in that schema and its messageStore uses it. Then resolve migrationOptions at init from options, else the consumer context. A processor with its own migrationOptions keeps them.
```

### 3.1 PG components

```text
Read Pongo's PongoDatabaseComponent first. Add the reusable PG event-store schema component (section 2). Unit tests: without additions its migrations equal eventStoreSchemaMigrationsFor(options); an added Pongo database's migrations follow the event-store migrations; any schema component is added as a child; equal migrations dedupe; conflicting SQL for one name throws when the migrations are read; each add replaces the migrator. Integration test: two instances do not share a memo. Export it from schema/index.ts.
```

### 3.2 SQLite components

```text
Same as 3.1 in shared SQLite schema code.
```

### 3.3 Pongo projections expose `schema`

```text
PG and SQLite pongoProjections.ts and the raw SQL projections. Pongo and raw SQL projections get withDefaultSchemaName and schema as in section 2. Keep init, handle and truncate as at 21802d7c, except that the Pongo handler uses the definition's default schema name. registerProjection serializes the definition without schema. Unit tests: Pongo schema migrations equal those of a Pongo client db with the same defaultSchemaName and collection, for no default, a default, and an explicit collection schema; versioned name; indexes kept; a raw SQL table lands in the default schema and an explicit schema wins; registered definition has no schema.
```

### 4.0 Core `EnsureMigrated`

```text
D8. Add AutoMigration = 'None' | 'EnsureMigrated' | 'CreateOrUpdate' to core next to resolveAutoMigration, and use it in the processor options and resolveAutoMigration. Type test: every processor option accepts EnsureMigrated; resolveAutoMigration keeps an own or inherited EnsureMigrated. All call sites compile unchanged.
```

### 4.1 PG event store

```text
Section 2 "Event store", D7, D8. Use AutoMigration in the PG store options. Integration tests:
- one migrate() under None creates the event store and the inline and async Pongo collections;
- sql() lists them in registration order; component lists the whole graph;
- ensureMigrated throws PendingMigrationsError on a fresh database and passes after migrate;
- after migrate, under None, append reads no migration history, executes no DDL and registers the inline projections;
- migrate() does not call init; init() calls it once per inline registration with 'inline'; the first operation calls init() when nobody did, and not again after an explicit init();
- under EnsureMigrated, init() on a fresh database throws PendingMigrationsError;
- under None, init() reads no migration history;
- the hooks run once per instance, in the migration transaction, also when nothing is pending;
- dry run rolls back (replace the baseline assertion) and does not satisfy assurance;
- after the first operation, appends, withSession calls and a processor's messageStore read no migration history;
- a withSession session runs no inline init and no hooks, also when it is the first operation;
- the baseline hook and "schema only once" tests stay green.
```

### 4.2 SQLite event store

```text
Same as 4.1 in shared code. The driver gets migrationOptions?(pool): MigratorOptions; D1 returns Pongo's d1MigrationOptions values. D1 dry-run tests now expect rejection. Run on sqlite3, d1 and durableObject. If the hooks cannot run on D1 strict mode, stop and report.
```

### 5.1-5.3 PG projector, consumer, store wiring (sequential)

```text
5.1 Processors:
- Shared pool: the processor exposes its schema (a projector: its projection's by default; a reactor: its own option).
- Own pool: a child owner. Its migrator covers only its own schema; its schema value is the owner shape (component, sql, print, migrate, ensureMigrated); assurance in onInit before projection.init, with resolveAutoMigration(options.autoMigration, the consumer's effective value).
Tests: schema for each pool kind (component versus owner shape); an own-pool projector creates no emt_processors on its storage; an own-pool projector on a fresh database migrates on init; it inherits the consumer's EnsureMigrated and then throws PendingMigrationsError; under an inherited None it reads no migration history; its own CreateOrUpdate overrides the consumer's EnsureMigrated; a shared-pool processor does not migrate on init.

5.2 Consumer:
- autoMigration option, schema API, its reusable component instance with same-pool processor schemas added at construction and on registration; owner-shaped schemas kept as child owners; hooks.onInit runs assurance on its own graph; sql() and print() show the grouped graph only.
Tests:
- a standalone start creates everything;
- under EnsureMigrated, start throws and creates nothing;
- under None, start reads no migration history;
- sql() order;
- array processors and later projector() and reactor() calls are included; an own-pool projector is not;
- schema.migrate() migrates the consumer's database, then the own-pool projector's database, in two transactions; when the second fails, the first stays committed and a retry passes;
- a processor replaced by another projection with the same ID changes the graph;
- after migrate, dropping the migration table does not break start.

5.3 Store:
- pass the inherited autoMigration;
- when processors is undefined, pass one postgreSQLProjector({ projection, observability }) per async registration.
Tests (spec examples 2 and 3):
- defaults run with the same settings as consumer.projector({ projection });
- [] and an explicit array add none;
- a same-ID projector replaces the default;
- inherit None and EnsureMigrated, override CreateOrUpdate, override None;
- starts without DDL after store migrate.
```

### 5.4 SQLite projector, consumer, store wiring

```text
Run 5.1-5.3 in order, in shared SQLite code. Spread driver.migrationOptions. Keep assurance inside the consumer's withConnection scope. All three drivers must be green after each sub-step.
```

### 6.1 Pongo projections stop migrating

```text
PG and SQLite: remove only the multi-stream init that calls collection.schema.migrate(). Registration and pongoProjection's own init option stay. Test first: processor init still writes the registration and does not create a missing collection. If another spec then fails, fix the owner graph, not the projection.
```

### 6.2 Reuse Pongo clients (D5)

```text
PG and SQLite pongoProjections.ts. First read how a Pongo client takes a session or connection per operation in beta.57, and report how the batch transaction would reach a reused client. If that needs a Pongo change or more than the projection factories and the owners, stop and report; Oskar decides whether it becomes a follow-up. Otherwise, test first: under None, a run of inline appends and async batches reads the migration history once per Pongo client, not once per batch. Then create one client per storage: inline on the store's database, async from the projector's pool in init.
```

### 7.1 Concurrency

```text
Test only. On PG and sqlite3, start two consumers from two stores on a fresh database at the same time. Exactly one fails with Dumbo's UniqueConstraintError, and the tables exist.
```

### 7.2 PG least privilege

```text
A migration role migrates. A runtime role has USAGE, DML and EXECUTE, but no CREATE. Under EnsureMigrated, a runtime append, start and catch-up pass, and inline and async registrations are written. When the projections are not migrated, start throws PendingMigrationsError listing them. Start takes no migration lock (check pg_locks, or report why it cannot be checked).
```

### 7.3 Dry run and retry

```text
Test only, store and consumer, PG, sqlite3 and durableObject: a dry run applies and rolls back; a dry run does not satisfy EnsureMigrated; a failed migration can be retried.
```

### 8.1 Docs

```text
src/docs and the PG and SQLite READMEs, with snippets from tests through <<< @/snippets regions. Cover:
- projection schema versus storage-bound schema;
- autoMigration inheritance;
- None versus EnsureMigrated versus CreateOrUpdate;
- migrate versus ensureMigrated versus dryRun;
- one-call provisioning;
- omitted versus provided processors;
- own-pool projectors are not bundled, and the consumer's migrate() migrates them in a separate run;
- eventStore.init() for fail-fast startup;
- init versus migration;
- the outcome of 6.2.
Then run npm run docs:build.
```

### 8.2 Review and final verification

```text
Independent reviewer: read spec.md, plan.md sections 1-3, the decisions in todo.md, and the full diff against 21802d7c. Check that every addition serves the spec or a decision, that it follows the Pongo pattern in section 1, that nothing from "Not in the design" appears, that bookkeeping is not exported, and that tests use the public examples. After fixes, run npm run agent:check, npm run test:unit and npm test.
```
