# Tooling prior art: message definitions, docs, tests, workflows

Research for the message schemas brainstorm. Area: how specs, documentation tools and messaging, event sourcing and durable-execution frameworks define message types with schemas and metadata, and how tests can be generated from them. This file reports facts and trade-offs only; it does not propose a design.

## How to read this

- All sources were downloaded on 2026-10-04 into `sources/tooling/` (paths below are relative to `schema-research/`). Packages were unpacked into `packages/`. Experiments live in `prototypes/tooling/`.
- "Verified" means I read the spec text, the package source or typings, or ran code. "Reported" means the claim comes from vendor docs or marketing pages I did not check against code.
- Emmett today, for context: `Event<Type, Data, Metadata>` and `Command<...>` are type-only; `DeciderSpecification.for({ decide, evolve, initialState })(given).when(cmd).then(events)` lives in `src/packages/emmett/src/testing/deciderSpecification.ts`; workflows declare `inputs` and `outputs` as message type strings in `workflowProcessor({...})` (`src/rfc/001-Workflow.md`).

## 1. Specifications

### AsyncAPI 3.x

Current release is 3.1.0 (2026-01-31); the only feature added over 3.0.0 is ROS 2 bindings (verified, GitHub release notes, `sources/tooling/asyncapi-3.1.0-spec.md`).

Message Object fields (verified, 3.1.0 spec, "Message Object"): `headers` (schema), `payload` (schema), `correlationId`, `contentType`, `name` (machine-friendly), `title`, `summary`, `description` (CommonMark), `tags`, `externalDocs`, `bindings` (per protocol), `examples`, `traits`. Specification extensions `x-*` are allowed everywhere.

- There is no `version`, `deprecated`, `owner`, or event-versus-command field on a message. `deprecated` exists only on the Schema Object (verified, spec line "deprecated | boolean"). Versioning exists only at document level (`info.version`).
- Message Trait Object may carry anything a Message Object has except `payload` and `traits`; traits are merged into the message (verified). This is how shared headers (for example correlation and causation) are reused.
- Message Example Object: `headers`, `payload`, `name`, `summary`; values MUST validate against the message schemas (verified).
- Correlation ID Object: `description` plus a runtime expression `location`, for example `$message.header#/correlationId` (verified).
- Multi Format Schema Object: `{ schemaFormat, schema }`. Formats every implementation MUST support: the AsyncAPI Schema Object and JSON Schema draft-07 (`application/schema+json;version=draft-07`). RECOMMENDED: Avro 1.9.0, OpenAPI 3.0.0 schema, RAML 1.0, Protobuf 2 and 3. JSON Schema 2020-12 is not in either table (verified, "Schema formats table").
- The AsyncAPI Schema Object is "a superset of JSON Schema Draft 07" (verified).
- Operations (`action: send | receive`, `channel`, `messages`, `reply`, `title`, `summary`, `description`, `tags`, `traits`) describe which application sends or receives which message on which channel (verified). AsyncAPI documents one application per document; producers and consumers are expressed as `send` or `receive` operations in each application's own document.

Example from the spec (verified, Message Object example):

```json
{
  "name": "UserSignup",
  "title": "User signup",
  "summary": "Action to sign a user up.",
  "contentType": "application/json",
  "tags": [{ "name": "user" }],
  "headers": { "type": "object", "properties": { "correlationId": { "type": "string" } } },
  "payload": { "type": "object", "properties": { "user": { "$ref": "#/components/schemas/userCreate" } } },
  "correlationId": { "description": "Default Correlation ID", "location": "$message.header#/correlationId" },
  "traits": [{ "$ref": "#/components/messageTraits/commonHeaders" }],
  "examples": [{ "name": "SimpleSignup", "summary": "A simple UserSignup example message", "payload": { "user": { "someUserKey": "someUserValue" } } }]
}
```

### CloudEvents

Required attributes `id`, `source`, `specversion`, `type`; optional `datacontenttype`, `dataschema` (URI), `subject`, `time` (verified, `cloudevents-main-spec.md`, version 1.0.3-wip; `cloudevents-1.0.2-spec.md` is the last release).

- `type` "SHOULD be prefixed with a reverse-DNS name"; examples include `com.example.object.deleted.v2` (verified).
- `dataschema`: "Incompatible changes to the schema SHOULD be reflected by a different URI" (verified).
- Primer on versioning: backward-compatible data change keeps `type`; incompatible change should change `type`, and producers are encouraged to emit both old and new events for a while; `dataschema` is "informational" and should generally change on any change (verified, `cloudevents-primer.md`, "Versioning of CloudEvents").
- Extensions relevant to event sourcing (verified, files in `sources/tooling/`): `correlation` (`correlationid`, `causationid`), `deprecation` (`deprecated`, `deprecationfrom`, `deprecationsunset`, `deprecationmigration`), `sequence`, `recordedtime`. Deprecation is a per-event runtime attribute, not catalog metadata.

CloudEvents describes the envelope of one event instance. It has no place for summary, owner, examples or producer and consumer lists; that is left to registries (xRegistry message definitions, covered in `findings/formats-registries.md`).

### TypeSpec

TypeSpec is a separate language (`.tsp` files) compiled by emitters. Relevant emitters: `@typespec/json-schema` 1.16.0, `@typespec/protobuf` 0.86.0, `@typespec/events` 0.86.0, `@typespec/versioning` 0.86.0, OpenAPI 3 (verified, package.json on `main`). There is no AsyncAPI emitter in the TypeSpec repository (verified, package listing).

