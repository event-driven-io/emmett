# Todo: In-memory event store consumer and required `consumer()`

Plan: `plan.md`. Spec: `spec.md`.

## Steps

- [x] 1. Push-based `inMemoryMessageSource` (12)
- [x] 2. In-memory store consumer and standalone consumer (1, 2, 3, 4, 5, 8, 10, 11)
- [x] 3. Required `consumer` on `EventStore` (13)
- [x] 4. Durable Objects sample keeps compiling (14)
- [x] 5. Observability and reactor errors on the in-memory consumer (6, 7)
- [x] 6. Async projections and the message store in handlers (9)
- [x] 7. In-memory consumer docs and runnable snippets (15)
- [x] 8. SQLite consumers pass their message store (16)
- [x] 9. PostgreSQL consumer passes its message store (17)
- [x] 10. MongoDB consumer and processors always have the message store (18)
- [x] 11. EventStoreDB consumer passes its message store (19)
- [x] 12. MongoDB custom `databaseName` (20)
- [x] 13. In-memory processors require a message store (21)
- [x] 14. `inMemoryMessageSource` takes an array or an async iterable of batches, and the store gives each consumer its own source (qa.md, "ok, then do it")

## Next

- [ ] Processor appends run the store's inline projections and hooks (#432): bind the store to the processor's transaction, the way `withSession` does. Not decided, see `../processor-message-store-options/qa.md`.
