# Standard Schema, Standard JSON Schema and the TypeScript schema-library ecosystem

Research for the message schemas brainstorm. Collected on 2026-10-04. This file describes what exists and what was observed. It does not recommend a design.

How to read the citations:

- **verified**: I read the published package source or typings, or ran code and saw the result.
- **reported**: taken from docs, blog posts or issue threads only.

Paths below are relative to `/home/oskar/repos/emmett/schema-research/`:

- `sources/standard-schema/`: saved pages, docs and issue threads.
- `packages/`: unpacked npm tarballs.
- `prototypes/standard-schema/`: runnable checks. `outputs.txt` holds the full output of every script. `npx tsc -p .` passes on TypeScript 6.0.3, the version Emmett uses.

Every script parses the same event payload, `ShoppingCartConfirmed`, from its JSON wire form. The payload has a uuid string, an ISO date that should become a `Date`, a number, an integer, a two-value enum, an optional deprecated string, a nullable string, an array of objects and a string record. The payload and the report helper are in `prototypes/standard-schema/harness.ts`.

## 1. The specs

### 1.1 Interfaces

`@standard-schema/spec` 1.1.0 (published 2025-12-15) holds three interfaces. All of them sit under one property, `~standard` (verified: `packages/standard-schema-spec-1.1.0/dist/index.d.ts`).

```ts
interface StandardTypedV1<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly types?: { readonly input: Input; readonly output: Output } | undefined;
  };
}

// StandardSchemaV1 adds:
readonly validate: (value: unknown, options?: { readonly libraryOptions?: Record<string, unknown> })
  => Result<Output> | Promise<Result<Output>>;
// Result = { value: Output; issues?: undefined } | { issues: ReadonlyArray<{ message: string; path?: ReadonlyArray<PropertyKey | { key: PropertyKey }> }> }

// StandardJSONSchemaV1 adds:
readonly jsonSchema: {
  readonly input: (options: { target: Target; libraryOptions?: Record<string, unknown> }) => Record<string, unknown>;
  readonly output: (options: { target: Target; libraryOptions?: Record<string, unknown> }) => Record<string, unknown>;
};
type Target = "draft-2020-12" | "draft-07" | "openapi-3.0" | ({} & string);
```

### 1.2 Semantics

- **`types` exists only for the compiler.** It is optional and is usually `undefined` at runtime. `InferInput` and `InferOutput` read it through `NonNullable<Schema["~standard"]["types"]>` (verified: spec typings).
- **`validate` may be sync or async.** It returns either a result or a `Promise`. The FAQ says a consumer that needs sync validation should throw when it gets a `Promise`, and that libraries "are encouraged to preferentially use synchronous validation" (reported: `sources/standard-schema/standard-schema-spec-schema.md`, FAQ).
- **A falsy `issues` means success.** Consumers check `result.issues`, not `"value" in result`.
- **`libraryOptions` lets callers pass vendor-specific settings** to both `validate` and `jsonSchema.*`. ArkType and Valibot forward it to their converters. Effect ignores it (verified: `node_modules/@ark/schema/out/roots/root.js`, `@valibot/to-json-schema` `toStandardJsonSchema`, `effect/dist/internal/schema/standardSchema.js`).
- **Input and output JSON Schema can differ.** The FAQ example is a schema that accepts `"123"` and outputs `123`. When the two types are the same, both methods return the same schema (reported: `standardschema-json-schema.html`).
- **Conversion may throw.** That covers unsupported targets and types JSON cannot represent. The spec says libraries "should throw if they don't support a specified target", and integrators "should account for this" (reported, same source).
- **Targets.** `draft-2020-12` and `draft-07` are "strongly recommended". `openapi-3.0` is "a superset of JSON Schema draft-04". `{} & string` keeps the type open for future targets (verified: typings).
- **The two specs are separate traits.** A schema can implement one or both. The docs show an intersection type for consumers that need both (reported). MCP calls it `StandardSchemaWithJSON` (verified: `packages/modelcontextprotocol-server-2.3.0`).
- **A dependency is optional.** You may copy the types into your code. If your public API exposes them, the FAQ says to make `@standard-schema/spec` a regular dependency, not a dev dependency (reported: `standard-schema-spec-schema.md`).
- **Why the key is a string.** `~` sorts last in autocomplete. Symbol keys were rejected because TypeScript has no type-level `Symbol.for` and symbols break when two versions of the package are installed (reported: FAQ; `standard-schema-gh-14-symbols-bidirectional-encoding.md`).

### 1.3 Out of scope, and open proposals

Inngest summarises the scope: "Standard Schema does not standardize error formatting, metadata, defaults, JSON Schema generation, or schema introspection" (reported: `inngest-too-many-schema-libraries.html`). Since Standard JSON Schema shipped, JSON Schema generation has a standard of its own. The rest is still library-specific.

