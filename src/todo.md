# PostgreSQL Schema Support TODO

## Working rules

- Stop at the end of each phase for approval.
- Do not touch git.
- Keep the work test-first.
- Prefer removable changes over patching around the design.
- If a change starts looking like a hack, stop and ask for approval.
- Avoid process names like `resolve`, `provide` and `define` unless that is truly the concept. Prefer domain names.
- Do not add abstractions unless they remove real complexity or represent a clear domain concept.
- Test helpers are fine when they reduce noisy raw SQL and reuse Dumbo helpers; avoid helpers that hide the behavior being asserted.
- Names must match the actual database concept. For PostgreSQL table/sequence references, prefer a relation-oriented name over an event-store-table name.
- Name tests from the user's perspective, as use cases and observable behavior.
- Before claiming a phase works, run `npm run build:ts`, `npm run fix`, `npm run test:unit` and all touched tests, then fix any issues found.
- If running all integration or e2e test suites is needed, ask Oskar.
- The current schema migration must ignore hash mismatches explicitly.
- Do not manually escape or wrap identifiers/literals with `"` or `'` in Emmett. Use Dumbo primitives or change the SQL shape.

## Phase 0: compatibility and option resolution

- [x] Start phase and define scope
- [x] Add failing resolver/compatibility tests
- [x] Confirm the tests fail for the expected reason
- [x] Implement internal schema option model
- [x] Run focused tests
- [x] Run formatting/checks
- [x] Stop for approval before Phase 1

## Phase 1: generated and migrated core schema

- [x] Start phase after approval
- [x] Add missing migration table name option tests from Phase 0
- [x] Implement missing migration table name forwarding
- [x] Add failing generated schema SQL tests
- [x] Add failing migration placement tests
- [x] Implement schema-qualified core schema generation
- [x] Add fresh-schema migration integration coverage for named event and migration schemas
- [x] Add mixed-schema migration integration coverage for event, projection and migration-table names
- [x] Run focused tests and formatting
- [x] Run `npm run build:ts`
- [x] Run `npm run fix`
- [x] Run `npm run test:unit`
- [x] Review for consistency, naming, dead code, and redundant abstractions; fix only clear issues and ask Oskar when unsure
- [x] Check follow-up changes for Dumbo and Pongo, and note them in `research.md` and `plan.md`
- [x] Stop for approval before Phase 2

## Phase 2: core append and read isolation

- [x] Started after approval
- [x] Add failing user-facing tests proving runtime isolation between configured schemas.
- [x] Make runtime function calls use the configured event-store schema instead of unqualified function names.
- [x] Make runtime table reads/writes use the configured event-store schema instead of unqualified table names.
- [x] Run focused tests and formatting
- [x] Run `npm run build:ts`
- [x] Run `npm run fix`
- [x] Run `npm run test:unit`
- [x] Review for consistency, naming, dead code, and redundant abstractions; fix only clear issues and ask Oskar when unsure
- [x] Stop for approval before Phase 3

## Phase 3: checkpoints, locks, processors and hooks

- [x] Started after approval
- [x] Add failing user-facing tests proving processors use configured schema for checkpoints and locks
- [x] Add failing user-facing tests proving projection registration and locks use configured schema
- [x] Make consumer and processor lifecycle operations use the configured event-store schema consistently
- [x] Make PostgreSQL projection management operations use the configured event-store schema consistently
- [x] Run focused tests and formatting
- [x] Run `npm run build:ts`
- [x] Run `npm run fix`
- [x] Run `npm run test:unit`
- [x] Review for consistency, naming, dead code, and redundant abstractions; fix only clear issues and ask Oskar when unsure
- [x] Check follow-up changes for Dumbo and Pongo, and note them in `research.md` and `plan.md`
- [x] Move schema hook coverage to the schema suite and keep consumer runtime schema checks in a dedicated consumer spec
- [x] Keep Pongo projection helpers from passing both a pool and a transaction client, and close the ambient-client Pongo clients in `finally`
- [x] Stop for approval before Phase 4

## Phase 4: Pongo and raw projection schema forwarding

