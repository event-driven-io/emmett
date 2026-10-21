# Codebase findings: integration points for schema-backed message definitions

Scope: facts from the Emmett repo (`/home/oskar/repos/emmett`, paths below relative to `src/packages` unless stated) and the Pongo repo (`/home/oskar/repos/Pongo`). No API design here. Line numbers are from the working tree on 2026-10-04.

## 1. Today's message types

### 1.1 Type definitions

`Event` is a type only, with an optional `kind` discriminator (`emmett/src/typing/event.ts:15-30`):

```ts
export type Event<EventType extends string = string, EventData extends DefaultRecord = DefaultRecord, EventMetaData extends DefaultRecord | undefined = undefined> =
  Readonly<EventMetaData extends undefined ? { type: EventType; data: EventData } : { type: EventType; data: EventData; metadata: EventMetaData }>
  & { readonly kind?: 'Event' };
```

`Command` mirrors it (`emmett/src/typing/command.ts:3-19`), with two differences: when no metadata type is given, `metadata?: DefaultCommandMetadata` is allowed, where `DefaultCommandMetadata = { now: Date }` (`command.ts:71`); and `kind?: 'Command'`.

`Message = Command | Event` (`emmett/src/typing/message.ts:12-16`). `DefaultRecord = Record<string, unknown>` (`typing/index.ts:13`).

Lower-case factories already exist and stamp `kind` at runtime:

- `event<T>(type, data, metadata?)` returns `{ type, data, metadata?, kind: 'Event' }` (`event.ts:45-59`).
- `command<T>(type, data, metadata?)` returns `{ ..., kind: 'Command' }` (`command.ts:51-69`).
- `message<T>(kind, type, data, metadata?)` (`message.ts:32-51`).

Helper types: `EventTypeOf`, `EventDataOf`, `EventMetaDataOf`, `CreateEventType` (`event.ts:21-42`), the same for commands (`command.ts:24-48`) and `MessageKindOf/TypeOf/DataOf/MetaDataOf` (`message.ts:20-27`).

Routing type: `export type CanHandle<T extends Message> = MessageTypeOf<T>[];` (`message.ts:29`). It is a plain array of string literals.

Recorded messages add metadata: `RecordedMessage<M, Meta> = CombineMetadata<M, Meta> & { kind: NonNullable<...> }` (`message.ts:68-74`), with `CommonRecordedMessageMetadata` holding `messageId`, `streamPosition`, `streamName`, `checkpoint`, `correlationId`, `causationId`, `traceId`, `spanId` (`message.ts:76-85`).

`Decider<State, Command, Event>` is a plain type: `{ decide, evolve, initialState }` (`typing/decider.ts:3-11`).

### 1.2 Value plus type with the same name: existing precedent

No value named `Event`, `Command` or `Message` is exported anywhere today (grep over `src/packages`). There is a precedent for a value and type sharing a name: `Workflow` is both `export type Workflow<...>` (`emmett/src/workflows/workflow.ts:7`) and `export const Workflow = (...) => workflow` (`workflow.ts:45-53`). `DeciderSpecification` is also both a type and a const (`emmett/src/testing/deciderSpecification.ts:19` and `:57`).

Things to keep in mind for a value named `Event`:

- `@types/node` declares a global `Event` interface and `var Event` (`src/node_modules/@types/node/web-globals/events.d.ts:20,87-88`). The shared tsconfig sets `"lib": ["ESNext"]` and `"types": ["node"]` (`src/tsconfig.shared.json`), so the global is in scope. Inside Emmett, every file imports `Event` explicitly, which shadows the global. A user file that forgets the import silently gets the DOM/Node `Event`.
- Several generic parameters are literally named `Event` and `Command` (for example `deciderSpecificationFor<Command, Event, State>` in `deciderSpecification.ts:61-80`). They shadow imports, so they are unaffected.
- `emmett/src/index.ts` uses `export * from './typing'` and 17 other `export *` lines. If Emmett re-exports an `Event` value from a new package with `export *` while `./typing` also exports an `Event` type, TypeScript reports an ambiguity (TS2308) unless re-exported explicitly. (Not tested; standard TS behaviour.)
- ESLint enforces `consistent-type-imports` with `separate-type-imports` (`src/eslint.config.mjs`), and `verbatimModuleSyntax: true` is on. Existing `import type { Event }` lines keep compiling when a value `Event` appears; only files that start using the value need a value import.

