# PostgreSQL database schema support

## Scope

This plan implements [Emmett issue #95](https://github.com/event-driven-io/Emmett/issues/95) for PostgreSQL in one complete PR. SQLite will follow in a separate PR after the PostgreSQL behavior and public contract are stable.

The supporting analysis and accepted decisions are in [research.md](research.md).

The intended PostgreSQL API is:

```ts
getPostgreSQLEventStore(connectionString, {
  schema: {
    autoMigration: 'CreateOrUpdate',
    databaseSchemaName: 'events',
    projectionsDatabaseSchemaName: 'read_models',
    migrationTable: {
      schemaName: 'infrastructure',
      tableName: 'emmett_migrations',
    },
  },
});
```

All schema settings are optional. A common configuration only needs `databaseSchemaName`.

## Accepted behavior

1. Configuration belongs under the existing `schema` option. Schema selection is never inferred from the connection string or `search_path`.
2. `projectionsDatabaseSchemaName` falls back to `databaseSchemaName`.
3. `migrationTable.schemaName` falls back to `databaseSchemaName`; `migrationTable.tableName` is forwarded when supplied.
4. The event store and every PostgreSQL projection using Dumbo migrations, including Pongo, use one physical migration table.
5. An explicit Pongo collection `databaseSchemaName` overrides the projection default.
6. Emmett-owned tables, sequences, functions, calls, function bodies, dynamic SQL and catalog checks are explicitly qualified.
7. Pre-schema-support migrations remain unchanged on the default path and are omitted for configured schemas, which always start from the qualified current schema. No no-op history entries are recorded.
8. Default-schema SQL remains byte-identical where it participates in existing migration hashes and snapshots.
9. `schema.sql()` and `schema.print()` retain their current core-only meaning. They include creation of a configured event schema and the qualified current core objects, but not `dmb_migrations`, historical migration records or projection tables.
10. Resolved event, projection and migration-table schema information is exposed consistently to PostgreSQL projection contexts and schema hooks.
11. Changing `databaseSchemaName` selects a different store. Emmett does not move data between schemas.
12. Dumbo performs dialect-specific validation. Emmett does not normalize user schema names or invent a second validation subset.
13. Only an omitted schema name selects fallback or default behavior. Every supplied name, including `public`, remains explicit; Emmett does not compare it with `current_schema()`, `search_path` or a dialect default.

## Resolution contract

Add the public configuration type beside the current PostgreSQL schema options:

```ts
export type EventStoreDatabaseSchemaOptions = {
  databaseSchemaName?: string | undefined;
  projectionsDatabaseSchemaName?: string | undefined;
  migrationTable?: MigrationTableOptions | undefined;
};
```

Map it once when constructing the store. Keep the internal value small and expose the same immutable context value to hooks and projections:

```ts
type EventStoreDatabaseSchema = {
  databaseSchemaName: string | undefined;
  projectionsDatabaseSchemaName: string | undefined;
  migrationTable: MigrationTableOptions | undefined;
};
```

Resolve fallback from property presence only. Default-schema mode is selected only when `databaseSchemaName` is `undefined`. Do not inspect PostgreSQL metadata or compare supplied values with `public`, `current_schema()` or Dumbo's default-schema concepts.

Expected resolution:

| Input                          | Event objects | Projection default         | Migration table           |
| ------------------------------ | ------------- | -------------------------- | ------------------------- |
| all omitted                    | default       | default                    | Dumbo default             |
| `databaseSchemaName: 'events'` | `events`      | `events`                   | `events`                  |
| projection name only           | default       | explicit projection schema | Dumbo default             |
| migration name only            | default       | default                    | explicit migration schema |
| `databaseSchemaName: 'public'` | `public`      | `public`                   | `public`                  |

## Upstream follow-ups for Dumbo and Pongo

The first Emmett implementation needs a few small local helpers because Dumbo/Pongo do not yet expose the exact primitives. They should stay removable; once upstream support lands, Emmett should switch to those APIs instead of growing local abstractions.

Useful Dumbo follow-ups:

- Add a structured routine-name token, for example `SQLRoutineReference.from({ databaseSchemaName, routineName })`. This would replace Emmett's local `postgreSQLFunctionName` helper and avoid every consumer hand-rendering `schema.routine` from two identifiers.
- Add namespace-aware and signature-aware routine existence helpers. Emmett still has to guard `CREATE FUNCTION`, but the reusable behavior belongs with Dumbo's PostgreSQL catalog helpers.
- Consider a relation/regclass helper for sequence references used in defaults, such as `nextval(<qualified sequence>::regclass)`. Emmett currently keeps the default-schema literal byte-identical and uses PostgreSQL `format('%I.%I', schema, sequence)::regclass` for configured schemas, with values rendered through Dumbo literals because migration batches cannot carry prepared parameters.
- Consider a small PostgreSQL dynamic-SQL helper for schema-qualified `%I.%I` format fragments. Emmett's partition functions need to pass schema and object name as separate `format()` arguments; the rule is easy to get wrong and would benefit from one Dumbo-owned utility or documented recipe. Emmett currently has a local `postgreSQLDynamicRelationFormat` / `postgreSQLDynamicRelationArguments` stopgap that should be removed once Dumbo exposes this.
- Allow `SQLTableReference.from` ergonomics that accept an omitted schema and internally use Dumbo's default-schema sentinel, or document that consumers should pass `DefaultDatabaseSchemaName`. Emmett's local `emmettRelation` helper exists mostly to hide that sentinel conversion.

Useful Pongo follow-ups:

- Keep and document the current split between `defaultSchemaName` and nested `migrationTable`; Emmett depends on projection tables living in one schema while migration history is shared elsewhere.
- If Pongo has any remaining client creation branches that do not forward `defaultSchemaName` and `migrationTable`, centralize them behind a Pongo-owned client/options factory. Emmett will otherwise need its own wrapper for init, handle, truncate and rebuild.
- Expose or document the resolved collection/schema choice used by Pongo collections, so Emmett projection diagnostics can report where a Pongo projection will write without reimplementing Pongo's fallback rules.

## Schema-bound SQL model

Create one schema-bound factory per store instance:

```ts
const postgreSQLEventStoreSchema = (options: EventStoreDatabaseSchema) => ({
  tables,
  sequences,
  routines,
  schemaSQL,
  migrations,
  migrationTable,
});
```

Use Dumbo structured tokens wherever they exist:

- `SQLTableReference` for tables;
- `SQLCreateSchema` for schema creation;
- separate `SQL.identifier(schemaName)` and `SQL.identifier(routineName)` tokens for qualified routines;
- identifier-safe formatting for sequence references and PL/pgSQL dynamic SQL.

Never pass `events.emt_messages` to one `SQL.identifier` or one PostgreSQL `%I`; both produce one dotted identifier rather than a qualified reference.

Keep existing exported constants as default-schema compatibility exports. Internally, default constants should be produced by the same factory or wrapper and protected by golden tests.

## Migration compatibility boundary

Schema configuration creates a new supported deployment mode. Pre-schema-support migrations were written only for the default schema and have no configured-schema installations to upgrade.

Build two migration lists:

- default schema: exactly today's historical migrations followed by the current schema migration;
- configured schema: schema creation when needed, followed by the qualified current schema migration, with no pre-schema-support migrations and no no-op markers.

Migrations introduced after schema support must be schema-aware and included in both lists. Define a named boundary in the migration index so future changes cannot accidentally classify a new migration as default-only.

The configured store normally has its own migration table. Explicitly pointing multiple stores, or a configured store and an existing default store, at one migration table remains unsupported unless their migration identities are isolated.

Historical migrations run only for the default schema, but they still share the database with configured schemas. Their catalog checks look up objects by bare name, so a table or function that a configured schema owns can satisfy a check whose statement then runs unqualified against the default schema and fails. Checks naming objects a configured schema also creates must therefore be scoped with `schemaname = current_schema()`. Checks naming pre-schema-support objects (`emt_events`, `emt_subscriptions`, `emt_global_event_position`, `add_module` and friends) stay untouched: no configured schema ever creates them, and rewriting them would change the hashes of migrations older than schema support.

Two 0.43.0 migrations needed that scoping, `upgrade-checkpoint-format` and `add-messages-poll-index`, so both carry `ignoreHashMismatch: true`. Databases that already applied the beta form log a mismatch and skip instead of aborting startup; fresh databases get the corrected SQL.

The current migration index and `currentPostgreSQLEventStoreSchemaVersion` stop at `0.43.0`. The unreferenced `0_44_0` migration is intentionally reserved for the next release or manual execution, so this PR must not activate it. If it is activated after schema support, its normal migration form must be schema-aware and included in both migration lists; manual execution does not change the compatibility boundary.

## Migration-table and schema creation

Pass the resolved `MigrationTableOptions` to `runSQLMigrations`.

Dumbo's `migrationTableComponentFor({ schemaName })` already generates and executes:

1. creation of the migration-table schema;
2. creation of the migration table;
3. then Emmett's supplied migrations.

Do not add a second Emmett migration for the migration-table schema.

Schema creation rules for `schema.migrate()` are:

- event schema equals migration-table schema: Dumbo has already created it;
- event schema differs from migration-table schema: the first Emmett migration creates the event schema with `SQLCreateSchema`;
- event schema is default: no event-schema creation SQL is emitted.

`schema.sql()` is independent of migration-table setup. When an event schema is configured, its core-only output always starts with `CREATE SCHEMA IF NOT EXISTS`, even when Dumbo would create the same schema during `schema.migrate()`.

## PostgreSQL function requirements

The current database routines are functions, not procedures. Co-locating them with their tables does not change PostgreSQL name resolution.

For every Emmett function, qualify:

1. the definition name;
2. application call sites;
3. Emmett table references in the body;
4. calls to other Emmett functions;
5. Emmett functions used in parameter defaults;
6. dynamic partition parent and child references using separate `%I.%I` arguments;
7. catalog checks by namespace and, for functions, identity argument signature.

Keep the existing name-only `pg_proc` guard byte-identical on the default path. For configured schemas, use a namespace- and signature-aware guard. Preserve the current string overload of `createFunctionIfDoesNotExistSQL` for compatibility.

Do not use a connection-level or function-local `search_path` as Emmett's ownership mechanism.

The current schema must include every routine used by configured runtime paths. In particular, `emt_try_acquire_projection_lock` is required by inline projection handling and must be part of the current generated schema, not only exported as a standalone helper.

Advisory locks are not schema-scoped. Schema-qualified lock functions store/read lifecycle rows from schema-qualified tables, but identical lock keys in the same physical database still contend. Keep tests that assert schema placement on distinct processor/projection names. Treat schema-prefixed generated lock keys as a separate compatibility decision, not an implicit side effect of table qualification.

## Context and hook contract

Do not make reusable PostgreSQL processors or projections depend on the event-store schema option model. PostgreSQL processor/projection metadata may eventually be used by non-PostgreSQL event sources. The event store is allowed to translate its `schema` option into PostgreSQL metadata options when it creates a PostgreSQL consumer; after that, processor/projection modules consume the prepared metadata context only.

Pass the prepared metadata context value to:

- `onBeforeSchemaCreated`;
- `onAfterSchemaCreated`;
- inline projection initialization;
- asynchronous projection initialization;
- raw PostgreSQL projection handlers;
- projection specs and assertion helpers.

Hooks must receive the resolved configuration even when their timing means the configured schema has not been created yet. The context describes intended ownership; it does not promise object existence.

Raw SQL projections remain user-owned. Emmett exposes the resolved names but does not parse SQL, rewrite SQL or set `search_path`.

Consumer and session validation should remain test-driven rather than adding new plumbing by default. The intended behavior is:

- event-store-created consumers receive the prepared metadata from the store;
- direct PostgreSQL consumers prepare the same metadata from their own `schema` option;
- `context.connection.messageStore` keeps that metadata while borrowing the current transaction connection and disabling auto-migration;
- `withSession(...)` keeps the configured schema options while replacing the underlying connection.

If those paths already satisfy the behavior, do not add another options wrapper or forwarding abstraction. Keep the tests as the regression guard.

### Unit-test signal listener warning follow-up

Current unit-test runs pass but emit Node `MaxListenersExceededWarning` for `process` `SIGTERM` and `SIGINT` listeners. The warning means more than Node's default 10 listeners are registered on the global process object during one Vitest run. It is probably caused by repeated test helpers, containers, consumers or processors installing shutdown handlers without removing them when each test/suite finishes.

This is not caused by schema support and does not fail the suite, but it should be cleaned up separately because it can hide real listener leaks. A focused follow-up should:

- run unit tests with `node --trace-warnings` or an equivalent Vitest setup to identify the registration sites;
- prefer removing listeners during test cleanup or reusing one shared shutdown registration over raising the global listener limit;
- check long-running consumer/processor tests and testcontainers helpers first, because they are the most likely places to attach signal handlers;
- keep the fix outside the schema PR unless the trace points to code touched by schema support.

### Schema migration observability follow-up

Schema creation always reports `noopScope`. The collector instruments read, aggregate, append and the inline projection that runs during append. It does not instrument `migrate()` in either dialect, so no operation scope exists when the schema context is built. PostgreSQL hardcodes `noopScope` in `transactionToPostgreSQLProjectionHandlerContext` and again for inline projection init during migration, and SQLite now does the same.

A permanent `noopScope` is not acceptable. Migrations are the slowest and the most failure-prone startup step, and today they produce no span at all. Everything a hook or an inline projection does during migration is invisible too, because it inherits that scope.

The follow-up should:

- add a migration operation to the event store collector, so `schema.migrate()` opens a real scope;
- pass that scope into the schema context, replacing `noopScope` in both dialects;
- decide what the span reports: applied and skipped migration names, the resolved schema names, the migration table, and whether the run was a dry run;
- keep PostgreSQL and SQLite on the same shape, PostgreSQL first.

Discuss it after the SQLite schema work lands. It is not caused by schema support, but schema support is what made the gap visible.

### Schema hook context naming follow-up

Both schema hooks take a projection handler context. PostgreSQL declares `onBeforeSchemaCreated` and `onAfterSchemaCreated` as `(context: PostgreSQLProjectionHandlerContext) => Promise<void> | void`, and SQLite now matches it.

The name is wrong. What the hooks receive is the migration transaction plus the resolved schema names: `execute`, `connection`, `driverType`, `migrationOptions` and `observabilityScope`. Nothing in it is projection-specific. The projection type ended up there because the store initializes inline projections inside those hooks, projection init needs a projection handler context, and one object serves both.

The follow-up should name the hook contract for what it is, for example `SchemaCreationContext` per dialect, and let the projection handler context stay assignable to it so inline projection init keeps working. PostgreSQL first, SQLite following, so the two packages stay readable side by side.

This is a naming defect, not a behavior one. Renaming in SQLite alone would make the packages diverge on a problem PostgreSQL owns first, so it waits.

## Pongo contract

Use one internal Pongo-client factory for init, handle, truncate, rebuild and specs. It receives the resolved context and always forwards:

```ts
{
  defaultSchemaName: databaseSchema.projectionsDatabaseSchemaName,
  migrationTable: databaseSchema.migrationTable,
}
```

Pongo continues to resolve an explicit collection-level `databaseSchemaName` itself. Its collection components already use qualified names for CRUD and migrations.

The projection schema and migration-table schema are independent. For example, projection tables can live in `read_models` while their migration records live in `events.dmb_migrations`.

## Test-first delivery

This work is organized as behavioral slices, not as separate table, function, runtime and test waterfalls. Each slice follows the same loop:

1. add the smallest failing behavioral or integration test for the slice and run it to confirm the expected failure;
2. add focused rendering or resolution unit tests only where they help diagnose the behavior;
3. implement all layers required to make that behavior work;
4. run the focused tests, PostgreSQL package tests, type build and lint;
5. refactor only after the slice is green.

No slice ends with unconsumed configuration or schema-aware factories that production paths do not use.

### Slice 0: characterize compatibility and resolve configuration

Write tests first for:

- byte-identical default `schema.sql()` output;
- byte-identical default historical migration snapshots;
- all omitted names resolving to Dumbo defaults;
- projection and migration fallback to the event schema;
- explicit values winning;
- explicit `public` remaining explicit rather than being normalized to omission;
- omitted names never being materialized as the literal `public`.

Then add the resolver and its supporting types internally. Do not widen the public store option in this slice; Slice 1 exposes the option only when `schema.sql()` and `schema.migrate()` consume it end to end.

Exit criteria: existing default snapshots are unchanged and resolver tests are green.

### Slice 1: generated and migrated core schema

Start with failing integration tests proving that:

- `schema.sql()` for `events` begins with schema creation and qualifies every current core object;
- `schema.print()` prints exactly `schema.sql()`;
- `schema.migrate()` creates a fresh store in `events` and leaves no Emmett core tables in the default schema;
- the migration table defaults to `events.dmb_migrations`;
- a migration-table override such as `infrastructure` creates only the migration table there;
- an event schema distinct from the migration-table schema is created in the correct order;
- configured migration history contains no pre-schema-support migration names or no-op markers;
- an older default-schema installation still upgrades without a hash mismatch;
- dry run renders configured names and does not cache dry-run results as completed store migrations.

Expose the public option and implement the schema-bound tables, sequence, routines, current schema SQL, migration options and creation ordering needed for those tests. Add focused rendering tests for the sequence `nextval` regclass and qualified routine names before implementing those delicate fragments.

Exit criteria: a configured schema can be printed and created correctly, while default output and hashes remain unchanged.

### Slice 2: core append and read isolation

Start with failing end-to-end tests that:

- append and read in `events` while the pool `search_path` does not include `events`;
- run two stores with identical stream names in separate schemas and observe isolated data;
- use `autoMigration: 'None'` against an already-created configured store.

Implement schema-aware runtime SQL for append, stream existence, stream reads, message batch reads and truncation. Qualify application function calls as well as table references.

Exit criteria: the basic event-store workflow is independent of `search_path` and isolated by configuration.

### Slice 3: checkpoints, locks, processors and hooks

Start with failing workflow tests for a configured schema covering processor checkpoints, projection registration, projection/processor locks and schema hooks receiving the resolved context.

Implement the remaining runtime references and propagate the prepared PostgreSQL metadata options through transaction conversion and hook invocation. Verify hooks receive the same resolved values.

Exit criteria: processing infrastructure and hooks target or describe the configured store consistently.

### Slice 4: Pongo and raw PostgreSQL projections

Start with failing projection tests proving:

- a Pongo projection inherits the event schema by default;
- `projectionsDatabaseSchemaName` places projection tables separately;
- a collection-level override wins;
- init, handle, truncate and rebuild all use the same collection schema;
- Pongo records migrations in the event store's physical migration table, not a second table in the projection schema;
- a raw projection receives event, projection and migration-table schema information in context.

Make every Pongo construction path pass the same schema and migration-table intent. Use either the pool form or the ambient client/connection form, never both. Close the Pongo client created for the ambient client form in `finally`. Do not rewrite raw SQL.

Exit criteria: projection object placement is independent from migration-history placement and no duplicate Pongo migration table is created.

### Slice 5: consumers, sessions and alternate connections

Start with failing tests for:

- `eventStore.consumer()`;
- standalone `postgreSQLEventStoreConsumer`;
- processor-created message stores;
- `withSession`;
- supplied `pg.Pool` and Dumbo pool;
- ambient client/transaction paths;
- projection specs and assertion helpers.

Each test should write through one configured construction path and read or process through another equally configured path. Include a pool with an unrelated `search_path` to prove explicit targeting.

Implement option/context forwarding per failing path rather than changing every constructor speculatively.

Exit criteria: every supported PostgreSQL entry point can address the same configured store.

### Slice 6: identifier safety, regression matrix and documentation

Write the remaining tests first:

- PostgreSQL schema names containing uppercase letters and a double quote are safely rendered and usable;
- sequence regclass literals remain correct for those names;
- dynamic partition creation uses the configured schema;
- same-named functions in another schema and overloads in the configured schema do not suppress function creation;
- catalog checks do not match objects in another schema;
- default behavior, snapshots and migration hashes remain unchanged;
- generated SQL and dry-run output contain no accidental default-schema references.

Then document:

- the three configuration options and fallback rules;
- one shared event-store/projection migration table;
- raw projection responsibilities;
- changing schema selects a different store and does not move data;
- custom schema names are validated by Dumbo;
- configured schemas begin with the current schema and do not replay migrations from before schema support.

Exit criteria: the PostgreSQL package build, lint, unit, integration and end-to-end suites are clean.

## PostgreSQL verification matrix

| Scenario                                     | Required result                                                            |
| -------------------------------------------- | -------------------------------------------------------------------------- |
| Default configuration                        | Existing SQL, snapshots and migration hashes remain unchanged              |
| Fresh configured schema                      | Core objects and migration table are created in the resolved schemas       |
| Configured migration history                 | Starts at the schema-support boundary without no-op history                |
| Separate projection schema                   | Projection objects move; event objects and migration table do not          |
| Collection override                          | Explicit collection schema wins in every operation                         |
| Two event schemas                            | Stores remain isolated with identical stream and projection names          |
| Supplied or ambient connection               | Configured targeting ignores unrelated `search_path` values                |
| Auto-migration disabled                      | Runtime still targets configured objects                                   |
| Dry run                                      | SQL is correctly qualified and no changes persist                          |
| Unusual valid identifier                     | All static, dynamic and regclass references remain safe                    |
| Default and configured store in one database | The default store migrates and runs without touching the configured schema |

## SQLite follow-up PR

SQLite is intentionally not implemented in the PostgreSQL PR. The follow-up must preserve the same public option names, fallback rules, context shape and shared migration-table semantics.

The SQLite-specific work is not a direct copy:

1. Dumbo maps a logical schema to one prefixed physical name such as `"events.emt_streams"`; it is not an `ATTACH DATABASE` namespace.
2. SQLite's current imperative legacy migration and `batchCommand(schemaSQL)` path must be redesigned around a shared Dumbo migration table before claiming parity with PostgreSQL and Pongo.
3. Pre-schema-support SQLite migrations remain unchanged for the default path and are omitted for a newly configured logical schema; do not record unexplained no-op markers.
4. `schema.sql()` must use Dumbo's SQLite formatter rather than `schemaSQL.join('')`.
5. The resolved context must reach SQLite hooks, consumers, sessions, specs, sqlite3 and D1 paths.
6. Dumbo's SQLite validation, including the `.` restriction, remains authoritative.

Plan that PR as the same kind of test-first behavioral slices after PostgreSQL establishes the contract.

## Out of scope

- Projection-inclusive `schema.sql()` output. It needs a separate projection schema-rendering contract.
- Upstream Dumbo namespace/signature overloads for `tableExistsSQL` and `functionExistsSQL`, and an `SQLRoutineReference`. They remain useful follow-ups but do not block a local Emmett implementation.
- Upstream Pongo borrowed-pool support. The current Emmett fix should use the ambient client form when running inside an Emmett transaction, but Pongo should still grow an explicit way to accept an external pool without owning it on `close()`.
- Clarify Dumbo dry-run semantics for migration infrastructure. Current behavior can leave PostgreSQL schemas, tables and migration rows behind; either document that explicitly or make dry run leave no database objects behind.
- The exported but apparently unused `addModuleSQL`, `addTenantSQL`, `addModuleForAllTenantsSQL` and `addTenantForAllModulesSQL`. They reference a legacy tenant/`pg_partman` model and are not part of current `schemaSQL`; open a separate issue before changing or removing this public surface.
- Automatically moving existing data between schemas.

---

# SQLite database schema support

## Scope

This section plans the SQLite follow-up PR for [Emmett issue #95](https://github.com/event-driven-io/Emmett/issues/95). It keeps the public option names, fallback rules, context shape and shared migration-table semantics established by the PostgreSQL work above.

The intended SQLite API is the PostgreSQL one:

```ts
getSQLiteEventStore({
  driver: sqlite3EventStoreDriver,
  fileName: './emmett.db',
  schema: {
    autoMigration: 'CreateOrUpdate',
    databaseSchemaName: 'events',
    projectionsDatabaseSchemaName: 'read_models',
    migrationTable: {
      schemaName: 'infrastructure',
      tableName: 'emmett_migrations',
    },
  },
});
```

The same options apply to `sqliteEventStoreConsumer`, `SQLiteProjectionSpec.for` and `rebuildSQLiteProjections`.

## What SQLite is starting from

The SQLite package is further behind than the PostgreSQL package was, so this PR carries three kinds of work, not one:

1. **No migration infrastructure.** `createEventStoreSchema` runs `batchCommand(schemaSQL)` inside one transaction, preceded by a hand-written `migration_0_42_0_FromSubscriptionsToProcessors` that probes `sqlite_master`. There is no migration table, no hash, no dry run and no `RunSQLMigrationsResult`. The declared `CreateEventStoreSchemaOptions` fields (`dryRun`, `ignoreMigrationHashMismatch`, `migrationTimeoutMs`) are read by nobody.
2. **No schema qualification.** Every table reference is `SQL.identifier(streamsTable.name)`. `schemaSQL` is a list of eager constants, not `...For(databaseSchemaName)` factories. `schema.sql()` is `schemaSQL.join('')`, which does not go through a dialect formatter.
3. **Missing features that PostgreSQL qualifies.** No `schema.dangerous.truncate`, no writes or reads of `emt_projections`, and no rebuild entry point. Only truncate is in scope here; projection management and rebuild stay out.

Two drivers sit behind one store: `sqlite3EventStoreDriver` (file and `:memory:`) and `d1EventStoreDriver` (Cloudflare D1, tested through Miniflare). Both must reach the same configured objects.

## What Dumbo gives SQLite

Verified against `@event-driven-io/dumbo` 0.13.0-beta.50:

- `SQLTableReference.from({ databaseSchemaName, tableName })` renders one quoted prefixed physical name, `"events.emt_streams"`. It is not `ATTACH DATABASE` and not a native schema.
- `SQLIndexReference` also prefixes the index name, `"events.idx_a"`. PostgreSQL drops the schema from the index name, so index lookups must go through `sqliteIndexName`.
- `SQLCreateSchema` renders an empty string on SQLite, and `runSQLMigrations` filters empty migrations out with `rendersNothing`. A generated create-schema step is therefore harmless but pointless; do not emit one.
- `runSQLMigrations` is dialect-free and works on SQLite. `migrationTable: { schemaName, tableName }` produces the physical table `"infrastructure.emmett_migrations"`.
- `DefaultSQLiteMigratorOptions = {}`, so SQLite migrations take `NoDatabaseLock`. The wrapping transaction is the only protection.
- `dryRun` runs inside a transaction and rolls back, unless a caller supplies its own `execute`.
- Validation is render-time and thin: `assertNativeName` rejects any `.` in a table, index or schema name. Dumbo's rule stays authoritative; Emmett adds no second validation.
- `sqliteFormatter` from `@event-driven-io/dumbo/sqlite` is the rendering entry point. `describe` is what `schema.sql()` must use.
- `tableExists` from `@event-driven-io/dumbo/sqlite3` takes a plain name, so callers compose `sqliteTableName({ databaseSchemaName, tableName })` themselves.

## Accepted decisions

1. The SQLite event store moves onto Dumbo migrations in this PR. Without a migration table, `migrationTable` has no meaning and there is no parity to claim.
2. Order of work: migration rewrite first with no behavior change, then schema names across the existing surface, then the missing features written schema-aware from the first line.
3. Databases created by the current imperative path upgrade by applying and recording. The default chain keeps the 0.42.0 subscriptions-to-processors step as a real migration, then the current schema migration runs `CREATE TABLE IF NOT EXISTS` and is recorded. Existing data is untouched. The current migration carries `ignoreHashMismatch: true`, as PostgreSQL does.

   A `SQLMigration` is a fixed `SQL[]`, and SQLite has no conditional statement equivalent to PostgreSQL's `DO $$ ... IF EXISTS`, so the 0.42.0 step cannot keep the imperative `sqlite_master` probe. It instead starts with `CREATE TABLE IF NOT EXISTS emt_subscriptions`. A database that never had the legacy table gets an empty one, the `INSERT ... SELECT` copies no rows, and the `DROP TABLE` always has a table to remove. The net effect on a fresh database is nothing.

4. The resolver is duplicated in `emmett-sqlite`, not moved to the core package. The option names, the types and the fallback rules stay identical to PostgreSQL, and each dialect stays free to diverge later.
5. `schema.dangerous.truncate` is the only missing feature added here, and it is written schema-aware. Projection registration in `emt_projections` and a rebuild entry point stay out of scope.
6. **Processor and projection locks are out of scope.** SQLite has no advisory lock and Dumbo gives SQLite `NoDatabaseLock`. A lease design belongs in its own issue.
7. Driver coverage: resolver and rendering tests are driver-free. Behavioral tests run on sqlite3, with a D1 mirror for append, read and migration placement.
8. Only an omitted schema name selects default behavior. A supplied name is always explicit. Emmett never normalizes or invents names.
9. Changing `databaseSchemaName` selects a different store. Emmett does not move data between prefixes.

## Resolution contract

Copy the PostgreSQL shape into `src/packages/emmett-sqlite/src/eventStore/schema/eventStoreDatabaseSchema.ts`:

```ts
export type EventStoreDatabaseSchemaOptions = {
  databaseSchemaName?: string | undefined;
  projectionsDatabaseSchemaName?: string | undefined;
  migrationTable?: MigrationTableOptions | undefined;
};

export type EventStoreDatabaseSchema = {
  databaseSchemaName: string | undefined;
  projectionsDatabaseSchemaName: string | undefined;
  migrationTable: MigrationTableOptions | undefined;
};
```

Fallback rules are the PostgreSQL ones: projections fall back to the event schema, the migration-table schema falls back to the event schema, an omitted name never materializes as a literal, and an explicitly supplied name stays explicit.

| Input                          | Event objects | Projection default         | Migration table           |
| ------------------------------ | ------------- | -------------------------- | ------------------------- |
| all omitted                    | unprefixed    | unprefixed                 | `dmb_migrations`          |
| `databaseSchemaName: 'events'` | `events.*`    | `events.*`                 | `"events.dmb_migrations"` |
| projection name only           | unprefixed    | explicit projection prefix | `dmb_migrations`          |
| migration name only            | unprefixed    | unprefixed                 | explicit migration prefix |

Add `tableReference(databaseSchemaName, tableName)` to `schema/typing.ts`, identical to the PostgreSQL helper, wrapping `DefaultDatabaseSchemaName`. Replace every `SQL.identifier(<table>.name)` call site with it.

## Migration model

Build the SQLite migration index the way PostgreSQL builds its own:

- `schemaMigrationFor(options)` returns one `sqlMigration('emt:sqlite:eventstore:initial', eventStoreSchemaSQL(options), { ignoreHashMismatch: true })`.
- `pastEventStoreSchemaMigrations` holds the converted 0.42.0 subscriptions-to-processors step, keeping its bare `emt_subscriptions` references. No configured prefix ever creates `emt_subscriptions`, so those references need no prefix scoping. This is the one point where SQLite is simpler than PostgreSQL, whose catalog checks had to be scoped with `current_schema()`.
- `eventStoreSchemaMigrationsFor(options)` returns the full chain for the default path and only the current migration for a configured prefix.
- Define the boundary in the migration index so a future migration cannot be classified as default-only by accident.

`createEventStoreSchema` gains an options parameter and calls `runSQLMigrations(pool, eventStoreSchemaMigrationsFor(options), { ...options, migrationTable: databaseSchema.migrationTable })`. `schema.migrate()` accepts `CreateEventStoreSchemaOptions` and returns `RunSQLMigrationsResult`, and it must not cache a dry run as a completed migration.

Do not emit `SQLCreateSchema` on SQLite. There is no schema object to create; the prefix exists only inside the physical table name.

The 0.41.0 and 0.42.0 files stay test fixtures. Convert only what the default chain needs, and keep the existing snapshot fixtures working.

## Schema-bound SQL model

Convert `tables.ts` to `...For(databaseSchemaName)` factories and keep the current zero-argument constants as default-path compatibility exports, exactly as PostgreSQL did. Add `schema/eventStoreSchemaSQL.ts` with `eventStoreSchemaSQL(options?)` returning the ordered statement list, plus `export const schemaSQL = eventStoreSchemaSQL()`.

`schema.sql()` becomes `getFormatter(...).describe(eventStoreSchemaSQL(options.schema), { serializer })`, replacing `schemaSQL.join('')`. This changes the string existing users see. It is a deliberate correctness fix: joined tokens do not render `SQLTableReference`.

SQLite has no functions, no sequences, no partitions and no `search_path`. Everything PostgreSQL needed for routine qualification, dynamic `%I.%I` fragments and `nextval` regclass literals has no SQLite counterpart. The whole qualification job is table and index references inside TypeScript-implemented operations.

## Runtime call sites to qualify

Append (`appendToStream.ts`, four statements), `readStream.ts`, `readMessagesBatch.ts`, `readLastMessageGlobalPosition.ts`, `streamExists.ts`, `readProcessorCheckpoint.ts` and `storeProcessorCheckpoint.ts` (four statements, the imperative replacement for the PostgreSQL stored procedure).

## Context and hook contract

`SQLiteProcessorHandlerContext` already carries `migrationOptions`. Widen `CreateEventStoreSchemaOptions` with the schema fields, then populate `migrationOptions` the way PostgreSQL does, and pass the same prepared value to:

- `onBeforeSchemaCreated` and `onAfterSchemaCreated`. Both hook signatures change: today `onAfterSchemaCreated` takes no argument at all, and `onBeforeSchemaCreated` takes only `{ connection }`.
- inline projection initialization, which SQLite currently runs before schema creation rather than after. Keep that timing, and pass the resolved context regardless. The context describes intended ownership; it does not promise object existence.
- asynchronous projection initialization, raw SQL projection handlers, projection specs and assertion helpers.
- `sqliteMessageSource`, which needs a `databaseSchemaName` parameter it does not have.
- `sqliteCheckpointer`, which must read the schema from the context instead of ignoring it.
- `withSession`, which already spreads `options.schema`, so it needs coverage rather than change.
- The `sqliteAmbientConnectionPool` workflow message-store path and the D1 `session_based` transaction mode.

`sqliteEventStoreConsumer` gains a `schema` option and builds the prepared metadata once, as `postgreSQLEventStoreConsumer` does. Reusable processors and projections consume prepared metadata only; they never depend on the event-store option model.

Raw SQL projections stay user-owned. Emmett exposes the resolved names and does not parse or rewrite user SQL.

## Pongo contract

SQLite Pongo projections resolve their driver through the global Pongo registry and pass no schema information at all today. Add one `pongoSchemaOptions(context)` helper and spread it into every `pongoClient(...)` call in handle, init, truncate and the spec helper:

```ts
{
  defaultSchemaName: context.migrationOptions?.projectionsDatabaseSchemaName,
  migrationTable: context.migrationOptions?.migrationTable,
}
```

Replace the `// TODO: ADD migration options` in `init` with the real `collection.schema.migrate(context.migrationOptions)` call. An explicit collection-level `databaseSchemaName` still wins, and Pongo resolves it.

Fix the copy-pasted `kind` strings while touching these files: `'emt:projections:postgresql:pongo:*'` inside the SQLite package should name SQLite.

## Test-first delivery

Same loop as the PostgreSQL work: one failing behavioral test, then the smallest implementation that makes it pass, then focused tests, `npm run build:ts`, `npm run fix`, `npm run test:unit`, then refactor. No phase ends with configuration that production paths do not consume.

### Phase 1: Dumbo migrations on the default path

No schema names yet, no behavior change for users.

Tests first: a fresh in-memory database creates `dmb_migrations` and the four Emmett tables; a database prepared with the 0.41.0 and then 0.42.0 fixtures upgrades and records history; a database prepared with the current imperative `schemaSQL` and no migration table applies and records the current migration without touching data; `schema.migrate()` returns applied and skipped lists; a dry run leaves the file unchanged; a second migrate run applies nothing.

Implement the converted 0.42.0 migration, the migration index, the `createEventStoreSchema` options parameter and the `runSQLMigrations` call. Keep `schema.sql()` unchanged in this phase.

The migration layout mirrors PostgreSQL exactly: `migrations/<version>/<version>.migration.ts`, `<version>.snapshot.ts`, per-version specs, a per-version `index.ts` exporting `migrations_<version>`, and `migrations/current/migration.int.spec.ts` for the whole chain.

`schemaMigrationFor` and `eventStoreSchemaMigrationsFor` are deferred to Phase 2. They take an options argument that only `eventStoreSchemaSQL(options)` can serve, so adding them here would leave configuration no production path reads. Phase 1 ships the fixed `schemaMigration` and `eventStoreSchemaMigrations` instead.

`createEventStoreSchema` takes a `Dumbo` pool rather than a connection, because `runSQLMigrations` needs a pool. It moves from `tables.ts` to `schema/index.ts`, matching where PostgreSQL keeps it and breaking the import cycle that `migrations/index.ts` importing `schemaSQL` would otherwise create. It supplies `execute: tx.execute` so hooks and migrations share one transaction; that bypasses Dumbo's own dry-run rollback, so the outer transaction returns `{ success: false, result }` when `dryRun` is set.

Exit: existing SQLite suites pass unchanged, and migration history exists.

### Phase 2: resolver, generated schema and migration placement

Tests first: resolver fallback rules, including that an omitted name is never materialized; `eventStoreSchemaSQL({ databaseSchemaName: 'events' })` renders `"events.emt_streams"` and friends through `sqliteFormatter`; `schema.sql()` equals the factory output and `schema.print()` prints exactly that; no create-schema statement is emitted; a configured store creates only prefixed tables; the migration table defaults to `"events.dmb_migrations"`; an `infrastructure` override places only the migration table; configured history contains no pre-schema-support migration names.

Implement the resolver, `tableReference`, the `...For` factories, `eventStoreSchemaSQL`, the formatter-based `schema.sql()`, and the widened public `schema` option.

Exit: a configured store can be printed and created, and the default output is unchanged apart from the deliberate `schema.sql()` formatter fix.

### Phase 3: append and read isolation

Tests first: append and read against a configured prefix; two stores with identical stream names in different prefixes stay isolated; `autoMigration: 'None'` against an already-created configured store still targets the right tables. Mirror append and read on D1.

Implement schema-aware append, stream existence, stream read, batch read and last-position SQL.

Exit: the basic workflow is isolated by configuration on both drivers.

### Phase 4: checkpoints, processors, consumers and hooks

Tests first: processor checkpoints land in the configured prefix; consumers created by the store and standalone consumers both target it; `withSession`, a supplied Dumbo pool, the ambient connection path and the D1 session mode all reach the same store; both hooks receive the resolved names.

Implement the consumer `schema` option, the prepared metadata, message source and checkpointer forwarding, and the hook signature change.

Exit: every SQLite entry point can address the same configured store.

### Phase 5: Pongo and raw projections

Tests first: a Pongo projection inherits the event prefix; `projectionsDatabaseSchemaName` places documents separately; a collection-level override wins; init, handle and truncate agree; Pongo records migrations in the store's migration table rather than a second one; a raw SQL projection receives the resolved names in context; `SQLiteProjectionSpec` and `expectPongoDocuments` honor the configuration.

Implement `pongoSchemaOptions`, the `collection.schema.migrate` call, the spec forwarding, and the projection handler context field.

Exit: projection placement is independent from migration-history placement.

### Phase 6: truncate

Tests first: `schema.dangerous.truncate` empties the configured store and leaves another prefix untouched; it resets the global position expectations that SQLite's `INTEGER PRIMARY KEY` implies; projection storage truncation targets the projection prefix.

Implement `truncateTables.ts` and the `schema.dangerous` surface. SQLite has no sequence to restart, so this is simpler than the PostgreSQL version.

### Phase 7: identifier safety, regression matrix and documentation

Tests first: prefixes with capitals, spaces and a double quote render and work, because a SQLite prefix becomes part of one quoted identifier; a prefix containing `.` fails with Dumbo's error and Emmett adds no second check; index names go through `sqliteIndexName`; default behavior and existing fixtures are unchanged; generated SQL contains no accidental unprefixed reference.

Then document the three options and the fallback rules, the shared migration table, the prefix model and how it differs from a PostgreSQL schema, raw projection responsibilities, that changing the name selects a different store, that Dumbo validates names, and that locks, projection management and rebuild are not implemented on SQLite.

## SQLite verification matrix

| Scenario                     | Required result                                                    |
| ---------------------------- | ------------------------------------------------------------------ |
| Default configuration        | Existing tables, fixtures and behavior unchanged                   |
| Existing imperative database | Migration history is recorded, data is untouched                   |
| Fresh configured prefix      | Only prefixed tables and the resolved migration table are created  |
| Configured migration history | Starts at the schema-support boundary, with no pre-support entries |
| Separate projection prefix   | Documents move, event tables and migration table do not            |
| Collection override          | Explicit collection schema wins in every operation                 |
| Two event prefixes           | Stores stay isolated with identical stream and projection names    |
| sqlite3 and D1               | Append, read and migration placement agree across drivers          |
| Auto-migration disabled      | Runtime still targets the configured tables                        |
| Dry run                      | SQL is correctly prefixed and nothing persists                     |
| Prefix needing quoting       | Table and index references stay safe                               |
| Prefix containing `.`        | Dumbo's error surfaces unchanged                                   |

## Out of scope for the SQLite PR

- Processor and projection locks. SQLite has no advisory lock and Dumbo gives it `NoDatabaseLock`. Open a separate issue for a lease design that also works on D1.
- Projection management. `emt_projections` stays created and unused: no `registerProjection`, `activateProjection`, `deactivateProjection` or projection info read.
- `rebuildSQLiteProjections`. It depends on projection management and, in PostgreSQL, on a projection lock. Both are out of scope, so rebuild follows them in a later PR.
- `ATTACH DATABASE` as an alternative isolation model.
- Dropping, listing or renaming a logical prefix.
- Moving existing data between prefixes.
- The empty `cli.ts` and a SQLite migration command line.

## Upstream follow-ups found for Dumbo

- SQLite has no migration lock. Concurrent migrators on one file rely on `SQLITE_BUSY` behavior.
- `tableExists` for SQLite takes a plain name. A `SQLTableReference` overload would remove Emmett's manual `sqliteTableName` composition in tests.
- SQLite index references are prefixed while PostgreSQL index references are not. The asymmetry is correct per dialect but deserves documentation.
- SQLite schema validation is render-time only and checks a single character. Definition-time validation, and a check for collision with a real table literally named `"events.emt_streams"`, would catch mistakes earlier.
