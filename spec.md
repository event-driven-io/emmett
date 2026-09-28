# Spec: finish the almanac logging integration in Emmett

Sources: the call-site inventory in [log.md](log.md) and the decisions in [qa.md](qa.md) (Q1–Q49). Each rule below cites the question it comes from. Where a later answer changed an earlier one, only the final decision is listed.

## Goal

Every piece of logging Emmett already has goes through almanac, runs inside a span, and puts the same information on that span. Users can plug in their current setup by convention (OTel instrumentation or a global registration) or explicitly, without Emmett forcing almanac, OTel or any other stack on them (Q1–Q3, Q16).

Scope: wrap up the existing logging and fill obvious gaps. Adding more logging, and renaming existing spans, come later (Q36, Q40).

## Principles

1. **Traces come first. Logs are a fallback.** Someone who enables only tracing must get all the information. Logs carry the same information for people who prefer them (Q36).
2. **Nothing is logged unless the user asks.** With nothing configured, Emmett uses the noop logger (Q8).
3. **Almanac is an internal detail.** It must not force OTel or any stack, and it must reduce boilerplate, not add to it (Q1, Q16).
4. **Follow best practices and the least-surprise option.** Emmett behaves like any other OTel instrumentation library (Q21, Q38, Q40).
5. **Plug and play.** Registering Emmett observability once is enough. No flag is needed to make telemetry work (Q31, Q32).

## 1. How users connect their logger

- **Resolution order everywhere:** the component's own `observability` option, then the parent's resolved observability passed down, then the global default, then noop (Q5, Q16, Q30).
  - The global default is the single slot almanac keeps on `globalThis`.
  - `setupObservability`, `setupEmmettObservability`, `AlmanacInstrumentation` and `EmmettInstrumentation` write to it.
- **By convention:** `NodeSDK` + `EmmettInstrumentation` (+ `PinoInstrumentation`), as in `samples/webApi/expressjs-with-postgresql/src/register.ts` (Q3).
- **Explicitly:** a user-written sink function passed through `observability`. There are no adapters (Q2). Almanac's pino provider has only `pinoTracer`, no pino logger, so a user's own pino (or winston) logger connects through the documented sink recipe. The recipe must stay a few lines long; e2e scenarios 2 and 7 prove it.
- **The level setting closest to the user's config wins** (Q9):
  - `logger()` without `minLevel` forwards every event, and the user's logger applies its own level.
  - An explicit `minLevel` is honoured.
  - `consoleLogger` and `otelLogger` pass `minLevel: 'info'` explicitly.

## 2. Almanac changes

| Change                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Source   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Rename `logger({ event, minLevel })` to `logger({ log, minLevel })`. No `.event` remains in the logging API. Keep `eventName` and the `LogEvent` type.                                                                                                                                                                                                                                                                                                      | Q19, Q20 |
| `scope.log` adds `traceId`, `spanId`, `correlationId` and `causationId` to every log, at least when the user's logger doesn't add them already. `LogEventMetadata` gets the two missing fields. Sinks follow the OTel pino instrumentation convention: pino records get top-level `trace_id`, `span_id`, `correlation_id` and `causation_id`; OTel log records keep trace and span ids native and get `correlation_id` and `causation_id` attributes (Q48). | Q19, Q48 |
| On failure, the OTel tracer sets `Error` status, `error.type`, and the exception message as the status description. It stops writing an `exception` log for every failed span (`otelTracer.ts:112`).                                                                                                                                                                                                                                                        | Q21      |
| `consoleLogger` becomes a function, `consoleLogger({ destination: 'stdout' \| 'stderr' })` (pino style). It writes every level to stdout by default and stops using `console.trace`. Callers to update: `migrate.ts`, `eventStoreDBContainer.ts` and almanac's tests.                                                                                                                                                                                       | Q26, Q27 |
| No `exception.*` span attributes. The stack trace lives in the single exception log record, which goes through the OTel Logs API by default when `otel()` is used.                                                                                                                                                                                                                                                                                          | Q37, Q38 |

## 3. Error rules

1. **Internal rethrow:** mark the span failed and don't log. The checkpoint stores, the consumer batch/init failures and `processorStartPositions.ts:137` drop their `console.log` (Q4, Q14).
2. **Error handled by Emmett** (processor stops, consumer stops, `onAfterCommit` swallowed, task rejection): log once at `error`, inside the span where it's handled, with `exception.type`, `exception.message` and `exception.stacktrace` and an `<operation>.exception` event name (Q21).
3. **Error handed back to user code:** log once at the outermost Emmett operation (Q22, "for now"):
   - `debug` for `ConcurrencyError`, `ValidationError`, `IllegalStateError` and `NotFoundError`.
   - `error` for anything else.
   - Nested steps only mark their spans failed.

