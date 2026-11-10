# Plan: numeric message schema version

Source: `spec.md` in this folder. Decisions and their reasons: `qa.md`.

## How the work is ordered

The order follows "make the change easy, make the easy change". Every step ends green, wires its code into the product, and can be merged on its own.

1. Test support first. Freeze the 0.43.0 PostgreSQL and SQLite APIs, so later steps can write data the way deployed 0.43.0 instances do.
2. Core types and helpers. They only add things and change no behaviour.
3. The read rule, upcast and downcast, proven end to end on the in-memory store with new shared feature tests.
4. MongoDB and EventStoreDB. They have no blue/green concerns, so each one is a small step that reuses the shared features.
5. PostgreSQL in safe slices: reads first, then the two append functions, then the fresh layout, then each on-demand migration, then the prepared 0.44.0 migrations.
6. SQLite: the rebuild first, then the column-only reads.
7. The breaking type change for recorded messages, after every store returns the number.
8. Docs and the final check.

## Terms used in every prompt

- **Numeric value.** A JavaScript integer, or a string made only of the digits `0` to `9`. Everything else (`'"1"'`, `'v2'`, `'2.0'`, `'two'`, `null`, missing) is non-numeric. In SQL, a text value is numeric when it matches `'^[0-9]+$'`.
- **Read rule.** On PostgreSQL, MongoDB, EventStoreDB and in-memory, the version is the stored value if numeric, else `metadata.schemaVersion` if numeric, else `1`. SQLite reads the column only. Every read removes `schemaVersion` from `metadata`.
- **Append rule.** Every store persists the top-level `schemaVersion`, or `1` when it is missing. There is no validation.
- **Frozen 0.43.0 API.** A copy of today's PostgreSQL and SQLite append and read code, kept under the 0.43.0 migrations folder, so tests can act as a deployed 0.43.0 instance.
- **Released 0.43.0 store.** A database built with the migrations that shipped in 0.43.0, before this work added new ones.

## Rules for every prompt

Each prompt below repeats the short form of these rules. The full form is in `AGENTS.md`.

- Work test-first. Write the failing test, run it, see it fail for the expected reason, make it pass, then refactor.
- Name tests after behaviour that users can see. Assert every field of a recorded message, including `schemaVersion` and the full `metadata`.
- Write type-level criteria as Vitest `expectTypeOf` checks inside normal `it(...)` tests in the regular `*.unit.spec.ts` files, as `packages/emmett/src/errors/errors.unit.spec.ts` and `eventStore/expectedVersion.unit.spec.ts` do. `npm run build:ts` checks them. Use `// @ts-expect-error` only for calls that must not compile, as `postgresProjection.documentId.unit.spec.ts` does. Do not add separate type test files, configs or scripts.
- Copy the scenarios that the other drivers already have before you invent new ones.
- Do not add code comments, except the two "double-check before 0.44.0" comments that step 14 requires.
- Do not monkey-patch. Do not add abstractions that the step does not ask for.
- Run commands from `src`. Run the smallest relevant test files while you work. Before you finish, run `npm run agent:check` and `npm run test:unit`, and report what you ran and the results.
- Do not commit or change Git history.

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
1. PostgreSQL: in `migrations/0_43_0/legacyApi.ts`, keep the existing re-exports. Add frozen copies of today's `appendToStream` (from `appendToStream.ts`, including `callAppendToStream` and `appentToStreamRaw`; the copy calls `emt_append_to_stream` with `text[]` versions taken from `metadata.schemaVersion ?? '1'`) and of today's `readStream` (from `readStream.ts`). Export them under names that do not clash with the current API, for example `appendToStream_0_43_0` and `readStream_0_43_0`, and keep the existing `appendToStream` export pointing where it points today. The copies must not import from the current `appendToStream.ts` or `readStream.ts`, so later edits there cannot change them. Shared constants such as table names may still be imported.
2. PostgreSQL: in the same file, export `releasedMigrations_0_43_0`: the list that `migrations/0_43_0/index.ts` exports today, copied as its own array of the same migration objects. Later steps append new migrations to `migrations_0_43_0`, and tests use the released list to build a released 0.43.0 store.
3. SQLite: create `migrations/0_43_0/legacyApi.ts` with a frozen copy of today's append (it writes `message.metadata.schemaVersion ?? '1'` into `message_schema_version`) and today's `readStream`. Follow the shape of `migrations/0_42_0/legacyApi.ts`. Also export `releasedMigrations_0_43_0`, the same way as for PostgreSQL.

Tests
- PostgreSQL: in `migrations/0_43_0/0_43_0.migration.int.spec.ts`, add a test. It builds a released 0.43.0 store with the 0.36.0, 0.38.7 and 0.42.0 migrations plus `releasedMigrations_0_43_0`, the same way `0_44_0.migration.int.spec.ts` does. It appends an event with `metadata.schemaVersion: '2'` through the frozen append, reads it back through the frozen read, and asserts the whole event, including `metadata.schemaVersion: '2'`.
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
`DefaultMessageSchemaVersion` is still the string `'1'` in `typing/message.ts`. Do not change it here. Step 17 changes it.

Terms
Numeric value: a JavaScript integer, or a string made only of the digits 0–9. Everything else is non-numeric.
Read rule: the stored value if numeric, else `metadata.schemaVersion` if numeric, else `1`. Every read removes `schemaVersion` from `metadata`.
Append rule: persist the top-level `schemaVersion`, or `1` when missing. No validation.

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
7.1 GIVEN an event with `schemaVersion: 0` WHEN it is appended THEN no Emmett validation error is raised.
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
Read rule: the stored value if numeric, else `metadata.schemaVersion` if numeric, else `1`. Remove `schemaVersion` from `metadata` on read. Append rule: store the top-level `schemaVersion` or `1`, with no validation.

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
Step 4 added `resolveSchemaVersion` and `withoutSchemaVersion` in `@event-driven-io/emmett`. Step 1 added the frozen 0.43.0 API and `releasedMigrations_0_43_0` in `migrations/0_43_0/legacyApi.ts`. The 0.42.x legacy append that writes `'1'` is in `migrations/0_38_7/legacyApi.ts`.

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