- [x] Started after approval
- [x] Add failing user-facing tests proving Pongo projection tables use the configured projection schema
- [x] Add failing user-facing tests proving explicit Pongo collection schema overrides the projection default
- [x] Add failing user-facing tests proving Pongo projection migrations use the shared migration table
- [x] Add failing user-facing tests proving projection specs forward configured schema options
- [x] Add failing user-facing tests proving raw SQL projections receive configured schema names
- [x] Forward projection schema and migration-table options to every PostgreSQL Pongo client construction path
- [x] Forward configured schema options to projection truncation
- [x] Run focused tests and formatting
- [x] Run `npm run build:ts`
- [x] Run `npm run fix`
- [x] Run `npm run test:unit`
- [x] Review for consistency, naming, dead code, and redundant abstractions; fix only clear issues and ask Oskar when unsure
- [x] Check follow-up changes for Dumbo and Pongo, and note them in `research.md` and `plan.md`
- [x] Stop for approval before Phase 5

## Phase 5: consumers, sessions and alternate connections

- [x] Started after approval
- [x] Add user-facing tests for schema forwarding from event-store-created consumers
- [x] Add user-facing tests for schema forwarding through consumer/session/alternate connection paths
- [x] Add user-facing tests for async projection storage when event-store and projection schemas differ
- [x] Add user-facing tests for rebuilding projections when event-store and projection schemas differ
- [x] Confirm remaining event-store-created consumer/session paths already pass prepared schema metadata without coupling processors to event-store options
- [x] Run focused tests and formatting
- [x] Run `npm run build:ts`
- [x] Run `npm run fix`
- [x] Run `npm run test:unit`
- [x] Review for consistency, naming, dead code, and redundant abstractions; fix only clear issues and ask Oskar when unsure
- [x] Check follow-up changes for Dumbo and Pongo, and note them in `research.md` and `plan.md`
- [x] Stop for approval before Phase 6

## Phase 6: identifier safety, regression coverage and docs

- [x] Started after approval
- [x] Add user-facing regression tests for configured names that require PostgreSQL quoting
- [x] Remove or document any remaining local identifier/rendering stopgaps
- [x] Update `research.md` and `plan.md` with any final follow-ups found
- [x] Run focused tests and formatting
- [x] Run `npm run build:ts`
- [x] Run `npm run fix`
- [x] Run `npm run test:unit`
- [x] Review for consistency, naming, dead code, and redundant abstractions; fix only clear issues and ask Oskar when unsure
- [x] Add user-facing coverage for a default store sharing a database with a configured-schema store
- [x] Scope the 0.43.0 catalog checks that name objects a configured schema also creates, and mark those two migrations hash-tolerant
- [x] Make `createFunctionIfDoesNotExistSQL` check the schema it is given instead of skipping the check for configured schemas
- [x] Replace hand-rolled row-count and boolean selectors in touched schema specs with Dumbo helpers where they are not the behavior under test
- [x] Separate table-existence assertions from row-count assertions in touched schema specs
- [x] Add dry-run coverage for a configured schema
- [x] Document the configuration options and fallback rules
- [x] Stop for approval before SQLite follow-up

## Later phases

- [x] SQLite follow-up PR planned in `plan.md`

---

# SQLite Schema Support TODO

## Working rules

The PostgreSQL working rules above apply unchanged. SQLite adds:

- Two drivers, `sqlite3` and D1, must reach the same configured store. Resolver and rendering tests stay driver-free; append, read and migration placement get a D1 mirror.
- A SQLite logical schema is a quoted prefixed physical name, `"events.emt_streams"`, not a native schema. Never emit `CREATE SCHEMA` on SQLite.
- Dumbo owns name validation, including the `.` restriction. Emmett adds no second check.
- Locks, projection management and rebuild are out of scope. Do not add them, and do not depend on them.
- Do not join `SQL` tokens into strings. Use `sqliteFormatter` through `getFormatter`.

## Phase 1: Dumbo migrations on the default path

