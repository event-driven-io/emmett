# Schema formats and registries

Research for the message schemas brainstorm, gathered on 2026-10-04. It covers schema formats (JSON Schema, JSON Structure, Avro, Protobuf), xRegistry, other schema registries, and how registry compatibility models meet event sourcing.

How to read citations:

- Local paths without a prefix live in `schema-research/sources/formats-registries/`. Paths starting with `packages/` or `prototypes/` are relative to `schema-research/`.
- **verified** means I read the primary spec or source, or ran code. **reported** means the claim comes from documentation, a README, or marketing text that I did not check against code.

## Key points

1. JSON Schema is the only format every registry accepts (Confluent, Apicurio, AWS Glue, Azure, KurrentDB, xRegistry). Standard JSON Schema already produces it. Its gaps for messages: no int64 or decimal types, dates are a non-asserting `format` annotation by default, and the open content model makes compatibility checks ambiguous.
2. Registries disagree about JSON Schema compatibility. Adding an optional property to an open-content schema is "backward compatible" in Apicurio, but not in Confluent's strict mode, AWS Glue, or the xRegistry reference server. The same schema change can pass in one registry and fail in another.
3. xRegistry is at 1.0-rc4 (2026-08-19). The planned 1.0 date (2026-09-01) has passed without a release. The model has message groups and schema groups, versioned schemas, `compatibility`, `deprecated`, and a file or static-hosted "document view" that can be generated without a server. It is a CNCF sandbox project (accepted 2025-06-05). There is no JS/TS SDK on npm. The code generator `xrcg` is Python, though it outputs TypeScript.
4. JSON Structure (Clemens Vasters, used by xRegistry) has the richest type system of the formats reviewed: int64 and decimal encoded as strings, date and time types, alternate names, units, and currencies. It is an individual IETF draft (core-04, expires 2026-12-10) with low adoption (27 GitHub stars on json-structure/core; a JS SDK that only validates). In my test, converting it to JSON Schema with avrotize dropped property descriptions.
5. Avro describes binary encoding, has no validation constraints, and its JSON encoding wraps unions (`{"string": "a"}`). Conversion to JSON Schema lost uuid, timestamp, decimal, aliases, and defaults in my test. avsc drops custom attributes.
6. "New code reads every stored event" corresponds to `BACKWARD_TRANSITIVE`, not the Confluent default `BACKWARD`. Among the registries reviewed, Confluent's data-contract migration rules (UPGRADE and DOWNGRADE in JSONata, Enterprise only) are the only feature that resembles upcasting. Emmett already has `upcast` and `downcast` hooks.

## 1. Schema formats

### 1.1 JSON Schema (draft-07 and 2020-12)

Sources: `json-schema-2020-12-core-draft-bhutton-json-schema-01.txt`, `json-schema-2020-12-validation-draft-bhutton-json-schema-validation-01.txt`, `json-schema-draft-07-core-draft-handrews-json-schema-01.txt`, `json-schema-draft-07-validation-draft-handrews-json-schema-validation-01.txt`, `json-schema-2020-12-meta-data-vocab.json`.

#### Annotation and structure keywords relevant to message metadata

| Keyword | draft-07 | 2020-12 | Notes |
| --- | --- | --- | --- |
| `title`, `description` | yes | yes | Strings for UI and docs (verified). |
| `default` | yes | yes | Any value; "RECOMMENDED that a default value be valid" (verified). |
| `examples` | yes | yes | Array; implementations "MUST provide a flat array" when several apply (verified, 2020-12 §9.5). |
| `readOnly`, `writeOnly` | yes | yes | Booleans (verified). |
| `deprecated` | no | yes | Boolean; "applications SHOULD refrain from usage of the declared property" (verified, 2020-12 §9.3; absent from draft-07 validation spec). |
| `$comment` | yes | yes | For schema maintainers only, "MUST NOT be collected as an annotation result" (verified, 2020-12 core §8.3; draft-07 core §9). |
| `$id`, `$ref` | yes | yes | Identification and referencing (verified). |
| `definitions` / `$defs` | `definitions` | `$defs` | Reuse location (verified). |
| `$anchor`, `$dynamicRef` | no | yes | Plain-name fragments and dynamic references (verified). |
| `contentMediaType`, `contentEncoding` | yes | yes | Content vocabulary, annotation only (verified). |

Unknown keywords: 2020-12 says "Unknown keywords SHOULD be treated as annotations, where the value of the keyword is the value of the annotation" (verified, core §4.3.1 and §6.5). Ajv in its default strict mode rejects them instead: compiling `{ "x-unit": "kg" }` fails with `strict mode: unknown keyword: "x-unit"`. It works with `strict: false` or after `ajv.addVocabulary(['x-unit'])` (verified, `prototypes/formats-registries/ajv-custom-keywords.mjs`, ajv 8.20.0). If Emmett adds custom keywords such as units or Emmett metadata, consumers need a declared vocabulary or a relaxed validator.

#### Formats

2020-12 defines `date-time`, `date`, `time`, `duration`, `email`, `idn-email`, `hostname`, `idn-hostname`, `ipv4`, `ipv6`, `uri`, `uri-reference`, `iri`, `iri-reference`, `uuid`, `uri-template`, `json-pointer`, `relative-json-pointer`, and `regex` (verified, validation §7.3). draft-07 has `date-time`, `date`, and `time` but no `duration` or `uuid` (verified). In 2020-12, `format` is an annotation by default: assertion "MUST be disabled by default" unless the Format-Assertion vocabulary is used (verified, §7.2.1). A schema that says `"format": "date-time"` therefore does not reject `"yesterday"` unless the validator opts in.

#### Gaps for message definitions