## Step 8. PostgreSQL append function `emt_append_to_stream_v_0_43_0`

Why: the new function and the converting old body ship through an automatic migration. Steps 9 and 10 put them to use.

```text
Context
Emmett repo. Read `AGENTS.md` first and follow it.
PostgreSQL schema code: `src/packages/emmett-postgresql/src/eventStore/schema/`.
- `appendToStream.ts` defines `appendToStreamSQLFor(databaseSchemaName)`. It is a `CREATE OR REPLACE FUNCTION emt_append_to_stream(v_message_ids text[], v_messages_data jsonb[], v_messages_metadata jsonb[], v_message_schema_versions text[], v_message_types text[], v_message_kinds text[], v_stream_id text, v_stream_type text, v_expected_stream_position bigint DEFAULT NULL, v_partition text DEFAULT ...)`, wrapped in `createFunctionIfDoesNotExistSQL`, which creates the function only when no function with that name exists in the schema.
- `eventStoreSchemaSQL.ts` lists everything that the initial migration `emt:postgresql:eventstore:initial` creates. That migration runs after the past migrations and has `ignoreHashMismatch: true`.
- `migrations/0_43_0/0_43_0.migration.ts` has the 0.43.0 migrations. `migration_0_43_0_enforceStreamExistenceFor(options)` shows how a migration rewrites the existing `emt_append_to_stream` body with `CREATE OR REPLACE` only when the function exists, and how it gets a variant for a custom `databaseSchemaName`.
- `migrations/0_43_0/index.ts` exports `migrations_0_43_0`. `migrations/index.ts` builds `eventStoreSchemaMigrationsFor(options)`. For a custom `databaseSchemaName` it returns only `[migration_0_43_0_enforceStreamExistenceFor(options), schemaMigrationFor(options)]`.
- 0.43.0 instances call `emt_append_to_stream` with untyped parameters. A second function with the same name would make their calls ambiguous, so the new function has its own name.

Goal
One automatic migration in the 0.43.0 set:
- adds `emt_append_to_stream_v_0_43_0`, the same signature and logic as `emt_append_to_stream` except `v_message_schema_versions int[]`;
- rewrites the `emt_append_to_stream` body so it converts the `text[]` values to the column type: unchanged on a `TEXT` column; on an `INT` column, numeric strings (`'^[0-9]+$'`) become integers and everything else becomes `1`.
Both functions insert into a column of either type. Fresh stores get both functions from the initial schema.

Acceptance criteria
14.2 (TEXT part) GIVEN a store upgraded to the current release WHEN the frozen 0.43.0 API appends THEN the call goes to `emt_append_to_stream` AND succeeds on a `TEXT` column.
14.3 GIVEN a `TEXT` column WHEN `emt_append_to_stream` gets `'v2'` THEN the column holds `'v2'` AND the current read returns it through the fallback.
24.1 (function part) GIVEN an existing store in a custom schema WHEN the automatic migrations run THEN both append functions exist in that schema.
Plus: a direct call of `emt_append_to_stream_v_0_43_0` with explicit casts succeeds on a `TEXT` column and stores the number as text.

Do this
1. In `appendToStream.ts`, keep one body for both functions, built by one function that takes the function name and the SQL type of the versions array (`text[]` or `int[]`). Inside the body, detect the column type once per call from the catalog (for example `SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = <messages table regclass> AND attname = 'message_schema_version'`), and insert either the value as given or the converted value. On a `TEXT` column, an `int` value inserts as text through PostgreSQL's assignment cast. On an `INT` column, a `text` value needs the explicit conversion above. Export `appendToStreamV0_43_0SQLFor(databaseSchemaName)` for the new function, wrapped in `createFunctionIfDoesNotExistSQL('emt_append_to_stream_v_0_43_0', ...)`, and add it to `eventStoreSchemaSQL` after `appendToStreamSQLFor`.
2. In `0_43_0.migration.ts`, add `migration_0_43_0_addNumericSchemaVersionAppendFor(options)` with the migration name `emt:postgresql:eventstore:0.43.0:add-numeric-schema-version-append`. It creates `emt_append_to_stream_v_0_43_0` and rewrites `emt_append_to_stream` with `CREATE OR REPLACE`, both only when `emt_append_to_stream` already exists (as in `enforceStreamExistence`). On a fresh database the initial schema creates both later. Export the default-schema constant too.
3. Append the constant to `migrations_0_43_0`. Add the `For(options)` variant to the custom-schema list in `eventStoreSchemaMigrationsFor`, after the stream existence migration.
4. `0_43_0.snapshot.int.spec.ts` snapshots `migrations_0_43_0` and `schemaMigration`. They change because the spec adds this migration to the 0.43.0 set. Update the snapshots and review the diff: the only changes are the new migration and the new function in the initial schema.
5. Do not change `callAppendToStream` yet. Step 9 switches the caller.

Tests
In `migrations/0_43_0/0_43_0.migration.int.spec.ts`: build a released 0.43.0 store, run the current automatic migrations, then cover 14.2 (TEXT), 14.3, and the direct call of the new function with explicit casts (`$1::text[]`, `$2::jsonb[]`, ..., `$4::int[]`). Check that both functions exist with the existing `functionExists` helper from `src/packages/emmett-postgresql/src/testing/schemaObjects.ts`, for the default schema and for a custom `databaseSchemaName` (24.1, function part).

Done when
The new tests pass, the reviewed snapshot updates are in place, and `npm run agent:check` and `npm run test:unit` pass.
```

