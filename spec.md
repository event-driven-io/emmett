# Bundled relational schema migrations for event stores, consumers, and processors

## Summary

PostgreSQL and SQLite event stores must expose one composable schema graph that includes their own schema and the schemas of registered projections and processors that use the same storage. A parent must flatten that graph into one ordered Dumbo migration plan and execute it with one migration runner and one transaction. Runtime initialization must reuse the same lazy, memoized migration behavior that event stores already have, including `autoMigration` inheritance and an explicit `None` override.

The change also makes event-store async projection registrations useful at runtime. Async projection definitions registered on an event store are passed to consumers automatically and become ordinary projectors with default processor settings. Passing an explicit `processors` array to the consumer disables that automatic registration. A later explicit processor registration with the same processor ID replaces the automatically registered processor.

A new read-only `verifyNoPendingMigrations()` operation compares migrations expected from the composed schema graph with migrations already recorded in the database. It does not execute DDL and is not an `autoMigration` mode.

## Why this is needed

The current code has two separate migration paths:

- `eventStore.schema.migrate()` runs event-store migrations and invokes `init` only for projections registered as inline.
- `consumer.start()` invokes async processor initialization independently, and built-in Pongo projection initialization calls `collection.schema.migrate()`.

This causes runtime processes to issue DDL even when the event store uses `autoMigration: 'None'`. In PostgreSQL, even `CREATE TABLE IF NOT EXISTS` requires namespace `CREATE`, so a least-privilege runtime role fails before PostgreSQL can observe that the table already exists. Provisioning code also has to register projections merely to make their schema visible to migration.

The connection and transaction are not missing today. PostgreSQL and SQLite projection initialization already receives `execute`, the connection, the transaction, the pool, the driver, and migration options through its context. The missing abstraction is a declarative schema contribution that a parent can compose before executing migrations.

## Goals

- Compose event-store, consumer, projection, reactor, and workflow schema contributions when they use the same PostgreSQL or SQLite storage.
- Execute a composed schema as one Dumbo migration plan, with one migration-table setup and one transaction.
- Let projections and processors contribute declarative Dumbo schema components while storage-bound event stores and consumers expose migration operations.
- Preserve existing lazy and explicit event-store migration semantics.
- Inherit `autoMigration` through event store → consumer → processor, with an override at each level.
- Keep the root default as `CreateOrUpdate`.
- Ensure `None` prevents automatic schema execution before the migration runner is called.
- Include both inline and async event-store projection registrations in event-store migration composition and initialization.
- Automatically register event-store async projections as consumer projectors using default processor settings.
- Allow all processor kinds to contribute schema when they share the consumer's storage.
- Provide a read-only migration-history check with a structured result and `assertSuccessful()` convenience method.
- Preserve current `dryRun` behavior: execute inside a transaction and roll back.

## Non-goals

- Do not change the default `autoMigration` value to `None`.
- Do not add `Verify` to the `autoMigration` union.
- Do not structurally inspect tables, functions, indexes, or other database objects.
- Do not treat migrations recorded in the database but absent from the current bundle as an error.
- Do not change `dryRun` into a no-execution operation.
- Do not compare connection strings or database metadata to decide whether two independently configured pools target the same physical database.
- Do not bundle processors that supply their own pool or connection, even when they happen to target the same database as the parent.
- Do not add arbitrary user-supplied Dumbo or Pongo extension schemas in this change. The schema graph must leave room for that later.
- Do not add relational migration behavior to MongoDB, EventStoreDB, or in-memory storage. The core registration behavior may be shared where applicable, but schema execution is limited to PostgreSQL and SQLite.

## Existing behavior to preserve

- An explicit `schema.migrate()` call runs even when `autoMigration` is `None`; `None` gates automatic migration only.
- Automatic event-store migration is lazy and memoized per bound event-store instance.
- A non-dry migration is not executed repeatedly by normal operations on the same bound instance.
- `dryRun` executes migrations transactionally and does not mark the schema as migrated.
- Migration failures use the current Dumbo transaction and rollback behavior.
- Processor initialization remains one-time per processor instance.
- Processors with their own storage configuration initialize against their own storage.

