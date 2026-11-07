# Type surface research: progress

Scratch: `/tmp/claude-1000/-home-oskar-repos-emmett/445d50e8-12b7-4065-8e97-b4c5a961da8a/scratchpad/type-surface/`. `orig/` is a fresh copy of `src` (no node_modules, dist, lib, tsbuildinfo; node_modules symlinked). `work/` gets the changes.

## Log

- Baseline `tsc -p tsconfig.eslint.json --noEmit` on `orig/`: 3 errors, all in `docs/.vitepress/*.mts` (config.mts:11, theme/index.mts:3, theme/index.mts:4). Same as the previous PoC.
- Baseline `tsc -b tsconfig.json tsconfig.cloudflare.json` (what `npm run build:ts` runs) on a copy of `orig/`: exit 0, 0 errors. Downstream packages are checked against the emitted `lib/*.d.ts` of referenced projects in build mode, so this also tests `.d.ts` emit.
- Applied 1 to 5 to `work/` (Dreq.diff, helpers with a version as last argument, `MessageSchemaVersionOf`, `RecordedMessage.schemaVersion: number`, `schemaVersion` removed from `CommonRecordedMessageMetadata`, `DefaultMessageSchemaVersion = 1`, upcast/downcast copy `schemaVersion`). First `tsc -p tsconfig.eslint.json`: 88 errors beyond baseline (emmett 63, emmett-postgresql 14, emmett-sqlite 7, emmett-esdb 4). 12 in non-test code, 76 in tests.
- Mechanical fixes applied (top-level `schemaVersion` in recorded builders, drivers read `e.schemaVersion`, fixtures get `schemaVersion: 1`, metadata tests moved to top-level). Result: 0 errors beyond baseline.
- `tsc -b tsconfig.json tsconfig.cloudflare.json` on the changed copy: exit 0, 0 errors. `lib/typing/*.d.ts` keep the conditional default `SchemaVersion extends number = string extends EventType ? number : 1` verbatim. `tsdown` in `packages/emmett` (scratch): exit 0, attw "No problems found", `dist/index.d.ts:826` has the same conditional default.
- Next: probes a to j.

## Probes

Probe files are in `examples/`. Each is checked with `tsc` against `work/` (changed copy), and some also against `orig/` (unchanged copy) for comparison. Runner: `scratch/type-surface/probe.sh <orig|work|dist> <files>`.

### a. Helpers called with a generic type parameter (`examples/a.generic-helpers.ts`, `examples/a2.generic-version.ts`)

- Real occurrences: `grep` for `event<`, `command<`, `message<` as calls finds only one in the repo, `packages/emmett/src/eventStore/events/index.ts:19` (`event<MessageSourceCaughtUp>(...)`, a concrete type). No generic call exists in packages, docs or samples. It compiles after the change.
- On `orig/`, the generic calls already fail: `a.generic-helpers.ts(18,18)`, `(25,18)`, `(33,14)`, `(40,20)`: `error TS2345: Argument of type '[EventTypeOf<E>, EventDataOf<E>]' is not assignable to parameter of type 'EventMetaDataOf<E> extends undefined ? ... : ...'`. The metadata conditional is already deferred.
- On `work/`, the same 4 lines fail with the same TS2345, now naming `WithSchemaVersionArgument<...>`. No new failure. Forwarding the helper's own parameters (`a3`, `(...args: Parameters<typeof event<E>>) => event<E>(...args)`) compiles on both.
- New generic forms also defer and fail: `a2.generic-version.ts(5,45)` (version as generic `V`), `(9,12)` (`E extends Event<'X', D, undefined, 2>`), `(14,18)` (`MessageSchemaVersionOf<E>` passed through). All TS2345.
- Class: not a regression (same as today). No repo code needs a change. Nothing to decide, unless generic calls should be supported, which they are not today either.

### h. Helpers with concrete types, and command default metadata (`examples/h.helpers.ts`, `examples/h2.command-metadata-options.ts`)