### 1.3 Runtime use of `type` and `kind`

Everything routes on the `type` string. `kind` is mostly optional and inconsistently persisted.

| Where | What it does with `type` / `kind` | Reference |
| --- | --- | --- |
| Projections | `canHandle: CanHandle<EventType>` on `ProjectionDefinition`; filtering is `projection.canHandle.includes(type)` | `emmett/src/projections/index.ts:58`; `emmett/src/eventStore/projections/inMemory/inMemoryProjection.ts:54`; `emmett-postgresql/src/eventStore/projections/postgreSQLProjection.ts:120`; `emmett-sqlite/src/eventStore/projections/sqliteProjection.ts:120`; `emmett-mongodb/src/eventStore/projections/mongoDBInlineProjection.ts:87` |
| Pongo projections (PG and SQLite) | `canHandle: CanHandle<EventType>` in options | `emmett-postgresql/src/eventStore/projections/pongo/pongoProjections.ts:84,178,325`; `emmett-sqlite/.../pongoProjections.ts:80,173,314` |
| Processors | `MessageProcessor.canHandle?: string[]` (`processors.ts:158`); options `canHandle?: CanHandle<MessageType>` (`:326`); batch filter after upcasting: `!canHandle \|\| canHandle.includes(upcasted.type)` (`:1031-1045`) | `emmett/src/processors/processors.ts` |
| Message bus | `handle(handler, ...commandTypes)` and `subscribe(handler, ...eventTypes)` take string literals; dispatch uses `allHandlers.get(command.type)` | `emmett/src/messageBus/index.ts:44-55, 79-104, 113-145` |
| Decider command handler | `commandTypesOf` reads `c.type` for observability labels | `emmett/src/commandHandling/handleCommandWithDecider.ts:18-19` |
| Command handler | `commandType?: string \| string[]` option, used only for observability | `emmett/src/commandHandling/handleCommand.ts:98, 155-159` |
| Workflows | `inputs.commands/events: CanHandle<...>`, `outputs.commands/events: MessageTypeOf<...>[]` | `emmett/src/workflows/workflowProcessor.ts:29-55` |
| Workflow processor | builds `canHandle` from inputs plus `${workflow.name}:${type}` prefixed variants plus `outputHandler.canHandle` | `workflowProcessor.ts:213-233, 268` |
| Workflow handler | rewrites types to `${workflowName}:${type}` when storing inputs and strips the prefix before `evolve`; picks `'Sent'` vs `'Published'` by checking `outputs.commands.includes(msg.type)` | `emmett/src/workflows/handleWorkflow.ts:178-186, 360-362, 478-480, 494-500` |
| Workflow typing | separates events from commands at type level only via `Extract<Output, { kind?: 'Event' }>` | `emmett/src/workflows/workflow.ts:19-27` |
| Observability | records `m.type` as attributes and span names | `emmett/src/processors/observability/processorCollector.ts:140,188`; attribute keys `emmett.command.event_types` etc. in `emmett/src/observability/attributes.ts:10,22,42` |

`kind` on write and read:

- PostgreSQL append defaults `kind: e.kind ?? 'Event'` (`emmett-postgresql/src/eventStore/schema/appendToStream.ts:203`) then stores `e.kind === 'Event' ? 'E' : 'C'` (`:344`). SQLite does the same (`emmett-sqlite/src/eventStore/schema/appendToStream.ts:83, 291`). A command built as a plain object literal (no `kind`) is stored as `'E'`.
- Neither SQL driver reads `message_kind` back. Reads hard-code `kind: 'Event'` (`emmett-postgresql/.../readStream.ts:86`, `readMessagesBatch.ts:164`; `emmett-sqlite/.../readStream.ts:81`, `readMessagesBatch.ts:113`).
- MongoDB stores only `type`, `data`, `metadata` (`emmett-mongodb/src/eventStore/mongoDBEventStore.ts:432-441`).
- ESDB maps via `jsonEvent({...event, id, metadata})` (`emmett-esdb/src/eventStore/eventstoreDBEventStore.ts:275-296`) and reads back without `kind` (`mapFromESDBEvent`, `:380-404`).