| Gap | Detail | Status |
| --- | --- | --- |
| No sized numeric types | `integer` has no width. JSON numbers are only interoperable in -2^53..2^53-1 (RFC 8259 §6, quoted in JSON Structure core §3.2.2). Emmett's `StreamPosition` is `bigint` (`src/packages/emmett/src/typing/event.ts`). | verified |
| No decimal type | Only `number`. Money must be modelled as a string plus a pattern, or by convention. | verified |
| Dates are strings with an annotation | See formats above. There is no "Date object" type, so a TypeScript `Date` needs an input/output distinction (Standard JSON Schema has separate `input` and `output` converters). | verified (`packages/standard-schema-spec-1.1.0/dist/index.d.ts`) |
| Open content model by default | Omitting `additionalProperties` allows any extra property. That makes "add optional property" ambiguous for compatibility (section 4). | verified |
| No discriminated union keyword | `oneOf` plus a `const` discriminator by convention. | verified |
| No rename or alias concept | Unlike Avro `aliases` or JSON Structure `altnames`. | verified |

### 1.2 JSON Structure

Sources: `json-structure-draft-core-04.txt` (8 June 2026, expires 10 December 2026), plus the companion drafts `json-structure-draft-{alternate-names,units,validation,cond-composition,import}-03.txt` and `json-structure-org-repos.json`.

**Status (verified).** These are individual Internet-Drafts by C. Vasters (Microsoft), "Intended status: Standards Track". The datatracker shows no working group stream. Companion drafts: Validation, Conditional Composition, Import, Alternate Names, Units (symbols, scientific units, currencies), Relations, and Semantic Annotations (`-sem-ann-00`, 2026-08-06). Media type: `application/json-structure`.

**Type system (verified, core §3.2 and §3.4).**

- JSON primitives: `string`, `number`, `integer` (an alias for `int32`), `boolean`, `null`.
- Extended primitives: `binary`, `int8` to `int128`, `uint8` to `uint128`, `float8`, `float`, `double`, `decimal` (with `precision` and `scale`), `date`, `datetime`, `time`, `duration`, `uuid`, `uri`, `jsonpointer`.
- `int64`, `uint64`, `int128`, `uint128`, and `decimal` are encoded as JSON strings "to preserve precision".
- Compound types: `object`, `array`, `set`, `map`, `tuple`, `any`, `choice` (tagged or inline discriminated unions with `selector`).
- Rules:
  - A document requires `$id`, `$schema`, and `name`.
  - `$ref` is only allowed inside `type` and must point inside the same document. External imports are a separate extension.
  - Names must match `[A-Za-z_][A-Za-z0-9_]*`.
  - Abstract types plus `$extends` provide inheritance. `$offers` and `$uses` provide add-ins.
- Documentation keywords in core are only `description` and `examples`. There is no `title` or `deprecated` keyword. `default` is reserved in core and defined in the Validation draft (§3.5).

**Extensions (verified).**

- `altnames` maps purposes to alternate names. The `json` key is the wire key, and `lang:xx` keys are display names.
- `altenums` gives alternate enum symbols. `descriptions` gives localized descriptions.
- `unit` (SI, ISO 80000, or NIST notation such as `"m/s^2"`), `ucumUnit`, `currency`, and `symbol` come from the Units draft.
- The Validation draft adds JSON Schema-like keywords (`minimum`, `pattern`, `format`, `minItems`, `default`, and others). They are enabled with `"$uses": ["JSONSchemaValidation"]`.

**Conversion to JSON Schema, run with avrotize 3.9.3 in Docker (verified, `prototypes/formats-registries/out-s2j.json`).** Input was `ShoppingCartConfirmed.struct.json`. Excerpt of the output:

```json
"totalAmount": { "type": "string", "pattern": "^-?[0-9]+(\\.[0-9]+)?$", "x-precision": 10, "x-scale": 2, "x-currency": "EUR" },
"itemsCount": { "type": "integer", "minimum": -2147483648, "maximum": 2147483647 },
"streamPosition": { "type": "string", "pattern": "^-?[0-9]+$" },
"tags": { "type": "array", "uniqueItems": true, "items": { "type": "string" } }
```

- **Kept:** root `name` became `title`, root `description`, `$id`, and number widths as ranges. Decimal, currency, and precision became `x-` keywords.
- **Lost:** the property-level `"description": "Cart id"` on `shoppingCartId` disappeared from the output (verified).
- **Doc mismatch:** avrotize's own mapping table (`avrotize-structuretojsonschema.md`) says `int64` maps to `{"type": "integer", ...}` and `decimal` to `number`. The code emits strings, which matches the core spec (verified by comparing the doc with the actual output).

**Tooling (verified).**

- `@json-structure/sdk` 0.7.0 (MIT, 2026-06-08) only validates schemas and instances. It exports `SchemaValidator`, `InstanceValidator`, and value classes `Int64`, `Decimal`, and others, but no JSON Schema conversion (`packages/json-structure-sdk-0.7.0/dist/index.d.ts`).
- Conversion lives in avrotize (Python, Apache-2.0, 3.9.3 released 2026-09-21; repo 131 stars, `github-repo-status.txt`).
- The xRegistry Go server has a hand-written JSON Structure validator and compatibility checker (`xregistry-server-format_jsonstructure.go`).
- Adoption signal: xRegistry publishes its own document schemas as JSON Structure (`*.struct.json` in `xregistry-spec-tree.json`). json-structure/core has 27 stars (reported via GitHub API).

### 1.3 Apache Avro

Source: `avro-specification-1.12.0.md` (current release 1.12.2, 2026-08-23, per GitHub releases API).

**Model (verified).**

- Primitives: `null`, `boolean`, `int`, `long`, `float`, `double`, `bytes`, `string`.
- Complex types: `record`, `enum`, `array`, `map`, union (a JSON array), `fixed`.
- Records and fields carry `doc`, `aliases`, `default`, and `order`. Enums can have a `default` that is used during resolution.
- "Attributes not defined in this document are permitted as metadata, but must not affect the format of serialized data."

**Logical types (verified).**

- `decimal` (on bytes or fixed, with `precision` and `scale`) and `big-decimal` ("Currently only available in Java and Rust").
- `uuid`, `date` (int days), `time-millis`, `time-micros`, `timestamp-{millis,micros,nanos}`, `local-timestamp-*`, and `duration` (fixed 12).
- Unknown logical types must be ignored by readers.

**Evolution (verified, §Schema Resolution).**