- [x] Start phase and confirm scope
- [x] Add failing tests for a fresh database creating `dmb_migrations` and the four tables
- [x] Add failing tests for upgrading the 0.41.0 and 0.42.0 fixtures with recorded history
- [x] Add failing tests for an existing imperative database applying and recording without data loss
- [x] Add failing tests for `schema.migrate()` returning applied and skipped lists
- [x] Add failing tests for a dry run leaving the database unchanged
- [x] Convert the imperative 0.42.0 migration into a Dumbo migration, replacing its `sqlite_master` guard with `CREATE TABLE IF NOT EXISTS emt_subscriptions`
- [x] Give `createEventStoreSchema` an options parameter and move it onto `runSQLMigrations`
- [x] Mirror the PostgreSQL migration layout: `migrations/current`, per-version `index.ts`, snapshot fixtures and per-version specs
- [x] Wrap `schema_0_41_0` as `snapshot_0_41_0` and `migrations_0_41_0`, and set old-version fixtures up through `runSQLMigrations`
- [x] Pass a pool instead of a connection to `createEventStoreSchema` at every call site
- [x] Run focused tests, `npm run build:ts`, `npm run fix`, `npm run test:unit`
- [x] Review for consistency, naming, dead code and redundant abstractions
- [x] Stop for approval before Phase 2

Deferred to Phase 2, because they need `eventStoreSchemaSQL(options)`:

- [ ] Add `schemaMigrationFor` with `ignoreHashMismatch` and `eventStoreSchemaMigrationsFor`

Decisions:

- [x] Oskar confirmed `CREATE TABLE IF NOT EXISTS emt_subscriptions` as the replacement for the conditional guard. The past migration stays in the fresh chain.
- [x] The SQLite-only test `migrates from the schema created before migrations were introduced` stays. PostgreSQL has no counterpart because it always had a migration table, while released SQLite databases carry the four tables and no `dmb_migrations`.

## Phase 2: resolver, generated schema and migration placement

- [x] Start phase after approval
- [x] Add failing resolver tests for the fallback rules, copied from the PostgreSQL spec
- [x] Add failing rendering tests for prefixed tables through `sqliteFormatter`
- [x] Add failing tests proving no create-schema statement is emitted
- [x] Add failing tests for `schema.sql()` equalling the factory output and `schema.print()` matching it
- [x] Add failing tests for migration table placement, default and overridden
- [x] Add failing tests proving configured history holds no pre-schema-support entries
- [x] Add the duplicated `eventStoreDatabaseSchema` resolver and its types
- [x] Add the `tableReference` helper and convert `tables.ts` to `...For(databaseSchemaName)` factories
- [x] Add `eventStoreSchemaSQL` and switch `schema.sql()` to the formatter
- [x] Add `schemaMigrationFor` with `ignoreHashMismatch` and `eventStoreSchemaMigrationsFor`, deferred from Phase 1
- [x] Widen the public `schema` option
- [x] Add configured-schema dry-run coverage, matching the PostgreSQL test
- [x] Add mixed-schema migration coverage through `eventStore.schema.migrate()`, matching the PostgreSQL test
- [x] Set `currentSQLiteEventStoreSchemaVersion` and snapshot the current schema in the newest version folder
- [x] Run focused tests, `npm run build:ts`, `npm run fix`, `npm run test:unit`
- [x] Review for consistency, naming, dead code and redundant abstractions
- [x] Stop for approval before Phase 3

Notes:

- `schemaSQL` moved from `tables.ts` to `eventStoreSchemaSQL.ts`, as PostgreSQL has it. The package still exports it.
- `currentSQLiteEventStoreSchemaVersion` was `'0.42.0'` at the end of Phase 2, because SQLite had no 0.43.0 migration. Phase 3 added one, so it is now `'0.43.0'` and the newest-version snapshot moved to `0_43_0.snapshot.int.spec.ts`.
- The mixed-schema migration test stops at object placement. PostgreSQL's also appends and reads; SQLite gains that in Phase 3, when the runtime SQL is qualified.
- PostgreSQL's `public` cases have no SQLite counterpart. SQLite has no default database schema name: Pongo and Dumbo both fall back to the `DefaultDatabaseSchemaName` sentinel, which renders as no prefix at all. The spec pins that instead, with a test proving omitted names render unprefixed.

## Phase 3: append and read isolation