---

## Step 9. PostgreSQL appends through the new function, metadata copy, blue/green

```text
Context
Emmett repo. Read `AGENTS.md` first and follow it.
Step 8 added `emt_append_to_stream_v_0_43_0` (versions as `int[]`) and made `emt_append_to_stream` convert values to fit the column. Step 7 made reads apply the read rule. Step 1 froze the 0.43.0 API in `migrations/0_43_0/legacyApi.ts`.
`src/packages/emmett-postgresql/src/eventStore/schema/appendToStream.ts`:
- `appendToStream` builds `messagesToAppend` as recorded messages. The same objects go to `beforeCommitHook` and inline projections.
- `appentToStreamRaw` maps versions as `e.metadata.schemaVersion ?? DefaultMessageSchemaVersion` and calls `callAppendToStream`.
- `callAppendToStream` passes untyped parameters to `emt_append_to_stream`.
Shared features: `testSchemaVersion` and `testConsumerSchemaVersion` in `src/packages/emmett-tests/src/eventStore/features.ts`. PostgreSQL wiring: `src/packages/emmett-tests/src/eventStore/postgresql/postgreSQLEventStore.e2e.spec.ts`.

Goal
New code calls `emt_append_to_stream_v_0_43_0` with explicit casts on every argument, and passes the top-level `schemaVersion ?? 1`. It also writes the version as a string into the stored metadata (`schemaVersion: '2'`), so 0.43.0 readers see it. The recorded messages handed to hooks and projections have the top-level number and no `metadata.schemaVersion`.

Acceptance criteria
4.1–4.6, 5.1, 7.1, 8.1–8.4, 9.1, 9.2, 10.1, 10.2 through the shared features.
5.2 GIVEN an event appended with `schemaVersion: 2` WHEN the raw stored metadata is inspected THEN it contains `schemaVersion: '2'` as a string.
11.1 GIVEN a store upgraded to the current release WHEN the new version appends an event with `schemaVersion: 2` AND the frozen 0.43.0 API reads it THEN the event has `metadata.schemaVersion: '2'`.
11.2 Same, appended without `schemaVersion`: the frozen read shows `metadata.schemaVersion: '1'`.
12.1 GIVEN a store upgraded to the current release without any on-demand migration WHEN the frozen 0.43.0 API appends with `metadata.schemaVersion: '2'` AND the new version reads THEN `schemaVersion` is 2 and there is no `metadata.schemaVersion`.
12.2 Same without a metadata version: `schemaVersion` is 1.
12.3 GIVEN a store upgraded to the current release WHEN the frozen 0.43.0 API and the new version append to the same stream in turn THEN both succeed AND stream positions continue without gaps.
14.1 (TEXT part) GIVEN a store upgraded to the current release WHEN the new version appends THEN the call goes to `emt_append_to_stream_v_0_43_0` AND succeeds on a `TEXT` column.
15.3 GIVEN a `TEXT` column after the automatic migrations WHEN the new version appends with `schemaVersion: 3` THEN the column holds `3` AND reads return `schemaVersion: 3`.
24.1 GIVEN an existing store in a custom schema WHEN the automatic migrations run THEN appends and reads behave as in 14 and 15.

Do this
1. `callAppendToStream` calls `emt_append_to_stream_v_0_43_0` with explicit casts on every argument (`::text[]`, `::jsonb[]`, `::jsonb[]`, `::int[]`, `::text[]`, `::text[]`, `::text`, `::text`, `::bigint`, `::text`). `schemaVersions` becomes `number[]`.
2. `appentToStreamRaw` passes `e.schemaVersion ?? 1` and writes the stored metadata as `{ ...metadataWithoutSchemaVersionAndMessageId, schemaVersion: String(e.schemaVersion ?? 1) }`.
3. In `appendToStream`, build `messagesToAppend` with `schemaVersion: e.schemaVersion ?? 1` at the top level and metadata without `schemaVersion`.
4. Remove the `DefaultMessageSchemaVersion` import if nothing else uses it.
   The `messagesToAppend` builder sits behind an `as RecordedMessage[]` cast, so `tsc` does not report a missing `schemaVersion` there. The tests must cover it.
5. Wire `testSchemaVersion` and `testConsumerSchemaVersion` in the PostgreSQL e2e spec in emmett-tests.

Tests
- `appendToStream.int.spec.ts`: update the existing `schemaVersion` cases, and add 5.2 (select `message_metadata` and `message_schema_version` directly) and 15.3.
- `migrations/0_43_0/0_43_0.migration.int.spec.ts`: blue/green 11.1, 11.2, 12.1–12.3 and 14.1 on a released 0.43.0 store after the current automatic migrations. Run 24.1 in a custom schema with the same scenarios.

Done when
The new and updated tests pass, the shared features pass on PostgreSQL, and `npm run agent:check` and `npm run test:unit` pass.
```

---

## Step 10. PostgreSQL fresh layout with an `INT` column