- `h.helpers.ts`: 0 errors on `work/`. Covers spec 2.1 to 2.6 with `@ts-expect-error` for: V2 without version, wrong literal `3`, V2m without version, version on V1, version on explicit `Event<..., 1>`, version on `Event<string, D>`, C2 without version, message V2 without version. `command<C1>(type, data, { now })` still compiles.
- With the agreed tuple, both `command<C2>(type, data, { now }, 2)` and `command<C2>(type, data, 2, { now })` are rejected (their `@ts-expect-error` lines are used).
- `h2.command-metadata-options.ts`: 0 errors. Option B (`[type, data, version] | [type, data, metadata | undefined, version]`) accepts `command<C2>(t, d, 2)`, `command<C2>(t, d, { now }, 2)`, `command<C2>(t, d, undefined, 2)` and still rejects a missing version. Option C (`[type, data, version, metadata?]`) also compiles, but the version is not last.
- Class: needs a decision (see the final report): versioned commands without declared metadata cannot pass `{ now }` under the agreed tuple.

### b. Rebuilding and spreading messages (`examples/b.rebuild-and-spread.ts`)

- On `work/`: 5 errors.
- `b.rebuild-and-spread.ts(47,70)`: `TS2322 ... Types of property 'schemaVersion' are incompatible. Type 'number | undefined' is not assignable to type 'number'.` A generic `{ ...e, kind: 'Event', metadata }` returned as `RecordedMessage<E>`. Setting `schemaVersion: e.schemaVersion ?? 1` (b3b) compiles. Class: mechanical, the same fix as in the real builders.
- `(74,21)`, `(76,21)`: `Omit<V1 | V2, 'kind'>` loses narrowing: `Property 'productItem' does not exist on type 'D1 | D2'`. `(84,21)`, `(86,21)`: the same for `Pick<V1 | V2, ...>`. `Omit` and `Pick` are not distributive. No repo code uses `Omit`/`Pick` on message types (grep `(Omit|Pick)<...Event|Message|Command...,` finds none). Class: user-facing TypeScript caveat, no repo change.
- Compiles: concrete spread keeps `2`; spread of the union narrows; `Readonly<V1 | V2>`, a homomorphic mapped type, `Partial<V2>`, `Required<V1 | V2>['schemaVersion']` = `1 | 2`; `EventTypeOf`, `EventDataOf`, `EventMetaDataOf`, `MessageKindOf`; `MessageSchemaVersionOf<V2>` = `2`, `<V1 | V2>` = `1 | 2`, `<Event>` = `number`, `<AnyEvent>` = `any`; `CombineMetadata<V2, M>['schemaVersion']` = `2`; `CombinedReadEventMetadata` has no `schemaVersion` (`@ts-expect-error` used); `ReadEvent<V1 | V2>` narrows; `Extract<V1 | V2, { schemaVersion: 2 }>` = `V2`.

### c. Recorded messages (`examples/c.recorded.ts`)

- On `work/`: 0 errors. `RecordedMessage<V2>['schemaVersion']` = `2`, `<V1>` = `1`, `<Event>`, `<Message>`, `<Command>` and the default = `number`, `<C3>` = `3`, `<V1 | V2>` = `1 | 2`, `<AnyEvent>` and `<AnyMessage>` = `any`. `switch` and `if` on `RecordedMessage<V1 | V2>` narrow in both branches. `recorded.metadata.schemaVersion` and `CommonRecordedMessageMetadata['schemaVersion']` are errors (`@ts-expect-error` used). `typeof DefaultMessageSchemaVersion` = `1`. A recorded V1 with `schemaVersion: 2` is rejected.
- Fact: `AnyRecordedMessage` is still `Message<any, any, any>`, so its `schemaVersion` is `number | undefined`, not required. The spec does not name it.

### d. Upcast and downcast types (`examples/d.versioning.ts`)