- [x] Start phase after approval
- [x] Add failing tests for append and read against a configured prefix
- [x] Add failing tests for two prefixes staying isolated with identical stream names
- [x] Add failing tests for `autoMigration: 'None'` against an existing configured store
- [x] Mirror append and read coverage on D1
- [x] Qualify append, stream existence, stream read, batch read and last position
- [x] Run focused tests, `npm run build:ts`, `npm run fix`, `npm run test:unit`
- [x] Review for consistency, naming, dead code and redundant abstractions
- [x] Stop for approval before Phase 4

Notes:

- The mixed-schema migration test in `migrations/current/migration.int.spec.ts` now appends and reads, closing the Phase 2 gap against PostgreSQL.
- `readMessagesBatch` and `readLastMessageGlobalPosition` take `databaseSchemaName` but nothing in production reads it yet. `sqliteMessageSource` forwards it in Phase 4, together with the consumer `schema` option.
- `SQLiteStreamExistsOptions.partition` changed from required to optional, matching `PostgresStreamExistsOptions`. The event store needs to add the resolved schema name to the user's options, and the implementation already defaulted the partition.

Two pre-existing `streamExists` bugs found and fixed on Oskar's approval:

- The SQL aliased the result as `as exists`, which SQLite rejects as a syntax error, so `eventStore.streamExists` always threw. The alias now goes through `SQL.identifier`.
- `appendToStream` wrote the `emt_streams` partition as `streamsTable.columns.partition`, the column descriptor object, so the row stored `{"name":"partition"}` while `streamExists` filtered on `emt:default`. Both the insert and the update now use `defaultTag`, as PostgreSQL does.

The partition fix breaks appends to streams in released databases, because the append `UPDATE` no longer matches their rows. `migrations/0_43_0` repairs them. It sits in `pastEventStoreSchemaMigrations`, the default chain only: a configured prefix never ran the buggy code, so recording it there would be a no-op history entry. Like the 0.42.0 step it opens with `CREATE TABLE IF NOT EXISTS emt_streams`, because SQLite has no conditional statement and the repair runs before the current schema migration creates the table.

- `migrations/0_42_0/legacyApi.ts` reproduces the 0.42.0 append, including its stream partition, so the repair tests seed through the released write path instead of raw inserts. `migrations/0_43_0/legacyApi.ts` re-exports it, as PostgreSQL chains its own per-version legacy APIs.

Both drivers now have the same configured-schema e2e coverage. Phase 3 first mirrored append and read on D1 only, which left `SQLiteEventStore.sqlite3.e2e.spec.ts` behind.

## Phase 4: checkpoints, processors, consumers and hooks

- [x] Start phase after approval
- [x] Add failing tests for processor checkpoints landing in the configured prefix
- [x] Add failing tests for store-created and standalone consumers targeting it
- [x] Add failing tests for `withSession`, a supplied pool, the ambient connection path and the D1 session mode
- [x] Add failing tests for both schema hooks receiving the resolved names
- [x] Add the consumer `schema` option and build the prepared metadata once
- [x] Forward the metadata to the message source, the checkpointer and the processing scopes
- [x] Change the hook signatures to carry the resolved context
- [x] Run focused tests, `npm run build:ts`, `npm run fix`, `npm run test:unit`
- [x] Review for consistency, naming, dead code and redundant abstractions
- [x] Stop for approval before Phase 5

Notes:

- `readProcessorCheckpoint` and `storeProcessorCheckpoint` take `databaseSchemaName`, and `sqliteCheckpointer` reads it from `context.migrationOptions`, as PostgreSQL does.
- `sqliteProcessingScope` and `sqliteWorkflowProcessingScope` put `migrationOptions` in the handler context, so a processor keeps working outside the consumer.
- `SQLiteProcessorOptionsBase` gives reactor, projector and workflow options the same `EventStoreSchemaMigrationOptions`. Only the projector had it before.
- The workflow message store built on `sqliteAmbientConnectionPool` now keeps the configured schema next to `autoMigration: 'None'`. Without it the workflow wrote its output to the unprefixed tables.
- Both hooks take `SQLiteProjectionHandlerContext`, which gained `EventStoreSchemaMigrationOptions` as PostgreSQL's projection context has. `createEventStoreSchema` builds that context once from the migration transaction and passes it to both hooks and to inline projection init, which stops rebuilding its own.
- The hook context executes on `tx.execute` rather than `connection.execute`, so inline projection init shares the migration transaction. Its `driverType` comes from the pool instead of the driver option.
- `withSession` and a supplied pool needed no change. Both have regression coverage now, matching the PostgreSQL consumer schema spec.
- Reactor handler context has no `messageStore` on SQLite, so the PostgreSQL tests that append from a reactor have no direct counterpart. The workflow processor covers the same message-store path.
- SQLite deadlocks when a test appends through a pool that a running consumer shares, so these tests append before starting the consumer, as the other SQLite consumer specs do.