- Readers resolve the writer's schema against their own. Fields match by name.
- Extra writer fields are ignored. Missing writer fields take the reader's default, and an error is raised if there is no default.
- `int` can be promoted to `long`, `float`, or `double`. `string` and `bytes` convert both ways.
- Aliases rewrite the writer's names. `doc` is ignored.
- Parsing Canonical Form strips `doc` and `aliases`, and CRC-64-AVRO fingerprints identify schemas. The single-object encoding is `C3 01` followed by the 8-byte fingerprint and the binary data.

**JSON encoding (verified).** It is the same as the default-value encoding, except that unions are wrapped: `["null","string"]` encodes `"a"` as `{"string": "a"}`. Dates are numbers (epoch millis) and decimals are byte strings. Avro's JSON encoding is therefore not "plain JSON" as Emmett stores it in PostgreSQL or SQLite.

**avsc experiment (verified, `prototypes/formats-registries/avsc-resolution.cjs`, avsc 5.7.9).**

- Reading v1 bytes with a v2 reader that renames the record and field through aliases and adds `channel` with default `web` produced `CartConfirmed { cartId: 'c-1', confirmedAt: 1791108000000, channel: 'web' }`.
- Adding a field without a default failed with `no matching field for default-less shop.ShoppingCartConfirmed.channel`.
- `avsc-attrs.cjs`: re-exporting a schema with `exportAttrs: true` kept `doc` but dropped `x-unit`, `x-emmett-kind`, and `x-deprecated`. avsc does not round-trip custom metadata.
- avsc 5.7.9 was published 2025-07-13. The repo was last pushed 2026-02-22, with 1388 stars and 30 open issues (`github-repo-status.txt`). Apache's own `avro-js` 1.12.2 was published 2026-08-18 (`npm-package-metadata.txt`).

**Avro to JSON Schema with avrotize `a2j` (verified, `prototypes/formats-registries/out-a2j.json`).** Lossy:

```json
"shoppingCartId": { "type": "string", "description": "Cart id" },
"confirmedAt": { "type": "integer", "format": "int64" },
"totalAmount": { "type": "string", "contentEncoding": "base64" },
"note": { "type": ["string", "null"] },
"status": { "type": "string", "enum": ["Confirmed", "Cancelled"], "title": "Status" }
```

- The `uuid` logical type, `timestamp-millis`, decimal precision and scale, the record `namespace`, `aliases`, and both defaults were all dropped.
- `status` became required despite having a default, and there is no `$schema`.
- `a2s` (Avro to JSON Structure) also dropped decimal precision and the null branch of `note` (`out-a2s.json`).

**Other JS converters (reported, npm metadata only).** `jsonschema-avro` 2.1.1 (2024-03-03), `json-schema-to-avro` 1.1.0 (2019), and `avro-to-json-schema` 0.1.0 (2021). None look actively maintained.

### 1.4 Protobuf (brief)

Sources: `protobuf-proto3-guide.txt` and `protobuf-json-mapping.txt` (protobuf.dev, fetched 2026-10-04).

- Fields are identified by numbers from 1 to 536,870,911. Numbers "should never be reused". Deleted fields go into `reserved` (verified).
- Binary wire-safe changes: adding fields, removing fields, and adding enum values (verified).
- With ProtoJSON storage, the safe changes "are different" (verified). For example, renames break JSON but not binary.
- ProtoJSON writes `int64`, `uint64`, and `fixed64` as decimal strings (verified).
- Protobuf has no validation constraints without extensions (protovalidate), and documentation only lives in comments.
- JS tooling: `protobufjs` 8.8.0 and `@bufbuild/protobuf` 2.16.0 (reported, npm metadata).

### 1.5 Format comparison

| | JSON Schema 2020-12 | JSON Structure core-04 | Avro 1.12 | Protobuf 3 |
| --- | --- | --- | --- | --- |
| Describes plain JSON as stored | yes | yes | no (union wrapping, epoch numbers, byte decimals) | ProtoJSON only |
| int64 / decimal | no / no | yes (strings) / yes (string, precision, scale) | `long` / `decimal` logical type | `int64` (string in JSON) / no |
| Date types | `format` annotation | `date`, `datetime`, `time`, `duration` | logical types on int and long | `google.protobuf.Timestamp` |
| Docs metadata | `title`, `description`, `examples`, `deprecated`, `$comment` | `description`, `examples`, `descriptions` (i18n) | `doc` | comments only |
| Renames | no | `altnames` (display and wire names) | `aliases` (used in resolution) | field numbers |
| Validation constraints | rich | Validation extension | none | none (without plugins) |
| Evolution semantics in spec | none | none | reader and writer resolution | wire-safe rules |
| Lossless to JSON Schema | n/a | no, but close (types become patterns and `x-` keywords) | no | no |
| Standard status | IETF draft, de facto standard | individual IETF draft | Apache spec | Google spec |
| JS/TS tooling | ajv, TypeBox, Standard JSON Schema | `@json-structure/sdk` (validation only) | avsc, avro-js | protobufjs, @bufbuild/protobuf |

## 2. xRegistry

Sources:

- Saved specs at v1.0-rc4: `xregistry-core-spec.md`, `xregistry-schema-spec.md`, `xregistry-message-spec.md`, `xregistry-endpoint-spec.md`, `xregistry-cloudevents-spec.md`, `xregistry-http-binding.md`, `xregistry-primer.md`, `xregistry-core-model.md`.
- Models and document schema: `xregistry-message-model.json`, `xregistry-schema-model.json`, `xregistry-cloudevents-document-schema.json`.
- Release notes and roadmap: `xregistry-release-notes.md`, `xregistry-roadmap.md`.
- Samples: `xregistry-sample-*.xreg.json`.
- Tooling: `xregistry-codegen-README.md`, `xregistry-server-README.md`, `xregistry-server-format_jsonschema.go`.

### 2.1 Status (verified unless marked)

