# Factory version in the metadata argument: progress

Design under test (qa.md Q65, Q66): stored messages keep the Dreq typing with a top-level `schemaVersion`. Only `event()`, `command()` and `message()` change: a versioned type (declared version other than 1) requires the metadata-position argument, and that argument must contain `schemaVersion: V`. The factory lifts `schemaVersion` to the top level and keeps the rest as `metadata`, and leaves out `metadata` when nothing else remains. Unversioned types and explicit version 1 keep today's argument and do not accept `schemaVersion`.

Scratch: `/tmp/claude-1000/-home-oskar-repos-emmett/445d50e8-12b7-4065-8e97-b4c5a961da8a/scratchpad/type-surface/`. `work2/` is a fresh copy of `work/` (the earlier research copy with Dreq types, recorded `schemaVersion`, upcast/downcast, and the mechanical fixes). `work/` and `orig/` stay as they were.

## Log

- `work2/` created by copying `work/`.
- Factory change applied in `work2/packages/emmett/src/typing/`: a new module `messageSchemaVersion.ts` holds `SchemaVersionProperty` (moved from `message.ts`), `SchemaVersionArgument`, `MetadataArgument` and the runtime `liftSchemaVersion`. It is not listed in `typing/index.ts`, so `export *` does not reach it. `WithSchemaVersionArgument` (the bare-number helper) is removed. `MessageSchemaVersionOf` stays public in `message.ts`.
- `tsc -p tsconfig.eslint.json --noEmit` on `work2/`: 3 errors, all the `docs/.vitepress/*.mts` baseline. 0 new errors compared with `work/`. The only real factory call with metadata, `packages/emmett/src/eventStore/events/index.ts:19` (`event<MessageSourceCaughtUp>(type, { checkpoint }, { checkpoint })`), compiles unchanged.
- `tsc -b tsconfig.json tsconfig.cloudflare.json` on a copy of `work2/` (`build-work2/`): exit 0, 0 errors. `lib/typing/messageSchemaVersion.d.ts` is emitted, and `lib/typing/event.d.ts:3` imports `MetadataArgument`, `SchemaVersionArgument` and `SchemaVersionProperty` from it. `lib/typing/event.d.ts:32` has the public `event` signature with those names.
- `tsdown` in `build-work2/packages/emmett`: exit 0, `[attw] No problems found`. In `dist/index.d.ts` the helpers are module-local, not exported: `784: type SchemaVersionProperty<...>`, `791: type SchemaVersionArgument<...>`, `794: type MetadataArgument<...>`. `MessageSchemaVersionOf` is exported (`754: export type MessageSchemaVersionOf<...>`). None of the three helper names appears in the `export { ... }` list (`dist/index.d.ts:2065`). `liftSchemaVersion` is not in the `.d.ts` and not in the `export { ... }` list of `dist/index.js`.

## Probes

Probe files are in `examples/`. Runner: `scratch/type-surface/probe2.sh <work2|dist2> <files>`. `dist2` checks against `build-work2/packages/emmett/dist/index.d.ts` with `skipLibCheck: false`.

### a. Accepted and rejected forms (`examples/a.forms.ts`)

