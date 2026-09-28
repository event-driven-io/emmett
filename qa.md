# Almanac logging integration: Q&A

Background inventory: [log.md](log.md).

## Q1. Which groups of explicit logging should the spec cover?

Options: (a) runtime library code only, (b) runtime code plus web bindings, (c) everything except benchmarks and samples, CLI included.

**Oskar (verbatim):**

> C, for web bindings we should allow people to integrate with their currents setup, we should never impose to use almanac, it's internal usage, so it should integrate with other loggers people use like pino, watson etc.

**Answer:** (c). The web bindings must let people plug in their current logging setup. Emmett never forces anyone to use almanac: almanac is an internal detail, so it has to integrate with the loggers people already use, such as pino or winston.

## Q2. How should a user connect their existing logger?

Options: (a) ready-made adapters in almanac for pino and winston, (b) accept any object shaped like `{ error, warn, info, debug }`, (c) no adapters, document a short recipe.

**Oskar (verbatim):**

> Pino exists already and as the built-in as Pino is the most popular, but I won't be providing that for everything. PPeople can setup their own and it should be asy to do.
>
> Plus dude, we already have logging plugged, just some stuff is missing and we might need to doublecheck if it's easy to integrate other tools

**Answer:** No adapter per library. Pino is the one built-in integration because it is the most popular. Anyone else writes their own, and that must be easy. Logging is already plugged in (`observability.logger`, `setupObservability`, `scope.log`, `consoleLogger`, `otelLogger`). The work is to fill in the missing call sites and double-check that plugging in another tool is easy.

## Q3. Should `@event-driven-io/almanac/pino` also export `pinoLogger(pino): Logger`?

**Oskar (verbatim):**

> Dude, check postgresql sample setup e.g. samples/webApi/expressjs-with-postgresql/src/register.ts
>
> To your point, Dude, stop overfocusing on adapters, I want to ensure that all the pieces that we have atm are correctly traced and loggers will use almanac, then ensure that integration is straightforward...

**Answer:** No, stop focusing on adapters. Look at the sample setup in `samples/webApi/expressjs-with-postgresql/src/register.ts`: integration already goes through OpenTelemetry. `EmmettInstrumentation` registers `otelLogger` as the global default logger via `setupObservability`, and pino reaches the same OTel pipeline through `PinoInstrumentation` and `pino-opentelemetry-transport`. The goal is that every existing piece is correctly traced and logs through almanac. After that, check that integration stays straightforward.

## Q4. How should sites that log an error and then rethrow it behave?

Options: (a) record the error on the span and log only where it is handled (swallowed or turned into a decision), (b) log at every site.

**Oskar (verbatim):**

> To your question, we should enable using the same pingo config for Emmett

> Dude, wtf you doing pingo was a typo, I mean pino

> a

**Answer (partial):** A user must be able to use the same pino config for Emmett. The pino instance they already set up, with its level, transport and formatting, should also drive Emmett's logs. For the rethrow sites: (a). Mark the active span as failed and set the exception attributes, but don't log. Log once, where the error is handled (swallowed or turned into a decision such as stopping a processor). The checkpoint stores drop their `console.log`, because their caller already logs.

## Q5. How do sites with no observability in reach get a logger?

Sites: the `onAfterCommit` hook error, `taskProcessor`, the PostgreSQL processor lock, `writeToStream`. Options: (a) pass the owner's resolved observability down, (b) read the global default at the site.

**Oskar (verbatim):**

> a)

**Answer:** (a). The owner passes its resolved observability down: the event store to the after-commit handler, the processor to the lock, and so on. `TaskProcessorOptions.logger` becomes almanac's `Logger`, a breaking type change. Per-component config is respected, and the global default still applies through `mergeWithDefaultObservability`.

## Q6. Which log levels should the non-rethrow sites use?

**Oskar (verbatim):**

> Makes sense to me

**Answer:** Accepted as proposed:

| Site                                                                         | Level          |
| ---------------------------------------------------------------------------- | -------------- |
| PG lock acquisition result (`tryAcquireProcessorLock.ts:67`)                 | `debug`        |
| PG lock release result (`tryAcquireProcessorLock.ts:108`)                    | `debug`        |
| Lock already held, reusing (`postgreSQLProcessorLock.ts:54`)                 | `debug`        |
| Lock not held, skipping release (`postgreSQLProcessorLock.ts:71`)            | `debug`        |
| `start()` on a running consumer (`consumers.ts:347`)                         | `debug`        |
| Error during consumer stop, swallowed (`consumers.ts:303`)                   | `warn`         |
| `onAfterCommit` hook threw, swallowed (`afterEventStoreCommitHandler.ts:74`) | `error`        |
| Unhandled task rejection (`taskProcessor.ts:229`)                            | `error`        |
| Loop error, rethrown (`taskProcessor.ts:233`)                                | span only (Q4) |
| Stream write failed, swallowed (`writeToStream.ts:20`)                       | `error`        |

## Q7. What should the web bindings log, and where do they get the logger?

Proposal: a new `observability` option on all bindings, startup message at `info`, 5xx errors at `error`, and Fastify keeping its native `serverOptions.logger`.

**Oskar (verbatim):**

> About 1. How is it different to what we have and what we setup in sample?

> Also I'm mostly concerned about the logging we have already, not about bindings, mostly about ensuring that user can easily integrate (by convention and explicitly) with their current state of the art

> We should allow passing logger through getApplication or so, but we shouldn't require that.

