# Projection schemas for Emmett, Pongo and Dumbo: specification

This spec describes schemas for projection documents: MongoDB projections first, then Pongo, Dumbo and the other projection types. It builds on the message schemas spec in [../spec.md](../spec.md), and both share one versioning concept ([../spec.md](../spec.md) section 8).

Every decision traces back to [qa.md](qa.md), which quotes Oskar's answers verbatim. The research is in [findings.md](findings.md), and the PoC code is in [prototypes/](prototypes/). The status of each discussed point, agreed or open, is in [spec-refinement.md](spec-refinement.md).

This spec holds only the agreed points. Everything still open is listed in section 9.

## 1. Goals

- Let users describe the document a projection writes with a schema, and get its TypeScript type from that schema (Q1).
- Use the schema to convert values between the stored form and the form the code sees (Q4).
- Let users set the database schema on the collections that projections write to (Q1).
- Support several versions of a projection document, the same way as messages (Q4).
- Keep Emmett comfortable to use without schemas, as today (Q15).

## 2. Scope of the first version

### 2.1 MongoDB

Users can set a MongoDB schema, a `$jsonSchema` validator, on the collections that projections write to (Q1).

Inline projections are the hard case. They are not in a collection of their own: they are nested in the stream document under `projections.<name>`. MongoDB writes the events and the inline projections in one `updateOne` (`emmett-mongodb/src/eventStore/mongoDBEventStore.ts:446-485`), so a validator rejection on the stream document also fails the append.

Checked in the PoC, not yet decided as the design: one validator on the stream collection can hold every inline projection, a stream with only some of them passes, and a validator on a collection with older documents needs `validationLevel: 'moderate'` or a migration ([findings.md](findings.md#17-verifying-the-remaining-assumptions) section 17).

### 2.2 Pongo

The same as for MongoDB in the first step. Later, schemas make better, optimised queries possible (Q1).

Pongo has no place for a database-side check today: its collection definition takes only `indexes`, and its columns are fixed ([findings.md](findings.md#17-verifying-the-remaining-assumptions) section 17). How the first step enforces the schema in Pongo is open (section 9).

### 2.3 Inferred types and SQL definitions

The document type is inferred from the schema (Q1). Projection schemas are merged with the Dumbo and Pongo schemas, and are used to translate to SQL definitions (Q1).

Dumbo's column tokens already pair a SQL type with a JS type (`SQL.column.type.BigInteger`, `Timestamptz`, `JSONB<T>()`), and a Pongo collection is a Dumbo table whose document shape lives only in the `Document` generic of its `data` column (Q1). A projection schema fills that gap: the shape inside `data`, and the JSON paths its indexes point to.

## 3. Schemas and conversion

- Any Standard Schema works, so Zod works, and Emmett has its own builder ([../spec.md](../spec.md) sections 5 and 6) (Q3).
- The schema is the definition. The serializer is schema aware (Q2, Q4).
- The schema is used to convert values between the stored form and the form the code sees (Q4). For example, MongoDB stores an id as an `ObjectId` and the code gets the form the schema's output side describes ([findings.md](findings.md#20-what-the-code-gets-for-an-objectid-verified) section 20).
- There is a basic set of schema types. Users can extend it at setup. For example, the MongoDB package plugs in its `objectId` type with converters. The codec for a type is pluggable (Q2a).
- Schema formats other than JSON Schema, such as Avro, are supported too (Q2a).
- Validation is not the main reason for a schema. The schema also serves the other uses in the message spec: inference, exports, docs and code generation (Q4).

How types are registered and how the schema marks a non-JSON type are open (section 9).

## 4. Validation

Validation on save and on read is opt-in (Q1). It is not enforced, and it must not add overhead when it is off. Without validation, reads work as they do today (Q4).

Checked: with validation off, Emmett does not call `validate()`, and a schema without non-JSON types gives the same result as today ([findings.md](findings.md#16-conversion-from-the-schema-validation-opt-in) section 16).

## 5. Versioning

Projection documents are versioned the same way as messages ([../spec.md](../spec.md) section 8). Today this is dispersed, and the goal is one concept (Q4).

- The version is a number (Q4).
- Each version has its own schema. Upcast and downcast map between versions, and both are optional (Q4).
- Upcasting and downcasting happen on read, like events and like the existing mechanism (Q1).
- The upcast is one function written by the user (Q11).
- Users may remove old versions. It is allowed, not recommended (Q7).
- MongoDB inline projections already store `_metadata.schemaVersion` as a number, with a default of 1 (`emmett-mongodb/src/eventStore/projections/mongoDBInlineProjection.ts:161`) (Q5).
- Pongo projections already write each projection version to its own collection, `${collectionName}_v${version}` (`emmett-postgresql/src/eventStore/projections/pongo/pongoProjections.ts:235-236`). This is out of this discussion (Q9).

## 6. Later

- A query builder for Dumbo (Q1).
- Generated serializers that know which fields are `bigint` and `Date` (Q1). In the PoC, a converter generated from the schema was 1.3 to 6 times faster per document than the generic walk ([findings.md](findings.md#17-verifying-the-remaining-assumptions) section 17).
- Optimised Pongo queries from the schema (Q1).

## 7. Rules for the implementation

- No `@ts-expect-error` (Q4). Code that must not compile is tested by compiling it with the TypeScript compiler API and asserting the reported errors, as in [prototypes/tests/versionedTypes.test.ts](prototypes/tests/versionedTypes.test.ts).

## 8. Separate issues, not opened on GitHub yet

- `eventStore.projections.inline.findOne` with an `ObjectId` filter returns `null`, because Emmett's filter prefixing breaks the `ObjectId` ([findings.md](findings.md#12-inline-projection-with-a-schema-on-the-events-poc-and-the-real-mongodb-event-store) section 12).
- `RecordedMessage` requires `kind`, but MongoDB returns recorded events without it (verified), and KurrentDB's read mapping does not set it (read from code). Oskar: "Then this is a bug that needs to be fixed" (Q15).

## 9. Open questions

Details and evidence for each are in [spec-refinement.md](spec-refinement.md) section 3.

- **Registering types:** a global registry, per instance, an importable value, or both (Q3). A hand-written label like `z.string().meta({ 'x-emmett-type': 'objectId' })` was rejected as ugly (Q3).
- **Marking non-JSON types:** the PoC uses a JSON Schema `format` with a codec per format. My proposal, not agreed; "it can't be just format" (Q4).
- **Schema-library codecs:** whether Zod `z.codec`, Effect and TypeBox `Type.Codec` are used too (Q2a).
- **Query filter values:** whether Emmett converts them in `projections.inline.find` / `findOne` and in Pongo queries (Q1, Q2).
- **Pongo database-side check:** how the first step enforces the schema in Pongo.
- **Downcast and the derived validator:** a validator derived from the code's schema rejects a downcast document ([findings.md](findings.md#17-verifying-the-remaining-assumptions) section 17).
- **A newer stored version:** what an instance does with a projection document stored at a version newer than the one it works with. Every option loses data or fails the append (Q9).
- **Versioning points shared with messages:** `currentVersion` versus picking a version explicitly, names for `Any` and `All`, the downcast form and the removal anchor ([../spec.md](../spec.md) section 15).
