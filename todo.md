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
  - The outer catch logs `emmett.processor.exception`, "Processor stopped: processing failed". A failure after handled messages now stores the last handled message's checkpoint (Q23).
- [x] 10. Custom `eachBatch` failure logged once
  - Attributes `emmett.processor.batch.checkpoint.first` and `.last` (Q51). Any failure that stops the processor now fails the `processor.handle` span; the `STOP` result is built outside it.
- [x] 11. Consumer start/stop spans and "Consumer stopped" error log
  - Q50: separate root spans and traces, stop links to start. Start covers init and start positions; stop wraps the teardown after the loop ends. Log is `emmett.consumer.exception`, "Consumer stopped". No info log on clean stop.
- [x] 12. Remaining `consumers.ts`, `processorStartPositions.ts:137` and `consumerCollector.ts:133` sites
  - "Consumer already running" opens a short start span holding the debug log, like the processor's second start.
- [x] 13. Command handling logs only at the outermost operation (Q22), no `exception.*` span attributes
  - Log is `emmett.command.handle.exception`, "Command handling failed".
- [ ] 14. `emmett.eventstore.hooks.on_after_commit` span for in-memory and MongoDB; e2e scenarios 1 and 4
  - To discuss with Oskar: how to run e2e scenarios 1 (OTel + pino) and 4 (nothing configured). `PinoInstrumentation` doesn't patch pino inside vitest, and a child process can't run the `build:ts` output or the `/otel` subpaths without changing the TS setup. The e2e tests are skipped until then.
  - Span and log done for in-memory and MongoDB. The scope goes in through a new `observabilityScope` field in the options, next to `onAfterCommit`, so the overloads and existing callers stay the same. The log is `emmett.eventstore.hooks.on_after_commit.exception`, "onAfterCommit hook failed".
- [x] 15. Task processor takes `observability`; `TaskProcessorLogger` removed
  - `:229` and `:233` are reachable only by an internal bug, so they have no direct test (Q52). `:233` now rethrows only (the catch is gone).

## Phase 3: Drivers and web bindings

- [x] 16. Remove checkpoint-store, `tryAcquireProcessorLock` and `writeToStream` logs
  - Test helpers keep their `console.log` (Q34 corrected). `writeToStream` lost its `catch`, so write errors propagate (Q53). The failing-store tests check `console` with `vi.spyOn`, like the task processor test; a collecting logger couldn't fail before the change.
- [x] 17. PostgreSQL processor lock logs at debug; e2e scenarios 2 (pino) and 7 (winston)
  - Scenarios 2 and 7 skipped: global setup tests don't belong in the PostgreSQL package (Q54). Release logs the SQL result: "Processor lock released" or "Processor lock release skipped: another instance owns the processor".
- [ ] 18. Lifecycle logs and spans reach the configured observability on PostgreSQL, SQLite, MongoDB and EventStoreDB; e2e scenario 3
- [ ] 19. Express: observability resolution, `x-trace-id` on registration, `disableTraceIdHeader`, "Server listening"; e2e scenario 5
- [ ] 20. Hono: same as Express; e2e scenario 5
- [ ] 21. Fastify: full server options, `logger: false` default, no `console.log`, `x-trace-id`; e2e scenario 5

## Phase 4: Docs and CLI

- [ ] 22. Logging docs page, samples updated, release notes
- [ ] 23. CLI on a stderr `consoleLogger`; e2e scenario 6; `agent:check` and `npm test` pass
