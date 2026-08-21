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
- Consider a relation/regclass helper for sequence references used in defaults, such as `nextval(<qualified sequence>::regclass)`. Emmett currently builds that with `SQL.literal` because `nextval` needs a string literal that names a relation, not an identifier expression.
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
- dry run renders configured names and leaves no changes.

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

| Scenario                       | Required result                                                      |
| ------------------------------ | -------------------------------------------------------------------- |
| Default configuration          | Existing SQL, snapshots and migration hashes remain unchanged        |
| Fresh configured schema        | Core objects and migration table are created in the resolved schemas |
| Configured migration history   | Starts at the schema-support boundary without no-op history          |
| Separate projection schema     | Projection objects move; event objects and migration table do not    |
| Collection override            | Explicit collection schema wins in every operation                   |
| Two event schemas              | Stores remain isolated with identical stream and projection names    |
| Supplied or ambient connection | Configured targeting ignores unrelated `search_path` values          |
| Auto-migration disabled        | Runtime still targets configured objects                             |
| Dry run                        | SQL is correctly qualified and no changes persist                    |
| Unusual valid identifier       | All static, dynamic and regclass references remain safe              |

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
- The exported but apparently unused `addModuleSQL`, `addTenantSQL`, `addModuleForAllTenantsSQL` and `addTenantForAllModulesSQL`. They reference a legacy tenant/`pg_partman` model and are not part of current `schemaSQL`; open a separate issue before changing or removing this public surface.
- Automatically moving existing data between schemas.