- Releases: rc1 2025-04-01, rc2 2025-06-19, rc3 2026-06-20, rc4 2026-08-19. The rc4 notes call it the "final release before v1.0".
- The roadmap targeted version 1.0 for 2026/09/01. As of 2026-10-04 the latest tag is still `v1.0-rc4` (GitHub releases API).
- The project was split out of CloudEvents in April 2023 and is run by the CNCF Serverless Working Group. It is a CNCF sandbox project, accepted 2025-06-05 (verified, `cncf-landscape.yml`, item `xRegistry`, `project: sandbox`). The last spec commit was 2026-09-25 (GitHub API).
- Repos in the `xregistry` org:
  - `spec`: 115 stars.
  - `server`: Go, Apache-2.0, 19 stars. A full server plus the `xr` CLI; the README says it is "a work-in-progress".
  - `codegen` (`xrcg`): Python and Jinja.
  - `viewer` and `xrproxy`: TypeScript.
  - `hub.xregistry.io`.
- An npm search for "xregistry" returned no SDK package (`npm-search-xregistry.json`).

### 2.2 Core model (verified)

- **Hierarchy:** Registry, then Groups, then Resources, then Versions. Each Resource has a `meta` sub-object for Resource-level data (`compatibility`, `deprecated`, `defaultversionid`, `xref`, `readonly`). It also exposes its default Version's attributes inline.
- **Common attributes:**
  - `<SINGULAR>id` is required and immutable. It may contain `[A-Za-z0-9-._~:@]`, starts with an alphanumeric or `_`, and is at most 128 characters.
  - Other attributes: `self`, `shortself`, `xid`, `epoch`, `name`, `description`, `documentation`, `icon`, `labels` (a string map with keys in `[a-z0-9:-_.]`), `createdat`, `modifiedat`, and `deprecated`.
  - The `deprecated` object holds `effective`, `removal`, `alternative`, and `documentation`.
- **Required fields on Versions:** `ancestorid` is required, and a root Version points at itself. The default `versionid` algorithm uses monotonically increasing integers starting at `1`. For semver, the spec says: "RECOMMENDED to include a major version identifier in the Resource `<RESOURCE>id`, like `com.example.event.v1`".
- **`format`:** "SHOULD follow the naming convention `<NAME>/<VERSION>`", case-insensitive. The schema spec mandates `JsonSchema/draft-07`, `JsonSchema/draft/2019-09`, `JsonSchema/draft/2020-12`, `Avro/<release>`, `Protobuf/3`, `XSD/1.1`, and `JsonStructure/draft-04`.
- **`compatibility` values:** `backward`, `backward_transitive`, `forward`, `forward_transitive`, `full`, and `full_transitive`. If it is absent, "the server MUST NOT perform any `compatibility` checking". The meaning of each value is per-format and not defined by xRegistry. Servers advertise `capabilities.compatibilities` per format.
- **Validation flags:** the model flags `validateformat` and `validatecompatibility` produce read-only `formatvalidated` and `compatibilityvalidated` attributes. A file server may expose these as `true` if the data was validated upstream (primer §11.22).
- **Views:**
  - The API view uses absolute URLs and duplicates default Version attributes onto the Resource.
  - The document view (`doc` flag or export) uses `#/...` JSON Pointer relative URLs, drops duplicated default-Version attributes, and drops `formatvalidated` and `shortself`.
  - Document-view output "can be used in request messages", so a generated file can be imported into a server.
- **No-code servers:** the primer describes three representations: a single JSON file, a static file server ("You could spin up an xRegistry using GitHub Pages"), and an API server. Over HTTP, a static server can expose a document plus a sibling `$details` file for metadata (`xregistry-http-binding.md` "No-Code Servers").
- **Discovery:** `/.well-known/xregistry` returns `{"registries": [...]}`.
- **Extensions:** extension attributes must be declared in the model or allowed by a `*` wildcard; otherwise the server raises `unknown_attribute`. The message model declares no `*` on messages (`xregistry-message-model.json`), so Emmett-specific data on a message must go into `labels`.

### 2.3 Schema registry spec (verified)

- `schemagroups` contain `schemas`, and each schema has `versions`. Each Version stores `schema` (inline JSON), `schemabase64`, or `schemaurl`.
- "Any breaking change MUST result in a new **schema** Resource being created". All Versions of one schema follow its `compatibility`.
- A group-level `format` plus `constraints` (`"schemas.format": {"default": ...}`) can force one format per group.
- Deep links into documents: JSON Pointer for JSON Schema and JSON Structure, `#Record` or `:Record` for Avro, and `#Message` for Protobuf.
- CloudEvents `dataschema` is meant to hold the schema Version's `self` (or `shortself`) URL.

Verbatim example from the spec (abbreviated in the original):

```json
"com.example.telemetrydata": {
  "schemaid": "com.example.telemetrydata",
  "versionid": "3",
  "isdefault": true,
  "description": "device telemetry event data",
  "ancestorid": "2",
  "format": "Protobuf/3",
  "schema": "syntax = \"proto3\"; message Metrics { float metric = 1; string unit = 2; string description = 3; }",
  "versionscount": 3
}
```

### 2.4 Message definitions spec (verified)

- **Structure:** `messagegroups` contain `messages`. A message definition is both "a template" for producers and "a filter condition" for consumers.
- **Three aspects:**
  - `envelope`: only `CloudEvents/1.0` is defined. It comes with `envelopemetadata` constraints on `type`, `source`, `subject`, `time`, `dataschema`, and so on.
  - `protocol`: `HTTP/1.1|2|3`, `AMQP/1.0`, `MQTT/3.1.1|5.0`, `KAFKA`, or `NATS`, with `protocoloptions`.
  - Payload: `dataschemaformat` together with exactly one of `dataschema` (inline) or `dataschemauri`. Optional `dataschemaxid` and `datacontenttype`.
- **Property definitions:** `type`, `value`, `required`, `description`, and `specurl`. `uritemplate` values act as templates when producing and as patterns when matching. A `time` value of `0000-01-01T00:00:00Z` means "now".
- **`basemessage`:** a deep-merged, transitive inheritance link. Dangling references are allowed.
- **Matching guidance:** `messageid` SHOULD equal the CloudEvents `type`. Message Resources SHOULD have `maxversions` 1. A change SHOULD create a new definition with a new `type` and `messageid`, linked through `deprecated`. The model file sets `"maxversions": 1` and `"hasdocument": false` for messages (`xregistry-message-model.json`).

Verbatim CloudEvents message definition from the spec:

```json
{
  "envelope": "CloudEvents/1.0",
  "envelopemetadata": {
    "type": { "value": "com.example.myevent" },
    "source": { "value": "https://{tenant}/{module}/myevent", "type": "uritemplate" },
    "subject": { "type": "uri" },
    "time": { "required": true }
  },
  "dataschemaformat": "JsonSchema/draft-07",
  "dataschemauri": "https://example.com/schemas/com.example.myevent.json"
}
```

### 2.5 Endpoints and the CloudEvents Registry (verified)

- Endpoints are groups with `usage` (`producer`, `consumer`, or `subscriber`), `channel`, `protocol` and `protocoloptions` (URLs, authorization, `deployed`), and either embedded or referenced `messagegroups`. "Message groups have a function similar to interfaces".
- The "CloudEvents Registry" combines the endpoint, message, and schema registries into one document.
- The CloudEvents Registry spec names the file extension `.cereg`. The official samples use `*.xreg.json`.

### 2.6 Tooling (verified unless marked)

- **Code generation:** `xrcg generate --language ts --style kafkaproducer|kafkaconsumer|ehproducer|ehconsumer|sbproducer|sbconsumer|egproducer|amqpproducer|amqpconsumer|mqttclient` generates a TypeScript project from a definitions file. Data classes come from avrotize. Other targets: Java, C#, Python, Go, Rust, AsyncAPI 3.0, and OpenAPI. It also has `manifest` commands to edit local files and `validate` (`xregistry-codegen-README.md`, file tree in `xregistry-codegen-tree.json`). This is a Python CLI or Docker image, not a library.
- **Reference server JSON Schema checker:** it assumes a closed world. "backward" means old ⊆ new, so deleting any field or adding an optional field passes, while adding a required field or narrowing a constraint fails. `$ref` resolution is limited: "relative and JSON-Pointer $refs such as `#/$defs/Foo` are not supported". `title`, `description`, `examples`, and `deprecated` are ignored for compatibility (`xregistry-server-format_jsonschema.go`).

### 2.7 Spec and tooling rough edges

| Issue | Evidence | Status |
| --- | --- | --- |
| `basemessage` in the spec prose, `basemessageuri` in `model.json` and the document schema | `xregistry-message-spec.md` vs `xregistry-message-model.json` and `xregistry-cloudevents-document-schema.json` | verified |
| "message definitions do not contain a version history", yet the model shows `versionid` and `versions` | `xregistry-message-spec.md` "Message Definitions (Message Group)" | verified |
| The official samples fail the official document schema when `format: "uri"` means an absolute URI, because they use relative `dataschemauri`. They pass when it is read as uri-reference. | `prototypes/formats-registries/validate-samples.mjs` output: `absolute uri: false`, `uri-reference: true` for both samples | verified |
| Samples write `JSONSchema/Draft-07`, the spec writes `JsonSchema/draft-07` (case-insensitive, so legal) | `xregistry-sample-contoso-erp-jsons07.xreg.json` | verified |
| The 1.0 date was missed | `xregistry-roadmap.md` vs the releases API | verified |

## 3. Other registries

### 3.1 Comparison

| | Confluent SR | Apicurio 3.3 | AWS Glue SR | Azure Event Hubs SR | KurrentDB (plugin) | xRegistry |
| --- | --- | --- | --- | --- | --- | --- |
| Data model | subject, then versions, plus global numeric schema ID and GUID | group, then artifact, then versions (states ENABLED, DISABLED, DEPRECATED) | registry, then schema, then versions, plus checkpoint | namespace, then schema group, then schemas and versions | schema group, then schema, then versions (`schema_version_id`) | registry, then group, then resource, then versions |
| Formats | Avro, Protobuf, JSON Schema (draft-04 to 2020-12) | Avro, Protobuf, JSON Schema (draft-04, 07, 2019-09, 2020-12), OpenAPI, AsyncAPI, GraphQL, XSD, WSDL, and more | Avro 1.11.4, JSON Schema draft-04/06/07, Protobuf | Avro, JSON Schema, Protobuf | JSON, Protobuf, Avro, Bytes | any `format` string |
| Compatibility values | BACKWARD (default), _TRANSITIVE variants, FORWARD, FULL, NONE | same names, plus VALIDITY and INTEGRITY rules | BACKWARD, BACKWARD_ALL, FORWARD, FORWARD_ALL, FULL, FULL_ALL, NONE, DISABLED | Backward, Forward, None (Avro only) | BACKWARD, FORWARD, FULL, *_ALL, NONE | backward, forward, full, *_transitive; meaning per format |
| JSON Schema compatibility | STRICT vs LENIENT policy, aware of the content model | "custom library", permissiveness-based | requires closed content model to add optional fields | not supported | NJsonSchema-based checker | server-specific |
| Metadata beyond schema | tags, `metadata.properties`, `ruleSet` (CEL, JSONata) | labels, properties, version states | up to 10 key-value metadata pairs per version | none noted | `description`, `tags` map | full xRegistry attributes plus labels |
| API | REST | REST v3 plus Confluent-compatible `/apis/ccompat/v7` and `/v8` | AWS API and SDK | REST (Azure) | gRPC `kurrentdb.protocol.registry.v2` | REST HTTP binding, or static files |
| Self-host | yes | yes | no (AWS managed) | no (Azure managed) | yes (inside KurrentDB) | yes, or static files |
| License | Confluent Community License (rules need Enterprise) | Apache-2.0 | proprietary service, free to use | proprietary service | Kurrent License v1 | spec Apache-2.0, server Apache-2.0 |

Evidence: `confluent-*.txt`, `confluent-schema-registry-README.md`, `confluent-LICENSE-ConfluentCommunity.txt`, `apicurio-assembly-*.adoc`, `aws-glue-schema-registry.txt`, `azure-schema-registry-concepts.txt`, `kurrentdb-registry-*.proto`, `kurrentdb-LICENSE.md`. All rows are verified against these docs or protos. The Azure "JSON Schema compatibility: not supported" cell comes from the sentence "Schema evolution is supported for Avro schema format only" (verified, page updated 2026-08-26).

### 3.2 Confluent Schema Registry (Confluent Platform 8.3 docs)

