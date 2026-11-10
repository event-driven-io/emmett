# Todo: numeric message schema version

Plan: `plan.md`. Spec: `spec.md`. Tick a step only when its "Done when" checks pass. Nothing is committed unless Oskar asks.

## Settled before implementation

- [x] Typing of unversioned types: settled in Q62 (a declared version other than 1 is required), checked in the `unversioned-schema-version-typing` PoC.
- [x] Type surface research (`type-surface-research/findings.md`): 88 new errors, all mechanical, 0 after the fixes. `npm run build:ts` equivalent passes.
- [x] Type decisions from the research, settled in Q64 to Q78: bare-number factories with the extra command `{ now }` form, `CreateEventType` and `CreateCommandType` get the 4th parameter, helper types stay unexported, upcast and downcast results without a version get `1`, `event<V1 | V2>` is a documented limit, `AnyRecordedMessage` unchanged. Steps 2, 3, 4, 17 and 18 and the store steps are updated.

## Steps

- [x] 1. Freeze the 0.43.0 PostgreSQL and SQLite APIs for tests (test support for 11–19)
- [x] 2. Version type parameter on `Message`, `Event`, `Command` (1.1–1.6)
- [x] 3. Version argument on `event()`, `command()`, `message()` (2.1–2.7)
- [x] 4. Read rule, upcast and downcast, shared features on in-memory (4.1–4.3, 4.5, 4.6, 5.1, 6.1–6.3, 7.1, 8.1–8.3, 9.1, 9.2, 10.1, 10.2)
- [x] 5. MongoDB (shared features with 4.4 and 8.4, 5.3, 6.1–6.3)
- [x] 6. EventStoreDB (shared features with 4.4 and 8.4, 5.4, 6.1–6.3)
- [x] 7. PostgreSQL reads (6.4, 15.1, 15.2, 15.4)
- [ ] 8. PostgreSQL `emt_append_to_stream_v_0_43_0` and the converting old body (14.2 TEXT, 14.3, 24.1 functions)
- [ ] 9. PostgreSQL appends through the new function, metadata copy, blue/green (shared features, 5.2, 11.1, 11.2, 12.1–12.3, 14.1 TEXT, 15.3, 24.1)
- [ ] 10. PostgreSQL fresh layout with `INT` (20.1, 20.3, 14.1 INT, 14.2 INT)
- [ ] 11. `migrateSchemaToNumericMessageSchemaVersion` (16.1–16.12, 17.1, 13.1–13.3, 24.3)
- [ ] 12. `migrateToOptimisedPostgreSQLStorageLayout` (18.1–18.4, 18.7–18.10, 13.4, 17.1, 24.3)
- [ ] 13. Tetris concurrency (18.5, 18.6)
- [ ] 14. Prepared 0.44.0 migrations, unplugged (23.1–23.4, 24.4, 17.1)
- [ ] 15. SQLite rebuild and fresh layout (19.1–19.4, 19.7, 20.2, 24.2)
- [ ] 16. SQLite append and read (shared features, 5.3, 19.5, 19.6, 20.3)
- [ ] 17. Recorded message types (3.1, 3.2)
- [ ] 18. Docs and final check (22.1, 21.1, `npm run docs:build`, `npm test`)

## Notes

- Criteria 4.4 and 8.4 (consumers) run on the stores that have `consumer()`: MongoDB, EventStoreDB, PostgreSQL, SQLite. The in-memory store has none.
- Criteria 6.1–6.3 on in-memory are covered by the core read-rule unit tests, because in-memory data cannot be older than the release.
- MongoDB never stored `kind`. Step 5 stores it on append and defaults a missing `kind` to `'Event'` on stream reads and in consumers (Q79).
- EventStoreDB never returned `kind`. Step 6 stores it in the event metadata on append, lifts it to the top level on read and defaults a missing `kind` to `'Event'` (Q80).
- Released PostgreSQL appends (0.20.2 to 0.42.4) stored `'1'`, not `'"1"'`. Step 7 builds the 15.1 rows with the 0.38.7 legacy append and asserts `'1'`; `spec.md` and `plan.md` are corrected (Q81).
