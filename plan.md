# Plan: finish the almanac logging integration in Emmett

This plan implements [spec.md](spec.md). The decisions behind it are in [qa.md](qa.md) and the call-site inventory is in [log.md](log.md). Progress is tracked in [todo.md](todo.md).

## How to use this plan

Each prompt below is self-contained and meant for a code-generation LLM working in this repository. Run them in order. Each one builds on the previous ones and ends with its code wired in, tests green and nothing left orphaned. Tests come first in every prompt, including the e2e scenarios, which are written in the prompt that implements their behaviour. After each prompt, tick the matching item in todo.md.

Every prompt assumes the rules in the "Shared rules" section. Paste that section together with the prompt, or tell the model to read it from this file.

## Shared rules (apply to every prompt)

```text
You are working in the Emmett repository (npm workspaces rooted at `src`). Read AGENTS.md first and follow it. Read spec.md, the section named in the prompt, and the qa.md questions it cites before changing code.

Rules:
- Test first. Write a failing test named after observable behaviour from the user's perspective, run it, see it fail for the right reason, then write the smallest change that makes it pass. Refactor with tests green.
- Unit tests check exact LogEvents and span attributes. Assert every field; partial matching is the exception. Rethrow sites must be tested to log nothing.
- When a prompt names an e2e scenario from spec §7, write it first, together with the unit tests, as a failing test that drives the implementation. Put it in the package whose setup it mimics (check existing `e2e` folders, for example `emmett-expressjs/src/e2e`, and `emmett-tests`). Set Emmett up the way a user would, with real infrastructure through testcontainers where needed, and assert on what the user sees: log records, spans, stdout and stderr. Oskar reviews e2e tests, so show him each one before implementing. If a dependency (pino, winston, PinoInstrumentation) isn't installed in the target package, ask Oskar before adding it.
- Use almanac's testing helpers (`@event-driven-io/almanac` testing: collectingTracer, collected spans) and a collecting logger (`logger({ log: (e) => events.push(e) })`) instead of mocks. No mock modes.
- Module pattern: functions, closures and object literals. No classes. No `any`.
- No new abstractions unless the prompt asks for one. Prefer small, easily removable code.
- Don't add comments unless the code is unusual. Don't remove existing comments unless they became false (for example a `TODO` the prompt resolves).
- Log messages are short and stable. Never interpolate ids into the text; put them in attributes using `EmmettAttributes` names.
- Do not commit, branch, rebase or reset. Oskar handles git.
- Markdown: one line per paragraph, no manual wrapping.
- If the code doesn't match what the prompt describes, or a decision isn't covered by spec.md, stop and ask Oskar instead of guessing.

Verification, run from `src`:
- The smallest relevant test files with `npx vitest run <file>`.
- `npm run build:ts` for type checking.
- `npm run agent:check` before reporting the step done.
- `npm run test:unit` at the end of every step.
Report the commands you ran and whether they passed.
```

## Blueprint

The work has four phases. Each one ends at a point worth reviewing, and depends only on the phases before it.

1. **Almanac API and attributes (prompts 1–5, spec §1, §2, §4).** Rename the logger option, fix the level default, turn `consoleLogger` into a function, add correlation ids to every scope log, change how the OTel tracer records failures, and add the missing `EmmettAttributes`. Everything later relies on this API.
2. **Emmett core (prompts 6–15, spec §3, §5, §6 core).** Processor start and close spans with their children and logs, message and batch failure logs, consumer spans and "Consumer stopped", the remaining consumer sites, the Q22 rule for command handling, the `on_after_commit` span, and the task processor. This closes the noopScope gap for all drivers.
3. **Drivers and web bindings (prompts 16–21, spec §6).** Remove the internal-rethrow and test helper logs, add the PG lock debug logs, check every driver end to end, then the Express, Hono and Fastify changes.
4. **Docs and CLI (prompts 22–23, spec §6 CLI, §8, §9).** The Logging docs page, samples and release notes, then the CLI, which matters least and goes last, followed by the full `npm test`.

Each e2e scenario from spec §7 is written first, in the prompt that implements its behaviour:

| Scenario                                             | Prompt     |
| ---------------------------------------------------- | ---------- |
| 1. OTel by convention, failing `onAfterCommit`       | 14         |
| 4. Nothing configured prints nothing                 | 14         |
| 2. Own pino set globally, PG lock logs at debug only | 17         |
| 7. Winston through the recipe                        | 17         |
| 3. Loggers per component                             | 18         |
| 5. Web app "Server listening"                        | 19, 20, 21 |
| 6. CLI error on stderr                               | 23         |

### Why this order

- Almanac first, because the rename in prompt 1 touches every caller. Doing it first keeps later diffs focused.
- Attributes before any log that uses them, so no step invents names ad hoc.
- Processor spans before consumers, because the consumer's "Consumer stopped" log and the lock logs both need a real scope to reach the configured logger.
- Drivers after the core processor spans, because the PG lock logs only reach a logger once the `acquire_lock` span passes its scope down.
- Docs after the pino and winston e2e scenarios exist, so the documented sink recipe is the tested one.
- CLI last, because it matters least.

### Sizing notes

