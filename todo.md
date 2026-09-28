# Todo: almanac logging integration

State for [plan.md](plan.md). Tick a box when the prompt's "Done when" holds and the verification commands passed. Tests, including the e2e scenarios, are written first inside each prompt. Note anything left open under the step.

## Phase 1: Almanac API and attributes

- [x] 1. Rename `logger({ event })` to `logger({ log })`; no `minLevel` forwards every level; almanac sinks pass `info` explicitly
- [x] 2. `consoleLogger({ destination })`, stdout by default, no `console.trace`; update migrate.ts and eventStoreDBContainer.ts
- [x] 3. Scope logs carry trace, span, correlation and causation ids
  - Sinks map the ids per the pino instrumentation convention (Q48): pino gets `trace_id`, `span_id`, `correlation_id`, `causation_id`; OTel records get `correlation_id`, `causation_id` attributes.
- [x] 4. OTel tracer: error status, `error.type`, message as description, no exception log
  - `pinoTracer` keeps its `pino.error` span record on failure; it already matches the pino instrumentation field convention (Q49).
- [x] 5. Add the missing `EmmettAttributes` and the span names
  - Span names are `EmmettSpans` constants (Q47); existing unprefixed collector span names untouched.

## Phase 2: Emmett core

- [x] 6. `emmett.processor.start` span, "Processor started" at info, lifecycle details at debug
  - `processorCollector.lifecycleScope` opens a child through the caller's scope when one is given (the event store, command and workflow collectors do the same), and a root span for no scope or `noopScope`.
- [x] 7. `acquire_lock`, `hooks.on_start` and `read_checkpoint` child spans
  - almanac's `collectingTracer` records a failed span's error, with `hasError`/`hasNoError` assertions, so tests can check that spans failed.
- [x] 8. `emmett.processor.close` span, `release_lock` child, "Processor stopped" at info
- [x] 9. Message handler failure logged once inside the message scope
  - The outer catch logs `emmett.processor.exception`, "Processor stopped: processing failed" (name to confirm with Oskar). A failure after handled messages now stores the last handled message's checkpoint (Q23).
- [ ] 10. Custom `eachBatch` failure logged once
  - Blocked: attribute names for the batch's first and last positions.
- [ ] 11. Consumer start/stop spans and "Consumer stopped" error log
  - Blocked: `start` runs the whole polling loop, and the consumer collector isn't wired in.
- [ ] 12. Remaining `consumers.ts`, `processorStartPositions.ts:137` and `consumerCollector.ts:133` sites
- [x] 13. Command handling logs only at the outermost operation (Q22), no `exception.*` span attributes
  - Log is `emmett.command.handle.exception`, "Command handling failed" (name to confirm with Oskar).
- [ ] 14. `emmett.eventstore.hooks.on_after_commit` span for in-memory and MongoDB; e2e scenarios 1 and 4
- [ ] 15. Task processor takes `observability`; `TaskProcessorLogger` removed
  - Blocked: the `:229` path can't be reached through the public API.

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