The JSON Schema emitter maps doc decorators directly to JSON Schema annotations (verified, `typespec-json-schema-emitter-src.ts`): `@doc` to `description`, `@summary` to `title`, `@example` to `examples`, `#deprecated` to `deprecated: true`, and it emits `$schema: https://json-schema.org/draft/2020-12/schema`. `@typespec/events` adds `@events`, `@contentType`, `@data` for event unions (verified, README). `@typespec/versioning` adds `@added`, `@removed`, `@madeOptional` per version (reported, README only).

Relevance: TypeSpec shows that the standard JSON Schema annotation keywords (`title`, `description`, `examples`, `deprecated`) are enough to carry docs metadata at the payload level; message-level metadata (type name, kind, version, producers) lives outside the payload schema in every tool reviewed.

## 2. EventCatalog (deep dive)

Versions checked: `@eventcatalog/core` 4.12.3, `@eventcatalog/sdk` 2.29.2, `@eventcatalog/generator-asyncapi` 7.0.3, `@eventcatalog/diff` 0.1.2 (verified, npm registry and monorepo clone at commit `d042e309`, 2026-09-29).

### 2.1 Content model

A catalog is a folder of Markdown/MDX files with YAML frontmatter, built by Astro. Frontmatter is validated by Zod collections in `packages/core/eventcatalog/src/content.config.ts` (saved as `sources/tooling/eventcatalog-4.12.3-content.config.ts`, verified).

Resource types (verified, `resourcePointer.type` enum and SDK typings): domain, system, service, agent, event, command, query, channel, flow, entity, container (data store), data product, diagram, ADR, user, team, plus custom docs and changelogs.

Base fields shared by every resource (verified, `baseSchema`):

| Field | Notes |
| --- | --- |
| `id` | Used for folder name, URL and references |
| `name` | Display name |
| `version` | Required string, semver in practice |
| `summary` | Short text |
| `owners` | ids of users or teams |
| `badges`, `styles`, `sidebar`, `hidden`, `visualiser` | Presentation |
| `deprecated` | `true` or `{ message, date }` |
| `draft` | `true` or `{ title, message }` |
| `schemaPath` | File next to `index.mdx`, for example `schema.json` |
| `specifications` | AsyncAPI, OpenAPI, GraphQL file paths (services) |
| `repository` | `{ language, url }` |
| `attachments`, `diagrams`, `resourceGroups`, `editUrl` | Links |
| `x-*` | Custom properties, allowed by `withExtensionProperties` and rendered with `<CustomProperty>` (verified in `examples/default/.../ReviewAPI/index.mdx`) |

Messages (event, command, query) add `channels` (pointers with `parameters`), `schemas` (array of `{ id, ref, file, path, name, format, environments, default }`), `operation` (`method`, `path`, `statusCodes` for HTTP-backed messages), `detailsPanel`. `producers` and `consumers` exist in the message collection schema but are marked "Used by eventcatalog": they are computed, not authored (verified).

Producers and consumers are declared on the service or domain, not on the message (verified, `services` collection and `eventcatalog-map-producers-and-consumers.md`):

```yaml
receives:
  - id: submit-review
    version: 1.0.0
    triggers:
      - id: review-submitted
        version: 1.0.0
        condition: When the review passes submission validation
sends:
  - id: review-submitted
    version: 1.0.0
writesTo:
  - id: review-database
```

`sends` and `receives` pointers also take `fields` (consumer field usage), `group`, and `to`/`from` channel pointers with `delivery_mode: push | pull | push-pull`. `receives[].triggers[]` with a free-text `condition` is the closest EventCatalog concept to "command handler X emits event Y" (verified, `sendsPointer`, `receivesPointer`, example `ReviewAPI` service).

Entities have `aggregateRoot`, `identifier` and typed `properties` (verified, SDK `Entity`). Flows have `steps[]`, each step with `id`, `title`, `summary`, exactly one node type (`message`, `service`, `agent`, `flow`, `container`, `dataProduct`, `actor`, `externalSystem`, `custom`) and `next_step` or `next_steps` with optional edge `label` (verified, `flows` collection and `eventcatalog-flows-model-flow-steps.md`).

### 2.2 Folder conventions and versioning

- Messages live in `events/`, `commands/`, `queries/` folders at the catalog root or nested under a service or domain, for example `services/Orders/events/OrderPlaced/index.mdx` (verified, `eventcatalog-messages-create-messages-create-event.md`).
- Schema files sit next to `index.mdx` and are referenced by `schemaPath`. Examples go into an `examples/` folder (JSON payload files, or an `examples/index.mdx` for written usage examples since 4.11/4.12) (verified, docs and SDK `addExampleToResource`).
- Versioning is by folder copy: the current version stays at the resource root, older versions move to `versioned/<version>/` (verified, `eventcatalog-version-messages.md` and SDK `versionResource`, which copies everything except nested `events`, `commands`, `queries`, `versioned` folders, then clears the root).
- References use `version` (default `latest`) and accept semver ranges like `0.0.x` (verified, SDK `eventHasVersion` docs).

### 2.3 Schemas

- Any file format can be attached; rendering and field extraction recognise JSON Schema, Avro and Protobuf; YAML schemas are parsed (verified, `schema-viewer-utils.ts` and `enterprise/fields/field-extractor.ts`). The Fields Explorer extractor lives under `enterprise/`, which is under the commercial license (verified, file header).
- The default example catalog uses draft-07 JSON Schema (`"$schema": "http://json-schema.org/draft-07/schema#"`, verified, `eventcatalog-example-submit-review-schema.json`). My prototype wrote a 2020-12 schema and the SDK stored and read it back unchanged; I did not run the Astro build to check rendering of 2020-12-only keywords (verified for SDK only).
- `@eventcatalog/diff` (MIT) compares two SDK indexes and gives a compatibility verdict for JSON Schema only (`format: 'json-schema'`, or `.json` files that look like JSON Schema); other formats get `breaking: null` (verified, `eventcatalog-diff-README.md`). It follows local `#/definitions/...` pointers (verified, `compare.ts` comment). Its `COMPATIBILITY.md` explains forward and backward compatibility in reader and writer terms.

