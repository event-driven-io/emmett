# Plan: remaining memory and hang fixes

Branch: `processors_memory_leak`. All paths are in `src/packages/emmett/src` unless a step says otherwise. Do not commit or stage.

Every step is test first: write the test, run it, and confirm the result. If it fails for the expected reason, fix the code and run it again. If a test that should prove "no leak" passes on the first run, keep it as a regression test and change no code.

## 1. Tests and fixes (parallel, one subagent per step)

Each step changes different files, so all five run at the same time.

### 1a. Scheduler `clear()` while a task runs

Files: `taskProcessing/taskScheduler.ts`, `taskProcessing/taskScheduler.unit.spec.ts`.

Problem: `clear()` deletes all groups, but running tasks stay in `activeEntriesByItem`. A task enqueued after `clear()` in the same group gets a new group that is not active, so it runs at the same time as the running task.

- Test "keeps tasks of a group one at a time when the queue is cleared while a task of that group runs": enqueue A in group `g` and take it. Call `clear()`. Enqueue B in `g`: `takeNext()` returns `null`. Complete A: `takeNext()` returns B.
- Expected failure: `takeNext()` returns B while A runs.
- Fix: `clear()` keeps each group that has a running task, with an empty queue (`entries = []`, `headIndex = 0`, `active` stays `true`), and deletes the other groups. `activeEntriesByItem` does not change, because `complete()` uses it to release the group.
- Test "forgets the group after the running task completes when the queue was cleared": use the heap check from the existing GC scheduler test.

### 1b. `raceWithTimeout` in `processors/processors.ts`

File: `processors/processors.unit.spec.ts`.

- Test "releases timed out waits while the processor keeps running": start a processor that does not get to the requested checkpoint. Call `whenProcessed` with a short timeout 200 times. Each call rejects with the timeout error. Use `testing/garbageCollection.testHelpers.ts` to show that the timed out waits are collected while the processor is still open. Close the processor with `onTestFinished`.

### 1c. `waitForProcessingOrDeadline` in `taskProcessing/taskProcessor.ts`

File: `taskProcessing/taskProcessor.unit.spec.ts`.

- Test "stop with a close deadline returns and releases the task that did not finish": enqueue a task that never settles and ignores abort. `stop({ closeDeadline: 20 })` resolves after the deadline. A WeakRef on the task message shows that the processor does not keep it after `stop()` returns.

### 1d. `chunk()` with a deadline

File: `streaming/fusionStreams.unit.spec.ts`.

The bug report says that a cancelled deadline never settles and keeps the messages. The consumer always uses a deadline, but the current GC test does not.

- Test "releases delivered values while a stream with a deadline is still open": the same as the existing GC test, but with `chunk({ size: 100, deadlineInMs })`. Use a source that sometimes waits longer than the deadline, so some chunks are flushed by the deadline and some by size.

### 1e. `boundedMessageQueue` after an abort

File: `consumers/messageSources/subscriptionMessageSource.unit.spec.ts`.

The queue belongs to one subscription. After its reader aborts, the queue is complete: new pushes are dropped and a new `iterate()` ends at once. No driver uses the queue yet.

- Test "ends a new read at once when an earlier read was aborted": abort a reader, start a second `iterate()`, and check that it ends with no items and does not hang. This test locks the current behavior. No code change.

## 2. Verification (sequential, after step 1)

One subagent, from `src`:

1. `npm run build:ts`
2. `npm run agent:check`
3. `npm run test:unit`

Fix every failure and every warning in the output.

## 3. Audit of the driver packages (after step 2)

Four read-only subagents in parallel, one per package:

- `src/packages/emmett-postgresql`
- `src/packages/emmett-sqlite`
- `src/packages/emmett-mongodb`
- `src/packages/emmett-esdb`

Each subagent looks at consumers, message pullers, processors and subscriptions for:

- long-lived promises that get a new reaction per message (`Promise.race`, `.then` in a loop)
- event listeners and abort listeners that are added and not removed
- Maps, Sets and arrays that get entries per message, stream or group and never delete them
- waits that hang when the consumer closes or aborts
- async generators whose `return()` is awaited while a `next()` is pending

Each finding names the file and line, the steps that trigger it, and what stays in memory or what hangs.

I give the findings to Oskar. For each finding that Oskar accepts: a behavior test first, then a GC test if it is a memory issue, then the fix, then step 2 again.

## 4. Final handoff

Run `npm test` from `src` (unit, integration and end-to-end) and report the results.

## Decisions

- `splice` compaction in `taskScheduler.ts` stays as it is.
- Processors log nothing unless the app sets a logger. No change.
- The default lock policy is out of scope for this branch.