```text
Context
Emmett repo. Read `AGENTS.md` first and follow it.
`src/packages/emmett-postgresql/src/eventStore/schema/tables.ts`, `messagesTableSQLFor`: the messages table declares `message_schema_version TEXT NOT NULL` among the text columns. The column order is aligned: 8-byte columns first (`stream_position`, `global_position`, `transaction_id`, `created`), then 1-byte columns (`is_archived`, `message_kind`), then variable-length ones.
After steps 7–9, reads cast the column to text and both append functions handle `INT`.

Goal
Fresh stores get `message_schema_version INT NOT NULL`, placed after `created` and before `is_archived`.

Acceptance criteria
20.1 GIVEN an empty PostgreSQL database WHEN the event store schema is created THEN `message_schema_version` is `INT` AND placed after the 8-byte columns and before the 1-byte columns.
20.3 GIVEN a new store WHEN a message with `schemaVersion: 2` is appended THEN the column holds `2`.
14.1 (INT part) GIVEN a store with an `INT` column WHEN the new version appends THEN the call goes to `emt_append_to_stream_v_0_43_0` AND succeeds.
14.2 (INT part) GIVEN a store with an `INT` column WHEN the frozen 0.43.0 API appends THEN the call goes to `emt_append_to_stream` AND succeeds, numeric strings are stored as numbers, and non-numeric values as `1`.

Do this
1. Move the column in `messagesTableSQLFor` and change its type.
2. Update the snapshot of `schemaMigration` and review the diff: the only change is this column.

Tests
- `createEventStoreSchema` or schema tests: assert the type and ordinal position through `information_schema.columns` (20.1), for the default and a custom schema.
- `appendToStream.int.spec.ts`: 20.3 and 14.1 on a fresh store.
- `migrations/0_43_0/0_43_0.migration.int.spec.ts` or a fresh-store test: 14.2 with the frozen 0.43.0 append on a fresh store, with `'2'` and `'v2'`.

Done when
The new tests pass, the shared features still pass on PostgreSQL, and `npm run agent:check` and `npm run test:unit` pass.
```

---

## Step 11. On-demand `migrateSchemaToNumericMessageSchemaVersion`

```text
Context
Emmett repo. Read `AGENTS.md` first and follow it.
PostgreSQL package: `src/packages/emmett-postgresql/src/`.
- `eventStore/consumers/rebuildPostgreSQLProjections.ts` is the shape to follow: an exported function with one options object that includes the connection options (`PostgreSQLEventStoreConsumerConnectionOptions`: `driver`, `connectionString`, `pool` or connection).
- `eventStore/schema/index.ts`, `createEventStoreSchema`, shows how migrations run with `runSQLMigrations(pool, migrations, { ...options, migrationTable, execute })` and how `dryRun` is handled.
- Dumbo `MigratorOptions` has `dryRun`, `migrationTimeoutMS`, `lock`, `transactionOptions` and `ignoreMigrationHashMismatch`.
- `eventStore/schema/eventStoreDatabaseSchema.ts` has `EventStoreDatabaseSchemaOptions` (`databaseSchemaName`) and `eventStoreDatabaseSchema(options)`, which returns `migrationTable` and related values.
- The messages table is partitioned by list on `partition`.

Goal
An exported function `migrateSchemaToNumericMessageSchemaVersion(options)`. Users call it. It is not part of the automatic migration list. It runs one `sqlMigration` that alters `message_schema_version` to `INT` in place on the partitioned parent:
`ALTER TABLE <messages> ALTER COLUMN message_schema_version TYPE INT USING COALESCE(<messageSchemaVersionMapping>, <numeric column value>, <numeric metadata.schemaVersion>, 1)`.
- numeric column value: `CASE WHEN message_schema_version ~ '^[0-9]+$' THEN message_schema_version::int END`
- numeric metadata: `CASE WHEN message_metadata->>'schemaVersion' ~ '^[0-9]+$' THEN (message_metadata->>'schemaVersion')::int END`
- `messageSchemaVersionMapping` is an optional Dumbo `SQL` fragment from the options, concatenated as the first `COALESCE` argument. It is evaluated per row and can use any column. When it is not given, it is left out.
The `ALTER` takes an `ACCESS EXCLUSIVE` lock, and the column keeps its position.

Options
`PostgreSQLEventStoreConsumerConnectionOptions`-style connection options, `EventStoreDatabaseSchemaOptions`, `messageSchemaVersionMapping?: SQL`, and `dryRun`, `migrationTimeoutMS`, `lock` and `transactionOptions` from Dumbo `MigratorOptions`. It returns `Promise<RunSQLMigrationsResult>`.

Idempotency
The SQL runs inside a `DO` block that does nothing when the column is already `integer`. The migration is registered with `ignoreHashMismatch: true`, so a later run with a different mapping does not fail on the hash. Step 14 reuses this migration as the 0.44.0 mandatory one.

Acceptance criteria
16.1 GIVEN a store with 0.42.x junk rows, 0.43.0 rows with versions 1 and 2, and rows appended by the current release with version 3 WHEN the migration runs without a mapping THEN the column is `INT` AND the rows hold 1, 1, 2 and 3.
16.2 GIVEN a row with `'v2'` in the column and in metadata WHEN the migration runs with a mapping that maps `'v2'` to 2 THEN the row holds 2.
16.3 GIVEN a row with `'2'` in the column WHEN the migration runs with a mapping that maps that row's message type to 5 THEN the row holds 5.
16.4 GIVEN a row that the mapping does not match WHEN the migration runs THEN the row gets the default (numeric column, then numeric metadata, then 1).
16.5 GIVEN a mapping that uses `message_type` and the metadata JSON WHEN the migration runs THEN the mapping can read those columns.
16.6 GIVEN several partitions WHEN the migration runs THEN every partition has an `INT` column with converted values.
16.7 GIVEN the migration has run WHEN the column position is inspected THEN it is unchanged.
16.8 GIVEN the migration has run WHEN the store is read and appended to THEN all streams and consumers return the same messages and versions as before, AND new appends work.
16.9 GIVEN the store is already migrated WHEN the migration runs again THEN it succeeds without changing data.
16.10 GIVEN a store with no rows WHEN the migration runs THEN the column becomes `INT`.
16.11 GIVEN the dry run option WHEN it finishes THEN the column is still `TEXT` and no data changed.
16.12 GIVEN a migration timeout AND another transaction holding a lock on the messages table longer than that WHEN the timeout passes THEN the migration fails AND the column and data are unchanged.
17.1 GIVEN an existing store WHEN the automatic migrations of the current release run THEN this migration does not run.
13.1 GIVEN a store after this migration WHEN the frozen 0.43.0 API appends with `metadata.schemaVersion: '2'` THEN it succeeds AND the column holds 2 AND the new version reads `schemaVersion: 2`.
13.2 Same with `'v2'`: the append succeeds AND the column holds 1.
13.3 GIVEN a store after this migration WHEN the frozen 0.43.0 API reads a stream THEN it returns all events with their `metadata.schemaVersion`.
24.3 (this migration) GIVEN a store in a custom schema WHEN the migration runs with that `databaseSchemaName` THEN the messages table in that schema is migrated as in 16.1.

Do this
1. Add the migration SQL builder and the exported function in a new file under `src/packages/emmett-postgresql/src/eventStore/schema/migrations/` (for example `onDemand/migrateSchemaToNumericMessageSchemaVersion.ts`), and export it from the package entry the same way `rebuildPostgreSQLProjections` is exported.
2. Name the migration `emt:postgresql:eventstore:0.43.0:numeric-message-schema-version`. Export the migration builder (`numericMessageSchemaVersionMigrationFor(options)`) so step 14 can reuse it.
3. Do not add it to `migrations_0_43_0` or to any automatic list.

Tests
Add `migrateSchemaToNumericMessageSchemaVersion.int.spec.ts` next to the new file. Build stores with the legacy APIs: 0.42.x rows through the 0.38.7 legacy append, 0.43.0 rows through the frozen 0.43.0 append on a released 0.43.0 store, then the current automatic migrations and current appends. Cover every criterion above. Use a second connection that holds `LOCK TABLE ... IN ACCESS SHARE MODE` inside an open transaction for 16.12. Use `information_schema.columns` for type and position checks.

Done when
All criteria pass, and `npm run agent:check` and `npm run test:unit` pass.
```