- On `work/`: 0 errors, no casts. Stored `V1 | V2`, app type `V2`, both directions, through: `upcastRecordedMessage` (payload form and recorded form), `downcastRecordedMessage`, `MessageUpcast`/`MessageDowncast` assignment, `CommandHandler<Cart, V2, V1 | V2>({ schema: { versioning: { upcast, downcast } } })`, `readStream<V2, V1 | V2>`, `appendToStream<V2, V1 | V2>` and `<V2, V1>`, `aggregateStream<Cart, V2, V1 | V2>`, `reactor<V2, ..., V1 | V2>({ messageOptions: { schema: { versioning: { upcast } } } })`, `WorkflowOptions<V2, Cart, V2, ..., V1 | V2>['schema']` and the command variant `C1 | C2`, `JSONCodec<V2, V1 | V2>`.
- Inside `evolve` of `CommandHandler` and in `eachMessage`, `event.schemaVersion` is `2`.
- An upcaster returning `V2` without `schemaVersion` does not compile (`@ts-expect-error` used), and neither does `decide` returning a V2 without it.
- `upcastRecordedMessage<V2, V1 | V2>(...)` returns `schemaVersion: 2`; `downcastRecordedMessage<V2, V1>(...)` returns `schemaVersion: 1` by type.
- Fact (needs a decision, see the report): a downcaster typed `(e: V2) => V1` may leave out `schemaVersion`, since it is optional on V1. Spec 9.2 keeps the original `2` at runtime in that case, while the result type `RecordedMessage<V1>['schemaVersion']` is `1`.
- Side note, not caused by the change: `aggregateStream` with an inline `evolve: (s, e) => ...` gives `TS7006: Parameter 's' implicitly has an 'any' type` on `orig/` as well (checked with a throwaway probe, deleted afterwards). The probe annotates the parameters.

### e. Testing APIs (`examples/e.testing-apis.ts`)

- On `work/`: 0 errors (after fixing my own probe mistake: Mongo stream names must match `${string}:${string}`, `e.testing-apis.ts(43,50) TS2344`, unrelated to the change).
- Checked: `DeciderSpecification.for<C2, V2, State>` given/when/then; `InMemoryProjectionSpec<V1 | V2>`, `PostgreSQLProjectionSpec`, `SQLiteProjectionSpec`, `MongoDBInlineProjectionSpec`, `eventsInStream` (core and PostgreSQL); Express `ApiSpecification<V1 | V2>` with `existingStream` and `expectNewEvents`; Hono `ApiSpecification<V1 | V2>` type.
- What must change in tests: a given, expected or command value of a versioned type (other than 1) must carry `schemaVersion` (for example `schemaVersion: 2`), otherwise tsc rejects it. All five `@ts-expect-error` lines for this are used. Unversioned types need no change.
- Existing repo tests use no versioned types, so none of them failed for this reason in the full run. Class: mechanical.
- Runtime fact (not a type check): the decider spec compares with `assertThatArray(...).containsOnlyElementsMatching` and the Express API spec with `assertMatches` (`emmett-expressjs/src/testing/apiSpecification.ts:239`), both partial matches, so a recorded `schemaVersion: 1` does not break expectations written without it.

### f. Handlers typed with `AnyEvent`/`AnyMessage` receiving `V1 | V2` (`examples/f.any-handlers.ts`, `examples/f2.messagehandler-compare.ts`)

- On `work/`: 0 errors. A `projection<V1 | V2>` assigns to `ProjectionDefinition<AnyEvent>`; `projections.inline([...])` and `projections.async([...])` accept it; `getInMemoryEventStore({ projections })` with an `inMemoryProjection<V1 | V2>`; `getPostgreSQLEventStore(..., { projections })` with `postgreSQLProjection<V2, V1 | V2>` (inside `handle`, `e.schemaVersion` is `2`); `reactor<V1 | V2>` with `canHandle` and a `switch` on `schemaVersion` in `eachMessage`; `projector<V1 | V2>({ projection })`; `CanHandle<V1 | V2 | C2>`.
- Two errors found while writing the probe, both also on `orig/` with unversioned types (`f2.messagehandler-compare.ts`, run on both copies, identical output): `(9,14) TS2322 Type 'SingleRecordedMessageHandlerWithoutContext<A | B, ...>' is not assignable to type 'MessageHandler<AnyMessage>'` and `(11,43) TS7006 Parameter 'm' implicitly has an 'any' type` (an unannotated handler assigned to the `MessageHandler` union). Class: not caused by the change.

### g. `CreateEventType` and `CreateCommandType` (`examples/g.create-types.ts`, `examples/g2.create-types-option.ts`)