- On `work2/`: 0 errors. All accepted forms compile: `event<V2>(t, d, { schemaVersion: 2 })`, `event<V2m>(t, d, { ...metadata, schemaVersion: 2 })`, `command<C2>(t, d, { schemaVersion: 2 })`, `command<C2>(t, d, { now, schemaVersion: 2 })`, `command<C2m>(t, d, { ...metadata, schemaVersion: 2 })`, `message<V2>('Event', t, d, { schemaVersion: 2 })`, `message<C2>('Command', ...)`, `message<V2m>(..., { tenant, schemaVersion: 2 })`. Unversioned forms compile as today, including `command<C1>(t, d)` and `command<C1>(t, d, { now })`.
- All 16 `@ts-expect-error` lines are used. With the directives removed (a temporary copy, deleted after the run), the messages are:
  - r1, V2 without argument: `(30,1) TS2554: Expected 3 arguments, but got 2.`
  - r2, `{}`: `(32,48) TS2345: Argument of type '{}' is not assignable to parameter of type 'SchemaVersionArgument<V2>'.`
  - r3, `schemaVersion: 3`: `(34,50) TS2322: Type '3' is not assignable to type '2'.`
  - r4, V2m with only `{ schemaVersion: 2 }`: `(36,49) TS2345 ... 'Meta & SchemaVersionArgument<V2m>'.`
  - r4b, V2m with metadata but no version: `(38,49) TS2345: Argument of type 'Meta' is not assignable to parameter of type 'Meta & SchemaVersionArgument<V2m>'.`
  - r5, V1 with `{ schemaVersion: 1 }`: `(40,51) TS2554: Expected 2 arguments, but got 3.`
  - r5b, V1 with metadata plus version: `(42,67) TS2353: Object literal may only specify known properties, and 'schemaVersion' does not exist in type 'Meta'.`
  - r6, explicit `Event<..., 1>`: `(45,52) TS2554: Expected 2 arguments, but got 3.`
  - r7 and r7b, unversioned command: `(47,58)` and `(49,53) TS2353 ... 'schemaVersion' does not exist in type 'DefaultCommandMetadata'.`
  - r8, C2 without argument: `(51,1) TS2554`. r8b, C2 with `{ now }`: `(53,48) TS2345 ... 'Partial<DefaultCommandMetadata> & SchemaVersionArgument<C2>'.`
  - r9, C2m with only the version: `(55,49) TS2345`.
  - r10, message V2 without argument: `(57,1) TS2554: Expected 4 arguments, but got 3.` r11, message V1 with a version: `(59,62) TS2554: Expected 3 arguments, but got 4.`
  - r12, the old bare number: `(61,48) TS2345: Argument of type 'number' is not assignable to parameter of type 'SchemaVersionArgument<V2>'.`
- Fact: the module-local helper names (`SchemaVersionArgument`, `MetadataArgument`) appear in user-facing error messages, even though users cannot import them.
- Class: works as designed, nothing to fix.

### b. Return types (`examples/b.return-types.ts`)

- On `work2/`: 0 errors. `event<V2>(...)` is exactly `V2`, its `schemaVersion` is `2`, and `metadata` is not a key of the type. `event<V2m>(...)['metadata']` is exactly `Meta`, without `schemaVersion`. `command<C2>(...)` is `C2` with `schemaVersion` `2`. `command<C2m>(...)['metadata']` is `Meta`. `message<V2>(...)` is `V2`. `event<V1>` is `V1`, whose `schemaVersion` is `1 | undefined`. `command<C1>` is `C1`.
- Class: works as designed.

### c. Runtime split (`examples/c.runtime.ts`)

- The factories in `work2/` share one module-local runtime function, `liftSchemaVersion` in `typing/messageSchemaVersion.ts`. If the argument is `undefined` or has no own `schemaVersion` key, it returns it unchanged as `metadata` (the same object, as today). Otherwise it splits off `schemaVersion` and returns the rest as `metadata` only when the rest has at least one key.
- First tsx run failed before any check: `work2/packages/emmett/src/typing/message.ts:22:0: ERROR: Expected identifier but found ">="` (esbuild, through tsx). The cause is the `>=` token that Dreq.diff puts after the `Message` type parameters (`SchemaVersion ... : 1,\n>=`). tsc and tsdown accept it, esbuild does not, so vitest would likely fail on it too (vitest not run). Fixed in `work2/` as `> =`. The same token is in `work/packages/emmett/src/typing/message.ts:17`, in `../1-agreed-types.diff`, in `../all-changes.diff` and in `unversioned-schema-version-typing/examples/real-package-patches/Dreq.diff`. Prettier would also fix it. Class: mechanical.
- Second run (`tsx c.runtime.ts` from `scratch/type-surface/runtime2/`, importing the `work2/` sources): exit 0, all `assert.deepStrictEqual` checks pass:
  - `event<V2>(t, d, { schemaVersion: 2 })` gives `{ type, data, kind: 'Event', schemaVersion: 2 }` with no `metadata` key.
  - `event<V2m>(t, d, { tenant: 't', schemaVersion: 2 })` gives `metadata: { tenant: 't' }` and `schemaVersion: 2`.
  - `command<C2>(t, d, { schemaVersion: 2 })` has no `metadata` key; `{ now, schemaVersion: 2 }` gives `metadata: { now }`.
  - `message<V2>('Event', ...)` and `message<C2>('Command', ...)` keep the given `kind`.
  - Unversioned: `event<V1>` has no `schemaVersion` and no `metadata` keys; `event<V1m>` keeps the same metadata object (`===`); `command<C1>(t, d, { now })` and `command<C1>(t, d)` are as today; an unversioned command with metadata `{}` keeps `metadata: {}` as today.
  - Edge: a V1m call with a variable `{ tenant: 't', schemaVersion: 2 }` lifts the version: the result has `schemaVersion: 2` while its type is `V1m`.
  - Edge: user metadata that declares `schemaVersion?: string`, called with `'2'`: the string `'2'` is lifted to the top level and removed from `metadata`.
  - Edge: `command<C2>(t, d, { now: undefined, schemaVersion: 2 })` keeps `metadata: { now: undefined }` (the key exists).
