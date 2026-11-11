# Plan: numeric message schema version

Revision: 20. Built from spec r21.

Spec: `spec.md`. Q&A: `qa.md`. Reviews: `reviews/`.

## How the work is ordered

The order follows "make the change easy, make the easy change". Every step ends green, wires its code into the product, and can be merged on its own. Each step lists the existing tests it breaks and how it updates them.

Criteria 7.1 to 7.3 changed in spec r17 (Q132): appends reject a version below 1 or not whole with `ValidationError`. This is fixed directly in `schemaVersionToAppend` and the shared features after step 11, not as a step. In PostgreSQL the old `text[]` append function's digits check also rejects `'0'`, so 0.43.0-rc.2 instances cannot store a version below 1 (Q133); steps 4, 9, 10 and 12 list 7.1 to 7.3 as spec r20 states them. Step 12 runs the shared features, so SQLite gets the same check.

Steps 1 to 7 are done and committed. They are kept below as they were written in plan r1, before spec r1. Where the spec changed what they built, steps 8 and 9 correct the code. The r1 terms inside those prompts (for example the metadata fallback in every store) are replaced by the terms below.

1. Steps 8 and 9: corrections to the done steps. First the optional version argument and the internal helper types, then the read rule per store.
2. Steps 10 and 11: PostgreSQL. The append functions, the fresh `INT` layout and the appends through the new function, then the schema version migration with the prepared 0.44.0 migration. The tetris migration is moved to https://github.com/event-driven-io/emmett/issues/428 (Q128).
3. Step 12: SQLite.
4. Step 13: the breaking type change for recorded messages, and the docs.

Criteria the done steps already cover: 1.1 to 1.7 (step 2, `messageSchemaVersion.unit.spec.ts`, including "narrows created event and command types mixed with versioned types" for 1.7), 2.1 to 2.7 (step 3), 4.8 (steps 5 and 6, "reads kind Event for a message stored without a kind"), 5.4 (step 6), 15.1, 15.2 and 15.4 (step 7). Step 9 moves the step 7 tests for 6.1, 6.2 and 6.4 onto a 0.43.0-rc.2 store.

## Terms

- **Released 0.43.0**: the published 0.43.0 prereleases (up to `0.43.0-rc.2`) that teams already run. A "0.43.0 instance" and "the frozen 0.43.0 API" mean this code.
- **Current release**: the next 0.43.0 release, which ships this work. The store keeps reporting store schema version `0.43.0`.
- **Frozen 0.43.0 API**: the copy of the released PostgreSQL and SQLite append and read code in `migrations/0_43_0/legacyApi.ts` (step 1), used by tests to act as a 0.43.0 instance.
- **0.43.0-rc.2 store**: a database built with the migrations that shipped in 0.43.0-rc.2 (`migrations_0_43_0_rc_2` from step 1, after the 0.36.0, 0.38.7 and 0.42.0 sets). Its column is `TEXT`.
- **Old append function**: `emt_append_to_stream`, versions as `text[]`. **New append function**: `emt_append_to_stream_v_0_43_0`, versions as `int[]`.
- **Converting body**: the old append function's body from step 10. Values matching `^0*[1-9][0-9]*$` become integers. A non-numeric value, `0`, or one too large for `INT`, fails the append with an error (Q133). It works on `TEXT` and `INT` columns.
- **Automatic migrations of the current release**: the migrations the current release adds to a driver's 0.43.0 set, and their variants for a custom database schema. PostgreSQL: the migration from step 10. SQLite: the SQLite column swap from step 12.
- **Schema version migration** (`migrateSchemaToNumericMessageSchemaVersion`, step 11): the on-demand PostgreSQL migration. **Mandatory migration**: the schema version migration in the PostgreSQL 0.44.0 set (step 11).
- **SQLite column swap**: the automatic SQLite migration that replaces the `TEXT` column with an `INTEGER` column: it adds the column, fills it, drops the old one and renames the added one (step 12).
- **User `CASE`**: the optional Dumbo `SQL` fragment `messageSchemaVersionMapping`, the first `COALESCE` argument in the migrations.
- **Numeric value** (read rule). A value stored as a number is numeric when it is a whole number of `0` or more, and is taken as it is: `-1` and `1.5` are missing. A string is numeric when it matches `^[0-9]+$`, and reads as that number: `'02'` is `2`. Any other string (`'2.0'`, `'-1'`, `' 2'`, `'v2'`) is missing.
- **Read rule.** PostgreSQL: the stored value if numeric, else numeric `metadata.schemaVersion`, else `1`. MongoDB, EventStoreDB and in-memory: the stored value if numeric, else `1`. SQLite: the column only. Every read removes `schemaVersion` from `metadata`.
- **Append rule.** Every store persists the top-level `schemaVersion`, else a numeric `metadata.schemaVersion` by the read rule, else `1`; the top-level value always wins. A version that is not a whole number of `1` or more fails the append with `ValidationError` (Q132). `schemaVersionToAppend` in core implements it.
- **Recorded shape.** Every recorded message, including those handed to hooks, inline projections and consumers, has `schemaVersion` at the top level and none in `metadata`. The PostgreSQL metadata copy exists only in the stored row.

## Rules for every step

- Follow `AGENTS.md`. Work test-first: write the failing test, run it, see it fail for the expected reason, make it pass, then refactor. A test marked "protects existing behaviour" passes before the change; write it and keep it green.
- In migration and compatibility tests, test and helper names name the exact version: `0.43.0-rc.2` for the frozen API and the stores built from `migrations_0_43_0_rc_2`, `0.42.0` and older for theirs, `0.43.0` for the code being built. Say where the store comes from ("after migrating from 0.43.0-rc.2", "a store 0.43.0 created"). Do not use "released", "legacy", "current release", "0.43.0 instance", "new" or "upgraded" in names. Tests of `createEventStoreSchema`, `appendToStream` and `readStream` test the latest schema and carry no version (Q123).
- Name tests after behaviour that users can see. Assert every field of a recorded message, including `schemaVersion` and the full `metadata`.
- Type-level checks are `expectTypeOf` inside normal `it(...)` tests in the regular `*.unit.spec.ts` files. `// @ts-expect-error` only inside those type tests.
- No code comments, except the one "double-check before the 0.44.0 release" comment in step 11. No monkey-patching. No abstractions the step does not ask for.
- No append or read may check the column type or query the catalog. Appends and reads are a hot path.
- Run commands from `src`. Run the smallest relevant test files while you work, then `npm run agent:check` and `npm run test:unit`. Do not commit.

---

## Step 1. Freeze the 0.43.0 APIs for tests

Why first: every later migration and blue/green test needs to write data the way a deployed 0.43.0 instance does. This step changes no product behaviour, so it can be merged right away.

```text
Context
Emmett repo, npm workspaces in `src`. Read `AGENTS.md` first and follow it.
PostgreSQL package: `src/packages/emmett-postgresql/src/eventStore/schema/`.
SQLite package: `src/packages/emmett-sqlite/src/eventStore/schema/`.
Later work changes how both drivers append and read `schemaVersion`. Tests then need to act as a deployed 0.43.0 instance. Today `migrations/0_43_0/legacyApi.ts` in PostgreSQL only re-exports the 0.42.0 legacy API, and SQLite has no 0.43.0 legacy API.

Goal
Freeze today's append and read code as the 0.43.0 API, for tests only. Change no product code.

Do this
1. PostgreSQL: in `migrations/0_43_0/legacyApi.ts`, keep the existing re-exports. Add frozen copies of today's `appendToStream` (from `appendToStream.ts`, including `callAppendToStream` and `appentToStreamRaw`; the copy calls `emt_append_to_stream` with `text[]` versions taken from `metadata.schemaVersion ?? '1'`) and of today's `readStream` (from `readStream.ts`). Export them under names that do not clash with the current API, for example `appendToStream_0_43_0_rc_2` and `readStream_0_43_0_rc_2`, and keep the existing `appendToStream` export pointing where it points today. The copies must not import from the current `appendToStream.ts` or `readStream.ts`, so later edits there cannot change them. Shared constants such as table names may still be imported.
2. PostgreSQL: in the same file, export `migrations_0_43_0_rc_2`: the list that `migrations/0_43_0/index.ts` exports today, copied as its own array of the same migration objects. Later steps append new migrations to `migrations_0_43_0`, and tests use the released list to build a 0.43.0-rc.2 store.
3. SQLite: create `migrations/0_43_0/legacyApi.ts` with a frozen copy of today's append (it writes `message.metadata.schemaVersion ?? '1'` into `message_schema_version`) and today's `readStream`. Follow the shape of `migrations/0_42_0/legacyApi.ts`. Also export `migrations_0_43_0_rc_2`, the same way as for PostgreSQL.

Tests
- PostgreSQL: in `migrations/0_43_0/0_43_0.migration.int.spec.ts`, add a test. It builds a 0.43.0-rc.2 store with the 0.36.0, 0.38.7 and 0.42.0 migrations plus `migrations_0_43_0_rc_2`, the same way `0_44_0.migration.int.spec.ts` does. It appends an event with `metadata.schemaVersion: '2'` through the frozen append, reads it back through the frozen read, and asserts the whole event, including `metadata.schemaVersion: '2'`.
- SQLite: add the same scenario in `src/packages/emmett-sqlite/src/storage/sqlite3/eventStore/schema/migrations/0_43_0/0_43_0.migration.int.spec.ts`.

Done when
Both new tests pass and existing tests are unchanged and green. `npm run agent:check` and `npm run test:unit` pass. No product file changed.
```

---

## Step 2. Version type parameter on messages

Why: it only adds types and changes no runtime behaviour, so it can be merged on its own.

```text
Context
Emmett repo. Read `AGENTS.md` first and follow it.
Core types: `src/packages/emmett/src/typing/event.ts`, `command.ts`, `message.ts`.
Today `Event<Type, Data, MetaData>` and `Command<Type, Data, MetaData>` are `Readonly<...> & { readonly kind?: 'Event' }` (or `'Command'`). `Message<Type, Data, MetaData>` is `Command | Event`.

Goal
Add a fourth, last type parameter for the schema version literal, and a read-only `schemaVersion` property next to `kind`. The property is optional for unversioned types and version 1, and required for any other declared version. The typing was checked with `tsc` in the PoC `brainstorms/numeric-schema-version/unversioned-schema-version-typing/` (candidate "Dreq": `examples/candidates/Dreq/typing.ts` and `examples/real-package-patches/Dreq.diff`). Start from that patch.

Acceptance criteria (spec 1)
1.1 GIVEN `V1 = Event<'ProductItemAdded', D1>` and `V2 = Event<'ProductItemAdded', D2, undefined, 2>` WHEN an upcaster switches on `event.schemaVersion` THEN the `case 2` branch sees `data` typed as `D2`.
1.2 GIVEN `V1` declared without a version WHEN a value of `V1` has no `schemaVersion` THEN it type-checks.
1.3 GIVEN a command type declared with version `3` WHEN it is used in a union with its unversioned form THEN it narrows the same way as events.
1.4 GIVEN `V1` and `V2` from 1.1 WHEN an upcaster switches on `event.schemaVersion` THEN the `default` branch sees `data` typed as `D1`.
1.5 GIVEN `V2` declared with version 2 WHEN a value of `V2` is written without `schemaVersion` THEN it does not compile.
1.6 GIVEN a generic function constrained by `T extends Event`, `T extends Command` or `T extends Message` WHEN it is called with `V1`, `V2` or `V1 | V2` THEN it compiles.

Do this
1. `Event`, `Command` and `Message` get `SchemaVersion extends number = string extends <TypeName> ? number : 1` as the fourth parameter. The bare `Event` used as a constraint gets `number`. `Event<'X', D>` gets `1`.
2. Add the property through one type, next to `kind`:
   `number extends V ? { readonly schemaVersion?: V } : V extends 1 ? { readonly schemaVersion?: V } : { readonly schemaVersion: V }`.
   An explicit version 1 is then the same type as no version.
3. `Message` passes the parameter to both `Event` and `Command`.
4. `AnyEvent`, `AnyCommand` and `AnyMessage` pass `any` as the fourth argument as well, for example `Event<any, any, any, any>`.
   The PoC patch writes the default right after a closing `>`, which produces a `>=` token. `tsc` accepts it, but esbuild (and so vitest) fails with `Expected identifier but found ">="`. Write `> =`, as Prettier does.
5. Give `CreateEventType` and `CreateCommandType` the same fourth parameter and property, so a `switch` over a union that mixes them with `Event` types narrows (Q72). The research probe `type-surface-research/examples/g2.create-types-option.ts` shows the shape.
6. Add a type helper next to `MessageKindOf`: `MessageSchemaVersionOf<T>`, the declared version literal (`1` for unversioned types, `number` for the bare type). Step 3 needs it.

Tests
Add `src/packages/emmett/src/typing/messageSchemaVersion.unit.spec.ts`, with `expectTypeOf` checks inside `it(...)` tests. Write one failing check first and see `npm run build:ts` report it. Reuse the cases from the PoC `examples/checks.ts`:
- 1.1 and 1.4: inside `switch (e.schemaVersion)`, `expectTypeOf(e.data).toEqualTypeOf<D2>()` in `case 2` and `toEqualTypeOf<D1>()` in `default`.
- 1.2: `expectTypeOf<{ type: 'ProductItemAdded'; data: D1 }>().toExtend<V1>()`.
- 1.3: the same narrowing checks for commands.
- 1.5: `expectTypeOf<{ type: 'ProductItemAdded'; data: D2 }>().not.toExtend<V2>()`.
- 1.6: `expectTypeOf<V1>().toExtend<Event>()`, the same for `V2`, `V1 | V2`, `Command` and `Message`.
- `CreateEventType` and `CreateCommandType` in a mixed union narrow the same way.
Fix every new compile error in the repo, for example test fixtures that build V2 values without `schemaVersion`. Run `npm run build:ts` as part of the test cycle.

Done when
The type checks and tests pass, `npm run build:ts` passes, and `npm run agent:check` and `npm run test:unit` pass.
```

