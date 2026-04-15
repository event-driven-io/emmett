# Distinguish `completed` from `stopped` processor status

## Context

The projection-rebuild benchmark reports bogus numbers because `emt_release_processor_lock` writes `status='stopped'` regardless of _why_ a run ended. Natural completion (`stopWhen: noMessagesLeft` firing) and external close (SIGTERM, `consumer.close()` mid-flight, crash) collapse to the same state, so the next rebuild can't tell "previous finished" from "previous was killed". Back-to-back rebuilds read an end-of-stream checkpoint and process zero events.

Fix: add `completed` as a distinct processor status, written only when `stopWhen` fires. The rebuild "restart-if-previously-completed, resume-if-crashed" semantic falls out of `truncateOnStart` becoming status-aware. No rebuild-specific logic in the lock layer.

Each iteration is TDD: write failing tests first, implement until green, then move on. Nothing in a later iteration is touched until the prior one passes.

---

## Iteration 1 — SQL: `completed` status writable; takeover of `completed` row allowed

### Tests

**File: [postgreSQLProcessorLock.int.spec.ts](src/packages/emmett-postgresql/src/eventStore/projections/locks/postgreSQLProcessorLock.int.spec.ts)** — new cases added under the existing describe:

1. `release with completed=true sets processor row status to 'completed'`
2. `release with completed=false sets processor row status to 'stopped'` (explicit default)
3. `release with completed=true preserves last_processed_checkpoint untouched`
4. `release with completed=true sets processor_instance_id to 'emt:unknown'` (matches stopped behavior)
5. `release with completed=true when instance_id does not match → no-op (row unchanged)` — guard via WHERE on instance_id
6. `release with completed=true also sets projection status to 'active'` (projection layer unchanged)
7. `release with completed=true on row with NULL projection_name does not touch projections table`
8. `allows takeover when prior processor status='completed'` — mirrors existing ["allows different instance when processor is stopped" at line 261](src/packages/emmett-postgresql/src/eventStore/projections/locks/postgreSQLProcessorLock.int.spec.ts#L261)
9. `takeover from completed row preserves last_processed_checkpoint` — new instance reads the prior checkpoint intact
10. `takeover from completed row within timeout window still allowed` — the `status='completed'` WHERE clause is independent of `last_updated` timeout
11. `takeover from running row with status='completed' stale (never happens in practice) behaves correctly` — invariant guard

**File: [migration.int.spec.ts](src/packages/emmett-postgresql/src/eventStore/schema/migrations/migration.int.spec.ts)** — new cases:

12. `0_43_0 migration creates 7-arg emt_release_processor_lock overload alongside 6-arg` — assert both signatures present in `pg_proc`
13. `0_43_0 migration replaces emt_try_acquire_processor_lock body to include 'completed' in WHERE` — call old signature against a pre-inserted `status='completed'` row, takeover succeeds
14. `0_43_0 migration is idempotent` — apply twice, no error, functions unchanged
15. `0_43_0 migration preserves existing emt_processors rows` — seed rows before migration, verify after
16. `old 6-arg release signature still writes status='stopped' after 0_43_0 migration` — backward-compat guard

### Implementation

- **New migration file**: `src/packages/emmett-postgresql/src/eventStore/schema/migrations/0_43_0/0_43_0.migration.ts`, following [0_42_0.migration.ts](src/packages/emmett-postgresql/src/eventStore/schema/migrations/0_42_0/0_42_0.migration.ts) shape:
  - `CREATE OR REPLACE FUNCTION emt_try_acquire_processor_lock(...)` — same 9-arg signature, same `TABLE(acquired BOOLEAN, checkpoint TEXT)` return. ON CONFLICT WHERE clause at [0_42_0.migration.ts:348-351](src/packages/emmett-postgresql/src/eventStore/schema/migrations/0_42_0/0_42_0.migration.ts#L348-L351) gains `OR emt_processors.status = 'completed'`.
  - `CREATE OR REPLACE FUNCTION emt_release_processor_lock(..., p_completed BOOLEAN DEFAULT false)` — new 7-arg overload. Body: `status = CASE WHEN p_completed THEN 'completed' ELSE 'stopped' END`. Existing 6-arg function kept intact.
- Re-exported from [migrations/index.ts](src/packages/emmett-postgresql/src/eventStore/schema/migrations/index.ts).
- Source-of-truth definitions at [processorsLocks.ts](src/packages/emmett-postgresql/src/eventStore/schema/processors/processorsLocks.ts) updated in sync so `schema.migrate()` generates the new functions on fresh deployments.

No TS-layer or consumer changes in this iteration. Old TS callers keep working.

---

## Iteration 2 — SQL: acquire returns `prior_status` and `prior_checkpoint`

### Tests

**File: [postgreSQLProcessorLock.int.spec.ts](src/packages/emmett-postgresql/src/eventStore/projections/locks/postgreSQLProcessorLock.int.spec.ts)** — new cases:

17. `new acquire returns acquired=true, prior_status=null, prior_checkpoint=null on first-ever acquire`
18. `new acquire returns acquired=true, prior_status='completed', prior_checkpoint=<value> taking over completed row`
19. `new acquire returns acquired=true, prior_status='stopped', prior_checkpoint=<value> taking over stopped row`
20. `new acquire returns acquired=true, prior_status='running' when same instance_id re-acquires`
21. `new acquire returns acquired=true, prior_status='running' when taking over a timed-out running row` (prior_status reflects the raw row state, not the reason for takeover)
22. `new acquire returns acquired=false, when lock held by another instance within timeout` — prior_status/prior_checkpoint MAY be populated but caller must not use them
23. `new acquire: prior_status reflects pre-UPDATE state, not the post-UPDATE 'running' value` — read-before-upsert ordering guard
24. `new acquire: prior_checkpoint is the exact value last written, not the new-row default '0000...'`
25. `new acquire with projection_name updates projection row to 'async_processing' (existing behavior preserved)`
26. `new acquire without projection_name leaves projections table untouched`

**File: [migration.int.spec.ts](src/packages/emmett-postgresql/src/eventStore/schema/migrations/migration.int.spec.ts)** — extend:

27. `0_43_0 migration creates new acquire-with-prior-state function` — assert function exists in `pg_proc`
28. `old emt_try_acquire_processor_lock still returns (acquired, checkpoint) after 0_43_0 migration` — backward-compat guard

### Implementation

Extend the 0_43_0 migration SQL with a new parallel function (name TBD per project convention — placeholder `emt_try_acquire_processor_lock_with_prior_state`):

```sql
RETURNS TABLE (acquired BOOLEAN, prior_status TEXT, prior_checkpoint TEXT)
```

plpgsql reads the existing row's `status` and `last_processed_checkpoint` into locals _before_ the INSERT ON CONFLICT. The takeover WHERE matches the updated clause (includes `'completed'`). `acquired` derived from `FOUND`. First-ever acquire → both prior fields `NULL`.

Parallel function rather than replacement because RETURNS TABLE shape change would require DROP + CREATE and break rolling-upgrade compat.

---

## Iteration 3 — TS layer: expose `{ acquired, priorStatus, priorCheckpoint }` and `release({ completed })`

### Tests

**File: [postgreSQLProcessorLock.int.spec.ts](src/packages/emmett-postgresql/src/eventStore/projections/locks/postgreSQLProcessorLock.int.spec.ts)** — new cases covering the TS wrapper:

29. `tryAcquire returns { acquired: true, priorStatus: null, priorCheckpoint: null }` on first-ever call
30. `tryAcquire returns { acquired: true, priorStatus: 'completed', priorCheckpoint: 'X' }` after prior completion
31. `tryAcquire returns { acquired: true, priorStatus: 'stopped', priorCheckpoint: 'X' }` after prior external close
32. `tryAcquire returns { acquired: false }` when blocked — priorStatus/priorCheckpoint fields are not relied upon
33. `release({ completed: true }) writes status='completed'`
34. `release() (no options) writes status='stopped'` — explicit default
35. `release({ completed: false }) writes status='stopped'`
36. `release({ completed: true }) called after a failed tryAcquire is a no-op` — `acquired` tracking guard at [postgreSQLProcessorLock.ts:73](src/packages/emmett-postgresql/src/eventStore/projections/locks/postgreSQLProcessorLock.ts#L73)

### Implementation

- [postgreSQLProcessorLock.ts:49-70](src/packages/emmett-postgresql/src/eventStore/projections/locks/postgreSQLProcessorLock.ts#L49-L70) — `tryAcquire` calls the new SQL function, returns the full typed tuple.
- [postgreSQLProcessorLock.ts:72-84](src/packages/emmett-postgresql/src/eventStore/projections/locks/postgreSQLProcessorLock.ts#L72-L84) — `release(context, options?: { completed?: boolean })`, calls the new 7-arg SQL overload.
- Handler context (defined in [postgreSQLProcessor.ts](src/packages/emmett-postgresql/src/eventStore/consumers/postgreSQLProcessor.ts)) grows `priorStatus: 'running' | 'stopped' | 'completed' | null` and `priorCheckpoint: string | null`.

No consumer-level behavior change yet — new fields plumbed but not consumed.

---

## Iteration 4 — Completion signal: puller → onClose → release

### Tests

**File: [postgreSQLEventStoreConsumer.int.spec.ts](src/packages/emmett-postgresql/src/eventStore/consumers/postgreSQLEventStoreConsumer.int.spec.ts)** — new cases covering end-to-end consumer behavior (since there's no dedicated messageBatchProcessing spec file today):

37. `consumer with stopWhen: noMessagesLeft drains seeded events → row ends with status='completed'`
38. `consumer with stopWhen against empty event store fires immediately → status='completed'`
39. `consumer with stopWhen closed externally before drain → status='stopped'` (partial-drain case)
40. `consumer without stopWhen closed externally → status='stopped'` (regular async never enters 'completed')
41. `consumer with stopWhen fires then close() called → status stays 'completed'` (flag-set-before-resolve wins over trailing close)
42. `consumer with stopWhen fires, close() raises during release → next acquire still sees status='completed' or 'running'` (no corrupt state)
43. `two consumers in parallel, one with stopWhen, one without → flags don't cross-contaminate between their contexts`

### Implementation

- [messageBatchProcessing/index.ts:108-111](src/packages/emmett-postgresql/src/eventStore/consumers/messageBatchProcessing/index.ts#L108-L111) — when `stopWhen.noMessagesLeft` fires, set `completed=true` on the consumer context before the start promise resolves.
- [postgreSQLProcessor.ts:345-353](src/packages/emmett-postgresql/src/eventStore/consumers/postgreSQLProcessor.ts#L345-L353) — `wrapHooksWithProcessorLocks` onClose hook reads the context flag, forwards to `release({ completed })`.

---

## Iteration 5 — `truncateOnStart` becomes status-aware

### Tests

**File: [processors.unit.spec.ts](src/packages/emmett/src/processors/processors.unit.spec.ts)** — new unit cases at the processor layer (mocking lock + context):

44. `truncateOnStart=true + priorStatus=null → projection.truncate called, startFrom='BEGINNING'`
45. `truncateOnStart=true + priorStatus='completed' → projection.truncate called, startFrom='BEGINNING'`
46. `truncateOnStart=true + priorStatus='stopped' → projection.truncate NOT called, resumes from priorCheckpoint`
47. `truncateOnStart=true + priorStatus='running' (timeout takeover) → projection.truncate NOT called, resumes from priorCheckpoint` — treat timed-out runs as crashed, not completed
48. `truncateOnStart=false + priorStatus='completed' → projection.truncate NOT called, resumes from priorCheckpoint` (regular async after a rebuild — picks up at end)
49. `truncateOnStart=false + priorStatus='stopped' → projection.truncate NOT called, resumes from priorCheckpoint`
50. `truncateOnStart=false + priorStatus=null → projection.truncate NOT called, startFrom='BEGINNING'` (first-ever regular async)
51. `explicit startFrom option takes precedence over status-based decision` — caller-supplied override respected
52. `projection.truncate throwing propagates → lock is released with completed=false (i.e. 'stopped')` — error-path guard

### Implementation

- [processors.ts:592-600](src/packages/emmett/src/processors/processors.ts#L592-L600) onStart hook reads `priorStatus` from context; gates `projection.truncate(context)` on the rules above.
- [processors.ts:420-461](src/packages/emmett/src/processors/processors.ts#L420-L461) start-position logic: when `truncateOnStart=true` and priorStatus is not `'stopped'`/`'running'`, return `'BEGINNING'` instead of stored checkpoint.

---

## Iteration 6 — Rebuild end-to-end verification

### Tests

**File: [rebuildPostgreSQLProjections.e2e.spec.ts](src/packages/emmett-postgresql/src/eventStore/consumers/rebuildPostgreSQLProjections.e2e.spec.ts)** — new cases:

53. `back-to-back rebuild: run #2 truncates docs and replays all N events from position 0` — **core bug fix assertion**
54. `back-to-back rebuild: run #2 final rowCount equals run #1 rowCount`
55. `back-to-back rebuild: run #2's processedCount equals N (full replay)`
56. `back-to-back rebuild of empty event store: both runs process 0 events without error`
57. `back-to-back rebuild: row's processor_instance_id rotates correctly between runs`

**File: [rebuildPostgreSQLProjections.int.spec.ts](src/packages/emmett-postgresql/src/eventStore/consumers/rebuildPostgreSQLProjections.int.spec.ts)** — new cases:

58. `rebuild crash-restart: partial docs from run #1 are NOT truncated on run #2` — skipped-truncate guard
59. `rebuild crash-restart: run #2 resumes from checkpoint, events [checkpoint..N] processed exactly once`
60. `rebuild crash-restart with N=1 event, crash at 0: run #2 processes the one event cleanly`
61. `rebuild crash-restart after several crashes: each restart preserves docs and resumes`
62. `version-bump rebuild: v2 starts from BEGINNING, v1 docs unchanged after v2 completes`
63. `two projections in one rebuild consumer: one completes + one crashes → independent restart behavior on re-run`

Verify existing tests still green:

64. [rebuildPostgreSQLProjections.e2e.spec.ts:110](src/packages/emmett-postgresql/src/eventStore/consumers/rebuildPostgreSQLProjections.e2e.spec.ts#L110) — "continues rebuild from checkpoint after process restart" — must stay green (crash-restart = external close = status='stopped' = resume)
65. [rebuildPostgreSQLProjections.int.spec.ts:330](src/packages/emmett-postgresql/src/eventStore/consumers/rebuildPostgreSQLProjections.int.spec.ts#L330) — "continues rebuilding from checkpoint after crash" — must stay green

### Implementation

None — this iteration should pass from Iterations 1-5. Failures here trace back to earlier invariants.

---

## Iteration 7 — Migration + compatibility regression

### Tests

**File: [migration.int.spec.ts](src/packages/emmett-postgresql/src/eventStore/schema/migrations/migration.int.spec.ts)** — new cases (beyond the ones already listed in Iterations 1-2 at #12-16, #27-28):

66. `fresh schema generated by createEventStoreSchema matches 0_43_0 post-migration state` — source-of-truth sync guard
67. `migration 0_43_0 applied on top of 0_43_0 succeeds and data is preserved`
68. `old TS library (pre-Iteration 3 wrapper) works against 0_43_0-migrated schema` — calls old 6-arg release + old 2-column acquire, writes 'stopped', resumes on next run. End-to-end pod-mismatch simulation
69. `new TS library works against schema migrated to 0_43_0` — happy path

### Implementation

None — guards over Iterations 1-2.

---

## Compatibility summary

All SQL changes are additive:

- `emt_try_acquire_processor_lock` — body updated in place (WHERE extends to `'completed'`). Signature and return shape unchanged. Old TS callers keep working.
- `emt_try_acquire_processor_lock_with_prior_state` (name TBD) — new function, additive.
- `emt_release_processor_lock` 7-arg overload — additive alongside the existing 6-arg.

Mixed old/new deployments against the same DB:

- Old code releasing a naturally-completed run writes `'stopped'` — loses the completion signal for _that_ run. Pre-existing bug, contained, no corruption.
- New code acquiring from `'stopped'` row (from either old or new code) → resume. Matches prior semantic.
- Old code acquiring from `'completed'` row (written by new code) → takeover allowed via extended WHERE. Safe.

Post-upgrade cleanup (drop old 6-arg release, drop old acquire after all deployments are new) — separate migration, out of scope.

## Out of scope

- Benchmark runner (already handled by Oskar).
- Deterministic `processorInstanceId`.
- Projection-status gaining `'completed'`.
- Cleanup migration dropping old signatures.

## Per-iteration gate

After every iteration — **before moving to the next iteration** — the following must all pass. If any step fails, stop and fix before proceeding.

1. `cd src && npm run build:ts` — TypeScript build is clean.
2. `cd src && npm run fix` — lint + format clean (autofix, then verify no remaining errors).
3. `cd src && npx vitest run <pattern>` — run the tests added/touched in the iteration. The tests that were failing before the iteration's implementation must now be green. Use `npx vitest run` from `src/`; **never `cd` into a package** to run tests.

If there is any doubt about broader impact, ask Oskar whether to run the full suite (`cd src && npm test`) before proceeding — do not decide unilaterally.

## Final verification

After all iterations green:

1. `cd src && npm run build:ts` — build clean.
2. `cd src && npm run fix` — lint + format clean.
3. `cd src && npx vitest run migration.int` — scenarios 12-16, 27-28, 66-69.
4. `cd src && npx vitest run postgreSQLProcessorLock.int` — scenarios 1-11, 17-26, 29-36.
5. `cd src && npx vitest run postgreSQLEventStoreConsumer.int` — scenarios 37-43.
6. `cd src && npx vitest run processors.unit` — scenarios 44-52.
7. `cd src && npx vitest run rebuildPostgreSQLProjections` — scenarios 53-65.
8. Ask Oskar whether to run the full `cd src && npm test` suite before declaring done.
9. `cd src/packages/emmett-postgresql && BENCHMARK_EVENT_COUNTS=1000,10000 BENCHMARK_BATCH_SIZES=10,1000 npm run bench:projections` — smoke: times scale with `eventCount`, differ by batch size, one row per config. (Benchmark scripts live in the package, so `cd` is acceptable here — this is not a test run.)
