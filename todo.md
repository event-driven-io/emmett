# Todo: bundled relational schema migrations

Plan: [plan.md](plan.md). Spec: [spec.md](spec.md).

Mark a step done only when its tests and the group gate are green. Record the gate commands and results under each group.

## Decisions (Oskar)

Decided 2026-10-09 (details in plan.md section 3):

- [x] D1 not a decision: spec non-goal already forbids a shared first-migration promise
- [x] D3 simplified: any later same-ID registration replaces; no tracking, no throw
- [x] D5 reuse Pongo clients per storage (step 6.1); Pongo `None` without a history read comes in the Dumbo and Pongo group (P.2, D8); either may become a follow-up
- [x] D6 every processor accepts `autoMigration`, default from the top; takes effect where the processor owns a run
- [x] D7 inline `init` runs under every `autoMigration` value, in `eventStore.init()`

Decided 2026-10-10:

- [x] D8 `autoMigration` gets `EnsureMigrated`; `None` reads no history; `withSession` shares the store's `init()`
- [x] D9 event store setting `schema.ignoreMigrationHashMismatch`; Pongo gets the same client setting; the hash-mismatch test checks only the `migrate()` call
- [x] D10 order per database (store, then processors and consumer, then Pongo projections stop migrating), PostgreSQL first; Dumbo and Pongo changes in parallel
- [x] Owners: event store `init()`, recursive owners, one reusable event-store schema component per owner, any processor may contribute `schema`
- [x] Accept the second history read for a store-created consumer; ideas in spec "Future improvements"

- [x] Q1 the shape of `schema` tells grouped processors from child owners
- [x] Q3 on another storage, a processor migrates only its own schema; the user sets up checkpointing
- [x] Q4 `sql()` and `print()` show the grouped graph only

Decided 2026-10-12:

- [x] D12 5.1 runs directly after 4.1; inline `init` runs without an outer transaction; the nested-transaction test passes after 5.1
- [x] D13 the Dumbo and Pongo group runs first
- [x] D11 per-call `migrate()` option `overrideMigrationHashes`, a union with `ignoreMigrationHashMismatch`; Dumbo and Pongo in GP, Emmett in A.1

## GT: driver types in consumer declarations

- [x] T.1 Bundle test for declaration emit and driver mixing, root exports, PG `Any` defaults
- [ ] Gate green (plus `npm run test:bundle`): integration specs and `npm test` not run

Status 2026-10-08:

- Red: both consumers checked against published beta.50 with TS 6.0.3 and 7.0.2. Declaration test fails (TS2883 PG, TS4023 SQLite), mixing test passes.
- `npm run build:ts`: only Codex's TS2554 at PG `pongoProjections.ts:259` (`withDatabaseSchemaName(name, dumbo)`, Dumbo beta.57 takes one argument). It was hidden because `agent:check` stops at lint.
- eslint on all files: only the two known Codex errors.
- `npm run test:unit`: 1862 passed, 2 skipped.
- `npm run test:bundle` (approved by Oskar): 2 files, 28 tests passed.
- After it, eslint reported error types in 5 processor files, because tsdown replaced `packages/*/dist`. `npm run build:ts -- --force` fixed it, and `npm run agent:check` passed.
- Outside T.1, without approval: Pongo projections rebuilt from HEAD with `schema` and without the multi-stream `init`, and a D1 `migratorOptions` hook. Both go through G0: `init` comes back (3.3), and the hook becomes `migrationOptions` (4.2).

## G0: baseline (sequential, Oskar)

- [x] Replaced: Oskar restored `src/packages` to `21802d7c`; T.1 re-applied on the clean code. The old work is in the scratchpad patch `f-full.patch`.

### G0 classification

| File | Verdict | Reason / kept hunks |
| ---- | ------- | ------------------- |

## G1: localized fixes (parallel)

- [x] 1.1 Core `projections.async()` returns async registrations
- [x] 1.2 Real registration types in PG and SQLite
- [x] 1.3 Dumbo helpers in specs and SQL
- [ ] Gate green: 6 known failures remain, owned by later steps

Status 2026-10-09:

- `npm run build:ts`: passed.
- `npm run agent:check`: passed.
- `npm run test:unit`: 143 files, 1840 passed, 2 skipped.
- All PG and SQLite specs (`npx vitest run packages/emmett-postgresql packages/emmett-sqlite`): 1102 passed, 3 skipped, 8 failed. After the snapshot update below, 6 failures remain:
  - "ignores a Pongo collection migration hash mismatch" (PG, sqlite3, d1, durableObject): the Pongo projection migrates its collection on the first append, without the ignore option. Owner: 4.1 (test rewrite, D9).
  - "rejects a nested transaction and rolls back" (sqlite3, durableObject): the inline Pongo `init` migrates its collection in a nested transaction. It fails the same way with the 1.2 change reverted. Owner: 5.1 (D12).
