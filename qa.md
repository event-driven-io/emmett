# Q&A: PostgreSQL multi-driver migration

## Q1 — Public API shape for `getPostgreSQLEventStore`

SQLite uses `getSQLiteEventStore({ driver, ... })` with no positional connection
argument. PostgreSQL uses `getPostgreSQLEventStore(connectionString, options)`.

Options offered:

- **A** — Match SQLite exactly, options-object only. Breaking for all users.
- **B** — Keep the positional signature, add optional `options.driver`. No break,
  but PG and SQLite stay asymmetric.
- **C** — Overload: support both, A documented, B kept working (deprecated) until
  the next major.

**A1: C.**

Support both forms. The options-object form carrying `driver` is the documented,
forward-looking API; the `(connectionString, options)` form keeps working and is
marked deprecated, to be removed in the next major.

## Q2 — Where does the `EventStoreDriver` abstraction live?

`emmett-sqlite/src/eventStore/eventStoreDriver.ts` is 35 lines of storage-neutral
types that PostgreSQL needs verbatim.

Options offered:

- **A** — Duplicate it in `emmett-postgresql`. One repo, one release; the two
  packages already duplicate `schema/`, `projections/` and `consumers/`.
- **B** — Hoist to `@event-driven-io/emmett` core. Cost: core has no dumbo
  dependency today, so this drags SQL storage into the storage-agnostic package.
- **C** — Move it into dumbo, next to `DumboDatabaseDriver` and the registry.
  Cost: cross-repo release lockstep with Pongo.

**A2: A.**

Duplicate the interface in `emmett-postgresql` for this migration.

Open: whether to file a follow-up issue for an eventual hoist to a shared home
(revisited in a later question).

## Q3 — How far does this pass go on `connectionString`?

`connectionString` is a required field of the PostgreSQL handler contexts
(`postgreSQLProcessor.ts:78`, `postgreSQLProjection.ts:34`), the processor throws
when it cannot find one (`postgreSQLProcessor.ts:284`), and the nested
`messageStore` is rebuilt from the string rather than from the driver
(`postgreSQLProcessor.ts:313`). SQLite's context carries `connection` and
`driverType` instead, and no connection string.

Options offered:

- **A** — Fix only the `dumbo()` driver plumbing; leave `connectionString`
  required and the `TODO` comments in place.
- **B** — Make `connectionString` optional but keep populating it; derive the
  nested store from `driver` + pool/connection; drop the throw.
- **C** — Remove `connectionString` from the contexts entirely, replacing it with
  `driver` + `pool` + `connection`, matching SQLite.

**A3: C.**

Remove `connectionString` from the handler contexts. This is a breaking change
for user reactors and projections that read `context.connection.connectionString`,
and it fails at runtime rather than compile time for plain-JS consumers, so it
needs a release note and a migration entry.

## Q4 — Driver option surface

SQLite delegates to dumbo: `{ connectionOptions?: ExtractDumboDatabaseDriverOptions<Driver> }`
plus a top-level `{ pool?: Dumbo }` escape hatch. PostgreSQL hand-rolls a 9-member
union (`connector`, `connectionString`, `database`, `pooled`, `pool` as raw
`pg.Pool`, `client` as raw `pg.Client`, `connection`, `dumbo` as `PgPool`).

Options offered:

- **A** — Delegate like SQLite; `connectionOptions` becomes `PgPoolOptions`,
  `dumbo` renamed to `pool: Dumbo`, `connector` dropped.
- **B** — Keep the union, move it behind `pgEventStoreDriver.mapToDumboOptions`.
- **C** — A, with the old union still accepted and deprecated.

**A4: C.**

Delegate to dumbo's `PgPoolOptions` as the documented shape; keep the existing
union compiling and deprecated. `connector` becomes a deprecated alias for
`driverType`.

Open: the `dumbo` vs `pool` naming collision is the one part that cannot be
deprecation-ramped by overloading (see Q5).

## Q5 — The `pool` naming collision

SQLite's top-level `pool` is a `Dumbo`; PostgreSQL's is a raw `pg.Pool`, and its
Dumbo escape hatch is `dumbo`. After Q4's delegation, the raw `pg.Pool` belongs
inside `connectionOptions`, freeing the top-level slot.

Options offered:

- **A** — PostgreSQL adopts SQLite's meaning: top-level `pool: Dumbo` in both
  packages, raw `pg.Pool` moves to `connectionOptions.pool`, `dumbo` becomes a
  deprecated alias.
- **B** — SQLite adopts PostgreSQL's meaning: rename SQLite's `pool` to `dumbo`.
- **C** — Accept both at `pool` and discriminate at runtime.

**A5: A**, plus the existing `getPostgreSQLEventStore` overload must stay
backward compatible.

So the compatibility contract is:

Guaranteed to keep working:

- `getPostgreSQLEventStore(connectionString, options)` positional form
- the existing `PostgresEventStoreConnectionOptions` union, deprecated
- `dumbo: PgPool` as a deprecated alias for `pool: Dumbo`
- `connector` as a deprecated alias for `driverType`

Accepted breaks:

- `context.connection.connectionString` removed from the processor and projection
  handler contexts (from Q3); runtime break for plain-JS handlers
- top-level `pool: pg.Pool` moves to `connectionOptions.pool`; compile-time break

Still open: which release this lands in.

## Q6 — What second driver does the seam have to carry?

Two families: same wire protocol with a different client library (`postgres.js`,
`pglite`, Hyperdrive), where the SQL and the `pg_try_advisory_xact_lock` calls
baked into the stored functions still work; or a different execution model (Neon
over HTTP), where advisory locks and `projections/locks/` stop working entirely.

Options offered:

- **A** — Same protocol only; `EventStoreDriver` maps options and names a dumbo
  driver, nothing more.
- **B** — Add capability flags now (`supportsAdvisoryLocks`, transaction mode) and
  make lock and consumer paths consult them.
- **C** — Same protocol now, but shape the seam so B is additive later.

**A6: C, kept minimal.**

No speculative capability model and no broad refactor. The goal is only that
pg-specific code is already separated behind a named boundary, so capability flags
can be added later without re-threading everything.

## Q7 — Where does the default driver come from?

SQLite makes `driver` required and exports drivers only from subpaths, keeping the
root index driver-free. PostgreSQL cannot copy that, because the existing
no-driver call must keep working, so a default must come from somewhere.

Options offered:

- **A** — Static default in the root index; `emmett-postgresql/pg` also exports
  the driver for the explicit form.
- **B** — Match SQLite exactly: `driver` required, root index driver-free.
- **C** — Lazy default resolved through `dumboDatabaseDriverRegistry`.

**A7: A**, with two explicit overloads:

1. `getPostgreSQLEventStore(connectionString, options?)` — the existing shape.
   No `driver`, defaults to the pg driver. Kept for backward compatibility.
2. `getPostgreSQLEventStore(options)` — options object carrying `driver`, with no
   positional connection string. Connection details arrive through the driver's
   own option shape rather than as a separate argument.

C is rejected outright: the registry plus import-side-effect path is the mechanism
that produced `No plugin found for driver type: undefined`.

Consequence to state plainly in the docs: the root entrypoint still pulls in
`dumbo/pg` and `pg`, exactly as it does today. The separation makes the next
driver cheap to add; it does not make `pg` tree-shakeable out of the default
entrypoint.

## Q8 — Regression guard against `dumbo()` without a driver

The bug class is a `dumbo({...})` call whose options object has no `driver` key.
Types cannot catch it, because dumbo's second overload deliberately accepts
`driver?: never`. dumbo itself already uses `no-restricted-syntax` selectors
verified by `eslintRules.unit.spec.ts`, and emmett's `eslint.config.mjs` already
uses `no-restricted-imports`.

Options offered:

- **A** — A `no-restricted-syntax` rule plus a unit spec asserting the rule
  exists, mirroring dumbo.
- **B** — A unit test that AST-walks package sources for offending calls.
- **C** — Neither; rely on review.

**A8: A.**

Caveat carried forward: the selector must exempt spread elements, because SQLite's
call sites legitimately supply `driver` via
`...options.driver.mapToDumboOptions(options)`. The rule therefore catches the
plain-object-literal case only, which is the case that broke in all five places.

Assumed unless corrected: the rule lives in the shared `eslint.config.mjs` and
applies to both `emmett-postgresql` and `emmett-sqlite`, since the spread
exemption lets SQLite pass as written.
