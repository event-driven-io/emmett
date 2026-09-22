# Spec: port the Cloudflare samples from Pongo to Emmett event sourcing

## Goal

Change the two Cloudflare samples (`samples/cloudflare/d1` and `samples/cloudflare/durable-objects`) from Pongo document storage to Emmett event sourcing with the SQLite event store. The HTTP API and its behavior stay the same, except for the agreed changes in "API changes".

The work also adds one small feature to Pongo and one to `emmett-sqlite`, so that inline Pongo projections can create the indexes that are defined on a typed Pongo schema.

The decisions and their reasons are in `qa.md`.

## Workstreams and order

| Workstream                                             | Repository | Depends on                                          | Can run in parallel with | Status                                                                                        |
| ------------------------------------------------------ | ---------- | --------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------- |
| A. Pongo: `definition` collection option               | `Pongo`    | nothing                                             | B, C                     | Done, released in Pongo `0.17.0-beta.56`                                                      |
| B. Emmett: `emmett-sqlite` uses the definition         | `emmett`   | A (use a local Pongo build until A is released)     | A, C                     | Done, tests only (no code change needed), Emmett `0.43.0-beta.50` uses Pongo `0.17.0-beta.56` |
| C. Samples: port on `0.43.0-beta.48`                   | `emmett`   | nothing                                             | A, B                     | Done; the D1 concurrent test and the clean test output went to E                              |
| D. Samples: bump to the new releases, wire the indexes | `emmett`   | A and B released, **and Oskar says they are ready** | nothing                  | Done                                                                                          |
| E. Fixes found in D                                    | `emmett`   | D                                                   | see workstream E         | Done, except the E3a to E3c follow-ups                                                        |

In workstream C, the D1 sample and the Durable Objects sample are independent. Two developers (or two subagents) can do them in parallel. After each workstream: build, lint, and run the tests. Fix all errors before the next step.

## Workstream A: Pongo

### Problem

`db.collection(name, options)` looks for a collection declared in the database schema definition. If there is none, it creates a bare `pongoSchema.collection(name)` with no indexes (`src/packages/pongo/src/core/database/pongoDatabaseComponent.ts`, around line 90). `PongoDBCollectionOptions` (`src/packages/pongo/src/core/typing/operations.ts`) has no way to give a definition. Pongo already accepts schema definitions at the client and database level; only the `collection()` helper is missing this option.

### Change

Add an optional `definition` to `PongoDBCollectionOptions`:

```ts
export type PongoDBCollectionOptions<
  T extends PongoDocument,
  Payload extends PongoDocument = T,
> = {
  databaseSchemaName?: string | undefined;
  definition?: PongoCollectionComponent<T>;
  schema?: {
    versioning?: {
      upcast?: (document: Payload) => T;
      downcast?: (document: T) => Payload;
    };
  };
  errors?: { throwOnOperationFailures?: boolean };
  cache?: CacheConfig | 'disabled' | PongoCache;
};
```

When `definition` is given, `collection()` uses it in place of the bare collection. Then `collection.schema.migrate()` (which migrates the database component) creates the collection table and the indexes of `definition`. Do not add extra validation rules.

### Tests (test first)

- Unit: `db.collection(name, { definition })` registers the given component, so the database component contains its indexes.
- Integration (SQLite and PostgreSQL drivers): after `collection.schema.migrate()`, the index from `definition` exists in the database.
- Existing behavior: `db.collection(name)` without `definition` works as before.

### Release

Release a new Pongo beta. Tell Oskar the version.

## Workstream B: Emmett (`emmett-sqlite`)

`pongoSingleStreamProjection` and `pongoMultiStreamProjection` already take `collectionOptions?: PongoDBCollectionOptions<...>` and pass it to `collection()` in `handle`, `truncate`, and `init` (`src/packages/emmett-sqlite/src/eventStore/projections/pongo/pongoProjections.ts`). So after workstream A, `collectionOptions.definition` goes to Pongo with no signature change.

### Change