---

## Step 3. Version argument on `event()`, `command()` and `message()`

Why: a small additive API change built on step 2. It can be merged on its own.

```text
Context
Emmett repo. Read `AGENTS.md` first and follow it.
Step 2 added the fourth type parameter and `schemaVersion` to `Event`, `Command` and `Message` (optional for unversioned types and version 1, required for any other declared version), and added `MessageSchemaVersionOf<T>`.
The checked design for this step is in `brainstorms/numeric-schema-version/type-surface-research/bare-number-with-command-metadata/` (`findings.md`, `factory-change-on-top-of-work.diff`, probes `examples/a.forms.ts` and `examples/c.runtime.ts`). Start from it.
The helpers are in `src/packages/emmett/src/typing/event.ts` (`event`), `command.ts` (`command`) and `message.ts` (`message`). Each takes positional arguments whose tuple depends on whether the type declares metadata.

Goal
Each helper takes the version as the last positional argument, as a plain number. The argument is required when the type declares a version other than 1, and not accepted otherwise. A versioned command without declared metadata accepts both `[type, data, version]` and `[type, data, metadata | undefined, version]`, so the default `{ now }` metadata can still be passed. The helper sets `schemaVersion` on the result only when it is given, and does not touch metadata.

Acceptance criteria (spec 2)
2.1 GIVEN an event type with version `2` and no metadata WHEN `event<T>(type, data)` is called without the version THEN it does not compile.
2.2 GIVEN an event type with version `2` and no metadata WHEN `event<T>(type, data, 2)` is called THEN the result has `schemaVersion: 2` and `kind: 'Event'`.
2.3 GIVEN an event type with version `2` and metadata WHEN `event<T>(type, data, metadata, 2)` is called THEN the result has `metadata` and `schemaVersion: 2`.
2.4 GIVEN an event type without a version WHEN `event<T>(type, data)` is called THEN the result has no `schemaVersion`.
2.5 GIVEN a command type with version `2` WHEN `command<T>(type, data, 2)` is called THEN the result has `schemaVersion: 2` and `kind: 'Command'`.
2.6 GIVEN a message type with version `2` WHEN `message<T>(kind, type, data, 2)` is called THEN the result has `schemaVersion: 2`.
2.7 GIVEN a command type with version `2` and no declared metadata WHEN `command<T>(type, data, { now }, 2)` or `command<T>(type, data, undefined, 2)` is called THEN the result has `schemaVersion: 2`, AND `metadata` is `{ now }` in the first case and missing in the second.

Do this
1. Extend each helper's rest-argument tuple with a conditional on the type's `schemaVersion`. When `undefined` is assignable to it (unversioned types, version 1, and the bare `number`), keep today's tuples exactly. Otherwise append `schemaVersion: MessageSchemaVersionOf<T>` as the last element. The research in `type-surface-research/` (`1-agreed-types.diff`) has a checked version of this.
2. `command()` today accepts optional default metadata when the type declares none. For a versioned command without declared metadata, the tuple is a union of `[type, data, schemaVersion]` and `[type, data, metadata: DefaultCommandMetadata | undefined, schemaVersion]`. Events get no extra form, because events without declared metadata have no metadata position today.
3. At runtime, a number in the last argument is the version, and the argument before it, if any and not `undefined`, is metadata. Build the result as today, with `kind`, and add `metadata` and `schemaVersion` only when present.
4. Put the helper types (`WithSchemaVersionArgument`) and the runtime split in a module under `src/packages/emmett/src/typing/` that `typing/index.ts` does not re-export, so they stay out of the public API. `MessageSchemaVersionOf` stays public.

Tests
Runtime unit tests next to the existing helper tests in `src/packages/emmett/src/typing`: assert the whole result object with deep equality (2.2–2.7).
Type checks in `src/packages/emmett/src/typing/messageSchemaVersion.unit.spec.ts` (from step 2): `expectTypeOf(event<V2>('ProductItemAdded', data, 2)).toEqualTypeOf<V2>()` and the same for the other forms. For 2.1 and the rejected command forms (no version, `{ now }` without a version, the version before `{ now }`, a wrong literal, a version on an unversioned command), use `// @ts-expect-error` on the call, as the Vitest docs do for calls that must not compile. Check that existing calls without a version still compile.

Done when
The tests and type checks pass, `npm run build:ts` passes, and `npm run agent:check` and `npm run test:unit` pass.
```

---

## Step 4. Read rule, upcast and downcast, shared features on the in-memory store

Why: this step proves the whole behaviour on the simplest store, and it adds the shared feature tests that every later store step reuses.

```text
Context
Emmett repo. Read `AGENTS.md` first and follow it.
Core versioning helpers: `src/packages/emmett/src/eventStore/versioning/upcasting.ts` and `downcasting.ts`. They copy `data` and merge `metadata` from the function result, and ignore `schemaVersion`.
In-memory store: `src/packages/emmett/src/eventStore/inMemoryEventStore.ts`. Append spreads `...event` and builds metadata. Read slices the stored array and calls `upcastRecordedMessages`.
Shared cross-store feature tests: `src/packages/emmett-tests/src/eventStore/features.ts`, with exported `testAppendToStream`, `testAggregateStream`, `testCommandHandling` and `testStreamExists`. Store wiring: `src/packages/emmett-tests/src/eventStore/{inMemory,postgresql,sqlite,mongodb,esdb}/*.spec.ts`. The domain is in `shoppingCart.domain.ts`.
`DefaultMessageSchemaVersion` is still the string `'1'` in `typing/message.ts`. Do not change it here. Step 13 changes it.

Terms
Numeric value: a JavaScript integer, or a string made only of the digits 0–9. Everything else is non-numeric.
Read rule: the stored value if numeric, else `metadata.schemaVersion` if numeric, else `1`. Every read removes `schemaVersion` from `metadata`.
Append rule: persist the top-level `schemaVersion`, else a numeric `metadata.schemaVersion` by the read rule, else `1`; the top-level value always wins. A version that is not a whole number of `1` or more fails the append with `ValidationError` (Q132).

Goal
1. Core functions that drivers call to apply the read rule.
2. Upcast and downcast take `schemaVersion` from the function result when it is present, and `1` otherwise.
3. The in-memory store follows the append and read rules.
4. New shared features, wired for in-memory now and for each other store in its own step.

Acceptance criteria (in-memory unless noted)
4.1 GIVEN an empty stream WHEN an event with `schemaVersion: 2` is appended and the stream is read THEN the recorded event has `schemaVersion: 2`.
4.2 GIVEN an empty stream WHEN events with versions 1, 2 and 3 are appended in one call THEN each recorded event has its own version, in order.
4.3 GIVEN an empty stream WHEN an event without `schemaVersion` is appended THEN the recorded event has `schemaVersion: 1`.
4.5 GIVEN an appended event with `schemaVersion: 2` WHEN the stream is aggregated THEN `evolve` receives the event with `schemaVersion: 2`.
4.6 GIVEN an appended command with `schemaVersion: 2` WHEN it is read THEN the recorded command has `schemaVersion: 2`.
5.1 GIVEN an event appended with `schemaVersion: 2` and user metadata WHEN it is read THEN `metadata` contains the user metadata and Emmett's recorded fields, and no `schemaVersion`.
6.1–6.3 (core unit tests of the read rule) GIVEN no usable stored version and `metadata.schemaVersion` of `'2'`, missing, or `'v2'` THEN the version is 2, 1, or 1, AND `metadata` has no `schemaVersion`.
7.1 GIVEN an event with `schemaVersion: 0` WHEN it is appended THEN the append fails with a `ValidationError` (spec r20; see the plan intro).
8.1 GIVEN a stored event with `schemaVersion: 1` AND an upcaster that returns `schemaVersion: 2` with new data WHEN the stream is read THEN the recorded event has `schemaVersion: 2` and the new data.
8.2 GIVEN a stored event with `schemaVersion: 1` AND an upcaster that returns only `type` and `data` WHEN read THEN the recorded event has `schemaVersion: 1` and the new data.
8.3 GIVEN a stored event with `schemaVersion: 2` AND an upcaster that returns the event unchanged WHEN read THEN the recorded event has `schemaVersion: 2`.
9.1 GIVEN an event with `schemaVersion: 2` AND a downcaster that returns `schemaVersion: 1` with old data WHEN it is appended and read without an upcaster THEN the recorded event has `schemaVersion: 1` and the old data.
9.2 GIVEN an event with `schemaVersion: 2` AND a downcaster typed `(e: V2) => V1` that returns only `type` and `data` WHEN it is appended and read without an upcaster THEN the recorded event has `schemaVersion: 1` and the old data.
10.1 GIVEN a command handler whose decide returns an event with `schemaVersion: 2` WHEN the command is handled and the stream is read THEN the recorded event has `schemaVersion: 2`.
10.2 GIVEN a command handler with an upcaster that maps version 1 to 2 WHEN existing version 1 events are evolved THEN evolve receives them with `schemaVersion: 2`.
Consumer criteria 4.4 and 8.4 are not part of this step: the in-memory store has no `consumer()`. Steps 5, 6, 9 and 16 cover them for the stores that have one.

Do this
1. Add `src/packages/emmett/src/eventStore/versioning/schemaVersion.ts` and export it from `versioning/index.ts`. It holds:
   - `isNumericSchemaVersion(value: unknown): boolean`, by the definition above.
   - `resolveSchemaVersion(stored: unknown, metadata: unknown): number`, the read rule.
   - `withoutSchemaVersion(metadata)`, which returns the metadata without the `schemaVersion` key and keeps every other key.
   Drivers call these. Do not add other helpers.
2. In `upcastRecordedMessage` and `downcastRecordedMessage`, set `schemaVersion` from the result when the result has it, and `1` otherwise (Q76). Keep everything else the same. Do not change the `MessageUpcast` or `MessageDowncast` types.
3. In-memory append: store `schemaVersion: event.schemaVersion ?? 1` at the top level of the stored message (after downcasting, so a downcast version is stored), and build metadata without `schemaVersion`. In-memory read: apply `resolveSchemaVersion` and `withoutSchemaVersion` to each stored message before upcasting.
4. In `features.ts`, add `testSchemaVersion(eventStoreFactory, options?)`. It holds criteria 4.1, 4.2, 4.3, 4.5, 4.6, 5.1, 7.1, 8.1–8.3, 9.1, 9.2, 10.1 and 10.2 through the public `EventStore` API (`appendToStream`, `readStream`, `aggregateStream`, `CommandHandler` with `schema.versioning`). Add versioned event types to `shoppingCart.domain.ts`, for example `ProductItemAdded` V1 and V2 with the fourth type parameter, and create events with the step 3 helpers. Assert whole recorded events, with metadata fields that the store generates matched by type where the existing features already do so.
5. Add `testConsumerSchemaVersion(eventStoreFactory, options?)` for criteria 4.4 and 8.4, through `eventStore.consumer()` and a reactor that collects messages. Do not wire it for in-memory.
6. Wire `testSchemaVersion` in `inMemory/inMemoryEventStore.unit.spec.ts`.
7. The append builder and the read slice in `inMemoryEventStore.ts` sit behind `as` casts, so `tsc` does not report a missing `schemaVersion` there. Check both by hand.

Tests
Core unit tests for `schemaVersion.ts` (6.1–6.3, numeric definition cases `'"1"'`, `'2.0'`, `'two'`, `2`, `'2'`). Unit tests for upcast and downcast next to the existing versioning tests. The shared features run on in-memory.

Done when
All new tests pass on in-memory, existing tests stay green, and `npm run agent:check` and `npm run test:unit` pass.
```

---

## Step 5. MongoDB

```text
Context
Emmett repo. Read `AGENTS.md` first and follow it.
Step 4 added `isNumericSchemaVersion`, `resolveSchemaVersion` and `withoutSchemaVersion` in `@event-driven-io/emmett` (`eventStore/versioning/schemaVersion.ts`), schemaVersion support in upcast and downcast, and the shared features `testSchemaVersion` and `testConsumerSchemaVersion` in `src/packages/emmett-tests/src/eventStore/features.ts`.
MongoDB store: `src/packages/emmett-mongodb/src/eventStore/mongoDBEventStore.ts`. Append builds `{ type, data, metadata }` for each event, downcasts it, and `$push`es it into the stream document's `messages` array. `readStream` reads `messages` and upcasts them. The consumer yields messages in `consumers/messageSource/mongoDBMessageSource.ts`, from `oplogChangeToMessages` in `mongoDBSubscription.ts`, as `{ kind, type, data, metadata }`.
The `schemaVersion` in `projections/mongoDBInlineProjection.ts` is the read model's version. It is not part of this work. Do not touch it.

Terms
Read rule: the stored value if numeric, else `metadata.schemaVersion` if numeric, else `1`. Remove `schemaVersion` from `metadata` on read. Append rule: store the top-level `schemaVersion`, else a numeric `metadata.schemaVersion` by the read rule, else `1`; the top-level value always wins. A version that is not a whole number of `1` or more fails the append with `ValidationError` (Q132).

