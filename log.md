# Explicit logging in Emmett packages

Inventory of every place outside `almanac` that writes logs directly, through `console.*` or a logger other than the almanac observability pipeline. Test files (`*.spec.ts`) are excluded. Line numbers are from commit `f5fee4ff`.

## What almanac already gives us

- `Logger` is a plain function `(event: LogEvent) => void`, built with `logger({ event, minLevel })`. `noopLogger` is the default.
- `LogEvent.error(err, 'msg')`, `LogEvent.info('msg')`, `LogEvent.warn({ eventName, ...attrs }, 'msg')` build structured events.
- `ObservabilityScope.log(event)` sends the event to `observability.logger` when one is set, enriched with the active trace and span ids. Without a logger, it attaches the event to the span.
- Providers: `consoleLogger` (`@event-driven-io/almanac/console`), `otelLogger` (`@event-driven-io/almanac/otel`), pino tracer (`@event-driven-io/almanac/pino`).

## What Emmett already does

These places already log the almanac way, through the scope:

- [processors.ts:1021](src/packages/emmett/src/processors/processors.ts#L1021): `scope.log(error({ err }, 'Error during message processing ... Stopping the processor.'))`
- [processors.ts:778-880](src/packages/emmett/src/processors/processors.ts#L778): processor start lifecycle, about ten `log(info(...))` calls through `observabilityScope.log`: already active, starting, started with checkpoint, acquiring lock, executing `onStart`, starting from position.
- [commandHandlerCollector.ts:141](src/packages/emmett/src/commandHandling/observability/commandHandlerCollector.ts#L141): `scope.log(LogEvent.error(err))`
- [consumerCollector.ts:133](src/packages/emmett/src/consumers/observability/consumerCollector.ts#L133): `child.log(LogEvent.error(error))` on every failed `consumer.deliver`, then rethrows

All five collectors resolve a `logger` (`observability?.logger ?? noopLogger`), but none of them call it directly. It reaches the output only through `scope.log`:

- [eventStoreCollector.ts:56](src/packages/emmett/src/eventStore/observability/eventStoreCollector.ts#L56)
- [commandHandlerCollector.ts:60](src/packages/emmett/src/commandHandling/observability/commandHandlerCollector.ts#L60)
- [processorCollector.ts:64](src/packages/emmett/src/processors/observability/processorCollector.ts#L64)
- [consumerCollector.ts:57](src/packages/emmett/src/consumers/observability/consumerCollector.ts#L57)
- [workflowCollector.ts:59](src/packages/emmett/src/workflows/observability/workflowCollector.ts#L59)

## A. Runtime library code (candidates for almanac)

These run inside a user's application. Today they write to stdout no matter what observability the user configured, and they cannot be silenced.

### emmett core

| Location                                                                                                                 | Call                | What it reports                                                                     | Observability in reach?                                        |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| [consumers.ts:273](src/packages/emmett/src/consumers/consumers.ts#L273)                                                  | `console.log`       | Processor init failed, stopping it (+ error)                                        | Consumer has `options.observability`, runs inside `scope(...)` |
| [consumers.ts:279](src/packages/emmett/src/consumers/consumers.ts#L279)                                                  | `console.log`       | Cleanup after failed init failed (+ error)                                          | same                                                           |
| [consumers.ts:284](src/packages/emmett/src/consumers/consumers.ts#L284)                                                  | `console.log`       | Processor stopped after failed init                                                 | same                                                           |
| [consumers.ts:303](src/packages/emmett/src/consumers/consumers.ts#L303)                                                  | `console.log`       | Error during consumer stop (+ error)                                                | options only, no scope                                         |
| [consumers.ts:347](src/packages/emmett/src/consumers/consumers.ts#L347)                                                  | `console.log`       | `start()` called on a running consumer                                              | options only, no scope                                         |
| [consumers.ts:396](src/packages/emmett/src/consumers/consumers.ts#L396)                                                  | `console.log`       | Batch processing failed for a processor (+ error), then rethrows                    | inside `scope(...)`                                            |
| [processorStartPositions.ts:137](src/packages/emmett/src/processors/processorStartPositions.ts#L137)                     | `console.log`       | Start position retrieval failed (+ error), then rethrows                            | inside `inScope(...)`                                          |
| [afterEventStoreCommitHandler.ts:74](src/packages/emmett/src/eventStore/afterCommit/afterEventStoreCommitHandler.ts#L74) | `console.error`     | `onAfterCommit` hook threw; error is swallowed. Has `// TODO: enhance with tracing` | No, only hook options and handler context                      |
| [taskProcessor.ts:53](src/packages/emmett/src/taskProcessing/taskProcessor.ts#L53)                                       | `logger ?? console` | Own `TaskProcessorLogger = { error(...args) }` type, defaults to `console`          | No                                                             |
| [taskProcessor.ts:229](src/packages/emmett/src/taskProcessing/taskProcessor.ts#L229)                                     | `logger.error`      | Unhandled task rejection                                                            | same                                                           |
| [taskProcessor.ts:233](src/packages/emmett/src/taskProcessing/taskProcessor.ts#L233)                                     | `logger.error`      | Error in the processing loop, then rethrows                                         | same                                                           |
| [executionGuards.ts:22, 56, 98, 237](src/packages/emmett/src/taskProcessing/executionGuards.ts#L22)                      | option pass-through | Forward `TaskProcessorLogger` into `taskProcessor`                                  | No                                                             |

### emmett-postgresql

| Location                                                                                                                          | Call                 | What it reports                             | Note                                         |
| --------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------- | -------------------------------------------- |
| [postgreSQLProcessorLock.ts:54](src/packages/emmett-postgresql/src/eventStore/projections/locks/postgreSQLProcessorLock.ts#L54)   | `console.log`        | Lock already held by this instance, reusing | debug-level noise                            |
| [postgreSQLProcessorLock.ts:71](src/packages/emmett-postgresql/src/eventStore/projections/locks/postgreSQLProcessorLock.ts#L71)   | `console.log`        | Lock not held, skipping release             | debug-level noise                            |
| [tryAcquireProcessorLock.ts:67](src/packages/emmett-postgresql/src/eventStore/projections/locks/tryAcquireProcessorLock.ts#L67)   | `console.log`        | Result of every lock acquisition attempt    | Fires on every poll, loud in production      |
| [tryAcquireProcessorLock.ts:108](src/packages/emmett-postgresql/src/eventStore/projections/locks/tryAcquireProcessorLock.ts#L108) | `console.log`        | Result of every lock release                | same                                         |
| [storeProcessorCheckpoint.ts:200](src/packages/emmett-postgresql/src/eventStore/schema/storeProcessorCheckpoint.ts#L200)          | `console.log(error)` | Checkpoint store failed, then rethrows      | Error is logged here and again by the caller |
| [writeToStream.ts:20](src/packages/emmett-postgresql/src/node/streaming/writers/writeToStream.ts#L20)                             | `console.log(error)` | Write to web stream failed; error swallowed |                                              |

### emmett-sqlite

| Location                                                                                                             | Call                 | What it reports                        | Note                         |
| -------------------------------------------------------------------------------------------------------------------- | -------------------- | -------------------------------------- | ---------------------------- |
| [storeProcessorCheckpoint.ts:138](src/packages/emmett-sqlite/src/eventStore/schema/storeProcessorCheckpoint.ts#L138) | `console.log(error)` | Checkpoint store failed, then rethrows | Mirror of the PostgreSQL one |

### emmett-esdb, emmett-mongodb, emmett-honojs

No explicit logging in runtime code.

## B. Web framework bindings

| Location                                                                                       | Call                              | What it reports                                   |
| ---------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------- |
| [emmett-fastify/src/index.ts:25, 35](src/packages/emmett-fastify/src/index.ts#L25)             | `serverOptions: { logger: true }` | Enables Fastify's built-in pino logger by default |
| [emmett-fastify/src/index.ts:80](src/packages/emmett-fastify/src/index.ts#L80)                 | `console.log`                     | Server listening on address:port                  |
| [emmett-fastify/src/index.ts:82](src/packages/emmett-fastify/src/index.ts#L82)                 | `app.log.error`                   | Server failed to start, then `process.exit(1)`    |
| [emmett-expressjs/src/application.ts:91](src/packages/emmett-expressjs/src/application.ts#L91) | `console.info`                    | `server up listening`                             |

## C. Command-line tooling

User-facing terminal output. Here stdout is the product, not a side effect.

| Location                                                                                                                       | Call                    | What it reports                                                   |
| ------------------------------------------------------------------------------------------------------------------------------ | ----------------------- | ----------------------------------------------------------------- |
| [cli.ts:31](src/packages/emmett/src/cli.ts#L31)                                                                                | `console.error`         | Failed to load config                                             |
| [cli.ts:37-38](src/packages/emmett/src/cli.ts#L37)                                                                             | `console.error`         | CLI initialization failed                                         |
| [commandLine/config.ts:25](src/packages/emmett/src/commandLine/config.ts#L25)                                                  | `console.log`           | Config file stored                                                |
| [commandLine/config.ts:27-28](src/packages/emmett/src/commandLine/config.ts#L27)                                               | `console.error`         | Couldn't store config file                                        |
| [commandLine/config.ts:73, 83](src/packages/emmett/src/commandLine/config.ts#L73)                                              | `console.error`         | Invalid config command usage                                      |
| [commandLine/config.ts:80](src/packages/emmett/src/commandLine/config.ts#L80)                                                  | `console.log`           | Prints sample config                                              |
| [commandLine/plugins.ts:28](src/packages/emmett/src/commandLine/plugins.ts#L28)                                                | `console.log`           | `'IMPORTING' + configPath`, looks like a leftover debug line      |
| [commandLine/plugins.ts:52](src/packages/emmett/src/commandLine/plugins.ts#L52)                                                | `console.warn`          | Config file not found                                             |
| [commandLine/plugins.ts:73](src/packages/emmett/src/commandLine/plugins.ts#L73)                                                | `console.log`           | No extensions in config                                           |
| [commandLine/plugins.ts:87](src/packages/emmett/src/commandLine/plugins.ts#L87)                                                | `console.info`          | Loaded plugin                                                     |
| [commandLine/plugins.ts:95](src/packages/emmett/src/commandLine/plugins.ts#L95)                                                | `console.error`         | Failed to load extension                                          |
| [commandLine/plugins.ts:104](src/packages/emmett/src/commandLine/plugins.ts#L104)                                              | `console.error`         | Failed to load config                                             |
| [commandLine/plugins.ts:119](src/packages/emmett/src/commandLine/plugins.ts#L119)                                              | `console.warn`          | No `registerCommands` in plugin                                   |
| [commandLine/plugins.ts:122](src/packages/emmett/src/commandLine/plugins.ts#L122)                                              | `console.log`           | Loaded extension                                                  |
| [emmett-postgresql/src/commandLine/migrate.ts:46, 54, 101, 109](src/packages/emmett-postgresql/src/commandLine/migrate.ts#L46) | almanac `consoleLogger` | Already uses almanac. Commands are stubs ("Nothing has happened") |
| [postgreSQLEventStore.ts:494](src/packages/emmett-postgresql/src/eventStore/postgreSQLEventStore.ts#L494)                      | `console.log`           | `schema.print()` prints schema description on request             |
| [SQLiteEventStore.ts:494](src/packages/emmett-sqlite/src/eventStore/SQLiteEventStore.ts#L494)                                  | `console.log`           | same for SQLite                                                   |

## D. Test support shipped in packages

| Location                                                                                                                                      | Call                    | What it reports                            |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------ |
| [emmett-sqlite/.../sqliteTestDatabase.ts:10](src/packages/emmett-sqlite/src/storage/sqlite3/testing/sqliteTestDatabase.ts#L10)                | `console.log(error)`    | Temp DB file cleanup failed                |
| [emmett-tests/.../sqliteTestDatabase.ts:10](src/packages/emmett-tests/src/testing/sqliteTestDatabase.ts#L10)                                  | `console.log(error)`    | same, duplicate helper                     |
| [workflow.testHelpers.ts:306](src/packages/emmett/src/workflows/workflow.testHelpers.ts#L306)                                                 | `console.log`           | Fake PMS API call in a test workflow       |
| [emmett-testcontainers/.../eventStoreDBContainer.ts:111-113](src/packages/emmett-testcontainers/src/eventStore/eventStoreDBContainer.ts#L111) | almanac `consoleLogger` | Container log stream. Already uses almanac |

## E. Benchmarks and examples

Standalone scripts that print results. Likely fine as they are.

- [emmett-postgresql/src/benchmarks/index.ts](src/packages/emmett-postgresql/src/benchmarks/index.ts): lines 20, 151-154
- [emmett-postgresql/src/benchmarks/projectionRebuild.ts](src/packages/emmett-postgresql/src/benchmarks/projectionRebuild.ts): lines 25, 173, 176, 225-231
- [emmett-postgresql/src/benchmarks/ox.ts](src/packages/emmett-postgresql/src/benchmarks/ox.ts): lines 28, 30, 35, 38
- [emmett-sqlite/src/storage/sqlite3/benchmarks/index.ts](src/packages/emmett-sqlite/src/storage/sqlite3/benchmarks/index.ts): lines 139-142
- [emmett-mongodb/src/eventStore/example.ts:42](src/packages/emmett-mongodb/src/eventStore/example.ts#L42)

## F. Commented-out logging

- [notifyAboutNoActiveReaders.ts:32](src/packages/emmett-postgresql/src/node/streaming/transformations/notifyAboutNoActiveReaders.ts#L32)
- [migrate.ts:64, 124-125](src/packages/emmett-postgresql/src/commandLine/migrate.ts#L64)

## G. Samples

`samples/` holds about 110 `console.*` calls. Almost all of them live in the observability stack tooling (`testing/stack/*`, Docker Compose, signal handling) or in generated Cloudflare `worker-configuration.d.ts` files. Application code in samples logs only on startup (for example [expressjs-with-sqlite/src/index.ts](samples/webApi/expressjs-with-sqlite/src/index.ts)).

## Summary

- 14 runtime call sites (group A) write to the console regardless of the user's observability setup. These are the core of the work.
- `taskProcessor` has its own logger type that competes with almanac's `Logger`.
- The PostgreSQL lock logs on every acquisition attempt and release, which is noisy in production.
- Checkpoint stores log and rethrow, so the same error shows up twice.
- Collectors resolve a logger that nothing calls directly; `scope.log` is the only path in use.