## Core schema contribution

Emmett core must allow a projection definition or message processor to carry a schema value without importing Dumbo or defining a second schema abstraction. Add a generic schema parameter directly to the existing types:

```ts
export type ProjectionDefinition<
  EventType,
  EventMetaDataType,
  HandlerContext,
  EventPayloadType,
  Schema = unknown,
> = {
  // existing fields
  schema?: Schema;
};

export type MessageProcessor<
  MessageType,
  MessageMetadataType,
  HandlerContext,
  Schema = unknown,
> = {
  // existing fields
  schema?: Schema;
};
```

The exact generic placement must preserve existing inference and default type arguments. Core does not inspect the schema value. PostgreSQL and SQLite adapters accept Dumbo `AnySchemaComponent` values and use Dumbo's component guard when collecting contributions.

Do not introduce a core `RelationalSchema`, migration facade, or duplicate component wrapper.

## Storage-agnostic Dumbo components

Keep Dumbo's existing `SchemaComponent` and `AnySchemaComponent` storage-agnostic. A component describes migrations but does not own a pool, connection, transaction, or driver. Do not add a driver generic, runtime driver discriminator, or supported-driver list to the component API for this change.

The concrete event store or consumer binds the composed component graph to its own storage and driver when it renders or executes migrations. Bundling is therefore decided by storage ownership:

- A child is bundleable only when it uses the parent's inherited pool/session.
- A processor with explicit connection options, pool, Dumbo instance, or connection owns separate storage and is excluded from the parent bundle.
- Do not compare connection strings. Two distinct pools cannot share the parent's active migration transaction even when they target the same database.
- Existing Dumbo SQL rendering and execution behavior determines whether a component's migrations can run with the bound parent's driver; this change does not add a separate compatibility protocol.

## Storage-bound schema operations

Only objects that own or inherit a concrete relational pool expose schema operations. Extend the existing PostgreSQL and SQLite event-store `schema` objects and add equivalent `schema` objects to their consumers:

```ts
schema: {
  readonly component: AnySchemaComponent;
  sql(): string;
  print(): void;
  migrate(options?: MigrationOptions): Promise<RunSQLMigrationsResult>;
  verifyNoPendingMigrations(
    options?: MigrationOptions,
  ): Promise<VerifyNoPendingMigrationsResult>;
  // Event stores retain their existing `dangerous` operations.
};

export type VerifyNoPendingMigrationsResult = {
  successful: boolean;
  existing: readonly SQLMigration[];
  pending: readonly SQLMigration[];
  assertSuccessful(errorMessage?: string): void;
};
```

Projections and processors expose only their optional declarative `schema` component. They do not expose redundant `migrate()`, `sql()`, `print()`, verification, or `autoMigration` members.

`autoMigration` remains configuration on event-store, consumer, and processor registrations. Its effective value is resolved through the ownership chain; it is not a property required on every schema component.

The final operational methods reuse the existing PostgreSQL and SQLite migration option types rather than creating parallel option names. In particular, verification uses the same hash-check setting as migration execution.

An event store or consumer's `sql()` and `print()` operate on its complete effective schema graph, not only its local tables. Its `migrate()` flattens that graph and calls the Dumbo migration runner once; it must not call child migration methods sequentially.

## Schema graph and ownership

Every schema owner has a local component and zero or more child components. Components are composed in this order:

1. Event-store schema.
2. Consumer infrastructure owned by that event store or consumer, including processor checkpoint and projection-registration storage.
3. Registered processor and projection schemas in registration order.

The same order is used by `sql()`, `print()`, `migrate()`, and `verifyNoPendingMigrations()`.

The event-store schema graph contains:

- The local event-store component.
- Every schema-aware inline projection registered on the event store.
- Every schema-aware async projection registered on the event store.

The consumer schema graph contains:

- The event-store component when the consumer was created by an event store.
- The consumer's local relational infrastructure.
- Every effective schema-aware processor registered on the consumer that uses the inherited consumer pool.

Components are flattened and deduplicated through Dumbo's component and migration utilities. The same migration name with equivalent SQL is included once. Conflicting SQL for the same migration name follows the existing hash-mismatch behavior rather than being silently selected.