## 2. Versioning, upcasting, schema-like concepts that already exist

### 2.1 Upcast and downcast

There is a consistent `schema.versioning.{upcast, downcast}` option shape across Emmett and Pongo. It is per call site (store read, append, handler, projection, processor), not per message type.

- Core helpers: `upcastRecordedMessage(s)` and `downcastRecordedMessage(s)` in `emmett/src/eventStore/versioning/upcasting.ts:18-92` and `downcasting.ts:18-94`. Upcast can change `type`, `data` and merge `metadata` (`upcasting.ts:48-63`). Downcast only replaces `data` and merges `metadata`; it ignores a changed `type` (`downcasting.ts:47-62`). So there is no type renaming on write today.
- Event store option types: `EventStoreReadSchemaOptions` (`upcast`), `EventStoreAppendSchemaOptions` (`downcast`), `EventStoreSchemaOptions` (`emmett/src/eventStore/eventStore.ts:123-145`); wired into `ReadStreamOptions.schema` (`:151-161`) and `AppendToStreamOptions.schema` (`:225-233`). The interface uses an `EventPayloadType` generic for the stored shape (`:27-56`).
- `CommandHandlerOptions.schema.versioning.{upcast, downcast}` (`emmett/src/commandHandling/handleCommand.ts:91-96`), documented in `src/docs/api-reference/commandhandler.md:220-232`.
- `ProjectionDefinition.eventsOptions.schema` (`emmett/src/projections/index.ts:64-66`).
- `ReactorOptions.messageOptions.schema.versioning.upcast` (`emmett/src/processors/processors.ts:375-383`).
- `WorkflowOptions.schema.versioning.{upcast, downcast}` (`emmett/src/workflows/workflowProcessor.ts:51-56`).
- Drivers apply them: in-memory (`emmett/src/eventStore/inMemoryEventStore.ts:123, 260`), PostgreSQL (`emmett-postgresql/src/eventStore/schema/readStream.ts:88`, `postgreSQLEventStore.ts:612`), SQLite (`emmett-sqlite/src/eventStore/schema/readStream.ts:88`, `appendToStream.ts:105`), MongoDB (`mongoDBEventStore.ts:318, 432`), ESDB (`eventstoreDBEventStore.ts:148, 229, 271`).
- Pongo has the same shape for documents: `PongoDBCollectionOptions.schema.versioning.{upcast, downcast}` (`Pongo/src/packages/pongo/src/core/typing/operations.ts:134-148`), applied in `pongoCollection.ts:179-198, 622`.
- `JSONCodec({ upcast, downcast })` exists in both Emmett (`emmett/src/serialization/json/jsonSerializer.ts:66-74, 296-330`) and Dumbo (`Pongo/src/packages/dumbo/src/core/serializer/json/index.ts:60-67, 263-296`).

### 2.2 Stored schema version column

- PostgreSQL `emt_messages` has `message_schema_version TEXT NOT NULL` (`emmett-postgresql/src/eventStore/schema/tables.ts:56`). Append always passes the string `` `'1'` `` (`appendToStream.ts:342`). Because it goes through a parameter array, the stored value is likely the three characters `'1'` including quotes (not verified against a database).
- SQLite has the same column (`emmett-sqlite/src/eventStore/schema/tables.ts:36`), but the insert puts `expectedStreamVersion ?? 0n` in that position (`appendToStream.ts:291` against the column list at `:296-306`). This looks like a placeholder or bug.
- Both read paths select `message_schema_version` but never use it (`emmett-postgresql/.../readStream.ts:57-88`).
- MongoDB read models carry `_metadata.schemaVersion: number` (`emmett-mongodb/src/eventStore/mongoDBEventStore.ts:77`), which is a projection schema version, not a message version.
- Projections have `version?: number` (`emmett/src/projections/index.ts:56`); PostgreSQL stores the projection definition as JSON (`emmett-postgresql/src/eventStore/projections/management/projectionManagement.ts:43-46`, `JSONSerializer.serialize(registration.projection)`). Anything placed in `canHandle` gets serialized into that column.