- Type-checking the script itself (`probe2.sh work2 c.runtime.ts`): only 4 `TS2877` errors about the absolute `.ts` import paths (lines 3, 4, 5, 7), which only affect the script. So the three edge calls above compile.

### d. Edge cases (`examples/d.edge-cases.ts`, `examples/d2.edge-options.ts`)

On `work2/`, `d.edge-cases.ts` gives 7 errors (lines 30, 30, 42, 47, 49, 51, 52). Facts by case:

- d1, a variable with an extra `schemaVersion` passed for V1: `const wide: Meta & { schemaVersion: number }` passed to `event<V1m>(t, d, wide)` compiles (no error at line 20). The same holds for an unversioned command with `{ now, schemaVersion: 2 }` in a variable (line 23). Excess property checks only apply to object literals. At runtime (part c), the version is lifted, so a value typed `V1m` carries `schemaVersion: 2`. Class: needs a decision.
- d2, user metadata types with their own `schemaVersion` key:
  - Unversioned with `schemaVersion?: string` (`V1s`): compiles (line 28). At runtime (part c) the string `'2'` is lifted to the top level and removed from `metadata`, while the type says the top-level `schemaVersion` is `1 | undefined` and `metadata.schemaVersion` is `string`.
  - Versioned with `schemaVersion?: string` (`V2s`): cannot be called at all. `d.edge-cases.ts(30,70): error TS2322: Type 'string' is not assignable to type 'never'.` and `(30,81): error TS2322: Type 'number' is not assignable to type 'never'.` The argument type `UserMetaString & { schemaVersion: 2 }` reduces to `never`.
  - Versioned with `schemaVersion: number` (`V2n`): compiles (line 33). The user's key and the reserved key are the same key.
  - Class: needs a decision.
- d3, `event<V1 | V2>(...)`: both `{ productItem }` and `{ productId }` compile without any argument (lines 36, 37), and so does `message<V1 | V2>` (line 38). The result has no `schemaVersion`. Same as with the bare-number design. Class: fact; a decision only if union type arguments should be guarded.
- d4, generic callers: `event<E>(type, data)` (42,12), `event<E>(type, data, metadata)` (47,18), `command<C>` (49,90), `message<M>` (51,14) and `event<E extends V2>(t, d, { schemaVersion: 2 })` (52,51) all fail with `TS2345 ... is not assignable to parameter of type 'EventMetaDataOf<E> extends undefined ? ...'`. Forwarding with `Parameters<typeof event<E>>` (g3) compiles. The same 4 base cases already fail on `orig/` (earlier research, part a). Class: not a regression.
- Option O1 (`d2.edge-options.ts`, 0 errors, a local `declare const` signature, not applied to the repo): `Omit<M, 'schemaVersion'> & { schemaVersion?: never }` for unversioned types and `Omit<M, 'schemaVersion'> & { schemaVersion: V }` for versioned ones. It rejects the wide variable for V1m and the user string key for V1s (both `@ts-expect-error` used), and makes `V2s` callable. The cost: the unversioned argument type is no longer exactly today's type, and `Omit` is not distributive over union metadata types (see `../examples/b.rebuild-and-spread.ts`, lines 74 to 86 in the earlier research).

### e. Full repo, docs, samples and build (after the `> =` fix)