- **Subjects and naming (verified, `confluent-serdes-overview.txt`).**
  - `TopicNameStrategy` (default) uses `<topic>-key` or `<topic>-value`, which means one schema per topic.
  - `RecordNameStrategy` uses the fully-qualified record name. For JSON Schema that is the `title`.
  - `TopicRecordNameStrategy` uses `<topic>-<record>`.
  - The docs recommend the record strategies for "a time-ordered sequence of events" with different structures, which is how event streams mix event types.
  - Another option for several event types on one topic is a `oneOf` of references with `use.latest.version=true` (`confluent-serdes-json.txt`).
- **Wire format (verified).**
  - The default is byte 0 = `0`, bytes 1 to 4 = big-endian schema ID, then Protobuf message indexes, then data.
  - Since CP 8.1.1 there is an alternative: version byte `1` and a 16-byte schema GUID in a header. The GUID is "based on a fingerprint of the schema (including schema references, rules, and metadata)", so identical schemas get identical GUIDs across registries.
- **Register API (verified, `confluent-sr-api.txt`).**
  - Request: `POST /subjects/{subject}/versions` with `{"schema": "<string>", "schemaType": "AVRO|JSON|PROTOBUF", "references": [{"name", "subject", "version"}], "metadata": {...}, "ruleSet": {...}}`.
  - Response: `{"id": 1, "version": 1, "guid": ..., "schema": ..., "references": [...], "ts": ..., "deleted": false}`.
  - Compatibility test: `POST /compatibility/subjects/{subject}/versions[/{v}]?verbose=true`.
- **JSON Schema compatibility (verified, parsed from the HTML tables in `confluent-schema-evolution.html`).**

| Change | Lenient BW/FW/Full | Strict, open model BW/FW/Full | Strict, closed model BW/FW/Full |
| --- | --- | --- | --- |
| Add optional field | ✔/✔/✔ | -/✔/- | ✔/-/- |
| Remove optional field | ✔/✔/✔ | ✔/-/- | -/✔/- |
| Add required field | -/✔/- | -/✔/- | -/-/- |
| Remove required field | ✔/-/- | ✔/-/- | -/-/- |
| Widen scalar type | ✔/-/- | ✔/-/- | ✔/-/- |

  The reason, in Confluent's words: if the writer has an open content model, it "could already have produced a document like `{"id": "abc", "myProperty": "not a number"}`, which the reader's schema fails to parse".

- **Data contracts (verified, `confluent-data-contracts.txt`).**
  - Tags: inline `"confluent:tags": ["PII"]` or external tags with path wildcards.
  - `metadata.properties`: arbitrary key-value pairs, for example `application.major.version`.
  - `ruleSet.domainRules`: CEL conditions and transforms.
  - `ruleSet.migrationRules`: UPGRADE and DOWNGRADE transforms, for example in JSONata. They run "transitively, in this case from 1 to 2, and then from 2 to 3".
  - `compatibilityGroup` restricts checks to schemas that share a metadata value. This allows breaking major versions inside one subject.
  - Rules are "only available on Confluent Enterprise and Confluent Cloud" with the Advanced governance package. The JS client does not support the DLQ action.
- **JS client (verified, `packages/confluentinc-schemaregistry-1.10.1`).** `@confluentinc/schemaregistry` 1.10.1 (MIT) exposes `testCompatibility` and `testSubjectCompatibility`, which are server calls. Its serdes depend on `avsc`, `ajv`, `@criteria/json-schema`, `jsonata`, and `@bufbuild/cel`. There is no client-side compatibility engine.

### 3.3 Apicurio Registry 3.3.3 (2026-09-08)

- **Artifact types (verified, `apicurio-assembly-artifact-reference.adoc`).** AVRO 1.0 to 1.12; JSON Schema draft-04, draft-07, 2019-09, and 2020-12; PROTOBUF; OPENAPI; ASYNCAPI; GRAPHQL; KCONNECT; THRIFT; WSDL; XML; XSD; and new AI types (`MCP_SERVER`, `MCP_TOOL`, `MODEL_SCHEMA`, `PROMPT_TEMPLATE`, `OPENRPC`).
- **Rules (verified, `apicurio-assembly-rule-reference.adoc`).** VALIDITY, COMPATIBILITY (Confluent-style names), and INTEGRITY. JSON Schema has "Full" maturity for validity and compatibility.
- **JSON Schema compatibility (verified, `apicurio-assembly-registry-compatibility-modes.adoc`).** Apicurio treats compatibility as permissiveness: "Add a new optional property: Yes (backward)" with no content-model condition. Forward is "the inverse of backward".
- **Confluent compatibility API (verified).** `/apis/ccompat/v7` and `/v8` are "Fully supported".
- **CNCF / xRegistry (verified).** Apicurio 2.6.x shipped a CNCF Schema Registry API (`app/src/main/java/io/apicurio/registry/cncf/schemaregistry/SchemagroupsResource.java`, `apicurio-2.6.x-cncf-paths.txt`). That API is the precursor of the xRegistry schema groups. The `main` tree has no `cncf` or `xregistry` paths (`apicurio-tree.json`), so 3.x has no xRegistry API. Apicurio does emit CloudEvents for its own registry events (`CloudEventConverter.java`).

### 3.4 AWS Glue and Azure Event Hubs Schema Registry

- **AWS Glue (verified, `aws-glue-schema-registry.txt`).**
  - Serverless and "free to use"; no self-hosting.
  - JSON Schema draft-04/06/07 validated with Everit.
  - Up to 10 metadata pairs per version, 170 KB schema size, 10,000 versions per region.
  - JSON Schema BACKWARD only accepts an added optional property when the original schema has `additionalProperties: false`.
- **Azure (verified, `azure-schema-registry-concepts.txt`).**
  - Schema groups carry the format and compatibility settings for every schema they contain.
  - "Schema evolution is supported for Avro schema format only".
  - JS SDKs: `@azure/schema-registry` 1.3.0 (2024-09-16) and `@azure/schema-registry-json` 1.0.0 (`npm-package-metadata.txt`).

### 3.5 KurrentDB schema registry