- 1.3: the event-store SQL renders the same (checked with temporary snapshot tests, removed after the swap). The migration hash uses this rendering, so it does not change. The two "is the latest one" snapshots (0_43_0, 0_44_0) were updated, because they store the template parts: Dumbo passes the function name as a literal instead of `'` plus a plain name.

## G2: core contracts and processor settings (parallel)

- [x] 2.1 Projection and projector schema generic, `resolveAutoMigration`
- [x] 2.2 `ConsumerHooks.onInit`, replacement by ID
- [x] 2.3 Processors take the consumer's migration options (PG, SQLite)
- [ ] Gate green: the same 6 known failures as G1, no new ones

Status 2026-10-09:

- `npm run build:ts`, `npm run agent:check`: passed.
- `npm run test:unit`: 144 files, 1859 passed, 2 skipped.
- All PG and SQLite specs: 1108 passed, 3 skipped, 6 failed (the G1 list).
- 2.1: core types `autoMigration` as the literal union `'None' | 'CreateOrUpdate'` (Oskar). `Schema` is inferred only without explicit type arguments; `projection<TestEvent>({ schema })` types it as `unknown`.
- 2.3: the PG processor lock takes the schema from its context when the processor sets none. The SQLite consumer scope now passes `driver` and `migrationOptions`; before, a SQLite array processor failed with "The handler context carries no event store driver".

## G3: declarative components (parallel)

- [x] 3.1 PG reusable event-store schema component
- [x] 3.2 SQLite reusable event-store schema component
- [x] 3.3 Pongo and raw SQL projections expose `schema` and `withDefaultSchemaName` (PG, SQLite)
- [ ] Gate green: the same 6 known failures as G1, no new ones

Status 2026-10-09:

- 3.1/3.2 redesigned with Oskar: the component only aggregates (event-store migrations plus children), no table placement. It lives in `schema/eventStoreSchemaComponent.ts`. PG and SQLite: 8 unit and 1 int test each, green.
- 3.3: projections get the store default through `withDefaultSchemaName` (spec section on core schema). PG Pongo (6 unit), PG raw SQL (3 unit), registration without schema (int), SQLite raw SQL (3 unit): green, verified red first. SQLite Pongo (6 unit): green, verified red first.
- 3.3: the multi-stream Pongo `truncate` uses the client from its context instead of opening a second one. spec.md: raw SQL handlers keep the schema name from the handler context.
- `npm run build:ts`, `npm run agent:check`: passed.
- `npm run test:unit`: 150 files, 1891 passed, 2 skipped.
- All PG and SQLite specs: 1143 passed, 3 skipped, 6 failed (the G1 list).

## G4: PostgreSQL, with the SQLite event store after 4.1 (sequential, after GP)

- [x] 4.0 Core `EnsureMigrated` (D8)
- [x] 4.1 PG event store, with `init()`, `withSession` sharing it, and `schema.ignoreMigrationHashMismatch`; Pongo hash-mismatch test rewritten on PG, sqlite3, d1 and durableObject (D9)
- [x] 5.1 SQLite event store, as 4.1 (sqlite3, d1, durableObject); inline `init` without an outer transaction; "rejects a nested transaction and rolls back" passes (D12)
- [ ] 4.2 PG processor schema and own-pool child owner
- [ ] 4.3 PG consumer owner, migrates child owners
- [ ] 4.4 PG store to consumer wiring
- [ ] 4.5 PG Pongo projections stop migrating
- Note: the 1.2 inline registration tests (`postgreSQLProjection.registration.int.spec.ts`, `sqliteProjection.registration.int.spec.ts`) trigger inline `init` through `schema.migrate()`. Switch them to `eventStore.init()` in 4.1 and 5.1.
- [ ] Gate green

Status 2026-10-10:

- 4.1 in progress. Done: composed migrator, `init()`, `component`, `ensureMigrated()`, `EnsureMigrated`, `withSession` through `storeFor`, dry-run rollback, 14 tests in `postgreSQLEventStore.init.int.spec.ts`, dry-run baseline test and PG registration tests updated. To do: `schema.ignoreMigrationHashMismatch` and its tests, the hash-mismatch test rewrite.
- All PG specs: 585 passed, 3 skipped, 1 failed: the hash-mismatch test (known since G1; fixed by its rewrite in 4.1).

Status 2026-10-12:

- Dumbo and Pongo bumped to beta.58. The SQLite projection spec helper takes the store's `schema` type, because Dumbo's `MigrationStyle` now has `EnsureMigrated` and the SQLite store gets it in 5.1.
- Done: PG `schema.ignoreMigrationHashMismatch` with 4 tests. With a custom schema name, the only event-store migration has `ignoreHashMismatch: true`, so the tests change the hash of an async Pongo collection in the store graph.
- Done: hash-mismatch test rewrite on PG, sqlite3, d1 and durableObject (green).
- Done: inline `init` on one connection without an outer transaction (D12), with a test that an init transaction is not nested. Core `ProjectionDefinition`, `ProjectionRegistration`, `projection()` and `projections.inline/async()` get an `InitContext` generic (default: the handler context). PG adds `PostgreSQLProjectionInitContext` (no `session.transaction`) and `PongoProjectionInitContext`; the store options use them. 5.1 does the same for SQLite.
- `npm run build:ts`, `npm run agent:check`: passed. `npm run test:unit`: 150 files, 1893 passed, 2 skipped.
- All PG specs: 80 files, 592 passed, 3 skipped.
- All SQLite specs: 574 passed, 2 failed: "rejects a nested transaction and rolls back" (sqlite3, durableObject), owner 5.1. In the first run, d1 "handles concurrent writes with multiple processors without SQLITE_BUSY errors" also timed out after 60 s; it passed alone (22 of 22) and in the second full run.