All migrations in a bundle use the parent's configured migration table and the parent's active transaction executor. This removes the current nested Pongo migration runner and ensures the migration table is checked or created once per bundle.

## Binding and memoization

A projection definition and its declarative component can be reused with different stores and databases, so migration state must never be stored globally on either object. When a child is registered, create an internal binding record between its component, the concrete schema owner, and the inherited storage target. This record is runtime state; it is not another public schema abstraction.

Each storage-bound owner keeps the same in-flight/completed migration memoization used by event stores today. When a parent successfully migrates a composed plan, it marks the participating binding records as satisfied for that object graph. A later child initialization in the same graph must not run the component's migrations again.

The following operations do not mark a schema as migrated:

- `sql()`
- `print()`
- `verifyNoPendingMigrations()`
- `migrate({ dryRun: true })`
- A failed migration

## `autoMigration` resolution

Resolve the effective policy through the ownership chain:

```text
event store → consumer → processor
```

The rules are:

- A root event store or standalone consumer defaults to `CreateOrUpdate`.
- An omitted child value inherits its parent's effective policy.
- An explicit child value overrides the inherited value.
- A processor with separate storage starts a separate policy chain and defaults to `CreateOrUpdate` when it has no explicit value.
- `None` prevents automatic migration before any Dumbo migration runner or migration-table setup is called.
- An explicit `schema.migrate()` still runs under `None`.

Automatic migration triggers remain consistent with current event-store behavior:

- An inline projection is covered by the event store's lazy schema ensure before the first store operation. Projection handling itself never invokes initialization per event or batch.
- A consumer ensures its effective schema once during initialization/start.
- A processor with separate storage ensures its own schema during its initialization.

## Projection and processor initialization

Schema composition and lifecycle initialization are coordinated but are not the same operation.

- Built-in Pongo projections expose collection migrations through their schema component instead of unconditionally starting a nested `collection.schema.migrate()` call.
- When initialization sees an effective `CreateOrUpdate` policy and its bound contribution has not already participated in a successful parent migration, it lazily migrates that contribution through its storage-bound owner.
- When initialization sees `None`, it performs no automatic schema migration.
- When the bound contribution was already migrated through the parent bundle, initialization does not run migrations again.
- Non-schema initialization retains its existing once-per-instance behavior.
- Existing schema-unaware processors and projections continue to use their current `init` behavior and cannot contribute imperative work to a declarative bundle.
- Processors with separate storage are not included in the parent bundle and initialize normally against their own storage and policy.

Event-store projection initialization must cover both inline and async registrations. PostgreSQL projection metadata registration must use the registration's actual `registrationType`; it must not hardcode `async`. SQLite inline initialization must report `inline`; it must not report `async`.

## Event-store async projection registration

Keep the existing event-store projection registration shape. An async entry contains only its projection definition:

```ts
projections: [
  ...projections.inline([ordersSummary]),
  ...projections.async([billingSummary]),
];
```

Do not add full processor options to the async projection registration. When an event store creates a consumer, each async projection becomes a normal projector using the same defaults as an explicit `consumer.projector({ projection })` call.

The core `projections.async()` helper currently returns registrations typed and valued as `inline`; correct it to return `async`.

## Consumer processor defaults and replacement

Use the existing `processors` option to control automatic registration; do not add an inherit/include flag.

- `eventStore.consumer()` with `processors` omitted starts with projector processors derived from the event store's async projection definitions.
- `eventStore.consumer({ processors: [...] })` treats the provided array as the complete initial processor set and does not automatically register event-store async projections.
- `processors: []` explicitly starts with no processors.
- Calls to `consumer.projector()`, `consumer.reactor()`, and `consumer.workflowProcessor()` after construction remain additive.
- When an explicitly registered processor has the same processor ID as an automatically registered processor, replace the automatic processor rather than retaining both or throwing.

The replacement behavior must be based on processor ID, not object identity. Do not silently broaden replacement semantics for unrelated explicit duplicate registrations unless existing tests and API expectations support it; the required case is replacing an automatically seeded default.