- `tsc -p tsconfig.eslint.json --noEmit` on `work2/`: 3 errors, all the docs/.vitepress baseline. 0 new errors compared with `work/`. Packages and docs snippets contain one factory call with metadata (`eventStore/events/index.ts:19`), and it compiles unchanged. A `grep` of samples and docs finds no factory calls.
- Samples (same copies and configs as before): web API 50, `cloudflare/d1` 3, `cloudflare/durable-objects` 13. Each output is identical to `work/` (the durable-objects one after its earlier fixture fix). 0 new errors.
- `tsc -b tsconfig.json tsconfig.cloudflare.json` on `build-work2/`: exit 0, 0 errors. `tsdown` in `packages/emmett`: exit 0, `[attw] No problems found`.
- Class: no new errors, so nothing to classify. The `>=` token (part c) is the only fix needed, and the `work/` patches need it too.

### f. Helper types and declaration emit (`examples/f.helper-types.ts`)

- On `work2/` and against the bundle (`dist2`, `skipLibCheck: false`): 0 errors.
- `MessageSchemaVersionOf<V2>` is `2`, `<V1>` is `1`, `<V1 | V2>` is `1 | 2`, `<Event>` is `number`, `<C2>` is `2`, `<AnyEvent>` is `any`, and `<CreateEventType<'X', D1>>` is `{}`.
- `SchemaVersionArgument`, `MetadataArgument`, `SchemaVersionProperty` and `liftSchemaVersion` cannot be imported from `@event-driven-io/emmett`; all four `@ts-expect-error` imports are used, on source and on the bundle.
- Consumer declaration emit: `tsc -p tsconfig.emit.json` (`declaration: true`, `emitDeclarationOnly`) on the probe against the bundle gives exit 0, with no TS2742 or TS4023-style "cannot be named" errors. `out/f.helper-types.d.ts` names `V2`, `V2m` and `C2` for the factory results. For `export const factory = event`, tsc writes out the structure of the unexported helpers (`metadata: { schemaVersion: MessageSchemaVersionOf<EventType>; }` and the `undefined extends EventType["schemaVersion"] ? ... : ...` conditional) and refers only to exported names (`EventMetaDataOf`, `EventTypeOf`, `EventDataOf`, `MessageSchemaVersionOf`). So the public factory signatures emit valid `.d.ts` while the helpers stay unexported, as long as `MessageSchemaVersionOf` stays exported (I did not test it unexported).
- All other probes give the same result against the bundle as against the source: `a.forms.ts`, `b.return-types.ts`, `d2.edge-options.ts` and `f.helper-types.ts` have 0 errors, and `d.edge-cases.ts` has the same 7 errors at the same lines.
- Package build (repeated from above): `tsc -b` exit 0, and `tsdown` + attw "No problems found", with the helpers module-local in `dist/index.d.ts` (784, 791, 794).

## Patches

- `factory-change-on-top-of-work.diff`: the factory change relative to the earlier `work/` (4 files: `command.ts`, `event.ts`, `message.ts`, the new `messageSchemaVersion.ts`). It includes the `> =` fix.
- `typing-only.diff`: the whole `typing/` folder against the unchanged repo.
- `all-changes.diff`: everything against the unchanged repo (29 package files plus the durable-objects sample). `git apply --check` passes against the current repo (dry run, the repo is unchanged).
- Not formatted with Prettier.

## Decisions left

1. A variable with an extra `schemaVersion` passed for an unversioned type compiles, and the runtime lifts it (d1, part c). Options: accept it, or forbid the key in the type with O1 (`d2.edge-options.ts`, 0 errors), which changes the unversioned argument type.
2. User metadata types that declare their own `schemaVersion` key. With an unversioned type, a user string is lifted at runtime and the result contradicts its type. With a versioned type and a `string` key, the factory cannot be called (`d.edge-cases.ts(30,70)` and `(30,81)`, TS2322 to `never`). Options: accept it (the key is reserved); use O1 (the call compiles and the user key is replaced); or lift only numeric values at runtime (not tested).
3. `command<C2>(t, d, { now: undefined, schemaVersion: 2 })` keeps `metadata: { now: undefined }`. Options: accept it, or treat keys whose value is `undefined` as missing (not tested).
4. `event<V1 | V2>(...)` takes no argument and gives no version (d3), the same as in the earlier design.
5. Helper placement: an internal module that is not re-exported works (tsc -b, tsdown, attw, consumer `.d.ts` emit). The open choice is its name and file, and whether `SchemaVersionProperty` moves there from `message.ts` (done in `work2/`).

## Status

Probes a to f done, the full check is at 0 new errors, and the patches are saved. The final report goes back to the coordinator.