- Bump `@event-driven-io/pongo` in `emmett-sqlite` (and in other packages that use it) to the release from workstream A. Until the release, develop against a local Pongo build.
- Change code only if a test shows that the definition does not reach `collection()` in `init`.

### Tests (test first)

- Integration: an event store with an inline `pongoSingleStreamProjection` that has `collectionOptions: { definition }` creates the index from `definition` when `eventStore.schema.migrate()` runs. Cover the `sqlite3` driver, the D1 driver, and the Durable Object driver (Miniflare).
- Existing projection tests stay green.

### Release

Release a new Emmett beta. Tell Oskar the version.

## Workstream C: samples on `0.43.0-beta.48`

Do this for both samples. The first step is to bump all `@event-driven-io/*` dependencies in both samples from `0.43.0-beta.47` to `0.43.0-beta.48`, and add `@event-driven-io/emmett-sqlite`. The samples use published npm packages, not workspace links.

Start from the event-sourced domain in `samples/webApi/honojs-with-postgresql/src/shoppingCarts` and adapt it, so that the current Cloudflare API specs pass.

### Streams and IDs

- One stream per shopping cart.
- Cart ID = stream name: `shopping_cart-${clientId}:${n}`, where `n` is the client's cart number (1, 2, 3, ...). The event store takes the stream type from the text before the first `-`.
- The same ID is the `shoppingCarts` document `_id`, the `_id` in the response body, and the ID in the URL. `shoppingCartUrl` stays as it is (it encodes `_id`), so the URL is, for example, `/clients/c1/shopping-carts/shopping_cart-c1%3A3`.

### Events

```ts
type ShoppingCartOpened = Event<
  'ShoppingCartOpened',
  { shoppingCartId: string; clientId: string; openedAt: Date }
>;
type ProductItemAddedToShoppingCart = Event<
  'ProductItemAddedToShoppingCart',
  {
    shoppingCartId: string;
    clientId: string;
    productItem: PricedProductItem;
    addedAt: Date;
  }
>;
type ProductItemRemovedFromShoppingCart = Event<
  'ProductItemRemovedFromShoppingCart',
  { shoppingCartId: string; productItem: PricedProductItem; removedAt: Date }
>;
type ShoppingCartConfirmed = Event<
  'ShoppingCartConfirmed',
  { shoppingCartId: string; confirmedAt: Date }
>;
type ShoppingCartCancelled = Event<
  'ShoppingCartCancelled',
  { shoppingCartId: string; cancelledAt: Date }
>;
```

All events carry `{ clientId }` metadata, as in the Hono sample (`ShoppingCartEventMetadata`). The `clientShoppingCarts` projection uses it to find its document.

`ShoppingCartOpened` is appended together with the first `ProductItemAddedToShoppingCart`, in one append to the new stream.

### Write model and business logic

State for `decide`: `Empty | Opened | Confirmed | Cancelled`. `Opened` keeps the product items with their unit prices and the item count. The idempotency checks are in the business logic, not in the API layer.

| Command             | State                      | Result                                                                             |
| ------------------- | -------------------------- | ---------------------------------------------------------------------------------- |
| Add product item    | `Empty`                    | `[ShoppingCartOpened, ProductItemAddedToShoppingCart]`                             |
| Add product item    | `Opened`                   | `[ProductItemAddedToShoppingCart]`; an existing product keeps its first unit price |
| Add product item    | `Confirmed` or `Cancelled` | 409 `Shopping Cart already closed`                                                 |
| Remove product item | not `Opened`               | 409 `Shopping Cart is not opened`                                                  |
| Remove product item | not enough quantity        | 409 `Not enough products in shopping cart`                                         |
| Confirm             | `Confirmed`                | no events (stream version and ETag do not change)                                  |
| Confirm             | not `Opened`               | 409 `Shopping Cart is not opened`                                                  |
| Confirm             | `Opened`, no items         | 409 `Shopping Cart is empty`                                                       |
| Cancel              | `Cancelled`                | no events                                                                          |
| Cancel              | not `Opened`               | 409 `Shopping Cart is not opened`                                                  |

