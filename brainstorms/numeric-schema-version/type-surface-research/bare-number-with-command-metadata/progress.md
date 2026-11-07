# Bare last number, with `{ now }` for versioned commands: progress

Question (qa.md Q71, option 1): can a versioned command without declared metadata accept both `command<C2>(type, data, 2)` and `command<C2>(type, data, { now } | undefined, 2)` in the real factories, while events keep `event<V2>(type, data, 2)` and `event<V2m>(type, data, metadata, 2)`?

Scratch: `/tmp/claude-1000/-home-oskar-repos-emmett/445d50e8-12b7-4065-8e97-b4c5a961da8a/scratchpad/type-surface/`. `work4/` is a fresh copy of `work/` (Dreq types, bare-number factories with `WithSchemaVersionArgument`, recorded `schemaVersion`, upcast/downcast, and the mechanical fixes). `work/`, `work2/`, `work3/` and `work3b/` stay as they were.

## Log

- `work4/` created by copying `work/`.
- `>=` after type parameters: `grep` finds one, in `work4/packages/emmett/src/typing/message.ts:17` (from Dreq.diff). It is changed to `> =`; `grep` for `^>=` then finds 0.
- Factory change in `work4/packages/emmett/src/typing/`:
  - `SchemaVersionProperty` and `WithSchemaVersionArgument` move from `message.ts` to a new module `messageSchemaVersion.ts`, which is not listed in `typing/index.ts`.
  - That module also holds the runtime `splitMetadataAndSchemaVersion`. It takes the arguments after `data`: a number in the last position is the version, and the first argument is metadata unless it is that version or `undefined`.
  - `command()` for a versioned command without declared metadata takes `[type, data, version] | [type, data, metadata: DefaultCommandMetadata | undefined, version]`.
  - The `event()` and `message()` tuples are unchanged from `work/`.
- `tsc -p tsconfig.eslint.json --noEmit` on `work4/`: 3 errors, all the docs/.vitepress baseline. 0 new errors compared with `work/`.

## Probes

Runner: `scratch/type-surface/probe4.sh <work4|dist4> <files>`. `dist4` checks against `build-work4/packages/emmett/dist/index.d.ts` with `skipLibCheck: false`.

### 1 and 2. Forms (`examples/a.forms.ts`)

- On `work4/`: 0 errors. All 21 `@ts-expect-error` lines are used.
- Accepted commands:
  - `command<C2>(t, d, 2)`, `command<C2>(t, d, { now }, 2)`, `command<C2>(t, d, undefined, 2)`, and `command<C2>(t, d, maybeNow, 2)` with `maybeNow: { now: Date } | undefined`.
  - `command<C3>(t, d, { now }, 3)` and `command<C2m>(t, d, metadata, 2)`.
  - Unversioned as today: `command<C1>(t, d)`, `(t, d, { now })` and `(t, d, undefined)`.
  - `typeof command<C2>(t, d, { now }, 2)` is exactly `C2`.
- Accepted events and messages: `event<V2>(t, d, 2)`, `event<V2m>(t, d, metadata, 2)` (exactly `V2` and `V2m`), `event<V1>`, `event<V1m>`, and `message<V2>`, `message<C2>`, `message<V2m>`, `message<V1>` as before.
- Rejected, with the directives removed (a temporary copy, deleted after the run):
  - r1, no version: `(26,13) TS2345: Argument of type '["AddProductItem", {...}]' is not assignable to parameter of type '[type: "AddProductItem", data: Readonly<D2>, schemaVersion: 2] | [type: "AddProductItem", ...'`.
  - r2, `{ now }` without version: (28,13) TS2345.
  - r3, version before `{ now }`: (30,13) TS2345.
  - r4, wrong literal in the short form: (32,13) TS2345.
  - r5, wrong literal in the long form: (34,13) TS2345.
  - r6, `undefined` without version: (36,13) TS2345.
  - r7, C2m without version: `(38,1) TS2554: Expected 4 arguments, but got 3.`
  - r8, C2m with `undefined` metadata: `(40,49) TS2345: Argument of type 'undefined' is not assignable to parameter of type 'Meta'.`
  - r9, C2m without metadata: (42,1) TS2554.
  - r10, version on unversioned command: `(44,51) TS2345: Argument of type 'number' is not assignable to parameter of type 'DefaultCommandMetadata'.`
  - r11, `{ now }` plus version on unversioned command: `(46,60) TS2554: Expected 2-3 arguments, but got 4.`
  - r12, other metadata than `{ now }`: (48,50) TS2345.
  - Events and messages: r13 (60,1) TS2554; r14 (62,48) `TS2345: Argument of type '3' is not assignable to parameter of type '2'.`; r15 (64,1) and r16 (66,1) TS2554; r17 (68,51) and r18 (70,52) `TS2554: Expected 2 arguments, but got 3.`; r19, `event<V2>(t, d, undefined, 2)`: `(72,59) TS2554: Expected 3 arguments, but got 4.`; r20 (80,1) TS2554; r21, `message<C2>` with `{ now }`: `(82,68) TS2554: Expected 4 arguments, but got 5.`