## O1 applied

Oskar's answer to Q67: "Metadata should exclude their schema version and we should take the numeric message schema version, if possible." `work3/` is a copy of `work2/` (which includes the `> =` fix).

- `work3/` created by copying `work2/`.
- Typing in `work3/packages/emmett/src/typing/messageSchemaVersion.ts`:
  - `MetadataArgument` is `Omit<M, 'schemaVersion'> & { schemaVersion?: never }` for unversioned types and version 1, and `Omit<M, 'schemaVersion'> & { schemaVersion: V }` for versioned types.
  - The unversioned command without declared metadata takes `metadata?: (DefaultCommandMetadata & { schemaVersion?: never }) | undefined`.
  - New module-local types: `NoSchemaVersionArgument` and `WithoutMetadataSchemaVersion<T>`, used as the factories' return type. It returns `T` unchanged unless `T`'s metadata declares a `schemaVersion` key; then it returns `Omit<T, 'metadata'> & { readonly metadata: Omit<M, 'schemaVersion'> }`.
- Runtime: `liftSchemaVersion` removes `schemaVersion` from the metadata it returns whenever the key exists. It sets the top-level version only for an integer number or a digit-only string (converted with `Number`). It leaves out `metadata` when nothing else remains, and returns an argument without the key unchanged.
- `tsc -p tsconfig.eslint.json --noEmit` on `work3/`: 3 errors, all the docs/.vitepress baseline. 0 new errors compared with `work2/`.

### O1 a. Earlier forms (`examples/a.forms.ts`, `examples/b.return-types.ts`)

- On `work3/`: 0 errors for both files. All agreed forms compile, all 16 `@ts-expect-error` lines are used, and all exact-type checks in `b.return-types.ts` still pass (`event<V2m>` is still exactly `V2m`, because `Meta` has no `schemaVersion` key).
- With the directives removed (a temporary copy, deleted after the run), the same 16 lines fail. Three messages change, from TS2353 (excess property) to TS2322 against the new `schemaVersion?: never`:
  - r5b, V1m with metadata plus version: `(42,67) TS2322: Type 'number' is not assignable to type 'undefined'.`
  - r7 and r7b, unversioned command: `(47,58)` and `(49,53) TS2322: Type 'number' is not assignable to type 'undefined'.`
  - The V2m and C2m messages now name `Omit<Meta, "schemaVersion"> & SchemaVersionArgument<V2m>` (36,49), (38,49) and `... <C2m>` (55,49).
  - The rest are unchanged: (30,1) TS2554, (32,48) TS2345, (34,50) TS2322, (40,51) TS2554, (45,52) TS2554, (51,1) TS2554, (53,48) TS2345, (57,1) TS2554, (59,62) TS2554, (61,48) TS2345.
- Fact: the message `Type 'number' is not assignable to type 'undefined'` does not name the reserved key, so it is less clear than the old TS2353 message.

### O1 b. Wide variables and user `schemaVersion` keys (`examples/o1b.user-keys.ts`)

- On `work3/`: 0 errors. All 6 `@ts-expect-error` lines are used. With the directives removed (temporary copy, deleted after the run):
  - Wide variable for V1m: `(16,52) TS2345: Argument of type 'Meta & { schemaVersion: number; }' is not assignable to parameter of type 'Omit<Meta, "schemaVersion"> & NoSchemaVersionArgument'.`
  - Wide variable `{ now, schemaVersion: 2 }` for an unversioned command: `(19,78) TS2345 ... 'DefaultCommandMetadata & NoSchemaVersionArgument'.`
  - User `schemaVersion?: string` with `'2'` for V1s: `(21,65) TS2322: Type 'string' is not assignable to type 'undefined'.` The same for a command type (23,65).
  - A string version for V2s: `(25,62) TS2322: Type 'string' is not assignable to type '2'.`
  - Result of V2n (user key `schemaVersion: number`, required) assigned to `V2n`: `(51,14) TS2322: Type 'Omit<V2n, "metadata"> & { readonly metadata: Omit<UserMetaNumber, "schemaVersion">; }' is not assignable to type 'V2n'.`