---

## Step 12. On-demand `migrateToOptimisedPostgreSQLStorageLayout`

```text
Context
Emmett repo. Read `AGENTS.md` first and follow it.
Step 11 added `migrateSchemaToNumericMessageSchemaVersion` and its options type. Step 10 made fresh stores use the aligned layout, `messagesTableSQLFor` in `src/packages/emmett-postgresql/src/eventStore/schema/tables.ts`. Partitions are created by the functions in `addTablePartitionsFor` and `addPartitionSQLFor` in the same file. Read them so the rebuilt table gets the same partition names and bounds as a fresh store. Global positions come from the sequence `emt_global_message_position`, which is not owned by the table.

Goal
An exported function `migrateToOptimisedPostgreSQLStorageLayout(options)`, with the same options and result type as step 11. Users call it. It is not part of any automatic list. It rebuilds the messages table into the fresh-install layout in one transaction:
1. `LOCK TABLE <messages> IN EXCLUSIVE MODE` (reads allowed, writes blocked).
2. Create the new partitioned table under a temporary name, in the current layout, with the same partitions as the old one.
3. Copy all rows. When the old column is `TEXT`, compute the version with the same `COALESCE(<messageSchemaVersionMapping>, <numeric column>, <numeric metadata>, 1)` as step 11. When it is already `INT`, copy the values as they are.
4. Create the primary key and indexes.
5. Switch the names under a brief `ACCESS EXCLUSIVE` lock, so the table, partitions, primary key and indexes have the names of a fresh store. Restore the `global_position` default on the sequence, then drop the old table.
Running it on a store that already has the fresh layout does nothing.

Acceptance criteria
18.1 GIVEN an existing store with a `TEXT` column WHEN the migration runs THEN the messages table has the same columns, column order, column types, primary key, indexes, partitions and `global_position` default as a fresh store of the current release.
18.2 GIVEN the rows from 16.1 WHEN it runs without a mapping THEN the rows hold the same values as in 16.1.
18.3 GIVEN a `TEXT` column WHEN it runs with a mapping THEN values follow 16.2–16.5.
18.4 GIVEN a store already migrated by `migrateSchemaToNumericMessageSchemaVersion` WHEN it runs THEN the existing `INT` values are kept.
18.7 GIVEN N messages WHEN it finishes THEN the new table has N messages with the same stream ids, positions, global positions, transaction ids, data, metadata, types, kinds, ids, archive flags and created timestamps.
18.8 GIVEN it fails part way WHEN the transaction rolls back THEN the original table and data are unchanged.
18.9 GIVEN it has run WHEN a new message is appended THEN its `global_position` continues the existing sequence.
18.10 GIVEN the dry run or migration timeout option THEN it behaves as in 16.11 and 16.12.
13.4 GIVEN a store after this migration WHEN the frozen 0.43.0 API appends and reads THEN the results are as in 13.1–13.3.
17.1 GIVEN an existing store WHEN the automatic migrations run THEN this migration does not run.
24.3 (this migration) GIVEN a store in a custom schema WHEN it runs with that `databaseSchemaName` THEN the messages table in that schema is migrated as in 18.1.

Do this
1. Add the function next to step 11's file and export it the same way. Name the migration `emt:postgresql:eventstore:0.43.0:optimised-storage-layout`, with `ignoreHashMismatch: true`.
2. Reuse step 11's `COALESCE` builder. Do not copy it.

Tests
Add `migrateToOptimisedPostgreSQLStorageLayout.int.spec.ts`. For 18.1, compare `information_schema.columns`, `pg_indexes`, `pg_constraint`, `pg_inherits` and the column default of the migrated store with a fresh store created by `createEventStoreSchema`. For 18.8, make the copy fail with a mapping that raises an error for one row (for example `CASE WHEN message_type = 'Boom' THEN (1/0) END`), then assert the old table and data are unchanged.

Done when
All criteria pass, and `npm run agent:check` and `npm run test:unit` pass.
```