- **Server plugin (verified from source; no user docs found).**
  - KurrentDB contains `src/SchemaRegistry` with a `SchemaRegistryPlugin`, which is enabled unless configured off (`kurrentdb-SchemaRegistryPlugin.cs`).
  - It has a gRPC service `kurrentdb.protocol.registry.v2` covering groups, schemas, versions, `CheckSchemaCompatibility`, and `BulkRegisterSchemas` (`kurrentdb-registry-service.proto`).
  - Formats: JSON, Protobuf, Avro, and Bytes. Compatibility modes: BACKWARD, FORWARD, FULL, BACKWARD_ALL, FORWARD_ALL, FULL_ALL, and NONE (`kurrentdb-registry-shared.proto`).
  - Schemas carry `description` and a `tags` map (`kurrentdb-registry-schemas.proto`). JSON Schema compatibility uses NJsonSchema (file list in `kurrentdb-tree.json`).
- **Per-record schema info (verified).**
  - The v2 append protocol attaches `SchemaInfo { format, name, id }` to every record. `name` is the record type, for example `"order-placed"`, and `id` is the schema version (`kurrentdb-v2-streams-shared.proto`).
  - `@kurrent/kurrentdb-client` 1.3.1 fills `name` from the record type and `format` from the content type (`packages/kurrent-kurrentdb-client-1.3.1/dist/streams/appendToStream/appendRecords.js`).
  - The 26.2 secondary indexes filter on `rec.schema.name` (`kurrentdb-whatsnew.md`).
- **Release notes and license.** Neither the 26.x release notes nor the docs folder mention a schema registry (verified, `kurrentdb-whatsnew.md` and a docs tree search). The feature looks unreleased or undocumented (reported conclusion). The license is "Kurrent License v1", which is source-available and forbids offering the software as a hosted service (verified, `kurrentdb-LICENSE.md`).

```proto
message SchemaInfo {
  SchemaFormat format = 1 [default = SCHEMA_FORMAT_UNSPECIFIED];
  string name = 2;
  string id = 3;
}
```

## 4. Schema evolution in event sourcing

### 4.1 How stored events differ from messages in flight

Registries were designed for topics with retention. Confluent defaults to non-transitive BACKWARD so "you can rewind consumers to the beginning of the topic" (verified, `confluent-schema-evolution.txt`), yet it only checks the previous version. An event store keeps every version, so the guarantee "new code reads every stored version" corresponds to **BACKWARD_TRANSITIVE** (xRegistry `backward_transitive`), not plain BACKWARD. The guarantee "older readers (projections, other services, not-yet-upgraded instances) read events written by newer code" corresponds to **FORWARD**. Both together correspond to FULL_TRANSITIVE. Two-phase deploys are the other way to get the second guarantee.