Goal
MongoDB stores the version as a top-level field on the stored message, next to `type`, `data` and `metadata`. It returns the version on stream reads and in consumers. It writes no string copy into metadata.

Acceptance criteria
4.1–4.6, 5.1, 7.1, 8.1–8.4, 9.1, 9.2, 10.1, 10.2 through the shared features (texts in `features.ts`).
5.3 GIVEN an event appended with `schemaVersion: 2` WHEN the raw stored message is inspected THEN its metadata has no `schemaVersion`.
6.1 GIVEN a stored message without a top-level version and with `metadata.schemaVersion: '2'` WHEN it is read THEN `schemaVersion` is 2 and `metadata` has no `schemaVersion`.
6.2 Same without `metadata.schemaVersion`: `schemaVersion` is 1.
6.3 Same with `metadata.schemaVersion: 'v2'`: `schemaVersion` is 1.

Do this
1. Append: add `schemaVersion: event.schemaVersion ?? 1` to the object that is downcast and pushed. Leave `schemaVersion` out of its metadata.
2. `readStream`: map each stored message through `resolveSchemaVersion(message.schemaVersion, message.metadata)` and `withoutSchemaVersion`, then upcast.
3. Message source: apply the same mapping where it yields messages.
4. Wire `testSchemaVersion` and `testConsumerSchemaVersion` in `src/packages/emmett-tests/src/eventStore/mongodb/mongoDBEventStore.e2e.spec.ts`.
5. The append builder in `mongoDBEventStore.ts` and the yielded message in `mongoDBMessageSource.ts` sit behind `as` casts, so `tsc` does not report a missing `schemaVersion` there. The tests must cover both.

Tests
In the MongoDB package, next to the existing event store integration tests, add 5.3 (read the raw stream document from the collection) and 6.1–6.3 (insert a stream document directly with a message that has no top-level `schemaVersion`, then read it through `readStream` and through a consumer).

Done when
The new tests and shared features pass on MongoDB, and `npm run agent:check` and `npm run test:unit` pass.
```

---

## Step 6. EventStoreDB

```text
Context
Emmett repo. Read `AGENTS.md` first and follow it.
Step 4 added `resolveSchemaVersion` and `withoutSchemaVersion` in `@event-driven-io/emmett`, and the shared features `testSchemaVersion` and `testConsumerSchemaVersion` in `src/packages/emmett-tests/src/eventStore/features.ts`.
EventStoreDB store: `src/packages/emmett-esdb/src/eventStore/eventstoreDBEventStore.ts`. Append downcasts events and serialises each one with `jsonEvent({ ...event, id, metadata: { messageId, correlationId, ..., ...metadata } })`. Every read path (readStream, aggregateStream, the consumer message source and `readLastCommittedMessageCheckpoint`) maps events through the exported `mapFromESDBEvent`.

Goal
EventStoreDB events have only `type`, `data` and `metadata`, so the version is stored as a number in the event metadata under `schemaVersion`. That one key is both the stored value and what a 0.43.0 reader sees. Reads lift it to the top level and remove it from `metadata`.

Acceptance criteria
4.1–4.6, 5.1, 7.1, 8.1–8.4, 9.1, 9.2, 10.1, 10.2 through the shared features.
5.4 GIVEN an event appended with `schemaVersion: 2` WHEN the raw event metadata is inspected THEN it contains `schemaVersion: 2`.
6.1 GIVEN a raw event with `metadata.schemaVersion: '2'` (a string, written without Emmett) WHEN it is read THEN `schemaVersion` is 2 and `metadata` has no `schemaVersion`.
6.2 Same without `metadata.schemaVersion`: `schemaVersion` is 1.
6.3 Same with `metadata.schemaVersion: 'v2'`: `schemaVersion` is 1.

Do this
1. Append: put `schemaVersion: event.schemaVersion ?? 1` into the serialised metadata, after the user metadata spread so the top-level value wins. Do not pass the top-level `schemaVersion` as an extra `jsonEvent` field.
2. `mapFromESDBEvent`: set `schemaVersion: resolveSchemaVersion(metadata.schemaVersion, metadata)` and build `metadata` with `withoutSchemaVersion`.
3. Wire `testSchemaVersion` and `testConsumerSchemaVersion` in `src/packages/emmett-tests/src/eventStore/esdb/eventstoreDBEventStore.e2e.spec.ts`.
4. `mapFromESDBEvent` builds its result with a type assertion, so `tsc` does not report a missing `schemaVersion` there. The tests must cover it.

Tests
In the EventStoreDB package, next to the existing event store tests, add 5.4 (read the raw event with the EventStoreDB client) and 6.1–6.3 (append raw events with the client, then read them through the Emmett store).

Done when
The new tests and shared features pass on EventStoreDB, and `npm run agent:check` and `npm run test:unit` pass.
```

---

## Step 7. PostgreSQL reads

Why: reads must handle old data before anything writes new data. Appends still go through today's path, so this step can be merged on its own.

```text
Context
Emmett repo. Read `AGENTS.md` first and follow it.
PostgreSQL schema code: `src/packages/emmett-postgresql/src/eventStore/schema/`. `readStream.ts` and `readMessagesBatch.ts` select `message_schema_version` but ignore it. They build metadata as `{ schemaVersion: DefaultMessageSchemaVersion, ...rowMetadata, ... }`. Consumers read through `readMessagesBatch`.
The column is `TEXT` today. 0.42.x rows hold `'1'` (Q81). 0.43.0 rows hold `metadata.schemaVersion ?? '1'` as text, and their metadata JSON has `schemaVersion` as a string when the user set it. Later steps make the column `INT` on fresh and migrated stores, so reads must work with both types.
Step 4 added `resolveSchemaVersion` and `withoutSchemaVersion` in `@event-driven-io/emmett`. Step 1 added the frozen 0.43.0 API and `migrations_0_43_0_rc_2` in `migrations/0_43_0/legacyApi.ts`. The 0.42.x legacy append that writes `'1'` is in `migrations/0_38_7/legacyApi.ts`.

Goal
Both reads take the version through the read rule (column value, then `metadata.schemaVersion`, then `1`) and remove `schemaVersion` from `metadata`. They work on `TEXT` and `INT` columns.

Acceptance criteria
6.4 GIVEN a `TEXT` column with a non-numeric value and `metadata.schemaVersion: '3'` WHEN the row is read THEN `schemaVersion` is 3.
15.1 GIVEN a store with 0.42.x rows that hold `'1'` WHEN the automatic migrations of the current release run THEN the column is still `TEXT` AND reads return `schemaVersion: 1` for those rows.
15.2 GIVEN a store with 0.43.0 rows that hold `'2'` and `metadata.schemaVersion: '2'` WHEN they are read after the automatic migrations THEN `schemaVersion` is 2 and `metadata` has no `schemaVersion`.
15.4 GIVEN a `TEXT` column after the automatic migrations WHEN consumers read batches of messages THEN each message has the same `schemaVersion` as `readStream` returns.

Do this
1. In both selects, select the column as `message_schema_version::text AS message_schema_version`, so the row type is always a string on both column types. Keep the row type as `string`.
2. Map rows with `schemaVersion: resolveSchemaVersion(row.message_schema_version, row.message_metadata)` at the top level, and build `metadata` from `withoutSchemaVersion(row.message_metadata)` plus the recorded fields. Remove the `schemaVersion: DefaultMessageSchemaVersion` line from both metadata builders.
3. `readStream.ts` passes a plain object to `upcastRecordedMessage`, and both builders use casts, so `tsc` does not report a missing `schemaVersion` there. The tests must cover both reads.

Tests
- `readStream.int.spec.ts` and `readMessagesBatch.int.spec.ts`: update the existing `schemaVersion` cases to the new shape, and add 6.4 by inserting a row directly with SQL.
- `migrations/0_43_0/0_43_0.migration.int.spec.ts`: add 15.1 (0.42.x rows through the 0.38.7 legacy append, then the current automatic migrations through `eventStoreSchemaMigrationsFor()`, then current `readStream`, and assert the column type is still `text` through `information_schema.columns`), 15.2 (the same with released 0.43.0 rows through the frozen 0.43.0 append), and 15.4 (read the same rows with `readMessagesBatch` and compare versions with `readStream`).

Done when
The new tests pass, the updated tests pass, and `npm run agent:check` and `npm run test:unit` pass.
```

---

## Step 8. Optional version argument and internal helper types

```text
Use the `implement-step` skill.

What to build
A message type declared without a version, or with version 1, accepts an optional last argument `1` in `event()`, `command()` and `message()`, including after metadata (Q118). The result then has `schemaVersion: 1`. Any other number there does not compile. Calls without the argument behave as today. The helper types behind the signatures, including `MessageSchemaVersionOf`, can no longer be imported from `@event-driven-io/emmett`.

Context
- `src/packages/emmett/src/typing/messageSchemaVersion.ts`: `WithSchemaVersionArgument<MessageType, Args>` returns `Args` unchanged when `undefined extends MessageType['schemaVersion']`, so unversioned types take no version today. `splitMetadataAndSchemaVersion` already treats a trailing number as the version at runtime.
- `src/packages/emmett/src/typing/command.ts:58-65` has its own argument tuple for an unversioned command without declared metadata (`[type, data, metadata?: DefaultCommandMetadata | undefined]`), outside `WithSchemaVersionArgument`. It needs the optional `1` too.
- `src/packages/emmett/src/typing/message.ts:28` defines and exports `MessageSchemaVersionOf`. `typing/index.ts` re-exports `message.ts`, so it is public. `messageSchemaVersion.ts` is not re-exported.
- `src/packages/emmett/src/typing/messageSchemaVersion.unit.spec.ts` has `@ts-expect-error` cases that reject `event<V1>(..., 1)`, `event<V1x>(..., 1)`, `command<C1>(..., 1)`, `command<C1>(..., { now }, 1)` and `message<V1>(..., 1)` (lines 260-276, 345-371, 413-418). These calls become valid, so these cases move to accepted calls. It also imports `MessageSchemaVersionOf` from `'.'` (line 15).

Similar code
- The versioned branch of `WithSchemaVersionArgument`, which appends `schemaVersion: MessageSchemaVersionOf<MessageType>`, and the two forms a versioned command without declared metadata accepts.
- The existing factory tests in `messageSchemaVersion.unit.spec.ts`.

Blocked by
None.

Acceptance criteria
- 2.8 GIVEN an event type without a version WHEN `event<T>(type, data, 1)` is called THEN the result has `schemaVersion: 1`.
- 2.9 GIVEN an event type without a version WHEN `event<T>(type, data, 2)` is called THEN it does not compile.
- 3.3 GIVEN the `@event-driven-io/emmett` package WHEN `MessageSchemaVersionOf` or `WithSchemaVersionArgument` is imported from it THEN it does not compile.

Tests
- 2.8: "creates an unversioned event with the optional schema version 1" - asserts the whole result `{ type, data, kind: 'Event', schemaVersion: 1 }` and that it type-checks as `V1`.
- 2.9: "rejects a schema version other than 1 for an unversioned event" - `// @ts-expect-error` on `event<V1>('ProductItemAdded', d1, 2)`.
- 3.3: "does not export the schema version helper types from the package" - inside an `it(...)` in `messageSchemaVersion.unit.spec.ts`, `// @ts-expect-error` on `type T = import('<package entry src/index.ts>').MessageSchemaVersionOf<V2>`, and the same for `WithSchemaVersionArgument`. The `WithSchemaVersionArgument` half protects existing behaviour.
- extra: "creates an unversioned event with metadata and the optional schema version 1" - `event<V1m>(type, data, metadata, 1)` gives `metadata` and `schemaVersion: 1`.
- extra: "creates an unversioned command with the optional schema version 1" - `command<C1>(type, data, 1)`, `command<C1>(type, data, { now }, 1)` and `command<C1>(type, data, undefined, 1)` give `schemaVersion: 1`, and `metadata` only in the second.
- extra: "creates an unversioned message with the optional schema version 1" - `message<V1>('Event', type, data, 1)`.
- extra: "rejects a schema version other than 1 for unversioned commands, messages and events with metadata" - `// @ts-expect-error` on `command<C1>(type, data, 2)`, `command<C1>(type, data, { now }, 2)`, `message<V1>('Event', type, data, 2)` and `event<V1m>(type, data, metadata, 2)`.
- extra: "treats a type declared with version 1 the same as an unversioned one" - `event<V1x>(type, data, 1)` compiles, `event<V1x>(type, data, 2)` does not.
- extra: the existing "creates an unversioned event without schema version" tests (2.4) stay unchanged and green.
Existing tests this step changes: the `@ts-expect-error` cases listed in Context become accepted calls.
Move `MessageSchemaVersionOf` next to `WithSchemaVersionArgument` in `messageSchemaVersion.ts`, and import it from there in the type tests and in `message.ts`, `event.ts` and `command.ts`.
```

---

## Step 9. Read rule per store

```text
Use the `implement-step` skill.

What to build
MongoDB, EventStoreDB and the in-memory store read the version from the stored value only, and fall back to `1`, never to the metadata. PostgreSQL keeps the metadata fallback. The PostgreSQL read tests for a `TEXT` column run on a 0.43.0-rc.2 store, so they keep working once fresh stores get an `INT` column in step 10.