---

## Step 13. Tetris concurrency

```text
Context
Emmett repo. Read `AGENTS.md` first and follow it.
Step 12 added `migrateToOptimisedPostgreSQLStorageLayout` in the PostgreSQL package. It holds an `EXCLUSIVE` lock on the messages table during the copy and a brief `ACCESS EXCLUSIVE` lock for the name switch.

Goal
Prove what the spec promises about other connections during the run.

Acceptance criteria
18.5 GIVEN the migration is running WHEN another connection reads a stream THEN the read succeeds.
18.6 GIVEN the migration is running WHEN another connection appends THEN the append waits until the migration ends AND, after it ends, the appended message is in the new table.

Do this
Add tests to `migrateToOptimisedPostgreSQLStorageLayout.int.spec.ts`. To hold the migration in its copy phase, run it with a `messageSchemaVersionMapping` that calls `pg_sleep` for one row, or start it while a test transaction holds a lock that the copy needs and release it at a known time. Use separate pools for the migration, the reader and the appender. For 18.6, assert that the append promise is still pending while the migration runs, and that after the migration the message is readable and its `global_position` follows the copied rows. If a test shows that the append fails instead of waiting, stop and report the error. Do not change the migration's locking without asking.

Done when
Both tests pass reliably (run them several times), and `npm run agent:check` and `npm run test:unit` pass.
```

---

## Step 14. Prepared 0.44.0 migrations (unplugged)

```text
Context
Emmett repo. Read `AGENTS.md` first and follow it.
`src/packages/emmett-postgresql/src/eventStore/schema/migrations/0_44_0/` holds `migration_0_44_0_cleanupObsoleteCheckpointCompat` and `migrations_0_44_0`. The set is not part of any automatic list, and must stay that way. `0_44_0.migration.int.spec.ts` runs the set directly with `runSQLMigrations`. `0_44_0.snapshot.int.spec.ts` snapshots the set.
Step 11 exported `numericMessageSchemaVersionMigrationFor(options)`, with the optional `messageSchemaVersionMapping` and `databaseSchemaName`.

Goal
Two separate migrations in the 0.44.0 set, next to the checkpoint cleanup:
1. The mandatory schema version migration: the same migration as step 11 (same name, same SQL), so a store that already ran the on-demand one skips it or runs it as a no-op. It takes `messageSchemaVersionMapping` and `databaseSchemaName` from its migration options. Export `migration_0_44_0_numericMessageSchemaVersionFor(options)` and the default constant.
2. Drop of the old function: `DROP FUNCTION IF EXISTS <schema>.emt_append_to_stream(text[], jsonb[], jsonb[], text[], text[], text[], text, text, bigint, text)`. Export `migration_0_44_0_dropLegacyAppendToStreamFor(options)` and the default constant. The migration name is `emt:postgresql:eventstore:0.44.0:drop-legacy-append-to-stream`.
Add both default constants to `migrations_0_44_0`, after the checkpoint cleanup. Put this comment above each: `// Double-check before the 0.44.0 release.` These two comments are the only code comments allowed in this work.

Acceptance criteria
23.1 GIVEN a store with a `TEXT` column and the rows from 16.1 WHEN the prepared mandatory migration is run directly THEN the column is `INT` with the values from 16.1.
23.2 GIVEN migration options with a `messageSchemaVersionMapping` WHEN it runs THEN values follow 16.2–16.5.
23.3 GIVEN a store already migrated by `migrateSchemaToNumericMessageSchemaVersion` WHEN the prepared mandatory migration runs THEN it succeeds without changing data.
23.4 GIVEN the prepared drop migration WHEN it is run directly THEN `emt_append_to_stream` no longer exists AND the new version still appends AND the frozen 0.43.0 API can still read.
24.4 GIVEN a store in a custom schema WHEN the prepared migrations run directly with that `databaseSchemaName` THEN they behave as in 23.1 and 23.4.
17.1 GIVEN an existing store WHEN the automatic migrations of the current release run THEN neither prepared 0.44.0 migration runs.

Do this
1. Add both migrations to `0_44_0.migration.ts` and the set.
2. Update the 0.44.0 snapshot and review the diff: only the two new migrations appear.
3. Check that `eventStoreSchemaMigrationsFor` does not include them.

Tests
Extend `0_44_0.migration.int.spec.ts`. The existing test asserts `applied` equals `migrations_0_44_0`. Keep that assertion; it now includes the new migrations. Add 23.1–23.4, 24.4 and 17.1.

Done when
All criteria pass, the reviewed snapshot is updated, and `npm run agent:check` and `npm run test:unit` pass.
```

---

## Step 15. SQLite rebuild and fresh layout

```text
Context
Emmett repo. Read `AGENTS.md` first and follow it.
SQLite package: `src/packages/emmett-sqlite/src/eventStore/schema/`.
- `tables.ts`, `messagesTableSQLFor`: `message_schema_version TEXT NOT NULL` between `message_metadata` and `message_type`. `global_position INTEGER PRIMARY KEY`.
- `migrations/index.ts`: `pastEventStoreSchemaMigrations` (0.42.0 and 0.43.0 sets) run before `schemaMigration` (the initial `CREATE TABLE IF NOT EXISTS`). For a custom `databaseSchemaName`, `eventStoreSchemaMigrationsFor` returns only `[schemaMigrationFor(options)]`.
- `migrations/0_43_0/0_43_0.migration.ts` has `migration_0_43_0_FixStreamPartition`. `migrations/0_43_0/index.ts` exports `migrations_0_43_0`.
- 0.42.x rows hold the stream's expected version (0, 1, 2, ...) in the column. 0.43.0 rows hold `metadata.schemaVersion ?? '1'`. SQLite has no conditional statements, and column order does not matter there.
- Driver variants: sqlite3, d1 and durableObject. Tests live under `src/packages/emmett-sqlite/src/storage/{sqlite3,d1,durableObject}/eventStore/...`, mirroring the same paths.
Step 1 added the frozen SQLite 0.43.0 API and `releasedMigrations_0_43_0` in `migrations/0_43_0/legacyApi.ts`.