### 2.4 SDK (`@eventcatalog/sdk` 2.29.2, MIT)

Verified by `npm pack` and reading `dist/index.d.ts`. Default export `utils(catalogDir)` returns functions. Dependencies: fs-extra, glob, gray-matter, proper-lockfile, semver, slugify, zod 4.

Per message type (event, command, query, same shape): `get*`, `get*s`, `write*`, `write*ToService`, `write*ToAgent`, `rm*`, `rm*ById`, `version*`, `addFileTo*`, `addSchemaTo*`, `*HasVersion`, `addExampleTo*`, `getExamplesFrom*`, `removeExampleFrom*`. Services: `writeService`, `addEventToService(id, 'sends' | 'receives', { id, version, fields?, group?, triggers? })`, `addCommandToService`, `addDataStoreToService`, and so on. Also domains, systems, flows (`writeFlow`, `FlowBuilder`), entities, channels, changelogs (`writeChangelog`, `appendChangelog`), graph queries (`getProducersAndConsumersForMessage`, `getSchemaForMessage`, `getConsumersOfSchema`), `buildIndex`, `createSnapshot`, `diffSnapshots`, `toDSL`.

Signatures (verified, typings):

```ts
writeEvent: (event: Event, options?: { path?: string; override?: boolean; versionExistingContent?: boolean; format?: 'md' | 'mdx' }) => Promise<void>;
addSchemaToEvent: (id: string, schema: { schema: string; fileName: string }, version?: string, options?: { path?: string }) => Promise<void>;
addExampleToEvent: (id: string, example: { content: string; fileName: string }, version?: string) => Promise<void>;
versionEvent: (id: string) => Promise<void>;
addEventToService: (id: string, direction: string, event: MessagePointerInput, version?: string) => Promise<void>;
```

Behaviour verified in source (`sources/tooling/eventcatalog-sdk-2.29.2-internal-resources.ts`): `writeResource` throws if the same `id` and `version` exists unless `override: true`; with `versionExistingContent: true` it moves the current version to `versioned/` only if the new version is greater, otherwise it throws; it takes a file lock (`proper-lockfile`) per `index.mdx`. `options.path` is relative to the collection folder (`/ShoppingCartConfirmed`, not `/events/ShoppingCartConfirmed`), which I learned by getting `events/events/...` on the first run.

`FlowBuilder` (verified, typings) builds flows in code and is typed by message id:

```ts
const flow = FlowBuilder.create<PaymentMessageId>({ id: 'TypedPaymentFlow', name: 'Typed Payment Flow', version: '1.0.0', markdown: '# Typed Payment Flow' })
  .addMessageStep({ id: 'PlaceOrder', nextSteps: [{ id: 'PaymentProcessed' }] })
  .addMessageStep({ id: 'PaymentProcessed' })
  .build();
```

### 2.5 Generators

A generator is any module listed in `eventcatalog.config.js` under `generators: [[moduleOrPath, options], ...]`; `npm run generate` imports each and calls its default export with `(config, options)` (verified, `eventcatalog-core-4.12.3-generate.js`; core passes `{ eventCatalogConfig: {} }` as the first argument). `PROJECT_DIR` holds the catalog path (verified, `generator-template/src/index.ts`). Generators typically use the SDK.

Minimal generator, verbatim from the official template (verified, `sources/tooling/eventcatalog-generator-template-index.ts`):

```ts
import utils from '@eventcatalog/sdk';

export default async (config: EventCatalogConfig, options: GeneratorProps) => {
  const eventCatalogDirectory = process.env.PROJECT_DIR;
  if (!eventCatalogDirectory) {
    throw new Error('Please provide catalog url (env variable PROJECT_DIR)');
  }
  const { getEvent, writeEvent } = utils(eventCatalogDirectory);
  const event = await getEvent('my-event');
  if (!event) {
    await writeEvent({ id: 'my-event', name: 'My Event', version: '1.0.0', summary: 'This is my event', markdown: 'This is my event' });
  }
};
```

Config (verified, `eventcatalog-plugins-generators.md`):

```js
generators: [['<rootDir>/plugin.js', { customValue: true, hello: 'world' }]],
```

Official generators (verified, `event-catalog/generators` repo): AsyncAPI, OpenAPI, GraphQL, Apicurio, AWS Glue, Azure Schema Registry, Confluent Schema Registry, EventBridge, GitHub, Amazon API Gateway, Federation.

How the AsyncAPI generator maps AsyncAPI to the catalog (verified, `generator-asyncapi` 7.0.3 `src/index.ts`): one AsyncAPI document becomes one service; each operation's messages become events by default; `x-eventcatalog-message-type: command | query` changes that; `x-eventcatalog-message-version` overrides the version, which otherwise comes from `info.version`; `x-eventcatalog-deprecated-date`, `x-eventcatalog-deprecated-message`, `x-eventcatalog-draft`, `x-eventcatalog-group`, `x-eventcatalog-role: client`, `x-eventcatalog-channel-version` are also read. `send` operations become `sends`, `receive` become `receives`. When the incoming version is newer the old one is versioned; when older the catalog is left alone; existing Markdown is preserved by default (`preserveExistingMessages`). Message examples are written as `examples/{name}.json` (`parseExamples`, since 6.1.0). Tags become badges.