There is no type-name mapping (CLR-style type name to stored name), no registry and no schema object for messages. The only type rewriting is the workflow `${workflowName}:` prefix.

### 2.3 Validation helpers

- `emmett/src/validation/index.ts:1-41`: `isNumber`, `isBigint`, `isString`, `assertNotEmptyString`, `assertPositiveNumber`, `assertUnsignedBigInt`, plus a `const enum ValidationErrors`. `validation/dates.ts` has UTC `yyyy-mm-dd` helpers.
- `ValidationError extends EmmettError` with `errorCode: 400` and a message only, no list of issues (`emmett/src/errors/index.ts:21-27, 119-129`). Errors are classes (the one place classes are used).
- Express and Hono problem-details middleware maps any `errorCode` between 100 and 599 to the HTTP status (`emmett-expressjs/src/middlewares/problemDetailsMiddleware.ts:31-38`), so throwing `ValidationError` already gives HTTP 400.

### 2.4 Serialization and dates

- Emmett `JSONSerializer` (`emmett/src/serialization/json/jsonSerializer.ts`) writes `Date` as ISO strings and `bigint` as strings by default (`:201-207`). Reviving is opt-in: `parseDates` and `parseBigInts` (`:209-214`). The date reviver only matches 24-character `...T...Z` strings (`:152-167`).
- PostgreSQL JSONB is parsed by the Dumbo serializer registered as a pg type parser (`Pongo/src/packages/dumbo/src/storage/postgresql/pg/serialization/index.ts:12-22`). SQLite calls `serializer.deserialize(row.message_data)` (`emmett-sqlite/src/eventStore/schema/readStream.ts:66-67`). MongoDB stores BSON (dates stay `Date`). ESDB stores JSON.
- Consequence: an event typed with `Date` fields is read back with string fields on JSON-based stores unless `parseDates` is on. The TypeScript type and the runtime shape already disagree today. A schema that validates `Date` would fail on read for the same data on some drivers.
- The serializer code is duplicated three times: Emmett (`emmett/src/serialization`), Almanac (`almanac/src/serialization`, internal, not exported from `almanac/src/index.ts`) and Dumbo (`dumbo/src/core/serializer`). The `bigIntReviver` bodies are byte-identical between Emmett and Dumbo (checked with `diff`).

## 3. Where messages enter and leave

### 3.1 Command creation in web API packages

No package validates request bodies against a schema. Handlers build commands by hand with the assertion helpers:

- Express sample: `assertNotEmptyString(request.body.productId)`, `assertPositiveNumber(request.body.quantity)` (`emmett-expressjs/src/e2e/decider/api.ts:59-80`).
- Hono: `const body = await context.req.json();` then the same asserts (`emmett-honojs/src/e2e/decider/api.ts:74-77`).
- Fastify: `const { productId, quantity } = request.body as PricedProductItem;` (`emmett-fastify/src/e2e/decider/api.ts:40`), an unchecked cast. Fastify has built-in JSON Schema route validation, but it is not used.
- `on(handle)` in Express is a thin wrapper with no validation hook (`emmett-expressjs/src/handler.ts:21-31`).
- Peer deps: Express, Hono and Fastify packages have no schema library (`emmett-*/package.json`).

### 3.2 Append and read across drivers

All drivers accept `EventType[]` plus `options.schema.versioning` and serialize `type`, `data`, `metadata` as-is. Natural single choke points if validation on write or read is wanted:

- In-memory: `inMemoryEventStore.ts:123` (read), `:260` (append).
- PostgreSQL: `postgreSQLEventStore.ts:612` (append, after `downcastRecordedMessages`), `schema/readStream.ts:62-89` and `schema/readMessagesBatch.ts:140-165` (read, row mapping).
- SQLite: `schema/appendToStream.ts:70-110`, `schema/readStream.ts:62-88`, `schema/readMessagesBatch.ts:91-113`.
- MongoDB: `mongoDBEventStore.ts:318` (read), `:420-441` (append).
- ESDB: `eventstoreDBEventStore.ts:148, 229` (read), `:271-296` (append), `mapFromESDBEvent` `:380-404`.
- Processors (consumer side): `processors.ts:1031-1045` already maps every message through upcast before filtering by `canHandle`.

### 3.3 Testing helpers

- `DeciderSpecification.for(decider)` is fully generic over `Command`, `Event`, `State` (`emmett/src/testing/deciderSpecification.ts:57-80`). `then(expected)` uses `containsOnlyElementsMatching`, which checks that each expected event is a subset of an actual one (`testing/assertions.ts:11-24, 337-340`). An extra `kind` on actual events passes; an expected event with `kind` against an actual without it fails.
- `WorkflowSpecification` in `testing/workflowSpecification.ts` (122 lines), same style.
- Projection specs exist per driver (`inMemoryProjectionSpec.ts`, `postgresProjectionSpec.ts`, `sqliteProjectionSpec.ts`).
- Test file naming: `*.unit.spec.ts`, `*.int.spec.ts`, `*.e2e.spec.ts`; one `*.browser.spec.ts`. Emmett has 139 unit, 165 int, 20 e2e and no `*.type.spec.ts`. Pongo has 90 unit, 55 int, 11 e2e and 20 `*.type.spec.ts` using `expectTypeOf` (for example `Pongo/src/packages/pongo/src/core/schema/schema.type.spec.ts`). The root scripts filter by `.unit.spec` / `.int.spec` / `.e2e.spec` (`src/package.json` `test:*`), so `.type.spec` files are type-checked by `build:ts` and run only by plain `vitest`.

### 3.4 Workflows and RFC 001

- `Workflow<Input, State, Output, Name>` is `{ name, decide, evolve, initialState }` (`workflow.ts:7-17`). Inputs and outputs must be registered as string arrays (`workflowProcessor.ts:42-49`).
- RFC: "Inputs and outputs must be registered explicitly. We cannot detect them from types, as they're erased during JavaScript runtime." (`src/rfc/001-Workflow.md:288`). It also states the registration "serves as documentation" (`:290`). Future sections mention workflow versioning and metadata about which version processed each event (`:439-447`) and scheduling through "optional metadata fields on messages" (`:514`).
- Workflows depend on `kind` at type level (`WorkflowEvent`/`WorkflowCommand` extract by `kind?: 'Event' | 'Command'`, `workflow.ts:19-27`) but at runtime decide command vs event by checking `outputs.commands.includes(type)` (`handleWorkflow.ts:494-500`).

## 4. Almanac as the package template

Files (`src/packages/almanac`): `package.json`, `tsconfig.json`, `tsconfig.build.json`, `tsconfig.eslint.json`, `tsdown.config.ts`, `vitest.config.ts`, `src/`.

- Name and version: `@event-driven-io/almanac`, `0.1.0-beta.47`, `"type": "module"` (`almanac/package.json:2-5`).
- Exports: five entry points (`.`, `./otel`, `./otel-node`, `./pino`, `./console`), each with `import` (`.js`, `.d.ts`) and `require` (`.cjs`, `.d.cts`) conditions; plus `main`, `module`, `types`, `files: ["dist"]`.
- Dependencies: none. Optional integrations are listed three times: `peerDependencies`, `peerDependenciesMeta.*.optional: true`, and `optionalDependencies` (OpenTelemetry and pino). `devDependencies` only for tests.
- `tsdown.config.ts`: `dts: true`, `format: ['esm', 'cjs']`, `fixedExtension: false`, `target: 'esnext'`, `sourcemap: true`, `deps.skipNodeModulesBundle: true`, `tsconfig: 'tsconfig.build.json'`, one entry per subpath.
- `tsconfig.json` extends `../../tsconfig.shared.json` with `composite: true`, `rootDir: ./src`; `tsconfig.build.json` sets `composite: false`.
- `vitest.config.ts` spreads `../../vitest.shared.ts` (node env, `**/*.spec.ts`, 30 s timeouts).
- Scripts: `build: tsdown`, `build:ts: tsc`, `test:unit|int|e2e` with the same filters as the root.
- `src/index.ts` is a list of `export *` from feature folders; optional providers live in separate entries (`src/otel.ts`, `src/pino.ts`).