Context
- `src/packages/emmett/src/eventStore/versioning/schemaVersion.ts`: `isNumericSchemaVersion` accepts `Number.isInteger` numbers and `^[0-9]+$` strings. `resolveSchemaVersion(stored, metadata)` falls back to `metadata.schemaVersion`. It already gives `-1`, `2` for `'02'` and the JSON number `2`, `1` for `1.5`, `'2.0'`, `'-1'`, `' 2'` and `'v2'`, and `99999999999`. `schemaVersion.unit.spec.ts` already tests the fraction (`:20`) and the metadata fallback (`:38`, `:42`).
- Callers that pass the metadata today and must not: `emmett-mongodb/src/eventStore/mongoDBEventStore.ts:324`, `emmett-mongodb/src/eventStore/consumers/messageSource/mongoDBMessageSource.ts:103`, `emmett/src/eventStore/inMemoryEventStore.ts:135`. `emmett-esdb/src/eventStore/eventstoreDBEventStore.ts:403` passes the metadata, whose `schemaVersion` key is the stored value itself.
- PostgreSQL reads (`emmett-postgresql/src/eventStore/schema/readStream.ts:89`, `readMessagesBatch.ts:167`) keep the fallback.
- `emmett-mongodb/src/eventStore/mongoDBEventStore.schemaVersion.e2e.spec.ts:194-247` runs two `it`s (`:197`, `:221`) inside `describe.each(cases_0_43_0_rc_2)`. `cases_0_43_0_rc_2[0]` (lines 130-134), "reads the version from the metadata of a message stored without a version", stores `legacyMetadata: { schemaVersion: '2', ... }` and expects `2`. Spec 6.5 makes this `1`.
- Existing tests that already cover criteria of this step: MongoDB 5.5 at `mongoDBEventStore.schemaVersion.e2e.spec.ts:147`; EventStoreDB 6.8 in `cases_0_43_0_rc_2` at `eventstoreDBEventStore.schemaVersion.int.spec.ts:84-99`; 4.7 in the shared 4.6 feature at `emmett-tests/src/eventStore/features.ts:653`, which asserts the whole recorded command including `metadata`.
- The step 7 PostgreSQL read tests build the store with `createEventStoreSchema({ pool })` (`readStream.int.spec.ts:64`, `readMessagesBatch.int.spec.ts:42`): `readStream.int.spec.ts:174` (6.1), `:221` (6.2), `:255` (6.4), and `readMessagesBatch.int.spec.ts:609` (6.1), `:649` (6.2), `:677` (6.4). The 6.1 and 6.2 tests append through the current API with `metadata.schemaVersion: '2'`, so they never had "a stored message without a stored version".
- Shared features: `testSchemaVersion` in `src/packages/emmett-tests/src/eventStore/features.ts:521`, wired for in-memory, MongoDB and EventStoreDB. PostgreSQL is wired in step 10, SQLite in step 12.

Similar code
- The existing read-rule unit tests in `emmett/src/eventStore/versioning/schemaVersion.unit.spec.ts`.
- The row inserts with SQL in `readStream.int.spec.ts:151` and `:266`.
- The 0.43.0-rc.2 store setup from step 1 (`migrations_0_43_0_rc_2`) in `migrations/0_43_0/0_43_0.migration.int.spec.ts`.

Blocked by
None.

Acceptance criteria
- 4.7 GIVEN MongoDB, EventStoreDB, PostgreSQL or SQLite AND an appended command WHEN it is read THEN the recorded message has `kind: 'Command'` AND `metadata` has no `kind`.
- 5.5 GIVEN MongoDB AND an event appended with `schemaVersion: 2` WHEN the raw stored message is inspected THEN it has a top-level `schemaVersion: 2` as a number.
- 6.1 GIVEN a stored message without a stored version and with `metadata.schemaVersion: '2'` WHEN it is read THEN `schemaVersion` is `2` and `metadata` has no `schemaVersion`. Part: PostgreSQL, moved onto a 0.43.0-rc.2 store.
- 6.2 GIVEN a stored message without a stored version and without `metadata.schemaVersion` WHEN it is read THEN `schemaVersion` is `1`. Part: PostgreSQL, moved onto a 0.43.0-rc.2 store.
- 6.3 GIVEN a stored message without a stored version and with `metadata.schemaVersion: 'v2'` WHEN it is read THEN `schemaVersion` is `1`. Part: PostgreSQL, the gap left by step 7.
- 6.4 GIVEN a PostgreSQL `TEXT` column with a non-numeric value and `metadata.schemaVersion: '3'` WHEN the row is read THEN `schemaVersion` is `3`. Part: moved onto a 0.43.0-rc.2 store.
- 6.5 GIVEN a stored message without a stored version and with `metadata.schemaVersion: '2'` WHEN it is read THEN `schemaVersion` is `1` and `metadata` has no `schemaVersion`.
- 6.6 GIVEN stored messages without a stored version and with `metadata.schemaVersion` `'02'`, `'2.0'`, `'-1'`, `' 2'` and the JSON number `2` WHEN they are read THEN `schemaVersion` is `2`, `1`, `1`, `1` and `2`.
- 6.7 GIVEN a PostgreSQL `TEXT` column holding `'99999999999'` WHEN the row is read THEN `schemaVersion` is `99999999999`.
- 6.8 GIVEN EventStoreDB events written before this release, one without `metadata.schemaVersion`, one with `'2'` and one with `'v2'` WHEN they are read THEN `schemaVersion` is `1`, `2` and `1`, AND `metadata` has no `schemaVersion`.
- 7.2 GIVEN an empty stream in any store WHEN an event with `schemaVersion: -1` or `1.5` is appended THEN the append fails with a `ValidationError` AND the stream has no events. Part: in-memory, MongoDB and EventStoreDB, through the shared features.
- 7.3 GIVEN an empty stream in any store WHEN an event without a top-level `schemaVersion` and with `metadata.schemaVersion: '0'` is appended THEN the append fails with a `ValidationError` AND the stream has no events. Part: in-memory, MongoDB and EventStoreDB, through the shared features.
- 9.3 GIVEN a downcaster typed `(e: V2) => V1 | V2` that returns a V1 for one event and a V2 with `schemaVersion: 2` for another WHEN both are appended and read without an upcaster THEN the recorded events have `schemaVersion: 1` and `2`. Part: in-memory, MongoDB and EventStoreDB, through the shared features.

Tests
- 4.7: protects existing behaviour. The shared 4.6 feature (`features.ts:653`) already asserts the whole recorded command, with `kind: 'Command'` and `metadata` without `kind`, for MongoDB and EventStoreDB. Point to it; do not add a copy.
- 5.5: protects existing behaviour, covered by `mongoDBEventStore.schemaVersion.e2e.spec.ts:147`. Do not add a copy.
- 6.1, 6.2, 6.4: move the six step 7 tests listed in Context onto a 0.43.0-rc.2 store (`migrations_0_43_0_rc_2`, `TEXT` column). Insert the rows with SQL: for 6.1 a non-numeric column value and `metadata.schemaVersion: '2'`; for 6.2 a non-numeric column value and no `metadata.schemaVersion`; for 6.4 `'v2'` in the column and `metadata.schemaVersion: '3'`. Each moved test gets its own database with `sharedPostgreSQLDatabase` and builds it with `migrations_0_43_0_rc_2`, as `0_43_0.migration.int.spec.ts` does, not on the file's shared `createEventStoreSchema` store. Read through `readStream` and `readMessagesBatch`; assert `2`, `1` and `3`, and `metadata` without `schemaVersion`. Keep the test names. They protect existing behaviour.
- 6.3: "reads version 1 when the metadata version is not numeric" - PostgreSQL, same store: insert a row with a non-numeric column value and `metadata.schemaVersion: 'v2'`; read through `readStream` and `readMessagesBatch`; asserts `schemaVersion: 1` and `metadata` without `schemaVersion`. Protects existing behaviour.
- 6.5: MongoDB: rename `cases_0_43_0_rc_2[0]` to "reads version 1 when only the metadata has a version" and change its expected version to `1`; both its `it`s (`readStream` and the consumer) then assert `schemaVersion: 1` and `metadata` without `schemaVersion`. Do not add a separate test. In-memory: "reads version 1 when only the metadata has a version" - append an event with no top-level `schemaVersion` and only `metadata.schemaVersion: '2'` through the public API, then read the stream; asserts `schemaVersion: 1` and `metadata` without `schemaVersion`. The in-memory case protects existing behaviour.
- 6.6: "reads the metadata version by the numeric value rule" - PostgreSQL, same store: insert rows with a non-numeric column value and `metadata.schemaVersion` `'02'`, `'2.0'`, `'-1'`, `' 2'` and the JSON number `2`; asserts `2`, `1`, `1`, `1` and `2`. Add core unit tests for the same values. Both protect existing behaviour.
- 6.7: "reads a too large digits-only column value as that number" - PostgreSQL, same store: insert a row with `'99999999999'` in the column; asserts `schemaVersion: 99999999999`. Protects existing behaviour.
- 6.8: protects existing behaviour, covered by `cases_0_43_0_rc_2` at `eventstoreDBEventStore.schemaVersion.int.spec.ts:84-99`. Do not add a copy.
- 7.1 to 7.3: shared features "Rejects an append with schema version 0", "Rejects an append with schema version -1", "Rejects an append with schema version 1.5" and "Rejects an append with metadata version 0 when the top-level one is missing" (`features.ts`) - each asserts the append rejects with `ValidationError` and the stream has no events; core unit tests of `schemaVersionToAppend` in `schemaVersion.unit.spec.ts`, including "rejects metadata version 0 when the top-level one is missing".
- 9.3: shared feature "Records the schema version of each result of a downcaster that returns either version" - downcaster typed `(e: V2) => V1 | V2` returns a V1 for one event and a V2 with `schemaVersion: 2` for another; asserts `1` and `2`. Protects existing behaviour.
Existing tests this step changes: MongoDB `cases_0_43_0_rc_2[0]` is renamed and expects `1`; the six PostgreSQL tests move to a 0.43.0-rc.2 store.
Make `metadata` an optional parameter of `resolveSchemaVersion`. MongoDB, in-memory and EventStoreDB call it with the stored value only.
```

---

## Step 10. PostgreSQL append functions, fresh `INT` layout, appends through the new function, blue/green

```text
Use the `implement-step` skill.

What to build
After the automatic migrations of the current release, a PostgreSQL store has the new append function, which takes the versions as `int[]`, and the old append function has the converting body. A 0.43.0 instance that appends `'2'` still succeeds. One that appends `'v2'` or `'99999999999'` gets an error, and nothing is stored. Neither function checks the column type.

A new PostgreSQL store gets both functions and has `message_schema_version INT NOT NULL`, placed after `created` and before `is_archived`. A 0.43.0 instance that appends `'2'` to a new store stores `2`. One that appends `'v2'` gets an error.

The current release appends through the new append function with explicit casts on every argument, and passes the version from `schemaVersionToAppend` (Q122). It also writes the version as a string into the stored metadata (`schemaVersion: '2'`), so 0.43.0 readers see it. The copy is written after the user metadata, so it always matches the column. Recorded messages handed to hooks, inline projections and consumers have the top-level number and no `metadata.schemaVersion`; the copy exists only in the stored row. 0.43.0 instances and the current release share one store in both directions.

Context
- `src/packages/emmett-postgresql/src/eventStore/schema/appendToStream.ts:32`: `appendToStreamSQLFor(databaseSchemaName)` builds `emt_append_to_stream(v_message_ids text[], v_messages_data jsonb[], v_messages_metadata jsonb[], v_message_schema_versions text[], v_message_types text[], v_message_kinds text[], v_stream_id text, v_stream_type text, v_expected_stream_position bigint DEFAULT NULL, v_partition text DEFAULT ...)` in `plpgsql`, wrapped in `createFunctionIfDoesNotExistSQL`. The insert at lines 116-122 reads `v_message_schema_versions` through `unnest(...)`.
- Same file: `appendToStream` (line 187) builds `messagesToAppend` as recorded messages behind an `as RecordedMessage[]` cast (lines 211-224, `...e` and user metadata spread last). The same list is stored and handed to `beforeCommitHook` (lines 277-278). `appentToStreamRaw` (line 331) maps versions as `e.metadata.schemaVersion ?? DefaultMessageSchemaVersion`. `callAppendToStream` (line 157) passes untyped parameters to the old function; `CallAppendToStreamParams.schemaVersions` is `string[]` (line 146). `schema/index.ts:27` re-exports this file, so `callAppendToStream` and `appentToStreamRaw` are public.
- `eventStoreSchemaSQL.ts` lists what the initial migration `emt:postgresql:eventstore:initial` creates. On a fresh database it runs after the past sets and creates the functions that do not exist yet.
- `migrations/0_43_0/0_43_0.migration.ts:523`: `migration_0_43_0_enforceStreamExistenceFor(options)` rewrites the old function's body with `CREATE OR REPLACE` only when the function exists, and has a variant for a custom `databaseSchemaName`.
- `migrations/0_43_0/index.ts` exports `migrations_0_43_0`. `migrations/index.ts` `eventStoreSchemaMigrationsFor` returns only `[migration_0_43_0_enforceStreamExistenceFor(options), schemaMigrationFor(options)]` for a custom schema.
- `src/packages/emmett-postgresql/src/eventStore/schema/tables.ts`, `messagesTableSQLFor`: the column is `message_schema_version TEXT NOT NULL` among the text columns. The order is 8-byte columns (`stream_position`, `global_position`, `transaction_id`, `created`), then 1-byte columns (`is_archived`, `message_kind`), then variable-length ones. Reads select `message_schema_version::text` since step 7.
- PostgreSQL stores an `int` into a `TEXT` column through an assignment cast, so an `INSERT ... SELECT v::int` works on both column types. Checked in Docker on PostgreSQL 17 (Q93).
- Released 0.43.0 instances call the old function with untyped parameters. A second function with the same name would make their calls ambiguous.
- `migrations/0_43_0/legacyApi.ts:77` holds a private frozen `callAppendToStream`. `migrations/0_43_0/0_43_0.migration.int.spec.ts:48` imports the current `callAppendToStream` and calls it at `:164` and `:204` with `schemaVersions: ['1']`, including on a `schema_0_42_0` store where the new function does not exist.
- Custom schema: `migrations_0_43_0_rc_2` builds only the default schema (`0_43_0/legacyApi.ts:54-61`). The existing custom-schema setup at `0_43_0.migration.int.spec.ts:131-176` loads the `schema_0_42_0` snapshot and writes rows under `SET LOCAL search_path`. The 0.38.7 legacy append (`0_38_7/legacyApi.ts:22`) calls `emt_append_to_stream` unqualified and writes `'1'` for every event.
- Existing tests this step breaks:
  - `appendToStream.int.spec.ts:462` ("stores the schema version from event metadata") appends with only `metadata.schemaVersion: '2'` and expects the column `['2']`; with the append rule it stores `1`.
  - `appendToStream.int.spec.ts:490` ("stores schema version 1 when event metadata has no schema version") expects `['1', '1']`; on a new store the column holds integers.
  - `readStream.int.spec.ts:305` ("upcasts events based on their schema version") appends its second event with only `metadata: { meta: 'data2', schemaVersion: '2' }` (line 347); its upcaster keeps an event only when `event.schemaVersion === 2` (line 320) and expects `data: { productItem }` for both (line 373). With the append rule the event is stored as `1` and upcast again.
  - `0_43_0.migration.int.spec.ts:164` and `:204`, as above.
  - `migrations/current/migration.int.spec.ts:146` asserts the exact list of migrations for a custom schema, and so do `createEventStoreSchema.int.spec.ts:320` and `:336`.
  - `0_43_0.snapshot.int.spec.ts`, and the `schemaMigration` snapshot in `0_44_0.snapshot.int.spec.ts` ("0.44.0 schema is the latest one").