## 4. Log format

- Use a short, stable message (`eventName`/body) plus structured attributes. Never interpolate ids into the text (Q18).
- Reuse the `EmmettAttributes` names from spans (`emmett/src/observability/attributes.ts`). `emmett.processor.checkpoint.before` already exists. Add the missing ones: `emmett.consumer.id`, `emmett.processor.instance_id`, `emmett.processor.lock.key`, `emmett.processor.start_from`, `emmett.processor.checkpoint`, `emmett.stream.position` (Q18, Q23, Q35).
- Attribute names are lowercase, dot-namespaced snake_case (Q40).

## 5. Spans

Every log below is written inside a span, and the span carries the same attributes (Q35, Q36).

New spans use library-prefixed, dotted, lowercase snake_case names. Ids and positions go in attributes, never in names (Q40):

| Span                                      | Contents                                                                                                                                                                                                                    |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `emmett.processor.start`                  | Carries the "Processor started" attributes. Created by the processor's own collector, not `noopScope`, so it works under the default and the PG consumers. It becomes a child of a caller-provided scope when there is one. |
| `emmett.processor.acquire_lock`           | Child of start. The Q17 lock logs are written here.                                                                                                                                                                         |
| `emmett.processor.hooks.on_start`         | Child of start.                                                                                                                                                                                                             |
| `emmett.processor.read_checkpoint`        | Child of start.                                                                                                                                                                                                             |
| `emmett.processor.close`                  | "Processor stopped" is logged here.                                                                                                                                                                                         |
| `emmett.processor.release_lock`           | Child of close.                                                                                                                                                                                                             |
| `emmett.eventstore.hooks.on_after_commit` | Child of the append span. On failure only this span gets `Error` status; the append stays OK.                                                                                                                               |

Consumer start and stop get the same treatment, so "Consumer stopped" runs inside a consumer span (Q36).

The span names use the namespace the attributes already use: `emmett.eventstore`, not `emmett.event_store`.

All four drivers need the fix: the default, PostgreSQL, SQLite and MongoDB consumers give processors no `observabilityScope`, and each driver's processing scope (`postgreSQLProcessor.ts:366`, `sqliteProcessor.ts:250`, `mongoDBProcessor.ts:117`, `:142`, `eventStoreDBProcessor.ts:101`) passes through whatever the caller gives it, else `noopScope`. Once the processor's start and close spans pass their scope into the context, the lock and lifecycle logs reach the configured observability for every driver.

## 6. Call sites

### emmett core