How it is wired into the monorepo (each must be repeated for a new package):

- Root workspaces list (`src/package.json` `workspaces`), root `build` script order (`run-s build:ts build:almanac build:emmett ...`).
- `src/tsconfig.json` `paths` (`"@event-driven-io/almanac": ["./packages/almanac/src"]`) and `references`.
- `src/vitest.config.ts` `projects` list.
- Bundle boundary test: `src/e2e/bundleBoundaries.bundle.spec.ts:105-123` asserts that `almanac/index` and `almanac/console` do not import `pino` or `@opentelemetry/*`, and that no entry imports Node built-ins; `src/e2e/buildBundles.ts` builds `almanac` and `emmett` first.
- Publish: `.github/workflows/publish.yml:35-56` publishes every non-private `packages/*/` automatically, tag derived from the version suffix.
- Emmett depends on it as a regular dependency with a pinned version: `"@event-driven-io/almanac": "0.1.0-beta.47"` (`emmett/package.json` `dependencies`). Imports are plain `@event-driven-io/almanac` in `processors.ts`, `utils/locking`, `otel-node.ts` and others.
- Pongo does not use Almanac (no reference in `Pongo/src/packages`).

## 5. Pongo and Dumbo

### 5.1 Dependency direction

- Emmett depends on Pongo and Dumbo: `emmett-postgresql` and `emmett-sqlite` list `@event-driven-io/dumbo@0.13.0-beta.56` and `@event-driven-io/pongo@0.17.0-beta.56` as dependencies; the root lists Pongo as a peer.
- Pongo does not depend on Emmett or Almanac. Pongo deps: `@event-driven-io/dumbo`, `@types/mongodb`, `ansis`, `cli-table3`, `commander`, `lru-cache`, `uuid`. Dumbo deps: `uuid` only.
- So a shared package consumed by both must sit below Dumbo/Pongo in the graph and must not import Emmett.

### 5.2 How documents are typed

- `PongoDocument = Record<string, unknown>` (`Pongo/src/packages/pongo/src/core/typing/operations.ts:670`).
- `pongoSchema = { client, db, schema, collection, index }` (`pongo/src/core/schema/index.ts:452-458`).
- `pongoSchema.collection<Document>(name, { indexes })` (`schema/index.ts:291-308`). The document type is a generic only.
- The collection table defines `data: column('data', JSON<Document>(), { notNull: true })` and `metadata: column('metadata', JSON<Record<string, unknown>>(), ...)` (`schema/index.ts:53-86`).
- Dumbo `JSONToken.from<ValueType>()` returns a token whose `ValueType` is phantom; the runtime object is `{ sqlTokenType: 'SQL_COLUMN_JSON', SQL_COLUMN_JSON: true, jsTypeName: 'value_type:js:object' }` (`Pongo/src/packages/dumbo/src/core/sql/tokens/columnTokens.ts:169-188`). `JSONB` is the same (`:190-206`). Column type factories are exported as `SQL.column.type` (`columnTokens.ts:332-345`).
- Collections can receive an explicit `definition?: PongoCollectionComponent<T>` (`operations.ts:139`), added in the latest Pongo commit (`7a6ced8f`).
- Dumbo's "validation" (`dumbo/src/core/schema/components/relationships/relationshipValidation.ts`, `dumboSchema.ts:144-179`) is compile-time validation of table relationships, not runtime data validation.

### 5.3 Pongo publishing and tooling