**Answer:** A new option adds nothing over what the sample already does: `EmmettInstrumentation` registers the global default, and `getApplication` is called without `observability`. Bindings are not the focus. The focus is the logging that already exists, and making sure users can integrate with their current setup easily, both by convention and explicitly. For bindings, only replace the existing `console` calls with the resolved logger (Express's existing `observability` option if set, otherwise the global default). Logging unhandled 5xx errors, which is new logging, is out of scope and noted as a follow-up.

Follow-up: every binding should accept a logger (observability) through `getApplication`, or similar, as an optional setting. Express already has the `observability` option; Hono and Fastify get the same. It is never required.

## Q8. What is the default logger when nothing is configured?

Options: (a) `consoleLogger` filtered to `warn`, (b) `noopLogger` as today, (c) `noopLogger` plus loud docs.

**Oskar (verbatim):**

> About the question, it should be either noop or whatever user configured. Nothing should be logged by Emmett unless requested from user

**Answer:** Either `noopLogger` or whatever the user configured. Emmett logs nothing unless the user asks for it.

## Q9. Who decides the log level, almanac or the user's logger?

Today `logger({ event, minLevel })` defaults `minLevel` to `info`, so a user whose pino runs at `debug` still never sees Emmett's debug logs: almanac drops them before the sink is called.

Discussion: Emmett never detects what the user runs. It reaches the user's logger in one of two ways. By convention, `EmmettInstrumentation` registers `otelLogger` and pino joins the same OTel pipeline. Explicitly, the user writes a small sink function and passes it in.

**Oskar (verbatim):**

> How other frameworks are handling this?

> I don't fully understand how would that work tbt. And how would we know what user uses and how to integrate and get their info.
>
> Also: "People complain about that regularly." how do you know it?

> I think that if user has filtered sink then they we should follow this, what's the least surprise solution?

**Answer:** If the user supplies a filtered sink, Emmett follows it. Take the least-surprise option: `logger()` without `minLevel` forwards every event, and the user's logger (pino, winston, etc.) applies its own level. An explicit `minLevel` is still honoured. The built-in `consoleLogger` and `otelLogger` keep their `info` default, because for them almanac is the backend. Rule: the level setting closest to the user's own config wins.

Clarification: if Emmett can't hand off to the user's own logging, or the user picks one of our loggers (`consoleLogger`, `otelLogger`), the minimum level is `info`. Implementation note: `otelLogger` and `consoleLogger` must pass `minLevel: 'info'` explicitly instead of inheriting it from `logger()`.

## Q10. How does the CLI and other terminal output fit with "nothing logged unless requested"?

Options: (a) the CLI uses almanac's `consoleLogger` explicitly, as `migrate.ts` already does, and `schema.print()` stays a plain `console.log`; (b) the CLI uses the observability default and stays silent unless configured.

**Oskar (verbatim):**

> If we can't integrate with user defined way, or someone uses our logger, then we should follow the minimum log level info.

**Answer (inferred from the Q9 clarification, to be confirmed):** (a). Running a command counts as a request. The CLI uses our `consoleLogger` with the `info` minimum. `schema.print()` is command output, not a log, so it stays `console.log`. The leftover `console.log('IMPORTING' + configPath)` in `plugins.ts:28` is removed.

## Q11. How do we prove it works and that integration is easy?

Proposal: a `collectingLogger()` in almanac testing, unit tests per site, integration tests with real pino and PostgreSQL, extending the sample's `observability.spec.ts`, and a docs page.

**Oskar (verbatim):**

> We should have the e2e tests mimicking the end user setup, I'll review it. Tests should be written from user perspective.
>
> So yes, all levels, but unit tests should be checking the specific behaviour, integration run e2e. Tests samples are samples, not testing.

**Answer:** All levels (unit, integration, e2e), each with a distinct job:

- Unit tests check specific behaviour: exact `LogEvent`s per site, level filtering, rethrow sites logging nothing.
- Integration tests run whole flows on real infrastructure.
- E2E tests mimic the end user's setup: configured the way a user would do it, and written from the user's perspective. Oskar reviews them.
- Samples are samples, not tests. Verification lives in the test suites (`*.e2e.spec.ts` in the packages or `emmett-tests`), not in `samples/`. Samples showcase the recommended setup.

## Q12. Which end-user setups should the e2e tests cover?

**Oskar (verbatim):**

> I mean, samples should showcase recommended setup.
>
> Yes, all in respective packages.

**Answer:** All seven, each in its own package:

1. OTel by convention: `NodeSDK` + `EmmettInstrumentation` + `PinoInstrumentation`. A failing `onAfterCommit` hook produces an Emmett error record next to pino's records, with the same trace id.
2. The user's own pino, set globally via `setupEmmettObservability`. At `debug` the PostgreSQL lock messages appear; at `info` they don't.
3. Different loggers per component: one event store's own pino child logger gets that store's logs, and the global logger gets the rest.
4. Nothing configured: a child process with a failing hook prints nothing.
5. Web app: a logger passed through `getApplication` (Express, Hono, Fastify) receives the startup message.
6. CLI: a failing command prints the error on the terminal.
7. A non-pino logger (winston) plugged in with the documented recipe behaves like scenario 2.

## Q13. Which setup do the samples recommend?

**Oskar (verbatim):**

> Dude, you almost didn't ask me anything about the places where we have logs and we need to adjust them, you're constantly talking about adapters.
>
> And, no, all samples should showcase the recommended setup for this specific stack.
>
> If we need more we can add dedicated ones for otel/logging

**Answer:** Each sample showcases the recommended setup for its own stack. If more is needed, add dedicated OTel or logging samples. The focus of the spec is the existing call sites and how each one is adjusted, not adapters.

## Q14. How should the consumer's failure path be logged?

Finding: a processor failure is logged at `consumers.ts:396` and rethrown. The consumer's outer `catch` in `start` stops the consumer and logs nothing. `stop()` then logs the same error again at `:303`.

**Oskar (verbatim):**

> fine

**Answer:** Accepted as proposed:

| Site                                                        | Change                                                                                                                                                                       |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Outer `catch` in `start` (new)                              | One `error` log, "Consumer {consumerId} stopped", with `consumerId`, the failing `processorId` when known, and the error. This is the only error log for a consumer failure. |
| `consumers.ts:396` batch failure                            | Span only (Q4).                                                                                                                                                              |
| `consumers.ts:273` init failure                             | Span only (Q4).                                                                                                                                                              |
| `processorStartPositions.ts:137`                            | Span only (Q4).                                                                                                                                                              |
| `consumers.ts:279` cleanup after failed init also failed    | `warn`.                                                                                                                                                                      |
| `consumers.ts:284` "stopped successfully after failed init" | Removed.                                                                                                                                                                     |
| `consumers.ts:303` error during `stop()`                    | Removed. It duplicates the outer `catch` (supersedes the `warn` from Q6).                                                                                                    |
| `consumers.ts:347` `start()` while running                  | `debug`.                                                                                                                                                                     |

## Q15. How should a failed `onAfterCommit` hook be reported?

Finding: only the in-memory and MongoDB stores call `tryPublishMessagesAfterCommit`; PostgreSQL, SQLite and ESDB don't support `onAfterCommit`. E2E scenarios with a failing hook therefore run on MongoDB or the in-memory store. Both call sites run inside the append's observability scope.

**Oskar (verbatim):**

> ok

**Answer:** Accepted as proposed:

- Pass the append's `observabilityScope` into `tryPublishMessagesAfterCommit`.
- Log once at `error` via `scope.log`: "onAfterCommit hook failed", with `streamName`, the message count, and the error.
- Don't mark the append span as failed, since the append succeeded. Set an attribute such as `emmett.after_commit.status = 'failure'` instead.
- Keep swallowing the error: a failing hook never fails a committed append.
- Remove the `// TODO: enhance with tracing` comment, which this resolves.

## Q16. How does `taskProcessor` get its logger?

Finding: `taskProcessor` is used only inside Emmett core by `InProcessLock` and the exported `guard*` helpers. None of them has observability config, and today the logger falls back to `console`. TaskProcessor will eventually become a standalone library that may depend on almanac.

"Global default" means the single slot almanac keeps on `globalThis` (`eventDrivenIoAlmanacDefaultObservability`). It is written by `setupObservability`, by `setupEmmettObservability` (a wrapper), and by `AlmanacInstrumentation`/`EmmettInstrumentation` when OTel enables them. Collectors read it through `mergeWithDefaultObservability`: the component's own option, then the parent's, then the global slot, then noop.

**Oskar (verbatim):**

> One thing to keep in mind is that TaskProcessor will be a dedicated library eventually, it can have dependency on almanac, but does it change your recommendation?
>
> It seems fine, but I'm not sure what do you mean by the global default.

> Again, almanac is a shared observability tool, it shouldn't force otel or any tech stack and help to reduce boilerplate not increase it.

**Answer:**

- Principle: almanac is a shared observability tool. It must not force OTel or any other tech stack, and it should reduce boilerplate, not add to it.
- Remove `TaskProcessorLogger`. `TaskProcessorOptions`, the guard options and `InProcessLock` take an optional `observability?: Partial<Observability>`, the same shape as every other component.
- TaskProcessor depends only on almanac, never on Emmett. It resolves through almanac's `mergeWithDefaultObservability`, and its attributes have no `emmett.` prefix (`taskGroupId`).
- In the common case the user passes nothing, and TaskProcessor uses what was registered once for the process.
- `taskProcessor.ts:229` unhandled task rejection logs at `error` with `taskGroupId` and the error. `taskProcessor.ts:233` is only rethrown.

## Q17. How should the PostgreSQL processor lock log?

Findings: the processor calls `lock.tryAcquire(context)`/`lock.release(context)` inside `processingScope`, so the context already carries `observabilityScope` at runtime, but `PostgreSQLProcessorLockContext` is typed as `{ execute }` only. Logging happens at two layers: the lock object and the low-level SQL functions. The processor already logs "Acquiring lock" at `info` (`processors.ts:815`). Inline projections call the lock with `{ execute }` only.

Also found: `processors.ts:778-880` already logs about ten processor lifecycle messages at `info` through `observabilityScope.log` (added to `log.md`).

**Oskar (verbatim):**

> Makes sense, but doublecheck this (ans also other logs traces) from the user diagnostic perspective. They need to give menaingful inforomation

**Answer:** Accepted:

- Add an optional `observabilityScope` to `PostgreSQLProcessorLockContext`. Inline projections fall back to noop.
- Log only at the lock object's layer, at `debug`, with `processorId`, `processorInstanceId`, `lockKey` and the outcome. The low-level SQL functions stop logging.

Condition: review this and every other log and trace from the user's diagnostic perspective. Each one must give meaningful information.

## Q18. Diagnostic review: should logs put IDs and positions in named fields instead of interpolating them into the message?

Findings from the diagnostic review:

1. IDs are interpolated into message text, so users can't filter or group logs by processor without regex.
2. The processor failure log (`processors.ts:1021`) doesn't say which message broke the processor (type, stream, position).
3. Processor startup emits six `info` lines for one fact ("started from position Y").
4. The lock failure error doesn't say which key or holder is involved.

**Oskar (verbatim):**

> I don't understand what do you mean by " Is "stable message + emmett.* attributes" the right convention?"

> Yes, if other tools are also doing such

**Answer:** Yes, as long as other tools do the same. Verified:

- .NET `ILogger` uses message templates with named placeholders that providers store as fields. Code analysis rule CA2254 is "Template should be a static expression".
- pino copies every key of the `mergingObject` into the JSON line next to `msg`.
- The OpenTelemetry log data model separates `EventName` (the class of event) from attributes (which vary per occurrence).
- almanac already supports it: `LogEvent.info({ eventName, ...attributes }, msg)`.

Convention: a short, stable message (`eventName`/body) plus structured attributes, reusing the existing `EmmettAttributes` names from spans. Missing names (`consumer.id`, `processor.instance_id`, `processor.lock.key`, and so on) are added to `EmmettAttributes`. Processor startup collapses to one `info` "Processor started" with the start position; the step-by-step lines drop to `debug`.

Sources: https://learn.microsoft.com/en-us/dotnet/core/extensions/logging/overview, https://github.com/pinojs/pino/blob/main/docs/api.md, https://opentelemetry.io/docs/specs/otel/logs/data-model/

## Q19. Should `scope.log` put correlation and causation ids into every log, and where?

Findings: `processors.ts:1021` is the `catch` around a whole batch that logs "Error during message processing for processor X with instance id Y. Stopping the processor." It's the only log a user gets when a projection or reactor dies, and it doesn't say which message failed. `scope.log` (`logForScope` → `logEventForSpan` in `almanac/src/scopes/scope.ts`) adds only `traceId` and `spanId` to the log metadata. The scope already knows `correlationId` and `causationId` (`scope.context`), but `LogEventMetadata` has no fields for them. Pino itself doesn't add trace ids. The OTel `PinoInstrumentation` (registered in the sample) injects `trace_id`, `span_id` and `trace_flags` into pino records, but only when a span is active. No tool adds correlation or causation ids, because they're Emmett concepts.

**Oskar (verbatim):**

> what's :1021?
>
> Also, correlation and causationid should be always in logs, right from the observability scope? Also you mentioned integration with other tooling with .event, while now we shouldn't have any .event but .log, right? Does event method exists on logger?

> Yes, there shouldn't be any .event now anymore.
>
> Yes, it should put also spanid and traceid, at least if the logger doesn't put it (I think that Pino does, does it?)

**Answer:** Yes. `scope.log` puts all four ids (`traceId`, `spanId`, `correlationId`, `causationId`) into every log, at least when the user's logger doesn't add them already. Also, the `logger({ event })` option name must go: there should be no `.event` in the logging API anymore.

Source: https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/packages/instrumentation-pino

## Q20. What replaces the `event` option in `logger({ event, minLevel })`?

**Oskar (verbatim):**

> Sounds fine, but is it aligned with https://opentelemetry.io/blog/2026/deprecating-span-events/?

**Answer:** Rename it to `log`: `logger({ log, minLevel })`, matching `scope.log` and the `Logger` type. Keep `eventName` in `info({ eventName, ... })` and the `LogEvent` type name, as long as that's aligned with OpenTelemetry's deprecation of span events.

Alignment check: OpenTelemetry deprecates the Span Event API (`Span.AddEvent`, `Span.RecordException`) in favour of "events are logs with names emitted via the Logs API, correlated with traces". Almanac already fits that: the OTel tracer never calls `addEvent` or `recordException`, `span.log` goes to the logger with trace and span ids, `eventName` maps to the log record's `EventName`, and `otelLogger` writes errors as `exception.type`, `exception.message` and `exception.stacktrace` attributes. So `eventName` and `LogEvent` stay: they're named events sent as logs, which is the model OpenTelemetry now recommends.

Sources: https://opentelemetry.io/blog/2026/deprecating-span-events/, https://opentelemetry.io/docs/specs/semconv/general/recording-errors/

## Q21. Should the tracer stop writing an `exception` log for every failed span?

Finding: when a span fails, the OTel tracer sets the `ERROR` status, writes an `error` log named `exception` (`otelTracer.ts:112`) and rethrows. Spans nest (processor → batch → message → handler), so one handler error produces one `exception` log per span it passes through. It doesn't set `error.type`.

**Oskar (verbatim):**

> We should align wih best practices

**Answer:** Align with best practices. OpenTelemetry's rules:

- Failed span: set status `Error`, set `error.type`, and optionally set a status description when it's not sensitive. Leave the status unset on success.
- Exceptions go to a log record, not to span events. "It's NOT RECOMMENDED to record the same exception more than once." "It's NOT RECOMMENDED to record exceptions that are handled by the instrumented library." "Exceptions which are propagated to the caller should be recorded (or logged) once."
- The event name describes the operation with an `.exception` suffix, or is plain `exception` when no domain fits. Attributes are `exception.type`, `exception.message` and `exception.stacktrace`.
- Severity: `ERROR` for exceptions application code doesn't handle, `WARN` for exceptions application code is expected to handle, and `DEBUG` for exceptions that don't indicate a problem.

Resulting rules for almanac and Emmett:

1. A failed span gets `Error` status, `error.type` and the error message as the status description. The tracer no longer logs for each span.
2. Each exception is logged once, with `exception.*` attributes and an `<operation>.exception` event name.
3. Where Emmett handles the error itself (processor stops, consumer stops, onAfterCommit swallowed, task rejection), it logs at `ERROR`.

Sources: https://opentelemetry.io/docs/specs/semconv/general/recording-errors/, https://opentelemetry.io/docs/specs/semconv/exceptions/exceptions-logs/

## Q22. When Emmett hands an error back to the user's code, should it log it?

Q4 covers errors Emmett rethrows internally and handles further up. This question covers errors that leave Emmett and reach the user's code (for example `handleCommand` or `appendToStream` rejecting), which Emmett never handles. Other tools log such errors once, at a level set by how expected they are: EF Core logs `SaveChangesFailed` at `Error` and `OptimisticConcurrencyException` at `Debug`, then throws both to the caller. Fastify's default error handler logs errors of status 500 and above at `error` and the rest at `info`. The OTel error-recording guidance says an exception propagated to the caller should be logged once.

**Oskar (verbatim):**

> I don't understand the issue and what do you mean by "WARN".

> How others are handling this?

> why is it replacing "no log"?

> yes, for now

**Answer:** Yes, for now. Emmett logs the error once, at the outermost Emmett operation, with a level set by the error type:

- `debug` for expected outcomes: `ConcurrencyError`, `ValidationError`, `IllegalStateError`, `NotFoundError`.
- `error` for anything else.

Nested Emmett steps only mark their spans failed. Q4 stays as is.

Sources: https://github.com/dotnet/efcore/blob/main/src/EFCore/Properties/CoreStrings.Designer.cs, https://github.com/fastify/fastify/blob/main/lib/log-controller.js, https://opentelemetry.io/docs/specs/semconv/general/recording-errors/

## Q23. Should the processor failure be logged inside the failing message's scope?

Finding: today a handler error leaves the message span and bubbles up to the batch `catch` at `processors.ts:1021`. A log there carries the batch scope's ids and doesn't know which message failed. The loop already supports stopping with an error: a `STOP` result with `error` set marks the previous message as the last one that succeeded.

**Oskar (verbatim):**

> ok, but I'm unsure why it shoudl also log the same event in case of batch

**Answer:** Yes. For `eachMessage`, the loop catches the handler error inside the message scope, marks the message span failed and writes one `error` log named `emmett.processor.message.exception` with the message "Processor stopped: message handling failed". Attributes:

- `emmett.processor.id`, `emmett.processor.instance_id`
- `emmett.event.type`, `messaging.message.id`, `emmett.stream.name`, `emmett.stream.position`
- `emmett.processor.checkpoint.before`
- `exception.type`, `exception.message`, `exception.stacktrace`
- trace, span, correlation and causation ids from the message scope (added automatically, Q19)

The loop then returns `STOP` with the error, so `:1021` doesn't log again.

## Q24. What does Emmett log when a custom `eachBatch` handler fails?

**Oskar (verbatim):**

> makes sense

**Answer:** Its own event, `emmett.processor.batch.exception`, at `error`, with the message "Processor stopped: batch handling failed", processor ids, batch size, first and last positions, `emmett.processor.checkpoint.before` and the `exception.*` attributes. It's a separate event because no single message failed and the fields differ. Both events share the "Processor stopped" prefix so a text search finds both. Logging nothing would let the processor stop silently.

## Q25. How does the CLI split command output from diagnostics? (confirms Q10)

**Oskar (verbatim):**

> ok

**Answer:** Accepted:

1. Command output (`config.ts:25` "Configuration file stored at", `config.ts:80` sample config, `schema.print()`) stays plain `console.log` to stdout, so it can be piped.
2. Diagnostics go through almanac's `consoleLogger` at the `info` minimum: failures (`plugins.ts:95`, `:104`, `cli.ts:31`, `:37-38`, `config.ts:27-28`, `:73`, `:83`) at `error`, not-found (`plugins.ts:52`, `:119`) at `warn`, "Loaded plugin/extension" (`plugins.ts:87`, `:122`) at `debug`.
3. The leftover `console.log('IMPORTING' + configPath)` in `plugins.ts:28` is removed.

Open check: diagnostics must not mix with piped stdout.

## Q26. How should the CLI keep diagnostics off stdout?

Finding: `consoleLogger` picks a `console` method per level, so `error`, `fatal` and `warn` go to stderr, `info` and `debug` go to stdout, and `trace` goes to stderr through `console.trace`, which also prints a stack trace on every call.

**Oskar (verbatim):**

> It should do as pino and/or watson

**Answer:** `consoleLogger` should behave like pino and winston. Verified:

- pino writes every level to stdout by default (`pino.destination(1)`), switches to stderr with `pino.destination(2)`, and doesn't split levels between streams unless you set up `pino.multistream`.
- winston's Console transport writes every level to stdout by default, and the `stderrLevels` option (default `[]`) moves chosen levels to stderr.

So `consoleLogger` writes every level to stdout by default, has an option to send output to stderr, and stops using `console.trace`. The CLI uses that option.

Sources: https://github.com/pinojs/pino/blob/main/docs/api.md, https://github.com/winstonjs/winston/blob/master/docs/transports.md

## Q27. Which option style should `consoleLogger` copy?

**Oskar (verbatim):**

> pino

**Answer:** pino style: one destination for every level, `consoleLogger({ destination: 'stderr' })`, defaulting to stdout. `consoleLogger` becomes a function (`consoleLogger()` for the default). Current users: `migrate.ts`, `eventStoreDBContainer.ts` and almanac's tests.

## Q28. What do we do with PG `writeToStream`'s `console.log`?

Finding: `writeToStream.ts:20` is called only by `StreamingCoordinator` in the same `node/streaming` folder. Nothing outside that folder imports either, apart from their unit tests, and `emmett-postgresql`'s `index.ts` doesn't export it. The code is unreachable for users.

**Oskar (verbatim):**

> ok

**Answer:** Remove the `console.log` and add no logging (overrides the Q6 `error` level for this site). Deleting the whole `node/streaming` folder goes in a separate issue.

## Q29. How should the web bindings' startup and framework logging change?

Findings: Fastify's `getApplication` defaults `serverOptions` to `{ logger: true }`, which turns on Fastify's pino request logging, while Fastify's own default is `logger: false`. Its type `{ logger: boolean }` blocks passing pino options or `loggerInstance`. Fastify's `startAPI` prints `console.log('Server listening on …')`, which duplicates Fastify's own listening line. `app.log.error` goes through Fastify's logger and stays. Express's `startAPI` always prints `console.info('server up listening')`. Hono has no logging.

**Oskar (verbatim):**

> ok, fine but it should also support (at least for express) the conventional registration as we have atm

**Answer:** Accepted:

1. Fastify: `serverOptions` takes the full Fastify server options (`logger: {...}`, `loggerInstance`), the default follows Fastify (`logger: false`), and the `console.log` in `startAPI` is removed.
2. Express: `startAPI` takes an optional `observability` and logs "Server listening" at `info` with the port. With nothing configured, it's silent.

Condition: at least Express must also support the conventional registration Emmett has today (the global default set by `setupObservability` or `EmmettInstrumentation`), not only an explicit option. Both changes are behaviour changes for the release notes.

Source: https://fastify.dev/docs/latest/Reference/Server/

## Q30. Should Express resolve observability through the global default, the same way the rest of Emmett does?

Finding: Express's `observability` option is only an on/off switch for `traceIdMiddleware` (`application.ts:65`). Its logger and tracer are never used, and the global default is ignored, which is why the PG sample adds its own `x-trace-id` middleware. `traceIdMiddleware` sets the header only when an OTel span is active. Others: OpenTelemetry libraries use the globally registered provider and fall back to no-op; NestJS delegates every `Logger` to the logger set once with `NestFactory.create({ logger })` or `app.useLogger()`; Fastify is explicit only (`logger` / `loggerInstance`).

Proposal: (1) `getApplication` and `startAPI` resolve observability as explicit, then global default, then noop, and the "Server listening" `info` log uses the result; (2) `traceIdMiddleware` is always registered.

**Oskar (verbatim):**

> To Q30, seems reasonable but how others are doing it?

> Point 2 is a small behaviour change: anyone running OTel will start getting the x-trace-id header without opting in - that may be controvercial, don't you think? We should at least make opt-out

**Answer:** (1) accepted. (2) An always-on `x-trace-id` header is controversial; at minimum it must be possible to opt out. Default still to be decided (Q31).

Sources: https://opentelemetry.io/docs/languages/js/instrumentation/, https://docs.nestjs.com/techniques/logger, https://fastify.dev/docs/latest/Reference/Server/

## Q31. Should the `x-trace-id` header be on by default, with an opt-out, or opt-in?

Finding (Hono): the Hono binding has no `observability` option, no logger, no global default lookup and no trace-id header. `startAPI` starts `@hono/node-server` silently, and the `onError` problem-details handler doesn't log. Hono also runs outside Node (Cloudflare Workers, Bun, Deno), where almanac's `globalThis` default still works but OTel's `NodeSDK` doesn't.

Proposal: telemetry plug and play through the global default; Hono gets parity with Express (`observability` option, "Server listening" `info` log); the `x-trace-id` header opt-in in both.

**Oskar (verbatim):**

> Ok, but I also want this setup to be plug and play., without requiring to opting in or out just to make telemetry work
>
> What about hono? You're ignoring it

> ok, but if it's opt in then that means that just enabling instrumentation is not enough, or am I wrong?

**Answer:** Telemetry must be plug and play: no opt-in or opt-out flag should be needed to make it work. Hono must be covered too. An opt-in header would mean enabling instrumentation isn't enough, so the header default moves to Q32.

## Q32. When should the `x-trace-id` header be on?

Options: (A) opt-in flag per binding; (B) on once Emmett observability is registered (`EmmettInstrumentation`, `setupObservability`, or the binding's `observability` option), with `disableTraceIdHeader: true` to opt out, so generic OTel users without Emmett's instrumentation are unaffected; (C) always on while an OTel span is active, with an opt-out.

**Oskar (verbatim):**

> yes, but we should also allow passing observability option and align across all

**Answer:** (B), plus every binding accepts an explicit `observability` option, and Express, Hono and Fastify all behave the same way.

## Q33. Where does Fastify's "Server listening" line come from?

Options: (A) from Emmett through the resolved observability, like Express and Hono, with a duplicate line when Fastify's own logger is also on; (B) from Fastify only.

**Oskar (verbatim):**

> if Fastify gives it we don't need to repeat it

**Answer:** (B). Fastify's own logger prints the listening line; Emmett doesn't repeat it. Everything else (the `observability` option, global default resolution, the `x-trace-id` header per Q32) stays aligned across the three bindings. E2E scenario 5 expects Fastify's startup line from Fastify's logger.

## Q34. What do we do with the test helpers' console output?

Findings: `workflow.testHelpers.ts:306` (simulated PMS API, used by three unit specs) prints "Releasing room …" on every call. `sqliteTestDatabase.ts:10`, duplicated in `emmett-sqlite` and `emmett-tests`, `console.log`s a failed temp-file deletion and carries on. All are used only by specs and not exported.

Proposal: (1) remove the PMS `console.log`; (2) remove the SQLite cleanup `console.log` and keep swallowing the error, or rethrow instead.

**Oskar (verbatim):**

> Keep seallowing for now for sqlite

**Answer:** (2) Remove the `console.log` and keep swallowing the SQLite cleanup error for now. (1) was not objected to: remove the PMS `console.log`.

## Q35. How do the processor lifecycle logs map?

Proposal: `:778` already active, `:786` "Starting processor", `:815` "Acquiring lock", `:831` "Executing onStart hook" drop to `debug`; the five "started / starting from / checkpoint read" variants (`:801`, `:852`, `:861`, `:872`, `:880`) become one `info` "Processor started" with `emmett.processor.id`, `emmett.processor.instance_id`, `emmett.processor.type`, `emmett.processor.start_from` (`BEGINNING`, `END`, `checkpoint`, `explicit`) and `emmett.processor.checkpoint`; a clean close logs `info` "Processor stopped".

**Oskar (verbatim):**

> ok, but also when thinking about log ensure that we're also having those information in traces and they're wrapped in scope/traces

**Answer:** Accepted, with a condition: the same information must be in the traces too, and the logs must be written inside scopes/spans.

## Q36. Should the processor lifecycle get its own spans?

Findings: processor `start`, `init` and `close` log through `options.observabilityScope ?? noopScope` (`processors.ts:754`, `:772`, `:899`). The default consumer scope passes `{}` (`consumers.ts:217-218`) and the PG consumer's context has no `observabilityScope` (`postgreSQLEventStoreConsumer.ts:174-180`), so lifecycle and Q17 lock logs go to `noopScope` even when observability is configured. The collector only creates `processor.handle` and `processor.message.{type}` spans.

Proposal: a `processor.start` span from the processor's own collector (explicit, then global default, then noop; no `noopScope` fallback), with child spans `processor.lock.acquire`, `processor.hook.on_start` and `processor.checkpoint.read`; the span carries the "Processor started" attributes and the log is written inside it. A `processor.close` span with lock release as a child, "Processor stopped" logged inside it. When the caller passes a scope, these spans become its children. The consumer's start/stop gets the same treatment.

**Oskar (verbatim):**

> Yes, makes sense. To give more context, logs for me are just fallback for folks that are used to them, best if people could get all information from tracing so if we have logs disable (which is the default) then for folks that enabled tracing they should get all.
>
> So kinda following the Honeycomb recommendations.
>
> Still, I'm not opinionated an I know that many people prefer logs, so that's why I added them. For that we'd probably need even more, but for now I'd like to start with wrapping up what's here already annd filling obvious gaps.

**Answer:** Accepted. Guiding principle: traces are the primary signal and logs are a fallback, off by default. Anyone with only tracing enabled must get all the information. Scope for now: wrap up the existing logs and fill obvious gaps, not add more logging.

## Q37. Where does exception detail go when only tracing is on?

Findings: under Q21 a failed span gets Error status, `error.type` and a status description; `exception.*` go once to a log. With logs off by default, trace-only users get no stack trace. Almanac already has `attributeTarget` (`'mainSpan' | 'currentSpan' | 'both'`, default `both`, `attributes.ts:27`, `scope.ts:133-140`), used by every Emmett collector and undocumented; `mainSpan` gives the wide-event style.

Proposal: set `exception.*` via `scope.setAttributes` in the scope where Emmett handles the error, so it follows `attributeTarget`, and put the same attributes on the single exception log.

**Oskar (verbatim):**

> We have option to select wide event style of recording, right?

> If that follows best practices then yes

**Answer:** Conditional yes. Checked: OTel "Recording errors" asks for Error status, `error.type`, the status description set to the exception message, and the exception as a log record; it defines no `exception.*` span attributes. The span events deprecation post says to prefer the Logs API for exceptions, and that the SDK will offer a way to turn log-based events back into span events. Honeycomb's exceptions post describes span events or logs, not span attributes. So the condition isn't met, and `exception.*` stays off span attributes. Follow-up in Q38.

## Q38. Do we rely on the OTel logs path for the stack trace, with no extra option?

Findings: `otel()` defaults `logging` to `otelLogger()` (`otel.ts:28-32`), so with almanac's OTel setup the single exception log record goes through the OTel Logs API, linked to the span. Logs are off only when no observability is configured or `logging: DISABLED` is passed.

Proposal: spans keep Error status, `error.type` and the exception message as status description (Q21); the stack trace lives only in the exception log record; no extra option. The docs mention the SDK's log-to-span-event bridge only once the JS SDK ships it (the deprecation post says it "will" offer it).

**Oskar (verbatim):**

> I'm not sure, what follows the least surprise and best practices in your opinion?

> ok

**Answer:** Follow OTel semconv as it stands. Emmett behaves like any other OTel instrumentation library and adds no custom `exception.*` span attributes and no extra option. The docs explain that the stack trace lives in the exception log record.

## Q39. Should the `onAfterCommit` hook run in its own child span?

Findings: checkpoint store, batch failure and start position failures only rethrow (Q4, Q14), so the failing `processor.message`/`processor.handle` span carries them. "Consumer stopped" and lock logs get spans from Q36. Under Q15 a failed hook leaves the append span OK and sets `emmett.after_commit.status = 'failure'`; trace-only users don't see `error.type` or the message.

Proposal: run the hook in a child span of the append with stream name and message count attributes. On failure only the child span gets Error status, `error.type` and the message as status description; the append span stays OK. The Q15 `error` log is written inside the child span. Drop `emmett.after_commit.status`. Only in-memory and MongoDB call `onAfterCommit`.

**Oskar (verbatim):**

> probably we should have the hooks.after_comit or so (or based from other conventional patterns)

**Answer:** Yes to the child span; its name is settled in Q40.

## Q40. How are the spans named?

Findings: Emmett today uses `component.operation` in camelCase (`eventStore.appendToStream`, `eventStore.inlineProjection`, `command.handle`, `workflow.decide`, `consumer.poll`, `processor.handle`, `processor.message.{type}`). OTel: span names identify a class of operations and stay low-cardinality (Trace API: `get_account` with `account_id=42` as an attribute); where a semantic convention exists the name is `{operation} {target}` (messaging `process shop.orders`, DB `SELECT wuser_table`); attributes are lowercase, dot-namespaced snake_case. Real tools: KafkaJS instrumentation follows messaging semconv (`send ${topic}`, `process ${topic}`); where there is no convention, names are library-prefixed: OTel `pg` instrumentation `pg.query:SELECT {db}`, `pg.connect`, `pg-pool.connect`; Marten `marten.connection`, `marten.{projection}.all.execution`, `marten.daemon.highwatermark`; Wolverine `wolverine.starting.listener`, `wolverine.envelope.requeued`.

Proposal: operations without a semantic convention use library-prefixed, dotted, lowercase snake_case names; ids and positions go in `emmett.*` attributes, never in names:

| Step               | Span name                                  |
| ------------------ | ------------------------------------------ |
| onAfterCommit hook | `emmett.event_store.hooks.on_after_commit` |
| processor start    | `emmett.processor.start`                   |
| lock acquisition   | `emmett.processor.acquire_lock`            |
| onStart hook       | `emmett.processor.hooks.on_start`          |
| checkpoint read    | `emmett.processor.read_checkpoint`         |
| processor close    | `emmett.processor.close`                   |
| lock release       | `emmett.processor.release_lock`            |

**Oskar (verbatim):**

> I mean, the naming should be aligned with the best practices, not how it is.

> Are reall tools using such span names?

> Makes sense, but we should align all, but first, doing what's the goal

**Answer:** Accepted. The new spans use the names above. All existing spans get renamed to the same scheme too (message processing may adopt the messaging convention, `process {destination}`), but as a later phase, after the logging work, which is the goal of this spec.

## Q41. How should `taskProcessor`'s two error paths reach traces?

Findings: a task's own error is caught in `taskWithContext` and rejects the caller's promise, so the caller's span records it. `taskProcessor.ts:229` (unhandled rejection from `executeItem`) and `:233` (`processQueue` throwing) fire only when the processor's own bookkeeping fails, i.e. an internal bug. Today they'd be the only logs outside a span.

Options: (A) a span per task (`task_processor.execute` with `taskGroupId`), new instrumentation on a hot path (`InProcessLock` and the guards run through it on every command); (B) no span per task; when `:229` or `:233` fires, open a short `task_processor.process_queue` span, mark it `Error` with `error.type` and the message, and write the `error` log inside it.

**Oskar (verbatim):**

> Could we start to wrap it up, we can have some follow up steps.

> I mean, we need to fill gaps, as said.

> I don't want to skip important parts, but get the focus on the goal

> I don't want to skip important parts, but get the focus on the goal

**Answer:** Not answered directly; Oskar asked to close gaps while staying on the goal. Taken as (B), the minimal option that closes the gap: trace-only users see the bug, and the normal path gets no new instrumentation. A span per task stays a follow-up.

## Q42. For `taskProcessor`, do you confirm option (B)?

**Oskar (verbatim):**

> Either we have all spans correctly, or none and task to add it later.

**Answer:** No half-measure: (B) is rejected. TaskProcessor either gets complete, correct spans, or none now and a follow-up task to add them. Which of the two is Q43.

## Q43. Should `taskProcessor` get no spans in this spec, with a follow-up task to add them?

**Oskar (verbatim):**

> Yes

**Answer:** Yes. The `:229` and `:233` paths move to almanac's logger (Q16) but get no span in this spec. A follow-up task adds complete spans: one per task with queue wait and run time, named under almanac rather than `emmett.`, with a cost check on every command and lock. This supersedes the (B) choice recorded in Q41.

## Q44. What should happen to the `x-trace-id` header when the registered observability isn't OTel?

Finding: bindings read the trace id from the active OTel span and don't open a span per request, so with pino or console tracing there's no header. Options: (A) accept it and document that the header works with OTel only; (B) each binding opens a request scope, which is new per-request instrumentation and, per Q42, would need complete spans.

**Oskar (verbatim):**

> let's start with A

> but we should also enable that (I think that we agreed to opt in, right? )

> I didn't set request scope, but enabling this header, we already discussed that

**Answer:** (A). The header works with OTel only, and the docs say so. "Enable that" refers to the header itself, which Q32 already settles: on once Emmett observability is registered, `disableTraceIdHeader: true` to opt out (not opt-in). No request-scope option.

## Q45. Should the breaking changes ship as direct breaks, listed in the release notes, with no deprecation aliases?

Breaking changes: `logger({ event })` → `logger({ log })`; `consoleLogger` becomes a function; `TaskProcessorOptions.logger` replaced by `observability`; Fastify's logger default `true` → `false`; `x-trace-id` header on once Emmett observability is registered.

**Oskar (verbatim):**

> Yes, direct breaks, it wasn't officially released yet

**Answer:** Direct breaks, no deprecation aliases, listed in the release notes. The logging API hasn't been officially released yet.

## Q46. What should `plugins.ts:73` ("No extensions specified in config <path>.") become?

It prints with `console.log` to stdout when the config lists no plugins, then continues with an empty list. The CLI table from Q25 didn't cover it. Options: `debug` on stderr (like `:87`, `:122`), `warn` on stderr (like `:52`), or remove it (like `:28`).

**Oskar (verbatim):**

> Remove it

**Answer:** Removed, like the `IMPORTING` leftover at `plugins.ts:28`.
