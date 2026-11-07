# Versioning results that must carry `schemaVersion`: progress

Rule under test (qa.md Q74): an upcast or downcast result must carry `schemaVersion` when the input type or the result type contains a declared version other than 1. When both sides are unversioned (version 1, or the bare `number`/`any`), nothing changes.

Scratch: `/tmp/claude-1000/-home-oskar-repos-emmett/445d50e8-12b7-4065-8e97-b4c5a961da8a/scratchpad/type-surface/`. `work5/` is a fresh copy of `work4/` (bare-number factories with the command `{ now }` form). Earlier copies stay as they were.

## Log

- `work5/` created by copying `work4/`.
- Types added to the module-local `work5/packages/emmett/src/typing/messageSchemaVersion.ts` (not re-exported):
  - `DeclaresSchemaVersion<T>`: `true` when `undefined extends T['schemaVersion']` is false, that is, when a member declares a version other than 1. It distributes over unions, and is `false` for `number`, `1` and `any`.
  - `WithRequiredSchemaVersion<T>`: distributes as `T & { readonly schemaVersion: MessageSchemaVersionOf<T> }`.
  - `VersioningResult<Input, Output>`: `WithRequiredSchemaVersion<Output>` when `true extends DeclaresSchemaVersion<Input> | DeclaresSchemaVersion<Output>`, otherwise `Output`.
- `VersioningResult` replaces the return type of every upcast and downcast function type. Only the payload forms change; the parameters stay the same. The places:
  - `eventStore/versioning/upcasting.ts` (`MessageUpcast`) and `downcasting.ts` (`MessageDowncast`).
  - `eventStore/eventStore.ts` (`EventStoreReadSchemaOptions`, `EventStoreAppendSchemaOptions`). These carry the readStream, appendToStream and aggregateStream options, projection `eventsOptions`, and every driver.
  - `commandHandling/handleCommand.ts` (`CommandHandlerOptions.schema.versioning`).
  - `processors/processors.ts:380` (`ReactorOptions.messageOptions.schema.versioning`).
  - `workflows/workflowProcessor.ts:52-53` (`WorkflowOptions.schema.versioning`).
- The recorded form is unchanged: `RecordedMessage<T>` already requires `schemaVersion`, and `RecordedMessage<V1>['schemaVersion']` is `1` (earlier research, `examples/c.recorded.ts`).
- First `tsc -p tsconfig.eslint.json --noEmit` on `work5/`: 1 new error. `packages/emmett-sqlite/src/eventStore/schema/appendToStream.ts(108,13): error TS2345: Argument of type '{ downcast?: ((event: Event) => Event) | undefined; } | undefined' is not assignable to parameter of type '{ downcast?: MessageDowncast<MessageType, ...> ... Type 'Event' is not assignable to type 'RecordedMessage<...>'. Property 'metadata' is missing ...'`.
  - Cause: the SQLite schema-level `appendToStream<MessageType extends Event>` typed `options` as `AppendToStreamOptions` with the default `Event` generics, and its caller cast `appendOptions as AppendToStreamOptions`. The downcast `(event: Event) => Event` is then checked against `(message: MessageType) => VersioningResult<MessageType, Event>`, a conditional that stays deferred for the generic `MessageType`, so it no longer matches.
  - Mechanical fix: `appendToStream` gets a second generic `MessagePayloadType extends Event = MessageType`, `options` is typed `AppendToStreamOptions<MessageType, MessagePayloadType>`, and the caller in `SQLiteEventStore.ts` passes `...appendOptions` without the cast. PostgreSQL already does this.
- Second run: 3 errors, all the docs/.vitepress baseline. 0 new errors.

## Probes

Runner: `scratch/type-surface/probe5.sh <work5|dist5> <files>`. For comparison, the same file with its directives removed also runs on `work4/`.

### a. Standalone cases in the real types (`examples/a.standalone.ts`)