This registration behavior belongs in core where possible so non-relational event stores with applicable consumer/projector factories can use it. The schema contribution and migration behavior remains relational.

## Read-only pending-migration verification

Add a Dumbo-level primitive used by every relational schema owner:

```ts
const result = await schema.verifyNoPendingMigrations();

result.assertSuccessful();
```

Verification behavior is:

- Read the configured migration table without creating it or any other database object.
- Compare every expected migration from the effective schema graph with recorded migrations.
- Put an expected migration in `existing` when a recorded migration matches.
- Put an expected migration in `pending` when it has not been recorded.
- When hash checking is enabled, put an expected migration with the same name but a different hash in `pending`.
- When hash checking is disabled through the existing migration option, a recorded migration with the same name is `existing` regardless of hash.
- Ignore recorded migrations that are not present in the current schema graph.
- Set `successful` to `pending.length === 0`.
- `assertSuccessful()` does nothing when successful and throws a descriptive migration verification error otherwise.
- If the migration table does not exist, treat the recorded set as empty without issuing DDL; all expected migrations are pending.

The operation must work for PostgreSQL runtime roles that have read access but no namespace `CREATE` privilege.

## Public behavior examples

### Provision every registered projection in one call

```ts
const eventStore = getPostgreSQLEventStore({
  driver: pgEventStoreDriver,
  connectionString,
  projections: [
    ...projections.inline([ordersSummary]),
    ...projections.async([billingSummary]),
  ],
  schema: { autoMigration: "None" },
});

await eventStore.schema.migrate();
```

The call applies the event-store schema and both projection schemas in one migration run even though automatic migration is disabled.

### Use the event store's async projections as consumer defaults

```ts
const consumer = eventStore.consumer();
await consumer.start();
```

The consumer registers `billingSummary` as a projector with default processor settings. With inherited `autoMigration: 'None'`, startup does not execute schema migrations.

### Replace automatic processors completely

```ts
const consumer = eventStore.consumer({ processors: [] });

consumer.projector({
  processorId: "billing-summary-v2",
  projection: billingSummary,
  startFrom: "BEGINNING",
});
```

Because `processors` was explicitly provided, no async projection processors are added automatically.

### Verify without DDL

```ts
const verification = await eventStore.schema.verifyNoPendingMigrations();

verification.assertSuccessful();
```

This reads migration history only. It does not behave like `dryRun` and does not require DDL privileges.

## Actionable code changes

### Emmett core

- Update `src/packages/emmett/src/projections/index.ts`:
  - Add a schema generic to `ProjectionDefinition` without importing Dumbo.
  - Allow projection definitions to expose an optional schema value while preserving existing inference and default type arguments.
  - Fix `asyncProjections()` to return `ProjectionRegistration<'async'>` values with `type: 'async'`.
- Update `src/packages/emmett/src/processors/processors.ts`:
  - Add the corresponding schema generic and optional schema value to message processors.
  - Keep normal processor initialization one-shot.
- Update `src/packages/emmett/src/consumers/consumers.ts`:
  - Support automatically seeded processors separately from an explicitly supplied `processors` array.
  - Replace an automatically seeded processor when an explicit registration has the same ID.
  - Preserve explicit additions and the existing start/close behavior.
- Update core consumer and event-store typing so relational adapters can pass event-store async projection defaults without adding Dumbo concepts to core.

### Dumbo prerequisite

- Add a read-only API that compares expected `SQLMigration` values with the configured migration table.
- Return `{ successful, existing, pending, assertSuccessful }`.
- Reuse the current hash-ignore option and migration-table configuration.
- Ensure a missing migration table is observed as no recorded migrations without creating it.
- Keep current `runSQLMigrations` and `dryRun` behavior unchanged.

If the Dumbo verification API cannot land first, use a temporary local verification adapter so Emmett work can proceed in parallel. Do not publish a separate Emmett component wrapper as permanent API; remove the temporary adapter when the Dumbo version is updated.

### PostgreSQL