The first draft had one step per phase. That was too big: the processor work alone touches start, close, message handling and batch handling, and each has its own failure mode. The second pass split it into one step per span group and one per failure path. The third pass merged steps that were too small to test on their own (the individual `consumers.ts` lines form one step, and the removals in the drivers and test helpers form one step). Each of the 23 steps changes one behaviour, has its own tests written first and leaves the build green.

---

## Phase 1: Almanac API and attributes

### Prompt 1: rename `logger({ event })` to `logger({ log })` and forward every level by default

```text
Context: spec.md §1 (level rule) and §2 (first row). Decisions: Q9, Q19, Q20.

Today `logger(options: { event, minLevel? })` in `src/packages/almanac/src/loggers/logger.ts` names its sink `event`, and `shouldLog` treats a missing `minLevel` as `LogLevel.default` ('info'), so a user's logger never sees debug events.

Goal:
1. Rename the option to `log`: `logger({ log, minLevel })`. Nothing called `.event` remains in the logging API. Keep `eventName` and the `LogEvent` type.
2. `logger()` without `minLevel` forwards every event except `silent`, so the user's own logger applies its level. An explicit `minLevel` is honoured as today.
3. Keep today's behaviour for almanac's own sinks by passing the level explicitly:
   - `otelLogger` passes `minLevel: options?.minLevel ?? LogLevel.info`.
   - `consoleTracer` and `consoleSpanLogger` pass `options?.logLevel ?? LogLevel.info`.
   - `consoleLogger` passes `minLevel: LogLevel.info` (it becomes a function in prompt 2; don't change its shape yet).
4. Decide whether `shouldLog` itself keeps its `LogLevel.default` fallback. Other callers may rely on it, so find them first; change only `logger()` if anything else depends on the fallback.

Tests first, in `logger.unit.spec.ts`:
- "forwards debug and trace events when no minLevel is set".
- "drops events below an explicit minLevel".
- "never forwards silent events".
Add or update tests for otelLogger, consoleTracer and consoleSpanLogger showing they still drop debug by default.

Then update every caller of `logger({ event: ... })` across `src/packages` (almanac, emmett, drivers, bindings, tests, samples and docs code blocks). Find them with a search for `logger({` and `event:` near it. `noopLogger` becomes `logger({ log: () => {} })`.

Done when: the build is green, no `logger({ event` remains anywhere in the repo (including `src/docs` and `samples`), and the unit tests pass.
```

### Prompt 2: `consoleLogger({ destination })`

```text
Context: spec.md §2 (fourth row), §9. Decisions: Q26, Q27.

Today `consoleLogger` in `src/packages/almanac/src/providers/console/consoleLogger.ts` is a `Logger` value that picks `console.error`/`warn`/`debug`/`trace`/`log` by level.

Goal: make it a function, pino style.
- Signature: `consoleLogger(options?: { destination?: 'stdout' | 'stderr'; minLevel?: LogLevel }): Logger`.
- Default destination is stdout for every level. `stderr` writes every level to stderr.
- Write through `process.stdout.write`/`process.stderr.write` or through `console.log`/`console.error` chosen by destination only. Check what almanac's other console providers do and match them; if neither fits cleanly, ask Oskar.
- It no longer uses `console.trace` (that prints a stack trace, which is not what a trace-level log means).
- Default `minLevel` is `LogLevel.info`, as set in prompt 1.
- Keep how body, attributes and error are rendered today.

Tests first, rewriting `consoleLogger.unit.spec.ts` from the user's perspective:
- "writes every level to stdout by default".
- "writes every level to stderr when destination is stderr".
- "does not print a stack trace for trace-level events".
- "drops debug events unless minLevel allows them".
- Keep the existing body/attributes/error rendering cases.

Then update the callers:
- `src/packages/emmett-postgresql/src/commandLine/migrate.ts` (four calls): create one logger, `consoleLogger()`, and reuse it.
- `src/packages/emmett-testcontainers/src/eventStore/eventStoreDBContainer.ts:111-113`: same.
- Any other caller found by searching for `consoleLogger`, including docs code blocks.

Done when: no call site uses `consoleLogger` as a value, the build is green and unit tests pass.
```

### Prompt 3: add trace, span, correlation and causation ids to every scope log

```text
Context: spec.md §2 (second row). Decision: Q19.

Today `logForScope` in `src/packages/almanac/src/scopes/scope.ts` adds `traceId` and `spanId` through `logEventForSpan` (`tracers/spanLogEvent.ts`). `correlationId` and `causationId` live on `scope.context` (`ObservabilityContext`) but never reach the log. `LogEventMetadata` has no fields for them.

Goal:
1. Add optional `correlationId` and `causationId` to `LogEventMetadata` and `LogEventMetadataInput` in `loggers/logger.ts`.
2. `scope.log` fills all four ids from the scope. A value already set on the event wins, so a user's logger that sets its own ids keeps them.
3. With an empty span context (noop tracer), trace and span ids stay unset as today, but correlation and causation ids are still added, because they come from the scope context, not the span.
4. Make the smallest change: extend `logEventForSpan` or add the two ids in `logForScope`; don't add a new module.

Tests first, in `scope.unit.spec.ts`:
- "scope logs carry trace, span, correlation and causation ids".
- "ids already set on the log event are kept".
- "a scope without a real span still adds correlation and causation ids".
- A child scope's log carries the child's span id and the inherited correlation id.

Check that `otelLogger` and the pino sink map the new metadata fields to attributes, following what they do for `traceId`. If they ignore metadata beyond trace and span, ask Oskar which attribute names to use before adding them.

Done when: unit tests pass and the build is green.
```

### Prompt 4: OTel tracer records failures the OTel way

```text
Context: spec.md §2 (third and fifth rows), §3. Decisions: Q21, Q37, Q38.

Today `src/packages/almanac/src/providers/otel/otelTracer.ts` (around line 112), on failure, sets `ERROR` status with the message and then writes `spanLog(LogEvent.error(error, 'exception'))`, so every failed span produces an exception log.

Goal:
- On failure: `ERROR` status, `error.type` attribute set to the error's constructor name (fall back to `'_OTHER'` per the OTel semantic conventions when there is no meaningful type), and the exception message as the status description.
- Stop writing the `exception` log. The one exception log for an error is written by whoever handles it (spec §3), not by the tracer.
- No `exception.*` span attributes.

Before changing it, check the other tracers (`consoleTracer`, `pinoTracer`, `compositeTracer`, `collectingTracer`) for the same pattern. If they also log on every failure, list what you found and ask Oskar whether to align them in this step; the spec names only the OTel tracer.

Tests first, in `otelTracer.unit.spec.ts` or `otelTracer.int.spec.ts` (follow where the existing failure tests live):
- "a failed span has error status, error.type and the message as description".
- "a failed span writes no log record".
- "a successful span has no error.type".

Done when: tests pass and the build is green. Existing tests that expected the exception log are updated, not deleted, and now assert that no log is written.
```

### Prompt 5: add the missing Emmett attribute names

```text
Context: spec.md §4. Decisions: Q18, Q23, Q35, Q40.

`src/packages/emmett/src/observability/attributes.ts` holds `EmmettAttributes`. Add, following the existing nesting and lowercase dotted snake_case style:
- `consumer.id` → `emmett.consumer.id`
- `processor.instanceId` → `emmett.processor.instance_id`
- `processor.lock.key` → `emmett.processor.lock.key`
- `processor.startFrom` → `emmett.processor.start_from`
- `processor.checkpoint` → `emmett.processor.checkpoint`
- `stream.position` → `emmett.stream.position`

`emmett.processor.checkpoint.before` already exists; don't duplicate it.

Also add the span names from spec §5 as constants next to the attributes, in the style the file already uses (look for existing span-name constants in the collectors first; if names are plain strings there, ask Oskar whether constants are wanted before adding them):
- `emmett.processor.start`, `emmett.processor.acquire_lock`, `emmett.processor.hooks.on_start`, `emmett.processor.read_checkpoint`, `emmett.processor.close`, `emmett.processor.release_lock`, `emmett.eventstore.hooks.on_after_commit`.
- The consumer start/stop spans (spec §5, "Consumer start and stop get the same treatment"): `emmett.consumer.start` and `emmett.consumer.stop`.

Extend `attributes.unit.spec.ts` if it asserts the full shape.

Done when: build green, unit tests pass. Nothing uses the new names yet; the next prompts do.
```

## Phase 2: Emmett core

### Prompt 6: `emmett.processor.start` span and the "Processor started" log

```text
Context: spec.md §5 (first row and the paragraph on all four drivers), §6 core rows for `processors.ts:778`, `:786`, `:801`, `:815`, `:831`, `:852`, `:861`, `:872`, `:880`. Decisions: Q35, Q36, Q40.

Today `start` in `src/packages/emmett/src/processors/processors.ts` (around lines 761-880) uses the caller's `observabilityScope` or `noopScope`. The default, PostgreSQL, SQLite and MongoDB consumers pass none, so every lifecycle log goes nowhere. The processor already has its own collector: `processorCollector(processorObservability(options))` (line ~554, `processors/observability/processorCollector.ts`).

Goal:
1. Add a lifecycle method to `processorCollector` that opens a span with the processor's resolved observability, e.g. `lifecycleScope(name, context, fn, parent?: ObservabilityScope)`. It sets `emmett.processor.id`, `emmett.processor.instance_id` and `emmett.processor.type`. When the caller gave a scope with a real span context (non-empty trace and span ids), the new span is its child (`parent: callerScope.context` trace/span ids). Otherwise it's a root span.
2. Wrap `start` in `emmett.processor.start`. Pass that scope as `observabilityScope` into `init`, `processingScope` and everything else `start` calls, so logs reach the configured logger for every driver.
3. Change the logs:
   - `:778` (already active), `:786` (starting), `:815` (acquiring lock), `:831` (onStart hook) → `debug`, short stable messages, ids in attributes.
   - `:801`, `:852`, `:861`, `:872`, `:880` → one `info` "Processor started" per start, with `emmett.processor.id`, `emmett.processor.instance_id`, `emmett.processor.type`, `emmett.processor.start_from` (`BEGINNING`, `END`, `checkpoint` or `explicit`) and `emmett.processor.checkpoint` (serialized, when there is one). The same attributes go on the start span.
4. Remove the `// TODO: Consider adding explicit start scope` comment; this step resolves it. Leave the init and close TODOs for now (prompt 8 handles close; ask Oskar about init if it becomes relevant).

Tests first, in `processors.observability.unit.spec.ts`, using a collecting tracer and logger passed through the processor's `observability` option and no caller scope:
- "starting a processor opens an emmett.processor.start span with processor ids".
- "starting a processor logs one Processor started at info with start_from BEGINNING" (and one test each for END, explicit and a stored checkpoint).
- "lifecycle details are logged at debug".
- "the start span is a child of the caller's scope when one is given".
- "a second start while active logs at debug and opens no new processing".

Then run the in-memory consumer tests and one PostgreSQL processor integration test to confirm nothing regressed.

Done when: tests pass, build green, unit suite passes.
```

### Prompt 7: children of the start span

```text
Context: spec.md §5 rows `emmett.processor.acquire_lock`, `emmett.processor.hooks.on_start`, `emmett.processor.read_checkpoint`. Decision: Q36, Q40.

Building on prompt 6, inside `start` in `processors.ts`:
- Run lock acquisition (`acquireProcessorLock`) in a child span `emmett.processor.acquire_lock`. Pass the child scope into the lock call's context so lock implementations can log there (prompt 17 adds the PG lock logs).
- Run `hooks.onStart` in `emmett.processor.hooks.on_start`, passing the child scope in the hook context.
- Run `checkpointer.read` in `emmett.processor.read_checkpoint`; set `emmett.processor.checkpoint` on it when a checkpoint is read.
- Create a child span only when the step runs (no lock → no acquire_lock span).
- A failure in a child marks that child and the start span failed (the tracer does this when the error propagates); no log here, because this is an internal rethrow (spec §3 rule 1).

Tests first, in `processors.observability.unit.spec.ts`:
- "lock acquisition runs in an acquire_lock span under the start span".
- "the onStart hook runs in a hooks.on_start span and receives that scope".
- "reading the checkpoint runs in a read_checkpoint span carrying the checkpoint".
- "no acquire_lock span is created when the processor has no lock".
- "a failing onStart hook fails its span and the start span and logs nothing".

Done when: tests pass, build green.
```

### Prompt 8: `emmett.processor.close` span, `release_lock` child and "Processor stopped"

```text
Context: spec.md §5 rows `emmett.processor.close`, `emmett.processor.release_lock`; §6 "Clean processor close". Decision: Q35.

Today `close` in `processors.ts` (around line 709) runs the lock release and `onClose` in `processingScope` with the caller's scope or `noopScope`. `start` registers `onShutdown(() => close(startOptions))`.

Goal:
- Wrap `close` in `emmett.processor.close` through the collector's lifecycle method from prompt 6, parented on the caller's scope when it has a real span.
- Release the lock in a child span `emmett.processor.release_lock`, passing its scope into the lock's context.
- Log `info` "Processor stopped" with the processor ids inside the close span, once per clean close.
- Keep the existing order (lock released before `onClose`) and its comment.
- Remove the `// TODO: Consider adding explicit close scope` comment.
- A close failure propagates as today; no log here (internal rethrow).

Tests first:
- "closing a processor opens an emmett.processor.close span and logs Processor stopped at info".
- "the lock is released in a release_lock span under the close span, before onClose runs".
- "closing a processor that never acquired a lock creates no release_lock span".

Done when: tests pass, build green, unit suite passes.
```

### Prompt 9: message handler failure is logged once inside the message scope

```text
Context: spec.md §6 core row "eachMessage handler failure", §3 rule 2. Decisions: Q21, Q23.

Today, when the message handler throws, the error reaches the outer `catch` around line 1021 of `processors.ts`, which logs an interpolated message and returns `STOP`.

Goal:
- Catch handler failures inside the message scope (`collector.startMessageScope`, line ~571). Log one `error` with event name `emmett.processor.message.exception` and body "Processor stopped: message handling failed". Attributes: `emmett.processor.id`, `emmett.processor.instance_id`, `emmett.processor.type`, `emmett.event.type`, `messaging.message.id`, `emmett.stream.name`, `emmett.stream.position`, `emmett.processor.checkpoint.before`, and the error. Pass the error as the log event's `error` so sinks produce the `exception.*` fields (check how `otelLogger` maps `data.error` and assert on that).
- The message span fails (error status via the tracer).
- The loop returns `STOP` with the error, as today.
- The outer catch at `:1021` doesn't log again for handler failures. Errors that reach it from elsewhere (for example storing the checkpoint) are handled by Emmett there, so keep one `error` log for them there, with a short stable message and ids in attributes (spec §3 rule 2). If you find a path where the same error would be logged twice, stop and ask Oskar.

Tests first:
- "a failing message handler logs one error with message and processor attributes and stops the processor".
- "the message span of a failing handler has error status".
- "a failing checkpoint store logs one error and stops the processor".
- "exactly one error log is written per failure" (count them).

Done when: tests pass, build green.
```

### Prompt 10: custom `eachBatch` failure

```text
Context: spec.md §6 core row "Custom eachBatch failure". Decision: Q24.

Find where a processor's custom `eachBatch` handler is called in `processors.ts`. When it throws:
- Log one `error` with event name `emmett.processor.batch.exception` and body "Processor stopped: batch handling failed". Attributes: processor ids, `emmett.processor.batch_size`, first and last `emmett.stream.position` of the batch (ask Oskar for attribute names if the existing `EmmettAttributes` don't cover first/last; don't invent them), `emmett.processor.checkpoint.before`, and the error.
- The processor stops as it does today and the batch span fails.
- No second log from the outer catch (same rule as prompt 9).

Tests first:
- "a failing eachBatch handler logs one error with batch attributes and stops the processor".
- "exactly one error log is written per batch failure".

Done when: tests pass, build green, unit suite passes.
```

### Prompt 11: consumer start/stop spans and "Consumer stopped"

```text
Context: spec.md §5 (consumer paragraph), §6 core row "Consumer outer catch in start". Decisions: Q14, Q36.

Today `start` in `src/packages/emmett/src/consumers/consumers.ts` (around line 340) runs an async block with a `try`; failures surface as a rejected `start` promise, and `stop` (line ~294) logs `console.log('Error during consumer stop:', error)`. The consumer has a collector in `consumers/observability/consumerCollector.ts` (`consumer.poll`, `consumer.deliver`).

Goal:
1. Add lifecycle spans to the consumer collector, following the processor collector from prompt 6: `emmett.consumer.start` around the start block and `emmett.consumer.stop` around `stop`. Both carry `emmett.consumer.id` and `emmett.consumer.processor_count`.
2. Pass the start span's scope down to processor `init` and `start` as `observabilityScope`, so the processor spans from prompts 6-8 become its children.
3. In the outer `catch` of the start block, log one `error` "Consumer stopped" with `emmett.consumer.id`, the failing processor id when known (`emmett.processor.id`), and the error. This is the only error log for a consumer failure.
4. Clean stop logs `info` "Consumer stopped" inside the stop span? The spec only requires the error log. Ask Oskar before adding an info log on clean stop.

Tests first, in the consumer unit tests (in-memory or the generic consumer used there):
- "starting a consumer opens an emmett.consumer.start span with the consumer id".
- "processor start spans are children of the consumer start span".
- "a consumer that fails logs one Consumer stopped error with the consumer and processor ids".
- "stopping a consumer opens an emmett.consumer.stop span".

Done when: tests pass, build green.
```

### Prompt 12: the remaining `console.log` sites in consumers

```text
Context: spec.md §3 rule 1, §6 core rows for `consumers.ts` and `processorStartPositions.ts:137`, `consumerCollector.ts:133`. Decisions: Q4, Q14.

Apply, in `src/packages/emmett/src/consumers/consumers.ts`:
- `:273` (processor init failed): no log; the error propagates and the span fails.
- `:279` (cleanup after failed init failed): `warn` with `emmett.processor.id` and the error.
- `:284` (stopped after failed init): removed.
- `:303` (error during consumer stop): removed. The error was already logged as "Consumer stopped" by prompt 11.
- `:347` (already running): `debug` with `emmett.consumer.id`.
- `:396` (batch processing failed for a processor): no log; the error propagates.
In `processors/processorStartPositions.ts:137`: no log; mark the span failed by letting the error propagate (check the surrounding code; if it swallows the error, ask Oskar).
In `consumers/observability/consumerCollector.ts:133`: remove the `child.log(LogEvent.error(error))` line. The span still fails and the error is rethrown.

Line numbers may have shifted after prompt 11; match by content.

Tests first:
- "a failing processor init logs nothing but Consumer stopped".
- "a failing cleanup after init failure logs a warning with the processor id".
- "starting an already running consumer logs at debug".
- "a failed delivery fails the consumer.deliver span and logs nothing" (for the collector).

Done when: no `console.` call remains in `consumers/`, tests pass, build green.
```

### Prompt 13: command handling logs only at the outermost operation

```text
Context: spec.md §3 rule 3, §6 core row `commandHandlerCollector.ts:141`. Decisions: Q22, Q37, Q38.

Today `src/packages/emmett/src/commandHandling/observability/commandHandlerCollector.ts` (around line 130) sets `error: true`, `exception.message` and `exception.type` span attributes and logs every failure at `error`.

Goal:
- Log only when `command.handle` is the outermost Emmett operation: it was started with `startScope` and had no parent scope. Find how the collector decides between `startScope` and a child scope (`withOperationAttributes`, `withOperationScope`) and use that same signal.
- Level: `debug` for `ConcurrencyError`, `ValidationError`, `IllegalStateError` and `NotFoundError` (Emmett's error types; use `instanceof` or the existing type guards), `error` for anything else. Pass the error as the event's `error`, with `emmett.command.type` and `emmett.stream.name` attributes.
- Nested command handling only fails its span; no log.
- Remove the `error: true`/`error: false`, `exception.message` and `exception.type` span attributes. Keep `emmett.command.status`.

Tests first:
- "a command failing with ConcurrencyError at the outermost level logs at debug".
- "a command failing with an unexpected error at the outermost level logs at error".
- "a command handled inside another Emmett operation logs nothing on failure".
- "a failed command span has no exception attributes and keeps emmett.command.status failure".

Done when: tests pass, build green, unit suite passes.
```

### Prompt 14: `emmett.eventstore.hooks.on_after_commit` span

```text
Context: spec.md §5 last row, §6 core row `afterEventStoreCommitHandler.ts:74`. Decisions: Q15, Q39.

Today `tryPublishMessagesAfterCommit` in `src/packages/emmett/src/eventStore/afterCommit/afterEventStoreCommitHandler.ts` catches the hook's error, writes `console.error` and returns `false`. It's called by `inMemoryEventStore.ts` and `emmett-mongodb/src/eventStore/mongoDBEventStore.ts`.

Goal:
- `tryPublishMessagesAfterCommit` takes the append's `ObservabilityScope` (add a parameter or read it from the existing options; pick what keeps both call sites simplest and explain the choice).
- Run the hook in a child span `emmett.eventstore.hooks.on_after_commit` with `emmett.stream.name` and the message count (`emmett.eventstore.append.batch_size`).
- On failure: only this child span gets error status; the append span stays OK. Log one `error` "onAfterCommit hook failed" in the child scope with the stream name, message count and the error. Keep swallowing the error and returning `false`.
- Remove the `// TODO: enhance with tracing` comment.
- Pass the append scope from both call sites. Check that the in-memory and MongoDB append paths have a scope at that point (the event store collector); if one doesn't, ask Oskar.

E2E first (spec §7):
- Scenario 1, OTel by convention: `NodeSDK` + `EmmettInstrumentation` + `PinoInstrumentation`, in-memory exporters. A failing `onAfterCommit` hook produces an Emmett error record next to pino's own records, with the same trace id.
- Scenario 4, nothing configured: a child process with a failing `onAfterCommit` hook prints nothing to stdout or stderr.

Unit tests first, in `afterEventStoreCommitHandler.unit.spec.ts` and an in-memory event store test:
- "a failing onAfterCommit hook logs one error in an on_after_commit span and the append succeeds".
- "the append span stays OK when the hook fails".
- "a successful hook runs in an on_after_commit span and logs nothing".
Run the MongoDB event store integration tests that cover `onAfterCommit`.

Done when: unit, integration and both e2e tests pass, build green.
```

### Prompt 15: task processor uses almanac

```text
Context: spec.md §6 core rows `taskProcessor.ts:53`, `executionGuards.ts`, `:229`, `:233`; §9; §10 item 4. Decisions: Q16, Q42, Q43.

Today `src/packages/emmett/src/taskProcessing/taskProcessor.ts` takes `logger?: TaskProcessorLogger` (`{ error: (...args) => void }`), defaults to `console`, logs at line 229 ("TaskProcessor caught unhandled task rejection") and line 233 (logs and rethrows). `executionGuards.ts` passes `logger` through in three places.

Goal:
- Remove `TaskProcessorLogger` and the `logger` option. `TaskProcessorOptions`, the guard options in `executionGuards.ts` and `InProcessLock` take `observability?: Partial<Observability>` from almanac.
- Resolve it with almanac's default resolution (explicit, then global default, then noop). The task processor depends only on almanac, not on Emmett's observability module.
- `:229`: log `error` through the resolved almanac logger with a `taskGroupId` attribute (no `emmett.` prefix) and the error. No span yet.
- `:233`: rethrow only; remove the log.
- Nothing is logged with nothing configured (no `console` fallback).

Tests first, in the task processor unit tests:
- "an unhandled task rejection is logged at error with the task group id".
- "nothing is logged when no observability is configured".
- "a failure while processing the queue is rethrown without logging".
Update existing tests that pass `logger`.

Done when: no `TaskProcessorLogger` remains, tests pass, build green, unit suite passes.
```

## Phase 3: Drivers and web bindings

### Prompt 16: remove internal-rethrow, unreachable and test helper logs

```text
Context: spec.md §3 rule 1, §6 PostgreSQL/SQLite rows and "Test helpers" table. Decisions: Q4, Q17, Q28, Q34.

Remove these logs, keeping the surrounding behaviour (errors still propagate):
- `src/packages/emmett-postgresql/.../storeProcessorCheckpoint.ts:200`.
- `src/packages/emmett-sqlite/.../storeProcessorCheckpoint.ts:138`.
- `src/packages/emmett-postgresql/src/eventStore/projections/locks/tryAcquireProcessorLock.ts:67` and `:108`. The low-level SQL functions don't log.
- PostgreSQL `writeToStream.ts:20`: remove with no replacement; the code is unreachable (Q28). Don't delete the rest of `node/streaming`; that's a follow-up.

Test helpers:
- `src/packages/emmett/src/workflows/workflow.testHelpers.ts:306`: remove the `console.log`.
- `sqliteTestDatabase.ts:10` in `emmett-sqlite` and `emmett-tests`: remove the `console.log`, keep swallowing the error.

Find the files by name; match lines by content.

Tests first: for each checkpoint store, a test "a failing checkpoint store rethrows and logs nothing" using a collecting logger set globally with `setupEmmettObservability` (reset it after the test). Run the PostgreSQL and SQLite checkpoint and lock integration tests.

Done when: no `console.` call remains in those files (test helpers included), tests pass, build green.
```

### Prompt 17: PostgreSQL processor lock logs at debug

```text
Context: spec.md §6 PostgreSQL rows `PostgreSQLProcessorLockContext`, `postgreSQLProcessorLock.ts:54`, `:71`. Decision: Q17.

`PostgreSQLProcessorLockContext` is defined in `src/packages/emmett-postgresql/src/eventStore/projections/locks/postgreSQLProcessorLock.ts:33`. Prompts 7 and 8 already pass the `acquire_lock` and `release_lock` scopes into the lock's context.

Goal:
- Add an optional `observabilityScope` to `PostgreSQLProcessorLockContext`.
- At `:54` (acquire) and `:71` (release), log `debug` through that scope with `emmett.processor.id`, `emmett.processor.instance_id`, `emmett.processor.lock.key` and the outcome (acquired / not acquired / released). Short stable messages, no interpolation.
- Without a scope, log nothing.
- Inline projections use `postgreSQLProjectionLock`, which doesn't log. Leave it alone.

E2E first (spec §7):
- Scenario 2: the user's own pino, set globally with `setupEmmettObservability` through the sink recipe from spec §1. At `debug`, the PostgreSQL lock messages appear; at `info`, they don't.
- Scenario 7: winston plugged in with the same recipe behaves like scenario 2.
The recipe must stay a few lines long. If either scenario needs more than that, stop and tell Oskar; it means the API needs work, not the test. Prompt 22 copies this recipe into the docs.

Integration tests first, in `postgreSQLProcessorLock.int.spec.ts`:
- "acquiring the lock logs the outcome at debug with the lock key".
- "releasing the lock logs at debug".
- "a lock used without an observability scope logs nothing".
Then a PostgreSQL consumer integration test: with a collecting logger configured on the consumer, starting a processor produces the lock debug logs inside the `emmett.processor.acquire_lock` span (same trace id).

Done when: integration and both e2e tests pass, build green.
```

### Prompt 18: lifecycle logs reach the configured logger on every driver

```text
Context: spec.md §5, last paragraph. The processing scopes at `postgreSQLProcessor.ts:366`, `sqliteProcessor.ts:250`, `mongoDBProcessor.ts:117` and `:142`, and `eventStoreDBProcessor.ts:101` pass through whatever scope they get, else `noopScope`.

Goal: prove, per driver, that prompts 6-8 closed the gap. No production change is expected. If a test fails, find why and fix only what the spec covers; if the fix needs a decision, ask Oskar.

For each of PostgreSQL, SQLite, MongoDB and EventStoreDB, add one integration test next to that driver's existing consumer tests: "processor lifecycle logs and spans reach the configured observability". Configure a collecting tracer and logger on the consumer, start it, process one message, stop it. Assert:
- an `emmett.processor.start` span and an `emmett.processor.close` span exist under the consumer spans;
- one `info` "Processor started" and one `info` "Processor stopped" were logged, carrying the processor ids and trace ids of those spans.

Replicate the same scenario across drivers, following the existing driver test structure.

E2E, scenario 3 (spec §7), loggers per component: one PostgreSQL event store gets its own pino child logger and receives that store's logs (its consumers' lifecycle logs); the global logger gets the logs of a second store without its own logger. Write it before running the driver tests. If a store's observability doesn't reach its consumers, stop and ask Oskar.

Done when: the four driver tests and the e2e test pass and `npm run test:unit` passes.
```

### Prompt 19: Express binding

```text
Context: spec.md §6 "Web bindings", §9. Decisions: Q7, Q29, Q30, Q31, Q32, Q44.

Today `src/packages/emmett-expressjs/src/application.ts` has `observability?: Partial<Observability<string>>`, adds `traceIdMiddleware` only when that option is truthy (line 65), and `startAPI` writes `console.info('server up listening')` (line 91).

Goal:
- Resolve observability as: explicit option, then the global default (`currentDefaultObservability()` from almanac), then noop. The option stays optional.
- Add `disableTraceIdHeader?: boolean`. The `x-trace-id` middleware is on when Emmett observability is registered (explicit option or `currentDefaultObservability()` returns a value) and `disableTraceIdHeader` isn't `true`. The header value still comes from the active OTel span, as `traceIdMiddleware` does, so without an active span no header is set.
- `startAPI` logs `info` "Server listening" with the port as an attribute through the resolved logger. Nothing configured → silent. Remove the `console.info`. `startAPI` needs access to the resolved observability; check its signature and pass it the smallest way.

E2E first, scenario 5 (spec §7): a logger passed through `getApplication` receives "Server listening" when the app starts.

Integration tests first, in `application.int.spec.ts`:
- "adds x-trace-id when observability is registered globally".
- "adds x-trace-id when observability is passed to the application".
- "does not add x-trace-id when disableTraceIdHeader is true".
- "does not add x-trace-id when no observability is registered".
- "startAPI logs Server listening with the port to the configured logger".
- "startAPI prints nothing when nothing is configured".
Reset the global default after each test.

Done when: integration and e2e tests pass, build green.
```

### Prompt 20: Hono binding

```text
Context: same as prompt 19. Keep Express and Hono aligned.

`src/packages/emmett-honojs/src/application.ts` has no `observability` option today. Apply the same behaviour as prompt 19:
- Optional `observability`, resolved explicit, then global default, then noop.
- `disableTraceIdHeader`. A Hono middleware that sets `x-trace-id` from the active OTel span when observability is registered. Follow how Express's middleware reads the span; don't share code across packages unless one already depends on the other.
- `startAPI` logs `info` "Server listening" with the port.

Tests first: scenario 5 as a Hono e2e test, then the six integration tests from prompt 19, adapted to Hono.

Done when: integration and e2e tests pass, build green.
```

### Prompt 21: Fastify binding

```text
Context: spec.md §6 "Fastify", §9. Decisions: Q29, Q33.

Today `src/packages/emmett-fastify/src/index.ts` has `serverOptions?: { logger: boolean }` defaulting to `logger: true`, and `startAPI` writes `console.log('Server listening on ...')` (line 80).

Goal:
- `serverOptions` accepts Fastify's full server options type (`FastifyServerOptions` or what the installed version exports), so `logger: {...}` and `loggerInstance` work.
- The default follows Fastify: `logger: false`.
- Remove the `console.log` in `startAPI`; Fastify prints its own listening line when its logger is on.
- Keep `app.log.error`.
- Add `observability` and `disableTraceIdHeader` with the same rules as prompt 19, because spec §6 aligns Express, Hono and Fastify on the `x-trace-id` header. Don't add a "Server listening" log; the spec lists it only for Express and Hono.

E2E first, scenario 5 for Fastify (spec §7): with Fastify's logger on through `serverOptions`, the listening line comes from Fastify's logger.

Integration tests first:
- "the Fastify logger is off by default".
- "a loggerInstance passed in serverOptions receives Fastify's logs".
- "startAPI writes nothing to the console when the logger is off".
- The x-trace-id tests from prompt 19.

Done when: integration and e2e tests pass, build green, unit suite passes.
```

## Phase 4: Docs and CLI

### Prompt 22: Logging docs page, samples and release notes

```text
Context: spec.md §8, §9. Decisions: Q13, Q37, Q38, Q45.

Docs (`src/docs`):
- Add a "Logging" page and link it from the navigation next to the existing observability pages. Cover: the convention path (NodeSDK + EmmettInstrumentation + PinoInstrumentation, from `samples/webApi/expressjs-with-postgresql/src/register.ts`); the explicit sink recipe for pino and winston (the exact code from the e2e tests written in prompt 17); the level rule (no `minLevel` means your logger decides); that the stack trace lives in the exception log record, not on the span; the span and attribute names from spec §4 and §5; `attributeTarget` with `mainSpan` for wide events; that `x-trace-id` works with OTel only and how to turn it off.
- Update every docs code block still using `logger({ event })` or `consoleLogger` as a value.
- Plain language, examples first, one line per paragraph.

Samples:
- Each sample keeps showing the recommended setup for its own stack. Update any sample broken by the API changes. Don't add new samples unless Oskar asks.

Release notes:
- Find where Emmett keeps release notes or the changelog. List the breaking changes from spec §9 as direct breaks (no deprecation aliases) and the behaviour changes (Fastify default, the `x-trace-id` header). If there is no such file, write the list in your final message for Oskar instead of creating one.

Verification:
- `npm run docs:build`.
- `npm run agent:check`.
- `npm run test:unit`.

Done when: all three pass. Report each command and its result.
```

### Prompt 23: CLI, then full verification

```text
Context: spec.md §6 "CLI" table. Decisions: Q25, Q27, Q46. The CLI matters least, so it comes last.

CLI (`src/packages/emmett/src/cli.ts`, `commandLine/plugins.ts`, `commandLine/config.ts`):
- `config.ts:25`, `:80` and `schema.print()` are command output. Keep `console.log` to stdout.
- `plugins.ts:95`, `:104`, `cli.ts:31`, `:37-38`, `config.ts:27-28`, `:73`, `:83`: `error` through one `consoleLogger({ destination: 'stderr' })`.
- `plugins.ts:52`, `:119`: `warn` on the same stderr logger.
- `plugins.ts:87`, `:122`: `debug` on the same logger.
- `plugins.ts:28` (`IMPORTING`): remove.
- `plugins.ts:73` ("No extensions specified"): remove (Q46).
Decide where the single stderr logger is created so every CLI file shares it without a new abstraction; show Oskar the choice.

E2E first, scenario 6 (spec §7): a failing CLI command prints the error on stderr and nothing on stdout. Mirror the existing CLI tests in `emmett-tests/src/cli` if they exist.

Unit tests first: one per level, showing the message goes to stderr and command output stays on stdout.

Final verification, from `src`:
- `npm run agent:check`.
- `npm test` (unit, integration and e2e).

Done when: all pass. Report each command and its result.
```