The Confluent generator maps subjects (with the `-value` suffix stripped) to messages by `exact`, `prefix`, `suffix` or `includes` filters per service `sends`/`receives`, and topics to channels; it imports JSON, Avro or Protobuf schemas (reported, plugin configuration docs).

### 2.6 Licensing

| Part | License | Source |
| --- | --- | --- |
| `@eventcatalog/core` (the site) | MIT, except `packages/core/eventcatalog/src/enterprise/` and `packages/core/src/federation/` under the EventCatalog Commercial License | verified, `eventcatalog-core-LICENSE.txt` |
| `@eventcatalog/sdk`, `cli`, `linter`, `visualiser`, `diff`, `connectors`, `create-eventcatalog` | MIT | verified, package.json files |
| Generators repo | Dual: AGPL-3.0 for open source projects, commercial license for "internal business purposes" | verified, `eventcatalog-generators-LICENSE.txt` |
| Individual generator package.json | Says "Dual License" for Apicurio, AWS Glue, Azure, Confluent, EventBridge, but "ISC" for AsyncAPI, OpenAPI, GraphQL, GitHub | verified; this conflicts with the repo-level LICENSE |
| Runtime check | AsyncAPI generator calls `checkLicense` and exits the process without `EVENTCATALOG_LICENSE_KEY_ASYNCAPI`, a `licenseKey` option, or `EVENTCATALOG_SCALE_LICENSE_KEY` | verified, `src/index.ts` line 231 and `eventcatalog-generators-checkLicense.ts` |

Pricing page (reported, `eventcatalog-pricing.md`): Community is free, self-hosted, and includes documenting resources, schemas, visualisations, flows and versioning. "Business (Scale)" is $449/month (up to 250 employees) and includes all integrations (AsyncAPI, OpenAPI, schema registry sync), Schema API, breaking-change detection in CI, MCP server, custom pages and components. Enterprise adds federation. 30-day trials.

What this means factually: writing catalog files with the MIT SDK, or with plain file writes, needs no license; my prototype did that. Using the official AsyncAPI or registry generators needs a Scale license or an AGPL-compatible project. A custom generator (template above) is user code and is not covered by the generators' license.

### 2.7 Experiment: Emmett-like definitions into a catalog

`prototypes/tooling/eventcatalog/emitCatalog.mjs` (output in `run-output.txt`, verified 2026-10-04, Node 24.12.0, SDK 2.29.2, TypeBox 1.3.34). It writes a command and an event with a TypeBox-derived 2020-12 JSON Schema and an example, a service with `receives` + `triggers` + `sends`, then bumps the event to 2.0.0 with `versionExistingContent`. Resulting tree:

```
commands/ConfirmShoppingCart/examples/basic.json
commands/ConfirmShoppingCart/index.mdx
commands/ConfirmShoppingCart/schema.json
events/ShoppingCartConfirmed/index.mdx
events/ShoppingCartConfirmed/versioned/1.0.0/examples/basic.json
events/ShoppingCartConfirmed/versioned/1.0.0/index.mdx
events/ShoppingCartConfirmed/versioned/1.0.0/schema.json
services/ShoppingCarts/index.mdx
```

Observations: custom frontmatter `x-emmett-kind: Command` was written as is; `getEvent('ShoppingCartConfirmed', '1.0.0', { attachSchema: true })` returned the old schema; the 2.0.0 write did not carry over `schema.json` or examples, so they must be re-added per version. I did not build the Astro site.

### 2.8 Decisions the maintainer would face for EventCatalog integration

- Output path: write catalog files directly with the MIT SDK, ship a custom EventCatalog generator module, or emit AsyncAPI and let users run the (licensed) AsyncAPI generator.
- Where producer and consumer data comes from: EventCatalog wants it on services (`sends`/`receives`). Emmett message definitions do not know their service; command handlers, deciders and workflow `inputs`/`outputs` do.
- Service granularity: what in an Emmett app maps to an EventCatalog service, domain or system.
- Id and version: whether the catalog `id` is the Emmett `type` string as is; where a semver `version` comes from (EventCatalog requires one per resource).
- Schema dialect: 2020-12 (Standard JSON Schema default) versus draft-07 (EventCatalog examples, AsyncAPI mandated format).
- Ownership of the Markdown body: regenerate versus preserve hand edits (the AsyncAPI generator preserves by default).
- Workflows: map to flows (`steps`, `next_steps`) and/or to `receives[].triggers` on a service.
- Event versus command: EventCatalog has separate folders; AsyncAPI needs `x-eventcatalog-message-type`.

## 3. Code-first documentation in other ecosystems

| Tool | What is generated | From what | Status |
| --- | --- | --- | --- |
| `nestjs-asyncapi` 2.0.1 | AsyncAPI 3.0 document and HTML | `@AsyncApiSend` / `@AsyncApiReceive({ channel, message: { payload: Dto }, bindings })` decorators plus `@nestjs/swagger` `@ApiProperty` | reported, README |
| Restate TS SDK 1.17.2 | Per-service OpenAPI 3.1 via admin API `/services/{service}/openapi` | Handler `input`/`output` serdes; `serde.schema(standardSchema)` calls `~standard.jsonSchema.output({ target: 'draft-2020-12' })` | verified, `serde_api.js`; OpenAPI endpoint reported |
| Trigger.dev 4.7.2 | JSON Schema shown on the dashboard test page | `jsonSchema` task option ("Should be a valid JSON Schema Draft 7 object"), sent as `payloadSchema` at indexing | verified, `tasks.d.ts`, `shared.js` |
| Hatchet TS SDK 1.34.0 | JSON Schema for dashboard autocomplete | `inputValidator?: z.ZodType` ("a JSON Schema is generated and sent to the Hatchet backend") | verified, `v1/declaration.d.ts` |
| Encore.ts | Service Catalog, API docs, Flow architecture diagram | Static analysis of TypeScript types and of which services publish or subscribe to each `Topic` | reported, Encore docs |
| Wolverine 5.8+ | `dotnet run capabilities wolverine.json`: all message types, routing, stores; `describe` prints routing tables | Runtime model of the app | reported, `wolverine-guide-command-line.md` |
| Specmatic, Springwolf, Saunter | Not checked in depth | | |