Alignment pass against PostgreSQL found three gaps, all closed:

- `eventStore.consumer()` passed its whole `options.schema`, including `autoMigration`. It now passes the resolved `databaseSchema`, as PostgreSQL does, so the consumer never sees a migration style it has no use for.
- The two processing scopes took `migrationOptions` differently, one in an options object and one positionally. Both take it positionally now.
- Each test that builds its own store closes it, as the PostgreSQL spec does. Only the supplied-pool test keeps the shared pool, which PostgreSQL also leaves to its `afterAll`.

One difference stays on purpose: the consumer's `scope` hands a partial context, and `sqliteProcessingScope` fills in `migrationOptions` for every processor. PostgreSQL puts it in the consumer scope because there the scope builds the whole context.

## Phase 5: Pongo and raw projections

- [x] Start phase after approval
- [x] Add failing tests for a Pongo projection inheriting the event prefix
- [x] Add failing tests for a separate projection prefix and for a collection-level override winning
- [x] Add failing tests proving init, handle and truncate agree on the collection schema
- [x] Add failing tests proving Pongo records migrations in the shared migration table
- [x] Add failing tests for raw SQL projections receiving the resolved names
- [x] Add failing tests for `SQLiteProjectionSpec` and `expectPongoDocuments` honoring the configuration
- [x] Add `pongoSchemaOptions` and spread it into every `pongoClient` call
- [x] Replace the `// TODO: ADD migration options` with the real `collection.schema.migrate` call
- [x] Add tests proving `ignoreMigrationHashMismatch` reaches the Pongo collection migration, in both dialects
- [x] Fix the copied `postgresql` projection `kind` strings in the SQLite package
- [x] Run focused tests, `npm run build:ts`, `npm run fix`, `npm run test:unit`
- [x] Review for consistency, naming, dead code and redundant abstractions
- [x] Stop for approval before Phase 6

Notes:

