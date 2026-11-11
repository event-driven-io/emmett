# Todo: numeric message schema version

Plan: `plan.md` (r8). Spec: `spec.md` (r12). Tick a step only when its tests pass. Nothing is committed unless Oskar asks.

## Steps

- [x] 1. Freeze the 0.43.0 PostgreSQL and SQLite APIs for tests (test support for 9 to 13)
- [x] 2. Version type parameter on `Message`, `Event`, `Command` (1.1 to 1.7)
- [x] 3. Version argument on `event()`, `command()`, `message()` (2.1 to 2.7)
- [x] 4. Read rule, upcast and downcast, shared features on in-memory
- [x] 5. MongoDB (4.8, 5.3)
- [x] 6. EventStoreDB (4.8, 5.4)
- [x] 7. PostgreSQL reads (6.1, 6.2, 6.4, 15.1, 15.2, 15.4)
- [x] 8. Optional version argument and internal helper types (2.8, 2.9, 3.3)
- [x] 9. Read rule per store (4.7, 5.5, 6.1 to 6.8, 7.2 and 9.3 in-memory, MongoDB, EventStoreDB)
- [x] 10. PostgreSQL append functions, fresh `INT` layout, appends through the new function, blue/green (shared features, 4.7, 4.9 to 4.11 in every store but SQLite, 5.2, 7.2, 11.1, 11.2, 12.1 to 12.3, 14.1 TEXT, 14.2 TEXT, 14.3 to 14.6, 15.3, 20.1, 20.3, 20.4, 24.1)
- [ ] 11. On-demand schema version migration and the prepared 0.44.0 migration (13.1 to 13.3, 13.5, 14.1 INT, 14.2 INT, 16.1 to 16.15, 17.1 part, 23.1 to 23.5, 24.3 part, 24.4)
- [ ] 12. On-demand tetris migration (13.4, 13.6, 17.1 part, 18.1 to 18.13, 24.3 part)
- [ ] 13. SQLite rebuild, append and read (shared features, 5.3, 19.1 to 19.7, 20.2, 20.3, 24.2)
- [ ] 14. Recorded message types and docs (3.1, 3.2, 21.1, 22.1)

## Notes

- 4.4 and 8.4 do not apply to in-memory, which has no consumer (#427).