| Topic | Status | Source |
| --- | --- | --- |
| Metadata (`title`, `description`, defaults) | No field on `~standard`. Proposal #109 asked for `.def`. Colin McDonnell: "If the structure of the def is library-specific then it has no place on `~standard`... The 'right way' ... is some kind of 'Standard AST' spec which has been floated but isn't in active development." Fabian Hiller: "Is the `.def` idea something that our new Standard JSON Schema spec now covers?" In practice, metadata reaches consumers only as keywords inside the generated JSON Schema. | `standard-schema-gh-109-def-metadata-proposal.md` (reported) |
| Encode, the reverse of `validate` | **Standard Codec** proposal, PR #180, open since 2026-08-27, by Colin McDonnell. It adds `encode(value) => Result<Input>` to `StandardSchemaV1.Props` and adds no `decode`, because "Validation already _is_ the decode direction". It lists Zod 4.1 codecs and Effect as existing models. Round-tripping is "a documented expectation, not a type-level or runtime guarantee". | `standard-schema-gh-180-standard-codec-proposal.md` (reported) |
| Object-key introspection | Proposal #174, open. Fabian Hiller worries that "keys only" does not cover unions, intersections, records or transforms. | `standard-schema-gh-174-object-keys-introspection.md` (reported) |
| Shared AST, producing schemas | Issue #7, open since 2024. Floated as a possible `@standard-schema/ast`. TypeBox's author asked for schema output whose type can be read statically. Fabian: hard for Valibot, which is not built on JSON Schema. | `standard-schema-gh-7-producing-emitting-schemas.md` (reported) |
| Error formatting | `@standard-schema/utils` 0.3.0 ships `getDotPath(issue)` and `SchemaError`. | `standard-schema-utils-README.md` (reported) |

### 1.4 Who implements and who integrates (from the spec site)

