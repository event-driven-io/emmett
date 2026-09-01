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
- [ ] Stop for approval before Phase 2

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
- [ ] Stop for approval before Phase 3

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
- [ ] Stop for approval before Phase 4

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

- [ ] Start phase after approval
- [ ] Add failing tests for processor checkpoints landing in the configured prefix
- [ ] Add failing tests for store-created and standalone consumers targeting it
- [ ] Add failing tests for `withSession`, a supplied pool, the ambient connection path and the D1 session mode
- [ ] Add failing tests for both schema hooks receiving the resolved names
- [ ] Add the consumer `schema` option and build the prepared metadata once
- [ ] Forward the metadata to the message source, the checkpointer and the processing scopes
- [ ] Change the hook signatures to carry the resolved context
- [ ] Run focused tests, `npm run build:ts`, `npm run fix`, `npm run test:unit`
- [ ] Review for consistency, naming, dead code and redundant abstractions
- [ ] Stop for approval before Phase 5

## Phase 5: Pongo and raw projections

- [ ] Start phase after approval
- [ ] Add failing tests for a Pongo projection inheriting the event prefix
- [ ] Add failing tests for a separate projection prefix and for a collection-level override winning
- [ ] Add failing tests proving init, handle and truncate agree on the collection schema
- [ ] Add failing tests proving Pongo records migrations in the shared migration table
- [ ] Add failing tests for raw SQL projections receiving the resolved names
- [ ] Add failing tests for `SQLiteProjectionSpec` and `expectPongoDocuments` honoring the configuration
- [ ] Add `pongoSchemaOptions` and spread it into every `pongoClient` call
- [ ] Replace the `// TODO: ADD migration options` with the real `collection.schema.migrate` call
- [ ] Fix the copied `postgresql` projection `kind` strings in the SQLite package
- [ ] Run focused tests, `npm run build:ts`, `npm run fix`, `npm run test:unit`
- [ ] Review for consistency, naming, dead code and redundant abstractions
- [ ] Stop for approval before Phase 6

## Phase 6: truncate

- [ ] Start phase after approval
- [ ] Add failing tests for `schema.dangerous.truncate` emptying only the configured prefix
- [ ] Add failing tests for projection storage truncation targeting the projection prefix
- [ ] Implement `truncateTables` and the `schema.dangerous` surface
- [ ] Run focused tests, `npm run build:ts`, `npm run fix`, `npm run test:unit`
- [ ] Review for consistency, naming, dead code and redundant abstractions
- [ ] Stop for approval before Phase 7

## Phase 7: identifier safety, regression coverage and docs

- [ ] Start phase after approval
- [ ] Add tests for prefixes with capitals, spaces and a double quote
- [ ] Add a test proving a prefix containing `.` surfaces Dumbo's error unchanged
- [ ] Add coverage for index names going through `sqliteIndexName`
- [ ] Confirm default behavior and existing fixtures are unchanged
- [ ] Confirm generated SQL holds no accidental unprefixed reference
- [ ] Document the options, the fallback rules and the shared migration table
- [ ] Document how a SQLite prefix differs from a PostgreSQL schema
- [ ] Document that locks, projection management and rebuild are not implemented on SQLite
- [ ] Record the Dumbo follow-ups found during the work in `plan.md`
- [ ] Run focused tests, `npm run build:ts`, `npm run fix`, `npm run test:unit`
- [ ] Review for consistency, naming, dead code and redundant abstractions
- [ ] Stop for approval

## Follow-up issues to open

- [ ] SQLite processor and projection locks, including a design that works on D1
- [ ] SQLite projection management in `emt_projections`
- [ ] `rebuildSQLiteProjections`, after locks and projection management land
- [ ] The empty `cli.ts` and a SQLite migration command line
