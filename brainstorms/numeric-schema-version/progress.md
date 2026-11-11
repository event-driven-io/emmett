# Progress

## Step 8. Optional version argument and internal helper types

Status: done.

What was done:

- `WithSchemaVersionArgument` (`src/packages/emmett/src/typing/messageSchemaVersion.ts`) returns `Args | [...Args, schemaVersion: 1]` when `undefined extends T['schemaVersion']`. Unversioned types, version 1 types, the generic types and unions of versions accept only an optional trailing `1`.
- `command()` dropped its own unversioned-without-metadata tuple and uses the same two-branch union as versioned commands, so `command<C1>(type, data, 1)`, `(type, data, { now }, 1)` and `(type, data, undefined, 1)` compile.
- `MessageSchemaVersionOf` moved from `message.ts` to `messageSchemaVersion.ts`, so the package no longer exports it.
- `messageSchemaVersion.unit.spec.ts`: the old `@ts-expect-error` cases for `1` became accepted calls. The plan's tests were added (2.8, 2.9, 3.3 and the extras), plus `@ts-expect-error` checks that reject `event<Event>(..., 7)` and `event<V1 | V2>(..., d1, 2)`. The 3.3 test uses `import type * as emmett from '../index'`. A manual check showed it fails when the type is exported again.

Review: `reviews/20261111T093326_step8_review.md`. The first review blocked on two `plan` findings. The coordinator pointed to the spec, which decides both. Step-1 is fixed: the optional argument is the literal `1`, as spec Helpers says. Step-2 is rejected: those tests guard existing behaviour. `event<V1 | V2>(..., v2Data, 1)` is the accepted limit (spec "Out of scope", Q77/Q99).

Checks: vitest on the spec file (33 passed), `npm run build:ts`, `npm run agent:check` and `npm run test:unit` (155 files, 2012 passed, 2 skipped) all pass.

## Step 9. Read rule per store

Status: done.

What was done:

- `resolveSchemaVersion(stored, metadata?)`: `metadata` is optional. MongoDB (`readStream` and the message source), EventStoreDB (`mapFromESDBEvent`) and in-memory call it with the stored value only. The PostgreSQL reads still pass the metadata.
- MongoDB `legacyCases[0]` is renamed to "reads version 1 when only the metadata has a version" and expects `1`. It failed before the change and passes after it.
- In-memory: the new `emmett/src/eventStore/inMemoryEventStore.schemaVersion.unit.spec.ts` holds the 6.5 test. It protects existing behaviour.
- Shared features: added 7.2 ("Appends an event with schema version -1 without validating it") and 9.3 ("Records the schema version of each result of a downcaster that returns either version").
- Core unit tests: the optional metadata, and the 6.6 values (`'02'`, `'2.0'`, `'-1'`, `' 2'`, `2`).
- PostgreSQL: the six step 7 tests moved into a nested `describe('on a released 0.43.0 store')` in `readStream.int.spec.ts` and `readMessagesBatch.int.spec.ts`. Each test builds its own `sharedPostgreSQLDatabase` with the 0.36.0, 0.38.7 and 0.42.0 sets plus `releasedMigrations_0_43_0`, and inserts its rows with SQL. The non-numeric column value is `'v1'`, or `'v2'` for 6.4. Added 6.3 to both files, and 6.6 and 6.7 to `readStream.int.spec.ts` only. The `readMessagesBatch` reads use `asyncRetry`, as the 15.4 test does.

Review: `reviews/20261111T101130_step9_review.md`. Clean. The review notes that the in-memory and EventStoreDB code changes do not change behaviour, because both stores always have a stored version.

Checks: the vitest runs on the changed specs passed. These were the core `schemaVersion` tests, the in-memory spec, both PostgreSQL read specs, the MongoDB and EventStoreDB schema version specs, and the MongoDB and EventStoreDB shared e2e features. `npm run agent:check` and `npm run test:unit` (156 files, 2022 passed, 2 skipped) also passed.

## Step 10. PostgreSQL append functions, fresh `INT` layout, appends through the new function, blue/green

Status: done, built against plan r7 and spec r12 (Q119 to Q122).

What was done:

- PostgreSQL append functions:
  - `appendToStream.ts` has one module-local body builder for the current schema.
  - The old `emt_append_to_stream` (`text[]`) gets a converting body. It raises an exception when a version is not `^[0-9]+$` and inserts `::int`.
  - The new `emt_append_to_stream_v_0_43_0` (`int[]`) inserts the values as they are. It is added to `eventStoreSchemaSQL`.
- Appends from the current release:
  - `callAppendToStream` calls the new function with explicit casts on every argument. `schemaVersions` is `number[]`.
  - The stored metadata gets the string copy, written after the user metadata.
  - Recorded messages, including those handed to hooks, have the top-level version and no `metadata.schemaVersion`.
- Fresh layout: `message_schema_version INT NOT NULL` sits after `created` and before `is_archived`.
- Migration `emt:postgresql:eventstore:0.43.0:add-numeric-schema-version-append`:
  - It holds its full SQL inline (Q121).
  - It runs only when the old function exists.
  - It is in `migrations_0_43_0` and in the custom schema list.