| Site                                                         | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Source        |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| `processors.ts:778`, `:786`, `:815`, `:831`                  | `debug`                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Q35           |
| `processors.ts:801`, `:852`, `:861`, `:872`, `:880`          | One `info` "Processor started" with `emmett.processor.id`, `instance_id`, `type`, `start_from` (`BEGINNING`, `END`, `checkpoint` or `explicit`) and `checkpoint`                                                                                                                                                                                                                                                                                             | Q35           |
| Clean processor close (new)                                  | `info` "Processor stopped"                                                                                                                                                                                                                                                                                                                                                                                                                                   | Q35           |
| `eachMessage` handler failure                                | Caught inside the message scope. One `error` log, `emmett.processor.message.exception`, "Processor stopped: message handling failed". Attributes: processor ids, `emmett.event.type`, `messaging.message.id`, `emmett.stream.name`, `emmett.stream.position`, `emmett.processor.checkpoint.before` and `exception.*`. The loop returns `STOP` with the error, so `processors.ts:1021` doesn't log again.                                                     | Q23           |
| Custom `eachBatch` failure                                   | One `error` log, `emmett.processor.batch.exception`, "Processor stopped: batch handling failed". Attributes: processor ids, batch size, first and last positions, `checkpoint.before` and `exception.*`.                                                                                                                                                                                                                                                     | Q24           |
| Consumer outer `catch` in `start` (new)                      | One `error` log, "Consumer stopped", with the consumer id, the failing processor id when known, and the error. It's the only error log for a consumer failure.                                                                                                                                                                                                                                                                                               | Q14           |
| `consumers.ts:396`, `:273`, `processorStartPositions.ts:137` | Span only                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Q14           |
| `consumers.ts:279`                                           | `warn`                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Q14           |
| `consumers.ts:284`, `:303`                                   | Removed                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Q14           |
| `consumers.ts:347`                                           | `debug`                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Q14           |
| `commandHandlerCollector.ts:141`                             | Apply Q22: log only when `command.handle` is the outermost Emmett operation (started with `startScope`, no parent scope), at `debug` for `ConcurrencyError`, `ValidationError`, `IllegalStateError`, `NotFoundError` and `error` otherwise. Today it logs every failure at `error`. Also remove the `exception.message`, `exception.type` and `error: true` span attributes it sets (Q37, Q38); the tracer sets `error.type`. `emmett.command.status` stays. | Q22, Q37, Q38 |
| `consumerCollector.ts:133`                                   | Removed. It logs every failed `consumer.deliver` at `error` and rethrows (internal rethrow).                                                                                                                                                                                                                                                                                                                                                                 | Q4            |
| `afterEventStoreCommitHandler.ts:74`                         | Pass the append's scope in. Run the hook in the `on_after_commit` child span. Log `error` "onAfterCommit hook failed" with the stream name, message count and error. Keep swallowing the error. Remove the `TODO` comment. Only in-memory and MongoDB call it.                                                                                                                                                                                               | Q15, Q39      |
| `taskProcessor.ts:53`, `executionGuards.ts`                  | Remove `TaskProcessorLogger`. `TaskProcessorOptions`, the guard options and `InProcessLock` take an optional `observability?: Partial<Observability>`. TaskProcessor depends only on almanac, and its attributes carry no `emmett.` prefix.                                                                                                                                                                                                                  | Q16           |
| `taskProcessor.ts:229`                                       | `error` with `taskGroupId` and the error, through almanac's logger. No span yet (follow-up).                                                                                                                                                                                                                                                                                                                                                                 | Q16, Q43      |
| `taskProcessor.ts:233`                                       | Rethrow only. No span yet (follow-up).                                                                                                                                                                                                                                                                                                                                                                                                                       | Q16, Q43      |

### emmett-postgresql and emmett-sqlite

| Site                                                    | Decision                                                                                                                                              | Source |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `PostgreSQLProcessorLockContext`                        | Add an optional `observabilityScope`. Inline projections use a different lock (`postgreSQLProjectionLock`), which doesn't log, so they're unaffected. | Q17    |
| `postgreSQLProcessorLock.ts:54`, `:71`                  | `debug` at the lock-object layer, with `processorId`, `processorInstanceId`, `lockKey` and the outcome                                                | Q17    |
| `tryAcquireProcessorLock.ts:67`, `:108`                 | Removed. The low-level SQL functions don't log.                                                                                                       | Q17    |
| `storeProcessorCheckpoint.ts:200` (PG), `:138` (SQLite) | Removed (internal rethrow)                                                                                                                            | Q4     |
| `writeToStream.ts:20`                                   | Removed, with no replacement. The code is unreachable.                                                                                                | Q28    |

### Web bindings (Express, Hono and Fastify aligned)