- Shared features `testSchemaVersion` and `testConsumerSchemaVersion` in `src/packages/emmett-tests/src/eventStore/features.ts`. PostgreSQL wiring: `src/packages/emmett-tests/src/eventStore/postgresql/postgreSQLEventStore.e2e.spec.ts`.

Similar code
- `migration_0_43_0_enforceStreamExistenceFor` and its tests in `migrations/0_43_0/0_43_0.migration.int.spec.ts`.
- `functionExists` in `src/packages/emmett-postgresql/src/testing/schemaObjects.ts`.
- The 0.43.0-rc.2 store setup from step 1, and the `information_schema.columns` and blue/green tests from step 7, in `0_43_0.migration.int.spec.ts`.
- The MongoDB and EventStoreDB wiring of the shared features in `emmett-tests`.
- The EventStoreDB append from step 6, which writes Emmett's fields after the user metadata.

Blocked by
Step 9. Its PostgreSQL read tests must run on a 0.43.0-rc.2 store before the column becomes `INT`.

Acceptance criteria
Through the shared features on a new store:
- 4.1 GIVEN an empty stream WHEN an event with `schemaVersion: 2` is appended and the stream is read THEN the recorded event has `schemaVersion: 2`.
- 4.2 GIVEN an empty stream WHEN events with versions `1`, `2` and `3` are appended in one call THEN each recorded event has its own version, in order.
- 4.3 GIVEN an empty stream WHEN an event without `schemaVersion` is appended THEN the recorded event has `schemaVersion: 1`.
- 4.4 GIVEN an appended event with `schemaVersion: 2` WHEN a consumer receives it THEN the message has `schemaVersion: 2`. Not for in-memory, which has no consumer.
- 4.5 GIVEN an appended event with `schemaVersion: 2` WHEN the stream is aggregated THEN `evolve` receives the event with `schemaVersion: 2`.
- 4.6 GIVEN an appended command with `schemaVersion: 2` WHEN it is read THEN the recorded command has `schemaVersion: 2`.
- 4.7 GIVEN MongoDB, EventStoreDB, PostgreSQL or SQLite AND an appended command WHEN it is read THEN the recorded message has `kind: 'Command'` AND `metadata` has no `kind`. Part: PostgreSQL (Q119).
- 4.9 GIVEN an empty stream WHEN an event without a top-level `schemaVersion` and with `metadata.schemaVersion: '2'` is appended and the stream is read THEN the recorded event has `schemaVersion: 2` AND `metadata` has no `schemaVersion`. All stores except SQLite (step 12) (Q122).
- 4.10 GIVEN an empty stream WHEN an event without a top-level `schemaVersion` and with `metadata.schemaVersion: 'v2'` is appended and the stream is read THEN the recorded event has `schemaVersion: 1`. All stores except SQLite (step 12).
- 4.11 GIVEN an empty stream WHEN an event with `schemaVersion: 3` and `metadata.schemaVersion: '2'` is appended and the stream is read THEN the recorded event has `schemaVersion: 3`. All stores except SQLite (step 12).
- 5.1 GIVEN an event appended with `schemaVersion: 2` and user metadata WHEN it is read THEN `metadata` contains the user metadata and Emmett's recorded fields, and no `schemaVersion`.
- 7.1 GIVEN an empty stream in any store WHEN an event with `schemaVersion: 0` is appended THEN the append fails with a `ValidationError` AND the stream has no events.
- 7.2 GIVEN an empty stream in any store WHEN an event with `schemaVersion: -1` or `1.5` is appended THEN the append fails with a `ValidationError` AND the stream has no events. Part: PostgreSQL.
- 7.3 GIVEN an empty stream in any store WHEN an event without a top-level `schemaVersion` and with `metadata.schemaVersion: '0'` is appended THEN the append fails with a `ValidationError` AND the stream has no events. Part: PostgreSQL.
- 8.1 GIVEN a stored event with `schemaVersion: 1` AND an upcaster that returns `schemaVersion: 2` with the new data WHEN the stream is read THEN the recorded event has `schemaVersion: 2` and the new data.
- 8.2 GIVEN a stored event with `schemaVersion: 1` AND an upcaster that returns only `type` and `data` WHEN the stream is read THEN the recorded event has `schemaVersion: 1` and the new data.
- 8.3 GIVEN a stored event with `schemaVersion: 2` AND an upcaster that returns the event unchanged WHEN the stream is read THEN the recorded event has `schemaVersion: 2`.
- 8.4 GIVEN a consumer with an upcaster that returns `schemaVersion: 2` WHEN it receives a version `1` event THEN the message has `schemaVersion: 2`. Not for in-memory, which has no consumer.
- 9.1 GIVEN an event with `schemaVersion: 2` AND a downcaster that returns `schemaVersion: 1` with the old data WHEN it is appended and read without an upcaster THEN the recorded event has `schemaVersion: 1` and the old data.
- 9.2 GIVEN an event with `schemaVersion: 2` AND a downcaster typed `(e: V2) => V1` that returns only `type` and `data` WHEN it is appended and read without an upcaster THEN the recorded event has `schemaVersion: 1` and the old data.
- 9.3 GIVEN a downcaster typed `(e: V2) => V1 | V2` that returns a V1 for one event and a V2 with `schemaVersion: 2` for another WHEN both are appended and read without an upcaster THEN the recorded events have `schemaVersion: 1` and `2`. Part: PostgreSQL.
- 10.1 GIVEN a command handler whose decide returns an event with `schemaVersion: 2` WHEN the command is handled and the stream is read THEN the recorded event has `schemaVersion: 2`.
- 10.2 GIVEN a command handler with an upcaster that maps version `1` to `2` WHEN existing version `1` events are evolved THEN evolve receives them with `schemaVersion: 2`.
PostgreSQL only:
- 5.2 GIVEN PostgreSQL AND an event appended with `schemaVersion: 2` WHEN the raw stored metadata is inspected THEN it contains `schemaVersion: '2'` as a string.
- 11.1 GIVEN a store upgraded to the current release WHEN the current release appends an event with `schemaVersion: 2` AND the frozen 0.43.0 API reads it THEN the event has `metadata.schemaVersion: '2'`.
- 11.2 GIVEN a store upgraded to the current release WHEN the current release appends an event without `schemaVersion` AND the frozen 0.43.0 API reads it THEN the event has `metadata.schemaVersion: '1'`.
- 12.1 GIVEN a store upgraded to the current release without any on-demand migration WHEN the frozen 0.43.0 API appends an event with `metadata.schemaVersion: '2'` AND the current release reads it THEN the event has `schemaVersion: 2` and no `metadata.schemaVersion`.
- 12.2 GIVEN a store upgraded to the current release without any on-demand migration WHEN the frozen 0.43.0 API appends an event without metadata version AND the current release reads it THEN the event has `schemaVersion: 1`.
- 12.3 GIVEN a store upgraded to the current release WHEN the frozen 0.43.0 API and the current release append to the same stream in turn THEN both appends succeed AND stream positions continue without gaps.
- 14.1 GIVEN a store upgraded to the current release WHEN the current release appends an event with `schemaVersion: 2`, once on a `TEXT` column and once on an `INT` column THEN both appends succeed AND reads return `schemaVersion: 2`. Part: the `TEXT` column. Step 11 covers the `INT` column, which needs the schema version migration.
- 14.2 GIVEN a store upgraded to the current release WHEN the frozen 0.43.0 API appends an event with `metadata.schemaVersion: '2'`, once on a `TEXT` column and once on an `INT` column THEN both appends succeed AND the column holds `'2'` and `2`. Part: the `TEXT` column. Step 11 covers the `INT` column, which needs the schema version migration.
- 14.3 GIVEN a `TEXT` column after the automatic migrations of the current release WHEN the frozen 0.43.0 API appends an event with `metadata.schemaVersion: 'v2'` THEN the append fails with an error AND the stream has no new event.
- 14.4 GIVEN a store upgraded to the current release AND the old append function dropped WHEN the current release appends THEN the append succeeds.
- 14.5 GIVEN a store upgraded to the current release AND another function named `emt_append_to_stream_v_0_43_0` with a different argument list WHEN the current release appends THEN the append succeeds.
- 14.6 GIVEN a `TEXT` column after the automatic migrations of the current release WHEN the frozen 0.43.0 API appends an event with `metadata.schemaVersion: '99999999999'` THEN the append fails with an error AND the stream has no new event.
- 14.7 GIVEN a `TEXT` column after the automatic migrations of the current release WHEN the frozen 0.43.0 API appends an event with `metadata.schemaVersion: '0'` THEN the append fails with an error AND the stream has no new event (Q133).
- 15.3 GIVEN a `TEXT` column after the automatic migrations of the current release WHEN the current release appends an event with `schemaVersion: 3` THEN the column holds `3` AND reads return `schemaVersion: 3`.
- 20.1 GIVEN an empty PostgreSQL database WHEN the event store schema is created THEN `message_schema_version` is `INT` and placed after the 8-byte columns and before the 1-byte columns.
- 20.3 GIVEN a new store WHEN a message with `schemaVersion: 2` is appended THEN the column holds `2`. Part: PostgreSQL.
- 20.4 GIVEN a new PostgreSQL store WHEN the frozen 0.43.0 API appends an event with `metadata.schemaVersion: '2'` and then one with `'v2'` THEN the first append succeeds and the column holds `2` AND the second fails with an error and the stream has no new event.
- 20.5 GIVEN a new PostgreSQL store WHEN the frozen 0.43.0 API appends an event with `metadata.schemaVersion: '0'` THEN the append fails with an error AND the stream has no new event (Q133).
- 24.1 GIVEN an existing PostgreSQL store in a custom schema WHEN the automatic migrations of the current release run THEN both append functions exist in that schema AND appends and reads behave as in 14.1, 14.2 and 15.1 to 15.3.