Goal
An automatic migration in the SQLite 0.43.0 set rebuilds the messages table with `message_schema_version INTEGER NOT NULL`. Each row gets its numeric `metadata.schemaVersion`, or `1`. The old column value is never used. The stored metadata JSON is copied unchanged. Fresh stores get the `INTEGER` column directly.

Acceptance criteria
19.1 GIVEN a 0.42.x store whose column holds 0, 1 and 2 WHEN the automatic migration runs THEN the column is `INTEGER` AND all three rows hold 1.
19.2 GIVEN a 0.43.0 store with a row whose metadata has `schemaVersion: '2'` WHEN the automatic migration runs THEN the row holds 2.
19.3 GIVEN a row whose metadata has `schemaVersion: 'v2'` WHEN the automatic migration runs THEN the row holds 1.
19.4 GIVEN N messages WHEN the migration finishes THEN the table has N messages with all other column values unchanged, including the stored metadata JSON, AND appends continue the existing global positions.
19.7 GIVEN the migration has run WHEN it runs again THEN nothing changes.
20.2 GIVEN an empty SQLite database WHEN the event store schema is created THEN `message_schema_version` is `INTEGER`.
24.2 GIVEN an existing SQLite store in a custom schema WHEN the automatic migrations run THEN the column is `INTEGER` with values as in 19.1–19.3.

Do this
1. In `tables.ts`, declare `message_schema_version INTEGER NOT NULL`.
2. Add `migration_0_43_0_numericMessageSchemaVersionFor(options)` and its default constant to `0_43_0.migration.ts`, with the name `emt:sqlite:eventstore:0.43.0:numeric-message-schema-version`. Its SQL, in order:
   a. Create the messages table with the old 0.43.0 layout, `CREATE TABLE IF NOT EXISTS`, so the copy also works on a fresh database where the past migrations run before the initial schema.
   b. Create a new table in the current layout under a temporary name.
   c. `INSERT INTO new SELECT ...` with `CASE WHEN json_extract(message_metadata, '$.schemaVersion') GLOB '[0-9]*' AND json_extract(message_metadata, '$.schemaVersion') NOT GLOB '*[^0-9]*' THEN CAST(json_extract(message_metadata, '$.schemaVersion') AS INTEGER) ELSE 1 END`, copying `global_position` as it is.
   d. Drop the old table, rename the new one, and recreate the indexes and unique constraint that the fresh schema has.
   Dumbo records the migration, so a second run is skipped (19.7).
3. Append the constant to `migrations_0_43_0`, and add the `For(options)` variant to the custom-schema list before `schemaMigrationFor(options)`.
4. Update the SQLite 0.43.0 snapshots and review the diff.
5. Leave append and read code alone. Step 16 changes them.

Tests
In `storage/sqlite3/eventStore/schema/migrations/0_43_0/0_43_0.migration.int.spec.ts`: 19.1 with the 0.42.0 snapshot and 0.42.0 legacy append, 19.2 and 19.3 with the frozen 0.43.0 append on a released 0.43.0 store, 19.4, 19.7 and 24.2. Add 20.2 to `createEventStoreSchema.int.spec.ts` for sqlite3, and to the d1 and durableObject copies where those files exist. Check the column type with `PRAGMA table_info`.

Done when
All criteria pass, existing SQLite tests stay green for all driver variants, and `npm run agent:check` and `npm run test:unit` pass.
```

---

## Step 16. SQLite append and read

```text
Context
Emmett repo. Read `AGENTS.md` first and follow it.
After step 15, every SQLite store has an `INTEGER` column with a numeric value. `src/packages/emmett-sqlite/src/eventStore/schema/appendToStream.ts` writes `message.metadata.schemaVersion ?? DefaultMessageSchemaVersion` into the column. `readStream.ts` and `readMessagesBatch.ts` build metadata with `schemaVersion: DefaultMessageSchemaVersion` and ignore the column.
Step 4 added `withoutSchemaVersion` in `@event-driven-io/emmett`, and the shared features `testSchemaVersion` and `testConsumerSchemaVersion`. SQLite wiring in emmett-tests: `src/packages/emmett-tests/src/eventStore/sqlite/sqliteEventStore.e2e.spec.ts`.

Goal
SQLite appends write the top-level `schemaVersion ?? 1` into the column and no `schemaVersion` into the stored metadata. Reads take the version from the column only, and remove `schemaVersion` from `metadata`.

Acceptance criteria
4.1–4.6, 5.1, 7.1, 8.1–8.4, 9.1, 9.2, 10.1, 10.2 through the shared features.
5.3 GIVEN an event appended with `schemaVersion: 2` WHEN the raw stored metadata is inspected THEN it has no `schemaVersion`.
19.5 GIVEN a migrated row whose stored metadata still has `schemaVersion: '2'` WHEN it is read THEN `schemaVersion` is 2 AND `metadata` has no `schemaVersion`.
19.6 GIVEN a migrated row whose column holds 3 and whose stored metadata has `schemaVersion: '2'` WHEN it is read THEN `schemaVersion` is 3.
20.3 GIVEN a new store WHEN a message with `schemaVersion: 2` is appended THEN the column holds 2.

