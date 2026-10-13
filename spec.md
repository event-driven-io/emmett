# Bundled relational schema migrations for event stores, consumers, and processors

## Summary

PostgreSQL and SQLite event stores must expose one composable schema graph that includes their own schema and the schemas of registered projections and processors that use the same storage. A parent must flatten that graph into one ordered Dumbo migration plan and execute it with one migration runner and one transaction. Runtime initialization must reuse the same lazy, memoized migration behavior that event stores already have, including `autoMigration` inheritance and an explicit `None` override.

The change also makes event-store async projection registrations useful at runtime. Async projection definitions registered on an event store are passed to consumers automatically and become ordinary projectors with default processor settings. Passing an explicit `processors` array to the consumer disables that automatic registration. A later processor registration with the same processor ID replaces the earlier processor.

Dumbo provides an immutable `SchemaComponentMigrator` that binds one storage-agnostic schema component graph to a concrete pool. Pongo databases already use it, and PostgreSQL and SQLite event stores and their consumers must use it too, for SQL description, explicit migration, and lazy schema assurance. The migrator does not read `autoMigration`; the owner picks the call. Under `CreateOrUpdate`, the owner calls `migrate()`, which applies pending migrations. Under `EnsureMigrated`, it calls `ensureMigrated()`, which reads the migration history and throws when migrations are pending, without executing DDL. Under `None`, it calls neither.