- Fact: for a versioned command without declared metadata, a wrong call gets a long TS2345 that lists both tuple forms, instead of a short "Expected N arguments" message.
- Event `undefined` form: today `event<E1>('A', { n: 1 }, undefined)` on the unchanged repo copy fails with `TS2554: Expected 2 arguments, but got 3.` (throwaway probe on `orig/`, deleted after the run). An event without declared metadata has no metadata position, and with declared metadata the metadata is required. An `event<V2>(t, d, undefined, 2)` form would therefore have no unversioned counterpart, unlike the command form, which mirrors today's optional `metadata?` in `command<C1>(t, d, undefined)`. Not added; `work4/` rejects it (r19). `message()` also never took default command metadata (r21).

### 3. Runtime (`examples/c.runtime.ts`)

- `tsx c.runtime.ts` from `scratch/type-surface/runtime4/`, importing the `work4/` sources: exit 0, all 22 `assert.deepStrictEqual` checks pass.
  - `command<C2>(t, d, 2)` gives `{ type, data, kind: 'Command', schemaVersion: 2 }` with no `metadata` key.
  - `command<C2>(t, d, { now }, 2)` gives `metadata: { now }` and `schemaVersion: 2`.
  - `command<C2>(t, d, undefined, 2)` gives `schemaVersion: 2` and no `metadata` key.
  - `command<C2m>(t, d, { tenant }, 2)` keeps the metadata.
  - Unversioned `command<C1>`: no `schemaVersion` key; with `{ now }` it has metadata; with `undefined` it has no `metadata` key (as today).
  - `event<V2>(t, d, 2)` has no `metadata` key; `event<V2m>(t, d, { tenant }, 2)` keeps it.
  - `event<V1>` and `event<V1m>` are unchanged, with the same metadata object (`===`) and no `schemaVersion` key.
  - `message()` keeps the given `kind` for `'Event'` and `'Command'`, with and without metadata.
- Type-checking the script (`probe4.sh work4 c.runtime.ts`): only the TS2877 errors for its absolute `.ts` import paths.

### 4. Full repo, samples, build and bundle

- `tsc -p tsconfig.eslint.json --noEmit` (packages and docs snippets): 3 errors, all the docs/.vitepress baseline. 0 new errors compared with `work/`. The existing call with metadata (`eventStore/events/index.ts:19`) compiles unchanged.
- Samples: web API 50, `cloudflare/d1` 3, `cloudflare/durable-objects` 13, each identical to `work/` (durable-objects with its earlier fixture fix). 0 new errors.
- `tsc -b tsconfig.json tsconfig.cloudflare.json` on `build-work4/`: exit 0, 0 errors. `lib/typing/messageSchemaVersion.d.ts` is emitted.
- `tsdown` in `build-work4/packages/emmett`: exit 0, `[attw] No problems found`.
- Class: no new errors, nothing to classify.

### 5. Helper types stay unexported (`examples/f.helper-types.ts`)

- `dist/index.d.ts`: `784: type SchemaVersionProperty<...>` and `791: type WithSchemaVersionArgument<...>` are module-local (no `export`). `MessageSchemaVersionOf` is exported (`754: export type MessageSchemaVersionOf<...>`). `splitMetadataAndSchemaVersion` appears 0 times in `dist/index.d.ts` and is not in the `export { ... }` list of `dist/index.js`.
- `f.helper-types.ts` on `work4/` and against the bundle (`dist4`, `skipLibCheck: false`): 0 errors. Importing `WithSchemaVersionArgument`, `SchemaVersionProperty` or `splitMetadataAndSchemaVersion` from the package fails (all 3 `@ts-expect-error` used). `a.forms.ts` against the bundle: 0 errors, the same as against the source.
- Consumer declaration emit against the bundle: exit 0. `out/f.helper-types.d.ts` names `V2`, `V2m` and `C2` for the factory results. For a re-exported `command`, tsc writes out the tuple structure (3 occurrences of `schemaVersion: MessageSchemaVersionOf<CommandType>`) and names none of the module-local helpers (0 matches for `WithSchemaVersionArgument`, `SchemaVersionProperty` or `messageSchemaVersion`).

## Patches

- `factory-change-on-top-of-work.diff`: the change relative to the earlier `work/` copy (`command.ts`, `event.ts`, `message.ts`, the new `messageSchemaVersion.ts`). It includes the `> =` fix.
- `all-changes.diff`: everything against the unchanged repo (29 package files plus the durable-objects sample fix). It contains no `>=` line. `git apply --check` passes (dry run, the repo is unchanged).
- Not formatted with Prettier.

## Status

Option 1 works. All checks are done, and the final report goes back to the coordinator.