- Unchanged in `work/`. `grep` finds no use of either outside their own declarations (packages, docs, samples).
- Compiles: a `CreateEventType` value passes `T extends Event`, a `CreateCommandType` value passes `T extends Command`, `event<V1c>(type, data)` and `command<C1c>(type, data, { now })` (no version argument), `RecordedMessage<V1c>['schemaVersion']` = `number`, and narrowing with `'schemaVersion' in e && e.schemaVersion === 2`.
- Fails: a `switch` on `schemaVersion` over `CreateEventType<'ProductItemAdded', D1> | V2`: `g.create-types.ts(27,13): error TS2339: Property 'schemaVersion' does not exist on type 'Mixed'. Property 'schemaVersion' does not exist on type 'V1c'.`, then `(29,21)` and `(31,21)` TS2339 on `D1 | D2`. The `Create*` types have no `schemaVersion` key, so spec 1.1 and 1.4 do not hold for a union that mixes them with `Event` types.
- `MessageSchemaVersionOf<V1c>` is `{}` (`NonNullable<unknown>`), not `1`.
- `g2.create-types-option.ts`: giving `CreateEventType` the same fourth parameter and `SchemaVersionProperty` as `Event` makes the same `switch` compile (0 errors).
- Class: needs a decision (leave them as they are, or add the fourth parameter). Nothing in the repo breaks either way.

### i. Explicit `Event<..., 1>`, and `Event<string, D>` (`examples/i.explicit-one-and-generic-name.ts`)

- On `work/`: 0 errors.
- `Event<'ProductItemAdded', D1, undefined, 1>` is the same type as the unversioned `V1` (type equality check passes). It accepts a value with or without `schemaVersion: 1` and rejects `schemaVersion: 2`.
- `Event<string, D1>['schemaVersion']` is `number | undefined`; a value with `schemaVersion: 7` compiles. A `V2` value is assignable to `Event<string, D2>`, but not to `Event<'ProductItemAdded', D2>` (that type means version 1; `@ts-expect-error` used). `Event<string, D2, undefined, 2>['schemaVersion']` is `2`.
- Version `0` is required like any version other than 1.
- Fact: a version union as the fourth argument distributes. `Event<..., 2 | 3>` requires `schemaVersion` (`2 | 3`). `Event<..., 1 | 2>` becomes `{ schemaVersion?: 1 } | { schemaVersion: 2 }`, so a value without `schemaVersion` compiles. No spec item covers version unions. Class: fact only, nothing breaks.

### j. Other findings (`examples/j.other.ts`)

