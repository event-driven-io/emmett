# Todo: bundled relational schema migrations

Plan: [plan.md](plan.md). Spec: [spec.md](spec.md).

Mark a step done only when its tests and the group gate are green. Record the gate commands and results under each group.

## Decisions (Oskar)

Decided 2026-10-09 (details in plan.md section 3):

- [x] D1 not a decision: spec non-goal already forbids a shared first-migration promise
- [x] D3 simplified: any later same-ID registration replaces; no tracking, no throw
- [x] D5 reuse Pongo clients per storage (step 6.2); Pongo `None` change is a future improvement; either may become a follow-up
- [x] D6 every processor accepts `autoMigration`, default from the top; takes effect where the processor owns a run
- [x] D7 inline `init` runs under every `autoMigration` value, in `eventStore.init()`
- [x] Owners: event store `init()`, recursive owners, one reusable event-store schema component per owner, any processor may contribute `schema`
- [x] Accept the second history read for a store-created consumer; ideas in spec "Future improvements"

- [x] Q1 the shape of `schema` tells grouped processors from child owners
- [x] Q3 on another storage, a processor migrates only its own schema; the user sets up checkpointing
- [x] Q4 `sql()` and `print()` show the grouped graph only

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

- [ ] 0.1 Patch against `21802d7c` saved to `../codex-working-tree.patch`, classification table written below
- [ ] Oskar restored the files that do not match
- [ ] Gate green

### G0 classification

| File | Verdict | Reason / kept hunks |
| ---- | ------- | ------------------- |

## G1: localized fixes (parallel)

- [ ] 1.1 Core `projections.async()` returns async registrations
- [ ] 1.2 Real registration types in PG and SQLite
- [ ] 1.3 Dumbo helpers in specs and SQL
- [ ] Gate green

## G2: core contracts and processor settings (parallel)

- [ ] 2.1 Projection and projector schema generic, `resolveAutoMigration`
- [ ] 2.2 `ConsumerHooks.onInit`, replacement by ID
- [ ] 2.3 Processors take the consumer's migration options (PG, SQLite)
- [ ] Gate green

## G3: declarative components (parallel)

- [ ] 3.1 PG reusable event-store schema component
- [ ] 3.2 SQLite reusable event-store schema component
- [ ] 3.3 Pongo projections expose `schema` (PG, SQLite)
- [ ] Gate green

## G4: event stores own the migrator (parallel)

- [ ] 4.1 PG event store, with `init()`
- [ ] 4.2 SQLite event store, with `init()` (sqlite3, d1, durableObject)
- [ ] Gate green

## G5: processors and consumers (two parallel tracks, sequential inside)

- [ ] 5.1 PG processor schema and own-pool child owner
- [ ] 5.2 PG consumer owner, migrates child owners
- [ ] 5.3 PG store to consumer wiring
- [ ] 5.4 SQLite processors, consumer, store wiring (sqlite3, d1, durableObject)
- [ ] Gate green

## G6: Pongo projections (sequential)

- [ ] 6.1 PG and SQLite Pongo projections stop migrating
- [ ] 6.2 Reuse Pongo clients per storage (D5), or report for a follow-up
- [ ] Gate green

## G7: cross-cutting behavior (parallel)

- [ ] 7.1 Concurrent first assurances
- [ ] 7.2 PG least privilege
- [ ] 7.3 Dry run and memoization regressions
- [ ] Gate green

## G8: docs and handoff (sequential)

- [ ] 8.1 Documentation, `npm run docs:build` green
- [ ] 8.2 Independent review done, findings fixed
- [ ] `npm run agent:check` green
- [ ] `npm run test:unit` green
- [ ] `npm test` green