- Extract the current event-store migration array into an event-store schema component in `src/packages/emmett-postgresql/src/eventStore/schema/migrations/`.
- Update `src/packages/emmett-postgresql/src/eventStore/postgreSQLEventStore.ts` to:
  - Accept and retain both inline and async projection registrations.
  - Compose both kinds of schema-aware projection components.
  - Run one migration plan.
  - Initialize both registration kinds once.
  - Pass async projection definitions to created consumers when `processors` is omitted.
  - Add the composed `component` and verification operation to the existing event-store schema object.
- Update `src/packages/emmett-postgresql/src/eventStore/consumers/postgreSQLEventStoreConsumer.ts` to:
  - Resolve inherited `autoMigration`.
  - Build a consumer schema from the parent/local component and same-pool processor components.
  - Expose the storage-bound `component`, `sql`, `print`, `migrate`, and `verifyNoPendingMigrations` operations.
- Update `src/packages/emmett-postgresql/src/eventStore/consumers/postgreSQLProcessor.ts` to:
  - Bind schema-aware processors to inherited or owned storage.
  - Apply policy inheritance and overrides.
  - Avoid nested/repeated migration after a successful parent bundle.
- Update `src/packages/emmett-postgresql/src/eventStore/projections/postgreSQLProjection.ts` to use the supplied registration type instead of hardcoding `async`.
- Update Pongo projection factories under `src/packages/emmett-postgresql/src/eventStore/projections/pongo/` to expose collection schema components and stop unconditionally invoking a nested collection migration.

### SQLite

- Extract the current event-store migration array into an event-store schema component in `src/packages/emmett-sqlite/src/eventStore/schema/migrations/`.
- Update `src/packages/emmett-sqlite/src/eventStore/SQLiteEventStore.ts` with the same composition, policy, async registration, and schema API behavior as PostgreSQL.
- Update `src/packages/emmett-sqlite/src/eventStore/consumers/sqliteEventStoreConsumer.ts` and `sqliteProcessor.ts` with the same consumer and processor behavior.
- Correct inline projection initialization to use `registrationType: 'inline'`.
- Update Pongo projection factories under `src/packages/emmett-sqlite/src/eventStore/projections/pongo/` to contribute collection schema components rather than running nested migrations.
- Apply the behavior to sqlite3, D1, and Durable Object driver variants through shared code, with driver-specific integration coverage.

### Documentation

- Document declarative schema components separately from the storage-bound event-store and consumer schema operations in both package READMEs and `src/docs`.
- Explain `autoMigration` inheritance and explicit overrides.
- Explain the difference between `dryRun` and `verifyNoPendingMigrations()`.
- Show one-call provisioning for inline and async projections.
- Show the omitted-versus-provided `processors` behavior.
- State that independently configured processor storage is not included in the parent bundle.

## Test-first implementation order

The order below follows real dependencies and starts with isolated quick wins. Each item begins with a failing test and ends with the smallest implementation needed to pass it; it is not a set of release phases. Dumbo verification work can proceed in parallel with the independent Emmett core fixes, using a temporary local verification adapter until the updated Dumbo package is available.

