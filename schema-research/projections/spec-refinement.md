# Projection schemas and versioning: spec refinement

This file lists what the projection schema brainstorm has agreed so far and what is still open. It refines the message schemas spec in [../spec.md](../spec.md) and does not replace it yet. Each point names the question in [qa.md](qa.md) where Oskar's answer is quoted verbatim. Evidence is in [findings.md](findings.md), and the PoC code is in [prototypes/](prototypes/).

A point is listed as agreed only when Oskar said it or confirmed it. A point that Oskar suggested and I checked, without a confirmation, is marked as such. So is a proposal of mine that later answers build on without confirming it.

## 1. Agreed: projection schemas

### 1.1 Scope of the first version

- MongoDB: users can set a MongoDB schema (a `$jsonSchema` validator) on the collections that projections write to. Inline projections are the hard case, because they are nested in the stream document under `projections.<name>` (Q1).
- Pongo: the same as for MongoDB in the first step. Later, schemas make better, optimised queries possible (Q1).
- Projection documents get upcasting and downcasting on read, like events and like the existing mechanism (Q1).
- The document type is inferred from the schema. Projection schemas are merged with the Dumbo and Pongo schemas, and are used to translate to SQL definitions (Q1).
- Validation on save and on read is opt-in (Q1). It is not enforced and must not always add overhead. Without validation, reads work as they do today (Q4 follow-up). Checked: with validation off, Emmett does not call `validate()`, and a schema without non-JSON types gives the same result as today ([findings.md](findings.md#16-conversion-from-the-schema-validation-opt-in) section 16).

### 1.2 Later

- A query builder for Dumbo (Q1).
- Generated serializers that know which fields are `bigint` and `Date` (Q1). A prototype converter generated from the schema was 1.3 to 6 times faster per document than the generic walk ([findings.md](findings.md#17-verifying-the-remaining-assumptions) section 17).

### 1.3 Schemas, types and conversion

- Emmett supports Standard Schema, so it is compatible with Zod, and it has its own builder (Q3, asked again; Q3 "we should allow people to use Zod").
- The schema is the definition. Oskar's first take: a codec that has the schema passes it to the serializer, and the serializer is schema aware too (Q2). Later confirmed: "Didn't we agree that serializer should be schema aware?" (Q4 follow-up).
- The schema is used to convert values between the stored form and the form the code sees (Q4 follow-up, "Plus schema should be use to convert, am I correct?").
- There is a basic set of schema types. Users can extend it at setup, for example the MongoDB package plugs in its `objectId` type with converters. The codec for a type is pluggable (Q2a).
- Schema formats other than JSON Schema, such as Avro, must be supported too (Q2a).
- Validation is not the most important reason for adding schemas. The schema is needed for the other uses explained in the message spec as well (Q4 follow-up, "it can't be just format").

Checked, not decisions:

- Standard Schema has no types of its own. Its only runtime description, Standard JSON Schema, has only JSON types, so a `Date` or an `ObjectId` can be described only by its JSON form, a `string` with a `format` (Q4, [findings.md](findings.md#13-what-standard-schema-says-about-types) section 13).
- What the code sees for a MongoDB id follows the schema's output side, as for dates. `objectId()` or `z.stringFormat('objectid', ...)` gives a hex string, and a Zod codec to `ObjectId` gives an `ObjectId`. MongoDB stores an `ObjectId` in both cases (Q4, [findings.md](findings.md#20-what-the-code-gets-for-an-objectid-verified) section 20).

### 1.4 Out of this discussion

- Pongo projections already write each projection version to its own collection, `${collectionName}_v${version}` (`emmett-postgresql/src/eventStore/projections/pongo/pongoProjections.ts:235-236`) (Q9).

## 2. Agreed: versions of messages and projection documents

### 2.1 One concept for messages and projections

- Messages and projection documents support several schema versions in the same way. Today this is dispersed (Q4 follow-up, "We need that also for messages to be consistent and organised, currently that's dispersed"; "This should be the general concept").
- Upcast and downcast map between schema versions. They are not a separate technical mechanism (Q4 follow-up, "downcast and upcast shouldn't be technical mechanism to downcast/upcast shcema?").
- The design sets foundations now, so a schema registry can be added later (Q4 follow-up, "we need to set foundations for now").

### 2.2 The version value

- The version of a message and of a projection document is a number (Q4, final answer). Semver, free strings and a version in the type name are out (Q4 follow-up, "My guess that other shouldn't be taken into an account").
- Whether the number is the position in the list of versions is not decided. See section 3.3.
- It must stay backward compatible (Q5). A reader may get a string version from metadata and assumes it holds a number, so `"2"` reads as 2. Non-numeric strings such as `"v2"` get no special handling (Q5).
- Oskar suggested rewinding `schemaVersion?: string` to a number. Checked: the string type came with commit 2090840b and shipped only in 0.43.0-beta.54, rc.1 and rc.2; npm's latest stable is 0.42.4. No migration touches the `message_schema_version TEXT` column, and reads take the version from the metadata JSON, so the type can change before 0.43.0 is final (Q5). The rewind was not confirmed as a decision.

### 2.3 The list of versions

- A definition lists its versions, each with its own schema. This was my proposal (Q4 follow-ups); Oskar's later answers build on it (Q7) but never confirmed it.
- Upcast and downcast are optional (Q4 follow-up, "I assume that this upcast and downcast should be optional?").
- Users may remove old versions from the list. Oskar does not recommend it, but it is allowed (Q7).
- The upcast is one function written by the user, not one function per step (Q11). This followed Oskar's questions "Why would we do one step at a time? Isn't that an overhead?" and "Why single function has no schemas, can't we have union type based on the schema version?" (Q4 follow-ups). Example from the PoC ([explicit-version-types.ts](prototypes/experiments/explicit-version-types.ts)):

```ts
const upcast = ({ schemaVersion, message }: Versions['Any']): Versions[2] => {
  switch (schemaVersion) {
    case 1:
      return { type: message.type, data: { clientId: message.data.clientId, totalAmount: message.data.total }, metadata: { schemaVersion: 2 } };
    case 2:
      return message;
    case 3: {
      const { note: _note, ...v2 } = message.data;
      return { type: message.type, data: v2, metadata: { schemaVersion: 2 } };
    }
  }
};
```

### 2.4 `currentVersion`, if it exists

- It is meant for when the list already holds a newer version than the one in use: while preparing a rollout, or while using an exact version and being aware of newer ones (Q7).
- It is optional. Without it, the last entry is the current one (Q7, Q8).
- The code works with the type of the `currentVersion` entry. With `currentVersion: 3` and v4 in the list, the code works with v3 (Q8).

Whether `currentVersion` exists at all is open, see section 3.1.

### 2.5 `schemaVersion` on the message

- `schemaVersion` is a regular part of `Event`, next to `type`, `data` and `metadata`. It is not a metadata entry (Q12).
- Oskar's choice: it is required only on recorded events, and optional on `Event` (Q14, "I'd say that only for Recorded, but you need to double check"). Checked: it works in the types. It holds at runtime only if every driver sets it on read, with a test per driver ([findings.md](findings.md#30-schemaversion-required-only-on-recorded-messages-verified-where-marked) section 30).
- An appended event without `schemaVersion` does not get 1 as a default, because "people will accidentally forget it" (Q15).
- Oskar asked whether the store could save the latest version instead. Answer: the store gets only the plain object and TypeScript types are gone at runtime, so it can only if it is given the definitions or the factory already set the version (Q15). Oskar does not want to force the store to know the definitions (Q15).
- The command handler and workflows can take definitions. Definitions are optional, and without them people can still use Emmett comfortably (Q15).

### 2.6 Bug found on the way

- `RecordedMessage` requires `kind`, but MongoDB returns recorded events without it (verified at runtime), and KurrentDB's read mapping does not set it either (read from code, not run). Oskar: "Then this is a bug that needs to be fixed" (Q15). It is separate from this design. No GitHub issue is opened yet.

## 3. Not agreed yet

### 3.1 How the code picks the version it works with

- Oskar asked whether the type for the code could come from `currentVersion` (a number, or left out), with all versions available as a separate variable (Q9). Checked: both work in the types ([findings.md](findings.md#28-code-type-from-an-optional-currentversion-and-every-stored-version-as-its-own-type-verified) section 28).
- Oskar then asked whether there should be no union and no `currentVersion` on the definition, and the user should pick the version explicitly instead (Q11). Not settled.
- Oskar's idea: `Versions.All` as the AND of all versions, for a backward-compatible downcast, and `Versions.Any` (or something similar) for upcast and downcast. `Versions.1` or `Versions.2` for one version (Q11). Checked: `Versions.2` is a syntax error, `Versions[2]` works. `All` parses with every version, but becomes `never` when a field changes type between versions. `Any` keeps `schemaVersion` at the top level, because TypeScript does not narrow a union by `metadata.schemaVersion` (TypeScript issue #18758) ([findings.md](findings.md#29-picking-a-version-explicitly-without-currentversion-verified) section 29).
- Oskar asked whether typing plus `evolve` on one version, together with the upcast, is enough (Q11). Checked: for reads, yes. The upcast's return type names the version, `evolve` takes that version, and no runtime number is needed. Writes carry the number in the message.
- Names for `Any` and `All` are open. "Stored" is rejected as imprecise, because the value can come from the event store, a queue or an HTTP request (Q9, Q10).

### 3.2 Downcast

- How downcast is written, for example one user function `(message: Versions[3]) => Versions[2]`, is not decided (Q12).

### 3.3 Removing old versions

- After old entries are removed, the definition has to say which version its first remaining entry is. With positions alone, the list `[v2, v3, v4]` looks the same as `[v1, v2, v3]`. Options asked: a number on every entry, a `firstVersion` option, or placeholders for removed entries (Q11). Not answered.

### 3.4 A version newer than the reader knows

- Oskar asked what would be least surprising (Q9). A `currentVersion: 3` instance that meets a projection document stored as v4 either loses the v4-only fields (write v3, or upcast to v4 with defaults) or fails the append (refuse). MongoDB writes events and inline projections in one `updateOne` (`mongoDBEventStore.ts:446-485`), so refusing blocks appends to that stream. How to keep an old instance from meeting a newer document is not decided.
- For events, which are never written back, downcasting on read loses nothing in the database. This was my take, not confirmed (Q9).

### 3.5 Where each store saves `schemaVersion`

Not decided (Q12). Facts from the code:

- PostgreSQL and SQLite have a `message_schema_version` column, but old rows hold wrong values there (`'1'` with quotes in PostgreSQL, the stream version in SQLite), so reads use the metadata JSON (Q5).
- MongoDB builds the stored message field by field (`mongoDBEventStore.ts:432-439`), so a new top-level field is dropped unless that mapping changes.
- KurrentDB records have only type, data and metadata, so the version has to go into metadata there (`eventstoreDBEventStore.ts:276-296`).
- MongoDB inline projections already store `_metadata.schemaVersion` as a number, with a default of 1 (`mongoDBInlineProjection.ts:161`) (Q5). Pongo documents have no schema version; `_version` is the document version ([findings.md](findings.md#17-verifying-the-remaining-assumptions) section 17).

### 3.6 Events without definitions, and appends outside the command handler

- Without definitions, nothing at runtime knows the latest version, so an event appended without `schemaVersion` reaches the store with no version. Data from 0.42 and earlier has no version either and is read as 1 today. Asked whether a missing version without definitions is read as 1, the same as old data. Not answered (Q15 follow-up).
- Events are also appended outside the command handler: `handleWorkflow` (`workflows/handleWorkflow.ts:366`, `:531`), the workflow processor (`workflowProcessor.ts:316`), processors that forward messages (`processors/processors.ts:466`) and direct `eventStore.appendToStream` calls. What happens to their version is not decided (Q15).
- How a hand-written payload type says its version is open. Oskar asked about a `v1` suffix for payload types (Q13). A suffix on the TypeScript type name (`ProductItemAddedV1`) settles nothing, because TypeScript removes type names at runtime (Q13).

### 3.7 Helper and explicit `version` on `Event(...)`

- Oskar asked why the `versioned()` helper is needed and whether an explicit version is needed (Q6), and why the version was defined outside the versions (Q4 follow-up). Not decided. Checked: a plain array passed to `Event(...)` types each upcast the same way, so the helper is not needed, and the list length gives the current version as a literal type ([findings.md](findings.md#27-whether-the-versions-list-needs-a-versioned-helper-and-an-explicit-version-verified) section 27).

### 3.8 Converting query filter values

- Whether Emmett converts filter values in `projections.inline.find` / `findOne` and in Pongo queries, so `{ ownerId: '64f...' }` matches a stored `ObjectId`, was asked in Q1 and Q2 and never decided. The PoC converts them, including `$gt`, `$in` and similar operators ([findings.md](findings.md#17-verifying-the-remaining-assumptions) section 17).

### 3.9 Registering pluggable types

- Where pluggable types are registered (a global registry, per instance, an importable value, or a global default with a copy per instance) is open. Oskar: "I think that 3 or 2 or both, thoughts?" (Q3). How registration works was never designed (Q3 asked again, "how register?").
- Whether codecs from schema libraries (Zod `z.codec`, Effect, TypeBox `Type.Codec`) are used too is open (Q2a).
- A hand-written label such as `ownerId: z.string().meta({ 'x-emmett-type': 'objectId' })` "seems ugly" (Q3 asked again). People using Zod with MongoDB use a helper that returns a Zod schema, such as `zObjectId()` ([findings.md](findings.md#10-how-people-mark-objectid-fields-when-using-zod-with-mongodb) section 10).
- The PoC marks non-JSON types with a JSON Schema `format` (`date-time`, `objectid`, `int64`) and passes a codec per format. It works for the `s` builder, Zod and ArkType on MongoDB and on Pongo with SQLite ([findings.md](findings.md#15-proof-test-suite-for-the-proposed-flow) sections 15 to 17). This is my proposal, not agreed. Oskar: "it can't be just format" (Q4 follow-up). He did not understand the store-level `formats` example (Q4 follow-up).

### 3.10 Conflicts found

- A MongoDB validator derived from the code's schema rejects a downcast document. With downcast, the validator has to describe the stored shape, or be off ([findings.md](findings.md#17-verifying-the-remaining-assumptions) section 17).
- No database-side check exists for Pongo: its collection definition takes only `indexes`, and its columns are fixed ([findings.md](findings.md#17-verifying-the-remaining-assumptions) section 17).

## 4. Rules for the implementation

- No `@ts-expect-error` (Q4 follow-up, "@ts-expect-error - we shouldn't use it"). Code that must not compile is tested by compiling it with the TypeScript compiler API and asserting the reported errors, as in [prototypes/tests/versionedTypes.test.ts](prototypes/tests/versionedTypes.test.ts).

## 5. What this changes in the message spec

[../spec.md](../spec.md) is not edited yet. Once the open points above are settled, these sections need rewriting:

- Sections 4.1, 4.4 and 4.6: `version: '2'` as a string option, and the factory setting `metadata.schemaVersion`. The version is now a number and `schemaVersion` sits next to `type`, `data` and `metadata`.
- Section 6: `schema.bigint()` and `schema.date()` describe only the stored form. The PoC needs a `format` on `bigint` (`int64`) and an output side for `Date`.
- Section 7.2: the serializer guesses dates and bigints from the value (`parseDates`, `parseBigInts`), and the schema only checks. This conflicts with the schema being used to convert and with the schema-aware serializer. For example, a field typed `string` that holds `"2026-10-31T10:00:00.000Z"` comes back as a `Date` today.
- Section 8: a string version in metadata, `'1'` as the default, and an upcast map keyed by version. These conflict with the number, the top-level `schemaVersion`, no default of 1, and the single upcast function.
- Section 15: "`Command` with `schemaVersion`" stays open.

## 6. Separate issues, not opened on GitHub

- `kind` missing on recorded events in MongoDB, and in KurrentDB from the code (section 2.6).
- `eventStore.projections.inline.findOne` with an `ObjectId` filter returns `null`, because Emmett's filter prefixing breaks the `ObjectId` ([findings.md](findings.md#12-inline-projection-with-a-schema-on-the-events-poc-and-the-real-mongodb-event-store) section 12).