- On `work/`: 0 errors (after moving one `@ts-expect-error` I had placed on the wrong line: `j.other.ts(27,14) TS2322 ... Property 'schemaVersion' is missing ... but required in type '{ readonly schemaVersion: 2; }'` plus `(28,3) TS2578 Unused '@ts-expect-error'`).
- j1: `event<V1 | V2>('ProductItemAdded', { productItem })` and `message<V1 | V2>('Event', ...)` compile without a version. With a union type argument, `undefined extends T['schemaVersion']` is true (V1's part is optional), so V2-shaped data can be built without `schemaVersion`. Class: fact; a decision only if union type arguments should be guarded.
- j2: an object literal cast with `as RecordedMessage<V2, ...>` compiles without `schemaVersion`; the same literal without the cast is rejected (`@ts-expect-error` used). Real code that builds recorded messages through a cast, so tsc does not report a missing version (each needs the runtime work of its plan step): `emmett-sqlite/src/eventStore/schema/appendToStream.ts:95`, `emmett-postgresql/src/eventStore/schema/appendToStream.ts:225`, `emmett-mongodb/src/eventStore/mongoDBEventStore.ts:440`, `emmett-mongodb/src/eventStore/consumers/messageSource/mongoDBMessageSource.ts:106`, `emmett-esdb/src/eventStore/eventstoreDBEventStore.ts:390` (`mapFromESDBEvent`), `emmett/src/eventStore/inMemoryEventStore.ts:128` (read slice). Class: mechanical, owned by plan steps 4 to 16.
- j3: `upcastRecordedMessage` also accepts a plain payload and returns a recorded type. `readStream` in PostgreSQL (`schema/readStream.ts`) and SQLite (`schema/readStream.ts`) pass an object without `schemaVersion` through this branch, so they compile without setting it. Class: mechanical, plan steps 7 and 16.
- j4: `Message<'X', D2, undefined, 2>` requires the version on both the event and the command form.
- j5: the change adds two public type names through `export *` in `typing/index.ts`: `SchemaVersionProperty` (from Dreq.diff) and `WithSchemaVersionArgument` (added by me for the helpers). The spec names neither. Class: needs a decision (keep exported, or inline).

### Bundled declarations

- All probes run against `build-work/packages/emmett/dist/index.d.ts` (tsdown output) with `skipLibCheck: false`: exactly the same errors at the same lines as against the source (a 7, b 5, g 3, all others 0). No error inside the `.d.ts` itself.

### Samples

- Samples depend on published packages, and only `expressjs-with-postgresql` has `node_modules`. I copied every sample's `src` into both `orig/samples/` and `work/samples/` and type-checked them with the repo's root `tsconfig.json` paths, so `@event-driven-io/*` resolves to the scratch package sources. Some third-party modules are missing (`execa`, `listr2`, some `@opentelemetry/*`), and the samples pin older APIs, so the baseline is not clean. Only the difference between `orig/` and `work/` is meaningful.
- Web API samples (5): 50 errors on `orig/` and 50 on `work/`, at the same file:line with the same messages. No new error.
- `cloudflare/d1`: 3 on both, identical.
- `cloudflare/durable-objects`: 13 on `orig/`, 14 on `work/`. New: `samples/cloudflare/durable-objects/src/shoppingCarts/projections.unit.spec.ts(67,5): error TS2322 ... is not assignable to type 'ReadEvent<ShoppingCartEvent>[]' ... Types of property 'schemaVersion' are incompatible. Type 'number | undefined' is not assignable to type 'number'.` A test helper builds `ReadEvent`s by spreading events. Class: mechanical (`schemaVersion: 1`). After the fix: 13 errors, identical to `orig/`.

## Patches

- `1-agreed-types.diff`: items 1 to 5 (typing and versioning folders, 5 files).
- `2-mechanical-fixes.diff`: the fixes that bring the full check to 0 new errors (23 files under `src/packages`, plus one sample file).
- `all-changes.diff`: both together. `git apply --check` passes for each against the current repo (dry run only, the repo is unchanged).
- Not formatted with Prettier (Dreq.diff's `>=` and some long lines stay as they are).

## Error counts (first full run, before fixes)

- 88 errors beyond the baseline, all mechanical. By package: emmett 63, emmett-postgresql 14, emmett-sqlite 7, emmett-esdb 4. Samples: 1 more (cloudflare/durable-objects).
- Kind m1, a recorded message is built without `schemaVersion` (fixture or builder): 74 (emmett 63, postgresql 5, sqlite 2, esdb 4), plus 1 in samples.
- Kind m2, code reads or writes `metadata.schemaVersion` (removed from the metadata type): 14 (postgresql 9: 3 code, 6 tests; sqlite 5: 3 code, 2 tests). The scratch fixes for the 6 code sites only make them compile. They are not the read rule: the readers set `schemaVersion: DefaultMessageSchemaVersion` without reading the column. The real fix is plan steps 7, 9 and 16.
- After the fixes: `tsc -p tsconfig.eslint.json` gives only the 3 baseline errors, `tsc -b` gives 0, samples match the `orig/` baseline.

## Documents out of sync

- `plan.md` step 2 still describes the older design: `SchemaVersion extends number | undefined = undefined`, `schemaVersion?` always optional, and "Leave `CreateEventType`, `CreateCommandType`, `AnyEvent`, `AnyCommand` and `AnyMessage` unchanged". The agreed Dreq design (spec "Implementation Decisions", Message types) has the default `string extends Type ? number : 1`, a required property for versions other than 1, and `AnyEvent = Event<any, any, any, any>`. Step 2 also defines `MessageSchemaVersionOf<T>` as "the declared version literal or `undefined`", and step 3 says "When it is `undefined`, keep today's tuples". Under Dreq, `NonNullable<T['schemaVersion']>` gives `1` for V1 and `number` for `Event`, so the helpers check `undefined extends T['schemaVersion']` instead.

## Status

All probes a to j done, the full check is at 0 new errors, and the patches are saved. The final report goes back to the coordinator.