AsyncAPI direction is mostly spec-first in the JS ecosystem: `@asyncapi/modelina` 5.10.1 generates TS models from AsyncAPI, and `@asyncapi/generator` 3.4.1 renders docs and code from a document (reported, npm descriptions). npm search found no maintained Zod-to-AsyncAPI or Standard-Schema-to-AsyncAPI library (searched `asyncapi zod`, `asyncapi typebox`, `asyncapi standard schema`, 2026-10-04).

## 4. Frameworks

### 4.1 Summary table

| Framework | Definition | Type name | Schema / validation | Version | Docs or contract output |
| --- | --- | --- | --- | --- | --- |
| Inngest 4.21.1 (TS) | `eventType(name, { schema, version })` | `name` string | Any Standard Schema; validates on send (`create().validate()`) and on consume against triggers; transforms rejected at type level | `version` sets `v` | None found |
| Trigger.dev 4.7.2 (TS) | `schemaTask({ id, schema, run })` | task `id` | Zod, Yup, ArkType, Effect, Valibot, TypeBox via wrapper, custom parser; validates on `trigger()` and before run | task versions are deployments | `jsonSchema` to dashboard |
| Restate 1.17.2 (TS) | `restate.handlers.handler({ input: restate.serde.schema(S), output }, fn)` | service and handler name | Standard Schema; JSON Schema extracted for discovery | none per message | OpenAPI 3.1 per service |
| Hatchet 1.34.0 (TS) | workflow opts `{ name, description, version, onEvents, inputValidator }` | name | Zod | `version` string | JSON Schema to dashboard |
| DBOS 5.2.11 (TS) | `DBOS.registerWorkflow(fn, { name, inputSchema })` | name | any object with `.parse()`, receives argument tuple | none | none |
| Temporal (TS) | `defineSignal<[Args]>('name')`, `defineUpdate`, `defineQuery`; `setHandler(def, fn, { description, validator })` | string name | type-only; optional update `validator`; payload converters (JSON, protobuf) | none per message | none |
| Effect 4.0.0 (TS) | `Rpc.make(tag, { payload, success, error })`, `Workflow.make(tag, { payload, idempotencyKey, success, error, annotations })`, `EventGroup.empty.add({ tag, primaryKey, payload, success, error })` | `tag` | Effect Schema, with `title`, `description`, `documentation`, `examples`, `default` annotations; `Schema.toJsonSchemaDocument`, `Schema.toStandardJSONSchemaV1` | none | JSON Schema; property tests via `Arbitrary` |
| Encore.ts | `new Topic<Msg>(name, { deliveryGuarantee, orderingAttribute })` | topic name | TS type, static analysis | none | catalog, flow diagram |
| Motia 1.0.4-rc.1 (TS) | step `config = { name, description, flows, triggers: [{ type: 'queue', topic, input: schema }], enqueues: [topic] }` | topic | Zod (`bodySchema`, `input`) | none | flow view in iii Console |
| KurrentDB client 1.3.1 (TS) | `jsonEvent({ type, data, metadata, id })` | `type` string | none client-side; v2 append protocol has `SchemaInfo { format: JSON / PROTOBUF / AVRO / BYTES, name, id? }` per record | none | none |
| Confluent `@confluentinc/schemaregistry` 1.10.1 (TS) | `JsonSerializer(client, serdeType, { validate, autoRegisterSchemas, useLatestVersion, useSchemaId })` | subject strategy | Ajv validation against registry schema when `validate: true`; draft-07 and 2020-12 types | registry versions, compatibility | registry |
| NServiceBus (.NET) | class implementing `ICommand`, `IEvent`, `IMessage`, or unobtrusive conventions | .NET type | none | new contract type per breaking change, `[Obsolete]` | ServiceInsight / ServicePulse (not checked) |
| MassTransit (.NET) | records, classes, interfaces | full type name; `[MessageUrn("...")]` override | none | new type | none |
| Wolverine / Marten (.NET) | `[MessageIdentity("person-born", Version = 2)]`; Marten `MapEventType`, `Upcast<Old, New>(...)` | alias, default full name (Wolverine) or snake_case (Marten) | none | `Version` in content type `application/vnd.person-born.v2+json`; `IForwardsTo<T>`; upcasters | `capabilities` JSON |
| Axon 5 (Java) | `@Event(namespace, name, version)`, `@Command` | `QualifiedName` namespace + local name | none | `version` (Axon 4: `@Revision` + upcasters) | AxonIQ Console (not checked) |
| Eventuous (.NET) | `[EventType("V1.RoomBooked")]` on records; source generator registers type map | attribute string | none | version in name by convention | none |
| Akka SDK (Java) | `@TypeName("...")` on events; `@Migration(X.class)` with `JsonMigration.currentVersion()` and `transform(fromVersion, json)` | type name | Jackson | migration version int | none |

### 4.2 Notes and verbatim samples

Inngest (verified, `packages/inngest-4.21.1`, `components/triggers/triggers.{d.ts,js}`, `components/execution/engine.js`, `components/Inngest.js`):