Common event-sourcing techniques (sources: `marten-events-versioning.txt`, `event-driven-io-simple-events-versioning-patterns.txt`, and the chapter list of Greg Young's "Versioning in an Event Sourced System" in `greg-young-esversioning-read.txt`; all reported).

| Technique | What it means | Registry equivalent |
| --- | --- | --- |
| Weak schema / tolerant reader | Add optional or defaulted fields; readers ignore unknown fields | open content model plus BACKWARD/FORWARD checks; Avro defaults and aliases |
| Upcasting | Transform an old payload into the current shape at read time | Confluent `migrationRules` UPGRADE (JSONata); Avro resolution for renames and defaults; Emmett `versioning.upcast` |
| Downcasting | Transform the current shape into an older one for old consumers | Confluent DOWNGRADE rules; Emmett `versioning.downcast` |
| New event type | A breaking change creates `ShoppingCartConfirmedV2` and deprecates the old type | xRegistry: new `schemaid` or `messageid` plus `deprecated.alternative`; Confluent `compatibilityGroup` by major version |
| Copy and replace or stream migration | Rewrite streams into new ones | outside every registry |

Emmett already has the hooks (verified): `EventStoreReadSchemaOptions.versioning.upcast` and `EventStoreAppendSchemaOptions.versioning.downcast` in `src/packages/emmett/src/eventStore/eventStore.ts`, `src/packages/emmett/src/eventStore/versioning/{upcasting,downcasting}.ts`, and `versioning.upcast` in processors and workflows (`src/packages/emmett/src/processors/processors.ts:380`).

### 4.2 The JSON Schema compatibility disagreement

For the most common change, "add an optional property to a schema that does not set `additionalProperties`":

| Checker | Backward? | Reasoning |
| --- | --- | --- |
| Confluent STRICT | no (forward only) | the old writer might have sent that property with another type |
| Confluent LENIENT | yes | ignores the content model |
| AWS Glue | no, unless the old schema is closed | same reasoning as Confluent STRICT |
| Apicurio 3.3 | yes | permissiveness-based |
| xRegistry Go server | yes | closed-world assumption ("producers only emit fields defined in their schema") |

All rows are verified from the sources in section 3 and `xregistry-server-format_jsonschema.go`. Facts relevant to Emmett: with `additionalProperties: false` (closed) on the old schema, the checkers above agree on additions. With closed schemas, validation also rejects unknown fields that newer writers add, which affects older readers. With open schemas, the checkers disagree as shown.

## 5. Implications and open questions for Emmett

### 5.1 Candidate internal base models: trade-offs

| Option | Strengths | Weaknesses |
| --- | --- | --- |
| **A. JSON Schema 2020-12, optionally with custom keywords** (for example `x-*` keywords or a declared vocabulary for kind, units, int64, and decimal hints) | Meets the Standard JSON Schema requirement directly; Standard JSON Schema and TypeBox already produce it; every registry accepts it; ajv validates it | No int64 or decimal types; custom keywords need `addVocabulary` in strict ajv; compatibility semantics differ across registries |
| **B. JSON Structure as internal model, JSON Schema derived** | Richest type system of the four formats for messages (int64 and decimal as strings, dates, `altnames` for renames, units, i18n descriptions); native in xRegistry; xrcg and avrotize understand it | Individual IETF draft at revision 04, not WG-adopted (drafts expire after six months); no JS converter to JSON Schema (avrotize is Python and dropped property descriptions in my test); Standard Schema libraries emit JSON Schema, not JSON Structure, so a bring-your-own-library flow would convert JSON Schema to Structure and back |
| **C. Avro as internal model** | Evolution rules defined in the spec (defaults, aliases, promotion); broad Kafka tooling | Describes binary encoding, not stored JSON; no constraints; JSON conversion lost uuid, timestamp, decimal, defaults, and aliases in my test; avsc drops custom attributes |

Option A, B, or C is not the only split: a definition object owned by Emmett (type name, kind, description, examples, deprecated, versions, upcasters) could wrap any of them, with the other formats produced as exports. The trade-offs above then apply to the export targets instead of the source of truth.

### 5.2 Mapping Emmett concepts to xRegistry

| Emmett | xRegistry | Notes |
| --- | --- | --- |
| Module or bounded context (for example `shopping-carts`) | `messagegroupid` and `schemagroupid` | Group IDs "should be treated as globally unique" (primer §9.3.3) |
| `Event('ShoppingCartConfirmed', ...)` | `messageid` and `schemaid` = `ShoppingCartConfirmed` | xRegistry recommends `messageid` = CloudEvents `type` |
| Event or Command kind | `labels: {"emmett.kind": "event"}` | The message model allows no extension attributes; `labels` is the available slot |
| Schema version N | `versions["N"]`, `ancestorid` = N-1 | Default integer `versionid` algorithm |
| Declared compatibility | `meta.compatibility` | One of the six values; see section 4.1 for what each means for stored events |
| Deprecated event type | `meta.deprecated.alternative` | Points at the replacement |
| Upcaster between versions | nothing in xRegistry | Could be a label, or Emmett-only metadata |

### 5.3 Illustration: a minimal registry document

One possible shape, generated by `prototypes/formats-registries/emit-xregistry.mjs` to test what the official document schema accepts. The full output, with a second message for the `ConfirmShoppingCart` command, is in `prototypes/formats-registries/emmett-sample.xreg.json`; it is trimmed to one event here. It is a CloudEvents Registry document in document view, with no envelope (Emmett events are not CloudEvents). It validates against `xregistry-cloudevents-document-schema.json` when `uri` is read as uri-reference, and fails the strict absolute-URI reading, just like the official samples (verified).

```json
{
  "specversion": "1.0-rc4",
  "registryid": "emmett-sample",
  "messagegroups": {
    "shopping-carts": {
      "messagegroupid": "shopping-carts",
      "messages": {
        "ShoppingCartConfirmed": {
          "messageid": "ShoppingCartConfirmed",
          "description": "Client confirmed the shopping cart.",
          "labels": { "emmett.kind": "event" },
          "dataschemaformat": "JsonSchema/draft/2020-12",
          "dataschemauri": "#/schemagroups/shopping-carts/schemas/ShoppingCartConfirmed",
          "datacontenttype": "application/json"
        }
      }
    }
  },
  "schemagroups": {
    "shopping-carts": {
      "schemagroupid": "shopping-carts",
      "format": "JsonSchema/draft/2020-12",
      "schemas": {
        "ShoppingCartConfirmed": {
          "schemaid": "ShoppingCartConfirmed",
          "description": "Client confirmed the shopping cart.",
          "labels": { "emmett.kind": "event" },
          "meta": { "compatibility": "backward" },
          "versions": {
            "1": {
              "versionid": "1",
              "ancestorid": "1",
              "format": "JsonSchema/draft/2020-12",
              "schema": {
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "title": "ShoppingCartConfirmed",
                "type": "object",
                "properties": {
                  "shoppingCartId": { "type": "string", "format": "uuid" },
                  "confirmedAt": { "type": "string", "format": "date-time" }
                },
                "required": ["shoppingCartId", "confirmedAt"],
                "additionalProperties": false
              }
            },
            "2": {
              "versionid": "2",
              "ancestorid": "1",
              "format": "JsonSchema/draft/2020-12",
              "schema": {
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "title": "ShoppingCartConfirmed",
                "type": "object",
                "properties": {
                  "shoppingCartId": { "type": "string", "format": "uuid" },
                  "confirmedAt": { "type": "string", "format": "date-time" },
                  "channel": { "type": "string", "default": "web", "description": "Where the cart was confirmed." }
                },
                "required": ["shoppingCartId", "confirmedAt"],
                "additionalProperties": false
              }
            }
          }
        }
      }
    }
  }
}
```

Per the specs, a document-view file like this can be committed, served from static hosting, and used as a request body for an xRegistry server (core spec, "Registry Model"); `xrcg` takes a definitions file as input (codegen README). I did not test either with this file. The per-version JSON Schemas map onto the Confluent register payload `{"schemaType": "JSON", "schema": "<stringified>", "metadata": {"properties": {...}}}` (also accepted by Apicurio's ccompat API), which was not tested against a running registry either.

### 5.4 Open questions for Oskar

1. Should Emmett own a compatibility checker, at least for its own generated JSON Schemas? Or should it only declare intent and leave checking to registries? Their JSON Schema rules disagree (section 4.2).
2. Should generated schemas be closed (`additionalProperties: false`)? Closed makes compatibility checks agree across registries and catches typos. Open is friendlier to forward compatibility for projections.
3. How should a breaking change be expressed: a new event type name (xRegistry's recommendation), or a new version of the same type plus an upcaster (Emmett's current `versioning.upcast`)? Where does the version number live on stored events (metadata, type suffix, or schema ID like KurrentDB's `SchemaInfo.id`)?
4. Which compatibility default should events get (`backward_transitive`?), and should commands get something different, since they are not stored?
5. Should the int64 and decimal gap be solved with a convention (string plus pattern plus an Emmett keyword) or left to the user's schema library?
6. Do we want CloudEvents `envelopemetadata` in the emitted registry (with `type` = event type and `source` = a module URI template)? Or only payload definitions, since Emmett's envelope is `{type, data, metadata}`?
7. Is JSON Structure export worth planning for now, given it is a moving individual draft, or should it wait until xRegistry 1.0 ships?
8. Should the registry document be generated at build time (static, document view), or exposed by a running app (API view, `/.well-known/xregistry`)?