- `handleProjections` dropped `migrationOptions` before calling `projection.handle`, so no projection reached by an append ever saw the resolved names. It now forwards it, as PostgreSQL does, and the event store passes `migrationOptions: databaseSchema` at the inline projection call site, matching `postgreSQLEventStore.ts`.
- `pongoSchemaOptions(context)` returns `{ defaultSchemaName, migrationTable }` and is spread into all four `pongoClient` calls: handle, truncate and init in `pongoProjection`, and truncate in `pongoMultiStreamProjection`.
- `SQLiteProjectionSpec` gained the `schema` option. It resolves `migrationOptions` once and passes it to projection init, to `handleProjections` and to the assert callback, as `PostgreSQLProjectionSpec` does. `SQLiteProjectionAssert` therefore carries `migrationOptions`, which `expectPongoDocuments` and the other Pongo assert helpers forward to their own `pongoClient`.
- The three `kind` strings said `postgresql` inside the SQLite package. They now say `sqlite`.
- `collection.schema.migrate(context.migrationOptions)` replaced the `// TODO: ADD migration options`. Pongo's `migrate` spreads the argument into `runSQLMigrations` and falls back to the client-level value for `migrationTable` only, so `dryRun`, `ignoreMigrationHashMismatch`, `migrationTimeoutMs` and `session` reach the collection migration through this argument and nowhere else. Inline projection init runs inside `createEventStoreSchema`, whose context carries the full `CreateEventStoreSchemaOptions`, so this is the path that needs them.
- `migrationTable` alone is redundant, because `pongoSchemaOptions` puts it on the client. `dryRun` is unobservable on SQLite for a different reason: `createEventStoreSchema` runs the hooks and the migration in one transaction and rolls it back on a dry run, so the collection table disappears whether or not Pongo also treated its own migration as a dry run.
- `ignoreMigrationHashMismatch` is covered now, in both dialects. Pongo records a collection migration as `table:pongo_collection:<schema>:<collection>:create` and gives it no `ignoreHashMismatch` flag, unlike Emmett's own current migration, which carries the flag and therefore never consults the option. So the collection migration is the only step in the chain where the option decides anything. The test migrates, changes that row's `sql_hash`, then asserts `schema.migrate()` rejects with `Migration hash mismatch` and `schema.migrate({ ignoreMigrationHashMismatch: true })` succeeds and still projects. Removing the argument from `collection.schema.migrate` fails it in both packages, which is what proves the test is not vacuous.
- The test was written after the implementation, not before. That was a TDD miss on my side, not a decision.
- Truncate has no public SQLite entry point until Phase 6 adds `schema.dangerous.truncate`, so its test drives `projection.truncate` directly. Phase 6 should replace that with the public path.
- The collection-level `databaseSchemaName` override needed no implementation change. Pongo resolves it itself, so that test passed from the first run and stays as a regression guard.
- Pongo projections registered on a consumer were broken on SQLite before this phase, independently of schema support. `SQLiteProcessorHandlerContext` carried no `driverType`, so `pongoDriverRegistry.tryResolve(undefined)` returned `null` and `pongoClient` threw during projector init. Inline projections and `SQLiteProjectionSpec` build their context from `options.driver.driverType`, so they always worked; only `sqliteProcessingScope` was missing the field. Nothing in the package called `consumer.projector`, so no existing test covered it. The context now declares `driverType` and both scopes fill it from the connection.
- `SQLiteProjectionSpec` never built an event store, so its `schema` option reached projections but never the store and `autoMigration` was dead. It now creates the store and migrates, matching `PostgreSQLProjectionSpec`.
- `PongoAssertOptions` gained `collectionOptions`, so `expectPongoDocuments` can assert against a collection-level schema override. PostgreSQL already had it.
- `PostgreSQLProcessorHandlerContext` and `PostgreSQLProjectionHandlerContext` gained `driverType`, matching SQLite, so both dialects hand a projection the driver it runs on. Nothing in the PostgreSQL package consumes it yet. Its Pongo call site keeps importing `pgDriver`, because Pongo has no driver-agnostic way to build a PostgreSQL database from an ambient client: `connectionString` is driver-specific and missing from `PongoClientOptions<AnyPongoDriver>`, and passing `pool` instead loses the database name and lets Pongo check out a connection outside the projection transaction.
- PostgreSQL gained the two tests this phase showed it was missing: end-to-end projection-schema inheritance, and `expectPongoDocuments` against a configured projection schema. Both passed on the existing implementation.
- Projector coverage reached parity with PostgreSQL. `sqliteEventStoreConsumer.projections.int.spec.ts` and `sqliteEventStoreConsumer.inMemory.projections.int.spec.ts` mirror the PostgreSQL files: events appended before start, after start, an explicit start position, CURRENT not stored, CURRENT stored on restart, CURRENT stored for a new consumer, plus catch-up for a store-created consumer. Reverting the `driverType` fix fails all seven Pongo ones, which is what proves they exercise the defect.
- The async Pongo schema test sits in `sqliteEventStoreConsumer.schema.int.spec.ts`, matching where PostgreSQL keeps it, not in the Pongo projection spec.
- Pongo projection assertions read documents through Pongo instead of counting rows with raw SQL. A count proves a row exists in a table with the right name; a full `assertDeepEqual` on the document proves the projection wrote the right content, and `_version` catches a projection that ran twice. Truncation asserts the document is gone rather than counting. Both dialects were converted, including the PostgreSQL tests that predate this phase.
- `PongoCollection.countDocuments()` is typed `Promise<number>` but resolves to a string on PostgreSQL. Not used in the end, worth reporting upstream.
- `sqliteProcessor.transactions.int.spec.ts` failed once during a full integration run and passed on four consecutive full runs afterwards, and always in isolation. It looks like lock contention under load rather than a regression, but it is a flake worth watching.

## Phase 6: truncate