```ts
export const invoicePaid = eventType("billing/invoice.paid", {
  schema: z.object({ invoiceId: z.string(), customerId: z.string() }),
});
await inngest.send(invoicePaid.create({ invoiceId: "inv_123", customerId: "cus_456" }));
```

`EventType` holds `name`, `schema`, `version`, and `create()` returns `{ name, data, id, ts, v, meta, validate }`. `inngest.send` calls `validate()` on created events; the execution engine validates incoming event data against the function's trigger schemas (`validateEventSchemas`). `staticSchema<T>()` is a passthrough Standard Schema for types only. No description, examples or JSON Schema export on `EventType`.

Trigger.dev (verified, `triggerdev-tasks-schemaTask.md`): validation happens in `myTask.trigger(...)` but "`tasks.trigger<typeof myTask>('my-task', ...)` will NOT call the schema parser"; payload is validated again before every run, failing with `TaskPayloadParsedError` and no retry. Input and output types differ for schemas with defaults or coercion, which Trigger.dev allows (Inngest forbids).

Restate (verified, `restate-ts-serialization.md`, `restate-sdk-1.17.2-discovery.d.ts`): handler discovery manifest has `documentation?: string`, `metadata?: { [k: string]: string }`, `input: { contentType, jsonSchema, required }`, `output: { contentType, jsonSchema }`.

Effect 4.0.0 (verified, `packages/effect-4.0.0`, `prototypes/tooling/testgen/effectArbitrary-output.txt`): one schema yields validation, JSON Schema 2020-12 with `title`, `description`, `examples`, a Standard JSON Schema object, and an `Arbitrary` for property tests. `Workflow.make` takes `annotations?: Context.Context<never>` for arbitrary metadata. `EventGroup` is "unstable" (marked `@stability unstable`).

Wolverine (verified, `wolverine-guide-messages.md`):

```cs
[MessageIdentity("person-born", Version = 2)]
public class PersonBornV2 { ... }
public class PersonBorn : IForwardsTo<PersonBornV2> { public PersonBornV2 Transform() { ... } }
```

Axon 5 (verified, `axon5-Event.java`): `@Event` has `namespace()` (default package name), `name()` (default simple class name), `version()` (default `MessageType.DEFAULT_VERSION`). Axon 4 used `@Revision("2.0")` plus `SingleEventUpcaster` (verified, `axon-event-versioning.html`).

Akka (verified, `akka-sdk-serialization.html`): "It is highly recommended to add a @TypeName annotation ... By default, a FQCN is used, which requires extra attention in case of renaming."

### 4.3 Patterns observed

- Explicit, stable type name separate from the code identifier: Wolverine, MassTransit, Axon 5, Eventuous, Akka, Marten all add it after starting with class names.
- Version handling splits two ways: version in the type name (Eventuous `V1.RoomBooked`, CloudEvents `...v2`, NServiceBus new type) or a separate version field (Wolverine `Version = 2`, Axon `version`, Akka migration version, Inngest `v`).
- Upcasting is attached to the old version (Wolverine `IForwardsTo`, Marten `Upcast<Old, New>`, Akka `JsonMigration`).
- TS durable-execution frameworks accept Standard Schema or Zod and validate on both send and consume (Inngest, Trigger.dev); several push JSON Schema to a dashboard (Trigger.dev, Hatchet, Restate).
- None of the frameworks reviewed attaches owners or examples to the message definition; Effect Schema (`examples`) and AsyncAPI (`examples`) do at schema or doc level.

## 5. Test generation

### 5.1 Libraries (versions verified on npm, 2026-10-04)

| Package | Version, date | Input | Output | Note |
| --- | --- | --- | --- | --- |
| `fast-check` | 4.10.2, 2026-09-19 | | arbitraries, `fc.assert` | `@fast-check/vitest` 0.5.0 |
| `zod-fast-check` | 0.10.1, 2023-09-13 | Zod 3 | fast-check 2 to 3 | peer `zod ^3.18`, `fast-check <4`; unmaintained for Zod 4 |
| `@traversable/zod-test` | 0.0.28, 2025-10-04 | Zod 4 | `zxTest.fuzz(schema)` arbitrary, valid and invalid data generators | peer `zod 4`; see experiment |
| `@traversable/json-schema-test` | 0.0.25, 2025-09-26 | random JSON Schemas | valid and invalid data from seeds | generates schemas, aimed at testing validators |
| `json-schema-faker` | 0.6.3, 2026-08-01 | JSON Schema 2019-09, 2020-12 | `generate`, `generateSync`, seeded (Mulberry32) | library-agnostic via JSON Schema |
| `@anatine/zod-mock` | 3.14.0, 2025-04-04 | Zod 3 | faker data | peer `zod ^3.21` |
| `zod-schema-faker` | 2.1.2, 2026-09-25 | Zod 3.25 or 4 | faker data | |
| `effect` `Arbitrary` | 4.0.0, 2026-10-01 | Effect Schema | own Arbitrary type, `sampleEffect`, `checkEffect` | no fast-check dependency in 4.0.0 |
| TypeBox `Value.Create` | 1.3.34 | TypeBox | default value | `build/value/create` exists; one value, not random |

### 5.2 Experiments

All in `prototypes/tooling/testgen/`, run 2026-10-04 on Node 24.12.0.

