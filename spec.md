# Spec: multi-driver migration for `emmett-postgresql`

Status: ready for implementation. Decisions and their alternatives are recorded in [qa.md](qa.md).

## 1. Problem

`emmett-postgresql` is half-migrated to the multi-driver model that `emmett-sqlite` already uses.

`emmett-sqlite` has an `EventStoreDriver` seam: [eventStoreDriver.ts](src/packages/emmett-sqlite/src/eventStore/eventStoreDriver.ts) declares `driverType`, `dumboDriver` and `mapToDumboOptions`; [sqlite3.ts](src/packages/emmett-sqlite/src/sqlite3.ts) and `cloudflare.ts` implement it behind subpath exports; the root index stays driver-free; and every internal `dumbo()` call gets its driver from `options.driver.mapToDumboOptions(options)`.

`emmett-postgresql` has none of that. It takes `connectionString` as a positional argument, models connection options as a hand-rolled 9-member union, and until PR #390 passed `driver` to only one of six `dumbo()` calls. The other five relied on dumbo's fallback resolution: registry lookup by `driverType`, otherwise connection-string sniffing across drivers that happen to be registered. That registry is populated only as an import side effect of `@event-driven-io/dumbo/pg`, so the behaviour depends on module side effects surviving bundling, and on a parseable connection string being present. Where neither held, users got:

```
Error: No plugin found for driver type: undefined
    at dumbo (dumbo/src/storage/all/index.ts:38:11)
    at emmett-postgresql/src/eventStore/schema/index.ts:56:11
```

Two `// TODO: Fix this when introducing more drivers` casts in [postgreSQLEventStore.ts](src/packages/emmett-postgresql/src/eventStore/postgreSQLEventStore.ts) already mark the seam that was never built.

## 2. Phase one, already shipped