- The frozen `callAppendToStream` is exported from `0_43_0/legacyApi.ts`.
- Q119: PostgreSQL `readStream` and `readMessagesBatch` map `message_kind` `'C'` to `'Command'`, and anything else to `'Event'`.
- Q120: `isNumericSchemaVersion` requires a stored number to be `>= 0`, so `-1` reads as `1` in every store.
  - The shared feature "Appends an event with schema version -1 without validating it" now expects `1`.
  - Core unit tests cover `-1`.
  - The TEXT column test is kept.
- Q122: core `schemaVersionToAppend(schemaVersion, metadata)` returns the top-level version, else the numeric `metadata.schemaVersion`, else `1`.
  - The in-memory, MongoDB, EventStoreDB and PostgreSQL appends call it. `appentToStreamRaw` calls it too.
  - Shared features cover 4.9 to 4.11.
  - The in-memory 6.5 spec from step 9 is removed.
  - The PostgreSQL hook test expects `2`, `1`, `2`.
  - The MongoDB `legacyCases` and the PostgreSQL 6.x tests insert their rows directly, so they are unchanged.
- Tests for the step's criteria:
  - 5.2, 20.3, the metadata copy and the hooks in `appendToStream.int.spec.ts`.
  - 20.1 for the default and a custom schema in `createEventStoreSchema.int.spec.ts`.
  - The command kind in `readMessagesBatch.int.spec.ts`.
  - `describe('numeric schema version appends')` in `0_43_0.migration.int.spec.ts` covers:
    - 7.3 (kept), 11.1/11.2 and 12.1 to 12.3;
    - 14.1 and 14.2 on the TEXT column, and 14.3 to 14.6;
    - 15.3, 20.4, 24.1 and the second migration run.
  - The shared features are wired for PostgreSQL in `emmett-tests`.
- Existing tests and snapshots:
  - The broken existing tests, the custom schema lists and both snapshots are updated.
  - The snapshot diff shows only the column, the converting body, the new function and the new migration.
- The released 0.43.0 store in the new tests also records `emt:postgresql:eventstore:initial`, as a real 0.43.0 store does.
  - Without that record, the upgrade runs the current initial schema, which creates the new function by itself.
  - With it, 13 of the new tests fail when the migration's function statements are removed.

Review: `reviews/20261111T114108_step10_review.md`.

- First review: Step-1, Standards-1, Standards-2(a) and Standards-3 are fixed.
- Re-review: Step had no findings. Standards-4 (partial use of the `recordedEvent` helper) is fixed.
- Open:
  - Step-2 (plan): the plan Terms "Append rule" and the step 13 text still describe `schemaVersion ?? 1`. Spec r12 and Q122 decide the rule, and step 10 follows them.
  - Standards-2(b): only the new tests' released 0.43.0 store records the initial migration. `releasedMigrations_0_43_0` and the step 1, 7 and 9 tests do not. Steps 11 and 12 should decide whether to share it.

Checks:

- vitest on `packages/emmett-postgresql`, plus the PostgreSQL, in-memory, MongoDB and EventStoreDB shared e2e specs and the MongoDB and EventStoreDB schema version specs: 85 files, 887 passed, 3 skipped.
- `npm run agent:check` passed.
- `npm run test:unit` passed: 155 files, 2033 passed, 2 skipped.

## Step 11. On-demand schema version migration and the prepared 0.44.0 migration

Status: done, built against plan r8 and spec r12.

What was done:

- `schema/migrations/numericMessageSchemaVersionMigration.ts`: internal `numericMessageSchemaVersionMigrationFor(name, options)`, not exported from the package entry.
  - One `sqlMigration` with `ignoreHashMismatch: true` and a `DO` block that runs `ALTER TABLE ... TYPE INT USING COALESCE(<user CASE>, <numeric column>, <numeric metadata>, 1)` only when the column is not `integer`.
  - A whole JSON number of 0 or more in metadata is taken as it is (Q120). A JSON string must match `^[0-9]+$`.