Use `EmmettError` with `errorCode: 409` and the same messages as the current `businessLogic.ts`.

### Read models (inline Pongo projections)

Both projections are registered as inline projections on the event store. They run in the append transaction (`onBeforeCommit`), so the events and the read models commit or roll back together.

**`shoppingCarts`** (`pongoSingleStreamProjection` with the default document ID, which is the stream name `shopping_cart-${clientId}:${n}`): the full cart, the same shape as today's `ShoppingCart` document, plus `streamPosition`.

```ts
type ShoppingCart = {
  _id: string;
  clientId: string;
  productItems: ProductItems;
  productItemsCount: number;
  totalAmount: number;
  status: 'Opened' | 'Confirmed' | 'Cancelled';
  openedAt: Date;
  confirmedAt?: Date;
  cancelledAt?: Date;
  streamPosition: bigint; // from event.metadata.streamPosition
};
```

**`clientShoppingCarts`** (`pongoMultiStreamProjection`, document ID = `clientId`): the pointer to the client's last cart. It is created on the first `ShoppingCartOpened`; before that, there is no document.

```ts
type ClientShoppingCarts = {
  clientId: string;
  lastCartNumber: number;
  lastShoppingCartId: string;
  status: 'Opened' | 'Closed';
};
```

| Event                                            | Change                                                                           |
| ------------------------------------------------ | -------------------------------------------------------------------------------- |
| `ShoppingCartOpened`                             | `lastCartNumber + 1`, `lastShoppingCartId = shoppingCartId`, `status = 'Opened'` |
| `ShoppingCartConfirmed`, `ShoppingCartCancelled` | `status = 'Closed'`                                                              |

The pointer is used only by the command side. `GET` endpoints do not read it.

### Typed schema and indexes

Keep `src/pongo.config.ts` (in both samples) with typed collections:

- `shoppingCarts` (`ShoppingCart`) with a non-unique index on `clientId` and `status`, for the `GET .../current` query. Queries on D1 do not work without the index.
- `clientShoppingCarts` (`ClientShoppingCarts`).

Remove the unique index `shopping_carts_one_open_per_client`. Deterministic cart IDs and the pointer now stop duplicate open carts.

The projections take their `collectionName` from this schema. The read-side `pongoClient` uses the same schema with `autoMigration: 'None'`. Only `eventStore.schema.migrate()` creates or changes tables.

On `beta.48`, the projections cannot pass the definition yet, so the index is defined in the schema but not created by the migration. Workstream D fixes this.

### Command flow

**Add a product to the current cart** (`POST /clients/:clientId/shopping-carts/current/product-items`):

1. Read `clientShoppingCarts` by `clientId`.
2. If the pointer exists and `status` is `Opened`, the cart ID is `lastShoppingCartId`. Otherwise, the cart ID is `shopping_cart-${clientId}:${(lastCartNumber ?? 0) + 1}` and the expected stream version is `STREAM_DOES_NOT_EXIST`.
3. Run `handleCommand`.
4. On `ExpectedVersionConflictError`, retry from step 1 with `asyncRetry` (the same retry settings as today). If two requests open the same new cart, one append fails and its retry adds the product to the cart that the other request opened.
5. Read the cart from `shoppingCarts` and return it. Return `201 Created` with `Location` when a new cart was opened, else `200 OK`.

**Other commands** (add or remove a product by cart ID, confirm, cancel): the `If-Match` ETag is the expected stream version for `handleCommand`. The cart must belong to the client in the URL, else 404, as today.

### ETags

- The ETag is always the stream version.
- Commands return `nextExpectedStreamVersion` from `handleCommand`.
- `GET` endpoints return `streamPosition` from the `shoppingCarts` document. Remove `streamPosition` and `_version` from the response body.

### Queries

- `GET /clients/:clientId/shopping-carts/current`: query `shoppingCarts` with `{ clientId, status: 'Opened' }`. 404 if there is none.
- `GET /clients/:clientId/shopping-carts/:shoppingCartId`: load `shoppingCarts` by `_id = shoppingCartId` and `clientId`. Closed carts are returned too.