- Same pattern as Emmett: ESM plus CJS, `import`/`require` conditions with `.d.ts`/`.d.cts` (`pongo/package.json` `exports`).
- Pongo's `tsdown.config.ts` is more elaborate than Almanac's: separate JS builds per entry with `dts: false`, plus two declaration-only builds (ESM `.d.ts` and `.d.cts` with `cjsDefault: true`), and an explicit `neverBundle` list.
- Pongo `engines.node` is `>=22.20.0`; Emmett's is `>=24.12.0`. Both `.nvmrc` files say `v24.12.0`, and CI uses `.nvmrc`. A shared package used by Pongo should work on Node 22.20.
- Same TypeScript (`^6.0.3`), tsdown (`^0.21.9`), Vitest (`^4.1.x`), `@types/node` (`^25.6.0`), and the same tsconfig settings.

## 6. Build and tooling constraints

- TypeScript `6.0.3` installed. `target: ESNext`, `module: ESNext`, `moduleResolution: bundler`, `verbatimModuleSyntax: true`, `strict`, `noUncheckedIndexedAccess`, `noImplicitReturns`, `lib: ["ESNext"]`, `types: ["node"]`, `skipLibCheck` (`src/tsconfig.shared.json`).
- Node `>=24.12.0` for Emmett (`src/package.json` `engines`).
- Dual ESM/CJS for every published package; `target: 'esnext'` output.
- Runtime portability: the core must run in browsers, Bun and Cloudflare Workers. ESLint forbids `node:*` imports in non-spec code (`src/eslint.config.mjs`, `no-restricted-imports` with `patterns: ['node:*']`); the bundle test checks for Node built-ins in `almanac` and `emmett` output; `src/e2e/browser`, `src/e2e/bun` and `src/e2e/esmCompatibility` (Nuxt) exist.
- `any`: `typescript-eslint` `flat/recommended` and `flat/recommended-type-checked` are on, so `no-explicit-any` and the `no-unsafe-*` rules are errors. The codebase uses `// eslint-disable-next-line @typescript-eslint/no-explicit-any` where needed (for example `AnyEvent` in `event.ts:32-33`).
- Dependency policy as observed: core packages keep runtime dependencies minimal (Almanac: none; Emmett: Almanac and `async-retry`; Dumbo: `uuid`). Optional integrations go through optional peers plus separate subpath entries, and the bundle test checks the main entry does not pull them in. No schema library (Zod, Valibot, TypeBox, ArkType, Standard Schema) is a dependency in either repo today.
- Coding style rules (`AGENTS.md`): functions, closures and object literals instead of classes; no monkey-patching; tests named after observable behaviour.

Related observation about TypeBox 1.3.34 (downloaded in `schema-research/packages/typebox-1.3.34`): its `package.json` exports only `import` and `default` conditions pointing to `.mjs` files, so it is ESM-only. A CJS build of a new package that requires it relies on Node's `require(esm)` support (available unflagged on Node 22.12+ and therefore on both repos' minimum versions, but bundlers and test runners may differ; not verified here). TypeBox checks `Environment.CanEvaluate()` before using `new Function` and falls back otherwise (`build/system/environment/evaluate.mjs:18-25`), which matters for Cloudflare Workers where code generation from strings is blocked.

## 7. Documentation that defines events and commands

Pages that would need updating:

- `src/docs/api-reference/event.md` (type definition, union types, `event()` factory, metadata, utility types, best practices; embeds `packages/emmett/src/typing/event.ts` at `:293`).
- `src/docs/api-reference/command.md` (same structure; section "Validate at Boundaries" at `:299-316` shows manual `ValidationError`).
- `src/docs/api-reference/commandhandler.md` (schema versioning at `:220-232`), `decider.md`, `eventstore.md`, `projections.md`, `workflows.md`.
- Guides: `getting-started.md`, `quick-intro.md`, `guides/command-handling.md`, `guides/projections.md` (versioning snippet `projections/projectionOptions.snippet.ts#versioning`), `guides/testing.md`, `guides/workflows.md`, `guides/error-handling.md`.
- Event store pages that show `Event<...>`: `event-stores/esdb.md`, `mongodb.md`, `postgresql.md`, `sqlite.md`.
- Framework pages: `frameworks/expressjs.md`, `fastify.md`, `honojs.md` (body to command mapping).
- `resources/packages.md` (package list, for the new package).
- Snippets defining event types: `src/docs/snippets/api/event.ts`, `snippets/api/command.ts`, `snippets/gettingStarted/events.ts`, `snippets/quickStart/index.ts`, and nine `guides/**/*.snippet.ts` files under `guides/projections` and `guides/consumers`.
- Samples with event definitions: `samples/webApi/*/src/shoppingCarts/shoppingCart.ts` (five samples) and `samples/cloudflare/{d1,durable-objects}`.
- RFC: `src/rfc/001-Workflow.md` registration section (`:266-290`).