- Accepted: `event<V1s>(t, d, { meta })`, `event<V2s>(t, d, { meta, schemaVersion: 2 })` (V2s is callable now; before O1 it was not), `event<V2n>(...)`, `command<C1s>(t, d, { meta })` and `message<V2s>(...)`.
- Result types: `s1['metadata']` is exactly `Omit<UserMetaString, 'schemaVersion'>`. `schemaVersion` is not a key of the result's metadata for V2s, V2n, C1s or the message. `s2['schemaVersion']` is `2`, and `data`, `type` and `kind` keep their types. The V2s result still assigns to `V2s` (the user key is optional). The V2n result does not assign to `V2n` (51,14).
- Class: works as asked. Fact for a decision: a user type whose metadata requires `schemaVersion` gives factory results that are not assignable to the declared type.

### O1 c. Runtime (`examples/o1c.runtime.ts`)

- `tsx o1c.runtime.ts` from `scratch/type-surface/runtime3/`, importing the `work3/` sources: exit 0, all 21 `assert.deepStrictEqual` checks pass. Cases the types reject go through a cast to a loose signature (`event as unknown as (type, data, metadata?) => ...`).
  - A number is lifted: `{ schemaVersion: 2 }` gives top-level `schemaVersion: 2` and no `metadata` key.
  - Metadata is kept when other keys remain: `{ tenant: 't', schemaVersion: 2 }` gives `metadata: { tenant: 't' }`.
  - Digit strings are converted: `'2'` becomes `2` (metadata `{ tenant: 't' }` kept), and `'10'` alone becomes `10` with no `metadata` key.
  - Not numeric, so removed and not lifted, with no top-level `schemaVersion` key: `'v2'` (metadata `{ tenant: 't' }` kept; with nothing else left, neither `metadata` nor `schemaVersion`), `2.5`, `'2.0'` and `undefined`.
  - A wide command variable `{ now, schemaVersion: 2 }` (rejected by the types) still has its version lifted at runtime.
  - Commands and messages: `command<C2>` with `{ schemaVersion: 2 }` and with `{ now, schemaVersion: 2 }`; `message<C2>('Command', ...)` keeps `kind: 'Command'`.
  - Unversioned calls without the key are unchanged: `event<V1>`; `event<V1m>`, which keeps the same metadata object (`===`); `command<C1>` with and without `{ now }`; and an unversioned command with `{}`, which keeps `metadata: {}`.
- Type-checking the script (`probe3.sh work3 o1c.runtime.ts`) gives only the `TS2877` errors for its absolute `.ts` import paths.

### O1 d. Union metadata types (`examples/o1d.union-metadata.ts`)

- `Omit<Web | Batch, 'schemaVersion'>` is exactly `{ source: 'web' | 'batch' }`: only the keys common to all members survive (type equality check at line 14 passes). `DistributiveOmit<Meta, K> = Meta extends unknown ? Omit<Meta, K> : never` keeps `Omit<Web, ...> | Omit<Batch, ...>` (line 16 passes).
- On `work2/` (before O1) the file has 0 errors. On `work3/` (plain `Omit`) it has 4 errors, all excess property errors on calls that compile today:
  - `(19,87) TS2353: Object literal may only specify known properties, and 'ip' does not exist in type 'Omit<Web | Batch, "schemaVersion"> & NoSchemaVersionArgument'.` (unversioned event, union metadata)
  - `(22,90) TS2353 ... 'batchId' does not exist ...` (unversioned command)
  - `(24,84) TS2353 ... 'ip' does not exist in type 'Omit<Web | Batch, "schemaVersion"> & SchemaVersionArgument<V2u>'.` (versioned event)
  - `(33,88) TS2353 ... 'Omit<WebV | BatchV, "schemaVersion"> & NoSchemaVersionArgument'.` (members that declare `schemaVersion`)
  - A variable typed `Meta` (line 20) still compiles.