### Routes

The routes stay the same:

- `POST /clients/:clientId/shopping-carts/current/product-items`
- `GET /clients/:clientId/shopping-carts/current`
- `GET /clients/:clientId/shopping-carts/:shoppingCartId`
- `POST /clients/:clientId/shopping-carts/:shoppingCartId/product-items`
- `DELETE /clients/:clientId/shopping-carts/:shoppingCartId/product-items/:productId`
- `POST /clients/:clientId/shopping-carts/:shoppingCartId/confirm`
- `POST /clients/:clientId/shopping-carts/:shoppingCartId/cancel`

### D1 sample specifics

- Event store: `getSQLiteEventStore` with `d1EventStoreDriver` and `database: env.DB` (from `@event-driven-io/emmett-sqlite/cloudflare`), both inline projections, `autoMigration: 'CreateOrUpdate'` in development and `'None'` otherwise.
- Migrations: keep `scripts/deploy.ts` and the `POST /_system/migrations` endpoint with the bearer token. The handler calls `eventStore.schema.migrate()` in place of `pongoDb.schema.migrate()`.
- `api.ts` gets the event store and the read-side Pongo database as dependencies.

### Durable Objects sample specifics

- One Durable Object per client (`getByName(clientId)`), as today. Each object holds the client's cart streams and both read models.
- Keep the `ShoppingCartDurableObject` class and its RPC methods and signatures: `getCurrent`, `getById`, `addProductItemToCurrent`, `addProductItem`, `removeProductItem`, `confirm`, `cancel`.
- Inside the class, replace the Pongo collection with `getSQLiteEventStore` with `durableObjectEventStoreDriver` and `storage: ctx.storage`, both inline projections registered. Commands use `handleCommand`; reads use the Pongo read models in the same storage.
- Run `eventStore.schema.migrate()` in `ctx.blockConcurrencyWhile`, where `db.schema.migrate()` runs today.
- In the Worker `api.ts`, change only what the version change needs (`_version` becomes `streamPosition`).

### Tests

- `businessLogic.unit.spec.ts`: rewrite with Emmett `DeciderSpecification` (Given events / When command / Then events or error). Cover every row of the business logic table.
- New projection unit tests for `shoppingCarts` and `clientShoppingCarts`.
- `api.int.spec.ts`: use `ApiSpecification.for<ShoppingCartEvent>(...)` with `existingStream(...)` for the given state, as in `samples/webApi/honojs-with-postgresql/src/shoppingCarts/api.int.spec.ts`. Keep all current test cases and their names. Change expectations only where the agreed changes require it (the cart ID format). Keep `keeps one active cart when first products are added concurrently`.
- `api.e2e.spec.ts`: keep it (`ApiE2ESpecification`). Change expectations only where the agreed changes require it.
- Test output must be clean.

### READMEs

Rewrite the design parts of both READMEs: event streams, the two inline projections, deterministic cart IDs, the ETag from the stream position, and migrations. Keep the setup, run, test, and deploy sections, and change only the names and commands that changed. Do not hard-wrap paragraphs. Do not use em-dashes.

### CI

Keep `.github/workflows/build_and_test_sample_cloudflare-d1.yml` and `build_and_test_sample_cloudflare-durable-objects.yml`. Change them only if the new commands need it.

## Workstream D: bump and wire the indexes

Start only when Oskar says that the Pongo and Emmett releases are ready.

1. Bump `@event-driven-io/*` in both samples to the new releases.
2. Pass the typed collection from `pongo.config.ts` to both projections as `collectionOptions: { definition }`.
3. Add an integration test in each sample: after `eventStore.schema.migrate()`, the `shoppingCarts` index on `clientId` and `status` exists.
4. Run all sample tests.

Status: done. Both samples use Emmett `0.43.0-beta.50` and Pongo `0.17.0-beta.56`. Step 4 first failed on the D1 integration test `keeps one active cart when first products are added concurrently` (see E1). It passes with the Emmett release that has E1.

## Workstream E: fixes found in D