- **Standard Schema implementers listed:** Zod 3.24+, Valibot 1.0+, ArkType 2.0+, Effect Schema 3.13+ ("via adapter"), Sury, Typia 9.2+, Yup 1.7+, Joi 18+, VineJS 4+, Mongoose 9.7+, and about 20 smaller libraries (reported: `standard-schema-spec-schema.md`).
- **Standard JSON Schema implementers listed:** Zod 4.2+, ArkType 2.1.28+, Valibot 1.2 (via `toStandardJsonSchema()` in `@valibot/to-json-schema` 1.5+), Zod Mini 4.2+ (via `z.toJSONSchema()`), GraphQL Standard Schema, stnl 2.1+, VineJS 4.3+, Sury 11.0.0-alpha.10+ (via `S.enableStandardJSONSchema()`) (reported: `standard-schema-spec-json-schema.md`).
- **Standard JSON Schema integrators listed:** xsAI, GQLoom, Restate SDK. An open PR adds oRPC (#183) (reported).
- **TypeBox is in neither list** (verified, section 2.5).

### 1.5 Community converters for libraries without `~standard.jsonSchema`

| Package | How it gets JSON Schema | Observed behaviour |
| --- | --- | --- |
| `@standard-community/standard-json` 0.3.6 (1.6M weekly downloads) | Dispatches on `~standard.vendor` and dynamically imports the vendor's converter. It never reads `~standard.jsonSchema`. `loadVendor(name, fn)` registers custom vendors. | The Effect handler calls v3 `JSONSchema.make` and throws `Cannot read properties of undefined (reading 'make')` on Effect 4.0.0. Its peer range is `effect ^3.20.0`, so installing it next to Effect 4 needed `--legacy-peer-deps`. For Zod it returns the output schema in 2020-12. For Valibot it returns draft-07. The TypeBox handler calls `schema.Type()`, a TypeMap-style API (verified: source in `node_modules/@standard-community/standard-json/dist`, `community.ts` output). |
| `xsschema` 0.5.1 | Uses `~standard.jsonSchema.input({ target: "draft-07" })` when present. Otherwise falls back to vendor dispatch. | Effect 4 without the adapter fails the same way. With `Schema.toStandardJSONSchemaV1` it works (verified: source, `community.ts` output). |
| `hono-openapi` 1.3.3 | Depends on `standard-json`, not on `~standard.jsonSchema`. | Adds vendor-specific patches: Zod `z.date()` becomes `date-time`, ArkType morphs fall back to `ctx.base` (verified: `packages/hono-openapi-1.3.3/dist/index.js`). |

Defaults differ between converters. For the same Zod schema, `standard-json` returned output-side 2020-12 with `additionalProperties: false`, and `xsschema` returned input-side draft-07 without it (verified: `outputs.txt`).

## 2. Schema libraries

### 2.1 Summary

Sizes come from bundling a five-field object probe plus validation and JSON Schema conversion with esbuild 0.28.2 (`--minify`, ESM) and compressing with `gzip -9`. Probe files are in `prototypes/standard-schema/size/` (verified). They are rough and probe-specific.

| Library (version) | `StandardSchemaV1` | `StandardJSONSchemaV1` | Targets accepted via `~standard` | Sync `validate` | Runtime deps | Module format | Probe size (gzip) | Weekly downloads |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| zod 4.6.5 | yes, every schema | yes, every Classic schema | draft-2020-12, draft-07, draft-04, openapi-3.0 | yes, unless async refinements | none | ESM + CJS | 26.0 KB (validate only with Mini: 5.8 KB) | 374M |
| zod/mini 4.6.5 | yes | only on the result of `z.toJSONSchema(schema)` | same as Zod | yes | none | ESM + CJS | 12.7 KB | (in zod) |
| valibot 1.5.0 + @valibot/to-json-schema 1.8.0 | yes | only on the result of `toStandardJsonSchema(schema)` | draft-2020-12, draft-07, openapi-3.0 | yes | none | ESM + CJS | 4.9 KB (validate only: 1.6 KB) | 25M |
| arktype 2.2.7 | yes | yes, every Type | draft-2020-12, draft-07 | yes | @ark/schema, @ark/util, arkregex | ESM only | 47.3 KB | 2.5M |
| effect 4.0.0 (`Schema`) | only after `Schema.toStandardSchemaV1(s)` | only after `Schema.toStandardJSONSchemaV1(s)` | draft-2020-12, draft-07 | yes, unless effects are async | none | ESM only | 75.2 KB | 51M |
| typebox 1.3.34 | no | no (schemas *are* JSON Schema) | n/a | n/a | none | ESM only, needs TS 6 or 7 | 38 to 42 KB with `Value` or `Compile` | 14.6M (`@sinclair/typebox` 0.x: 141M) |
| sury 11.1.0-rc.0 | yes | yes, after a global `S.enableStandardJSONSchema()` | draft-2020-12, draft-07, openapi-3.0 | yes | none (optional peer `rescript`) | ESM + CJS | 19.8 KB | 0.5M |
| typia 15.1.0 | on `typia.createValidate<T>()` | no | n/a (`typia.json.schema<T>()` emits OpenAPI 3.0 or 3.1) | yes | randexp, @typia/* | ESM + CJS, needs the `ttsc` compiler | not measured | 0.4M |
| @vinejs/vine 4.4.0 | yes, on `vine.create(...)` | `input` only. `output` throws | target ignored | **no, always a Promise** | 10 packages, including validator, dayjs | ESM only, Node only | 39.2 KB (`platform=node`) | 0.5M |
| stnl 2.2.3 | **no** (`~standard` has no `validate`) | `input` only via `toStandardJSONSchema.v1()` | draft-2020-12, draft-07, openapi-3.0 | n/a | none | ESM only | about 6 KB unminified total | 129 |

Every library above is MIT licensed. Maintenance as of 2026-10-04: last pushes for zod, valibot, arktype, effect, typebox, sury, typia and vine were all within the last 3 weeks. stnl's last push was 2026-04-11. Sury's `latest` dist-tag points at a release candidate. Data and sources: `sources/standard-schema/npm-github-stats-2026-10-04.md`.

### 2.2 JSON Schema output for the shared event payload

The `confirmedAt` column covers the wire string that decodes to a `Date`. The `bigint` column covers a bare `bigint` field.

| Library | `confirmedAt` in `jsonSchema.input` | `jsonSchema.output` with a Date field | bare `bigint` | Default for extra properties | Metadata that reached the JSON Schema |
| --- | --- | --- | --- | --- | --- |
| Zod (codec `z.iso.datetime()` to `z.date()`) | `string`, `format: date-time`, plus a long regex `pattern` | throws `Date cannot be represented in JSON Schema` | throws. An `unrepresentable` handler can map it | input: not set. Output: `additionalProperties: false` | `title`, `description`, `examples`, `deprecated`, custom `x-emmett-kind` |
| Valibot (`isoTimestamp` + `transform` + `date`) | `string`, `format: date-time` | throws `The "date" schema cannot be converted` | throws | not set | `title`, `description`, `examples`, `deprecated` and custom keys via `v.metadata` |
| ArkType (`string.date.iso.parse`) | `string` with a regex `pattern`, no `format` | throws (morph) | throws. `libraryOptions.fallback` can map it | not set | everything passed to `.configure()` |
| Effect (`Schema.Date`, via `toCodecJson`) | `{ "type": "string" }` with no `format` | same as input, because `toCodecJson` is applied to both sides | `string`, `pattern: ^-?\d+$` | `additionalProperties: true` | `title`, `description`, `examples`. `deprecated` and custom keys dropped |
| Sury (`S.isoDateTime.with(S.to, S.date)`) | `string`, `format: date-time` | throws `Expected JSON, received Date` | throws. `S.json.with(S.to, schema)` gives `string` | not set | `title`, `description`, `examples`, `deprecated` |
| VineJS (`vine.date({ formats: ['iso8601'] })`) | `{}` (unconstrained) | throws | n/a | `additionalProperties: false` | `description` via `.meta()` |
| TypeBox (`Type.Codec(Type.String({ format: 'date-time' }))`) | the schema object itself: `string`, `format: date-time` | n/a | `Type.BigInt()` emits `{ "type": "bigint" }`, which is not valid JSON Schema | not set | any keyword passed in options, including `$id` and `x-*` |

Source: `prototypes/standard-schema/outputs.txt` (verified).

Other output differences seen in the same run (verified):

- **Zod**: setting `id` in `.meta()` turns the root into `{"$ref":"#/$defs/ShoppingCartConfirmed","$defs":{...}}`. Under `openapi-3.0`, Zod still emits `definitions` and `#/definitions/...` refs. `z.int()` adds safe-integer `minimum` and `maximum`. `z.uuid()` adds both `format` and `pattern`.
- **ArkType**: property order and enum members come out sorted alphabetically. The `required` list is sorted too. `string.uuid` becomes an `anyOf` of a pattern and two `const` values.
- **Sury**: `S.int32` adds 32-bit `minimum` and `maximum`.
- **Effect**: an `identifier` annotation produces `$ref` plus `$defs` (2020-12) or `definitions` (07).

### 2.3 Zod 4 (zod 4.6.5, zod/mini)

- **Standard JSON Schema built in.** Every Classic schema has `~standard.jsonSchema`. Zod Mini schemas do not. `z.toJSONSchema(miniSchema)` returns an object that implements both specs (verified: run). The docs list `z.bigint()`, `z.int64()`, `z.date()`, `z.map()`, `z.set()`, `z.transform()`, `z.custom()` and others as unrepresentable. They throw by default. `unrepresentable: "any"` or a handler changes that (reported: `zod-docs-json-schema.md`). In my run, a handler mapped `bigint` to `{ type: "string", pattern: "^-?[0-9]+$" }` (verified).
- **Metadata lives in registries.** `.meta({...})` registers the schema in `z.globalRegistry`, whose `GlobalMeta` has `id`, `title`, `description` and `deprecated`, plus an index signature. Custom registries take a typed metadata shape (`z.registry<{...}>()`). `z.$output` lets metadata types refer to the inferred type. Ids must be unique per registry. "Metadata is associated with a *specific schema instance*", and `.refine()` returns a new instance without it (reported: `zod-docs-metadata.md`). `.meta()` with no arguments reads metadata back (verified).
- **Registry export.** `z.toJSONSchema(registry, { uri })` emits one JSON Schema per registered `id`, with cross `$ref`s (reported).
- **Codecs (4.1+).** `z.codec(in, out, { decode, encode })`, `z.decode`, `z.encode`, `z.invertCodec`. Built-in recipes include `isoDatetimeToDate`, `stringToBigInt` and `epochMillisToDate` (reported: `zod-docs-codecs.md`). In my run, `z.encode(schema, parsed)` turned the `Date` back into the ISO string (verified).
- **Advice for library authors.** Zod's docs say to use Standard Schema for "black box" validation. For Zod-specific work, import `zod/v4/core` and declare `zod` as a peer dependency. Zod 3 is "functionally end-of-life" (reported: `zod-docs-library-authors.md`).
- **Recent changes.** 4.5 added `z.compile()`. 4.6 added `.validate()` boolean checks, folds chained checks into JSON Schema correctly, and publishes `@zod/mini` as a standalone package (reported: `zod-blog-4-5.md`, `zod-blog-4-6.md`). `z.fromJSONSchema()` exists but is experimental (reported).

### 2.4 Valibot 1.5 and @valibot/to-json-schema 1.8

- **No converter on the schema itself.** `toStandardJsonSchema(schema)` returns `{ "~standard": { ...schema["~standard"], jsonSchema } }`, a new object with nothing else on it. `Object.keys` gives `['~standard']`, so Valibot's own API (`pipe`, `type`, `v.parse` support) is not on the wrapper (verified: source, run).
- **Conversion options.** `input()` and `output()` map to `typeMode: "input" | "output"` and spread `libraryOptions` into the config. Supported targets are draft-07, draft-2020-12 and openapi-3.0. draft-04 throws (verified). `toJsonSchema()` defaults to draft-07 (verified).
- **Metadata** comes from pipe actions: `v.title`, `v.description`, `v.examples`, `v.metadata({...})`. Extra keys are copied into JSON Schema "without validation". Getters: `v.getTitle`, `v.getDescription`, `v.getExamples`, `v.getMetadata` (verified: run and typings).
- **Converter limits.** Dates and bigints have no mapping. `overrideSchema` can map them. `variant` (discriminated union) loses its discriminator in JSON Schema. Record keys must be string schemas (reported: `valibot-to-json-schema-1.8.0-README.md`).
- **Large issue paths.** Each path segment is an object holding `input` (the whole parent value), `key` and `value`. A failed event validation therefore carries the full payload in every issue (verified: `outputs.txt`). `@hono/standard-validator` strips restricted fields from Valibot and ArkType issues for this reason (verified: `packages/hono-standard-validator-0.4.0/dist/index.mjs`, `sanitizeIssues`).

### 2.5 ArkType 2.2.7

- **Built in on every Type.** `~standard.jsonSchema.input` and `.output` call `rawIn.toJsonSchema` and `rawOut.toJsonSchema`, with `libraryOptions` spread in. Targets are limited to 2020-12 and 07. `openapi-3.0` throws `must be "draft-2020-12" or "draft-07"` (verified: `@ark/schema/out/roots/root.js`, run).
- **Failure result is an object, not an array.** `validate` returns the `ArkErrors` instance itself as the failure result (verified: source).
- **Metadata** comes through `.configure({...})` and `.describe()`. `title`, `examples` and `deprecated` are typed. Custom keys need a `declare global { interface ArkEnv { meta(): {...} } }` augmentation (verified: `meta-typing.ts`, where tsc rejects `'x-emmett-kind'` without it). All meta keys end up in the JSON Schema (verified).
- **`description` is reused in error messages.** In my run, `cartId must be Cart id (was a number)` (verified).
- **Fallback codes** for things JSON Schema cannot express: `date`, `domain` (bigint and symbol), `morph`, `predicate`, `proto`, `unit` and others. Each code takes a handler (reported: `arktype-docs-configuration.md`). A `date` handler passed through `libraryOptions.fallback` produced `{ type: "string", format: "date-time" }` (verified).
- **2.2 additions.** `@ark/json-schema` converts JSON Schema into ArkType Types. Any Standard Schema can be embedded inside an ArkType definition (reported: `arktype-blog-2.2.md`).

### 2.6 Effect Schema (effect 4.0.0, released 2026-10-01)

- **No `~standard` by default.** `Schema.toStandardSchemaV1(s, { leafHook, checkHook, parseOptions })` and `Schema.toStandardJSONSchemaV1(s)` attach it by **mutating the schema object** (`Object.assign(self, { "~standard": ... })`). In my run, the returned value was `===` the original schema (verified: `dist/internal/schema/standardSchema.js`, run). The spec site marks Effect "via adapter".
- **Types.** `Input` is the `Encoded` type and `Output` is `Type` (verified: `dist/Schema.d.ts` lines 1046 and 1061).
- **Validation and JSON Schema can disagree.** `jsonSchema.input` always derives the canonical JSON codec (`toCodecJson`) first, but `validate` decodes the schema as given. For `Schema.Date`, the JSON Schema says `string` while `validate("2026-...")` fails with `Expected a valid Date`. Wrapping with `Schema.toStandardSchemaV1(Schema.toCodecJson(schema))` makes them agree (verified: `outputs.txt`). Effect's own Elysia example wraps with `toCodecJson` for request bodies and with `Schema.flip(Schema.toCodecJson(...))` for responses (reported: `effect-v4-SCHEMA.md`, Integrations).
- **Converter limits.** Targets: only 2020-12 and draft-07. `libraryOptions` is ignored (verified).
- **Annotations.** `.annotate({ title, description, default, examples, readOnly, writeOnly })` reaches JSON Schema. Other keys need `includeAnnotationKey` on `Schema.toJsonSchemaDocument`, which the standard adapter cannot pass (reported: `effect-v4-SCHEMA.md`. Verified: `deprecated` was dropped). Annotations on the decoded side of a transformation do not reach JSON Schema. `Schema.annotateEncoded` exists for that (reported).
- **Canonical codecs and representation.** `toCodecJson` maps Date to an ISO string and BigInt to a string, Map/Set/Uint8Array to JSON forms, and custom classes through a `toCodecJson` annotation. `SchemaRepresentation` is a JSON-persistable intermediate model with `toJson`/`fromJson`, `fromRepresentation` with explicit revivers, `toJsonSchemaDocument` and `toCodeDocument`. It "always projects one side of a schema", the encoded side by default, and does not serialize transformation functions (reported: `effect-v4-SCHEMA.md`, sections "Canonical Codecs" and "Schema Representation"). In my run, encoding gave `{"at":"2026-10-04T10:00:00.000Z","position":"10"}` (verified).
- **Classes and tagged structs.** `Schema.Class`, `TaggedClass`, `TaggedStruct("A", {...})` (a `_tag` literal) and `TaggedUnion` exist (reported: `effect-v4-SCHEMA.md`).

### 2.7 TypeBox 1.3.34 (package `typebox`)

- **No Standard Schema support.** No `~standard` on schemas or on `Compile()` validators (verified: grep of `packages/typebox-1.3.34/build`, run). The author said in 2025: "I won't be supporting it in TypeBox as a default". In August 2026 he said TypeMap (the old adapter) is deprecated, and that TypeBox "considers JSON Schema to be the only viable canonical representation for runtime types". He points to a copy-paste adapter in `example/standard` (reported: `sources/standard-schema/typebox-gh-1154-standard-schema.md`).
- **What that adapter does.** It returns the same schema for `input` and `output` and ignores `target`. It does not decode codecs (verified: `typebox-example-standard.ts.md`).
- **Schemas are plain JSON Schema.** `~kind` and `~codec` are non-enumerable, so `JSON.stringify(schema)` yields pure JSON Schema, including `$id`, `title` and `x-*` keys (verified: `Reflect.ownKeys` output).
- **Codecs.** `Type.Codec(T).Decode(...).Encode(...)` with `StaticDecode` and `StaticEncode` types. `Value.Decode` returned a `Date` (verified).
- **Types without JSON equivalents.** `Type.BigInt()` emits `{ "type": "bigint" }`. The 1.x build has no Date type. `Type.Record(String, X)` emits `patternProperties: { "^.*$": ... }`. `Type.Script("{ ... }")` parses TypeScript syntax (verified).
- **Platform.** Version 1.x targets TS 6.0 to 7.0+ and is ESM only. The 0.x LTS line supports ESM and CJS (reported: readme). `typedriver` 0.9.2 compiles TypeScript strings, JSON Schema or Standard Schema into validators (reported: `typedriver-readme.md`).

### 2.8 Sury 11.1.0-rc.0

- **Opt-in JSON Schema.** Standard JSON Schema is enabled globally with `S.enableStandardJSONSchema()`, which keeps the code tree-shakeable (verified).
- **Wire types must be spelled out.** `jsonSchema.input` describes the wire. A `bigint` "has no wire until you give it one" (reported: `sury-11.1.0-rc.0-README.md`). Wrapping with `S.json.with(S.to, schema)` yields `string` for bigint (verified).
- **Metadata** through `.with(S.meta, {...})`. `examples` are written in the Output type and stored in the Input type (reported: `sury-11.1.0-rc.0-js-usage.md`).
- **Runtime and extras.** Needs `new Function`, with no eval-free mode. Includes JSON Schema import (`S.fromJSONSchemaOrThrow`, 93% of the draft-07 suite) and Protobuf (reported: README).

### 2.9 Typia 15.1.0

- **A compile-time transformer.** It needs the `ttsc` toolchain. "The stock `tsc`, `ts-node`, and `tsx` cannot apply the typia transform" (reported: `typia-15.1.0-README.md`).
- **Standard Schema only on validator factories.** `typia.createValidate<T>()` and `createValidateEquals<T>()` return functions that also implement `StandardSchemaV1<T, T>`. They are mutated in place with `Object.assign` (verified: `packages/typia-15.1.0/lib/internal/_createStandardSchema.mjs`).
- **JSON Schema is separate.** No Standard JSON Schema. `typia.json.schema<T, "3.0" | "3.1">()` emits OpenAPI-flavoured JSON Schema at compile time (verified: `lib/json.d.ts`).

### 2.10 VineJS 4.4.0

- **Async validation.** `validate` is an `async` function, so it always returns a `Promise` (verified).
- **Off-spec issue paths.** Issue `path` is a string such as `"cartId"`, not an array as the spec requires (verified: run).
- **Limited converter.** `jsonSchema.input` ignores `target` and has no `$schema`. `output` throws `Vine.js does not support creating validators using JSON Schema.` (verified: `build/index.js`, run).
- **Node only.** The bundle imports `node:dns/promises` (verified: esbuild error on `platform=neutral`).

### 2.11 Small and dependency-free options

- **stnl 2.2.3.** Schemas are arrays with a phantom `~type`. The builder covers `any`, `float`, `int`, `bool`, `string`, `nullable`, `discrete` (string enum), `list`, `dict(required, optional)`, `tuple`, tagged unions and refs. The `~standard` object has only `jsonSchema`, `output` throws, and validation is a separate compiled checker. It has 11 GitHub stars (verified: package source, run).
- **Inngest `staticSchema<T>()`.** A type-only `StandardSchemaV1` whose `validate` passes values through (verified: `packages/inngest-4.21.1/components/triggers/triggers.js`).
- **oRPC `type<T>(map?)`.** The same idea, with vendor `"custom"` (verified: `packages/orpc-contract-1.15.4/dist/index.mjs`).
- **AI SDK `jsonSchema(json, { validate })`.** Wraps a raw JSON Schema plus an optional validator (verified: `packages/ai-sdk-provider-utils-5.0.53/dist/index.js`).
- **MCP `fromJsonSchema(schema, validator)`.** Returns a `StandardSchemaWithJSON` from raw JSON Schema and an Ajv or cfworker validator (verified: `packages/modelcontextprotocol-server-2.3.0`).

Section 5 covers a size and typing probe I wrote for this.

## 3. The Inngest article

Source: "There are too many JavaScript schema libraries, so support only one", Aaron Harper, 2026-06-10 (reported: `sources/standard-schema/inngest-too-many-schema-libraries.html`). I cross-checked it against the published `inngest` 4.21.1 code (verified where marked).

1. **The problem it solves.** Library authors used to have three bad options: support one schema library, skip runtime validation, or maintain their own adapters. Inngest moved to Standard Schema in SDK v4.0.
2. **Scope.** "Standard Schema does not standardize error formatting, metadata, defaults, JSON Schema generation, or schema introspection." It worked for Inngest because they "only needed validation and type inference for event payloads". For JSON Schema the article points to Standard JSON Schema as a separate interface. The published SDK has no JSON Schema code (verified: grep).
3. **API shape.** `eventType("user.created", { schema })` returns an `EventType` with `name`, `schema` and an optional `version`. `create(data, { id, ts, v, meta })` builds the event with a `validate()` method. Validation does not run inside `create`, "because validation may be async" (verified: `triggers.js`).
4. **Types without runtime validation.** `staticSchema<T>()` gives "static types with no runtime validation cost and no new dependencies".
5. **Transforms break double validation.** "Producers validate before sending... consumers validate when receiving". A transform that changes the payload makes the second validation fail. The example is Zod `string` to `Number`. Inngest rejects schemas whose input and output types differ, using a type-level `AssertNoTransform`. They call it "a type-level proxy, not perfect transform detection": brands change the static types without changing the runtime value, and a transform can keep the static type while changing the value. The article shows a check in both directions. The shipped 4.21.1 typings check only `[TInput] extends [TOutput]` (verified: `triggers.d.ts`).
6. **Sync versus async.** "Sync APIs are where it gets awkward". You either change the signature or reject a `Promise`, and the choice "has to be made per API".
7. **Validators can throw.** "We wrap every validator call in `try/catch` and treat thrown errors the same as failed validation results."
8. **Routing between schemas.** Standard Schema validates one schema against one value. Inngest picks candidates by event name, which works as a discriminator. When several candidates match, it validates them in parallel and accepts the first success (`Promise.allSettled`).
9. **Types cost more than runtime.** The runtime part was "a few function calls". The type part was "several hundred lines of conditional inference", spread across triggers, `step.waitForEvent`, `step.invoke` and other entry points.

## 4. How integrators accept "any Standard Schema"

| Integrator (version) | Validation | JSON Schema source | Target | When `jsonSchema` is missing | Built-in or default option | Sync or async |
| --- | --- | --- | --- | --- | --- | --- |
| tRPC server 11.19.0 | Duck-types library methods first (`assert`, `parseAsync`, `parse`, `validateSync`, `create`), then `~standard.validate` | none in server | n/a | n/a | any plain function `(value) => T` | async (awaits) |
| @hono/standard-validator 0.4.0 | `~standard.validate` | n/a | n/a | n/a | none | async. Strips sensitive fields from Valibot and ArkType issues |
| hono-openapi 1.3.3 | `~standard.validate` | `@standard-community/standard-json`, by vendor | caller option | vendor converters | none | async |
| oRPC 1.15.4 | `~standard.validate` | per-library `ConditionalSchemaConverter`s (`@orpc/zod` and others), tried in order | 2020-12 types | `[false, {}]` | `type<T>()` | async |
| TanStack Form core 1.33.5 | `~standard.validate` | n/a | n/a | n/a | plain validator functions | sync path throws `"async function passed to sync validator"`. A separate async path awaits |
| Elysia 1.4.30 | TypeBox 0.34 natively (peer `@sinclair/typebox >=0.34 <1`), plus `~standard` | OpenAPI plugin `mapJsonSchema` per vendor (Effect docs example) | per vendor | per vendor | TypeBox `t` | both |
| MCP SDK 1.32.0 | Zod only (deps `zod`, `zod-to-json-schema`) | Zod | n/a | n/a | Zod | n/a |
| MCP server 2.3.0 | `~standard.validate` | `~standard.jsonSchema[io]` | draft-2020-12 | Zod fallback with a warning, otherwise throws "wrap your JSON Schema with fromJsonSchema()" | `fromJsonSchema(schema, validator)` | async |
| AI SDK provider-utils 5.0.53 | `~standard.validate` (Zod handled separately) | `~standard.jsonSchema.input` (lazy) | draft-07 | throws `does not support JSON Schema conversion` | `jsonSchema(json, { validate })` | async |
| OpenAI SDK 7.27.0 | `~standard.validate` | `~standard.jsonSchema.input` | draft-07 | caller passes an explicit `schema` | none | sync required, Promises rejected |
| Inngest 4.21.1 | `~standard.validate` | none | n/a | n/a | `staticSchema<T>()` | async |
| Trigger.dev 4.7.2 | No `~standard`. Duck-types Zod-like, Valibot-like, ArkType-like objects and functions | `jsonSchema` passed explicitly | n/a | n/a | functions | async |

All rows verified from package source in `packages/` (file paths in section 1.5 and in the package folders named after each integrator), except the Elysia `mapJsonSchema` usage, which is reported from `effect-v4-SCHEMA.md`.

**Precedent for non-JSON types.** oRPC encodes non-JSON types as JSON Schema strings plus an extension keyword. `bigint` becomes `{ type: "string", pattern: "^-?[0-9]+$", "x-native-type": "bigint" }` and `Date` becomes `{ type: "string", format: "date-time", "x-native-type": "date" }`. The same keyword covers Map, Set, RegExp and URL. A `JsonSchemaCoercer` uses it to revive values (verified: `packages/orpc-zod-1.15.4/dist/index.mjs` and `zod4/index.mjs`, `packages/orpc-json-schema-1.15.4/dist/index.d.ts`).

## 5. A dependency-free builder: surface and measurements

### 5.1 What event payloads need

Emmett's own types already use non-JSON values. `StreamPosition = bigint`, and `DefaultCommandMetadata = { now: Date }` (verified: `src/packages/emmett/src/typing/event.ts`, `command.ts`). Emmett's JSON serializer guesses types from shapes when reading. Dates are revived only for 24-character `...Z` strings. Bigints are revived only from unsafe integers or numeric strings longer than 15 characters (verified: `src/packages/emmett/src/serialization/json/jsonSerializer.ts`, `dateReviver` and `bigIntReviver`). A schema-driven decode would replace those guesses with the schema's own description of each field.

The surface this task asked about: string (with formats), number, integer, boolean, literals and enums, date, bigint, array, object with optional keys, nullable, union, record, named refs, plus metadata (title, description, examples, deprecated, `x-*`).

### 5.2 Probe

`prototypes/standard-schema/builtin.ts` is about 230 lines. It is a measurement, not a design. It uses functions and closures only and implements `StandardSchemaV1` and `StandardJSONSchemaV1` on every node. Observed results (verified: `outputs.txt`, tsc):

- **Behaviour.** `validate` is sync and returns spec-shaped issues with array paths. Date and bigint are codecs: the wire form (ISO string, decimal string) is the input and `Date` or `bigint` is the output.
- **Output side.** `jsonSchema.output` emits the same shape plus `"x-native-type"`, following oRPC's precedent. Another option would be to throw there, as Zod, Valibot and Sury do.
- **Targets.** It emits draft-2020-12 (`$defs`), draft-07 (`definitions`) and openapi-3.0 (`nullable: true`, refs inlined because an OpenAPI 3.0 Schema Object has no local definitions). Other targets throw.
- **Types.** `InferInput` gives `confirmedAt: string`. `InferOutput` gives `confirmedAt: Date` and `position?: bigint`. Optional keys infer as optional.
- **Size.** 1.0 KB gzip for the same five-field probe used in section 2.1.

What the probe does **not** cover: refinements (min, max, pattern), error localisation, discriminated-union error quality, recursive types, string-length semantics (JSON Schema counts code points, JavaScript `.length` counts UTF-16 units, as noted by Valibot and Effect), and a JSON Schema importer.

### 5.3 Existing small libraries

No published library I found fits this exact niche: zero dependencies, both specs, and codecs for Date and bigint.

- **stnl** is the closest in size, but it has no `validate` in `~standard` and no non-JSON types.
- **Valibot plus its converter** is small (4.9 KB) and dual-format. It needs two packages and has no wire mapping for Date or bigint without `overrideSchema`.
- **TypeBox** is JSON Schema-native but not Standard Schema.

## 6. Implications and open questions for Emmett

These are trade-offs and questions observed in the material, not recommendations.

**Interfaces to accept**

- Accepting only `StandardSchemaV1` covers almost every library, but leaves no portable JSON Schema. Accepting `StandardSchemaV1 & StandardJSONSchemaV1`, as MCP v2 does, excludes Effect without its adapter, raw Valibot, Zod Mini without the wrapper, typia, TypeBox, Yup and Joi. Integrators handle the gap in four ways: a vendor fallback (MCP for Zod, hono-openapi, oRPC), a user-supplied JSON Schema (OpenAI, Trigger.dev, MCP `fromJsonSchema`), throwing (AI SDK), or no JSON Schema at all (Inngest, tRPC).
- Community converters dispatch on `vendor` and are already out of date with Effect 4 (section 1.5).

**Input versus output**

- For events stored as JSON, the input side matches the stored or wire form. Zod, Valibot, ArkType and Sury throw on `jsonSchema.output` as soon as a field becomes a `Date` or `bigint`. Effect describes the encoded JSON form on both sides. Integrators that expose JSON Schema to outside tools (AI SDK, OpenAI, xsschema) all use `input`.
- Open question: which side does a registry entry, a docs page or a generated test describe? What happens when a user's schema has a transform?

**Transforms and double validation**

- Inngest rejects input/output mismatch at the type level. Brands make that check imprecise in both directions. Codecs (Zod 4.1+, Effect, TypeBox, Sury, the Standard Codec proposal) make the transform reversible, which changes the double-validation problem: re-encoding before a second check becomes possible. There is no standard `encode` yet. PR #180 is open.
- Open question: does stored data get decoded through the schema on read, as a replacement for the serializer's guessing revivers, or only validated?

**Sync versus async**

- Emmett's event factories and deciders are synchronous today. VineJS always returns a Promise, and Effect or Zod with async refinements may too.
- Options seen in the wild: reject Promises (OpenAI, TanStack Form sync path), make the API async (Inngest, tRPC, Hono), or offer both paths.

**Errors**

- Validators can throw (Inngest). Issue objects can carry the whole input value (Valibot, ArkType), and VineJS sends `path` as a string.
- Open question: which issue fields are kept when issues are logged, stored or put into OpenTelemetry spans through Almanac?

**Metadata**

- There is no standard metadata channel. Title, description, examples and deprecated reach consumers only as keywords inside the generated JSON Schema, and support differs: Effect drops `deprecated` and custom keys through the adapter, VineJS keeps only some keys, ArkType needs a type augmentation for custom keys.
- Open questions: should event-level metadata (event type name, version, owner, description, examples for docs and tests) live on the `Event(...)` definition instead of inside the payload schema? How does it merge with the schema's own JSON Schema annotations?

**Registry identity**

- Libraries handle schema ids differently: Zod `id` creates `$ref` plus `$defs` at the root, Effect `identifier` does the same, and TypeBox writes `$id` directly. Confluent and xRegistry need stable ids and versions per subject or resource (see `findings/formats-registries.md`).
- Open question: who assigns `$id` or the subject name, the user's schema or the `Event(...)` definition?

**JSON Schema targets**

- Every converter that took part supports draft-07 and 2020-12. `openapi-3.0` is missing in ArkType and Effect, and VineJS ignores targets.
- Open question: which target do xRegistry and Confluent entries use, and is the target fixed or configurable per registry?

**Built-in option**

- The material shows four kinds of "batteries-included" default:
  - type-only (`staticSchema`, `type<T>()`);
  - raw JSON Schema plus a validator (AI SDK, MCP);
  - a native builder (Elysia with TypeBox);
  - a small custom builder (the probe in section 5).
- These differ in dependencies, in whether they can produce JSON Schema, and in whether they can decode Date and bigint.
- Open question: should the built-in option produce JSON Schema only, or also a richer internal model? Effect's `SchemaRepresentation` is a worked example of a persisted model that compiles to JSON Schema and code and is rebuilt through revivers. Avro-like models would need the same mapping work.

**Packaging constraints**

- Emmett ships ESM and CJS. ArkType, Effect 4, TypeBox 1.x, VineJS and stnl are ESM only. Node 22.12+ and Node 24 can `require()` ESM.
- Typia needs a custom compiler. Sury needs `new Function`.
- The spec FAQ says `@standard-schema/spec` should be a regular dependency if its types appear in a public API, or the types can be copied.

**Typing cost**

- Inngest reports several hundred lines of conditional types to keep inference consistent across entry points. Emmett's equivalent entry points are the event factory, `Event<>` inference, deciders, `CommandHandler`, projections, workflows and the event store's read and append.

**Pongo**

- The shared core would need to serve document schemas as well as messages. The same input/output and Date/bigint questions apply to stored documents.
