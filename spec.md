# Durable Object support in `emmett-sqlite`

## Goal

Add a Cloudflare Durable Object SQLite event store driver to `@event-driven-io/emmett-sqlite`, so an event store can run inside a Durable Object the same way it already runs on sqlite3 and D1.

Dumbo and Pongo already ship their Durable Object layers. This work is the Emmett layer on top of them, plus the test runner Emmett currently lacks and the documentation both Cloudflare drivers are missing.

## Background

### What already exists below Emmett

`@event-driven-io/dumbo/cloudflare` exports a complete Durable Object SQLite stack:

- `cloudflareDurableObjectSQLiteDumboDriver` and `CloudflareDurableObjectSQLiteDumboOptions`
- client, connection, pool, SQL executor and transaction implementations
- `canHandle` accepting `'storage' in options || 'client' in options || 'connection' in options`

`@event-driven-io/pongo/cloudflare` exports `cloudflareDurableObjectSQLiteDriver` for Pongo projections.

Both already appear in `emmett-sqlite`'s dependency tree; the package imports `@event-driven-io/dumbo/cloudflare` for D1 today, and that single Dumbo entry point already contains the Durable Object code.

### What Emmett has

`src/cloudflare.ts` holds the D1 driver inline and exports only `d1EventStoreDriver`. `src/sqlite3.ts` holds the sqlite3 driver inline. Nothing in the repository mentions Durable Objects.

### Why the existing D1 test approach does not stretch

Emmett's D1 specs run in the Node environment: `new Miniflare({ d1Databases })`, then `mf.getD1Database('DB')`. That works because a `D1Database` handle can cross into Node.

`DurableObjectStorage` cannot. `ctx.storage` exists only inside workerd, and Miniflare's `unsafeGetDurableObjectStorage()` returns only `{ exec() }` — a raw SQL escape hatch, not something Dumbo can take. Durable Object specs must therefore run inside the workers runtime under `@cloudflare/vitest-plugin`, which is new infrastructure for this repository.

Pongo already solved this and is the reference to mirror.

### The Pongo files to copy from

Pongo lives at `/home/oskar/repos/Pongo`. Every piece of Cloudflare test infrastructure this spec asks for already exists there. Read these before writing the Emmett equivalents:

| Piece                                                 | Pongo file                                                                                     |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Workers-runtime Vitest project                        | `src/vitest.cloudflare.config.ts`                                                              |
| Registering it beside the node projects               | `src/vitest.config.ts`                                                                         |
| Keeping Durable Object specs out of the node projects | `src/vitest.shared.ts`                                                                         |
| Wrangler config for the test worker                   | `src/packages/dumbo/wrangler.durable-object-sqlite.jsonc`                                      |
| The empty test worker                                 | `src/packages/dumbo/src/storage/sqlite/durableObject/testing/durableObjectSQLiteTestWorker.ts` |
| Type-checking specs against workers types             | `src/tsconfig.cloudflare.json`                                                                 |
| Keeping Durable Object specs out of the package build | `src/packages/dumbo/tsconfig.json` (`exclude`)                                                 |
| Scripts and dependency versions                       | `src/package.json`                                                                             |
| A spec acquiring storage                              | `src/packages/pongo/src/e2e/sqlite/durableObject/durableObject.e2e.spec.ts`                    |
| Driver-level specs                                    | `src/packages/pongo/src/storage/sqlite/durableObject/`                                         |

Follow these. Emmett differs in two places: it drops the `sqlite` path segment, since `emmett-sqlite` is already the SQLite package, and it generates `worker-configuration.d.ts` without runtime types (see step 1). Everything else matches.

## Scope

### In scope (steps 1-3)

- The `durableObjectEventStoreDriver`, at parity with `d1EventStoreDriver`: append, read, schema migrations, Pongo projections.
- Restructuring the existing sqlite3 and D1 drivers into the new folder convention.
- Cloudflare test infrastructure.
- Six specs.
- Documentation for the Durable Object driver, plus backfilled documentation for D1.

### In scope (step 4), sequenced after those