- The real parameter order is `MessageUpcast<Result, Stored>` and `MessageDowncast<App, Stored>`. The probe checks the payload form and the recorded form one by one: `Extract<F, (message: In) => unknown>` and the rest of the union.
- Fact, the same on `work4/` and `work5/`: an inline arrow assigned directly to the union type `MessageUpcast<B, A>` gets no contextual return type, so `'B'` widens to `string`: `a.standalone.ts(21,14): error TS2322: Type '(e: A) => { type: string; data: { b: string; }; }' is not assignable to type 'MessageUpcast<B, A>'.` The library itself only uses these unions as internal option types.
- On `work5/`: 0 errors, all 19 `@ts-expect-error` lines used. With the directives removed, `work5/` vs `work4/`:
  - Newly rejected on `work5/` (accepted on `work4/`):
    - `MessageDowncast<V2, V1>` result without a version: `(27,34) TS2322: Type '{ type: "ProductItemAdded"; data: D1; }' is not assignable to type 'Readonly<...> & { readonly schemaVersion?: 1 ...} & { readonly schemaVersion: 1 }'`.
    - `MessageDowncast<V2, V1 | V2>` with no version: (36,32).
    - `MessageUpcast<V1 | V2, V1 | V2>` with a V1 member without a version: (54,32).
    - `MessageUpcast<V1 | V2, V1 | V2>` returning the input unchanged (`(e) => e`): `(58,33) TS2322: Type 'Stored' is not assignable to type ...`.
  - Rejected on both: V1 data with version 2 (34,32) and (56,32); a missing version for V2 results (42,34) and (47,36); and in the recorded form (72,37), (77,35), (81,37). The recorded form already enforced the rule on `work4/`.
  - Accepted on both: `schemaVersion: 1` for V1 results, `schemaVersion: 2` for V2 results, recorded spread with the right version, recorded identity on `V1 | V2`, and every unversioned case (`MessageUpcast<B, A>`, `MessageDowncast<B, A>`, with or without `schemaVersion: 1`, and `MessageUpcast<A>` identity).
- Fact for a decision: the identity upcaster on `V1 | V2 -> V1 | V2` is rejected in the payload form (58,33), but accepted in the recorded form (`rup4`).

### a (inference). Inline functions in the real options (`examples/b.inference.ts`)

- On `work5/`: 0 errors, all 4 `@ts-expect-error` lines used, and no TS7006 (implicit any) anywhere.
- These infer their parameter types and compile:
  - `CommandHandler<Cart, V2, V1 | V2>({ schema: { versioning: { upcast: (e) => ..., downcast: (e) => ... } } })`;
  - `reactor<V2, ..., V1 | V2>({ messageOptions: { schema: { versioning: { upcast: (e) => ... } } } })`, where `m.schemaVersion` is `2` in `eachMessage`;
  - `readStream<V2, V1 | V2>`, `appendToStream<V2, V1 | V2>` and `aggregateStream<Cart, V2, V1 | V2>` with inline upcast and downcast;
  - `WorkflowOptions<V2, Cart, V2, ..., V1 | V2>['schema']` with inline upcast and downcast (the identity `(e) => e` downcast from V2);
  - `projection<V2, ..., V1 | V2>({ eventsOptions: { schema: { versioning: { upcast } } } })`;
  - unversioned `CommandHandler<Cart, B, A>` with inline functions that return no version.
- With the directives removed, `work5/` vs `work4/`:
  - Newly rejected on `work5/`:
    - i1b, an inline downcast without a version: `(36,7) TS2322: Type '(e: V2) => { type: "ProductItemAdded"; data: { productId: string; }; }' is not assignable to type '(event: V2) => (Readonly<...> & ...`.
    - i1c, a named downcaster annotated `(e: V2): V1` that does return `schemaVersion: 1`: `(46,27) TS2322: Type '(e: V2) => V1' is not assignable to type '(event: V2) => Readonly<...> & { readonly schemaVersion?: 1 | undefined; } & ...'`. The plain `V1` return annotation allows no version, so it no longer fits. The same function without the annotation (i1d, with `as const`) compiles.
  - Rejected on both: i3b, a readStream upcast to V2 without a version: (87,70) (on `work4/`: `'(event: Stored) => V2'`).