Do this
1. Append: bind `message.schemaVersion ?? 1` to the column, store metadata without `schemaVersion`, and give the recorded messages returned to hooks and projections the top-level `schemaVersion` and metadata without `schemaVersion`.
2. Reads: change the row type of `message_schema_version` to `number`. Set `schemaVersion: Number(row.message_schema_version)` at the top level, and build `metadata` from `withoutSchemaVersion(rowMetadata)` plus the recorded fields. Remove the `DefaultMessageSchemaVersion` usages.
3. Wire `testSchemaVersion` and `testConsumerSchemaVersion` in the SQLite e2e spec in emmett-tests.
4. The recorded messages built in `appendToStream.ts` sit behind casts, so `tsc` does not report a missing `schemaVersion` there. The tests must cover them.

Tests
Update the existing `schemaVersion` cases in `storage/sqlite3/eventStore/schema/appendToStream.int.spec.ts`, `readStream.int.spec.ts` and `readMessagesBatch.int.spec.ts`, and their d1 and durableObject copies where they exist. Add 5.3 and 20.3 there. Add 19.5 and 19.6 to the 0.43.0 migration test from step 15 (set 19.6's column to 3 with a direct `UPDATE` after the migration).

Done when
All criteria pass on all SQLite driver variants, the shared features pass on SQLite, and `npm run agent:check` and `npm run test:unit` pass.
```

---

## Step 17. Recorded message types

Why last among the code steps: it breaks code that reads `metadata.schemaVersion`. After steps 4–16, no Emmett code does.

```text
Context
Emmett repo. Read `AGENTS.md` first and follow it.
`src/packages/emmett/src/typing/message.ts`:
- `RecordedMessage<MessageType, MetaData>` = `CombineMetadata<...> & { kind: ... }`.
- `CommonRecordedMessageMetadata` has `schemaVersion?: string`.
- `DefaultMessageSchemaVersion = '1'`.
All five stores now return a numeric top-level `schemaVersion` and remove `schemaVersion` from `metadata`.

Goal
Recorded messages always carry `schemaVersion: number`, and `metadata.schemaVersion` is no longer part of Emmett's metadata type.

Acceptance criteria
3.1 GIVEN any recorded message type WHEN its `schemaVersion` is accessed THEN its type is `number`, not optional.
3.2 GIVEN recorded message metadata types WHEN `metadata.schemaVersion` is accessed THEN it is not part of the Emmett metadata type.

Do this
1. Add `schemaVersion: number` to the intersection in `RecordedMessage`, next to `kind`.
2. Remove `schemaVersion` from `CommonRecordedMessageMetadata`.
3. Set `DefaultMessageSchemaVersion = 1`. Use it in place of the literal `1` defaults added in steps 4–16, where those defaults live in code that imports from `@event-driven-io/emmett`.
4. Fix the compile errors this causes in the packages, samples and tests, without casts that hide the type. The type research (`type-surface-research/findings.md`, `2-mechanical-fixes.diff`) found these, all mechanical: recorded messages built without `schemaVersion` in `inMemoryProjectionSpec.ts`, `postgresProjectionSpec.ts`, `sqliteProjectionSpec.ts`, about 60 test fixtures in the emmett package, a few in the PostgreSQL, SQLite and EventStoreDB packages, and `samples/cloudflare/durable-objects/.../projections.unit.spec.ts`. Fixtures get `schemaVersion: 1`; builders take `event.schemaVersion ?? DefaultMessageSchemaVersion`. If a fix needs a behaviour change, stop and ask.

Tests
Type checks in `messageSchemaVersion.unit.spec.ts` (from step 2): `expectTypeOf<RecordedMessage<Event>['schemaVersion']>().toEqualTypeOf<number>()`, `expectTypeOf<RecordedMessage<V2>['schemaVersion']>().toEqualTypeOf<2>()`, `<V1>` gives `1`, and `expectTypeOf<CommonRecordedMessageMetadata>().not.toHaveProperty('schemaVersion')` for 3.2.

Done when
`npm run build:ts` passes for the whole repo, the type checks pass, and `npm run agent:check` and `npm run test:unit` pass.
```

---

## Step 18. Docs and final check

```text
Context
Emmett repo. Read `AGENTS.md` first and follow it.
The command handler versioning docs are under `src/docs` (search for "upcast" in the command handling guide). Their snippets come from `src/packages/emmett/src/commandHandling/handleCommand.versioning.unit.spec.ts` and `handleCommandWithDecider.versioning.unit.spec.ts`, through snippet regions.
The projection definition version is a `number` in the API and an integer in storage. This work does not change it.

Goal
The docs show the new API, backed by tested snippets. The projection version behaves as before. The full suite passes.

Acceptance criteria
22.1 GIVEN the command handler versioning section WHEN it is read THEN it shows versioned message types with the version type parameter, the helper's version argument, and an upcaster switching on `schemaVersion`, all backed by tested snippets.
21.1 GIVEN a projection definition with `version: 2` WHEN it is registered THEN it is stored as the integer 2, as today.

Do this
1. Update the two versioning unit tests to declare V1 and V2 with the fourth type parameter, create events with the version argument, and upcast with a `switch` on `schemaVersion`. Keep the snippet regions and adjust them.
2. Update the docs prose in plain language: what `schemaVersion` is, how to declare it, and how the upcaster narrows it. Say once that an upcast or downcast result without `schemaVersion` is version 1. Say that the factories take a single message type, not a union of versions. Follow the existing style of that page.
3. Check 21.1: find the existing test that registers a PostgreSQL or SQLite projection with a version and asserts the stored version. If none exists, add one next to the projection registration tests, asserting that the stored version is the integer 2.
4. Run `npm run docs:build`.
5. Run `npm test`. If it is interrupted, ask before you run it again.

Done when
The versioning tests and the 21.1 check pass, `npm run docs:build` passes, `npm run agent:check` passes, and `npm test` passes. Report each command and its result.
```
