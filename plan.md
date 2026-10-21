# Plan: the event store migrates its own projections for its consumers

## Goal

The event store owns the projections registered in it. When a consumer created with `store.consumer()` starts, the store migrates its schema once, through its own memoised migration, before the consumer initialises its processors. The processors do not know about the store. A migration that runs once does not run again, and a failed migration can be tried again.

## Decided behaviour

- `ConsumerHooks` in core gets `onInit?: () => Promise<void>`. The consumer calls it once, in `init`, before it initialises its processors. `start` already calls `init`. If `onInit` throws, `init` fails and the consumer stays uninitialised, so a later `init` or `start` calls `onInit` again.
- The PostgreSQL and SQLite consumers take this hook from the store and pass it to the core consumer, next to their own `onClose`.
- `store.consumer()` decides, when the caller does not set `schema.autoMigration`:
  - It passes `hooks.onInit: ensureSchemaExists`. `ensureSchemaExists` follows the store's `autoMigration`: `None` does nothing, `EnsureMigrated` calls `schemaMigrator.ensureMigrated()`, `CreateOrUpdate` calls the memoised `migrate()`.
  - Its default projectors (built from the store's async projections) get `migrationOptions` with the store's resolved schema and `autoMigration: 'None'`, so the processor runs no migration.
- When the caller sets `schema.autoMigration` on `store.consumer()`, the consumer decides. No store hook is passed, and the default projectors migrate in the processor, as today.
- On-demand projectors (`consumer.projector(...)`) and standalone consumers follow the consumer's `autoMigration`, as today. They migrate in the processor's transaction.
- The store's `migrate()` clears `migrateSchema` when the migration rejects, so the next call tries again. The memo stays only for a migration that committed.
- The store migration keeps one transaction for the event store schema and all its projections. The processor migration keeps the processor's init transaction.

## Out of scope

- No change to the projection schema (`postgreSQLProjectionSchema`, `sqliteProjectionSchema`).
- No memo shared across stores, pools or consumers.
- No change to Dumbo.

## Files

- Core: `src/packages/emmett/src/consumers/consumers.ts`, `consumers.unit.spec.ts`.
- PostgreSQL: `eventStore/consumers/postgreSQLEventStoreConsumer.ts`, `eventStore/postgreSQLEventStore.ts`, specs in `eventStore/consumers/postgreSQLEventStoreConsumer.schema.int.spec.ts` and `eventStore/projections/postgreSQLProjection.schema.int.spec.ts`.
- SQLite: `eventStore/consumers/sqliteEventStoreConsumer.ts`, `eventStore/SQLiteEventStore.ts`, specs in `storage/{sqlite3,d1,durableObject}/eventStore/projections/sqliteProjection.schema.int.spec.ts`.
- Docs: `src/docs/guides/projections.md`, section "Create Projection Tables".

## How to see that the processor did not migrate

Dumbo skips a migration that its migration table records as applied, so a second migrate leaves no trace. To make a processor migration visible, a test migrates the store, then drops the projection table and deletes its rows from the migration table, then starts `store.consumer()`. If a processor migrates, the table comes back. If only the store's memoised migration runs, the table stays missing. This test fails on the current code and passes after step 4 (PostgreSQL) and step 5 (SQLite).

## Order of work

Steps 1 and 2 are sequential. Step 3 depends on nothing and can run in parallel with steps 1 and 2. Step 4 needs steps 1, 2 and 3. Step 5 needs steps 1, 2 and 3, and can run in parallel with step 4. Step 6 needs steps 4 and 5. Step 7 is last.

Every step ends with `npm run agent:check`, the step's specs, and `npm run test:unit`. Step 7 runs `npm test`. Run commands from `src`. Build only with `npm run build:ts`.

## Steps

### Step 1: consumer `onInit` hook in core

Add the hook and its tests. Nothing else uses it yet, but step 2 wires it in right after, so no code stays orphaned.

```text
Context: Emmett repository, run commands from `src`. Core consumer is `src/packages/emmett/src/consumers/consumers.ts`. `ConsumerHooks` has only `onClose` (line ~134). The consumer's `init` (line ~299) returns early when `isInitialized`, then calls `processor.init(context)` for each processor, then sets `isInitialized = true`. `start` calls `init` when the consumer is not initialised.

Task (TDD):
1. In `consumers.unit.spec.ts`, add failing tests:
   - "runs the init hook once before the processors initialise": a consumer with `hooks.onInit` and one processor whose init records order. Call `init()` and `start()`. The hook runs once, before the processor init.
   - "lets the consumer start again after the init hook failed": `onInit` throws on the first call and succeeds on the second. The first `start()` rejects with that error, the second `start()` resolves, and the hook ran twice.
   Follow the style of the existing tests in that file (in-memory source, `stopWhen`/`until` as they do).
2. Run the tests and confirm they fail.
3. Add `onInit?: () => Promise<void>` to `ConsumerHooks`. In `init`, after the `isInitialized` check and before the processor loop, call `await hooks.onInit()` when it is defined. Do not set `isInitialized` when it throws.
4. Run the tests and confirm they pass. Run `npm run agent:check` and `npm run test:unit`. Output must be pristine.
Do not add comments. Do not commit.
```

### Step 2: the PostgreSQL and SQLite consumers pass the store's `onInit` hook

```text
Context: `postgreSQLEventStoreConsumer` (`src/packages/emmett-postgresql/src/eventStore/consumers/postgreSQLEventStoreConsumer.ts`) and `sqliteEventStoreConsumer` (`src/packages/emmett-sqlite/src/eventStore/consumers/sqliteEventStoreConsumer.ts`) build the core consumer with `hooks: { onClose }` only. The store fills the connection options (`PostgreSQLEventStoreConsumerConnectionOptions`, which has `source`, `pool` and similar). Step 1 added `ConsumerHooks.onInit` in core.

Task (TDD):
1. Add failing integration tests, one in the PostgreSQL consumer schema spec and one in each SQLite variant's consumer spec that fits (sqlite3, d1, durableObject): "runs the init hook before its projectors initialise". Create the consumer directly with `hooks: { onInit }` and one projector with an `init` that records order. Start it with `stopWhen: { noMessagesLeft: true }`. The hook runs first, once.
2. Run them and confirm they fail (type error or wrong behaviour counts as failing).
3. Add `hooks?: Pick<ConsumerHooks, 'onInit'>` to the connection options type of each consumer (the options the store fills, not `...ConsumerConfig`). Pass `onInit: options.hooks?.onInit` next to the existing `onClose`.
4. Run the tests, `npm run agent:check`, `npm run test:unit`. Output must be pristine.
Do not add comments. Do not commit.
```

### Step 3: the store's `migrate()` can be tried again after a failure

Can run in parallel with steps 1 and 2.

```text
Context: In `getPostgreSQLEventStore` (`postgreSQLEventStore.ts`) and `getSQLiteEventStore` (`SQLiteEventStore.ts`), `migrate()` stores the `createEventStoreSchema(...)` promise in `migrateSchema` and returns it. When that promise rejects, `migrateSchema` keeps the rejected promise, so every later `migrate()` rethrows the same error. Both stores take `hooks.onBeforeSchemaCreated`.

Task (TDD):
1. Add a failing test "migrates the schema on the next call after a failed migration" in `postgreSQLProjection.schema.int.spec.ts` and in each SQLite variant's `sqliteProjection.schema.int.spec.ts`. Use a store with one async Pongo projection and `hooks.onBeforeSchemaCreated` that throws on the first call only. The first `store.schema.migrate()` rejects with that error. The second resolves, and the projection table exists.
2. Run them and confirm they fail.
3. In both stores, when the migration promise rejects, clear `migrateSchema` (only if it still holds that promise), then rethrow. Keep the dry-run path as it is.
4. Run the tests, `npm run agent:check`, `npm run test:unit`. Output must be pristine.
Do not add comments. Do not commit.
```

### Step 4: PostgreSQL `store.consumer()` migrates through the store

```text
Context: `store.consumer()` in `postgreSQLEventStore.ts` (around the `consumer:` member) calls `postgreSQLEventStoreConsumer({ ...consumerOptions, schema: { ...consumerOptions?.schema, autoMigration: consumerOptions?.schema?.autoMigration ?? options.schema?.autoMigration, ...databaseSchema }, observability, pool, connectionString })`, then registers default projectors with `consumer.projector({ projection })` for `asyncProjections` when no `processors` are passed. `ensureSchemaExists()` in the store follows the store's `autoMigration`. Steps 1 to 3 are done: consumers accept `hooks.onInit`, and `migrate()` clears its memo on failure.

Task (TDD), in `postgreSQLEventStoreConsumer.schema.int.spec.ts`:
1. Add failing tests:
   - "does not migrate the store's projections again when its consumer starts after the store migrated": store with `autoMigration: 'CreateOrUpdate'`, a schema name, and one async Pongo projection. Call `store.schema.migrate()`. Drop the collection table and delete its rows from the store's `dmb_migrations` table. Start `store.consumer({ stopWhen: { noMessagesLeft: true } })`. The collection table does not exist.
   - "migrates the store's projections when its consumer starts before the store migrated": the same store without calling `migrate()`. Start the consumer. The collection table exists, and a following `store.schema.migrate()` returns no applied migrations.
   - "migrates the default projectors in the processor when the consumer sets its own autoMigration": store with `autoMigration: 'None'`, consumer with `schema: { autoMigration: 'CreateOrUpdate' }`. The collection table exists after start.
2. Run them and confirm the first two fail.
3. In `store.consumer()`, when `consumerOptions?.schema?.autoMigration === undefined`:
   - pass `hooks: { onInit: async () => { await ensureSchemaExists(); } }` to `postgreSQLEventStoreConsumer`;
   - register each default projector with `migrationOptions: { ...options.schema, ...databaseSchema, autoMigration: 'None' }`.
   Otherwise keep today's behaviour. Keep the existing TODO cast comment.
4. Run all PostgreSQL consumer, processor, projection and schema specs. The existing tests must still pass, in particular: "fails to start the consumer when projection migrations are pending and the consumer ensures migrations", "creates no projection tables in projector initialization when the event store skips migrations", "rejects registering a projector for a projection that the event store already runs as async". Run `npm run agent:check` and `npm run test:unit`. Output must be pristine.
Do not add comments. Do not commit.
```

### Step 5: SQLite `store.consumer()` migrates through the store

Can run in parallel with step 4.

```text
Context: `store.consumer()` in `src/packages/emmett-sqlite/src/eventStore/SQLiteEventStore.ts` mirrors the PostgreSQL one (see step 4): it calls `sqliteEventStoreConsumer({ ...options, ...consumerOptions, schema: {...}, observability, pool })` and registers default projectors for `asyncProjections`. `ensureSchemaExists()` exists in the same file. Steps 1 to 3 are done.

Task (TDD), in each of `storage/sqlite3`, `storage/d1` and `storage/durableObject` `eventStore/projections/sqliteProjection.schema.int.spec.ts`:
1. Add the same 3 failing tests as in step 4, adapted to SQLite: schema names are table-name prefixes (`sqliteTableName({ databaseSchemaName, tableName })`), the migration table is `SQLTableReference.from({ databaseSchemaName, tableName: 'dmb_migrations' })`, and each variant uses its own driver and connection (`fileName`, `database`, `storage`).
2. Run them and confirm the first two fail.
3. Apply the same change as step 4 in the SQLite `store.consumer()`.
4. Run all SQLite consumer, processor, projection and schema specs on the 3 variants. The existing tests must still pass. Run `npm run agent:check` and `npm run test:unit`. Output must be pristine.
Do not add comments. Do not commit.
```

### Step 6: docs

```text
Context: `src/docs/guides/projections.md`, section "Create Projection Tables {#migrations}", says that with `CreateOrUpdate` "A consumer does the same for its projectors when it starts" and that `eventStore.consumer()` uses the event store's `autoMigration`. Steps 4 and 5 changed who migrates.

Task:
1. Update the section so it states: a consumer created with `eventStore.consumer()` lets the event store migrate the projections registered in it, once, before the consumer starts its projectors; a projector added with `consumer.projector(...)`, or any projector when you set `schema.autoMigration` on the consumer, migrates its own projection when it starts.
2. Keep each paragraph on one line. No em-dashes. Snippets only from tests through `<<< @/snippets/...#region` or the existing `./projections/*.snippet.ts` regions.
3. Run `npm run docs:build` and `npm run agent:check`.
Do not commit.
```

### Step 7: full verification

```text
Run from `src`: `npm run agent:check`, `npm run test:unit`, then `npm test`. Report each command and its result. If a test fails, report it with its output and do not assume it was already broken. Output must be pristine. Do not commit.
```