- `schema/migrateSchemaToNumericMessageSchemaVersion.ts`, exported through `schema/index.ts`:
  - It takes the consumer connection options, the schema options, `messageSchemaVersionMapping`, `dryRun` and `migrationTimeoutMS`.
  - It calls `runSQLMigrations` directly. `dryRun: 'transactional'` rolls back, `'diff'` runs nothing.
  - Two simultaneous runs are not tested or guarded: 16.14 was removed (Q125, Dumbo locking, issue Pongo #235).
- 0.44.0: `migration_0_44_0_numericMessageSchemaVersionFor(options)` and the default constant, added to `migrations_0_44_0` after the checkpoint cleanup with the double-check comment. The snapshot diff shows only the new entry.
- Tests: `schema/migrateSchemaToNumericMessageSchemaVersion.int.spec.ts` runs the shared criteria for both the schema version migration and the mandatory migration (16.1 to 16.7, 16.9, 16.10, 16.13, 13.1, 13.2, 23.1, 23.2, 23.4, 23.5, 24.3, 24.4, the JSON number rule), and the on-demand-only ones (16.8, 16.11, 16.12, 16.15, the metadata too-large extra, 13.3, 13.5, 14.1, 14.2, 17.1, 23.3). `0_44_0.migration.int.spec.ts` asserts the column is `integer` after the set runs.

Deviations and notes:

- Dumbo's default migrations table is `dmb_migrations`, not `emt_migrations` as the plan says. Test 17.1 queries `dmb_migrations`.
- I wrote the implementation before the tests, so the red run was not observed. The tests fail without the `ALTER` because the column stays `text`.

Checks: see the outcome.

Review: `reviews/20261111T140000_step11_review.md` (earlier: 120000, 130000).

- All implementation findings are fixed, including the lock-wait filter (database and query text) and the stale record.
- The metadata too-large extra test passed when first written, before any code change: the SQL already fails on overflow.
- Q125 decided the earlier plan and spec findings. Nothing is left for the plan, spec or qa.

Checks:

- vitest on `packages/emmett-postgresql`, twice: 80 files, 708 passed, 3 skipped.
- `npm run agent:check` passed.
- `npm run test:unit` passed: 155 files, 2033 passed, 2 skipped.

Step 11, change from Q126 (plan r10): the test "fails on the timeout while another transaction holds a lock" uses `migrationTimeoutMS: 10` and asserts Dumbo's `QueryCanceledError`.

- With the old 1000 ms timeout, the added `instanceof QueryCanceledError` check failed: the error is a `QueryCanceledError` by `errorType`, but `pg.js` bundles its own class copy, so `instanceof` is false. The test uses `DumboError.isInstanceOf(error, { errorType: QueryCanceledError.ErrorType })`.
- The file passed three times in a row with 10 ms. `npm run agent:check` passed. No review re-run, as agreed.

## Step 12 (plan r11). On-demand tetris migration

Moved out of this change to https://github.com/event-driven-io/emmett/issues/428 (Q128). The code and tests below were removed. Plan r12 renumbers SQLite and docs to steps 12 and 13.

Status: done, built against plan r10 and spec r12. The review was not run (see below).

What was done:

- `schema/migrations/optimisedStorageLayoutMigration.ts`: internal `optimisedStorageLayoutMigrationFor(name, options)`. One `sqlMigration` with `ignoreHashMismatch: true` and one `DO` block:
  - It takes `EXCLUSIVE` on the messages table, then returns without changes when `message_schema_version` is `integer` and right after `created`.
  - It creates `emt_messages_tetris` (fresh layout) and recreates every partition and sub-partition from `pg_inherits` and the stored bounds, under temporary names.
  - It copies all rows with the version expression picked from the column type. `TEXT`: user `CASE`, column regex, metadata, `1` (step 11's fragments, now exported). `INT`: user `CASE`, the column as it is.
  - It takes `ACCESS EXCLUSIVE`, drops the old table, then renames tables, primary keys, the `transaction_id` indexes and the `NOT NULL` constraints to the names a fresh store has.
- `schema/migrateToOptimisedPostgreSQLStorageLayout.ts`: same shape and options as the schema version migration function, exported through `schema/index.ts`.
- Tests added to `migrateSchemaToNumericMessageSchemaVersion.int.spec.ts` in a `tetris migration` block: 18.1 to 18.13, 13.4, 13.6, 17.1 part, 24.3 part. The concurrency tests ran five times in a row, green.

Deviations and notes:

- The new table is created with its primary key and the `transaction_id` index before the copy, not after. This keeps the `CREATE TABLE` close to the fresh layout. A copy into an indexed table is slower than building indexes after it.
- The `CREATE TABLE` for the temporary table is written in the migration, not taken from `messagesTableSQLFor`. Giving `messagesTableSQLFor` an index name or table name changes the 0.43.0 and 0.44.0 schema snapshots. The 18.1 test compares with a fresh store, so a layout change in `messagesTableSQLFor` fails it.
- Index and constraint names of the partitions are probed from a temporary table with the final name, so PostgreSQL's own truncation rules give the same names as a fresh store.
- The `global_position` default is created with the table and points at the same sequence. There is no separate restore step.
- A schema without a messages table fails with the `LOCK TABLE` error. No test or spec rule asks for a silent skip.
- Grants and views on the old messages table are not carried over; `DROP TABLE` fails when a view depends on it.
- I wrote the tests first and saw them fail only through a missing module. Later failures came from the implementation (partition parent, index names, `NOT NULL` names on PostgreSQL 18) and were fixed in that order.
- Review: not run. This agent could not start a fresh-context subagent, so the caller runs `review-implementation`.

Checks:

- `vitest` on `packages/emmett-postgresql`: 80 files, 727 passed, 3 skipped.
- `npm run agent:check` passed.
- `npm run test:unit` passed: 155 files, 2033 passed, 2 skipped.