## Implications and open questions for the design

1. Backward compatibility. Every consumer of message types uses only `type`, `data`, `metadata` and optional `kind`. If a definition's inferred type equals today's `Event<'T', Data, Meta>`, deciders, handlers, stores and projections need no type changes. The open question is whether the value should be called `Event` (collides with the global `Event` when not imported, and needs explicit re-exports to avoid `export *` ambiguity) or whether the existing `Workflow` value-plus-type precedent is enough justification.
2. `canHandle`, message bus `handle/subscribe`, workflow `inputs/outputs` and the command handler `commandType` are all string arrays. Natural plug-in: accept definitions alongside strings and normalize to `.type`. Watch out that PostgreSQL serializes projection definitions (including `canHandle`) into a JSON column (`projectionManagement.ts:46`).
3. Workflows are the strongest early user: they need runtime knowledge of which types are commands vs events and currently duplicate it in `outputs.commands`. A definition carrying `kind` would remove that duplication. Should definitions be the way to fix the fact that `message_kind` is written but never read, and that plain-object commands are stored as `'E'`?
4. Where should validation run: at creation (factory), at the HTTP boundary, on append, on read, or in processors? Each has a single choke point (section 3.2). Read-side validation conflicts with date and bigint handling: JSON-based stores return ISO strings unless `parseDates` is set, while MongoDB returns `Date`. Does the schema describe the in-memory shape or the stored JSON shape, and should it drive revivers instead of the heuristic `dateReviver`?
5. Versioning: today `schema.versioning.{upcast, downcast}` is configured per call site, not per type, and downcast cannot rename types. `message_schema_version` exists in both SQL schemas but holds `'1'` (PostgreSQL) or the expected stream version (SQLite), and is never read. Should a definition own its version and upcasters, and should the drivers start writing and reading that column? This touches stored data, so it needs a migration story.
6. Errors: `ValidationError` carries only a message. Schema issues (path, message) would need either a richer error or a new error type; the HTTP mapping already turns `errorCode: 400` into a 400 response.
7. Package placement: the new package must not depend on Emmett, must be consumable by Dumbo or Pongo (which do not use Almanac), must run on Node 22.20+, browsers, Bun and Workers without `node:*`, and must ship ESM plus CJS. If TypeBox (ESM-only) is the default implementation, is it a hard dependency, an optional peer in a separate subpath entry (Almanac's `otel`/`pino` pattern, guarded by the bundle boundary test), or bundled?
8. Pongo integration point: `JSON<Document>()` in Dumbo and `pongoSchema.collection<Document>()` are phantom generics. A runtime schema could be passed there to infer `Document`; the existing `schema.versioning` option on collections has the same shape as Emmett's, which suggests sharing one versioning contract.
9. Serializer duplication (Emmett, Almanac, Dumbo) is a hint that shared infrastructure currently gets copied rather than shared. Is the new package also meant to become the home for shared JSON serialization, or strictly schemas?
10. Testing conventions: Emmett has no `*.type.spec.ts` files; Pongo uses them for type-level tests. A package whose main value is type inference will likely want them. Should Emmett adopt Pongo's `.type.spec.ts` convention for the new package?
11. Unclear and worth confirming with Oskar: whether `DefaultCommandMetadata = { now: Date }` should be part of the command schema, and whether command metadata validation is in scope at first.
