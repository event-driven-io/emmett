# Todo: the event store migrates its own projections for its consumers

See `plan.md` for the prompts.

- [x] Step 1: consumer `onInit` hook in core (sequential, first)
- [x] Step 2: PostgreSQL and SQLite consumers pass the store's `onInit` hook (after step 1)
- [x] Step 3: the store's `migrate()` can be tried again after a failure (parallel with steps 1 and 2)
- [x] Step 4: PostgreSQL `store.consumer()` migrates through the store (after steps 1 to 3)
- [x] Step 5: SQLite `store.consumer()` migrates through the store (after steps 1 to 3, parallel with step 4)
- [x] Step 6: docs (after steps 4 and 5)
- [x] Step 7: full verification with `npm test` (last)