E1 goes first. E2 can run in parallel with E1. E4 goes last.

### E1. `emmett-sqlite`: absolute stream positions in `onBeforeCommit`

Problem: `appendToStream` (`src/packages/emmett-sqlite/src/eventStore/schema/appendToStream.ts`) gives the events to `onBeforeCommit` with stream positions that start at 1 in each append. The insert adds the current stream version only in SQL, so the database has the correct positions and the inline projections get incorrect positions. This applies to all SQLite drivers (sqlite3, D1, Durable Objects). PostgreSQL sets the absolute positions before its hook.

Example (D1 sample): request 1 appends `ShoppingCartOpened` and `ProductItemAddedToShoppingCart` (positions 1 and 2). Request 2 appends `ProductItemAddedToShoppingCart`: the database has position 3, but the projection gets 1. `GET` then returns ETag `W/"1"` in place of `W/"3"`.

Change: set the absolute stream position on each event before `onBeforeCommit`, as `emmett-postgresql` does.

Tests (test first): an inline projection gets the absolute stream positions when events are appended to an existing stream. Cover the sqlite3, D1, and Durable Object drivers.

Status: done. The `SQLiteEventStore.e2e.spec.ts` of each driver tests the `onBeforeCommit` hook and an inline projection.

### E1b. Emmett: declare the dumbo dependency

`emmett-sqlite` and `emmett-postgresql` import `@event-driven-io/dumbo` but do not declare it. They find it only when npm hoists the copy that Pongo brings. Add `@event-driven-io/dumbo` `0.13.0-beta.56` to `dependencies` in both packages.

Status: done.

The samples no longer have `@event-driven-io/dumbo` as a direct dependency. The published `emmett-sqlite` `0.43.0-beta.50` declares dumbo `0.13.0-beta.56`, so the samples get it through Emmett.

### E2. Samples: dependencies and READMEs

In both samples:

- Remove `@event-driven-io/dumbo` (see E1b).
- Bump `@hono/node-server` from `1.19.9` to `1.19.17`. Versions up to `1.19.14` have a high-severity vulnerability.
- Update the READMEs: the event store migration now creates the `clientId` and `status` index.
- After Oskar releases Emmett: bump Emmett in both samples, then run all sample test suites.

Status: done. Oskar bumped both samples to Emmett `0.43.0-beta.50`.

### E3. Clean test output

- Emmett `emmett-sqlite` tests: Node warns `MaxListenersExceededWarning` for `SIGTERM` and `SIGINT`. Each started processor added its own listener through `onShutdown` (`src/packages/emmett/src/utils/lifecycle/gracefulShutdown.ts`). The D1 test `handles close being called while start is initializing without race condition` starts 10 processors at the same time, and Miniflare adds 1 more listener. Fixed: `onShutdown` adds one `process` listener per signal and calls all registered handlers. The last cleanup removes the listener. The unit tests in `gracefulShutdown.unit.spec.ts` show that 11 handlers add only one listener per signal. Status: done.
  The items below are open. They are out of scope for this branch. Each one is a follow-up.

#### E3a. Durable Objects sample: `uncaught exception` logs for RPC errors

Symptom: in `samples/cloudflare/durable-objects`, `npm run test:int` passes (38/38), but it prints 17 stack traces that start with `uncaught exception; source = Uncaught (in promise)`. For example:

- `Shopping cart with ... was not found during Emmett processing`: the `NotFoundError` from `getCurrent` and `getById` in `src/shoppingCarts/shoppingCartDurableObject.ts`.
- `Shopping Cart is empty` and `Shopping Cart already closed`: the `EmmettError` with `errorCode: 409` from `conflict` in `src/shoppingCarts/businessLogic.ts`.
- `Expected version 2 does not match current 3`: the version conflict from `appendToStream` in `emmett-sqlite`.

