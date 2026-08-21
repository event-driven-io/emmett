# Database schema support for PostgreSQL and SQLite event stores

## Scope and conclusion

This research covers [Emmett issue #95](https://github.com/event-driven-io/Emmett/issues/95) against the schema APIs delivered by [Pongo PR #204](https://github.com/event-driven-io/Pongo/pull/204) and available in the currently installed Dumbo `0.13.0-beta.50` and Pongo `0.17.0-beta.50`.

The schema must be selected by Emmett configuration. Emmett should not infer it from a connection-string `schema` query parameter, a PostgreSQL `search_path`, or the location/path of migration files.

The recommended model is:

```ts
getPostgreSQLEventStore(connectionString, {
  schema: {
    autoMigration: 'CreateOrUpdate',
    databaseSchemaName: 'events',
    projectionsDatabaseSchemaName: 'read_models',
  },
});
```

The same fields can be offered by the SQLite event store. They have different physical meanings:

- PostgreSQL: `events.emt_streams` is a table in the real `events` schema.
- SQLite: `"events.emt_streams"` is one table name. Dumbo deliberately maps logical schemas to quoted name prefixes because SQLite has no schemas.

`projectionsDatabaseSchemaName` should be optional and fall back to `databaseSchemaName`, so one setting moves all Emmett-managed infrastructure together. It is the intended default for every projection type. Pongo can apply it automatically; raw PostgreSQL projections receive it in their context and must use it when constructing their own structured table references. An explicit Pongo collection setting still wins.

Only omission selects fallback or dialect-default behavior. Every supplied schema name, including `public`, remains explicit. Emmett should not compare it with `current_schema()`, inspect `search_path`, or normalize it based on whether PostgreSQL would ordinarily resolve unqualified objects there.

## What Dumbo and Pongo expose now

The new API is sufficient, but it is not a single option that can be passed only when the pool is created.

### Dumbo

- `SQLTableReference` carries `{ databaseSchemaName, tableName }` and renders a safely qualified PostgreSQL reference.
- `SQLCreateSchema` and database schema components produce schema creation migrations for PostgreSQL.
- `databaseComponent({ defaultSchemaName })` places default tables in the configured schema.
- The migration table can be placed with `migrationTable: { schemaName, tableName? }`.
- SQLite renders a non-default table reference as one quoted logical name, `"schema.table"`; schema creation itself renders as a no-op.
- `SQL.identifier('schema.table')` is not a substitute for `SQLTableReference`: it quotes the entire string as one identifier on every dialect.

### Pongo

- `pongoClient({ defaultSchemaName })` selects the default schema for databases created by that client.
- `pongo.db(name, { defaultSchemaName })` can override it at database level.
- `collection(name, { databaseSchemaName })` selects a schema for one collection.
- Collection-level `databaseSchemaName` takes precedence over the client's/database's default.
- `migrationTable` is independent from `defaultSchemaName`. This lets Emmett point Pongo at the event store's shared migration table even when projection objects live in another schema.
- A collection migration creates its declared PostgreSQL schema. On SQLite it creates prefixed physical objects.

The PR description explicitly defines the SQLite prefix behavior. This is useful for isolation, but it should not be documented as SQLite namespace or attached-database support.

## Change ownership: Dumbo, Pongo, and Emmett

PR #204 contains the upstream capabilities needed by Emmett. There is no mandatory additional Pongo or Dumbo change blocking this issue.

| Concern                                            | Owner  | Status/action                                                                  |
| -------------------------------------------------- | ------ | ------------------------------------------------------------------------------ |
| Represent a table as schema plus table name        | Dumbo  | Delivered through `SQLTableReference` and table components                     |
| Create real PostgreSQL schemas                     | Dumbo  | Delivered through `SQLCreateSchema` and database schema component migrations   |
| Represent SQLite logical schemas                   | Dumbo  | Delivered through the quoted `"schema.table"` physical-name mapping            |
| Put Dumbo migration history in a schema            | Dumbo  | Delivered through `migrationTable.schemaName`                                  |
| Check catalog objects in a particular schema       | Dumbo  | Existing helpers are name-only; recommended upstream correctness fix           |
| Represent a schema-qualified routine               | Dumbo  | Not exposed; a useful ergonomic extension, but Emmett can compose it safely    |
| Give a Pongo database a default schema             | Pongo  | Delivered through `defaultSchemaName`                                          |
| Override one Pongo collection's schema             | Pongo  | Delivered through `collectionOptions.databaseSchemaName`                       |
| Generate schema-aware Pongo CRUD and migration SQL | Pongo  | Delivered; SQL builders use the collection component's schema-aware `fullName` |
| Select the event-store and projection defaults     | Emmett | Required public configuration and fallback resolution                          |
| Make core event-store SQL schema-aware             | Emmett | Required for PostgreSQL and SQLite                                             |
| Make PostgreSQL functions schema-aware             | Emmett | Required for creation, lookup, calls, bodies, and dynamic partition SQL        |
| Forward the Pongo default everywhere               | Emmett | Required in projection init, handle, truncate, rebuild, specs, and assertions  |

### Useful Dumbo extensions

These should be independent Dumbo changes rather than prerequisites hidden inside the Emmett issue.

#### 1. Make catalog existence helpers schema-aware

**Priority: high; recommended correctness fix, but not an Emmett blocker.**

Dumbo's current PostgreSQL `tableExistsSQL(tableName)` checks `pg_tables.tablename`, and `functionExistsSQL(functionName)` checks `pg_proc.proname`. Neither check constrains the namespace. The function helper also does not distinguish overloads. After adding schema support, either helper can return `true` because a same-named object exists in another schema; a function with the wrong signature can also satisfy the function check.

A compatible extension could retain the string overload and add structured input:

```ts
tableExistsSQL(
  SQLTableReference.from({
    databaseSchemaName: 'events',
    tableName: 'emt_messages',
  }),
);

functionExistsSQL({
  databaseSchemaName: 'events',
  functionName: 'emt_append_event',
  argumentTypes: ['text', 'text', 'jsonb'],
});
```

The PostgreSQL implementation should join `pg_namespace` and, for routines, compare the identity argument types (or use an equivalently signature-aware catalog mechanism). A name-only function overload should remain available only for compatibility and should be documented as ambiguous.

Emmett should still fix its own current function-existence SQL as part of issue #95. It can adopt the Dumbo helper later if this extension lands; the Emmett change should not wait for it.

#### 2. Add a structured routine reference

**Priority: medium; ergonomic.**

Dumbo has structured references for tables and indexes but no equivalent for functions/procedures. A dialect-aware `SQLRoutineReference` would give callers one standard way to render a qualified routine name:

```ts
SQLRoutineReference.from({
  databaseSchemaName: 'events',
  routineName: 'emt_append_event',
});
```

`SQLRoutineReference` is preferable to `SQLFunctionReference` if the token only renders an object name: PostgreSQL functions and procedures have the same qualification rules, and the token need not encode invocation syntax. If Dumbo intends to model definitions, arguments, return types, or migrations, separate function/procedure components can sit above the shared reference.

This is not required for safety. Emmett can render the schema and routine as two separately quoted `SQL.identifier` tokens. It must not pass `events.emt_append_event` to one identifier token, because that renders one dotted identifier rather than two qualified identifiers.

#### 3. Add routine schema components only if there is wider demand

**Priority: low; larger design scope.**

A future PostgreSQL function component could own a routine's qualified name, signature, definition and create/update migration. That could eventually replace some of Emmett's hand-written function migration plumbing. It is substantially broader than table-reference support: overload identity, return types, volatility, security, function-level settings and body languages all affect the model. Issue #95 does not justify designing this abstraction inside Emmett or blocking on it.

#### 4. Do not add a generic `search_path` shortcut for this use case

A Dumbo helper that mutates the connection/session `search_path` would not remove the need for qualified migration SQL, stored-routine calls, catalog checks, or safe dynamic SQL. It would also introduce pooled-connection state. Structured references and explicit qualification are the more consistent extension point.

#### 5. Make default-schema table references easier to consume

**Priority: medium; removes Emmett glue.**

Dumbo's `SQLTableReference` requires a `databaseSchemaName`, and the default/unqualified case is represented by `DefaultDatabaseSchemaName`. That is consistent internally, but consumers that accept `string | undefined` schema options need a small helper like Emmett's current `emmettRelation(databaseSchemaName, tableName)` to translate omission into Dumbo's sentinel.

A compatible Dumbo improvement could be either:

```ts
SQLTableReference.from({
  databaseSchemaName: undefined,
  tableName: 'emt_messages',
});
```

or a named helper such as:

```ts
SQLTableReference.fromOptionalSchema({
  databaseSchemaName,
  tableName: 'emt_messages',
});
```

The goal is not a new Emmett abstraction. The goal is to remove one local compatibility helper while preserving Dumbo's dialect-specific rendering of the default schema.

#### 6. Add a relation-literal or regclass helper

**Priority: medium; reduces delicate PostgreSQL SQL.**

PostgreSQL sequence defaults need a relation name inside a string literal, for example:

```sql
DEFAULT nextval('events.emt_global_message_position'::regclass)
```

This is not the same as rendering an identifier expression. Emmett currently has to build the sequence regclass name separately and pass it through `SQL.literal`. A Dumbo helper for "relation name as a literal/regclass target" would make this intent explicit and remove another local helper.

The API could be narrow and PostgreSQL-focused, for example:

```ts
SQL.regclass(SQLTableReference.from({ databaseSchemaName, tableName }));
```

or:

```ts
SQLRelationLiteral.from({ databaseSchemaName, relationName });
```

The exact naming matters less than preventing consumers from manually concatenating schema and object names for `regclass`.

#### 7. Document or wrap schema-qualified dynamic SQL formatting

**Priority: medium; prevents subtle partition bugs.**

PL/pgSQL `format('%I', value)` formats one identifier. For qualified names, callers must use two arguments and `%I.%I`, not pass `events.emt_messages` as one value. Emmett's partition functions now need this distinction for both parent and child partitions.

Dumbo does not need a full PL/pgSQL builder, but a small documented recipe or helper for qualified dynamic-SQL references would be useful. It could generate the format fragment and argument list for:

```sql
format('CREATE TABLE IF NOT EXISTS %I.%I PARTITION OF %I.%I ...', schema, child, schema, parent)
```

This would keep schema-qualified dynamic SQL consistent with `SQLTableReference` and reduce the chance that consumers accidentally create `"events.emt_messages"` as a single identifier.

### Useful Pongo extensions

#### 1. Keep migration-table placement independent from the default schema

**No extension required for Emmett.**

Pongo deliberately treats `defaultSchemaName` and `migrationTable.schemaName` as independent settings. That is required by the selected Emmett model: projection objects may live in `read_models`, while their migrations are recorded in the same physical table as event-store migrations in `events`. Emmett can already obtain that behavior by passing both values:

```ts
pongoClient(connection, {
  defaultSchemaName: projectionSchemaName,
  migrationTable,
});
```

Both Dumbo and Pongo currently default the physical table name to `dmb_migrations`, and Pongo forwards its migration-table option to Dumbo. Passing the same resolved schema and table-name options therefore makes them use one physical migration table. Pongo should not implicitly derive that table from its projection default because doing so would split the shared history.

#### 2. Keep collection SQL ownership in Pongo

No new SQL-access API is needed for Emmett. Pongo already resolves an explicit collection `databaseSchemaName` before the database/client default and uses the collection component's qualified name for CRUD and migrations. If a schema-aware Pongo query is found to bypass that component, it should be fixed inside Pongo as a consistency bug rather than worked around by Emmett.

#### 3. Expose or document resolved collection placement

**Priority: low to medium; diagnostics and tests.**

Emmett should not reimplement Pongo's fallback rules for collection schemas. A small Pongo diagnostic API, or clearly documented resolution contract, would let Emmett report where a Pongo projection writes when `collectionOptions.databaseSchemaName`, client `defaultSchemaName`, and omitted values interact.

This does not block schema support because Pongo owns the actual SQL. It would make projection diagnostics and future projection-inclusive `schema.sql()` work less guessy.

#### 4. Centralize Pongo client option construction

**Priority: medium if Pongo has repeated branches; otherwise documentation-only.**

Emmett creates Pongo clients during projection init, handle, truncate, rebuild and tests. If Pongo itself has similar repeated construction paths, it should expose or use one internal factory that always carries `defaultSchemaName` and nested `migrationTable` options together. That keeps the current PR #204 schema behavior from regressing in one branch.

### Upstream recommendation summary

| Extension                                        | Project | Recommendation                                              | Blocks Emmett |
| ------------------------------------------------ | ------- | ----------------------------------------------------------- | ------------- |
| Namespace- and signature-aware existence helpers | Dumbo   | Implement as a compatibility-preserving correctness fix     | No            |
| `SQLRoutineReference`                            | Dumbo   | Add when convenient; reuse for functions and procedures     | No            |
| Default-schema table-reference ergonomics        | Dumbo   | Add optional-schema helper or document sentinel usage       | No            |
| Relation literal / regclass helper               | Dumbo   | Add a PostgreSQL helper for sequence defaults               | No            |
| Qualified dynamic-SQL formatting helper          | Dumbo   | Document or wrap `%I.%I` patterns for PL/pgSQL              | No            |
| Full function/procedure schema component         | Dumbo   | Defer until multiple consumers establish the required model | No            |
| Shared migration-table option forwarding         | Pongo   | Already delivered; Emmett must pass the event-store option  | No            |
| Resolved collection placement diagnostics        | Pongo   | Useful for Emmett diagnostics and future SQL generation     | No            |
| Centralized Pongo client option construction     | Pongo   | Useful if repeated branches exist                           | No            |

The important Pongo/Emmett boundary is that Emmett does not need to generate Pongo's qualified CRUD SQL. Emmett creates every Pongo client with the resolved `defaultSchemaName`, points it at the same migration table used by the event store and general PostgreSQL projections, and continues passing `collectionOptions`. Pongo then uses the explicit collection schema when present and its client/database default otherwise.

## PostgreSQL advisory locks and schemas

PostgreSQL advisory locks are database-wide for the current session or transaction. They are not scoped by PostgreSQL schema. Moving `emt_processors`, `emt_projections` and the lock helper functions into `events` makes the stored lifecycle state schema-specific, but it does not automatically make advisory lock keys schema-specific.

That means two stores in the same physical database can still block each other if they use the same advisory lock key, even when their Emmett tables live in different schemas. Tests that prove data/schema isolation should therefore use distinct processor and projection names unless they intentionally assert cross-schema locking behavior.

Potential Emmett follow-up: decide whether configured schemas should be part of generated lock keys for processor/projection locks. The tradeoff is compatibility versus stronger same-database multi-schema isolation:

- keeping current keys preserves existing lock identity and avoids surprising users who use multiple schemas as one logical deployment;
- adding the event schema to generated lock keys isolates same-named processors/projections across configured schemas, but changes lock behavior for configured-schema deployments.

This does not require a Dumbo or Pongo change because the lock key is an Emmett domain key.

## PostgreSQL processor/projection decoupling

PostgreSQL processors and PostgreSQL projections should not depend on the event-store schema option model. They can eventually be used by non-PostgreSQL event sources such as MongoDB, EventStoreDB, SQS or other consumers while still storing their own processor metadata in PostgreSQL.

The event store can translate its `schema` configuration into a PostgreSQL metadata context when it creates a PostgreSQL consumer. After that boundary, processors and projections should only consume the already-prepared metadata options:

```ts
{
  migrationOptions: {
    databaseSchemaName: 'processor_metadata',
    migrationTable: {
      schemaName: 'processor_metadata',
      tableName: 'emmett_migrations',
    },
  },
}
```

This keeps these modules reusable:

- `getPostgreSQLEventStore(...)` may use `eventStoreDatabaseSchema(...)` because it owns event-store configuration;
- `postgreSQLEventStoreConsumer(...)` may prepare PostgreSQL processor metadata options from its own config;
- `createEventStoreSchema(...)` may normalize the event-store schema config for migrations and schema hooks;
- `postgreSQLProcessor(...)`, `postgreSQLProjector(...)`, `postgreSQLReactor(...)`, `postgreSQLWorkflowProcessor(...)` and `postgreSQLProjection(...)` should not import `eventStoreDatabaseSchema(...)` or apply event-store fallback rules themselves.

The current helper name `eventStoreDatabaseSchema` is therefore correct only at the event-store boundary. If the same fallback rules become useful for standalone PostgreSQL processor metadata, they should be extracted into a separate PostgreSQL metadata configuration concept instead of reused from the event-store module.

## Recommended configuration contract

Extend the existing `schema` option in both stores:

```ts
type EventStoreSchemaOptions = {
  autoMigration?: MigrationStyle;
  databaseSchemaName?: string;
  projectionsDatabaseSchemaName?: string;
  migrationTable?: {
    schemaName?: string;
    tableName?: string;
  };
};
```

Recommended resolution:

| Object                                                                  | Resolved schema                                                                                    |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Emmett event tables, functions, indexes and locks                       | `databaseSchemaName` or dialect default                                                            |
| Projection without a more specific schema                               | `projectionsDatabaseSchemaName ?? databaseSchemaName` or dialect default                           |
| Pongo projection collection with `collectionOptions.databaseSchemaName` | explicit collection schema                                                                         |
| Shared event-store/projection migration table                           | `migrationTable.schemaName ?? databaseSchemaName` and `migrationTable.tableName` or Dumbo defaults |

This preserves current behavior when all new properties are omitted. In particular, do not replace an omitted PostgreSQL schema with the literal `public`; unqualified/default behavior may intentionally be controlled by the database role.

`projectionsDatabaseSchemaName` communicates broader intent than a Pongo-specific name. Raw SQL cannot be transparently rewritten, so this setting means "the projection schema Emmett resolves and exposes," not "Emmett automatically qualifies arbitrary SQL." Pongo consumes it as its `defaultSchemaName`; raw projection hooks and handlers consume the resolved value from their context.

`migrationTable` selects the physical migration table shared by the event store and its PostgreSQL projections, including Pongo projections. It follows Dumbo/Pongo's nested shape: `migrationTable.schemaName` controls placement, and `migrationTable.tableName` controls the physical table name. When `migrationTable.schemaName` is omitted, it defaults to `databaseSchemaName`, keeping two stores with different event schemas isolated even if their projection defaults happen to coincide. Emmett should expose the resolved migration-table options in the general PostgreSQL projection context so custom projections can pass them to Dumbo just as the Pongo adapter does automatically.

## Why not connection-string or search-path inference

The issue reports a Prisma-style URL such as `?schema=events`. PostgreSQL/node-postgres does not define that as the schema selector. The earlier [Pongo issue #115](https://github.com/event-driven-io/Pongo/issues/115) considered `options=-c search_path=...`, but the new component/reference API provides a stronger contract.

Explicit configured references are preferable because they:

- work with connection strings, supplied Dumbo pools, ambient `pg.Pool`/clients and sessions;
- do not depend on mutable per-connection session state;
- do not leak a `search_path` change when a pooled connection is returned;
- qualify migrations and runtime queries identically;
- allow the event store and projections to use separate schemas;
- make schema names pass through Dumbo's dialect-aware quoting.

`search_path` can still affect deliberately unqualified user SQL. It should not be Emmett's schema ownership mechanism.

## PostgreSQL application shape

This is more than forwarding `defaultSchemaName` into Pongo.

1. Build a schema-bound event-store model/factory once from `databaseSchemaName`. Tables and all SQL using them should use `SQLTableReference` (or Dumbo table components), not `SQL.identifier(table.name)` and not interpolated dotted strings.
2. Parameterize the current schema SQL. Keep pre-schema-support migrations unchanged on the default path, but omit them for a configured schema: schema configuration is a new supported deployment mode and has no older configured stores to upgrade. Migrations added after schema support must be schema-aware and run on both paths.
3. Qualify PostgreSQL functions as well as tables. Function bodies call other functions and access tables, and partition helpers currently pass bare table-name strings into dynamic SQL. Those paths need schema-aware references or a deliberately fixed function-local `search_path`. Fully qualified references are less stateful.
4. Put the shared migration table in the resolved `migrationTable.schemaName ?? databaseSchemaName` and preserve `migrationTable.tableName` when supplied. Forward the exact same migration-table options to Pongo and expose them to general PostgreSQL projections. Dumbo must create that schema before creating the table.
5. Generate `eventStore.schema.sql()`/`print()` from the resolved instance schema. The current exported `schemaSQL` and `schemaMigration` constants can remain default-schema compatibility exports, while custom stores use factory output.
6. Carry resolved schema configuration through `PostgreSQLProjectionHandlerContext`. Passing it only to projection `init` is insufficient: Pongo clients are also created during handle and truncate operations.
7. Use one internal Pongo-client factory for init, handle, truncate and test assertions. The current wrappers construct clients in several branches, which makes partial forwarding likely.
8. Forward the same configuration through `eventStore.consumer()`, the standalone `postgreSQLEventStoreConsumer`, processor-created message stores, `withSession`, rebuild flows and projection specs.

Raw SQL projection tables remain user-owned. Emmett can expose the resolved schemas in context, but should not parse and rewrite returned SQL or silently set transaction `search_path`.

### PostgreSQL function details

The current database objects are PostgreSQL functions, not procedures. Keeping a function in the same schema as its tables is not enough: PostgreSQL resolves every unqualified table or function name through the effective `search_path`, not through the schema containing the executing function. See PostgreSQL's [`search_path` documentation](https://www.postgresql.org/docs/current/runtime-config-client.html#GUC-SEARCH-PATH).

The required Emmett changes are:

1. **Definition name:** render `CREATE FUNCTION`/`CREATE OR REPLACE FUNCTION` with the configured schema. Otherwise the function is created in the connection's current schema.
2. **Existence check:** `createFunctionIfDoesNotExistSQL` currently searches `pg_proc` by `proname` only. It must constrain `pg_namespace` and the argument signature, otherwise a same-named function in another schema or overload can suppress creation.
3. **Application call:** qualify every `SELECT function(...)` invocation. Even a correctly placed function is not callable by an unqualified name when its schema is absent from `search_path`.
4. **Static body references:** qualify event-store tables and Emmett function-to-function calls such as `emt_sanitize_name` and `emt_add_table_partition`.
5. **Signature/default expressions:** qualify Emmett functions used in parameter defaults because those expressions are resolved while the function definition is parsed.
6. **Dynamic partition SQL:** pass schema and object name separately and render `%I.%I`. Passing `events.emt_messages` to one `%I` creates the single identifier `"events.emt_messages"`, not the PostgreSQL reference `"events"."emt_messages"`. Child partitions should be created in the configured schema too. PostgreSQL documents `%I` as one identifier in its [dynamic SQL guidance](https://www.postgresql.org/docs/current/plpgsql-statements.html#PLPGSQL-STATEMENTS-EXECUTING-DYN).
7. **Catalog checks in migrations:** checks against `pg_tables`, `pg_sequences`, `pg_proc`, and similar catalogs must include the namespace. Matching only `tablename`, `sequencename`, or `proname` is ambiguous once multiple stores can coexist.

There are two viable function-body strategies:

- **Recommended:** explicitly qualify all Emmett-owned routines and relations, including dynamic SQL. This matches Pongo's schema-aware table-reference model and makes dependencies visible in generated SQL.
- **Alternative:** add a function-level `SET search_path = <event schema>, pg_catalog` clause and keep body references unqualified. For example:

  ```sql
  CREATE FUNCTION "events".emt_append_to_stream(...)
  RETURNS ...
  SET search_path = "events", pg_catalog
  LANGUAGE plpgsql
  AS $function$ ... $function$;
  ```

  The setting is stored with the function and PostgreSQL restores the caller's setting after the call, so it does not leak to the pool. The configured schema must be rendered as an identifier and must be trusted because placing writable schemas on a routine path has security implications. The behavior of function `SET` clauses is defined by [`CREATE FUNCTION`](https://www.postgresql.org/docs/current/sql-createfunction.html).

Explicit qualification is the selected strategy. It does not require rewriting pre-schema-support migrations because configured schemas have no supported historical installations. Preserve the existing migration list and hashes for the default path; for a configured schema, omit those migrations and start with the qualified current schema migration. All migrations introduced after this feature must use schema-bound references.

A function-local `search_path` would reduce qualification inside function bodies only. It would not select where `CREATE FUNCTION` places the function, qualify calls from Emmett, fix namespace-blind catalog checks, or target table DDL in future migrations. It therefore does not replace the explicit-qualification strategy.

Mere co-location is therefore not a third strategy. Without qualification or a function-local path, a function can fail to find its tables or, more dangerously, operate on same-named objects earlier in the caller's path.

## SQLite application shape

Use the same logical schema-bound table model so SQLite gets Dumbo's established physical naming rules.

1. Replace plain table identifiers with Dumbo table references. A configured `events` schema then consistently targets `"events.emt_streams"`, `"events.emt_messages"`, and so on.
2. Keep the legacy SQLite migration unchanged for the default path and omit it for a newly configured logical schema. Parameterize the current create-table SQL, and require every migration introduced after schema support to use schema-bound references.
3. Carry the resolved projection default through `SQLiteProjectionHandlerContext`, because Pongo clients are created separately for init, handle and truncate.
4. Forward it through SQLite consumers, sessions, `SQLiteProjectionSpec` and Pongo assertion helpers for both sqlite3 and D1.
5. Configure Emmett and Pongo to use the same nested `migrationTable` options, defaulting `migrationTable.schemaName` to `databaseSchemaName`. On SQLite this yields one prefixed physical table such as `"events.dmb_migrations"`; it does not create a namespace.
6. Render `schema.sql()` with the selected SQLite formatter. The current `schemaSQL.join('')` does not provide dialect formatting and will not be sufficient for schema-aware tokens.

Do not interpret a SQLite schema as an `ATTACH DATABASE` name. Dumbo reports `supportsSchemas: false`; PR #204's supported behavior is logical prefixing.

## Migration and compatibility concerns

- Omitting the new settings must produce byte-for-byte equivalent default SQL where practical and preserve existing migration hashes.
- Changing `databaseSchemaName` on an existing deployment should be documented as selecting a different store, not moving an existing store. Emmett should not copy or rename data automatically.
- A configured schema starts its migration history at the schema-support boundary. Do not execute or record no-op markers for migrations that predate supported schema configuration.
- The unreferenced PostgreSQL `0_44_0` migration remains reserved for the next release or manual execution. Schema support must not activate it; if a later release adds it to the normal migration list, it must be schema-aware and run for both deployment modes.
- A custom event-store schema needs a separate migration history by default. Otherwise equal migration names in different stores collide in the default `dmb_migrations` table.
- `migrationTable.schemaName` defaults to the event-store schema and `migrationTable.tableName` uses Dumbo's default unless supplied. The same physical table is used by the event store and all projections that run Dumbo migrations, including Pongo, even when projection objects live elsewhere.
- Pointing multiple event stores at one explicitly shared migration table is unsafe unless their migration identities are also isolated: equal migration names with different schema-qualified SQL can produce hash conflicts.
- Dry-run behavior needs coverage: schema creation, migration-table creation, event objects and inline Pongo projection objects should all target the configured names without leaving database changes.
- Custom names must remain values passed to structured Dumbo tokens. No schema name should enter `SQL.plain` or string-built PL/pgSQL without identifier-safe formatting.
- PostgreSQL names can legally contain characters that SQLite's logical mapping reserves (notably `.`). Emmett will rely on Dumbo's dialect-specific validation and document SQLite's `.` restriction rather than defining a separate portable subset or silently normalizing names.
- Supplied pools may have their own `search_path`. Explicit event-store references should still target the configured schema. With no configured schema, current pool/session behavior should remain intact.

## Generated SQL contract

Point 8 asks whether schema configuration changes the meaning of `eventStore.schema.sql()`. Today that method returns SQL for the current core event-store objects. It does not return historical migrations, the `dmb_migrations` tracking table, or projection tables.

Keep that meaning. For a PostgreSQL event schema named `events`, `schema.sql()` should conceptually return:

```sql
CREATE SCHEMA IF NOT EXISTS "events";
CREATE SEQUENCE IF NOT EXISTS "events"."emt_global_message_position";
CREATE TABLE IF NOT EXISTS "events"."emt_streams" (...);
CREATE TABLE IF NOT EXISTS "events"."emt_messages" (...);
CREATE FUNCTION "events"."emt_append_to_stream" (...) ...;
-- Remaining current Emmett core objects.
```

The precise contract is:

1. Include schema creation followed by the current schema-qualified Emmett core objects.
2. Do not add `dmb_migrations`, migration-history inserts, historical upgrade steps, or projection-owned tables to this output; those are not returned by `schema.sql()` today.
3. Make `schema.print()` print exactly the value returned by `schema.sql()`.
4. Keep `schema.migrate()` responsible for the shared migration table, the migration list appropriate to the selected deployment mode, the current schema, and projection initialization.

Thus `schema.sql()` and `schema.migrate()` must create the same definitions for core event-store objects, but they are not intended to execute the same complete workflow.

### Future projection-inclusive output

Expanding `schema.sql()` to include registered projection schemas is a useful separate change. It should not be bundled into issue #95: the schema-support work should make the existing core output correct for configured schemas without redefining its scope.

A projection-inclusive API will need a contract through which every projection exposes renderable schema SQL or structured migrations. Pongo projections can derive this from their collection components, while raw PostgreSQL projections currently expose executable initialization callbacks or SQL. That follow-up should define ordering, projection overrides, shared migration-table behavior and whether the output represents current state or versioned migration steps.

## Surface area that must stay consistent

The setting is not complete if only `getPostgreSQLEventStore` and `getSQLiteEventStore` are covered. It should be checked in:

- core append, read, stream-exists and truncate operations;
- event-store creation and all migration snapshots;
- projection registration and projection/processor locks;
- message sources, checkpoints, reactors, projectors and workflows;
- inline and asynchronous projection handling;
- Pongo projection init, handle, truncate and rebuild;
- event-store consumers created from a store and standalone consumers;
- event-store sessions;
- PostgreSQL and SQLite projection specs and Pongo assertion helpers;
- `schema.sql()`, `schema.print()` and `schema.migrate()`;
- sqlite3, D1, PostgreSQL-owned pools, supplied Dumbo pools and ambient native pools/clients.

## Pongo client ownership

Emmett's PostgreSQL Pongo projections should pass either a pool or an ambient transaction client to Pongo, never both. When the projection is already running inside an Emmett transaction, the Pongo client should be created with `connectionString + connectionOptions.client` and then closed in `finally`. That gives Pongo its own client-scoped connection facade without transferring ownership of Emmett's shared pool.

Useful Pongo follow-up: support borrowed pools explicitly. Today the type models `pool` versus `connectionOptions`, but a supplied pool is treated as client-owned on close. Pongo should expose an ownership option or borrowed-pool construction mode so integrations can pass an existing pool, close the Pongo client, and leave the borrowed pool open.

## Suggested verification matrix

At minimum:

| Store      | Scenario                                                                                                               |
| ---------- | ---------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL | Default config remains unqualified and existing tests/migration hashes pass                                            |
| PostgreSQL | Custom core schema is created; CRUD, consumers, checkpoints and locks use it; default schema has no Emmett core tables |
| PostgreSQL | Default Pongo projections inherit core schema                                                                          |
| PostgreSQL | Projection override uses a different schema and init/handle/truncate all agree                                         |
| PostgreSQL | Two stores with identical table names but different schemas are isolated in one database                               |
| PostgreSQL | Supplied pool/client and `withSession` preserve configured targeting                                                   |
| SQLite3    | Custom logical schema produces prefixed event and Pongo tables; no unprefixed duplicates                               |
| D1         | Same logical-prefix behavior as sqlite3                                                                                |
| SQLite     | Two logical schemas in one database are isolated                                                                       |
| Both       | Auto-migration disabled still sends runtime operations to the configured objects                                       |
| Both       | Dry-run/generated SQL uses the configured names and is correctly quoted                                                |

## Decisions recorded

1. **Configuration placement -- accepted:** add the names under the existing `schema` option beside `autoMigration`.
2. **Projection inheritance -- accepted:** `projectionsDatabaseSchemaName` falls back to `databaseSchemaName`.
3. **Projection scope and name -- accepted:** use `projectionsDatabaseSchemaName`. Pongo applies it automatically; raw PostgreSQL projections receive the resolved value and explicitly use it in their SQL references.
4. **Function resolution -- accepted:** explicitly qualify Emmett-owned function definitions, calls and dependencies rather than relying on a function-local `search_path`. Pre-schema-support migrations remain default-only; future migrations must be schema-aware.
5. **Migration-table options -- accepted:** add nested `migrationTable` options matching Dumbo/Pongo. `migrationTable.schemaName` defaults to `databaseSchemaName`; `migrationTable.tableName` is forwarded when supplied. The event store and all PostgreSQL projections use the same physical migration table; Pongo receives the options automatically, and custom projections receive them through context.
6. **Low-level API -- accepted:** introduce schema-bound factories and retain current constants/wrappers for default-schema compatibility rather than threading optional schema arguments through unrelated helpers.
7. **Hook/context contract -- accepted:** expose the resolved event, projection and migration-table schema names to hooks and projection contexts.
8. **Generated SQL -- accepted for issue #95:** preserve the existing core-schema meaning described above. The only schema-support addition is schema creation and qualification of those core objects. Projection-inclusive output is a separate follow-up.
9. **Data relocation -- document explicitly:** changing a configured schema selects a different store; it does not move existing data from `public` or unprefixed SQLite tables.
10. **Portable validation -- accepted:** rely on Dumbo's dialect-specific validation and document SQLite's `.` restriction.
11. **Standalone consumers/specs -- recommended as required:** support the same resolved configuration there in the initial change; otherwise production async projections and tests can silently address different schemas.
12. **Explicit names -- accepted:** only omission selects fallback/default behavior. Do not special-case `public` or compare a supplied name with the database's effective default schema.

## Local evidence reviewed

- `packages/emmett-postgresql/src/eventStore/postgreSQLEventStore.ts`: store options, migration, inline projection, consumer and session propagation.
- `packages/emmett-postgresql/src/eventStore/schema`: static unqualified SQL, stored functions, historical migrations and migration runner.
- `packages/emmett-postgresql/src/eventStore/projections`: contexts, specs and repeated Pongo client construction.
- `packages/emmett-sqlite/src/eventStore/SQLiteEventStore.ts`: store options, migration, inline projection, consumers, sessions and generated SQL.
- `packages/emmett-sqlite/src/eventStore/schema`: plain table names and legacy migration.
- `packages/emmett-sqlite/src/eventStore/projections`: contexts, specs, Pongo clients and assertion helpers.
- Installed Dumbo/Pongo declarations and runtime formatters in `node_modules/@event-driven-io`.