1. `fuzzValidity.mjs` checks whether `zxTest.fuzz` output satisfies its own schema (2000 samples, seed 42). With zod 4.6.5: `z.int().positive()` 1998/2000 invalid, `z.number().gt(0)` 994/2000 invalid, `z.string().min(1)` 0/2000 (`fuzzValidity-output.txt`). With zod 4.1.12 in a scratch project: `z.int().positive()` 4/2000 invalid (all `0`), the rest 0 (`fuzzValidity-zod41-output.txt`). So the generator is sensitive to the Zod minor version and was not reliable on the current Zod (verified).
2. `jsfValidity.mjs` exports each Zod schema with `z.toJSONSchema(schema, { target: 'draft-2020-12' })`, generates 2000 seeded values with `json-schema-faker`, and validates them back with Zod: 0 invalid for positive ints, `gt(0)`, `min(1)` strings, and an object with `uuid`, ISO datetime and bounded int (`jsfValidity-output.txt`, verified).
3. `generatedTests.mjs` (run with the repo's `tsx` against Emmett's `deciderSpecification.ts` source): a property test wraps `json-schema-faker` in `fc.integer().map(seed => generateSync(schema, { seed }))`, fuzzes 200 commands, and checks every event returned by `decide` validates against that event's schema; then it generates seeded example payloads from the exported JSON Schema and runs them through `DeciderSpecification.for(...)` `given/when/then` and `thenThrows`. Output (`run-output.txt`): all passed, same seed gives the same example. The first version using `zxTest.fuzz` failed on `quantity: 0`, which is how experiment 1 started (verified).
4. `effectArbitrary.mjs`: Effect 4 `Arbitrary.schema(...)` samples all decoded successfully; `Schema.toJsonSchemaDocument` produced 2020-12 JSON Schema carrying `title`, `description`, `examples` from `.annotate(...)`; `Schema.toStandardJSONSchemaV1(...)` exposes `jsonSchema.input` (`effectArbitrary-output.txt`, verified). `sampleEffect` returned 10 samples when asked for `size: 50` (`size` is not a count).

Generated values are valid but not meaningful (for example `quantity: 8243368819687424`, random strings as ids). Relationships between messages (the command's `shoppingCartId` equal to the opened cart's) had to be wired by hand in the experiment.

### 5.3 Contract testing for messages

- Pact JS 17.1.4 message pacts (verified, `pact-js-messages.md`): the consumer test declares `addAsynchronousInteraction().given(state).expectsToReceive(description, b => b.withJSONContent({ id: like(1), type: regex(...) }).withMetadata({ queue: 'animals' }))` and runs its handler; the contract file is shared; the provider test maps each description to a function producing the message (`MessageProviderPact({ messageProviders: { 'a request for a dog': providerWithMetadata(() => createDog(27), { queue: 'animals' }) } })`). Contracts are example plus matchers, not JSON Schema.
- Specmatic Async (reported, `specmatic-asyncapi.html`): runs contract tests and mocks from AsyncAPI specs across Kafka, SQS, SNS, RabbitMQ and others, sends example messages from the spec and checks replies on other channels; the page says this is "Specmatic Enterprise".
- EventCatalog Scale advertises a Schema API "for mocking or testing" and breaking-change detection in CI (reported, pricing page).

### 5.4 How these relate to Emmett's Given/When/Then

Emmett's spec takes concrete given events, one command, and expected events or an error. What schemas can supply, as shown in the experiments: (a) example payloads for `given` and `when` (from `examples` annotations, AsyncAPI `examples`, EventCatalog `examples/*.json`, or seeded generation); (b) a property "every emitted event is valid against its own schema" that needs no expected values; (c) round-trip checks (serialize, upcast, validate). What schemas cannot supply: the expected events in `then` (business rules), correlation between fields of different messages, and meaningful values. Event Modeling describes the same Given/When/Then shape as the specification of each command and view (verified, `eventmodeling-org.html`: "Given: We have registered, and added a payment method, When: We try to book a room, Then: a room is booked."). Qlerify and prooph board (Cody) advertise model-to-code generation and JSON or OpenAPI export (reported, home pages); I did not find a documented import or export format for Given/When/Then specs from either.

## 6. Workflow and handler metadata

| Tool | Inputs | Outputs | Diagram or docs |
| --- | --- | --- | --- |
| Emmett workflow RFC | `inputs: { commands: [...], events: [...] }` | `outputs: { commands: [...], events: [...] }` | none yet |
| AsyncAPI | `receive` operations | `send` operations, `reply` | per application |
| EventCatalog | service `receives` | service `sends`, `receives[].triggers[]` with `condition` | node graph, flows (`steps`, `next_steps`, labels) |
| Motia | `triggers: [{ type: 'queue', topic, input }]` | `enqueues: [topic]` | `flows: ['name']` groups steps for the iii Console |
| Hatchet | `onEvents`, `onCrons` | not declared | dashboard |
| Temporal | `defineSignal`, `defineUpdate`, `defineQuery` with `description` | activity calls not declared | Web UI from history |
| Restate | handler `input` schema | handler `output` schema | OpenAPI, admin API |
| Effect | `Workflow.make` `payload` | `success`, `error` schemas | none |
| Encore | static analysis of `Subscription` | static analysis of `publish` | Flow diagram |
| Wolverine | handlers discovered from methods | cascading messages discovered or declared ("message discovery") | `describe`, `capabilities` |

Observations: the tools that draw diagrams either analyse code statically (Encore), read declared lists (Motia, EventCatalog, AsyncAPI, the Emmett RFC), or read runtime history (Temporal). Only EventCatalog `triggers` links a specific input to the specific outputs it causes; AsyncAPI operations and Motia `enqueues` are per handler, not per input.

## 7. Metadata fields across tools