PR [#390](https://github.com/event-driven-io/emmett/pull/390), branch `fix_dumbo_driver_in_postgresql`, commit `4c199048`, following PR #388 which fixed only some calls.

It threads `driver: pgDumboDriver` through the five remaining `dumbo()` calls and every affected spec, and fixes the `TS2352` build error in `postgreSQLEventStoreConsumer.handling.int.spec.ts`.

It does **not** include the lint rule or any test that proves the threading. Those move to phase two and run before any redesign code, so the redesign starts from a baseline that already fails when a driver goes missing.

Housekeeping: `qa.md` was committed into that PR. Drop it unless the design notes are meant to ship with the fix.

## 3. Scope of phase two

### In

- An `EventStoreDriver` seam for PostgreSQL, duplicated from SQLite.
- A `pgEventStoreDriver` behind a new `emmett-postgresql/pg` subpath export.
- A second `getPostgreSQLEventStore` overload taking an options object with `driver` and no positional connection string.
- Delegation of connection options to dumbo's `PgPoolOptions`.
- Removal of `connectionString` from the processor and projection handler contexts.
- Reducing the `dumbo/pg` value import to a single module (section 4.6). This is the invariant the rest of the work exists to establish.
- Lint rules and tests that make the phase-one bug class unrepeatable.

### Out

- Any capability model on the driver (`supportsAdvisoryLocks`, transaction modes). The target is a second driver on the same wire protocol. The advisory locks baked into the stored functions in [0_42_0.migration.ts](src/packages/emmett-postgresql/src/eventStore/schema/migrations/0_42_0/0_42_0.migration.ts) stay as they are.
- Any broad refactor of `projections/locks/`, `consumers/`, or the migrations. Separate what is pg-specific; do not restructure what is not.
- Docs. Deferred to a follow-up issue, which must be filed before the redesign is released.
- Hoisting `EventStoreDriver` to a shared home. Optional follow-up issue.

## 4. Target API

### 4.1 The driver seam

New file, `src/packages/emmett-postgresql/src/eventStore/eventStoreDriver.ts`, a verbatim copy of the SQLite file. It is 35 lines of storage-neutral types: `EventStoreDriver`, `EventStoreDriverOptions`, `AnyEventStoreDriverOptions`, `AnyEventStoreDriver`, `InferOptionsFromEventStoreDriver`.

### 4.2 The pg driver

New file, `src/packages/emmett-postgresql/src/pg.ts`, mirroring `emmett-sqlite/src/sqlite3.ts`:

```ts
export const pgEventStoreDriver: EventStoreDriver<
  typeof pgDumboDriver,
  PgEventStoreDriverOptions
> = {
  driverType: pgDumboDriver.driverType,
  dumboDriver: pgDumboDriver,
  mapToDumboOptions: (driverOptions) => ({
    driver: pgDumboDriver,
    connectionString: driverOptions.connectionString,
    ...driverOptions.connectionOptions,
    transactionOptions: { allowNestedTransactions: true },
  }),
};

export type PgEventStoreDriver = typeof pgEventStoreDriver;

export type PgEventStoreDriverOptions = {
  connectionString: string;
  connectionOptions?: Omit<PgPoolOptions, 'connectionString'>;
};

export type PgEventStoreOptions = PostgresEventStoreOptions<PgEventStoreDriver>;
```

Add a `./pg` entry to `package.json` `exports` and `typesVersions`, matching how `emmett-sqlite` declares `./sqlite3`, and a `src/pg.ts` entry in the tsdown config.

`mapToDumboOptions` returning an explicit `driver` key is the mechanism that makes the whole bug class impossible; it is not incidental.

### 4.3 The two overloads

```ts
/** @deprecated pass an options object carrying `driver`; removed in the next major */
export function getPostgreSQLEventStore(
  connectionString: string,
  options?: PostgresEventStoreOptions,
): PostgresEventStore;

export function getPostgreSQLEventStore<
  Driver extends AnyEventStoreDriver = PgEventStoreDriver,
>(options: PostgresEventStoreOptions<Driver>): PostgresEventStore;
```

The positional form defaults `driver` to `pgEventStoreDriver` via a static import in the root index. This is deliberate: the root entrypoint keeps pulling in `dumbo/pg` and `pg`, exactly as it does today. The `/pg` split makes the next driver cheap to add; it does not make `pg` tree-shakeable out of the default entrypoint. Splitting the entrypoint properly waits until a second driver actually exists, at which point section 4.6 is what makes it a small change.

Resolving the default lazily through `dumboDatabaseDriverRegistry` is explicitly rejected. That path is the mechanism that produced the production failure.

### 4.6 The single-import invariant

**After phase 2c, `@event-driven-io/dumbo/pg` may be imported for a value in exactly one non-test module: `src/pg.ts`.** Every other module receives the driver through `options.driver`.

This is the load-bearing requirement of the whole migration. It is what makes "add a second driver" a single-file change rather than an audit, and it is a stronger guard than the lint rule in section 5, because it is positive and has no exemption hole.

Current state, all five to be removed:

| File | Imports |
| --- | --- |
| `eventStore/postgreSQLEventStore.ts` | `pgDumboDriver` |
| `eventStore/consumers/postgreSQLEventStoreConsumer.ts` | `pgDumboDriver` |
| `eventStore/consumers/postgreSQLProcessor.ts` | `pgDumboDriver` |
| `eventStore/schema/index.ts` | `pgDumboDriver` |
| `eventStore/projections/postgresProjectionSpec.ts` | `pgDumboDriver` |

Two tiers are deliberately excluded:

- `endPgPool` in `testing/postgreSQLTestDatabase.ts` is a test helper, not a runtime path. It stays.
- Type-only imports (`PgPool`, `PgTransaction`, `PgClient`, `PgConnection`, `PgPoolOptions`) in `postgreSQLProjection.ts`, `schema/appendToStream.ts`, `pongo/pongoProjectionSpec.ts` and the five files above. These are erased at compile time and carry no runtime coupling. They stay in this pass and become a follow-up issue; collapsing them means making the handler context types generic over the driver, which is the capability-model work that section 3 puts out of scope.

### 4.4 Connection options

`PostgresEventStoreConnectionOptions` becomes `PgPoolOptions`-shaped, since dumbo already models `pooled`, `pool`, `client`, `connection` and `connectionString`. The existing union keeps compiling, marked `@deprecated`.

| Today | Target | Compatibility |
| --- | --- | --- |
| `connector?: PgDriverType` | `driverType` | deprecated alias, non-breaking |
| `dumbo: PgPool` | `pool: Dumbo` | deprecated alias, non-breaking |
| top-level `pool: pg.Pool` | `connectionOptions.pool` | **breaking**, caught at compile time |

The last row is the one part that cannot be deprecation-ramped: `pool` cannot mean both `pg.Pool` and `Dumbo` in the same object. PostgreSQL adopts SQLite's meaning, so both packages say the same thing with the same word.

### 4.5 Handler contexts

`connectionString` is removed from `PostgreSQLProcessorHandlerContext.connection` ([postgreSQLProcessor.ts:78](src/packages/emmett-postgresql/src/eventStore/consumers/postgreSQLProcessor.ts#L78)) and `PostgreSQLProjectionHandlerContext.connection` ([postgreSQLProjection.ts:34](src/packages/emmett-postgresql/src/eventStore/projections/postgreSQLProjection.ts#L34)). What remains is `pool`, `client`, `transaction`, `messageStore`, alongside the existing `driverType`. This matches SQLite, whose context has no connection string at all.

Consequent internal changes:

- `createEventStoreSchema(connectionString, pool, hooks, options)` drops its first parameter and gains the driver, matching SQLite's `createEventStoreSchema(pool, hooks, options)`.
- `transactionToPostgreSQLProjectionHandlerContext(connectionString, pool, tx)` drops its first parameter.
- [postgreSQLProcessor.ts:284](src/packages/emmett-postgresql/src/eventStore/consumers/postgreSQLProcessor.ts#L284), which throws when no connection string can be found, is deleted. A driver that has no connection string is now legal.
- [postgreSQLProcessor.ts:313](src/packages/emmett-postgresql/src/eventStore/consumers/postgreSQLProcessor.ts#L313) stops rebuilding the nested `messageStore` from a string and uses the driver plus the transaction's connection:

  ```ts
  messageStore: getPostgreSQLEventStore({
    driver: options.driver,
    connectionOptions: { connection: transaction.connection },
    schema: { autoMigration: 'None', ...options.migrationOptions },
  }),
  ```

- `getProcessorPool` ([postgreSQLProcessor.ts:332](src/packages/emmett-postgresql/src/eventStore/consumers/postgreSQLProcessor.ts#L332)) stops keying on `'connectionString' in poolOptions` and takes the driver, returning `{ pool, close }`.

## 5. Regression guard

A `no-restricted-syntax` rule in the shared `eslint.config.mjs`, plus a unit spec that loads the config and asserts the rule is present. dumbo already does exactly this in [eslintRules.unit.spec.ts](/home/oskar/Repos/Pongo/src/packages/dumbo/src/eslintRules.unit.spec.ts); mirror it.

```js
{
  selector:
    "CallExpression[callee.name='dumbo'] > ObjectExpression" +
    ":not(:has(> Property[key.name='driver']))" +
    ":not(:has(> SpreadElement))",
  message:
    'dumbo() must receive an explicit `driver`. Relying on the global driver ' +
    'registry fails when the driver module is not eagerly imported.',
}
```

Applies to `emmett-postgresql` and `emmett-sqlite`. The `SpreadElement` exemption is required, not cosmetic: SQLite's call sites legitimately supply `driver` through `...options.driver.mapToDumboOptions(options)`, which no selector can see into. The rule therefore catches the plain-object-literal case only. That is the case that broke, in all five places.

Types cannot substitute for this. `dumbo`'s second overload accepts `driver?: never` by design, so a missing `driver` is well-typed.

### 5.1 Enforcing the single-import invariant

A second rule, guarding section 4.6. `eslint.config.mjs` already uses `no-restricted-imports`, so this is an addition to existing machinery rather than new machinery:

```js
// applies to packages/emmett-postgresql/src/**, except src/pg.ts and *.spec.ts
'no-restricted-imports': ['error', {
  paths: [{
    name: '@event-driven-io/dumbo/pg',
    allowTypeImports: true,
    message:
      'Import the pg driver only in src/pg.ts. Elsewhere, take it from ' +
      '`options.driver` so adding a driver stays a single-file change.',
  }],
}],
```

`allowTypeImports: true` is what keeps this achievable in one pass: it enforces the runtime invariant that matters now, and leaves the type-only tier for the follow-up.

Of the two rules, this is the one that would have prevented the original bug outright, since a module that cannot import `pgDumboDriver` cannot forget to pass it either. The section 5 selector remains as a backstop for files that never import the driver at all.

## 6. Test plan

TDD order: every test in this section is written and failing before the corresponding phase-two code.

Nothing in the repo catches the phase-one bug today, because every spec imports `@event-driven-io/dumbo/pg` somewhere in its module graph, registering the pg driver globally so the fallback always succeeds. That is precisely why the app hit it and CI did not.

### 6.1 Poison connection string, the everyday coverage

Extend the pattern Oskar already established in `postgreSQLEventStore.e2e.spec.ts` (`should use a provided native PostgreSQL pool`, commit `390b7669`): pass an unparseable `connectionString`, `'provided-by-native-pool'`, so `canHandleDriverWithConnectionString` finds no `driverType`, fails to parse, and returns false. No globals touched, parallel-safe.

Cover each flow that creates a pool: `schema.migrate()`, append, read, consumer start, processor start, projection rebuild, `withSession`.

### 6.2 Registry-cleared backstop

One spec file, running isolated, that snapshots `globalThis.dumboDatabaseDriverRegistry`, empties it, drives a full flow, and restores in a `finally`.

This exists because the poison string defeats only connection-string sniffing. A call site resolving via a present `driverType` would still find the pg driver and pass. The backstop makes the guarantee "no internal `dumbo()` call may depend on driver resolution" rather than the weaker "may depend on string sniffing". The stronger statement is the one that would have caught this.

### 6.3 Unit

- `pgEventStoreDriver.mapToDumboOptions` output always carries `driver`, for every input option shape including the deprecated union.
- Both `getPostgreSQLEventStore` overloads resolve to a working store; the positional form defaults to `pgEventStoreDriver`.
- The deprecated aliases `connector` and `dumbo` map to `driverType` and `pool`.
- The eslint config contains the rule from section 5.

### 6.4 Existing suites

`test:unit`, `test:int` and `test:e2e` stay green for `emmett-postgresql`, `emmett-sqlite` and `emmett-tests`. Per the working agreement: nothing is assumed pre-broken, and every failure is fixed before the next phase.

## 7. Work breakdown

Build with `npm run build:ts`, never `npm run build`. After every phase: build, lint, tests, all green before proceeding.

### Phase 2a, guard and coverage

Sequential first, because 2a.1 defines the shared fixture the rest use.

1. Poison-string test helper and the registry-isolation helper.

Then in parallel:

- 2a.2 Poison-string coverage for the schema, append and read flows.
- 2a.3 Poison-string coverage for consumer, processor and projection-rebuild flows.
- 2a.4 The registry-cleared backstop spec.
- 2a.5 The eslint rule and its config spec.

Exit criterion: 2a.2 through 2a.4 pass on the current branch, since PR #390 already fixed the calls. If any fails, PR #390 missed a site; fix it there.

### Phase 2b, the driver seam

Sequential; each step's types are the next step's input.

1. `eventStoreDriver.ts` copied into `emmett-postgresql`.
2. `src/pg.ts` with `pgEventStoreDriver`, plus `package.json` exports, `typesVersions` and tsdown config.
3. Unit tests from 6.3 for the driver, failing first.
4. `PostgresEventStoreOptions` becomes generic over the driver; `connectionOptions` delegates to `PgPoolOptions`; the old union is retained and deprecated.
5. The second overload, with the positional form defaulting to `pgEventStoreDriver`.

### Phase 2c, threading the driver inward

Sequential, following the call graph outward from the store.

1. `createEventStoreSchema` drops `connectionString`, takes the driver.
2. `transactionToPostgreSQLProjectionHandlerContext` drops `connectionString`.
3. `postgreSQLEventStoreConsumer` takes the driver from options.
4. `postgreSQLProcessor`: `getProcessorPool` takes the driver, the throw at line 284 goes, the nested `messageStore` is built from the driver.
5. `connectionString` removed from both handler context types; both `TODO: Fix this when introducing more drivers` casts resolved.

Then in parallel:

- 2c.6 Update `postgresProjectionSpec.ts` and the testing helpers.
- 2c.7 Update `emmett-tests`, benchmarks and the CLI.

Finally, sequential:

8. Enable the `no-restricted-imports` rule from section 5.1 and delete the last four `pgDumboDriver` imports it flags.

Exit criterion: `grep -rn "pgDumboDriver" src --include=*.ts` outside `src/pg.ts` and specs returns nothing, and lint is green with the rule enabled. This is the check that says the migration actually happened.

### Phase 2d, close-out

Parallel:

- 2d.1 Changelog entry naming both breaks and their fixes.
- 2d.2 Follow-up issue for docs (deferred per Q12; must exist before release).
- 2d.3 Follow-up issue for hoisting `EventStoreDriver` to a shared home.
- 2d.4 Follow-up issue for the type-only `dumbo/pg` imports (section 4.6), to be picked up whenever the second driver lands.

## 8. Breaking changes

Two, both in phase two, so phase two is not a patch release.

**`context.connection.connectionString` removed.** Affects user reactors and projections reading it. TypeScript catches it; plain JS fails at runtime. Migration: use `context.connection.pool` or `context.connection.messageStore`; if the string itself is genuinely needed, capture it in the closure that constructs the processor.

**Top-level `pool: pg.Pool` moves to `connectionOptions.pool`.** Compile-time break. Migration: move the property one level down.

Everything else keeps working: the positional `getPostgreSQLEventStore(connectionString, options)` form, the existing connection-options union, `dumbo` as an alias for `pool`, and `connector` as an alias for `driverType`.

## 9. Open items

- **Second driver.** No concrete second driver is named. The seam is built for the same-wire-protocol family (`postgres.js`, `pglite`, Hyperdrive). Anything with a different execution model, Neon over HTTP being the obvious case, breaks advisory locks and needs the capability model that section 3 puts out of scope.