Tests
- Shared features wired in the PostgreSQL e2e spec: each shared criterion above as in `features.ts`.
- 5.2: "stores the version as a string in the raw metadata" - select `message_metadata` directly; asserts `schemaVersion: '2'`.
- 7.1 to 7.3: shared features "Rejects an append with schema version 0", "Rejects an append with schema version -1", "Rejects an append with schema version 1.5" and "Rejects an append with metadata version 0 when the top-level one is missing" (`features.ts`) - each asserts the append rejects with `ValidationError` and the stream has no events; core unit tests of `schemaVersionToAppend` in `schemaVersion.unit.spec.ts`, including "rejects metadata version 0 when the top-level one is missing".
- 11.1, 11.2: "0.43.0-rc.2 reads metadata schema versions of events 0.43.0 appended, after migrating from 0.43.0-rc.2" - frozen read after current appends with `2` and without a version; asserts `metadata.schemaVersion` `'2'` and `'1'`.
- 12.1, 12.2: "0.43.0 reads schema versions of events 0.43.0-rc.2 appended, after migrating from 0.43.0-rc.2" - frozen append with and without `'2'`; asserts `schemaVersion` `2` and `1`, and no `metadata.schemaVersion`.
- 12.3: "0.43.0-rc.2 and 0.43.0 append to one stream in turn, after migrating from 0.43.0-rc.2" - four alternating appends; asserts all succeed and stream positions are `1` to `4`.
- 14.2 (TEXT): "0.43.0-rc.2 appends metadata schemaVersion '2' to the TEXT column, after migrating from 0.43.0-rc.2" - 0.43.0-rc.2 store, current automatic migrations, frozen 0.43.0 append with `metadata.schemaVersion: '2'`; asserts success and the column holds `'2'`.
- 14.3: "0.43.0-rc.2 append fails for metadata schemaVersion 'v2', after migrating from 0.43.0-rc.2" - same store, frozen append with `'v2'`; asserts the append rejects with an error and the frozen read returns no new event.
- 14.4: "0.43.0 appends after emt_append_to_stream is dropped, after migrating from 0.43.0-rc.2" - `DROP FUNCTION emt_append_to_stream(text[], jsonb[], jsonb[], text[], text[], text[], text, text, bigint, text)`, then append; asserts success.
- 14.5: "0.43.0 appends when an emt_append_to_stream_v_0_43_0 with text[] versions also exists, after migrating from 0.43.0-rc.2" - create `emt_append_to_stream_v_0_43_0(text[], jsonb[], jsonb[], text[], text[], text[], text, text, bigint, text) RETURNS void` (`text[]` in the versions position) in the same schema, then append; asserts success and the read.
- 14.6: "0.43.0-rc.2 append fails for a metadata schemaVersion too large for INT, after migrating from 0.43.0-rc.2" - same store as 14.3, `'99999999999'`; asserts the same.
- 14.7: "0.43.0-rc.2 append fails for metadata schemaVersion '0', after migrating from 0.43.0-rc.2" - same store as 14.3, `'0'`; asserts the same.
- 14.1 (TEXT) and 15.3: "0.43.0 stores version 3 in the TEXT column and in metadata, after migrating from 0.43.0-rc.2" - asserts the column holds `'3'`, the stored metadata holds `'3'`, and the read returns `3`.
- 20.1 and 17.1 side by side: "a fresh 0.43.0 store gets an INT schema version column after created and before is_archived", "a store migrated from 0.43.0-rc.2 keeps the TEXT schema version column" and "a store migrated from 0.42.0 keeps the TEXT schema version column" - next to each other in `0_43_0.migration.int.spec.ts`; the first runs the automatic migrations on an empty database and asserts `data_type` `integer` with `created` right before and `is_archived` right after the column (`information_schema.columns` ordered by `ordinal_position`); `createEventStoreSchema.int.spec.ts` has no copy, and its custom-schema test asserts `emt_append_to_stream_v_0_43_0` exists (Q136), the other two build the store from the version lists (`migrations_0_43_0_rc_2`, or the 0.42.0 sets), run the automatic migrations and assert `text` (Q123).
- 20.3: "stores the appended schema version in the column" - asserts the column holds `2`.
- 20.4: "0.43.0-rc.2 appends metadata schemaVersion '2' as INT and fails for 'v2' on a store 0.43.0 created" - `createEventStoreSchema`, frozen 0.43.0 append with `'2'`, then with `'v2'`; asserts the first succeeds and the column holds `2` (an integer), and the second rejects with an error and the stream has no new event.
- 20.5: "0.43.0-rc.2 append fails for metadata schemaVersion '0' on a store 0.43.0 created" - `createEventStoreSchema`, frozen 0.43.0 append with `'0'`; asserts the append rejects with an error and the stream has no new event.
- 24.1: "the 0.43.0 automatic migrations add both append functions to a custom schema with 0.42.0 and 0.43.0-rc.2 events" - `functionExists` for both functions in a custom `databaseSchemaName`; then the 14.1 (TEXT), 14.2 (TEXT) and 15.1 to 15.3 scenarios in that schema. Load the `schema_0_42_0` snapshot into the schema and write 0.42.x rows with the 0.38.7 legacy append under `SET LOCAL search_path`, as `0_43_0.migration.int.spec.ts:131-176` does. Insert the 0.43.0 rows (`'2'` in the column and in `metadata.schemaVersion`) with SQL, since no released 0.43.0 API builds a custom schema.
- extra: "the before-commit hook receives the top-level version" - a `beforeCommitHook` collects the messages of one append with three events: one with `schemaVersion: 2`, one without `schemaVersion`, and one without a top-level version and with user `metadata.schemaVersion: '2'`; asserts the whole messages, with `schemaVersion` `2`, `1` and `2`, and `metadata` without `schemaVersion` in all three.
- extra: "inline projections and the onBeforeCommit hook receive the appended messages with their top-level schema version" - in `postgreSQLEventStore.e2e.spec.ts`, next to "should allow events to be processed in the onBeforeCommit hook"; an event store with an inline projection that collects its events and a `hooks.onBeforeCommit` that collects its messages; append the same three events, then read the stream; asserts both collections deep-equal the events read back, `schemaVersion` `[2, 1, 2]`, and no `metadata.schemaVersion` (Q129).
- extra: "the stored metadata copy matches the column when user metadata has a version" - append with top-level `schemaVersion: 3` and user `metadata.schemaVersion: '2'`; asserts the raw metadata has `schemaVersion: '3'`, the column holds `3`, and the read returns `3`.
- extra: "running the 0.43.0 automatic migrations twice after migrating from 0.43.0-rc.2 applies nothing and keeps both append functions" - second run succeeds, applies nothing, both functions still exist.
- Update the existing tests listed in Context: `appendToStream.int.spec.ts:462` appends with top-level `schemaVersion: 2` and asserts the column `[2]`; `:490` asserts `[1, 1]`; `readStream.int.spec.ts:305` appends its second event with top-level `schemaVersion: 2` and keeps its expected data; export the frozen `callAppendToStream` from `0_43_0/legacyApi.ts` and import it in `0_43_0.migration.int.spec.ts` for the calls at `:164` and `:204`; add the new migration to the custom-schema lists in `migrations/current/migration.int.spec.ts:146` and `createEventStoreSchema.int.spec.ts:320` and `:336`.
- 4.9 to 4.11: shared features "takes the metadata version when the top-level one is missing", "falls back to version 1 for a non-numeric metadata version" and "keeps the top-level version over the metadata one"; each asserts the whole recorded event. The append rule goes into core code next to `resolveSchemaVersion`, and the in-memory, MongoDB, EventStoreDB and PostgreSQL appends call it. Remove the in-memory 6.5 test "reads version 1 when only the metadata has a version" from step 9: it appends through the public API, so 4.9 now gives `2`, and spec 6.5 no longer covers in-memory. Check that the MongoDB `cases_0_43_0_rc_2` and the 6.x PostgreSQL tests insert their rows directly and so stay as they are; if one appends through the current API, stop and report it.
- 4.7: the shared 4.6 feature, which asserts the whole recorded command. `readStream.ts` and `readMessagesBatch.ts` select `message_kind` and map `'C'` to `'Command'` and anything else to `'Event'`, instead of the hard-coded `'Event'`.
Build both functions for the current schema from one body builder that takes the function name and the SQL type of the versions array. The migration holds its own SQL text inline, as the released migrations do (`0_43_0.migration.ts` at HEAD writes out `emt_append_to_stream` itself); it does not call the builder, so a later change to the current schema cannot change its hash (Q121). For `text[]`, raise an exception when any value does not match `^0*[1-9][0-9]*$` (so `0` fails too, Q133; the migration's inline SQL uses the same check), then insert `v::int`. For `int[]`, insert the values as they are. Add `migration_0_43_0_addNumericSchemaVersionAppendFor(options)` (name `emt:postgresql:eventstore:0.43.0:add-numeric-schema-version-append`) that creates the new function and replaces the old body, only when the old function exists. Append it to `migrations_0_43_0` and to the custom-schema list after the stream existence migration. Add the new function to `eventStoreSchemaSQL`. Change the column in `messagesTableSQLFor`. `callAppendToStream` calls the new function with `::text[]`, `::jsonb[]`, `::jsonb[]`, `::int[]`, `::text[]`, `::text[]`, `::text`, `::text`, `::bigint`, `::text`, and `CallAppendToStreamParams.schemaVersions` becomes `number[]` (Q118). Remove the `DefaultMessageSchemaVersion` import if nothing else uses it. Update `0_43_0.snapshot.int.spec.ts` and the `schemaMigration` snapshot in `0_44_0.snapshot.int.spec.ts` and review the diff: only the new migration, the new function and the column appear. If an existing test appends a non-numeric `metadata.schemaVersion` through the current API, stop and report it.
```

---

## Step 11. On-demand schema version migration and the prepared 0.44.0 migration

```text
Use the `implement-step` skill.

What to build
Users can call `migrateSchemaToNumericMessageSchemaVersion(options)` to change `message_schema_version` to `INT` in place, with values from `COALESCE(<user CASE>, <numeric column>, <numeric metadata>, 1)`. It is not part of the automatic migrations. It runs through Dumbo's regular migration run, in one transaction, and checks itself whether it has to run. It does not touch the append functions.

The PostgreSQL 0.44.0 set gets the same migration as its mandatory migration, taking the user `CASE` from `messageSchemaVersionMapping` in its migration options. The old append function stays. The 0.44.0 set stays out of the automatic list.

Context
- `src/packages/emmett-postgresql/src/eventStore/consumers/rebuildPostgreSQLProjections.ts`: the shape to follow, an exported function with one options object including the connection options (`PostgreSQLEventStoreConsumerConnectionOptions`).
- `eventStore/schema/index.ts` `createEventStoreSchema` runs `runSQLMigrations(pool, migrations, { ...options, migrationTable })` inside `pool.withTransaction`, and handles `dryRun`.
- Dumbo 0.13.0-rc.2 `MigratorOptions`: `dryRun`, `migrationTimeoutMS` (applied as `statement_timeout`, which also counts lock waits), `lock`, `transactionOptions`. `sqlMigration(name, sqls, { ignoreHashMismatch })`. With `ignoreHashMismatch`, a changed hash is skipped with a warning.
- `eventStoreDatabaseSchema.ts`: `EventStoreDatabaseSchemaOptions` and `eventStoreDatabaseSchema(options)` (`migrationTable`, table names).
- The messages table is partitioned by list on `partition`. `ALTER TABLE` on the parent changes every partition.
- `src/packages/emmett-postgresql/src/eventStore/schema/migrations/0_44_0/`: `migration_0_44_0_cleanupObsoleteCheckpointCompat` and `migrations_0_44_0`. `0_44_0.migration.int.spec.ts` runs the set with `runSQLMigrations` and asserts `applied` equals `migrations_0_44_0`. `0_44_0.snapshot.int.spec.ts` snapshots it. Both change in this step.

Similar code
- `rebuildPostgreSQLProjections` and its package export.
- `migration_0_44_0_cleanupObsoleteCheckpointCompat` and its tests, which call `runSQLMigrations` directly.

Blocked by
Step 10. 16.1 and 16.8 need rows appended by the current release.

Acceptance criteria
- 13.1 GIVEN a store after the schema version migration WHEN the frozen 0.43.0 API appends an event with `metadata.schemaVersion: '2'` THEN the append succeeds AND the column holds `2` AND the current release reads it with `schemaVersion: 2`.
- 13.2 GIVEN a store after the schema version migration WHEN the frozen 0.43.0 API appends an event with `metadata.schemaVersion: 'v2'` THEN the append fails with an error AND the stream has no new event.
- 13.3 GIVEN events appended by the current release with versions `1` and `2` AND then the schema version migration WHEN the frozen 0.43.0 API reads the stream THEN the events have `metadata.schemaVersion` `'1'` and `'2'`.
- 14.1 GIVEN a store upgraded to the current release WHEN the current release appends an event with `schemaVersion: 2`, once on a `TEXT` column and once on an `INT` column THEN both appends succeed AND reads return `schemaVersion: 2`. Part: the `INT` column. Step 10 covers the `TEXT` column.
- 14.2 GIVEN a store upgraded to the current release WHEN the frozen 0.43.0 API appends an event with `metadata.schemaVersion: '2'`, once on a `TEXT` column and once on an `INT` column THEN both appends succeed AND the column holds `'2'` and `2`. Part: the `INT` column. Step 10 covers the `TEXT` column.
- 16.1 GIVEN a store with 0.42.x junk rows, 0.43.0 rows with versions `1` and `2`, and rows appended by the current release with version `3` WHEN the migration runs without a user `CASE` THEN the column is `INT` AND the rows hold `1`, `1`, `2` and `3` respectively.
- 16.2 GIVEN a row with `'v2'` in the column and in metadata WHEN the migration runs with a `CASE` that maps `'v2'` to `2` THEN the row holds `2`.
- 16.3 GIVEN a row with `'2'` in the column WHEN the migration runs with a `CASE` that maps that row's message type to `5` THEN the row holds `5`, because the user `CASE` runs first.
- 16.4 GIVEN a row that the user `CASE` does not match WHEN the migration runs THEN the row gets the default value (numeric column, then numeric metadata, then `1`).
- 16.5 GIVEN a user `CASE` that uses `message_type` and the metadata JSON WHEN the migration runs THEN the `CASE` can read those columns.
- 16.6 GIVEN a store with several partitions WHEN the migration runs THEN every partition has an `INT` column with converted values.
- 16.7 GIVEN the migration has run WHEN the column position is inspected THEN it is unchanged.
- 16.8 GIVEN the rows from 16.1 after the migration WHEN the streams are read and consumed THEN the messages have versions `1`, `1`, `2` and `3` with unchanged data and metadata AND a new append with `schemaVersion: 4` reads back with `4`.
- 16.9 GIVEN the store is already migrated WHEN the migration runs again THEN it succeeds without changing data.
- 16.10 GIVEN a store with no rows WHEN the migration runs THEN the column becomes `INT`.
- 16.11 GIVEN the migration is called with the dry run option WHEN it finishes THEN the column is still `TEXT` and no data changed.
- 16.12 GIVEN the migration is called with a migration timeout AND another transaction holds a lock on the messages table longer than that WHEN the timeout passes THEN the migration fails AND the column and data are unchanged.
- 16.13 GIVEN a store migrated with a user `CASE` WHEN the migration runs again with a different `CASE` THEN it succeeds AND the column and data are unchanged.
- 16.15 GIVEN a row with `'99999999999'` in the column WHEN the migration runs without a user `CASE` THEN it fails with an error AND the column is still `TEXT` with unchanged data, AND WHEN it runs with a `CASE` that maps that row to `2` THEN the row holds `2`.
- 17.1 GIVEN an existing store with a `TEXT` column WHEN the automatic migrations of the current release run THEN the new append function exists AND the column is still `TEXT` AND Dumbo's migrations table has no entry for the schema version migration or the mandatory migration, AND WHEN the schema version migration is called after that THEN the column is `INT`.
- 23.1 GIVEN a store with a `TEXT` column and the rows from 16.1 WHEN the mandatory migration is run directly THEN the column is `INT` with the same values as in 16.1.
- 23.2 GIVEN the mandatory migration AND migration options with a user `CASE` WHEN it runs THEN values follow the same rules as 16.2 to 16.5.
- 23.3 GIVEN a store already migrated by the on-demand schema version migration WHEN the mandatory migration runs THEN it succeeds without changing data.
- 23.4 GIVEN a store after the mandatory migration WHEN the frozen 0.43.0 API appends an event with `metadata.schemaVersion: '2'` and reads the stream THEN the append succeeds AND the column holds `2` AND the read returns the event with `metadata.schemaVersion: '2'`.
- 23.5 GIVEN a store after the mandatory migration with a user `CASE` WHEN it runs again with a different `CASE` THEN it succeeds AND the column and data are unchanged.
- 24.3 GIVEN a PostgreSQL store in a custom schema WHEN the schema version migration runs with that `databaseSchemaName` THEN the messages table in that schema is migrated as in 16.1.
- 24.4 GIVEN a PostgreSQL store in a custom schema WHEN the mandatory migration is run directly with that `databaseSchemaName` THEN it behaves as in 23.1 and 23.4.

Tests
Build the 16.1 store this way: a 0.42.x store with rows from the 0.38.7 legacy append (it writes `'1'` for every row), the 0.43.0 sets from `migrations_0_43_0_rc_2` with frozen 0.43.0 appends of `'1'` and `'2'`, then the automatic migrations of the current release and a current append with `schemaVersion: 3`. Custom-schema stores use the setup of step 10's 24.1 test: the `schema_0_42_0` snapshot, 0.42.x rows from the 0.38.7 legacy append under `SET LOCAL search_path`, and 0.43.0 rows inserted with SQL.
- 16.1: "converts every row to an INT version without a user CASE" - asserts `data_type` `integer` and the four values `1`, `1`, `2`, `3`.
- 16.2: "a user CASE maps a non-numeric version" - row with `'v2'` in the column and metadata, `CASE WHEN message_schema_version = 'v2' THEN 2 END`; asserts the row holds `2`.
- 16.3: "the user CASE wins over a numeric column value" - row with `'2'`, `CASE WHEN message_type = 'X' THEN 5 END`; asserts `5`.
- 16.4: "rows the user CASE does not match get the default value" - the 16.1 rows plus the 16.3 `CASE`, which matches none of them; asserts `1`, `1`, `2`, `3`.
- 16.5: "a user CASE can read the message type and the metadata" - `CASE WHEN message_type = 'Y' AND message_metadata->>'tenant' = 'a' THEN 7 END` on a row of type `Y` with metadata `tenant: 'a'`, and a row of type `Y` with `tenant: 'b'`; asserts `7` and the default value.
- 16.6: "converts every partition" - rows in two partitions; asserts both hold integers.
- 16.7: "keeps the column position" - `ordinal_position` before and after.
- 16.8: "reads, consumes and appends after the migration" - `readStream`, `readMessagesBatch`, then an append with `4`; asserts every field of each message.
- 16.9: "a second run changes nothing" - asserts data and type unchanged.
- 16.10: "converts an empty store" - asserts `integer`.
- 16.11: "a dry run changes nothing" - `dryRun: true`; asserts `text` and unchanged data.
- 16.12: "fails on the timeout while another transaction holds a lock" - a second pool opens a transaction with `LOCK TABLE <messages> IN ACCESS SHARE MODE` and keeps it open; the migration runs with `migrationTimeoutMS: 10`; asserts it rejects with Dumbo's `QueryCanceledError`, not just any error (Q126), then the second pool rolls back; asserts `text` and unchanged data.
- 16.13: "a rerun with a different user CASE succeeds and changes nothing" - first run maps type `X` to `5`, second maps it to `7`; asserts success and the row still holds `5`.
- 16.15: "fails on a value too large for INT and succeeds once a user CASE maps it" - asserts the first call rejects with the column still `text`, then the call with the `CASE` gives `2`.
- 13.1: "a 0.43.0-rc.2 append of a numeric version succeeds after the migration", run for both the schema version migration and the mandatory migration - frozen append with `'2'`; asserts success, the column holds `2`, and the current read returns `schemaVersion: 2` with no `metadata.schemaVersion`.
- 13.2: "a 0.43.0-rc.2 append of a non-numeric version fails after the migration", run for both migrations - frozen append with `'v2'`; asserts rejection and the frozen read returns no new event.
- 13.3: "0.43.0-rc.2 reads versions written before the migration" - current appends with `1` and `2`, then the migration, then the frozen read; asserts `metadata.schemaVersion` `'1'` and `'2'`.
- 14.1 (INT), 14.2 (INT): "0.43.0 and 0.43.0-rc.2 append to an INT column after the migration" - the 16.1 store after the schema version migration, current append with `schemaVersion: 2`, then frozen append with `'2'`; asserts the column is `integer`, `readStream` returns both events with `schemaVersion: 2`, and the column holds `2`.
- 17.1: "a store migrated from 0.43.0-rc.2 keeps the TEXT column until the migration runs" (Q123) - 0.43.0-rc.2 store, automatic migrations; asserts `functionExists` for the new function, `data_type` `text`, and that Dumbo's default migrations table (`dmb_migrations`; `eventStoreDatabaseSchema(options).migrationTable` passes a name only when the user sets one) has no row named `emt:postgresql:eventstore:0.43.0:numeric-message-schema-version` or `emt:postgresql:eventstore:0.44.0:numeric-message-schema-version`; then calls `migrateSchemaToNumericMessageSchemaVersion` and asserts `integer`.
- 23.1: the mandatory migration run of "converts every row to an INT version without a user CASE" (16.1) - the 16.1 rows, set run directly; asserts `integer` and the values.
- 23.2: the mandatory migration runs of the 16.2 to 16.5 tests - the same rows and `CASE`s through `messageSchemaVersionMapping`; asserts the same values.
- 23.3: "the mandatory migration changes nothing after the schema version migration" - `migrateSchemaToNumericMessageSchemaVersion`, then the 0.44.0 set run directly; asserts the mandatory migration is in `applied`, so its own check ran, and that the data is unchanged.
- 23.4: the mandatory migration run of "a 0.43.0-rc.2 append of a numeric version succeeds after the migration" (13.1) - frozen append with `'2'`; asserts the column holds `2`, the current read and the frozen read, which has `metadata.schemaVersion: '2'`.
- 23.5: the mandatory migration run of "a rerun with a different user CASE succeeds and changes nothing" (16.13).
- 24.3, 24.4: "migrates a store in a custom database schema", run for both migrations - the 16.1 rows in a custom `databaseSchemaName`; asserts `integer`, the values, and an append and read in that schema.
- The 16.x, 23.x and 24.3/24.4 tests that both migrations share run once per migration, inside `describe('schema version migration')` and `describe('mandatory migration')` in `migrateSchemaToNumericMessageSchemaVersion.int.spec.ts`.
- extra: "opens its own pool from a driver and a connection string" - the migration called with a driver and a connection string instead of a pool; asserts the column is `integer`.
- extra: "a diff dry run reports the migration and changes nothing" - `dryRun: 'diff'`; asserts the migration is reported and the column is still `text` with unchanged data.
- extra: "reads a whole JSON number in metadata by the number rule" - a row with a non-numeric column and metadata `schemaVersion: -1` as a JSON number converts to `1` (Q120).
- extra: "fails on a metadata version too large for INT and succeeds once a user CASE maps it" - a row with a non-numeric column and metadata `schemaVersion: '99999999999'`; as in 16.15 (Q109, Q125).
- Update `0_44_0.migration.int.spec.ts` and the 0.44.0 snapshot for the new set entry, and review the diff.
The on-demand migration is one `sqlMigration` named `emt:postgresql:eventstore:0.43.0:numeric-message-schema-version` with `ignoreHashMismatch: true`, built by an internal `numericMessageSchemaVersionMigrationFor(name, options)` that is not exported from the package entry. Its SQL is a `DO` block that runs the `ALTER TABLE ... ALTER COLUMN message_schema_version TYPE INT USING COALESCE(...)` only when the column is not `integer`. Numeric column: `CASE WHEN message_schema_version ~ '^[0-9]+$' THEN message_schema_version::int END`. Numeric metadata: a JSON number that is a whole number of 0 or more is taken as it is (Q120), a JSON string by `^[0-9]+$`. When no user `CASE` is given, `COALESCE` starts with the numeric column. Export `migrateSchemaToNumericMessageSchemaVersion` from the package entry like `rebuildPostgreSQLProjections`. Do not add it to any automatic list. Export `migration_0_44_0_numericMessageSchemaVersionFor(options)` and a default constant from the 0.44.0 folder, both built by the same builder with the name `emt:postgresql:eventstore:0.44.0:numeric-message-schema-version`, the same SQL and `ignoreHashMismatch: true` (Q118). Add the constant to `migrations_0_44_0` after the checkpoint cleanup, with the comment `// Double-check before the 0.44.0 release.`
```

---

## Step 12. SQLite column swap, append and read

```text
Use the `implement-step` skill.

What to build
The SQLite column swap runs with the automatic migrations of the current release: the messages table gets `message_schema_version INTEGER NOT NULL DEFAULT 1` as its last column, after `created`, and each row gets its numeric `metadata.schemaVersion`, or `1`. The old column value is never used, and the stored metadata JSON is left unchanged. Fresh stores get the same layout: on a fresh database the 0.43.0 migrations run before the `CREATE TABLE` of `tables.ts`, so the swap shapes them too, and `tables.ts` declares the swapped layout (Q130).

SQLite appends write the version from `schemaVersionToAppend` (Q122) into the column and no `schemaVersion` into the stored metadata. Messages handed to hooks and inline projections have the recorded shape: the version from `schemaVersionToAppend` and no `metadata.schemaVersion`. Reads take the version from the column only and remove `schemaVersion` from `metadata`.

Context
- `src/packages/emmett-sqlite/src/eventStore/schema/tables.ts`, `messagesTableSQLFor`: `message_schema_version TEXT NOT NULL` between `message_metadata` and `message_type`. `global_position INTEGER PRIMARY KEY`.
- `migrations/index.ts`: `pastEventStoreSchemaMigrations` (0.42.0 and 0.43.0 sets) run before `schemaMigration`, also on a fresh database. For a custom `databaseSchemaName`, `eventStoreSchemaMigrationsFor` returns only `[schemaMigrationFor(options)]`.
- `migrations/0_43_0/0_43_0.migration.ts` has `migration_0_43_0_FixStreamPartition`; `migrations/0_43_0/index.ts` exports `migrations_0_43_0`.
- 0.42.x rows hold the stream's expected version in the column; 0.43.0 rows hold `metadata.schemaVersion ?? '1'`. SQLite has no conditional statements. SQLite's `ALTER TABLE` cannot change a column type; it supports `ADD COLUMN`, `DROP COLUMN` (SQLite 3.35 or later) and `RENAME COLUMN`. `ADD COLUMN` puts the column after the last column and before the table constraints, and SQLite rewrites the stored `CREATE TABLE` text to match (checked on SQLite 3.52, Q130). `createEventStoreSchema` runs the migrations inside `pool.withTransaction` (`eventStore/schema/index.ts:87`).
- `src/packages/emmett-sqlite/src/eventStore/schema/appendToStream.ts` writes `message.metadata.schemaVersion ?? DefaultMessageSchemaVersion` into the column. It stores no `schemaVersion` in metadata for a top-level version (lines 82-94). `readStream.ts` and `readMessagesBatch.ts` build metadata with `schemaVersion: DefaultMessageSchemaVersion` and ignore the column.
- `appendToStream.ts:73-96` builds `messagesToAppend` from `...m` with the user metadata, and passes them to `onBeforeCommit` at `:127-131`. `SQLiteEventStore.ts:444-463` runs inline projections and the hook with them.
- Driver variants sqlite3, d1 and durableObject. Tests live under `src/packages/emmett-sqlite/src/storage/{sqlite3,d1,durableObject}/eventStore/...`.
- Step 1's frozen SQLite 0.43.0 API and `migrations_0_43_0_rc_2`. The SQLite 0.42.0 legacy append (`0_42_0/legacyApi.ts:7`) has no `databaseSchemaName`.
- Existing tests this step breaks: `storage/sqlite3/eventStore/schema/appendToStream.int.spec.ts:423` ("stores the schema version from event metadata") and `:444` ("stores schema version 1 when event metadata has no schema version") assert `['2']` and `['1', '1']`; the `schemaVersion` cases in `readStream.int.spec.ts` and `readMessagesBatch.int.spec.ts`, including `readStream.int.spec.ts:155` ("upcasts events based on their schema version"), which switches on `event.metadata.schemaVersion` (line 172) and appends its second event with only `metadata: { meta: 'data2', schemaVersion: '2' }` (line 202); the exact migration lists in the sqlite3 and durableObject `current/migration.int.spec.ts:140` and the d1 `current/migration.int.spec.ts:145`; the exact custom-schema lists in `storage/{sqlite3,d1,durableObject}/eventStore/schema/createEventStoreSchema.int.spec.ts` (sqlite3 lines 137, 163, 172, 179; d1 lines 159, 183, 191, 198; durableObject lines 145, 171, 180, 187); the SQLite 0.43.0 snapshots. The d1 and durableObject copies of these tests, where they exist.
- SQLite wiring in emmett-tests: `src/packages/emmett-tests/src/eventStore/sqlite/sqliteEventStore.e2e.spec.ts`.

Similar code
- `migration_0_43_0_FixStreamPartition` and its tests in `storage/sqlite3/eventStore/schema/migrations/0_43_0/0_43_0.migration.int.spec.ts`.
- The PostgreSQL wiring of the shared features from step 10.

Blocked by
Steps 9 and 10. The shared features for 7.1 to 7.3 come from the core append rule (plan intro), 9.3 from step 9; 4.9 to 4.11 and the hook test come from step 10.

Acceptance criteria
- 19.1 GIVEN a 0.42.x store whose column holds stream versions `0`, `1` and `2` WHEN the automatic migration runs THEN the column is `INTEGER` AND all three rows hold `1`.
- 19.2 GIVEN a 0.43.0 store with a row whose metadata has `schemaVersion: '2'` WHEN the automatic migration runs THEN the row holds `2`.
- 19.3 GIVEN a row whose metadata has `schemaVersion: 'v2'` WHEN the automatic migration runs THEN the row holds `1`.
- 19.4 GIVEN a store with N messages WHEN the automatic migration finishes THEN the table has N messages with all other column values unchanged, including the stored metadata JSON, AND appends continue the existing global positions.
- 19.5 GIVEN a migrated row whose stored metadata still has `schemaVersion: '2'` WHEN it is read THEN `schemaVersion` is `2` AND `metadata` has no `schemaVersion`.
- 19.6 GIVEN a migrated row whose column holds `3` and whose stored metadata has `schemaVersion: '2'` WHEN it is read THEN `schemaVersion` is `3`, because SQLite reads the column only.
- 19.7 GIVEN the automatic migration has run WHEN it runs again THEN nothing changes.
- 20.2 GIVEN an empty SQLite database WHEN the event store schema is created THEN `message_schema_version` is `INTEGER NOT NULL DEFAULT 1` and placed after `created`.
- 20.3 GIVEN a new store WHEN a message with `schemaVersion: 2` is appended THEN the column holds `2`. Part: SQLite.
- 24.2 GIVEN an existing SQLite store in a custom schema WHEN the automatic migrations of the current release run THEN the column is `INTEGER` with values as in 19.1 to 19.3.
- 5.3 GIVEN SQLite or MongoDB AND an event appended with `schemaVersion: 2` WHEN the raw stored metadata is inspected THEN it has no `schemaVersion`. For MongoDB this protects existing behaviour, and 5.5 covers its storage.
Through the shared features: 4.1 to 4.7, 4.9 to 4.11 (for 4.7 the SQLite `readStream.ts` and `readMessagesBatch.ts` map `message_kind` `'C'` to `'Command'` instead of the hard-coded `'Event'`, Q119), 5.1, 7.1 to 7.3, 8.1 to 8.4, 9.1 to 9.3, 10.1, 10.2, as listed in step 10.

Tests
- Shared features wired in the SQLite e2e spec.
- 19.1: "a 0.42.0 store gets version 1 for every row" - 0.42.0 snapshot and legacy append with stream versions `0`, `1`, `2`; asserts `INTEGER` through `PRAGMA table_info` and three `1`s. Rename the existing test from "a 0.42.x store gets version 1 for every row".
- 19.2, 19.3: "a 0.43.0-rc.2 row gets its numeric metadata version, or 1" - frozen 0.43.0-rc.2 append with `'2'` and `'v2'`; asserts `2` and `1`.
- 19.4: "the column swap keeps every message unchanged" - N = 10 messages over two streams in two partitions, one archived; asserts every other column and the metadata JSON unchanged, and the next append's `global_position` follows.
- 19.5: "reads a migrated row with a metadata version" - asserts `2` and `metadata` without `schemaVersion`.
- 19.6: "reads the column only" - after the column swap, `UPDATE` the column to `3`; asserts `3`.
- 19.7: "a second run changes nothing" - after the first `createEventStoreSchema`, `UPDATE` one row's column to `3`, then call `createEventStoreSchema` again; asserts the second run applies no migration, and the layout and every row, including the `3`, are unchanged. The swap SQL is not safe to run twice on its own; Dumbo's record of applied migrations keeps it from running again, as for every other SQLite migration (Q131).
- 20.2: in `0_43_0.migration.int.spec.ts` (sqlite3), "a 0.42.0 store gets version 1 for every row" and "a 0.43.0-rc.2 row gets its numeric metadata version, or 1" assert the column after the migration: `PRAGMA table_info` type `INTEGER`, `notnull` `1`, `dflt_value` `'1'`, and the column right after `created`. Fresh stores run the same column swap (Q130), so `createEventStoreSchema` has no copy in sqlite3, d1 or durableObject (Q136).
- 20.3: "stores the appended schema version in the column" - asserts the column holds `2`.
- 24.2: 19.1 to 19.3 in a custom schema. Insert the 0.42.x and 0.43.0-rc.2 rows with SQL, since no legacy API takes a `databaseSchemaName`. Row labels, if any, name 0.43.0-rc.2, not 0.43.0 (Q129).
- 5.3: "stores no schema version in the raw metadata" - select `message_metadata` directly. Protects existing behaviour for SQLite; for MongoDB it stays as the step 5 test.
- extra: "takes a whole JSON number in metadata as it is" - rows inserted on a 0.43.0-rc.2 store and then migrated, with metadata `schemaVersion` as the number `3`, the number `1.5`, the number `-1`, the number `0`, `'02'`, `''`, `' 2'` and `'2.0'`; asserts `3`, `1`, `1`, `0`, `2`, `1`, `1` and `1` (Q130, Q131).
- extra: digits-only metadata text too large for an `INT` is cast by SQLite's own `CAST` to `INTEGER`, with no range check and no test of its own (Q129).
- extra: "reads the kind of a stored command" in both `readStream.int.spec.ts` and `readMessagesBatch.int.spec.ts` - a row with `message_kind` `'C'` reads as `kind: 'Command'`; asserts the whole message.
- extra: "the before-commit hook receives the top-level version" - the step 10 hook test for SQLite: one append with three events, one with `schemaVersion: 2`, one without `schemaVersion`, and one without a top-level version and with user `metadata.schemaVersion: '2'`; asserts the whole messages, with `schemaVersion` `2`, `1` and `2`, and `metadata` without `schemaVersion` in all three.
- extra: "inline projections and the onBeforeCommit hook receive the appended messages with their top-level schema version" - in `storage/sqlite3/eventStore/SQLiteEventStore.e2e.spec.ts`, following "should pass the stream positions of the appended events to inline projections"; an event store with an inline projection that collects its events and a `hooks.onBeforeCommit` that collects its messages; append the same three events, then read the stream; asserts both collections deep-equal the events read back, `schemaVersion` `[2, 1, 2]`, and no `metadata.schemaVersion` (Q129). It guards the event store code that passes the appended messages to inline projections, which the `appendToStream` test does not run.
- Update `appendToStream.int.spec.ts:423` to append with top-level `schemaVersion: 2` and assert `[2]`, and `:444` to assert `[1, 1]`; update the `schemaVersion` cases in `readStream.int.spec.ts` and `readMessagesBatch.int.spec.ts` the same way; rewrite `readStream.int.spec.ts:155` to append its second event with top-level `schemaVersion: 2` and to switch on the top-level `schemaVersion`, keeping its expected data; add the new migration to the sqlite3 and durableObject `current/migration.int.spec.ts:140` and the d1 `current/migration.int.spec.ts:145` lists, and to the custom-schema `applied` and migrations-table assertions in the three `createEventStoreSchema.int.spec.ts` files; update the d1 and durableObject copies where they exist.
Add `migration_0_43_0_numericMessageSchemaVersionFor(options)` (name `emt:sqlite:eventstore:0.43.0:numeric-message-schema-version`), a column swap with its own SQL text: create the old-layout table `IF NOT EXISTS` (a no-op on an existing store, so the swap also runs on a fresh database), `ALTER TABLE ... ADD COLUMN message_schema_version_int INTEGER NOT NULL DEFAULT 1`, `UPDATE` it with the version from `json_type`/`json_extract` (`integer` taken when it is `0` or more, `text` matching only digits cast to `INTEGER`, else `1`), `DROP COLUMN message_schema_version`, then `RENAME COLUMN message_schema_version_int TO message_schema_version`. No table rebuild, so `global_position`, the `UNIQUE` constraint and its index stay as they are. In `tables.ts`, `messagesTableSQLFor` declares `message_schema_version INTEGER NOT NULL DEFAULT 1` after `created` and before the `UNIQUE` constraint, so fresh, migrated and custom-schema stores have one layout (Q130). Append it to `migrations_0_43_0` and the custom-schema list before `schemaMigrationFor(options)`. Update the SQLite 0.43.0 snapshots and review the diff.
```

---

## Step 13. Recorded message types and docs

```text
Use the `implement-step` skill.

What to build
Recorded messages always carry `schemaVersion: number`, and `metadata.schemaVersion` is no longer part of Emmett's metadata type. This breaks code that reads `metadata.schemaVersion`; after steps 4 to 13 no Emmett code does. The command handler versioning docs show the new API with tested snippets. The projection version behaves as before. The full suite passes.

Context
- `src/packages/emmett/src/typing/message.ts`: `RecordedMessage<MessageType, MetaData>` is `CombineMetadata<...> & { kind: ... }`. `CommonRecordedMessageMetadata` has `schemaVersion?: string`. `DefaultMessageSchemaVersion = '1'`.
- The frozen 0.43.0 APIs read `e.metadata.schemaVersion ?? '1'` through the current type: PostgreSQL `migrations/0_43_0/legacyApi.ts:272` and SQLite `migrations/0_43_0/legacyApi.ts:305`. Their read builders set `const metadata: ReadEventMetadataWithGlobalPosition = { schemaVersion: '1', ... }` (PostgreSQL `legacyApi.ts:341`, SQLite `legacyApi.ts:382`). All four stop compiling when the type changes.
- The versioning section of the command handling guide under `src/docs`. Its snippets come from `src/packages/emmett/src/commandHandling/handleCommand.versioning.unit.spec.ts` and `handleCommandWithDecider.versioning.unit.spec.ts` through snippet regions.
- The projection definition version is a `number` in the API and an integer in storage.

Similar code
- The type research `type-surface-research/findings.md` and `2-mechanical-fixes.diff`, which list the compile errors and their fixes.
- The existing snippet regions in the two versioning tests.

Blocked by
Steps 9, 10 and 12.

Acceptance criteria
- 3.1 GIVEN any recorded message type WHEN its `schemaVersion` is accessed THEN its type is `number`, not optional.
- 3.2 GIVEN recorded message metadata types WHEN `metadata.schemaVersion` is accessed THEN it is not part of the Emmett metadata type.
- 21.1 GIVEN a projection definition with `version: 2` WHEN it is registered THEN it is stored as the integer `2`, as today. This protects existing behaviour.
- 22.1 GIVEN the command handler versioning section WHEN it is read THEN it shows versioned message types with the version type parameter, events created as object literals with `schemaVersion`, and an upcaster switching on `schemaVersion`, all backed by tested snippets, AND it says that the optional factories take the version as their last argument and take a single message type, because a union of versions as the type argument does not require the version (Q135).

Tests
- 3.1: "recorded messages have a numeric schema version" - `expectTypeOf<RecordedMessage<Event>['schemaVersion']>().toEqualTypeOf<number>()`, `<V2>` gives `2`, `<V1>` gives `1`.
- 3.2: "recorded message metadata has no schema version" - `expectTypeOf<CommonRecordedMessageMetadata>().not.toHaveProperty('schemaVersion')`.
- 21.1: find the existing test that registers a PostgreSQL or SQLite projection with a version and asserts the stored version; if none exists, add one asserting the stored integer `2`. Protects existing behaviour.
- 22.1: the two versioning unit tests declare V1 and V2 with the fourth type parameter, create events as object literals with `schemaVersion: 2` (not the `event()` helper, which is optional), and upcast with a `switch` on `schemaVersion`; the snippet regions show them. The prose says what `schemaVersion` is, that a result without it is version 1, and, for the optional factories, that they take the version as their last argument and a single message type.
Add `schemaVersion: number` next to `kind` in `RecordedMessage`, remove it from `CommonRecordedMessageMetadata`, set `DefaultMessageSchemaVersion = 1` and use it for the literal `1` defaults where the code imports from `@event-driven-io/emmett`. Fix the compile errors in packages, samples and tests without casts that hide the type: fixtures get `schemaVersion: 1`, builders take `event.schemaVersion ?? DefaultMessageSchemaVersion`. The frozen 0.43.0 APIs get their own local metadata type with `schemaVersion?: string`, used both where they read `e.metadata.schemaVersion ?? '1'` and in their read builders, so their behaviour stays unchanged. If a fix needs a behaviour change, stop and ask.
Run `npm run docs:build` and `npm test`. If `npm test` is interrupted, ask before running it again.
```