- Every binding accepts an optional `observability` option and resolves it explicit, then global default, then noop. The option is never required (Q7, Q30, Q32).
- The `x-trace-id` header is on once Emmett observability is registered (detected with almanac's `currentDefaultObservability()` or the binding option). The value comes from the active OTel span, as `traceIdMiddleware` does today, so with a non-OTel registration and no active span no header is set. The docs say the header works with OTel only (Q44).
- Registration means `EmmettInstrumentation`, `setupObservability` or the binding option. `disableTraceIdHeader: true` opts out. Generic OTel users without Emmett's instrumentation are unaffected (Q32).
- **Express and Hono:** `startAPI` logs `info` "Server listening" with the port through the resolved observability. With nothing configured, it's silent. This replaces Express's `console.info('server up listening')` (Q29, Q31).
- **Fastify:**
  - `serverOptions` takes the full Fastify server options (`logger: {...}`, `loggerInstance`), and the default follows Fastify (`logger: false`).
  - The `startAPI` `console.log` is removed, because Fastify prints its own listening line.
  - `app.log.error` stays.

  (Q29, Q33)

The Fastify default and the new header are behaviour changes for the release notes.

### CLI

| Site                                                                            | Decision                                              | Source   |
| ------------------------------------------------------------------------------- | ----------------------------------------------------- | -------- |
| `config.ts:25`, `:80`, `schema.print()`                                         | Command output. Stays `console.log` to stdout.        | Q25      |
| `plugins.ts:95`, `:104`, `cli.ts:31`, `:37-38`, `config.ts:27-28`, `:73`, `:83` | `consoleLogger({ destination: 'stderr' })` at `error` | Q25, Q27 |
| `plugins.ts:52`, `:119`                                                         | `warn` on stderr                                      | Q25      |
| `plugins.ts:87`, `:122`                                                         | `debug` on stderr                                     | Q25      |
| `plugins.ts:28` `IMPORTING`, `plugins.ts:73`                                    | Removed                                               | Q25, Q46 |

### Test helpers

| Site                                                         | Decision                                                       | Source |
| ------------------------------------------------------------ | -------------------------------------------------------------- | ------ |
| `workflow.testHelpers.ts:306`                                | Remove the `console.log`                                       | Q34    |
| `sqliteTestDatabase.ts:10` (`emmett-sqlite`, `emmett-tests`) | Remove the `console.log` and keep swallowing the error for now | Q34    |

## 7. Tests

Tests are written from the user's perspective (Q11):

- **Unit tests** check specific behaviour: the exact `LogEvent`s and span attributes per site, level filtering, and that rethrow sites log nothing.
- **Integration tests** run whole flows on real infrastructure.
- **E2E tests** mimic the end user's setup and live in their respective packages. Oskar reviews them. Samples are not tests.

E2E scenarios (Q12, Q33):

1. OTel by convention (`NodeSDK` + `EmmettInstrumentation` + `PinoInstrumentation`): a failing `onAfterCommit` hook produces an Emmett error record next to pino's records, with the same trace id.
2. The user's own pino, set globally via `setupEmmettObservability`: at `debug` the PG lock messages appear, and at `info` they don't.
3. Loggers per component: one event store's own pino child logger gets that store's logs, and the global logger gets the rest.
4. Nothing configured: a child process with a failing hook prints nothing.
5. Web app: a logger passed through `getApplication` receives "Server listening" on Express and Hono. On Fastify the line comes from Fastify's logger.
6. CLI: a failing command prints the error on stderr.
7. A non-pino logger (winston), plugged in with the documented recipe, behaves like scenario 2.

## 8. Docs and samples

- **A "Logging" docs page** covering:
  - the convention path and the explicit sink recipe;
  - the level rule (Q9);
  - that the stack trace lives in the exception log record (Q38);
  - the span and attribute names;
  - `attributeTarget` (`mainSpan` for wide events), which exists but is undocumented (Q37).
- **Samples:** each one showcases the recommended setup for its own stack. Add dedicated OTel or logging samples only if needed (Q13).

## 9. Breaking changes

These ship as direct breaks, with no deprecation aliases, and are listed in the release notes. The logging API hasn't been officially released yet (Q45).

- `logger({ event })` becomes `logger({ log })`.
- `consoleLogger` becomes a function, `consoleLogger()`.
- `TaskProcessorOptions.logger` (and `TaskProcessorLogger`) is replaced by `observability`.
- Fastify's logger default changes from `true` to `false`.
- The `x-trace-id` header turns on once Emmett observability is registered.

## 10. Follow-ups (out of scope)

1. Rename all existing spans to the Q40 scheme (`eventStore.appendToStream`, `command.handle`, `processor.message.{type}` and so on). Message processing may adopt the messaging convention, `process {destination}`.
2. Log unhandled 5xx errors in the web bindings (Q7).
3. Delete PG `node/streaming` (Q28).
4. Complete spans for `taskProcessor` (Q42, Q43): a span per task with queue wait and run time, names and attributes under almanac rather than `emmett.` (Q16), and a check of the cost on every command and lock. Until then, the `:229` log is the only Emmett log outside a span.
5. Revisit swallowing the SQLite test cleanup error (Q34) and the "for now" error-level rule for errors handed back to user code (Q22).
6. Document the OTel SDK's log-to-span-event bridge once the JS SDK ships it (Q38).
7. Extra logging for people who prefer logs over traces (Q36).
8. PostgreSQL projection `init` and `truncate` hand user code `noopScope` (`postgreSQLEventStore.ts:392`, `:519`, `postgreSQLProjection.ts:74`); logs a user projection writes there go nowhere. Emmett itself logs nothing there.