| Field | AsyncAPI 3.1 | CloudEvents | EventCatalog | xRegistry message* | JSON Schema annotation | Seen in frameworks |
| --- | --- | --- | --- | --- | --- | --- |
| Machine type name | `name` | `type` | `id` | yes | | all |
| Kind (event, command, query) | `x-` only | no | folder | no | | NServiceBus, Axon, Emmett `kind` |
| Title or display name | `title` | | `name` | | `title` | |
| Summary | `summary` | | `summary` | | | |
| Description | `description` (CommonMark) | | Markdown body | `description`, `documentation` URL | `description` | Restate `documentation`, Temporal `description` |
| Version | doc `info.version` | in `type` or `dataschema` by convention | `version` required | versions | | Wolverine, Axon, Inngest, Akka |
| Deprecated | schema only | extension | `deprecated { message, date }` | `deprecated { effective, removal, alternative, documentation }` | `deprecated` (2019-09 and later, not draft-07) | NServiceBus `[Obsolete]` |
| Owners | | | `owners` | | | |
| Tags or badges | `tags` | | `badges` | labels | | |
| Examples | `examples` (headers + payload) | | `examples/` files | | `examples` | Effect `examples` |
| Payload schema | `payload` | `dataschema` URI | `schemaPath`, `schemas[]` | `dataschema` | | most |
| Metadata / headers schema | `headers` | extensions | via schema | envelope metadata | | Emmett `Metadata` |
| Correlation | `correlationId` location | `correlationid`, `causationid` ext | | | | MassTransit headers |
| Producers / consumers | per-app operations | `source` | services `sends`/`receives` | | | Encore static analysis |
| Channel | `channels` | | `channels` | | | Encore topic, Motia topic |
| Custom | `x-*` | extensions | `x-*` | `labels` (string map; message model declares no wildcard) | any keyword | Restate `metadata`, Effect annotations |

*xRegistry details are in `findings/formats-registries.md`; the column only marks presence as described there.

## 8. Trade-offs observed

- JSON Schema dialect: `deprecated` exists only from 2019-09 on, so a draft-07 export cannot carry it as a keyword (see `findings/formats-registries.md`). Standard JSON Schema targets `draft-2020-12` and `draft-07`; AsyncAPI mandates draft-07 support and does not list 2020-12; EventCatalog examples use draft-07 while its diff and SDK are dialect-neutral; TypeSpec, Restate and Effect emit 2020-12; Trigger.dev asks for draft-07; Confluent serdes accept both.
- Where message-level metadata lives: inside the schema as annotations (TypeSpec, Effect) keeps one object but mixes docs with validation and loses message-level fields like kind and version; beside the schema (AsyncAPI Message Object, EventCatalog frontmatter, Inngest `EventType`) keeps the payload schema clean.
- Producer and consumer data: no message definition in any reviewed framework lists its producers; it comes from handlers, services or static analysis.
- Validation points: send only, consume only, or both (Inngest, Trigger.dev do both); Trigger.dev shows the bypass when triggering by string id.
- Test data: schema-derived generators yield valid but meaningless values; quality varies by library and version (experiment 1); JSON Schema based generation worked across libraries in the experiments but loses library-specific refinements that do not map to JSON Schema.
- EventCatalog licensing: the SDK and site are MIT; the official generators and several features (Schema API, Fields Explorer, breaking-change CI, MCP) are commercial or AGPL.

## Implications and open questions for Emmett

These are the questions the findings raise. They are listed without a preferred answer.

What a message definition could carry, as observed in other tools:

- Identity: `type` string, `kind` (Event, Command, maybe Query), optional namespace.
- Schemas: `data` and `metadata` schemas (AsyncAPI `payload` and `headers` split the same way).
- Docs: `title`, `summary`, `description`, `tags`, `externalDocs`.
- Lifecycle: `version`, `deprecated` (flag, message, date, replacement), maybe upcaster from previous version.
- Examples: named examples with data and metadata.
- Extension bag: `x-*` style custom properties.
- Not on the message in any reviewed tool: owners, producers, consumers, channels. Those appeared on services, handlers or operations.

Open questions:

1. Should metadata such as `description` and `examples` live in Emmett's definition object, in the schema library's annotations, or both, and which wins on conflict?
2. Is `version` a separate field, part of the `type` string, or absent until a registry needs it? EventCatalog requires a semver per resource; AsyncAPI has none per message; CloudEvents puts it in `type`.
3. Which JSON Schema dialect, if one is fixed: 2020-12, draft-07, or caller's choice, given AsyncAPI's draft-07 baseline?
4. Should handlers, deciders and workflows declare `inputs` and `outputs` as definition objects (so docs and diagrams can be generated) or keep string lists as in the RFC? Is per-input "triggers" granularity (EventCatalog) wanted?
5. Where does service or bounded-context identity come from, since catalogs and AsyncAPI need it and messages do not have it?
6. Which output formats are worth emitting first, if any: AsyncAPI 3.x document per app, EventCatalog folder via the MIT SDK or a custom generator, xRegistry documents, plain JSON Schema files? Each has a different home for kind, version and producers.
7. For EventCatalog specifically: the decisions in section 2.8, plus whether depending on `@eventcatalog/sdk` (MIT, zod 4 dependency) is acceptable versus writing frontmatter files directly.
8. For tests: should generated data come from the schema library (library-specific, quality varies), from exported JSON Schema (library-agnostic, coarser), or only from author-written examples? Should Emmett ship the "every emitted event is valid against its schema" property as a helper next to `DeciderSpecification`?
9. Validation points: on `event()`/`command()` creation, on append, on read, on handle? Opt-in per definition or global?
10. Are transforms (input type differs from output type) allowed? Inngest forbids them because both sides validate; Trigger.dev allows them.