- [x] Start phase after approval
- [x] Add failing tests for `schema.dangerous.truncate` emptying only the configured prefix
- [x] Add failing tests for projection storage truncation targeting the projection prefix
- [x] Move the Phase 5 Pongo truncate test onto `schema.dangerous.truncate`. It calls `projection.truncate` directly today, because Phase 5 had no public truncate entry point. `postgreSQLEventStore.ts:388` shows the shape: the truncate path passes `migrationOptions: databaseSchema` to every projection's `truncate`.
- [x] Implement `truncateTables` and the `schema.dangerous` surface
- [x] Run focused tests, `npm run build:ts`, `npm run fix`, `npm run test:unit`
- [x] Review for consistency, naming, dead code and redundant abstractions
- [x] Backfill the two missing schema-name truncate tests on PostgreSQL
- [x] Stop for approval before Phase 7

Notes:

- SQLite has no `TRUNCATE` statement, so `truncateTables` runs one `DELETE FROM` per table instead of PostgreSQL's single multi-table statement with `CASCADE`.
- The SQLite signature drops `resetSequences`. `global_position INTEGER PRIMARY KEY` in `tables.ts` is a plain rowid alias with no `AUTOINCREMENT`, so there is no `sqlite_sequence` row to survive a delete and the next insert gets 1 on its own. Accepting an option that has nothing to restart would be a lie in the type, so it is absent. `truncateTables.int.spec.ts` pins the restart down as behavior rather than as an option.
- `truncateTables` is not re-exported from `schema/index.ts`. `SQLiteEventStore.ts` imports it directly from `./schema/truncateTables`, which is what `postgreSQLEventStore.ts` does.
- `schema.dangerous.truncate` builds a new context object for each projection, spreading the shared fields and adding `migrationOptions` and `observabilityScope` inside the loop. This matches `postgreSQLEventStore.ts`. A single shared object would carry a projection's changes to the next projection. No projection changes the context today, so the two forms behave the same, but the per-projection object is the safer one.
- It takes `driverType` from `options.driver.driverType`, matching the append path, not `pool.driverType`, which is what `createEventStoreSchema` uses.
- Four tests cover this. Three drive `truncateTables` directly: default schema, prefix isolation between `events` and `other_events`, and the global position restarting at 1. The fourth drives `schema.dangerous.truncate` through two stores over one file and proves the store forwards its own `databaseSchemaName`. Removing that argument fails only the fourth, with `SQLITE_ERROR: no such table: emt_streams`, because the unprefixed tables do not exist in that database.
- The Pongo truncate test now goes through `eventStore.schema.dangerous.truncate({ truncateProjections: true })`, matching `postgreSQLPongoProjection.schema.int.spec.ts`, and no longer reaches into `projection.truncate`.
- The store-level test was written after the implementation, because the implementation had to exist before the public API could be called. The coverage check above is what stands in for the red step.
- `npm run test:unit` prints a `MaxListenersExceededWarning` for SIGTERM and SIGINT. It appears on packages this branch does not touch, so it is a vitest runner artifact, not Phase 6.
- The alignment pass found that PostgreSQL had no test passing `databaseSchemaName` to `truncateTables` or driving `schema.dangerous.truncate` against a configured schema, although both supported it. Both tests were backfilled into `truncateTables.int.spec.ts`. PostgreSQL specs share one database, so the schema names are uniquified per test with a `schemaName(prefix)` helper, as `postgreSQLPongoProjection.schema.int.spec.ts` does, and the counts go through a schema-aware helper that leaves the existing unqualified `getTableCount` alone. Removing `databaseSchemaName` from the store's truncate call fails only the store-level test; making `truncateTables` build its `TRUNCATE` without the schema fails both.

## Phase 7: identifier safety, regression coverage and docs

- [x] Start phase after approval
- [x] Confirm generated SQL holds no accidental unprefixed reference
- [x] Confirm default behavior and existing fixtures are unchanged
- [x] Document the options, the fallback rules and the shared migration table
- [x] Document how a SQLite prefix differs from a PostgreSQL schema
- [x] Document that locks, projection management and rebuild are not implemented on SQLite
- [x] Record the Dumbo follow-ups found during the work in `plan.md`
- [x] Run focused tests, `npm run build:ts`, `npm run fix`, `npm run test:unit`
- [x] Review for consistency, naming, dead code and redundant abstractions
- [ ] Stop for approval