- **Consumers and processors driven by the Durable Object alarms API** — [Step 4](#step-4--consumers-on-the-alarms-api). Agreed work, but **not designed yet**. Step 4 collects the research and the open questions; we settle them together before anyone builds it. Held until steps 1-3 are green so a failure has one cause rather than two.

### Out of scope

- **One Durable Object per stream.** Mostly documentation — see below.
- **Parameterising the existing sqlite3-only spec suite by driver.** Tracked separately.
- **Cloudflare sample applications.** Pongo has `samples/cloudflare/d1` and `samples/cloudflare/durable-objects`; Emmett will not add them here.

## Design decisions

### The driver takes `storage`, and the app calls `blockConcurrencyWhile`

The driver's options carry `storage: DurableObjectStorage` only — matching what Dumbo and Pongo accept, and keeping `mapToDumboOptions` a pure data mapping as it is for sqlite3 and D1.

Blocking migration is an idiom the application writes and the documentation shows:

```ts
export class ShoppingCartsDurableObject extends DurableObject {
  private store: SQLiteEventStore<DurableObjectEventStoreDriver>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    this.store = getSQLiteEventStore({
      driver: durableObjectEventStoreDriver,
      storage: ctx.storage,
      schema: { autoMigration: 'None' },
    });

    ctx.blockConcurrencyWhile(() => this.store.schema.migrate());
  }
}
```

Class names in this spec and in the documentation spell `DurableObject` out. `DO` is an abbreviation only Cloudflare regulars read fluently, and it collides with too much else.

The rejected alternative was for the driver to accept `ctx` and block on its own. It was rejected because `getSQLiteEventStore` is synchronous, so blocking inside it is a hidden async side effect; because a throwing callback **terminates and resets the Durable Object** rather than surfacing a catchable error, as does exceeding the 30-second `blockConcurrencyWhile` timeout; and because Emmett cannot detect whether it was called from the constructor, the only context where `blockConcurrencyWhile` is well behaved.

### `autoMigration` keeps the shared default

The Durable Object driver does **not** change the default. With no configuration, tables are created on first use, exactly as on sqlite3 and D1. The startup form above is a documented production recommendation, not a requirement.

Lazy migration was verified safe inside a Durable Object: in `SQLiteEventStore.ts:199-250`, `migrateSchema = migration` is assigned synchronously right after `createEventStoreSchema(...)` returns, with no await between the guard and the assignment, so concurrent callers in one isolate share a single promise.

### Transactions roll back, unlike D1

Dumbo's Durable Object transactions run through `client.storage.transaction(...)`, a real SQLite transaction. `CloudflareDurableObjectSQLiteTransactionOptions = Omit<DatabaseTransactionOptions, 'readonly'>` — there is no `mode` (`session_based` / `strict`) and no `readonly`. Nesting is guarded by `allowNestedTransactions`, which defaults to `false`.

This is a behavioural fork from D1, and the existing specs state it outright:

- `appendToStream.sqlite3.int.spec.ts`: _"should be allowed to throw exception inline and everything, including the events being stored are rolled back"_
- `appendToStream.d1.int.spec.ts`: _"throwing exception inline and everything, including the events being stored are NOT rolled back"_

**Durable Object follows sqlite3.** The D1 specs cannot be cloned for Durable Object.

### One event store per Durable Object

Each Durable Object instance owns an independent event store holding many streams — a whole feature, not a single aggregate. Consequences to document:

- The 10 GB SQL storage cap, 2 MB row/BLOB cap, 100 KB SQL statement cap and 30-second CPU limit apply per Durable Object, not to the system.
- **`globalPosition` is totally ordered within one Durable Object only.** There is no global order across Durable Objects, so a subscription spanning them is a separate problem this driver does not solve.

### Folder convention: `src/storage/{driver}/`

Each driver gets a folder, and the entry files become barrels. The folder is named for storage rather than for drivers because it is meant to hold more than the driver object — Durable Object machinery such as the alarm-driven consumers of step 4 belong there too.

This mirrors Dumbo and Pongo, whose `src/cloudflare.ts` is nothing but

```ts
export * from './storage/sqlite/core';
export * from './storage/sqlite/d1';
export * from './storage/sqlite/durableObject';
```

with the real code in `src/storage/sqlite/{driver}/`. Emmett drops the redundant `sqlite` segment, since `emmett-sqlite` is already the SQLite package.

**Specs live in the folder too.** A driver's specs are as driver-specific as its code, so they move in with it and drop the driver from their filename: `eventStore/schema/appendToStream.d1.int.spec.ts` becomes `storage/d1/appendToStream.int.spec.ts`. Two reasons. It is how Pongo does it. And it lets every config select Durable Object specs by folder rather than by filename — that selection appears in four config files, and a filename typo in any of them means a spec that runs in no project and fails by never running.

Published exports stay as they are — `.`, `./cli`, `./sqlite3`, `./cloudflare` — matching Dumbo and Pongo, neither of which publishes nested Cloudflare entries.

Naming follows Emmett's existing terse style: `durableObjectEventStoreDriver` beside `d1EventStoreDriver`, since the `cloudflare` barrel already disambiguates.

## Implementation

Four steps. Each must be green before the next begins. Steps 1-3 are ready to build; step 4 still needs a design discussion.

### Step 1 — Restructure and test runner

No behaviour changes. Existing specs must pass untouched.

**Restructure**

```
src/packages/emmett-sqlite/src/
  cloudflare.ts                                  # becomes a barrel
  sqlite3.ts                                     # becomes a barrel
  storage/
    sqlite3/
      index.ts                                   # from sqlite3.ts
      sqlite3.unit.spec.ts                       # from src/sqlite3.unit.spec.ts
      SQLiteEventStore.e2e.spec.ts               # from eventStore/SQLiteEventStore.sqlite3.e2e.spec.ts
      appendToStream.int.spec.ts                 # from eventStore/schema/appendToStream.sqlite3.int.spec.ts
      readLastMessageGlobalPosition.int.spec.ts  # from eventStore/schema/readLastMessageGlobalPosition.sqlite3.int.spec.ts
    d1/
      index.ts                                   # from cloudflare.ts
      cloudflare.unit.spec.ts                    # from src/cloudflare.unit.spec.ts
      SQLiteEventStore.e2e.spec.ts               # from eventStore/SQLiteEventStore.d1.e2e.spec.ts
      appendToStream.int.spec.ts                 # from eventStore/schema/appendToStream.d1.int.spec.ts
      readLastMessageGlobalPosition.int.spec.ts  # from eventStore/schema/readLastMessageGlobalPosition.d1.int.spec.ts
```

Specs move with their driver, so a folder holds the driver and everything that tests it. The driver name leaves the filename, because the folder already carries it. Only relative imports change, with two exceptions. `storage/sqlite3/SQLiteEventStore.e2e.spec.ts` builds its database path from its own location, so it needs one more `..`. `eventStore/projections/pongo/pongoProjection.customid.int.spec.ts` imports a type from the d1 `appendToStream` spec, so that import path changes too.

This is what lets every config select Durable Object specs by folder (`**/storage/durableObject/**`) instead of by filename, which is how Pongo does it.

```ts
// src/cloudflare.ts
export * from './storage/d1';

// src/sqlite3.ts
export * from './storage/sqlite3';
```

`tsdown.config.ts` entries and `package.json` exports are unchanged.

**Test runner**

Mirrors Pongo file for file. These files change or appear:

```
src/
  vitest.cloudflare.config.ts                     # new — the workers-runtime project
  vitest.config.ts                                # register that project
  vitest.shared.ts                                # keep Durable Object specs out of the node projects
  tsconfig.cloudflare.json                        # new — type-check Durable Object specs with workers types
  tsconfig.eslint.json                            # keep Durable Object specs out of the node lint project
  eslint.config.mjs                               # lint Durable Object specs against tsconfig.cloudflare.json
  package.json                                    # devDependencies + scripts
  packages/emmett-sqlite/
    tsconfig.json                                 # keep Durable Object specs out of the package build
    wrangler.durable-object.jsonc                 # new
    worker-configuration.d.ts                     # new — generated by wrangler, committed
    src/storage/durableObject/testing/durableObjectTestWorker.ts        # new
```

**How these specs end up running with everything else**

This is the part worth being precise about, because nothing about it is automatic.

`src/vitest.config.ts` today lists project _directories_, each of which has its own `vitest.config.ts` extending `vitest.shared.ts`. Vitest also accepts a _config file path_ as a project entry, and that is how the workers project joins in:

```ts
// src/vitest.config.ts
projects: [
  'packages/almanac',
  'packages/emmett',
  // ...
  'packages/emmett-sqlite',
  'vitest.cloudflare.config.ts', // <-- added
],
```

Emmett's suites are filename filters over all projects at once:

```jsonc
"test": "run-s test:unit test:int test:e2e",
"test:int": "vitest run \".int.spec\"",
"test:e2e": "vitest run \".e2e.spec\"",
```

`vitest run ".int.spec"` is a substring filter applied across every registered project. So once `vitest.cloudflare.config.ts` is in the array, `npm run test:int` boots workerd alongside the node projects and runs `storage/durableObject/appendToStream.int.spec.ts` because that filename contains `.int.spec`. Likewise `npm run test:e2e` picks up the `.e2e.spec.ts` ones. `npm test` runs all three suites, so **the Durable Object specs are part of `npm test` from the moment the project is registered**. No CI change is needed for them to run; the CI change below is only for type-checking. Pongo wires it exactly this way — `'vitest.cloudflare.config.ts'` sits between `'packages/dumbo'` and `'packages/pongo'` in its projects array.

`test:int:cloudflare` exists for iterating on Durable Object specs alone, not for CI.

The corresponding cost: the node projects would otherwise also match those filenames and fail, since `ctx.storage` and `cloudflare:test` do not exist under Node. So `vitest.shared.ts` must exclude them:

```ts
exclude: [
  '**/*.browser.spec.ts',
  '**/src/storage/durableObject/**/*.int.spec.ts',
  '**/src/storage/durableObject/**/*.e2e.spec.ts',
  '**/node_modules/**',
  '**/dist/**',
],
```

Every Durable Object spec must therefore live under `src/storage/durableObject/`. That folder is load-bearing in four places — both vitest configs, `vitest.shared.ts` and `tsconfig.cloudflare.json` — so a spec put anywhere else runs in no project at all and fails silently by never running.

Selecting by folder rather than by filename is what Pongo does, and it follows from the `storage/{driver}/` layout: the driver and the specs that cover it sit together, and no filename has to be spelled correctly in four config files.

`src/vitest.cloudflare.config.ts`:

```ts
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: './packages/emmett-sqlite/wrangler.durable-object.jsonc',
      },
    }),
  ],
  test: {
    name: '@event-driven-io/cloudflare',
    include: [
      'packages/emmett-sqlite/src/storage/durableObject/**/*.int.spec.ts',
      'packages/emmett-sqlite/src/storage/durableObject/**/*.e2e.spec.ts',
    ],
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});
```

**Type-checking**

`npm run build:ts` is `tsc -b`, and `packages/emmett-sqlite/tsconfig.json` includes `./src/**/*`. Left alone, it would try to compile Durable Object specs against Node types and fail on `cloudflare:test`, `cloudflare:workers` and `env`. Pongo solves this with a split, and Emmett copies it:

`packages/emmett-sqlite/tsconfig.json` gains an `exclude`:

```jsonc
"exclude": [
  "./src/storage/durableObject/**/*.int.spec.ts",
  "./src/storage/durableObject/**/*.e2e.spec.ts",
  "./src/storage/durableObject/testing/durableObjectTestWorker.ts"
]
```

`src/tsconfig.cloudflare.json` (new) then checks exactly those files with the right types:

```jsonc
{
  "extends": "./tsconfig.shared.json",
  "compilerOptions": {
    "moduleResolution": "bundler",
    "types": [
      "node",
      "@cloudflare/vitest-plugin/types",
      "@cloudflare/workers-types",
      "./packages/emmett-sqlite/worker-configuration.d.ts",
    ],
    "noEmit": true,
  },
  "include": [
    "packages/emmett-sqlite/worker-configuration.d.ts",
    "packages/emmett-sqlite/src/storage/durableObject/**/*.int.spec.ts",
    "packages/emmett-sqlite/src/storage/durableObject/**/*.e2e.spec.ts",
    "packages/emmett-sqlite/src/storage/durableObject/testing/durableObjectTestWorker.ts",
  ],
  "exclude": [],
}
```

`worker-configuration.d.ts` is generated by `wrangler types`, not written by hand, and gives the `env.TEST_OBJECT` binding its type. It is used only by the specs and is not published: it sits outside `src/`, and the package publishes only `dist`. Emmett cannot reuse Dumbo's copy, because the published Dumbo package does not include it and it types Dumbo's test object, not ours.

It is generated with `--include-runtime=false`, so it holds only the 13 lines of `Env` types. The Cloudflare runtime types, including the `cloudflare:workers` module, come from `@cloudflare/workers-types` in the `types` array instead. Emmett already depends on that package for D1. This differs from Pongo, whose generated file also carries ~15,000 lines of runtime types.

`build:ts` becomes `tsc -b tsconfig.json tsconfig.cloudflare.json`, matching Pongo, so the Durable Object specs are type-checked by the same command as everything else.

ESLint needs the same split. Typed linting parses every file against `src/tsconfig.eslint.json`, so the excluded files must be excluded there too, and `eslint.config.mjs` gains an override that parses them against `tsconfig.cloudflare.json`, as Pongo does:

```js
{
  files: [
    'packages/emmett-sqlite/src/storage/durableObject/**/*.int.spec.ts',
    'packages/emmett-sqlite/src/storage/durableObject/**/*.e2e.spec.ts',
    'packages/emmett-sqlite/src/storage/durableObject/testing/durableObjectTestWorker.ts',
  ],
  languageOptions: {
    parserOptions: { project: './tsconfig.cloudflare.json' },
  },
},
```

`vitest.cloudflare.config.ts` joins `vitest.config.ts` in the ESLint `ignores`.

The restructure also moves the ESLint driver seams. `eslint.config.mjs` forbids value imports of `@event-driven-io/dumbo/sqlite3` and `@event-driven-io/dumbo/cloudflare` everywhere except the files that wire the drivers. Those exemptions were `src/sqlite3.ts` and `src/cloudflare.ts`; they become `src/storage/sqlite3/**` and `src/storage/d1/**`. `src/eslintRules.unit.spec.ts` asserts that list and changes with it.

**Wrangler config and test worker**

`packages/emmett-sqlite/wrangler.durable-object.jsonc`:

```jsonc
{
  "name": "emmett-sqlite-durable-object-tests",
  "main": "src/storage/durableObject/testing/durableObjectTestWorker.ts",
  "compatibility_date": "2026-08-31",
  "durable_objects": {
    "bindings": [
      {
        "name": "TEST_OBJECT",
        "class_name": "EmmettDurableObjectSQLiteTestObject",
      },
    ],
  },
  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["EmmettDurableObjectSQLiteTestObject"],
    },
  ],
}
```

`packages/emmett-sqlite/src/storage/durableObject/testing/durableObjectTestWorker.ts` — deliberately empty, as in Dumbo, and kept with the Durable Object code as Dumbo keeps it. The object exists only so `runInDurableObject` has something to hand real `ctx.storage` out of; the event store is constructed inside each spec, not here:

```ts
import { DurableObject } from 'cloudflare:workers';

export class EmmettDurableObjectSQLiteTestObject extends DurableObject {}

export default {};
```

**Dependencies and scripts**

`src/package.json` gains, at the versions Pongo pins:

```jsonc
"@cloudflare/vitest-plugin": "1.1.3",
"@cloudflare/workers-types": "5.20260831.1",
"wrangler": "4.128.0"
```

and three scripts:

```jsonc
"test:int:cloudflare": "vitest run --config vitest.cloudflare.config.ts",
"types:cloudflare": "wrangler types packages/emmett-sqlite/worker-configuration.d.ts --config packages/emmett-sqlite/wrangler.durable-object.jsonc --include-runtime=false",
"types:cloudflare:check": "wrangler types packages/emmett-sqlite/worker-configuration.d.ts --config packages/emmett-sqlite/wrangler.durable-object.jsonc --include-runtime=false --check"
```

`.github/workflows/build_and_test.yml` gains a `npm run types:cloudflare:check` step before `build:ts`, matching Pongo. That step guards against a stale generated `worker-configuration.d.ts`; it is not what makes the specs run.

**Proof this step works:** `storage/durableObject/durableObjectRunner.int.spec.ts` opens a pool with `dumbo({ driver: cloudflareDurableObjectSQLiteDumboDriver, storage })` and runs `SELECT 1`, confirming the runner boots and `runInDurableObject` yields usable storage. It uses Dumbo's driver directly, because Emmett's Durable Object driver arrives in step 2.

### Step 2 — Driver and specs, tests first

**Specs, written before the driver**

```
packages/emmett-sqlite/src/
  storage/durableObject/appendToStream.int.spec.ts
  storage/durableObject/readLastMessageGlobalPosition.int.spec.ts
  storage/durableObject/SQLiteEventStore.e2e.spec.ts
  storage/durableObject/pongoProjection.int.spec.ts
  storage/durableObject/transactions.int.spec.ts
  storage/durableObject/migration.int.spec.ts
```

Each acquires storage the way Pongo's specs do, copied from `packages/pongo/src/e2e/sqlite/durableObject/durableObject.e2e.spec.ts`:

```ts
import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';

let storage: DurableObjectStorage;

aroundEach(async (runTest) => {
  const stub = env.TEST_OBJECT.get(env.TEST_OBJECT.newUniqueId());
  await runInDurableObject(stub, async (_instance, state) => {
    storage = state.storage;
    await runTest();
  });
});
```

Using a fresh `newUniqueId()` per test gives isolation without a cleanup helper, which is what `deleteSQLiteDatabaseFiles` does for the sqlite3 specs.

Coverage, derived from the sqlite3 e2e suite (836 lines, at `storage/sqlite3/SQLiteEventStore.e2e.spec.ts` after step 1) rather than the D1 one (567 lines):

- All sqlite3 append cases, **including the rollback assertion**.
- The sqlite3 e2e suite **minus** `should create the sqlite connection in memory, and not close the connection`, which is sqlite3-specific.
- The five sqlite3 observability specs: appending, reading, inline projections, aggregating stream, and causationId/correlationId rooting.
- `should tell whether a stream exists`, present in sqlite3 and absent from D1.
- `should keep processor checkpoints in the configured schema`, present in D1 and absent from sqlite3.
- Pongo projections against Durable Object storage — never exercised on this driver before.
- Transaction nesting and rollback through `storage.transaction(...)`, including that nesting is rejected unless `allowNestedTransactions` is set.
- `schema.migrate()` run under `ctx.blockConcurrencyWhile`, and separately the lazy default path.

Assert every field of every event, per the project's testing convention; partial matching is the exception.

**The driver**

`packages/emmett-sqlite/src/storage/durableObject/index.ts`:

```ts
import type { DurableObjectStorage } from '@cloudflare/workers-types';
import {
  cloudflareDurableObjectSQLiteDumboDriver,
  type CloudflareDurableObjectSQLiteDumboOptions,
} from '@event-driven-io/dumbo/cloudflare';
import { cloudflareDurableObjectSQLiteDriver } from '@event-driven-io/pongo/cloudflare';
import type { SQLiteEventStoreOptions } from '../../eventStore';
import type { EventStoreDriver } from '../../eventStore/eventStoreDriver';

export const durableObjectEventStoreDriver = {
  driverType: cloudflareDurableObjectSQLiteDumboDriver.driverType,
  dumboDriver: cloudflareDurableObjectSQLiteDumboDriver,
  pongoDriver: cloudflareDurableObjectSQLiteDriver,
  mapToDumboOptions: (options) => ({
    driver: cloudflareDurableObjectSQLiteDumboDriver,
    storage: options.storage,
    ...options.connectionOptions,
    transactionOptions: {
      allowNestedTransactions: true,
      ...options.connectionOptions?.transactionOptions,
    },
  }),
} satisfies EventStoreDriver<
  typeof cloudflareDurableObjectSQLiteDumboDriver,
  DurableObjectEventStoreDriverOptions
>;

export type DurableObjectEventStoreDriver =
  typeof durableObjectEventStoreDriver;

export type DurableObjectEventStoreDriverOptions = {
  storage: DurableObjectStorage;
  connectionOptions?: Omit<
    CloudflareDurableObjectSQLiteDumboOptions,
    'storage'
  >;
};

export type DurableObjectEventStoreOptions =
  SQLiteEventStoreOptions<DurableObjectEventStoreDriver>;
```

Note the absence of `mode: 'session_based'`, which the D1 driver sets and Durable Object has no equivalent for.

`src/cloudflare.ts` becomes:

```ts
export * from './storage/d1';
export * from './storage/durableObject';
```

### Step 3 — Documentation

In `src/docs/event-stores/sqlite.md`, add a Cloudflare section covering both drivers. D1 is currently undocumented anywhere in `src/docs`; this closes that gap at the same time.

Content:

- Setup for each driver, with imports and a full `DurableObject` subclass.
- Schema migration: the default, and the `blockConcurrencyWhile` production form.
- Transactions: Durable Object rolls back, D1 does not. State this plainly, since it is the most likely surprise when moving between them.
- Durable Object limits: 10 GB storage, 2 MB row, 100 KB statement, 30-second CPU.
- Ordering: `globalPosition` is per Durable Object, with no order across Durable Objects.
- Choosing between D1 and Durable Objects.

Follow the project's documentation style: plain English, claims grounded in examples, framed by what the reader gets.

### Step 4 — Consumers on the alarms API

> **Not designed yet. Do not implement from this section.**
>
> Steps 1-3 are settled and ready to build. Step 4 is agreed work, but we have not discussed how it should look. What follows is research, not a design: what the code already does, and what Cloudflare forces on us. The open questions at the end need answering together before anyone writes code.

**Why the polling pump cannot stay**

`pollingMessageSource.read()` is `while (!signal.aborted)` with a backoff delay (`packages/emmett/src/consumers/messageSources/pollingMessageSource.ts:99`). Inside a Durable Object that loop either pins the object in memory forever or dies on eviction mid-read.

**Core Emmett can already drain and return**

An earlier draft of this spec claimed `MessageConsumer` had no entry point meaning "process what is there and return". That was wrong. Reading the code:

- `pollingMessageSource` yields `MessageSourceCaughtUp` the moment `areMessagesLeft` is false (`pollingMessageSource.ts:111`).
- The consumer loop aborts its controller and breaks on that control message when `until.noMessagesLeft` is set (`packages/emmett/src/consumers/consumers.ts:447-453`).
- `start(): Promise<void>` resolves when that loop ends (`consumers.ts:74`).

So `await consumer.start()` with `until: { noMessagesLeft: true }` already drains and returns. Whatever step 4 turns out to be, it probably does not need a new core API.

`sqliteEventStoreConsumer` also already accepts an optional `source`, so a non-polling source could be substituted without touching the consumer.

Checkpointing needs nothing new either. `sqliteCheckpointer` writes to the processor checkpoints table via `storeProcessorCheckpoint`, so a checkpoint survives eviction today.

**What Cloudflare forces on us**

- A Durable Object is evicted after **70-140 seconds** of inactivity. In-memory state does not survive; SQLite storage does. Anything step 4 builds is reconstructed on every wake-up.
- `setAlarm(scheduledTimeMs)` is persisted by the platform, survives eviction, and wakes the object. **The constructor runs before `alarm()`**, so a step 1 `blockConcurrencyWhile` migration has finished before `alarm()` starts.
- Each Durable Object has **exactly one alarm slot**, and `setAlarm` overwrites whatever is in it.
- Alarms are **at-least-once**: a throwing `alarm()` retries with exponential backoff from 2 seconds, up to 6 retries, with `retryCount` and `isRetry` on `alarmInfo`. A replayed batch must not double-process.
- An `alarm()` handler holds no lock and other requests interleave at every `await`, but a Durable Object is single-threaded, so CPU-bound work in `alarm()` delays incoming requests.

**Open questions, to discuss before implementing**

1. **Who owns the alarm slot?** There is only one, and `setAlarm` overwrites it. If Emmett arms it, any application using alarms for its own purposes breaks, and breaks invisibly. If the application arms it, Emmett is a function it calls from its own `alarm()` handler and the wiring is the user's job. There may be a middle option where Emmett owns the slot only when asked to. This is the main decision and everything else follows from it.
2. **Does the consumer stop, always?** A consumer that keeps running is the shape that breaks in a Durable Object, which argues for fixing `until: { noMessagesLeft: true }` rather than exposing it. Against that: it is one more place where the Durable Object driver behaves unlike the others.
3. **Where does the code live?** In `emmett-sqlite` under `storage/durableObject/`, or in core Emmett if the drain-and-return shape is useful beyond Cloudflare.
4. **How much does a wake-up cost?** The consumer and its processors are rebuilt on every alarm. Worth measuring before settling on a shape.
5. **How do we prove idempotency?** The checkpoint argument says a replayed alarm re-reads from the stored checkpoint. That needs a spec under Miniflare's `unsafeEvictDurableObject()` and a forced retry, not an assertion in a document.

**Testing it, when we get there**

Miniflare exposes `unsafeEvictDurableObject()`, so eviction and alarm wake-ups are reproducible. Specs follow the step 1 convention and live in `storage/durableObject/`.

Documentation gains an alarms section in `src/docs/event-stores/sqlite.md` once the design is settled.

## Verification

Per step:

1. `npm run agent:check`, then `npm run test:unit`, then `npm run test:int` — the restructure must not change any result. The trivial Durable Object spec must pass under `npm run test:int:cloudflare`.
2. `npx vitest run --config vitest.cloudflare.config.ts` for the Durable Object specs while iterating, then `npm run test:unit` before declaring the step done.
3. `npm run docs:build`.
4. Not applicable yet — step 4 is undesigned. Verification comes with its design.

Before final handoff: `npm test` from `src`.

Report which commands ran, whether they passed, and why anything relevant was skipped.

## Out of scope, in detail

### One Durable Object per stream

Documentation and a sample, not code. Name the Durable Object after the aggregate and use the store normally:

```ts
export class ShoppingCartDurableObject extends DurableObject {
  private streamId = `ShoppingCart:${this.ctx.id}`;

  addItem = (item: PricedProductItem) =>
    this.store.appendToStream(this.streamId, [
      { type: 'ProductItemAdded', data: { item } },
    ]);
}
```

A stream-bound helper that removes the repeated `streamId` is a possible convenience, not a requirement.

### Parameterising the spec suite

Roughly fourteen integration specs — projections, Pongo projections, consumers, schema, migrations — are sqlite3 file-based only, built on `deleteSQLiteDatabaseFiles`. Making them driver-parameterised would give D1 and Durable Object full coverage. It is a cross-cutting refactor of passing tests and should not land alongside a new driver.

### Cloudflare samples

Pongo ships `samples/cloudflare/d1` and `samples/cloudflare/durable-objects`, each with a CI workflow. Emmett has neither.

## Risks

- **New test runner in the repository.** `@cloudflare/vitest-plugin` boots workerd. If it proves slow or flaky in CI, the fallback is to keep the project registered but move it out of the default `npm test` fan-out — at the cost of the Durable Object specs no longer running by default.
- **Restructuring two working drivers.** Mitigated by landing it in its own step with no test changes.
- **Pongo projections on Durable Object storage are unproven in Emmett.** Dumbo and Pongo test their own layers, but the Emmett projection path has never run against Durable Object. This is the most likely source of surprises in step 2.