Status 2026-10-13:

- 5.1 done. SQLite store `migrate()`, `init()`, `ensureMigrated()` and `dryRun` modes as in 4.1; D1 driver `migrationOptions: (pool) => ({ execute: pool.execute })`; inline `init` on one connection without an outer transaction. "rejects a nested transaction and rolls back" (sqlite3, durableObject) passes (D12). The registration spec uses `eventStore.init()`.
- `createEventStoreSchema` stays; only tests use it, same as PG.
- Dumbo fix (Pongo repository, not released): `schemaComponentMigrator.migrate()` runs on the caller's `execute` in every dry-run mode and does not open its own transaction for it. It does not cache after a call with `execute`, because the caller owns the commit. The check that rejects a transactional dry run on a driver without transactions stays. Pongo `agent:check` passed, `test:unit` 1452 passed, `test:int` 904 passed.
- `npm run build:ts`, `npm run agent:check`: passed. `npm run test:unit`: 150 files, 1893 passed, 2 skipped.
- "applies the migration after the user dry-runs it first" (sqlite3, durableObject) failed with "Cannot start a nested transaction": Dumbo beta.59 drops `execute` for a transactional dry run and opens its own transaction. Fix in Emmett only, no Dumbo release needed: in SQLite and PG, the store calls `migrator.migrate({ execute: transaction.execute })` without `dryRun`, and rolls back its own transaction for a transactional dry run. The hooks and the migrations roll back together.
- After the fix: all SQLite specs 635 passed; all PG specs 80 files, 593 passed, 3 skipped; `npm run test:unit` 150 files, 1893 passed, 2 skipped. In one SQLite run, "handles concurrent writes with multiple processors" timed out twice while `build:ts` and `agent:check` ran in parallel; the next full run passed.

## G5: SQLite (sequential)

- [ ] 5.2 SQLite processors, consumer, store wiring (sqlite3, d1, durableObject)
- [ ] 5.3 SQLite Pongo projections stop migrating
- [ ] Gate green

## G6: Pongo clients

- [ ] 6.1 Reuse Pongo clients per storage (D5), or report for a follow-up
- [ ] Gate green

## G7: cross-cutting behavior (parallel)

- [ ] 7.1 Concurrent first assurances
- [ ] 7.2 PG least privilege
- [ ] 7.3 Dry run and memoization regressions
- [ ] Gate green

## GP: Dumbo and Pongo changes (Dumbo and Pongo repository, first, D13)

- [x] P.1 Dumbo `MigrationStyle` gets `EnsureMigrated`
- [x] P.2 Pongo assurance per `autoMigration` value; `None` reads no history
- [x] P.3 Pongo client and database setting `schema.ignoreMigrationHashMismatch`
- [x] P.4 Dumbo per-call `migrate()` option `overrideMigrationHashes`, a union with `ignoreMigrationHashMismatch` (D11)
- [x] P.5 Pongo `db.schema.migrate()` passes `overrideMigrationHashes`
- [x] Gate green (Pongo repository, 2026-10-12)

Status 2026-10-12:

- Pongo `None` runs no assurance and reads no history; `EnsureMigrated` calls `ensureMigrated()`; `rename()` migrates only under `CreateOrUpdate`. The `None` tests that expected `PendingMigrationsError` moved to `EnsureMigrated`, also in the rename and least-privilege tests.
- `npm run build:ts`, `npm run agent:check`: passed. `npm test`: unit 1452 passed; int 894 passed; e2e 668 passed, 5 skipped.
- Found, not fixed: `schemaComposition.type.spec.ts` > "retains literal specialization kinds through declarations and transformations" throws `Table "messages" is declared more than once`, in code GP did not change. `npm test` does not run `.type.spec` files.
- [ ] Released

## GA: adopt the Dumbo and Pongo release (needs GP released and G6)

- [ ] A.1 Use Dumbo's `MigrationStyle`, pass `ignoreMigrationHashMismatch` to Pongo clients, `eventStore.schema.migrate()` and `consumer.schema.migrate()` pass `overrideMigrationHashes`, append-after-mismatch and hash-repair tests, Pongo clients under `None` read no history
- [ ] Gate green

## G8: docs and handoff (sequential)

- [ ] 8.1 Documentation, `npm run docs:build` green
- [ ] 8.2 Independent review done, findings fixed
- [ ] `npm run agent:check` green
- [ ] `npm run test:unit` green
- [ ] `npm test` green