Scope cut agreed before starting the phase: Emmett tests the sticky points and the
integration, not Pongo and Dumbo internals. Three planned items were dropped.

- Prefixes with capitals, spaces and a double quote. This tests `sqliteFormatter`
  quoting. Emmett never builds those names itself, it passes `SQLTableReference`
  tokens through.
- A prefix containing `.` surfacing Dumbo's error unchanged. A pure assert on
  Dumbo's `assertNativeName`.
- Index names going through `sqliteIndexName`. The helper lives in Dumbo, has no
  call site in `emmett-sqlite`, and the package creates no named index. The four
  tables use inline `PRIMARY KEY` and `UNIQUE` constraints, so SQLite only builds
  implicit `sqlite_autoindex_*` names derived from the already prefixed table name.

Notes:

- The guard test collects every `emt_*` reference in the rendered SQL and asserts each one carries the configured prefix, instead of naming objects by hand. It scales as tables are added. The first version accepted an unquoted `events.emt_streams`, which on SQLite means an attached database rather than a prefixed table; the assertion now requires the opening quote.
- The review found that the documentation claimed `databaseSchemaName` holds projection registrations. That is PostgreSQL wording. SQLite creates `emt_projections` and never reads or writes it, so the claim contradicted the Limitations list a few lines below it. Both files now say the event-store tables and processor checkpoints.
- The documentation now attributes the `.` rejection to Dumbo at SQL render time, not to Emmett at configuration time, and states that changing or removing `databaseSchemaName` later leaves the old prefixed tables behind.
- The review flagged the `databaseSchemaName` parameter of `latestGlobalPosition` in `truncateTables.int.spec.ts` as dead, and it was removed. That was wrong. The parameter was an uncovered case, not dead code: no test checked the global position restart inside a configured schema. The parameter is restored and `restarts the global position at 1 only in the truncated database schema` now covers it. A missing test must not be resolved by deleting the affordance that asks for it.
- The SQLite work exposed two PostgreSQL gaps, both backfilled. First, all three `resetSequences` tests ran against the default schema, and the spec helper read through `SQL.identifier`, so it could not observe a configured schema at all. Dropping the schema from the `ALTER SEQUENCE` target left those three tests green and failed only the new one. This matters more on PostgreSQL than on SQLite, because PostgreSQL has a real named sequence per schema, so a wrong name resets another store's sequence rather than erroring. Second, PostgreSQL had no unqualified-reference guard. Pointing the messages index at an unqualified table passed the hand-written test and failed only the new guard.
- The PostgreSQL guard needs three exclusions that SQLite does not. Of 85 `emt_` occurrences in the rendered SQL, 41 are legitimately bare: `format()` arguments paired with a separate schema literal, `pg_proc` name lookups, dollar-quote body tags, and `ON CONFLICT` target aliases, where a qualified name is not valid syntax. The guard therefore skips quoted names, and cannot catch a regression inside the dynamic SQL built with `format('%I.%I', ...)` or a `pg_proc` lookup that lost its `nspname` clause. Everything rendered as a real identifier is covered.
- Test names using "prints" were renamed to "renders" in both unit specs, along with the `printedSQL` variable. `describePostgreSQL` and `describeSQLite` render SQL tokens to a string and reach no console. The word came from the real `schema.print()` API. Only `prints the schema SQL it describes` on the SQLite side calls it and keeps the name.

## Follow-up issues to open

- [ ] Schema migration observability. `schema.migrate()` is not instrumented in either dialect, so the schema context always carries `noopScope` and hooks, inline projection init and the migration itself produce no span. See the follow-up section in `plan.md`. Discuss after the SQLite work lands.
- [ ] Schema hook context naming. Both schema hooks take a projection handler context in both dialects, although they receive the migration transaction and the resolved schema names, nothing projection-specific. See the follow-up section in `plan.md`. Discuss after the SQLite work lands.
- [ ] SQLite processor and projection locks, including a design that works on D1
- [ ] SQLite projection management in `emt_projections`
- [ ] `rebuildSQLiteProjections`, after locks and projection management land
- [ ] The empty `cli.ts` and a SQLite migration command line