- The return type is not affected. `Event<..., Web | Batch>` is already a union of event types, because `Event`'s `Readonly<EventMetaData extends undefined ? ...>` distributes over the metadata. `WithoutMetadataSchemaVersion` distributes over that union, so `u1['metadata']` and `u2['metadata']` are exactly `Meta`, and `u4['metadata']` is exactly `Omit<WebV, 'schemaVersion'> | Omit<BatchV, 'schemaVersion'>`.
- Class: needs a fix (plain `Omit` breaks union metadata that works today). Next: test a distributive `Omit` in the real code.
- Distributive variant `work3b/` (a copy of `work3/`): `MetadataArgument` uses a module-local `WithoutSchemaVersion<M> = M extends unknown ? Omit<M, 'schemaVersion'> : never` instead of `Omit<M, 'schemaVersion'>`. Nothing else changes.
- On `work3b/`: `o1d.union-metadata.ts`, `a.forms.ts`, `b.return-types.ts` and `o1b.user-keys.ts` give 0 errors. All 4 union calls compile, and three new union rejections hold (all `@ts-expect-error` used): a version for unversioned union metadata, a versioned union without the version, and `{ source: 'web', batchId }` (a member mix-up). The 16 rejections in `a.forms.ts` and the 6 in `o1b.user-keys.ts` still hold.
- The same file on `work2/`: only `(35,12) TS2344: Type 'false' does not satisfy the constraint 'true'`. That is the line-35 check that the result metadata drops `schemaVersion`, which only O1 does. All union calls and rejections behave the same as on `work3b/`.
- Class: the distributive `Omit` fixes the union breakage. Decision: plain `Omit` as written in Q67, or the distributive form.

### O1 e. Full repo, samples, build and bundle

- `tsc -p tsconfig.eslint.json --noEmit`: `work3/` 3 errors, `work3b/` 3 errors, all the docs/.vitepress baseline. 0 new errors compared with `work2/` for both. The existing factory call with metadata (`eventStore/events/index.ts:19`) compiles unchanged.
- Samples: web API 50, `cloudflare/d1` 3, `cloudflare/durable-objects` 13 for both copies, each identical to `work2/`. 0 new errors.
- `tsc -b tsconfig.json tsconfig.cloudflare.json`: exit 0, 0 errors on both `build-work3/` and `build-work3b/`.
- `tsdown` in `packages/emmett`: exit 0, `[attw] No problems found` on both. In `dist/index.d.ts` all helpers are module-local (`type ...`, no `export type`): `SchemaVersionProperty` (784), `SchemaVersionArgument` (791), `NoSchemaVersionArgument` (794), `MetadataArgument`, `WithoutMetadataSchemaVersion`, and in `work3b` also `WithoutSchemaVersion` (797 to 799).
- Probes against the bundles (`skipLibCheck: false`): `dist3` gives the same 4 union errors as the `work3/` source (`o1d.union-metadata.ts` 19, 22, 24, 33), and 0 for `a.forms.ts`, `b.return-types.ts`, `o1b.user-keys.ts`, `f.helper-types.ts`. `dist3b` gives 0 errors for all five.
- Consumer declaration emit against the `dist3b` bundle: exit 0. For a re-exported `event`, tsc writes out the distributive `Omit` and `WithoutMetadataSchemaVersion` structure in the consumer's `.d.ts` (`out/f.helper-types.d.ts:8` to `15`). For results of user types that declare `schemaVersion`, it writes `Omit<V1s, "metadata"> & { readonly metadata: Omit<UserMetaString, "schemaVersion">; }` (`out/o1b.user-keys.d.ts:15` to `22`).
- Class: no new repo errors. The only problem found is the union-metadata breakage with plain `Omit` (part d), which the distributive form fixes.

### O1 patches

- `o1-plain-omit-on-top-of-work2.diff`: O1 as written in Q67 (`work3/`).
- `o1-distributive-omit-on-top-of-work2.diff`: O1 with the distributive `Omit` (`work3b/`).
- `all-changes-o1-distributive.diff`: everything for `work3b/` against the unchanged repo, plus the durable-objects sample fix. `git apply --check` passes (dry run, the repo is unchanged).

### O1 decisions left

1. Plain `Omit` (breaks union metadata calls that compile today, part d) or the distributive form (0 errors).
2. A user metadata type that requires `schemaVersion` (`schemaVersion: number`) gives factory results that are not assignable to the declared type (`o1b.user-keys.ts(51,14)`). An optional user key is fine.
3. The rejection message for a reserved key on an unversioned type is now `Type 'number' is not assignable to type 'undefined'` (TS2322), which does not name the key's purpose.
4. The numeric check in `liftSchemaVersion` (integer number, or a digit-only string) is the same rule as plan step 4's `isNumericSchemaVersion` in `eventStore/versioning/schemaVersion.ts`. Choose where the shared function lives, or keep two copies.

### O1 status

Done. The final report goes back to the coordinator.
