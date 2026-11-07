# Type surface research: findings

The full log, with `tsc` output at file:line for every probe, is in `progress.md`. The probe files are in `examples/`. This summary was saved by the main session, because the subagent could not write report files.

## What was applied

All agreed type changes were applied together to a scratch copy of the repo:

1. The message types from the `unversioned-schema-version-typing` PoC (candidate Dreq).
2. The helper version argument.
3. `MessageSchemaVersionOf<T>`.
4. `RecordedMessage.schemaVersion: number`, `schemaVersion` removed from `CommonRecordedMessageMetadata`, and `DefaultMessageSchemaVersion = 1`.
5. Upcast and downcast copying `schemaVersion` from the result.

The patches are `1-agreed-types.diff` (items 1 to 5), `2-mechanical-fixes.diff` (23 package files and one sample file) and `all-changes.diff`. `git apply --check` passes for each against the current repo, checked by the main session as well. They are not formatted with Prettier.

## Checks run

- Baseline (`tsc -p tsconfig.eslint.json --noEmit`): the 3 known errors in `docs/.vitepress/*.mts`.
- First run with the changes: 88 new errors (emmett 63, emmett-postgresql 14, emmett-sqlite 7, emmett-esdb 4). 12 are in library code and 76 in tests. The docs snippets, express, hono, fastify, mongodb, testcontainers and emmett-tests had none.
- After the mechanical fixes: only the 3 baseline errors.
- `tsc -b tsconfig.json tsconfig.cloudflare.json` (what `npm run build:ts` runs): exit 0. The emitted `.d.ts` keeps `SchemaVersion extends number = string extends EventType ? number : 1` word for word.
- `tsdown` in `packages/emmett`: exit 0, attw reports no problems, and the probes give the same results against the bundled `.d.ts`.
- Samples: compared as a difference between copies because of a noisy baseline. Only `cloudflare/durable-objects` gained one error (`projections.unit.spec.ts(67,5)`, a recorded event without `schemaVersion`), fixed mechanically.
- No tests were run. This was a type-only check.

## Mechanical errors

- **A recorded message is built without `schemaVersion`.** 74 errors plus 1 in samples. These are test fixtures and the builders in `inMemoryEventStore.ts:223`, `inMemoryProjectionSpec.ts:97`, `postgresProjectionSpec.ts:147`, `sqliteProjectionSpec.ts:157` and both drivers' `readMessagesBatch.ts`.
- **Code reads or writes `metadata.schemaVersion`.** 14 errors in PostgreSQL and SQLite: `appendToStream.ts`, `readStream.ts` and `readMessagesBatch.ts`, plus tests. The scratch fixes only make them compile. The real behaviour comes from plan steps 7, 9 and 16.
- **Hidden by casts, so tsc does not report them.** Each store's plan step must set `schemaVersion` at:
  - `emmett-sqlite/.../appendToStream.ts:95`
  - `emmett-postgresql/.../appendToStream.ts:225`
  - `mongoDBEventStore.ts:440`
  - `mongoDBMessageSource.ts:106`
  - `eventstoreDBEventStore.ts:390` (`mapFromESDBEvent`)
  - `inMemoryEventStore.ts:128`
  - the PostgreSQL and SQLite `readStream.ts`

## Probe results

- **a. Generic helper calls.** `event<E>(type, data)` inside generic code already fails today with the same errors (TS2345). No repo code does this. No regression.
- **b. Spreads and mapped types.** These keep or narrow `schemaVersion`: spreads, `Readonly`, `Partial`, `Required`, `Extract`, the `...Of` extractors, `CombineMetadata`, `CombinedReadEventMetadata` and `ReadEvent<V1 | V2>`. `Omit` and `Pick` on `V1 | V2` lose narrowing, as for any union. No repo code uses them on message types.
- **c. Recorded messages.** `RecordedMessage<V2>['schemaVersion']` is `2`, `<V1>` is `1`, `<Event>` is `number`, and `<V1 | V2>` is `1 | 2`. Narrowing works in both branches.
- **d. Upcast and downcast.** 0 errors, with no casts, across the core helpers, `CommandHandler`, `readStream`, `appendToStream`, `aggregateStream`, reactors, workflows and `JSONCodec`. An upcaster or `decide` that returns V2 without its version does not compile.
- **e. Testing APIs.** Values of a versioned type in given/when/then must carry `schemaVersion`. No existing test uses versioned types.
- **f. `AnyEvent` and `AnyMessage` handlers.** 0 errors for projections, projectors, reactors and `CanHandle`.
- **i. Explicit version 1 and generic names.** `Event<..., 1>` is the same type as no version. `Event<string, D>` keeps `number`.

## Needs a decision

1. **Versioned command without declared metadata, and `{ now }`.** With the agreed tuple `[type, data, version]`, `{ now }` cannot be passed together with a version. Option B, `[t, d, v] | [t, d, metadata | undefined, v]`, compiles and keeps the version last. Option C, `[t, d, v, metadata?]`, compiles but the version is not last.
2. **`CreateEventType` and `CreateCommandType`** (unused in the repo). A `switch` over `CreateEventType<...> | V2` fails with TS2339, because they have no `schemaVersion` key. Options: leave them, or give them the same fourth parameter and property (0 errors).
3. **Two new exported type names**, `SchemaVersionProperty` and `WithSchemaVersionArgument`, reach the package index through `export *`. Options: keep them exported, or inline them (not tested).
4. **Downcast that returns only `data`.** A `(e: V2) => V1` downcaster may leave out `schemaVersion`. Spec 9.2 keeps `2` at runtime, but the type says `1`.
5. **Union as the helper's type argument.** `event<V1 | V2>('ProductItemAdded', { productItem })` compiles without a version, because the V1 part makes it optional.
6. **`MessageSchemaVersionOf<T>`** is defined as `NonNullable<T['schemaVersion']>`: `2`, `1`, `number`, and `any` for `AnyEvent`.
7. **`AnyRecordedMessage`** is still `Message<any, any, any>`, so its `schemaVersion` is optional. The spec does not mention it.