The Dumbo and Pongo parts are done in [Pongo PR #225](https://github.com/event-driven-io/Pongo/pull/225). See [Done in Pongo PR #225](#done-in-pongo-pr-225). The remaining work is in Emmett, and it needs a Dumbo and Pongo release that includes that PR.

## Why this is needed

The current code has two separate migration paths:

- `eventStore.schema.migrate()` runs event-store migrations and invokes `init` only for projections registered as inline.
- `consumer.start()` invokes async processor initialization independently, and built-in Pongo projection initialization calls `collection.schema.migrate()`.

This causes runtime processes to issue DDL even when the event store uses `autoMigration: 'None'`. In PostgreSQL, even `CREATE TABLE IF NOT EXISTS` requires namespace `CREATE`, so a least-privilege runtime role fails before PostgreSQL can observe that the table already exists. Provisioning code also has to register projections merely to make their schema visible to migration.

The connection and transaction are not missing today. PostgreSQL and SQLite projection initialization already receives `execute`, the connection, the transaction, the pool, the driver, and migration options through its context. The missing abstraction is a declarative schema contribution that a parent can compose before executing migrations.

## Goals

- Compose event-store, consumer, projection, reactor, and workflow schema contributions when they use the same PostgreSQL or SQLite storage.
- Execute a composed schema as one Dumbo migration plan, with one migration-table setup and one transaction.
- Let projections and processors contribute declarative Dumbo schema components while storage-bound owners (event stores, consumers, and processors with their own storage) expose migration operations.
- Preserve existing lazy and explicit event-store migration semantics.
- Give PostgreSQL and SQLite event stores a public `init()`, like the consumer's, that runs automatic assurance and inline projection initialization. The first store operation calls it when nobody did.
- Inherit `autoMigration` through event store → consumer → processor, with an override at each level. Every processor accepts it. It takes effect where the object owns a migration run.
- Keep the root default as `CreateOrUpdate`.
- Ensure `None` prevents automatic schema execution before the migration runner is called.
- Include both inline and async event-store projection registrations in event-store migration composition and initialization.
- Automatically register event-store async projections as consumer projectors using default processor settings.
- Let any processor contribute a schema when it shares the consumer's storage. A projector contributes its projection's schema. A reactor or workflow processor may contribute the schema of its own non-projection storage.
- Use Dumbo's `SchemaComponentMigrator` in Emmett schema owners, as Pongo does.
- Add `EnsureMigrated` to the `autoMigration` union: `'None' | 'EnsureMigrated' | 'CreateOrUpdate'`.
- Under `CreateOrUpdate`, automatic assurance calls `migrate()`. Under `EnsureMigrated`, it calls `ensureMigrated()`, which checks migration history without DDL. Under `None`, there is no automatic assurance: no migration and no history read.
- Report pending migrations through Dumbo's typed `PendingMigrationsError` when the read-only check fails.
- Let users configure `ignoreMigrationHashMismatch` on the event store, because Dumbo does not repair a recorded hash after it ignores a mismatch.
- Make the agreed Dumbo and Pongo changes: the `EnsureMigrated` value, `None` without a history read, and a Pongo client setting to ignore hash mismatches.
- Make `dryRun` execute inside a transaction and roll back on every driver. PostgreSQL currently commits it. D1 rejects it, as Pongo does.

## Non-goals

- Do not change the default `autoMigration` value to `None`.
- Do not add a separate `verifyNoPendingMigrations()` or validation-result API; `ensureMigrated()` owns that behavior.
- Do not structurally inspect tables, functions, indexes, or other database objects.
- Do not treat migrations recorded in the database but absent from the current bundle as an error.
- Do not change `dryRun` into a no-execution operation.
- Do not compare connection strings or database metadata to decide whether two independently configured pools target the same physical database.
- Do not bundle processors that supply their own pool or connection, even when they happen to target the same database as the parent.
- Do not add arbitrary user-supplied Dumbo or Pongo extension schemas in this change. The schema graph must leave room for that later.
- Do not add relational migration behavior to MongoDB, EventStoreDB, or in-memory storage. The core registration behavior may be shared where applicable, but schema execution is limited to PostgreSQL and SQLite.
- Do not move `autoMigration` into Dumbo. The owner picks `migrate()` or `ensureMigrated()`.
- Do not share concurrent first calls through an in-flight promise, and do not retry them. When two first calls apply the same migration at the same time, one fails with Dumbo's `UniqueConstraintError`. This matches Dumbo and Pongo.

## Existing behavior to preserve

- An explicit `schema.migrate()` call runs even when `autoMigration` is `None` or `EnsureMigrated`.
- `None` runs no automatic schema work, as today.
- Automatic event-store migration is lazy and memoized per bound event-store instance. The first store operation calls `init()` when nobody called it.
- A non-dry migration is not executed repeatedly by normal operations on the same bound instance.
- `dryRun` does not mark the schema as migrated.
- Migration failures use the current Dumbo transaction and rollback behavior.
- `onBeforeSchemaCreated` and `onAfterSchemaCreated` run once per bound event-store instance, inside the migration transaction, even when nothing is pending.
- Processor initialization remains one-time per processor instance.
- Processors with their own storage configuration initialize against their own storage.

## Core schema contribution

Emmett core must allow a projection definition to carry a schema value, and a message processor to expose the schema it contributes to its consumer, without importing Dumbo or defining a second schema abstraction. Every processor accepts an optional `schema` in its options. A projector takes its projection's schema when it sets none. A reactor or workflow processor sets one only when it has its own non-projection storage, for example a deduplication table. A processor exposes it because a consumer also receives already-built processors through its `processors` array and cannot see their projections. Add a generic schema parameter directly to the existing types:

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

The PostgreSQL and SQLite adapters define a projection capability `withDefaultSchemaName(databaseSchemaName: string)`. It returns a rebuilt projection definition that uses that name for every table the definition does not place in its own schema, in its `schema` component and in its handlers. It follows Dumbo's `databaseComponent.withDefaultSchemaName`: an explicit schema in the definition wins. Pongo and raw SQL projections have it.

When an event store adds its projection registrations, it calls `withDefaultSchemaName` on each projection that has it, with `projectionsDatabaseSchemaName`, else `databaseSchemaName`. With neither set, it does not call it. Then it adds the rebuilt projection's `schema` unchanged, and the rebuilt projection is the one that gets registered, initialized, and handled.

- A Pongo projection uses the name as the `defaultSchemaName` of its Pongo database. Its `schema` is the component that a Pongo database with that `defaultSchemaName` holds for its collection, so Pongo places the collection and adds the `CREATE SCHEMA` migration for a named schema.
- A raw SQL projection takes its `schema` as a Dumbo database component and calls `withDefaultSchemaName` on it. Its table components can carry raw migration SQL, `tableComponent({ tableName, migrations: (fullName) => [...] })`, and Dumbo passes the placed table name. Its handlers keep the schema name from the handler context, as today. SQL that is not tied to a table, such as a view, names its schema itself.
- A projector that a user builds and passes to a consumer's `processors` array keeps the projection it was given. The user calls `withDefaultSchemaName` on the projection or sets the schema in its definition.

Do not introduce a core `RelationalSchema`, migration facade, or duplicate component wrapper.

## Storage-agnostic Dumbo components

Keep Dumbo's existing `SchemaComponent` and `AnySchemaComponent` storage-agnostic. A component describes migrations but does not own a pool, connection, transaction, or driver. Do not add a driver generic, runtime driver discriminator, or supported-driver list to the component API for this change.

The concrete event store or consumer binds the composed component graph to its own storage and driver when it renders or executes migrations. Bundling is therefore decided by storage ownership:

- A child is bundleable only when it uses the parent's inherited pool/session.
- A processor with explicit connection options, pool, Dumbo instance, or connection owns separate storage and is excluded from the parent bundle.
- Do not compare connection strings. Two distinct pools cannot share the parent's active migration transaction even when they target the same database.
- Existing Dumbo SQL rendering and execution behavior determines whether a component's migrations can run with the bound parent's driver; this change does not add a separate compatibility protocol.
- The processor knows whether it uses its own storage: the relational processors resolve their own pool from `pool`, `connectionOptions`, or `connectionString` when they are created. A built processor shows it through the shape of its `schema`: a processor that shares the consumer's pool exposes a Dumbo component, and a processor with its own storage exposes the owner shape (`component`, `sql`, `print`, `migrate`, `ensureMigrated`). The consumer tells them apart with Dumbo's `isSchemaComponent`. Pongo uses the same idea: `collection.schema` delegates `migrate` to its owning database.

## Done in Pongo PR #225

[Pongo PR #225](https://github.com/event-driven-io/Pongo/pull/225) implements the Dumbo and Pongo parts. Emmett uses them as they are and does not add a wrapper.

### Dumbo `SchemaComponentMigrator`

```ts
export type SchemaComponentMigrator<
  Component extends AnySchemaComponent = AnySchemaComponent,
> = Readonly<{
  component: Component;
  sql(): string;
  print(): void;
  migrate(
    options?: Pick<
      MigratorOptions,
      'execute' | 'dryRun' | 'ignoreMigrationHashMismatch' | 'migrationTimeoutMS'
    >,
  ): Promise<RunSQLMigrationsResult>;
  ensureMigrated(
    options?: Pick<
      MigratorOptions,
      'dryRun' | 'ignoreMigrationHashMismatch' | 'migrationTimeoutMS'
    >,
  ): Promise<void>;
}>;

export const schemaComponentMigrator = <Component extends AnySchemaComponent>(
  options: MigratorOptions & { pool: Dumbo; component: Component },
): SchemaComponentMigrator<Component>;
```

An owner uses it like this:

```ts
const migrator = schemaComponentMigrator({
  pool,
  component,
  migrationTable,
});

// automatic assurance
if (autoMigration === 'CreateOrUpdate') await migrator.migrate();
else if (autoMigration === 'EnsureMigrated') await migrator.ensureMigrated();
```

The behavior is:

- The pool, the component graph, and the `MigratorOptions` (migration table, executor, lock, transaction options, dry run, hash ignore, timeout) are fixed when the migrator is created. To change the graph or the migration table, the owner creates a new migrator.
- Per-call options override the configured ones. A per-call `undefined` keeps the configured value.
- `migrate()` and `ensureMigrated()` run the same check first. It reads the migration history on the configured executor or on the pool, without a transaction, DDL, or migration lock. A missing history table counts as empty history. Recorded migrations that are not in the graph are ignored. Migrations whose SQL renders to nothing are ignored.
- The check compares each expected migration with its record:
  - no record: pending;
  - same hash: applied;
  - different hash: throws `InvalidOperationError` (`Migration hash mismatch for "<name>". Aborting migration.`) before any write;
  - different hash, with `ignoreMigrationHashMismatch` on the migrator or `ignoreHashMismatch` on the `sqlMigration`: counts as applied, the tracer logs `migration-hash-mismatch`, and the recorded hash stays unchanged.
- `ensureMigrated()` never writes. When something is pending, it throws `PendingMigrationsError`, and `pendingMigrations` holds the pending `SQLMigration` values.
- When nothing is pending, `migrate()` returns `{ applied: [], skipped }` without writing. Otherwise, it takes the migration lock (PostgreSQL advisory lock; no lock on SQLite) and creates the history table if needed. For each pending migration, it then runs one batch: the history record first, then the migration SQL. It runs in a new transaction, or on the caller's `execute`.
- Concurrent first calls both find the migration pending. The first one applies it. The second one fails with `UniqueConstraintError` on the history `name` column, and its transaction rolls back. There are no retries.
- When the check finds nothing pending, or `migrate()` applies the pending migrations, the migrator remembers it. Later calls return without database access. A `migrate()` dry run, a `migrate()` with a per-call `execute`, and a failed call are not remembered. Concurrent calls do not share an in-flight promise.
- `migrate({ dryRun: true })` executes in a transaction and rolls back.
- `sql()` and `print()` describe only the component graph's migrations. They exclude the history table, the lock, and the history records.
- A migration name longer than 255 characters fails with `InvalidOperationError`. A database type without registered metadata or default migrator options fails with `NotRegisteredError`.

Dumbo also provides schema-inspection helpers with a `{ databaseSchemaName }` option, for tests. PostgreSQL has `schemaExists`, `tableExists`, `columnExists`, `functionExists`, `indexExists`, and `sequenceExists`. SQLite has `tableExists`, `columnExists`, and `indexExists`, tested on sqlite3, D1, and Durable Objects.

For PostgreSQL migrations, `createFunctionIfDoesNotExistSQL(functionName, functionDefinition, { databaseSchemaName })` wraps a function definition in a `DO` block that runs it only when the function is missing. Without `databaseSchemaName`, it checks `current_schema()`.

### Pongo

- `PongoDb.schema` exposes `component`, `sql()`, `print()`, `migrate()`, and `ensureMigrated()`, plus `migrations` and `renameCollection()`. One `SchemaComponentMigrator` per database backs it. Registering or renaming a collection replaces the migrator.
- `db.schema.ensureMigrated()` runs only the read-only check, whatever the `autoMigration` setting is.
- Before collection operations and before `db.sql.query()` and `db.sql.command()`, Pongo runs automatic assurance: `migrate()` under `CreateOrUpdate`, `ensureMigrated()` under `None`.
- `db.schema.migrate({ session })` runs in the session's active transaction. Automatic assurance runs in its own migration transaction.
- `collection.schema.component` is the declarative contribution that Emmett composes. `collection.schema.migrate()` is deprecated, not removed. It calls `db.schema.migrate()` and migrates the whole database.
- `PongoMigrationOptions` no longer accepts `migrationTable`. The migration table comes from the client or database options.
- On D1, Pongo creates the migrator with `{ execute: pool.execute, transactionOptions: { mode: 'strict' } }`. Migrations run directly on the pool, and dry runs are rejected. The history record and the migration SQL are in one batch, so D1 applies them together or not at all.
- Docs: `src/docs/schema-migrations.md`, `src/docs/getting-started.md`, the root `README.md`, and `src/packages/dumbo/README.md`.

## Changes in Dumbo and Pongo

These changes go into the Dumbo and Pongo repository, in parallel with the Emmett work. Emmett does not wait for them. Emmett adopts them when a Dumbo and Pongo release includes them.

### Dumbo

- `MigrationStyle` becomes `'None' | 'EnsureMigrated' | 'CreateOrUpdate'`.
- The per-call options of `SchemaComponentMigrator.migrate()` get `overrideMigrationHashes`. On a hash mismatch, `migrate()` writes the computed hash into the history record and does not run the migration SQL again. It does this under the migration lock, in the migration transaction. The option is per call only: it is not in `MigratorOptions`, and `ensureMigrated()` does not take it.
- The option is a union with `ignoreMigrationHashMismatch`. `overrideMigrationHashes: true` is allowed only when `ignoreMigrationHashMismatch` is `true` or not set:

  ```ts
  type MigrationHashMismatchOptions =
    | { ignoreMigrationHashMismatch?: boolean; overrideMigrationHashes?: false }
    | { ignoreMigrationHashMismatch?: true; overrideMigrationHashes: true };
  ```

- Tests: change a recorded hash, call `migrate({ overrideMigrationHashes: true })`, and check that the record has the computed hash, that no migration SQL ran again, and that a later `ensureMigrated()` without options passes. A type test checks that `{ ignoreMigrationHashMismatch: false, overrideMigrationHashes: true }` does not compile.

### Pongo

- Automatic assurance calls `migrate()` under `CreateOrUpdate`, `ensureMigrated()` under `EnsureMigrated`, and nothing under `None`. Under `None`, Pongo reads no migration history.
- The client and database options get `schema.ignoreMigrationHashMismatch?: boolean`. Pongo passes it to the configuration of each database's `SchemaComponentMigrator`, so automatic assurance, `db.schema.migrate()`, and `db.schema.ensureMigrated()` all use it. A per-call `ignoreMigrationHashMismatch` still overrides it.
- `db.schema.migrate()` takes the per-call `overrideMigrationHashes` option, with the same union type, and passes it to Dumbo.
- Tests: under `None`, a collection operation on a database with no migration table succeeds or fails on the missing table, and creates no migration table; under `EnsureMigrated`, it throws `PendingMigrationsError`; with `schema.ignoreMigrationHashMismatch: true`, collection operations work after a recorded hash was changed; after `db.schema.migrate({ overrideMigrationHashes: true })`, collection operations work without any ignore option.
- Docs: the `autoMigration` values and the new options.

### Emmett before and after the release

- Before the release, Emmett core defines the `autoMigration` union itself. The Pongo clients that Emmett creates with `None` still read the migration history once per client, and they do not get the event store's hash-mismatch setting.
- After the release, Emmett uses Dumbo's `MigrationStyle` instead of its own union, and passes the event store's `ignoreMigrationHashMismatch` setting to every Pongo client that it creates for projections. `eventStore.schema.migrate()` and `consumer.schema.migrate()` take the per-call `overrideMigrationHashes` option and pass it to Dumbo.

## Storage-bound schema operations

Only objects that own or inherit a concrete relational pool expose schema operations. These are the owners: event stores, consumers, and processors with their own storage. Extend the existing PostgreSQL and SQLite event-store `schema` objects and add equivalent `schema` objects to their consumers and to processors with their own storage:

```ts
schema: {
  readonly component: AnySchemaComponent;
  sql(): string;
  print(): void;
  migrate(options?: MigrationOptions): Promise<RunSQLMigrationsResult>;
  ensureMigrated(): Promise<void>;
  // Event stores retain their existing `dangerous` operations.
};
```

This is the same shape as `PongoDb.schema`. `ensureMigrated()` is the read-only check under any `autoMigration` setting, as in Pongo.

Projections and processors that share the consumer's storage expose only their optional declarative `schema` component. They do not expose redundant `migrate()`, `sql()`, `print()`, verification, or `autoMigration` members. This is the same split as a Pongo collection's component inside its `PongoDb`.

`autoMigration` remains configuration on event-store, consumer, and processor registrations. Its effective value is resolved through the ownership chain; it is not a property required on every schema component.

The event store gets a public `init()`, with the same contract as the consumer's `init()`: it runs once per bound instance, and the first operation calls it when nobody did. It runs automatic assurance on the store's graph, then initializes the inline projection registrations. It does both under every `autoMigration` value; only the assurance step depends on the value.

The public schema methods are backed by the owner's current Dumbo `SchemaComponentMigrator`. The owner resolves its effective `autoMigration` value and uses it for automatic assurance: `migrate()` under `CreateOrUpdate`, `ensureMigrated()` under `EnsureMigrated`, nothing under `None`. Pongo's `ensureSchema` in `pongoDb.ts` is the reference. Dumbo implements the check, the migration, and the memoization once.

An owner's `sql()`, `print()`, `migrate()`, and `ensureMigrated()` operate on its complete grouped graph, not only its local tables. Its `migrate()` flattens that graph and calls the Dumbo migration runner once; it must not call migration methods of grouped children sequentially.

A processor with its own storage is a child owner of its consumer. Its storage is another pool, so it cannot join the consumer's transaction:

- The consumer's `migrate()` migrates its grouped graph in one transaction, then calls `schema.migrate()` on each child owner. That is one run per pool. There is no atomicity across them: when a child run fails, the consumer's run stays committed. A retry is safe, because recorded migrations are skipped.
- The consumer's `ensureMigrated()` checks its grouped graph, then calls `schema.ensureMigrated()` on each child owner.
- The consumer's `init()` runs automatic assurance on its grouped graph, then initializes its processors. A child owner runs its own automatic assurance in its own initialization.
- The consumer's `sql()` and `print()` show the SQL of its grouped graph only. A child owner shows its own through its `schema.sql()` and `schema.print()`.

## Schema graph and ownership

Every schema owner has a local component and zero or more child components. Components are composed in this order:

1. Event-store schema.
2. Consumer infrastructure owned by that event store or consumer, including processor checkpoint and projection-registration storage.
3. Registered processor and projection schemas in registration order.

The same order is used by `sql()`, `print()`, `migrate()`, and `ensureMigrated()`.

The event-store schema graph contains:

- The local event-store component.
- Every schema-aware inline projection registered on the event store.
- Every schema-aware async projection registered on the event store.

The consumer schema graph contains:

- The event-store component when the consumer was created by an event store.
- The consumer's local relational infrastructure.
- The schema of every processor registered on the consumer that uses the inherited consumer pool, whether it came through the `processors` array or a `projector()`, `reactor()`, or `workflowProcessor()` call.

The graph of a processor with its own storage contains only its own schema, aggregated as the reusable component does. Emmett does not create checkpoint, lock, or projection-registration tables on that storage; the user sets them up. On the consumer's storage, the event store or the consumer creates them through the event-store component. See [Future improvements](#future-improvements).

The event store and the consumer each group their graph with one reusable event-store schema component, the same for PostgreSQL and SQLite, modeled on Pongo's `PongoDatabaseComponent`:

- It starts from the event-store migrations.
- Adding a schema adds the component as a child, unchanged. The reusable component does not place tables. Then it replaces its migrator, as `PongoDatabaseComponent.replaceComponent` does. Adding the same component instance again changes nothing.
- An added component provides its full schema: its tables with their database schema names, and the migration that creates a non-default database schema. A Dumbo `databaseSchemaComponent` or `databaseComponent` generates that `CREATE SCHEMA` migration; a bare table component does not. A raw SQL projection names its tables the same way in its migrations and in its handler SQL.
- It exposes `component`, `migrations`, and `migrator`. The owner picks the call on that migrator from its effective `autoMigration`.
- Each owner holds its own instance, because the migration memo belongs to the owner, as with one `PongoDatabaseComponent` per `PongoDb`.

Grouping happens at registration, as in Pongo's `db.collection()`. The event store adds its projection registrations at construction. The consumer adds a processor's schema at construction for its `processors` array and in `register` for later calls. A processor with its own storage builds its graph from its own schema when it is created.

The event store and a consumer that it created both contain the event-store schema and, for automatically registered projectors, the same projection schemas. Each owner runs its own assurance once per instance. Whichever runs second reads the migration history and applies nothing, because the migration names are the same. A Pongo application with two `PongoDb` instances on one database behaves the same way. See [Future improvements](#future-improvements).

Components are flattened and deduplicated through Dumbo's component and migration utilities. The same migration name with equivalent SQL is included once. Dumbo's existing component composition rejects conflicting SQL for the same migration name before database execution rather than silently selecting one definition.

All migrations in a bundle use the parent's configured migration table and the parent's active transaction executor. This removes the current nested Pongo migration runner and ensures the migration table is checked or created once per bundle.

## Binding and memoization

A projection definition and its declarative component can be reused with different stores and databases, so migration state must never be stored globally on either object. Each storage-bound owner composes its current graph and creates a `SchemaComponentMigrator` for that graph and inherited storage target.

The migrator owns the completed state. Child initialization delegates to the owner's automatic assurance on the same migrator, so a successful parent migration or check satisfies later initialization within that graph. Emmett also creates event stores internally on an owner's storage, and they must not repeat the owner's work:

- The `withSession` store is the same event store on the session's connection, not a second instance. Inside `getPostgreSQLEventStore` and `getSQLiteEventStore`, a local function builds the store object for a given pool. The store uses it with its own pool, and `withSession` uses it with the session's connection. Both share one `init()`, so a session runs no assurance and no inline `init` of its own.
- The processing-scope `messageStore` gets `autoMigration: 'None'`, no `projections`, and no `hooks`, as today. Its `init()` therefore does nothing.

When registration changes the graph, the owner composes the new graph and replaces its current migrator, as `PongoDatabaseComponent` does. An event store has no registration after construction, so its migrator is fixed; a consumer replaces its migrator when a processor registration adds a schema. The new migrator checks the complete plan on first use. Recorded migrations are skipped, and new migrations are applied or reported as pending according to `autoMigration`.

The following operations do not mark a schema as migrated:

- `sql()`
- `print()`
- `migrate({ dryRun: true })`
- A failed migration
- A failed read-only assurance

## `autoMigration` resolution

Resolve the effective value through the ownership chain:

```text
event store → consumer → processor
```

The rules are:

- A root Pongo database, event store, or standalone consumer defaults to `CreateOrUpdate`.
- An omitted child value inherits its parent's effective value.
- An explicit child value overrides the inherited value.
- A processor with separate storage runs its own assurance with its effective value: its own value, else its consumer's, else its event store's, else `CreateOrUpdate`.
- A processor that shares the consumer's storage also accepts `autoMigration`, but the consumer's single call covers its schema, so the value has no effect there. A Pongo collection works the same way: its database's value covers it.
- `EnsureMigrated` prevents automatic migration, migration-table creation, and migration-lock acquisition. Automatic assurance calls `ensureMigrated()` instead, which reads the existing migration history and throws `PendingMigrationsError` when the effective graph has not been applied.
- `None` prevents all automatic assurance. It does not read the migration history.
- An explicit `schema.migrate()` still runs under `None` and `EnsureMigrated`.

Automatic migration triggers remain consistent with current event-store behavior:

- An inline projection is covered by the event store's `init()`, which runs before the first store operation when nobody called it. Projection handling itself never invokes initialization per event or batch.
- A consumer runs automatic assurance for its effective graph during initialization/start.
- A processor with separate storage runs automatic assurance on its own migrator during initialization.

## Projection and processor initialization

Schema composition and lifecycle initialization are coordinated but are not the same operation.

- Built-in Pongo projections expose their collection through `schema`, the component of their Pongo database for their default schema name, instead of calling the deprecated `collection.schema.migrate()`.
- Initialization delegates to the storage-bound owner's automatic assurance rather than calling child migration methods.
- With effective `CreateOrUpdate`, the owner calls `migrate()`, which lazily applies pending migrations.
- With effective `EnsureMigrated`, the owner calls `ensureMigrated()`, which performs the read-only migration-history check and throws when migrations are pending.
- With effective `None`, the owner runs no assurance.
- When the current migrator has already completed migration or read-only assurance, later initialization does not access migration history again.
- Non-schema initialization retains its existing once-per-instance behavior.
- Existing schema-unaware processors and projections continue to use their current `init` behavior and cannot contribute imperative work to a declarative bundle.
- Processors with separate storage are not included in the parent bundle. They run their own automatic assurance during initialization, then initialize normally against their own storage.

Projection `init` is lifecycle work, not migration. The relational projection wrapper registers the projection in the projections table (an idempotent upsert), and then the definition's own `init` runs. Today the event store calls inline `init` inside its migration transaction, because built-in Pongo projections created their collections there. Once collections come from schema components, `init` no longer belongs to migration:

- An event store initializes its inline registrations in `init()`, once per bound instance, after automatic assurance and under every `autoMigration` value. `schema.migrate()` only migrates.
- An async registration is initialized by its projector's `onInit`, as today. The event store does not initialize it again.
- Initialization runs in its own transaction and never executes DDL.

PostgreSQL projection metadata registration must use the registration's actual `registrationType`; it must not hardcode `async`. SQLite inline initialization must report `inline`; it must not report `async`. The registered definition does not include the projection's `schema` component.

## Event-store async projection registration

Keep the existing event-store projection registration shape. An async entry contains only its projection definition:

```ts
projections: [
  ...projections.inline([ordersSummary]),
  ...projections.async([billingSummary]),
];
```

Do not add full processor options to the async projection registration. When an event store creates a consumer with `processors` omitted, it builds one projector per async projection and passes them as the consumer's `processors` array. Each one gets the same defaults as an explicit `consumer.projector({ projection })` call.

That requires a consumer's settings to reach processors from its `processors` array, not only processors created through its factories. Today a relational processor resolves its migration options when it is created, and the processing scope overrides the consumer's context with them. An array processor in a consumer with a custom schema therefore uses the default schema for its lock and checkpoints. A relational processor without its own migration options must take them from its consumer when it is initialized. A processor with its own storage and no `autoMigration` value takes the consumer's effective value the same way. A processor that shares the consumer's pool runs no assurance of its own.

The core `projections.async()` helper currently returns registrations typed and valued as `inline`; correct it to return `async`.

## Consumer processor defaults and replacement

Use the existing `processors` option to control automatic registration; do not add an inherit/include flag.

- `eventStore.consumer()` with `processors` omitted starts with projector processors derived from the event store's async projection definitions.
- `eventStore.consumer({ processors: [...] })` treats the provided array as the complete initial processor set and does not automatically register event-store async projections.
- `processors: []` explicitly starts with no processors.
- Calls to `consumer.projector()`, `consumer.reactor()`, and `consumer.workflowProcessor()` after construction remain additive.
- When a registration has the same processor ID as an earlier processor, replace the earlier processor at its position rather than retaining both or throwing.

The replacement is based on processor ID, not object identity. Today `register` dedupes by object identity only, so two objects with one ID both run. Automatically registered projectors are ordinary processors in the `processors` array; the consumer does not track where a processor came from. No existing test registers two processors with one ID in one consumer.

The replacement belongs in core `register`, so non-relational event stores can use it. The schema contribution and migration behavior remains relational.

## Read-only assurance under `EnsureMigrated`

Under `EnsureMigrated`, automatic assurance calls `ensureMigrated()`. It does not need a separate validation method or result object:

```ts
await schema.ensureMigrated();
```

This call reads the configured migration table without creating it or any other database object. Dumbo's check (see [Done in Pongo PR #225](#done-in-pongo-pr-225)) compares expected migrations from the effective graph with recorded migrations, applies the hash rule, and ignores historical records absent from the graph. A missing migration table makes every expected migration pending. If anything is pending, the call throws `PendingMigrationsError` with the pending migration list. A hash mismatch that is not ignored throws `InvalidOperationError`. Otherwise, the call resolves and memoizes success.

The operation must work for PostgreSQL runtime roles that have DML and `EXECUTE` privileges but no namespace `CREATE` privilege.

## Ignoring a migration hash mismatch

Dumbo does not repair a recorded hash when it ignores a mismatch. The record keeps the wrong hash, and every later check that runs without the option throws `InvalidOperationError` again. So a per-call `migrate({ ignoreMigrationHashMismatch: true })` lets only that call pass.

To keep an application working with a wrong recorded hash, the user sets it as configuration:

```ts
const eventStore = getPostgreSQLEventStore({
  driver: pgEventStoreDriver,
  connectionString,
  schema: { ignoreMigrationHashMismatch: true },
});
```

- The PostgreSQL and SQLite event stores accept `schema.ignoreMigrationHashMismatch?: boolean`. The store puts it into the configuration of its `SchemaComponentMigrator`, so `init()`, `schema.migrate()`, and `schema.ensureMigrated()` use it.
- A per-call `ignoreMigrationHashMismatch` on `schema.migrate()` overrides it for that call.
- A consumer takes the value of the event store that created it. A processor with its own storage takes its consumer's value.
- The Pongo clients that Emmett creates for projections get the value after Emmett adopts the Pongo release from [Changes in Dumbo and Pongo](#changes-in-dumbo-and-pongo).

To repair the recorded hashes, the user calls `migrate()` once with `overrideMigrationHashes`. After that, no ignore option is necessary:

```ts
await eventStore.schema.migrate({ overrideMigrationHashes: true });
```

- `eventStore.schema.migrate()` and `consumer.schema.migrate()` accept it after Emmett adopts the Dumbo release from [Changes in Dumbo and Pongo](#changes-in-dumbo-and-pongo).
- It is per call only. The event store and consumer options do not have it.

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
  schema: { autoMigration: 'EnsureMigrated' },
});

await eventStore.schema.migrate();
```

The call applies the event-store schema and both projection schemas in one migration run even though automatic migration is disabled.

### Use the event store's async projections as consumer defaults

```ts
const consumer = eventStore.consumer();
await consumer.start();
```

The consumer registers `billingSummary` as a projector with default processor settings. With inherited `autoMigration: 'EnsureMigrated'`, startup checks migration history without executing DDL and throws if the effective graph has pending migrations.

### Replace automatic processors completely

```ts
const consumer = eventStore.consumer({ processors: [] });

consumer.projector({
  processorId: 'billing-summary-v2',
  projection: billingSummary,
  startFrom: 'BEGINNING',
});
```

Because `processors` was explicitly provided, no async projection processors are added automatically.

### Ensure migration state without DDL

```ts
await eventStore.schema.ensureMigrated();
```

Under any `autoMigration` setting, this reads migration history only and throws `PendingMigrationsError` when necessary. It does not behave like `dryRun` and does not require DDL privileges.

### Fail fast at startup

```ts
await eventStore.init();
```

The call runs automatic assurance and initializes the inline projections. Under `EnsureMigrated`, it throws `PendingMigrationsError` at startup instead of at the first append.

### Project into another database

```ts
const consumer = eventStore.consumer({ processors: [] });

consumer.projector({
  projection: cartsSummary,
  connectionOptions: { connectionString: readModelsConnectionString },
});

await consumer.schema.migrate();
```

The consumer migrates its own graph on the event-store database in one transaction. Then it calls `schema.migrate()` on the projector, which migrates the projector's graph on the read-models database in a second transaction. That graph holds only the projection's tables; the checkpoint tables on the read-models database are set up by the user.

## Actionable code changes

### Emmett core

- Update `src/packages/emmett/src/projections/index.ts`:
  - Add a schema generic to `ProjectionDefinition` without importing Dumbo.
  - Allow projection definitions to expose an optional schema value while preserving existing inference and default type arguments.
  - Fix `asyncProjections()` to return `ProjectionRegistration<'async'>` values with `type: 'async'`.
- Update `src/packages/emmett/src/processors/processors.ts`:
  - Add the corresponding schema generic and optional schema value to message processors and their options. `projector()` takes its projection's schema when its options set none.
  - Add `autoMigration` to processor options.
  - Define the `autoMigration` union `'None' | 'EnsureMigrated' | 'CreateOrUpdate'` once and use it in core, PostgreSQL, and SQLite options instead of Dumbo's `MigrationStyle`, until Emmett uses the Dumbo release that has `EnsureMigrated`.
  - Keep normal processor initialization one-shot.
- Update `src/packages/emmett/src/consumers/consumers.ts`:
  - Replace a registered processor when a later registration has the same ID.
  - Preserve explicit additions and the existing start/close behavior.
  - Do not add a projections option; automatically registered projectors arrive through the existing `processors` array.

### Dumbo and Pongo

- Done in [Pongo PR #225](https://github.com/event-driven-io/Pongo/pull/225). See [Done in Pongo PR #225](#done-in-pongo-pr-225). Update Emmett's Dumbo and Pongo dependencies to a release that includes it.
- Make the changes in [Changes in Dumbo and Pongo](#changes-in-dumbo-and-pongo) in the Dumbo and Pongo repository. When a release includes them, update Emmett's dependencies, replace Emmett's `autoMigration` union with Dumbo's `MigrationStyle`, pass the event store's `ignoreMigrationHashMismatch` setting to the Pongo clients that Emmett creates, and pass the per-call `overrideMigrationHashes` option from `eventStore.schema.migrate()` and `consumer.schema.migrate()` to Dumbo.

### Emmett test support

- Delete `emmett-postgresql/src/testing/schemaObjects.ts`, including its `TODO`. Import `schemaExists`, `tableExists`, `functionExists`, `indexExists`, and `sequenceExists` from `@event-driven-io/dumbo/pg`. The schema name moves from the third positional argument to an options object: `tableExists(execute, name, schema)` becomes `tableExists(execute, name, { databaseSchemaName: schema })`. Six spec files import from `schemaObjects.ts`.
- Without a schema name, Emmett's helpers search `current_schema()`, and Dumbo's search `current_schemas(false)`, which is every schema on the `search_path`. The results are the same unless a test puts more than one schema on the `search_path`.
- In SQLite specs, replace `tableExists(execute, sqliteTableName({ databaseSchemaName, tableName }))` with `tableExists(execute, tableName, { databaseSchemaName })`, from `@event-driven-io/dumbo/sqlite`. Do the same for `indexExists`.
- In `0_42_0.migration.int.spec.ts`, replace the four `information_schema.columns` queries with `columnExists(pool.execute, 'emt_processors', 'created_at')` and the like, from `@event-driven-io/dumbo/pg`.
- `messagesPollIndex.int.spec.ts` keeps its `pg_class` query. It reads the partitioned index tree, not whether an object exists.

### PostgreSQL

- Add the reusable event-store schema component in `src/packages/emmett-postgresql/src/eventStore/schema/eventStoreSchemaComponent.ts`, modeled on `PongoDatabaseComponent`. It starts from the current event-store migration array. The event store and the consumer each hold an instance.
- Delete `src/packages/emmett-postgresql/src/eventStore/schema/createFunctionIfDoesNotExist.ts` and import `createFunctionIfDoesNotExistSQL` from `@event-driven-io/dumbo/postgresql`. The schema name moves from the third positional argument to `{ databaseSchemaName }`. The default schema stays `current_schema()`. Dumbo renders the same SQL text as Emmett's helper, and a Dumbo unit test pins that text, so recorded migration hashes still match.
- Update `src/packages/emmett-postgresql/src/eventStore/postgreSQLEventStore.ts` to:
  - Accept and retain both inline and async projection registrations.
  - Compose both kinds of schema-aware projection components.
  - Run one migration plan.
  - Add a public `init()` that runs automatic assurance, then initializes inline registrations, once per instance. The first store operation calls it when nobody did.
  - When `processors` is omitted, pass one projector per async projection definition as the created consumer's `processors`.
  - Create the composed `SchemaComponentMigrator` once and expose it through the existing event-store schema object.
  - Replace lazy event-store migration with automatic assurance: `migrate()` under `CreateOrUpdate`, `ensureMigrated()` under `EnsureMigrated`, nothing under `None`.
  - Build the store object in a local function of the pool. `withSession` uses it with the session's connection, so the session shares the store's `init()`.
  - Accept `schema.ignoreMigrationHashMismatch` and put it into the migrator configuration.
- Update `src/packages/emmett-postgresql/src/eventStore/consumers/postgreSQLEventStoreConsumer.ts` to:
  - Resolve inherited `autoMigration` and `ignoreMigrationHashMismatch`.
  - Group the schemas of same-pool processors in its event-store schema component instance, from the `processors` array and from `projector()`, `reactor()`, and `workflowProcessor()` calls.
  - Pick the automatic assurance call from the effective `autoMigration` value, and expose `component`, `sql`, `print`, `migrate`, and `ensureMigrated`.
  - Call `schema.migrate()` and `schema.ensureMigrated()` on processors with their own storage after its own run.
- Update `src/packages/emmett-postgresql/src/eventStore/consumers/postgreSQLProcessor.ts` to:
  - Expose its schema from a processor that shares the consumer's pool.
  - Make a processor with its own storage an owner: a migrator over its own schema, the `schema` operations as its `schema` value, and automatic assurance in its initialization, with `autoMigration` inherited from the consumer when it sets none.
  - Take migration options from the consumer at initialization when the processor sets none.
  - Avoid nested/repeated migration after a successful parent bundle.
- Update `src/packages/emmett-postgresql/src/eventStore/projections/postgreSQLProjection.ts` to use the supplied registration type instead of hardcoding `async`.
- Update Pongo projection factories under `src/packages/emmett-postgresql/src/eventStore/projections/pongo/` to expose collection schema components and remove their dependency on the deprecated `collection.schema.migrate()`.
- Reuse one Pongo client per storage instead of creating one per batch: one client on the event store's database for inline projections, and one client created from the projector's pool in its initialization for async projections. How the batch transaction reaches a reused client needs a check. When this costs too much, it moves to [Future improvements](#future-improvements).

### SQLite

- Add the reusable event-store schema component in `src/packages/emmett-sqlite/src/eventStore/schema/eventStoreSchemaComponent.ts`. It starts from the current event-store migration array.
- Update `src/packages/emmett-sqlite/src/eventStore/SQLiteEventStore.ts` with the same composition, `autoMigration` handling, async registration, and schema API behavior as PostgreSQL.
- Update `src/packages/emmett-sqlite/src/eventStore/consumers/sqliteEventStoreConsumer.ts` and `sqliteProcessor.ts` with the same `SchemaComponentMigrator`, replacement, consumer, and processor behavior.
- Correct inline projection initialization to use `registrationType: 'inline'`.
- Update Pongo projection factories under `src/packages/emmett-sqlite/src/eventStore/projections/pongo/` to contribute collection schema components without calling the deprecated `collection.schema.migrate()`, and reuse Pongo clients as in PostgreSQL.
- Apply the behavior to sqlite3, D1, and Durable Object driver variants through shared code, with driver-specific integration coverage.
- On D1, create the migrator with the same options as Pongo's D1 driver: `{ execute: pool.execute, transactionOptions: { mode: 'strict' } }`.

### Documentation

Pongo and Dumbo docs are done in PR #225. The items below are for Emmett's docs.

- Document declarative schema components separately from the storage-bound event-store and consumer schema operations in both package READMEs and `src/docs`.
- Explain `autoMigration` inheritance and explicit overrides.
- Explain that automatic assurance calls `migrate()` under `CreateOrUpdate`, `ensureMigrated()` under `EnsureMigrated`, and nothing under `None`, and distinguish the read-only `ensureMigrated()` from `dryRun`.
- Show one-call provisioning for inline and async projections.
- Show the omitted-versus-provided `processors` behavior.
- State that independently configured processor storage is not included in the parent bundle, and that the consumer's `schema.migrate()` migrates it in a separate run.
- Show `eventStore.init()` for fail-fast startup.

## Test-first implementation order

The order below follows real dependencies and starts with isolated quick wins. Each item begins with a failing test and ends with the smallest implementation needed to pass it; it is not a set of release phases. The Dumbo and Pongo items are done in [Pongo PR #225](https://github.com/event-driven-io/Pongo/pull/225), so the list covers Emmett only. Items 1–3 do not need the new Dumbo and Pongo release. The other items do.

1. Add core unit tests proving `projections.async()` returns `type: 'async'` with the correct TypeScript registration type, then correct the helper.
2. Add core consumer tests for replacement of a registered processor by a later registration with the same ID, from the array or from a factory, then implement it in `register` without changing unrelated lifecycle behavior.
3. Add PostgreSQL and SQLite tests that expose the current registration-type errors: PostgreSQL must persist the supplied inline/async type, and SQLite inline initialization must receive `inline`. Fix those two localized defects.
4. Update Dumbo and Pongo to the release with PR #225. Replace `emmett-postgresql/src/testing/schemaObjects.ts` with Dumbo's schema-inspection helpers, keeping the existing tests green.
5. Add Emmett compile-time tests for the new projection and processor schema generics using a structural `AnySchemaComponent` fixture. Add composition tests proving existing Dumbo components remain unchanged and are bound only when collected by a storage owner; do not publish an Emmett-specific wrapper or add driver metadata to Dumbo components.
6. Add PostgreSQL schema tests proving the event-store migration component produces the same SQL migrations as the current array. Extract the component while keeping existing `schema.sql()` and `schema.migrate()` tests green.
7. Repeat the same component-equivalence test and extraction for shared SQLite schema code before testing individual SQLite drivers.
8. Add Pongo projection tests proving each built-in projection exposes the expected collection component without opening a migration transaction or calling the deprecated `collection.schema.migrate()`. Refactor the PostgreSQL and SQLite Pongo factories to use that component.
9. Add PostgreSQL integration tests showing one `eventStore.schema.migrate()` creates the event store plus inline and async Pongo projection tables through one migration runner and one transaction. Implement event-store component composition and create its `SchemaComponentMigrator`.
10. Add equivalent SQLite integration tests in shared suites and run them against sqlite3, D1, and Durable Object variants. Implement shared SQLite composition rather than duplicating it per driver.
11. Add tests for the API boundary: projections and same-pool processors expose only a declarative component, while event stores, consumers, and processors with their own storage expose `component`, `sql`, `print`, `migrate`, and `ensureMigrated`, like `PongoDb.schema`. A reactor with a schema on the consumer's pool is grouped like a projector. Assert that every storage-bound operation describes the same effective graph and that registration recreates the owner's immutable migrator.
12. Add `autoMigration` tests for root `CreateOrUpdate`, inherited `None` and `EnsureMigrated`, child override to `CreateOrUpdate`, child override to `None`, explicit migration under `None` and `EnsureMigrated`, independently configured processor storage that inherits the consumer's value, and a consumer `schema.migrate()` that also migrates a processor's own storage in a second run. Implement effective-value resolution once in Emmett core and use the result to pick `migrate()`, `ensureMigrated()`, or no call on each relational `SchemaComponentMigrator`.
13. Add initialization tests proving a successful parent migration or check satisfies later initialization on the same migrator, consumer start does not repeat it, inline handling never assures per event, `withSession` and processing-scope stores read no migration history and a session runs no inline `init`, graph replacement triggers a new check, separate-storage processors initialize independently, inline `init` runs once per store instance under every `autoMigration` value, explicit `eventStore.init()` runs assurance and inline `init` and the first operation does not repeat them, and an array processor takes its consumer's migration options.
14. Add a concurrency test on PostgreSQL and SQLite: two first automatic assurances on a fresh database, for example two consumer starts. One succeeds, the other fails with `UniqueConstraintError`, and the schema exists. This matches the Dumbo tests.
15. Add event-store consumer tests showing omitted `processors` passes projectors for async definitions with default settings, an explicit array suppresses defaults, and an explicit same-ID registration replaces an automatic projector.
16. Add least-privilege PostgreSQL integration coverage: migrate with a migration role, then start an event store and consumer with `autoMigration: 'EnsureMigrated'` under a role with DML and `EXECUTE` but no schema `CREATE`; assert that `ensureMigrated()` succeeds without DDL, migration-table creation, or lock acquisition. Add the pending-schema variant and assert the typed error identifies pending migrations.
17. Add tests confirming `dryRun` executes transactionally and rolls back (PostgreSQL now included; D1 rejects it), and that it does not satisfy parent or child migrators.
18. Rewrite the Pongo hash-mismatch tests (PostgreSQL, sqlite3, D1, Durable Objects): `migrate()` without the option throws, `migrate({ ignoreMigrationHashMismatch: true })` resolves, and the recorded hash stays unchanged. Add tests for the event store setting: with `schema.ignoreMigrationHashMismatch: true`, `init()` and `ensureMigrated()` pass after a recorded event-store hash was changed. After the Pongo release, add a test that an append with an inline Pongo projection works after a recorded collection hash was changed, and a test that `eventStore.schema.migrate({ overrideMigrationHashes: true })` repairs a changed event-store hash and a changed collection hash, so that a later `ensureMigrated()` without options passes.
19. Update documentation from the tested public examples, then run formatting/type checks and the smallest affected PostgreSQL and SQLite integration suites before the repository-wide unit and full test commands required for application-code completion.

## Acceptance criteria

- A PostgreSQL or SQLite event store with inline and async Pongo projections can create every required table through one `eventStore.schema.migrate()` call.
- The composed migration uses one Dumbo runner invocation, one configured migration table, and one transaction.
- Event stores and consumers use Dumbo's `SchemaComponentMigrator` from PR #225, without an Emmett-specific wrapper.
- Automatic assurance calls `migrate()` under `CreateOrUpdate`, `ensureMigrated()` under `EnsureMigrated`, and nothing under `None`. `ensureMigrated()` performs a read-only history check and throws `PendingMigrationsError` containing pending migrations.
- Successful migration or check is memoized per migrator, failures can retry, and dry runs never satisfy assurance. Concurrent first calls are not shared; one of them fails with `UniqueConstraintError`.
- Changing an owner's component graph recreates its immutable migrator, whose next assurance observes the new graph.
- `schema.sql()` and `schema.print()` exclude migration-history and lock bookkeeping.
- A projection or a processor on its consumer's pool contributes only a storage-agnostic Dumbo schema component; it does not expose a second migration facade.
- Any processor on its consumer's pool can contribute a schema; a projector contributes its projection's schema by default.
- `eventStore.init()` runs automatic assurance and inline projection initialization once per instance, and the first operation calls it when nobody did.
- `eventStore.schema.component` and `consumer.schema.component` expose their complete composed graphs.
- `eventStore.schema.sql()` includes event-store and registered projection migrations in ownership order.
- Built-in Pongo projections use `collection.schema.component` and do not call the deprecated `collection.schema.migrate()`.
- `eventStore.consumer()` automatically registers async event-store projections as default projectors.
- `eventStore.consumer({ processors: [] })` registers none of those defaults.
- A later processor registration replaces an earlier processor with the same ID, including an automatically registered one.
- A relational processor in the `processors` array uses its consumer's migration options unless it sets its own.
- A consumer created by an event store exposes a schema bundle containing the parent schema and same-storage processor schemas.
- Inline and async projection registration metadata uses the correct registration type.
- `autoMigration` defaults to `CreateOrUpdate` only at a root and otherwise inherits through event store → consumer → processor.
- `EnsureMigrated` causes consumer startup and processor initialization to avoid invoking any migration runner, migration-table DDL, or migration lock while still checking recorded migrations.
- `None` causes the event store, consumer startup, and processor initialization to run no assurance and to read no migration history.
- Explicit `schema.migrate()` works under `None` and `EnsureMigrated`.
- A child using an already satisfied owner migrator does not access migration history again during initialization in the same bound object graph.
- An explicitly configured processor pool is excluded from its parent's migration bundle and follows its own migration lifecycle. Its `autoMigration` defaults to the consumer's effective value. The consumer's `schema.migrate()` migrates it in a separate run after the consumer's own run.
- `schema.ignoreMigrationHashMismatch: true` on an event store makes its automatic assurance, `schema.migrate()`, and `schema.ensureMigrated()` pass a recorded hash mismatch. Its consumer takes the same value. A per-call option overrides it.
- After the Dumbo and Pongo release, `schema.migrate({ overrideMigrationHashes: true })` on an event store or a consumer writes the computed hashes into the history records, and later checks pass without any ignore option. `overrideMigrationHashes: true` together with `ignoreMigrationHashMismatch: false` does not compile.
- Read-only `ensureMigrated()` ignores extra historical migrations, respects the existing hash-ignore option, treats a missing migration table as all expected migrations pending, reports pending values through `PendingMigrationsError`, and throws `InvalidOperationError` for a hash mismatch that is not ignored.
- `dryRun` executes and rolls back on PostgreSQL, SQLite3, and Durable Objects, and is rejected on D1.
- Inline projection `init` runs once per event-store instance under every `autoMigration` value and never executes DDL. A `withSession` session shares it. `schema.migrate()` does not call it.
- Existing schema-unaware processors continue to initialize and process messages as before.

## Future improvements

- **One assurance for a store-created consumer.** A consumer created by `eventStore.consumer()` could start from the store's component and reuse the store's assurance, as the nested stores do. It would then run its own migration only for schemas that the store lacks, and skip one history read. The cost is a link between the consumer and the store.
- **Pongo client reuse.** If reusing Pongo clients per storage costs too much in this change, do it later.
- **Processor metadata storage.** A processor with its own storage needs checkpoints, a lock, and projection registration there. Today the user sets them up. Design a metadata storage that Emmett can migrate on any processor storage.
- **Duplicate processor IDs.** Two explicit registrations with one ID could throw instead of replacing. That needs the consumer to know which processors were registered automatically.

## Verification commands for implementation

Run focused tests as each behavior is introduced. From `src`, finish application-code work with:

```shell
npm run agent:check
npm run test:unit
npm test
```

Also run the focused PostgreSQL and SQLite integration files added for schema composition, assurance, `autoMigration` inheritance, async processor defaults, concurrency, and least-privilege startup.