- Fact for a decision: a user who annotates a downcaster's return type with the plain unversioned type (`: V1`) gets an error and must drop the annotation or write `V1 & { readonly schemaVersion: 1 }`.

### b. Full repo, docs, samples, build and bundle

- `tsc -p tsconfig.eslint.json --noEmit` (all packages and docs snippets): 1 new error compared with `work4/` before the fix, 0 after it.
  - The new error was `emmett-sqlite/src/eventStore/schema/appendToStream.ts(108,13)`, see the log above. Class: mechanical (thread the payload generic, drop the erasing cast).
- The upcasting docs examples compile unchanged:
  - `docs/api-reference/commandhandler.md:228` and `:232` include `packages/emmett/src/commandHandling/handleCommandWithDecider.versioning.unit.spec.ts`.
  - `docs/guides/projections.md:168` includes `docs/guides/projections/projectionOptions.snippet.ts#versioning`.
  - `handleCommand.versioning.unit.spec.ts` (unversioned `upcast`/`downcast` passed as `schema = { versioning: { upcast, downcast } }`) also compiles.
- Samples: web API 50, `cloudflare/d1` 3, `cloudflare/durable-objects` 13, each identical to `work4/`. 0 new errors.
- `tsc -b tsconfig.json tsconfig.cloudflare.json` on `build-work5/`: exit 0, 0 errors.
- `tsdown` in `packages/emmett`: exit 0, `[attw] No problems found`. `DeclaresSchemaVersion` (792), `WithRequiredSchemaVersion` (793) and `VersioningResult` (796) are module-local `type` declarations in `dist/index.d.ts`, with 0 `export type` lines for them.
- Against the bundle (`dist5`, `skipLibCheck: false`): `a.standalone.ts`, `b.inference.ts` and `c.not-exported.ts` give 0 errors. Importing any of the three helper names from the package fails (all 3 `@ts-expect-error` used). Consumer declaration emit of `c.not-exported.ts`: no errors, and the `.d.ts` names none of the three helpers.

### c. Runtime

- No runtime code changes. The emitted JS of every changed file is identical between `build-work4/` and `build-work5/` (`diff` of `lib/*.js` without the source map line): `handleCommand.js`, `eventStore.js`, `versioning/downcasting.js`, `versioning/upcasting.js`, `processors.js`, `messageSchemaVersion.js`, `workflowProcessor.js`, and SQLite `SQLiteEventStore.js` and `schema/appendToStream.js`.
- The keep-the-original fallback stays (`upcasting.ts:66` and `downcasting.ts:66`: `...(result.schemaVersion !== undefined ? { schemaVersion: result.schemaVersion } : {})`).

### d. Alternatives

- The conditional sits only on the return type of each function type. The parameter types and the union of payload and recorded forms are unchanged. Inference held in every case of part a, with no TS7006, so I did not try overloads or a conditional on the whole function type.

## Patches

- `versioning-result-on-top-of-work4.diff`: the change relative to `work4/` (9 files: 7 in emmett, 2 in emmett-sqlite).
- `all-changes.diff`: everything against the unchanged repo (34 package files plus the durable-objects sample fix, 35 in all), with no `>=` line. `git apply --check` passes (dry run, the repo is unchanged).

## Decisions left

1. An identity upcaster `V1 | V2 -> V1 | V2` is rejected in the payload form (`a.standalone.ts(58,33)`), because a V1 input may have no version. The recorded form accepts it.
2. A downcaster annotated with a plain unversioned return type (`(e: V2): V1`) is rejected even when it returns `schemaVersion: 1` (`b.inference.ts(46,27)`). Users drop the annotation or write `V1 & { readonly schemaVersion: 1 }`.
3. Criteria 8.2 and 9.2 (keep the original version when the function returns none) then hold at the type level only for unversioned types, and at runtime as the fallback for untyped code.
4. `JSONCodec` is left unchanged. Its `T`/`Payload` are not constrained to messages (`serialization/json/jsonSerializer.ts:69-70`). The same applies to the `almanac` copy.

## Status

The rule works. The final report goes back to the coordinator.
