# Todo: almanac logging integration

State for [plan.md](plan.md). Tick a box when the prompt's "Done when" holds and the verification commands passed. Tests, including the e2e scenarios, are written first inside each prompt. Note anything left open under the step.

## Phase 1: Almanac API and attributes

- [ ] 1. Rename `logger({ event })` to `logger({ log })`; no `minLevel` forwards every level; almanac sinks pass `info` explicitly
- [ ] 2. `consoleLogger({ destination })`, stdout by default, no `console.trace`; update migrate.ts and eventStoreDBContainer.ts
- [ ] 3. Scope logs carry trace, span, correlation and causation ids
- [ ] 4. OTel tracer: error status, `error.type`, message as description, no exception log
- [ ] 5. Add the missing `EmmettAttributes` and the span names

## Phase 2: Emmett core

- [ ] 6. `emmett.processor.start` span, "Processor started" at info, lifecycle details at debug
- [ ] 7. `acquire_lock`, `hooks.on_start` and `read_checkpoint` child spans
- [ ] 8. `emmett.processor.close` span, `release_lock` child, "Processor stopped" at info
- [ ] 9. Message handler failure logged once inside the message scope
- [ ] 10. Custom `eachBatch` failure logged once
- [ ] 11. Consumer start/stop spans and "Consumer stopped" error log
- [ ] 12. Remaining `consumers.ts`, `processorStartPositions.ts:137` and `consumerCollector.ts:133` sites
- [ ] 13. Command handling logs only at the outermost operation (Q22), no `exception.*` span attributes
- [ ] 14. `emmett.eventstore.hooks.on_after_commit` span for in-memory and MongoDB; e2e scenarios 1 and 4
- [ ] 15. Task processor takes `observability`; `TaskProcessorLogger` removed

## Phase 3: Drivers and web bindings

- [ ] 16. Remove checkpoint-store, `tryAcquireProcessorLock`, `writeToStream` and test helper logs
- [ ] 17. PostgreSQL processor lock logs at debug; e2e scenarios 2 (pino) and 7 (winston)
- [ ] 18. Lifecycle logs and spans reach the configured observability on PostgreSQL, SQLite, MongoDB and EventStoreDB; e2e scenario 3
- [ ] 19. Express: observability resolution, `x-trace-id` on registration, `disableTraceIdHeader`, "Server listening"; e2e scenario 5
- [ ] 20. Hono: same as Express; e2e scenario 5
- [ ] 21. Fastify: full server options, `logger: false` default, no `console.log`, `x-trace-id`; e2e scenario 5

## Phase 4: Docs and CLI

- [ ] 22. Logging docs page, samples updated, release notes
- [ ] 23. CLI on a stderr `consoleLogger`; e2e scenario 6; `agent:check` and `npm test` pass
