# Message schemas: research findings

Findings gathered for the message schemas brainstorm. Q&A lives in `qa.md`.

## Saved material

- `sources/standardschema-home.html`, `sources/standardschema-json-schema.html`: Standard Schema and Standard JSON Schema pages.
- `sources/inngest-too-many-schema-libraries.html`: Inngest article on supporting many schema libraries.
- `sources/xregistry-home.html`, `sources/xregistry-core-spec.md`, `sources/xregistry-schema-spec.md`, `sources/xregistry-message-spec.md`: xRegistry site and specs (from `xregistry/spec` main branch).
- `sources/confluent-serdes-json.html`: Confluent Schema Registry JSON Schema serdes docs.
- `sources/typebox-readme.md`: TypeBox readme (main branch).
- `packages/typebox-1.3.34/`, `packages/typebox-1.3.34.tgz`: published `typebox` package.
- `packages/standard-schema-spec-1.1.0/`, `packages/standard-schema-spec-1.1.0.tgz`: published `@standard-schema/spec` package.

All downloaded on 2026-10-04.

### Emmett today

- `Event<Type, Data, Metadata>` and `Command<Type, Data, Metadata>` are type aliases only (`src/packages/emmett/src/typing/event.ts`, `command.ts`). There is no runtime definition object.
- Instances are created with lowercase `event<T>(type, data, metadata?)` and `command<T>(...)`, which add `kind: 'Event' | 'Command'`.
- Commands get optional `DefaultCommandMetadata = { now: Date }`.
- Validation is hand-written asserts (`validation/index.ts`: `assertNotEmptyString`, `assertPositiveNumber`, ...).
- No schema library is a dependency of any package.
- Almanac is a sibling package (`@event-driven-io/almanac`) with optional peer dependencies and subpath exports (`./otel`, `./pino`, `./console`). It ships both ESM and CJS.

### Pongo

- Has `pongoSchema` (client/db/collection/index) describing database structure, not document shape. Collections are typed by a TypeScript generic only (`JSON<Document>()`).

### Standard Schema (validation)

- One property, `~standard`, with `version`, `vendor`, `validate(value)` returning `{ value }` or `{ issues }` (sync or `Promise`), and optional `types` for inference.
- Implemented by Zod, Valibot, ArkType, Effect Schema and others.

### Standard JSON Schema (conversion)

- Interfaces live in `@standard-schema/spec` 1.1.0 (`packages/standard-schema-spec-1.1.0/dist/index.d.ts`), alongside the shared `StandardTypedV1` base used for `InferInput` and `InferOutput`.

- Separate, orthogonal interface: `~standard.jsonSchema.input(options)` and `.output(options)` return a JSON Schema object.
- Targets: `draft-2020-12`, `draft-07` (both recommended), `openapi-3.0`. Implementers throw for unsupported targets.
- Implemented by Zod 4.2+, ArkType 2.1.28+, Valibot 1.2+ (via `toStandardJsonSchema()`), VineJS, Sury.

### Inngest article

- `eventType('user.created', { schema })` accepts any Standard Schema.
- Ships a dependency-free `staticSchema<T>()` that only carries types and accepts any value.
- Rejects transforms at compile time (input type must equal output type), because producers and consumers both validate the same payload.
- Wraps `validate()` in `try/catch`, since validators may still throw.
- Typing the inference through every API cost them several hundred lines of conditional types.
- Standard Schema leaves out metadata, defaults, error formatting and introspection; those still need library-specific work.

### TypeBox

- Current package is `typebox` 1.x (1.3.34), not `@sinclair/typebox`. Zero runtime dependencies. ESM only.
- Schemas are plain JSON Schema objects, so JSON Schema export is free. `Type.Static<typeof T>` infers the type. `typebox/compile` and `typebox/schema` validate (draft 3 to 2020-12).
- Supports `title`, `description`, `$id`, `examples` and other JSON Schema annotations.
- The 1.3.34 build does not implement `~standard` (no match in `packages/typebox-1.3.34/build`). A thin adapter would be needed to expose it as Standard Schema and Standard JSON Schema.

### xRegistry (CNCF sandbox, CloudEvents team)

- Model: registry → groups → resources → versions. JSON documents, served as a static file or a REST API.
- Schema extension: `schemagroups/{group}/schemas/{schema}/versions/{n}`; `format` such as `JsonSchema/draft-07` or `JsonSchema/draft/2020-12`; `compatibility` attribute; breaking changes go to a new schema resource.
- Message extension describes message definitions with CloudEvents envelope metadata; CloudEvents `dataschema` points at a registry version URL.

### Confluent Schema Registry

- Subjects (`TopicNameStrategy`, `RecordNameStrategy`), numeric schema IDs, wire format of magic byte plus schema ID.
- Compatibility modes BACKWARD, FORWARD, FULL and transitive variants. For JSON Schema, open versus closed content model (`additionalProperties`) changes what counts as compatible.
- `$ref` references between registered schemas; no external references.

### Type extraction prototype

- `prototypes/typeExtraction.ts` type-checks with `tsc --strict` (checked 2026-10-04): a `function Event(...)` value coexists with the existing `type Event<...>` alias of the same name, `type X = typeof X.Type` yields the plain `Event<'X', Data>` shape, and a union of such types narrows on `type` as today.
- TypeScript cannot turn a `const` into a type without `typeof`. Only a `class` declaration creates a value and a type under one name.
- How other libraries expose the inferred type: Effect Schema `typeof S.Type`, ArkType `typeof T.infer`, Zod `z.infer<typeof S>`, Valibot `v.InferOutput<typeof S>`, TypeBox `Static<typeof T>`.