Cause: the methods of `ShoppingCartDurableObject` are RPC methods. They throw these errors to report expected results. The Worker (`src/shoppingCarts/api.ts`) awaits each RPC call, and `getApplication` from `emmett-honojs` maps the error to a problem details response. Thus the responses and the tests are correct. But workerd also logs each error that an RPC method throws as an uncaught exception in the Durable Object, even when the Worker catches it. The D1 sample does not show these logs, because it throws the same errors in the Worker, not over RPC.

Why it matters: the test output is not clean, and a real test failure is hard to see in the noise.

Possible fixes (check each one before you select it):

1. The RPC methods return a result (for example `{ ok: true, cart }` or `{ ok: false, error: { errorCode, message } }`) in place of throwing. The Worker converts the error result back to an Emmett error, so the HTTP responses do not change.
2. Find a workerd or `@cloudflare/vitest-plugin` setting that stops these logs. Accept this only if it does not also hide real uncaught exceptions.

Done when: `npm run test:int` in the Durable Objects sample prints no `uncaught exception` lines, and all sample tests pass without changes to their expectations.

#### E3b. Both samples: `http-problem-details` source map warning

Symptom: in both samples, `npm run test:int` and `npm run test:e2e` print:

```text
Sourcemap for ".../node_modules/http-problem-details/dist/index.js" points to missing source files
```

Cause: `emmett-honojs` depends on `http-problem-details` `0.1.7`. The package publishes `dist/*.js.map`, but its `files` list does not include `src`. The maps point to `../src/index.ts`, which is not in the package. The tests run in workerd through `@cloudflare/vitest-plugin`, so Vite transforms the dependency and tries to load its source maps. The unit tests do not import `emmett-honojs`, so they do not show the warning.

Possible fixes:

1. Upstream (PDMLab/http-problem-details): publish `src`, or publish without the `.js.map` files.
2. In the sample `vitest.config.ts`: stop Vite from loading source maps for this dependency. Do not remove the warning with a log filter.

Done when: the sample test output has no source map warning.

#### E3c. `emmett-sqlite` consumer tests: swallowed errors

Symptom: in the `sqliteEventStoreConsumer.handling.int.spec.ts` of each driver (`storage/sqlite3`, `storage/d1`, `storage/durableObject`), three tests wrap the "When" and "Then" steps in `try { ... } catch (error) { console.log(error) }`:

- `handles all events appended to event store BEFORE processor was started`
- `handles only new events when startFrom END is specified`
- `handles concurrent writes with multiple processors without SQLITE_BUSY errors`

Cause and effect:

- The `catch` also catches the failures of `assertThatArray(...)`. If an assertion fails, the test logs the error and passes.
- In the Durable Objects run, the SQLITE_BUSY test prints `Processor ... was closed before reaching checkpoint` to stdout. Thus the test output is not clean, and nobody knows if the test checks anything.
- The SQLITE_BUSY test also adds `.catch(() => undefined)` to each `appendToStream`. That hides the `SQLITE_BUSY` errors that the test name says must not occur.

Possible fix: remove the `catch` blocks and keep the `finally` that closes the consumer. Remove `.catch(() => undefined)` from the appends. Then run the tests. If they fail, find why the processor closes before its checkpoint (a test timing problem or a consumer bug) and fix that cause.

Done when: the three tests in each driver have no `catch`, they pass, and they print nothing.

### E4. Verification

- Emmett (from `src`): `npm run agent:check`, the changed test files, `npm run test:unit`, and `npm test`. Status: Oskar ran `npm run agent:check` and `npm test`, and they passed.
- Each sample: type-check, lint, and all test suites. Status: passed on Emmett `0.43.0-beta.50`. D1: unit 31/31, int 38/38, e2e 6/6. Durable Objects: unit 31/31, int 38/38, e2e 3/3. The output still has the E3a and E3b noise.

## Verification

For each workstream, report which commands ran and whether they passed.

- Pongo: the Pongo repository's build, lint, and test commands.
- Emmett (from `src`): `npm run agent:check`, the changed test files, `npm run test:unit`, and `npm test` before handoff.
- Each sample (from the sample directory): type-check, lint, and all test suites (`unit`, `int`, `e2e`).

Do not commit, stage, or push. Oskar handles Git.