1. Add core unit tests proving `projections.async()` returns `type: 'async'` with the correct TypeScript registration type, then correct the helper.
2. Add core consumer tests for automatically seeded processors, explicit `processors: []`, and replacement of an automatic processor by explicit registration with the same ID, then implement the registry behavior without changing unrelated lifecycle behavior.
3. Add PostgreSQL and SQLite tests that expose the current registration-type errors: PostgreSQL must persist the supplied inline/async type, and SQLite inline initialization must receive `inline`. Fix those two localized defects.
4. In Dumbo, add tests for read-only migration comparison: all existing, missing migrations, hash mismatch, ignored hashes, extra historical rows, missing migration table, and `assertSuccessful()`. Implement `verifyNoPendingMigrations()` without changing the migration runner.
5. Add Emmett compile-time tests for the new projection and processor schema generics using a structural `AnySchemaComponent` fixture. Add composition tests proving existing Dumbo components remain unchanged and are bound to the parent event store or consumer only when collected; do not publish an Emmett-specific wrapper or add driver metadata to Dumbo components.
6. Add PostgreSQL schema tests proving the event-store migration component produces the same SQL migrations as the current array. Extract the component while keeping existing `schema.sql()` and `schema.migrate()` tests green.
7. Repeat the same component-equivalence test and extraction for shared SQLite schema code before testing individual SQLite drivers.
8. Add Pongo projection tests proving each built-in projection exposes the expected collection component without opening a migration transaction. Refactor the PostgreSQL and SQLite Pongo factories to use that component.
9. Add PostgreSQL integration tests showing one `eventStore.schema.migrate()` creates the event store plus inline and async Pongo projection tables through one migration runner and one transaction. Implement event-store component composition and ordered flattening.
10. Add equivalent SQLite integration tests in shared suites and run them against sqlite3, D1, and Durable Object variants. Implement shared SQLite composition rather than duplicating it per driver.
11. Add tests for the API boundary: projections and processors expose only a declarative component, while event stores and consumers expose the composed component plus `sql`, `print`, `migrate`, and `verifyNoPendingMigrations`. Assert that every storage-bound operation describes the same effective graph.
12. Add policy tests for root `CreateOrUpdate`, inherited `None`, child override to `CreateOrUpdate`, child override to `None`, explicit migration under `None`, and independently configured processor storage. Implement effective-policy resolution once and reuse it across PostgreSQL and SQLite.
13. Add initialization tests proving a successful parent migration satisfies child schema initialization, consumer start does not rerun it, inline handling never initializes per event, and separate-storage processors initialize independently. Implement bound per-owner memoization rather than storing state on reusable definitions.
14. Add event-store consumer tests showing omitted `processors` creates projectors for async definitions with default settings, an explicit array suppresses defaults, and an explicit same-ID registration replaces an automatic projector.
15. Add least-privilege PostgreSQL integration coverage: migrate with a migration role, then run `verifyNoPendingMigrations()` and start a consumer under a role with no schema `CREATE`; assert that no DDL or migration-table creation is attempted.
16. Add regression tests confirming `dryRun` still executes transactionally and rolls back, and that it does not mark parent or child schemas migrated.
17. Update documentation from the tested public examples, then run formatting/type checks and the smallest affected integration suites before the repository-wide unit and full test commands required for application-code completion.

## Acceptance criteria

- A PostgreSQL or SQLite event store with inline and async Pongo projections can create every required table through one `eventStore.schema.migrate()` call.
- The composed migration uses one Dumbo runner invocation, one configured migration table, and one transaction.
- A projection or processor contributes only a storage-agnostic Dumbo schema component; it does not expose a second migration facade.
- `eventStore.schema.component` and `consumer.schema.component` expose their complete composed graphs.
- `eventStore.schema.sql()` includes event-store and registered projection migrations in ownership order.
- `eventStore.consumer()` automatically registers async event-store projections as default projectors.
- `eventStore.consumer({ processors: [] })` registers none of those defaults.
- An explicit processor registration replaces an automatic processor with the same ID.
- A consumer created by an event store exposes a schema bundle containing the parent schema and same-storage processor schemas.
- Inline and async projection registration metadata uses the correct registration type.
- `autoMigration` defaults to `CreateOrUpdate` only at a root and otherwise inherits through event store → consumer → processor.
- `None` causes consumer startup and processor initialization to avoid invoking any migration runner or migration-table DDL.
- Explicit `schema.migrate()` works under `None`.
- A child already migrated by its parent does not migrate again during initialization in the same bound object graph.
- An explicitly configured processor pool is excluded from its parent's migration bundle and follows its own migration lifecycle.
- `verifyNoPendingMigrations()` performs no DDL, returns only `existing` and `pending` expected migrations, ignores extra historical migrations, respects the existing hash-ignore option, and provides `assertSuccessful()`.
- `dryRun` retains current execute-and-rollback behavior.
- Existing schema-unaware processors continue to initialize and process messages as before.

## Verification commands for implementation

Run focused tests as each behavior is introduced. From `src`, finish application-code work with:

```shell
npm run agent:check
npm run test:unit
npm test
```

Also run the focused PostgreSQL and SQLite integration files added for schema composition, verification, policy inheritance, async processor defaults, and least-privilege startup. If Dumbo or Pongo changes live in separate repositories, run their complete relevant unit and integration suites before updating Emmett's dependency versions.
