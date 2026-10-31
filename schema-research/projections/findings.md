# Projection schemas: findings

Research behind [qa.md](qa.md). It covers how MongoDB and Mongoose handle schemas, and what Emmett's MongoDB and Pongo projections look like today.

## 1. The request (issue #424 and the Discord thread)

Source: https://github.com/event-driven-io/emmett/issues/424

- red_man0's team uses Mongoose models for most collections and Emmett inline projections for the rest.
- The pain point is casting, not only validation: "Mongoose schemas will do type casting when you try to save/update documents with types that don't match the schema which is especially helpful for dealing with `string` vs. `ObjectId` types". Without it, "some collections where sometimes values are stored as `ObjectId`'s and sometimes `string` which makes queries problematic".
- Proposed API: `mongoDBInlineProjection({ canHandle, evolve, mongooseSchema: schema })`, with JSON Schema as a possible alternative because Mongoose has `schema.toJSONSchema`.
- Backfill of existing data is optional: "I can also do that myself with a migration".
- In the Discord thread, red_man0 said Mongoose itself isn't needed: "we can probably just extend the inline projections to accept a JSON schema for projections, I don't necessarily need mongoose-specific support", and "We mostly just use mongoose for schema management and field-casting on saves". Read and write hooks are banned in their team.
- Still on MongoDB without replica sets, so no oplog and no transactions.

## 2. MongoDB schema validation

Source: MongoDB manual, `$jsonSchema` and `collMod` pages (https://github.com/mongodb/docs, `reference/operator/query/jsonSchema.txt`, `reference/command/collMod.txt`, `core/schema-validation/update-schema-validation.txt`).

- A collection gets a `validator` (usually `{ $jsonSchema: {...} }`) at `createCollection` or later through `collMod`.
- `validationAction`: `error` rejects the write, `warn` logs it and allows it.
- `validationLevel`: `strict` checks every insert and update, `moderate` skips updates of documents that were already invalid. The current docs also describe `constraint`, but MongoDB 8.3.13 rejects it: "Validation level 'constraint' is not supported with current FCV" (section 9). I did not test raising the FCV.
- Existing documents are not re-checked when the validator changes. Under `strict` and `moderate`, an update to an already invalid document fails even if the update doesn't add the problem.
- The server validates and never converts. A string stays a string; the write is rejected or only logged.
- The dialect is a draft 4 subset with MongoDB extensions:
  - `bsonType` (`objectId`, `date`, `long`, `decimal`, `int`, ...) next to or instead of `type`.
  - Not supported: `$ref`, `$schema`, `default`, `definitions`, `format`, `id`, the `integer` type and unknown keywords.
  - `exclusiveMinimum` and `exclusiveMaximum` are booleans (draft 4), not numbers (draft 2020-12).
- So the draft 2020-12 output of `toJSONSchema()` in the message schemas spec (section 9) can't be passed to MongoDB as it is. `{ type: 'string', format: 'date-time' }` for dates, for example, uses `format`, which MongoDB rejects, and plain JSON Schema has no way to say `objectId`.

## 3. Mongoose

Source: https://mongoosejs.com/docs/api/schema.html, `model.html`, `tutorials/query_casting.html`, `schemaobjectid.html`.

- Casting on save and update: values are converted to the schema type (`'42'` to `42`, a 24-character hex string to `ObjectId`). A value that can't be converted gives a `ValidationError`.
- `Model.castObject(obj, { ignoreCastErrors })` does the same casting on a plain object, without a database call.
- Query filters are cast too, when the query runs: `findOne({ _id: '5cdc...', age: { $gt: '50' } })` becomes an `ObjectId` and a number. That is the other half of red_man0's problem: queries match only if the filter value has the stored type.
- `Schema.prototype.toJSONSchema()` returns plain JSON Schema (`_id: { type: 'string' }`); `toJSONSchema({ useBsonType: true })` returns MongoDB `$jsonSchema` syntax (`_id: { bsonType: 'objectId' }`). Besides types, it converts only the `enum` validator.
- `ObjectId` casting can be changed or turned off with `mongoose.ObjectId.cast(...)`.

## 4. Emmett MongoDB inline projections today

Source: `src/packages/emmett-mongodb/src/eventStore/projections/mongoDBInlineProjection.ts`, `mongoDBEventStore.ts`, `storage/mongoDBEventStoreStorage.ts`.

- `mongoDBInlineProjection({ name?, schemaVersion?, canHandle, evolve, initialState? })`.
- The projection is not stored in its own collection. It is stored inside the stream document, at `projections.<name>`, together with `_metadata` (`streamId`, `name`, `schemaVersion`, `streamPosition`). It is written through `updates.$set['projections.<name>']` in the same update as the appended events.
- Stream documents live in one collection per stream type (`emt_<streamType>`, the default), one shared collection (`emt_streams`), or a custom mapping. So a MongoDB `$jsonSchema` validator for a projection would sit on the stream collection, at the nested path `projections.<name>`, and would apply to every stream in that collection.
- The collection is created lazily; only `createIndex({ streamName: 1 }, { unique: true })` is called. No validator is set today.
- Reads go through `eventStore.projections.inline.findOne / find / count`, which prefix the user's filter with `projections.<name>.`. Filter values are passed to MongoDB as they are, without casting.
- `schemaVersion` exists on the projection and is stored in `_metadata`, but nothing reads it.

## 5. Pongo projections today

Source: `src/packages/emmett-postgresql/src/eventStore/projections/pongo/pongoProjections.ts` (SQLite has the same shape), Pongo 0.17.0-rc.1 typings in `src/node_modules/@event-driven-io/pongo/dist/index-dCblFtZr.d.ts`.

- `pongoSingleStreamProjection` and `pongoMultiStreamProjection` take `collectionName`, `version`, `canHandle`, `evolve`, `initialState?`, `getDocumentId(s)?` and `collectionOptions`.
- `collectionOptions` is Pongo's `PongoDBCollectionOptions<T, Payload>`:
  - `definition?: PongoCollectionComponent<T>`, built with `pongoSchema.collection(name, { indexes })`. Indexes: `pongoSchema.index(name, path)`, `.unique`, `.json`, `.custom(name, sql)`.
  - `schema.versioning.upcast(payload) => T` and `downcast(T) => Payload`: the stored shape and the in-memory shape can already differ.
  - `databaseSchemaName`, `errors`, `cache`.
- The projection hands its collection definition to the event store as `schema`, so migrations create the table and its indexes.
- `version > 0` gives a versioned collection name (`<collectionName>_v<version>`).
- Pongo stores the document as JSON in one column (`data`), so there is no column typing per field. Indexes on JSON paths are where field types matter for queries.
- `JSONSerializer` with `parseDates` and `parseBigInts` does the string to `Date` and `bigint` conversion on read, the same way it does in Emmett.

## 6. How this relates to the message schemas spec

Source: [../spec.md](../spec.md).

- The spec already separates checking from converting: "Dates and bigints are turned back into values by the serializer (`parseDates`, `parseBigInts`), not by the schema. The schema only checks the value." (section 7.2). Mongoose mixes both in one step.
- Standard Schema v1 allows a schema to return a different output than its input (Zod's `z.coerce`, transforms), but the built-in `schema` builder leaves out transforms (section 6).
- The shared package (`shapewright`, provisional name) is meant for Emmett and Pongo (section 3.1), and it already exports JSON Schema.

## 7. Who converts values: how others do it

For Q2. Each entry says where the conversion lives and what tells it to convert. Sources are the libraries' docs, read through Context7 on 2026-10-31, plus the earlier survey in [../findings/standard-schema.md](../findings/standard-schema.md).

### 7.1 The schema converts

- **Mongoose.** Each `SchemaType` has a `cast` function. `doc.save()`, updates, `Model.castObject()` and query filters all call it. `mongoose.ObjectId.cast(fn)` replaces or turns off the rule. Validating and converting happen in one step. (mongoosejs.com, `api/model.html`, `tutorials/query_casting.html`, `api/schemaobjectid.html`)
- **Ajv with `coerceTypes: true`.** The validator changes the data in place to match `type` (`"1"` to `1`, `"false"` to `false`). It works only between JSON scalar types, so it knows nothing about `Date`, `bigint` or `ObjectId`. Fastify uses it for query strings. (ajv `docs/guide/modifying-data.md`, `docs/coercion.md`)
- **Two-way codecs in schema libraries.** The schema carries `decode` and `encode` functions:
  - Zod 4.1+: `z.codec(z.iso.datetime(), z.date(), { decode, encode })`, `z.decode`, `z.encode`. (zod v4.6.5 `content/codecs.mdx`)
  - Effect: every schema has an `Encoded` and a `Type` side. `Schema.DateFromString` decodes and encodes. (effect.website v4, `schema/transformations`)
  - TypeBox 1.x: `Type.Codec(Type.Integer()).Decode(...).Encode(...)` with `Value.Decode` and `Value.Encode`. (typebox `docs/type/codec.md`)
- **Standard Schema** defines only `validate`, which is the decode direction. The "Standard Codec" proposal (PR #180, open since 2026-08-27) adds `encode`. Until it lands, a schema brought through Standard Schema can be decoded but not encoded in a library-neutral way. ([../findings/standard-schema.md](../findings/standard-schema.md), line 66)
- JSON Schema export drops the functions. A codec's `decode` and `encode` can't be written into JSON Schema; only one side of the shape is exported (Effect: "always projects one side of a schema").

### 7.2 A serializer or mapper converts, driven by declarations on the schema

- **MongoDB C# driver.** The class (or `BsonClassMap`) is the definition. `[BsonRepresentation(BsonType.ObjectId)] public string Id` keeps a `string` in code and stores an `ObjectId`. The BSON serializer reads the class map and converts on write and on read, and typed LINQ filters go through the same serializer. (mongodb.com/docs/drivers/csharp/current, `serialization/poco`, `serialization/class-mapping`)
- **Prisma (MongoDB).** `id String @db.ObjectId`: a `string` in TypeScript, an `ObjectId` in the database. The ORM client converts hex strings in `where` filters; the lower-level pipeline builder doesn't ("`match()` does not convert a hex string to an `ObjectId`"). (prisma.io/docs, `orm/reference/pipeline-builder`, `orm/v6/overview/databases/mongodb`)
- **Drizzle.** Each column declares its SQL type plus optional `toDriver` and `fromDriver` functions (`customType`), and a driver-level `codec` such as `'bigint'`. The table definition is the schema; conversion is attached per column. (drizzle-orm-docs, `pg/custom-types.mdx`)
- **Dumbo.** Column type tokens carry both the SQL type and the JS type (`BigInteger`, `Timestamptz`). `mapColumnToDate(column)` and `mapColumnToBigint(column)` convert result rows per column. (Dumbo 0.13.0-rc.1 typings)
- **oRPC.** The JSON Schema gets an extension keyword, `"x-native-type": "bigint"` or `"date"`, and a separate `JsonSchemaCoercer` reads it to revive values. The schema stays a plain description; the coercer does the work. ([../findings/standard-schema.md](../findings/standard-schema.md), line 240)

### 7.3 Nobody converts: validate only

- **MongoDB server** (`$jsonSchema`): rejects or warns, never converts (section 2).
- **Papr** (Plex): builds a typed schema (`types.objectId()`, `types.date()`), writes it to the collection as a `$jsonSchema` validator through `createCollection` or `collMod` (`papr.updateSchemas()`), and relies on MongoDB to validate. Its README says nothing about casting. (plexinc/papr `docs/api/schema.md`, `docs/api/papr.md`, README)

### 7.4 No schema: guess from the value

- **Emmett and Dumbo `JSONSerializer` today.** `parseDates` turns any 24-character string with `T` at index 10 and `Z` at index 23 into a `Date`. `parseBigInts` turns integers outside the safe range into `bigint`. Both are guesses from the value's shape, applied to every field (`src/packages/emmett/src/serialization/json/jsonSerializer.ts:121-160`). A string that only looks like a date is converted too, and a small `bigint` stored as a number stays a number.

### 7.5 Serializers generated from a schema

- **fast-json-stringify** (Fastify): compiles a JSON Schema draft 7 into a `stringify` function. `Date` is written with `toISOString()` for `format: 'date-time'`, `BigInt` with `toString`. Fields not in the schema are dropped unless `additionalProperties` allows them. It doesn't validate. (fastify/fast-json-stringify README)
- **JSON Accelerator** (Elysia): generates a serializer from a TypeBox schema ahead of time. It "explicitly avoids runtime type validation, assuming the provided data conforms to the schema" and recommends validating separately. (deepwiki elysiajs/json-accelerator)
- Both write only. Neither one parses.

### 7.6 What this means for Emmett

- Tools that convert reliably on both write and read, including query filters (Mongoose, the C# driver, Prisma's ORM client), all know the stored type per field from a definition.
- That declaration lives in the schema in one of two ways:
  - as functions inside the schema (codecs: Zod, Effect, TypeBox), which can't be exported to JSON Schema and have no Standard Schema `encode` yet;
  - as data on the schema (`bsonType: 'objectId'`, `@db.ObjectId`, `x-native-type`, Dumbo column tokens), which a separate serializer or mapper reads. This form survives JSON Schema export and fits code generation (section 7.5).
- MongoDB's `$jsonSchema` already has that data form for MongoDB types: `bsonType`.

## 8. Registering extra types at setup: how it's done today

For Q2a and Q3.

- **Dumbo, global registries.** `dumboDatabaseDriverRegistry.register(driverType, plugin)` adds a database driver for the whole process. SQL processors use `SQLProcessorsRegistry({ from })` with a global `defaultProcessorsRegistry`, so a registry can be copied and extended. `registerFormatter(dialect, formatter)` and `registerDefaultMigratorOptions(databaseType, options)` work the same way. (Dumbo 0.13.0-rc.1 typings, `index-C8dTE4gC.d.ts:482-500, 613, 1463, 1528-1538`)
- **Emmett, per instance.** Event stores take `serialization: { serializer?, options? }` (`JSONSerializationOptions`, `src/packages/emmett/src/serialization/json/jsonSerializer.ts:51`), passed when the store is created (`eventStore.ts:161`, `postgreSQLEventStore.ts:241`). There is no global serializer registry.
- **Mongoose, global.** `mongoose.ObjectId.cast(fn)` changes the cast rule for the whole Mongoose instance. Custom schema types are added to `mongoose.Schema.Types`.
- **Avro (`avsc`), per compiled schema.** A schema field names a `logicalType`, and its implementation is passed when the schema is compiled: `avro.Type.forSchema(schema, { logicalTypes: { 'timestamp-millis': DateType } })`. A logical type can also implement `_resolve` to read values written with another type. (github.com/mtth/avsc/wiki/Advanced-usage) The Avro specification says implementations ignore unknown logical types and fall back to the underlying type.
- **Codecs inside the schema value (Zod, Effect, TypeBox).** No registry: the type and its codec are one importable value, such as `z.codec(...)` or `Schema.DateFromString`.

So one pluggable type has a different representation in each format: a JSON Schema keyword (`format`, or an extension like `x-native-type`), a MongoDB `bsonType`, an Avro `logicalType`, and a Dumbo SQL column token.

## 9. Verified by prototype

Code and outputs: [prototypes/experiments/](prototypes/experiments/). Versions are pinned in [prototypes/package.json](prototypes/package.json): MongoDB server 8.3.13 (`mongo:8` Docker image), `mongodb` 7.7.0 (same as `emmett-mongodb`), `mongoose` 9.11.4, `zod` 4.6.5, `avsc` 5.7.9, Emmett from `src/packages/emmett`. Run with `npx tsx experiments/<name>.ts`; `npm run check` type-checks them.

**MongoDB validator** (`mongo-validator.ts`, output `mongo-validator.txt`):

- With `ownerId: { bsonType: 'objectId' }`, inserting an `ObjectId` works and inserting the same id as a string fails with "Document failed validation". Only the `ObjectId` document is stored. MongoDB doesn't convert.
- `countDocuments({ ownerId: '<hex>' })` returns 0; with `new ObjectId('<hex>')` it returns 1.
- Rejected when creating a validator: `format` ("keyword 'format' is not currently supported"), `type: 'integer'`, `$schema`, and draft 2020-12 numeric `exclusiveMinimum` (MongoDB wants a `minimum` next to it).
- `validationLevel: 'constraint'` is rejected: "not supported with current FCV".
- A validator on the stream collection at `projections.summary.ownerId`: a stream document without `projections` is accepted; `$set` of `projections.summary` with an `ObjectId` works; with a string it fails. So a validator for an inline projection can sit on the stream collection.

**Mongoose** (`mongoose.ts`, output `mongoose.txt`):

- `castObject` converts `'64f0...'` to `ObjectId`, `'42'` to `42`, and an ISO string to `Date`; `'not-an-id'` throws `ValidationError`.
- `toJSONSchema()` gives `ownerId: { type: 'string', pattern: '^[A-Fa-f0-9]{24}$' }` and `confirmedAt: { type: ['string', 'null'] }`. The fact that the field is an `ObjectId` or a `Date` is lost; only a pattern is left for the id, and nothing for the date.
- `toJSONSchema({ useBsonType: true })` gives `bsonType: 'objectId'` and `bsonType: ['date', 'null']`. MongoDB accepts both outputs as validators.

**Zod** (`zod.ts`, output `zod.txt`):

- `z.string().meta({ 'x-emmett-type': 'objectId' })` keeps the key in `z.toJSONSchema` and in `~standard.jsonSchema.input({ target: 'draft-2020-12' })`.
- `z.instanceof(ObjectId)` can't be exported: "Custom types cannot be represented in JSON Schema".
- A `z.codec` from a hex string to `ObjectId` decodes to an `ObjectId` and encodes back to the string. Its JSON Schema (input side) is only `{ type: 'string', pattern: ... }`; the conversion functions are not in it.
- A non-Zod Standard Schema placed inside `z.object({...})` type-checks (no TypeScript error), but `parse` throws: `Invalid element at key "ownerId": expected a Zod schema`.

**Avro, `avsc`** (`avro.ts`, output `avro.txt`):

- A field with `logicalType: 'object-id'` and no implementation is read back as a plain `string`.
- With `Type.forSchema(schema, { logicalTypes: { 'object-id': ObjectIdType } })`, the same field is read back as an `ObjectId`.

**Emmett `JSONSerializer` today** (`emmett-json.ts`, output `emmett-json.txt`):

- With `parseDates: true`, a field `note: '2026-10-31T10:00:00.000Z'` that was a string comes back as a `Date`, the same as the real `confirmedAt` date.
- `small: 5n` is written as `"5"` and comes back as the string `"5"` even with `parseBigInts: true`.

**Emmett MongoDB inline projection queries** (code read, `src/packages/emmett-mongodb/src/eventStore/mongoDBEventStore.ts:565-600, 770-800`): `prependMongoFilterWithProjectionPrefix` only renames keys (`ownerId` to `projections.<name>.ownerId`). Values are passed to MongoDB unchanged.

**Not verified by code**, taken from docs only: the MongoDB C# driver, Prisma, Drizzle, Papr, fast-json-stringify, JSON Accelerator and Ajv entries in section 7.

## 10. How people mark `ObjectId` fields when using Zod with MongoDB

For Q3, asked again. Packages found by web search on 2026-10-31, then downloaded with `npm pack` into `packages/` (not committed) and read. Weekly downloads are from `api.npmjs.org` for the last week before 2026-10-31. For scale: `mongoose` 8,880,175, `papr` 14,431 (its own `types.objectId()`, not Zod).

- **`@nullix/zod-mongoose` 3.6.0** (20,186 weekly, updated 2026-10-21). Users write `postId: zObjectId()`. In the source (`dist/index.js:1353-1377`), `zObjectId()` is a Zod codec: input is an `ObjectId` or a 24-character hex string, output is an `ObjectId`; `decode` calls `new Types.ObjectId(val)`, `encode` calls `val.toString()`. The helper then labels the schema with `withMongoose(schema, { type: Schema.Types.ObjectId })`, which stores the label in the package's own `z.registry()` (`dist/index.js:185`), not in Zod's global registry.
- **`@zodyac/zod-mongoose` 4.2.2** (2,618 weekly). Users write `companyId: zId('Company')`. In the source, `zId` is `z.string().refine(isValidObjectId).or(z.instanceof(Types.ObjectId))` with a private property `__zm_type = 'ObjectId'` attached. It doesn't convert; Mongoose casts later.
- **`mongoose-zod` 0.1.2** (1,768 weekly, last published 2024-02-23). Users write `mongooseZodCustomType('ObjectId')` (README, line 260).
- **`@palmetto/zod-mongoose-schema` 1.3.0** (786 weekly). Users write `z.instanceof(Types.ObjectId).register(idRegistry, { ref: 'User' })`, or the ready-made `ObjectIdSchema` (README, lines 163-193).
- **`zod-to-mongo-schema` 1.2.0** (114 weekly). Only generates a `$jsonSchema` validator from Zod. Users write `_id: z.unknown().meta({ bsonType: 'objectId' })`; using it on `z.string()` throws in strict mode (README, lines 138-177). This is the only one that uses `.meta(...)` in user code.
- **MongoDB itself** has no official Zod converter. Jira ticket NODE-7579 asks for a driver helper that turns a Zod or plain JSON Schema into a `$jsonSchema` value (https://jira.mongodb.org/browse/NODE-7579, read through search results only).

What they have in common:

- Users never write the label by hand. A database-specific helper returns a Zod schema with the label already inside (`zObjectId()`, `zId()`, `ObjectIdSchema`).
- The label is kept where the package's own converter can find it: a private Zod registry, a private property, or `.meta`. Only the `.meta` form reaches `z.toJSONSchema` output.
- The most used one also converts, through a Zod codec, so `parse` gives an `ObjectId` and `encode` gives the string back.

Not run: an attempt to install and run `@nullix/zod-mongoose` in `prototypes/` was blocked by the session's permission rules, so the behaviour above is from reading its published code, not from executing it.

## 11. Standard Schema only: what Emmett can and can't do with it

Caveat: this is a standalone script. It does not use the events PoC (`prototypes/api-ergonomics`) or the real event store, and its format-to-converter map (`mongoTypes`) is made up for the test, not taken from any existing design. Section 12 redoes the check on the events PoC.

Prototype: [prototypes/experiments/standard-schema-projection.ts](prototypes/experiments/standard-schema-projection.ts), output in [standard-schema-projection.txt](prototypes/experiments/standard-schema-projection.txt). Run against MongoDB 8.3.13 with Zod 4.6.5, `@standard-schema/spec` 1.1.0 and the spec's `s` builder from `prototypes/api-ergonomics/lib/schema.ts`.

Emmett reads only `~standard.validate` and `~standard.jsonSchema.input({ target: 'draft-2020-12' })`. No Zod-specific or builder-specific code. The projection state `{ ownerId, total }` is defined four ways: `z.string()`, `z.stringFormat('objectid', /^[0-9a-f]{24}$/)`, a `z.codec` from string to `ObjectId`, and `s` with an `objectId()` type that a plugin adds. `evolve` produces `ownerId` as a hex string. The state is written with `$set` to `projections.summary` in a stream document, as inline projections do.

Results:

- **The JSON Schema `format` is the one label that crosses libraries.** `z.stringFormat('objectid', ...)` exports `{ type: 'string', format: 'objectid', pattern: ... }`. The `s` type exports `{ type: 'string', format: 'objectid' }`. Emmett finds the field from `format` alone. The Zod codec exports only `{ type: 'string', pattern: ... }`, so Emmett can't tell it's an `ObjectId`.
- **A validator built from that JSON Schema works.** Emmett replaces `format: 'objectid'` with `bsonType: 'objectId'`, drops `$schema`, and nests it under `projections.summary`. MongoDB accepts it and rejects the string `ownerId` from `evolve`.
- **`validate()` doesn't convert, except for codecs.** Zod and `s` return the string unchanged. The Zod codec returns an `ObjectId`, but its exported JSON Schema says string, so the derived validator rejects the codec's own output.
- **Converting by format works for writes, queries and reads.** With a codec per format (`objectid`: hex string to `ObjectId` and back), the write passes the validator, a string filter `{ ownerId: hex }` matches after conversion (0 matches without it), and the stored document decodes back and passes `validate()`.
- **Reading back without decoding fails validation** for every schema: they expect a string and MongoDB returns an `ObjectId`.
- `s.object` exports `additionalProperties: false`. Emmett adds `_metadata` to the projection state, so a real validator must allow it.

## 12. Inline projection with a schema, on the events PoC and the real MongoDB event store

Prototype: [prototypes/experiments/event-store-projection.ts](prototypes/experiments/event-store-projection.ts), output in [event-store-projection.txt](prototypes/experiments/event-store-projection.txt). It uses the events from `prototypes/api-ergonomics/styles/a-builtin` (the `s` builder) and `styles/b-zod`, created with their `Event()` factories, and the local `@event-driven-io/emmett-mongodb` 0.43.0-rc.1 with `mongoDBInlineProjection` and `projections.inline.findOne`. MongoDB 8.3.13, Zod 4.6.5.

The projection `summary` keeps `{ clientId, totalAmount, confirmedAt? }`. Three variants: `s` state with `clientId` string, Zod state with `clientId` string and `confirmedAt` as the b-zod style's `isoDate` codec, and Zod state with `clientId: z.instanceof(ObjectId)` where `evolve` does `new ObjectId(...)`.

Results:

- **Dates need no conversion in MongoDB.** `confirmedAt` is stored as BSON `date` in all variants, because the event store writes the `Date` from `evolve` as is.
- **The `s` state validates what MongoDB returns.** `s.date()` accepts the `Date`.
- **The Zod state with the b-zod `isoDate` codec rejects what MongoDB returns:** `["confirmedAt"] Invalid input: expected string, received Date`. The codec expects the JSON form; MongoDB gives the `Date`.
- **Neither JSON Schema works as a MongoDB validator as is.** `s` output fails on `format`, Zod output fails on `$schema` (it also has `format` and a long `pattern`). `s.object` also sets `additionalProperties: false`, which would reject `_metadata`.
- **`z.instanceof(ObjectId)` validates the stored state but can't export JSON Schema** ("Custom types cannot be represented in JSON Schema"), so no validator can be derived from it.
- **The MongoDB event store has no serialization or type option.** `MongoDBEventStoreOptions` (`mongoDBEventStore.ts:187`) has `projections`, `storage`, `observability` and the default hooks.
- **Bug: querying a projection by an `ObjectId` value finds nothing.** `prependMongoFilterWithProjectionPrefix` walks into the `ObjectId` and renames its internal keys, so the value becomes `000000000000000000000000`. Reproduced in [projection-filter-prefix.ts](prototypes/experiments/projection-filter-prefix.ts) ([output](prototypes/experiments/projection-filter-prefix.txt)). It also mutates the caller's filter object. This happens today, without any schema.

How the events PoC handles non-JSON types: there is no registration. `s.date()` converts an ISO string to `Date` inside its own check (`api-ergonomics/lib/schema.ts`, `date`), the b-zod style uses a `z.codec` (`isoDate`), and `JSONSerializer` revives dates with `parseDates`. That is option 3 of Q3 (the type carries its conversion). The PoC has no example of option 2.

## 13. What Standard Schema says about types

Source: `@standard-schema/spec` 1.1.0 `dist/index.d.ts`. Prototype: [prototypes/experiments/standard-json-types.ts](prototypes/experiments/standard-json-types.ts), output in [standard-json-types.txt](prototypes/experiments/standard-json-types.txt), Zod 4.6.5.

- **Standard Schema v1 has no type system of its own.** It is `~standard.validate(value)`, returning `{ value }` or `{ issues }`, plus `types: { input, output }`, which exists only for TypeScript inference. The TypeScript types can be anything (`Date`, `ObjectId`), but at runtime they can't be read.
- **Standard JSON Schema is the only runtime description.** `~standard.jsonSchema.input(options)` and `.output(options)` return JSON Schema, which knows only JSON types (`string`, `number`, `integer`, `boolean`, `object`, `array`, `null`). A non-JSON type can appear only as its JSON form, for example `{ type: 'string', format: 'date-time' }`.
- **Zod throws for non-JSON types:** `z.date()`, `z.bigint()` and `z.instanceof(ObjectId)` throw on both sides ("cannot be represented in JSON Schema").
- **A Zod codec describes only its JSON side.** For `z.codec(z.iso.datetime(), z.date(), ...)`, `input` gives `format: 'date-time'` and `output` throws. So in Zod, the `format` label exists only on the input side, and `validate()` expects that input form (an ISO string), not a `Date`. This matches section 12, where the `isoDate` codec rejected the `Date` returned by MongoDB.

## 14. The proposed flow, end to end

Prototype: [prototypes/lib/projectionSchema.ts](prototypes/lib/projectionSchema.ts) (storage-agnostic part, what Emmett core would hold), [prototypes/lib/mongoDBSchema.ts](prototypes/lib/mongoDBSchema.ts) (what `emmett-mongodb` would hold), and [prototypes/experiments/schema-projection-flow.ts](prototypes/experiments/schema-projection-flow.ts), output in [schema-projection-flow.txt](prototypes/experiments/schema-projection-flow.txt). Events from `prototypes/api-ergonomics` (`a-builtin` and `b-zod`), the real `getMongoDBEventStore`, MongoDB 8.3.13, Zod 4.6.5.

The flow:

- The schema describes the value the code sees; non-JSON types carry a JSON Schema `format` (`date-time`, `objectid`). Emmett reads only `~standard.validate` and `~standard.jsonSchema.input`.
- The MongoDB part provides one codec per format, between the stored value and the JSON form (`date-time`: `Date` and ISO string; `objectid`: `ObjectId` and hex string).
- Read: stored, then JSON form by format, then `validate()`. Write: code value, then JSON form through `JSONSerializer`, then `validate()`, then stored form by format. Query: filter values by format.
- Validator: the input JSON Schema with each known `format` replaced by its `bsonType`, and `$schema`, `format`, `pattern` and `additionalProperties` removed, nested under `projections.<name>` with `null` allowed.

Results, the same for the `s` builder and Zod:

- Paths found from the JSON Schema alone: `clientId`, `confirmedAt`.
- MongoDB accepted the derived validator on the stream collection (`collMod`).
- Both appends passed the validator. The second `evolve` got the stored state read back through the codec.
- Stored BSON types: `clientId` is `objectId`, `confirmedAt` is `date`.
- The code sees `clientId` as a string and `confirmedAt` as a `Date`. The Zod `isoDate` codec works, because `validate()` now gets the ISO string.
- A string filter `{ clientId }` is converted to an `ObjectId` and matches 1 document through the collection. Through `eventStore.projections.inline.findOne` it matches nothing, because of the filter-prefix bug (section 12).
- A wrong `totalAmount` is rejected by the codec before MongoDB. A string `clientId` written directly to the collection is rejected by MongoDB.

Not covered:

- Registration: the codecs are a module constant (`mongoDBFormats`). Passing them to the event store is not prototyped; the store has no option for it.
- The `s` builder has no extension point, so `objectId()` copies `s.string()` and replaces its JSON Schema. Its check doesn't check the hex pattern.
- Format paths are found only in nested objects, not in arrays, unions or nullable types.
- The validator is set by hand with `collMod`; Emmett would set it when it creates the stream collection.
- Validation is always on; opt-in, upcast and downcast are not modelled.
- The projection helper wraps `evolve` of the existing `mongoDBInlineProjection`; in Emmett it would be an option of `mongoDBInlineProjection` itself.

## 15. Proof: test suite for the proposed flow

Tests: [prototypes/tests/projectionSchema.test.ts](prototypes/tests/projectionSchema.test.ts), run with `npm test` in `prototypes/` (Node test runner through `tsx`). MongoDB 8.3.13 on `localhost:27099`; SQLite through the local `@event-driven-io/emmett-sqlite` 0.43.0-rc.1 and `@event-driven-io/pongo` 0.17.0-rc.1 (linked from `src/`, one copy each). Code under test: [lib/projectionSchema.ts](prototypes/lib/projectionSchema.ts) (core), [lib/builder.ts](prototypes/lib/builder.ts) (`stringFormat` for the `s` builder), [lib/mongoDBSchema.ts](prototypes/lib/mongoDBSchema.ts), [lib/pongoSchema.ts](prototypes/lib/pongoSchema.ts).

Result: 17 of 17 pass, for both the `s` builder and Zod, with the `a-builtin` and `b-zod` events from the events PoC:

- MongoDB stores `clientId` as `objectId` and dates as `date`, also inside an array (`items[].addedAt`).
- `evolve` and readers get `clientId` as a string and dates as `Date`.
- Filters written as the code sees them (`{ clientId }`, `{ 'items.addedAt': iso }`) find the document; a different id finds nothing.
- With write validation on, wrong state is rejected before MongoDB.
- The derived validator rejects a string `clientId` written past the codec.
- An old stored shape (`total`) is upcast to `totalAmount` before validation.
- A format added by the user (`decimal128`) is stored as `Decimal128` and read back as a string, with `s` and with Zod.
- The same schema and the same `evolve` in a Pongo projection on SQLite store JSON strings and give the code a string id and `Date`.
- The existing bug is pinned: `projections.inline.findOne` with an `ObjectId` filter returns `null`.

Check that the tests can fail: with the `objectid` codec changed to store the string unchanged, 10 tests fail (every MongoDB test that depends on `ObjectId`); restored, 17 pass.

Found while testing:

- **Existing documents vs. a new validator.** The upcast test inserts an old document, which the strict validator rejects (`totalAmount` is required). Adding a validator to a collection that already holds older shapes needs `validationLevel: 'moderate'` or a migration.
- ~~Read validation can't be fully opt-in.~~ Wrong, corrected in section 16: conversion doesn't need `validate()`.

Still not covered: registration on the event store (formats are passed per projection), Emmett setting the validator itself, Avro, nullable fields in the `s` builder (it has no `nullable`).

## 16. Conversion from the schema, validation opt-in

Change to the prototype after Oskar's review: conversion no longer goes through `validate()`. Each storage's format codec converts between the stored value and the value the code sees (`toStored`, `fromStored`), at the paths the schema's JSON Schema marks with a `format`. Validation is opt-in on write and on read (`validation: { onWrite, onRead }`); when on, it checks the JSON form of the value (what Standard JSON Schema describes) and its output is not used.

- MongoDB `date-time`: no conversion on read, BSON keeps `Date`, as today. `objectid`: `ObjectId` to hex string and back.
- Pongo `date-time`: ISO string to `Date` by path, in place of the `parseDates` guess.

Tests: 21 of 21 pass. Added: with validation off, write and read convert correctly and `validate()` is called 0 times; an invalid stored document is returned as is with read validation off and rejected with it on.

So without validation, the cost on read is only the conversion of the fields that have a format, and a schema without non-JSON types gives the same result as today.

## 17. Verifying the remaining assumptions

Test suite [prototypes/tests/designAssumptions.test.ts](prototypes/tests/designAssumptions.test.ts), next to the first one. Both suites: 61 of 61 pass (`npm test` in `prototypes`). Each new piece of code was broken on purpose once to check that a test fails; the one gap found (a generated converter that skips arrays passed with MongoDB formats, because a `Date` stays a `Date`) was closed by running those tests with the Pongo formats too.

### Held without code changes

- A validator set with `createCollection` before the event store opens the stream collection stays in force. Emmett's `collectionFor` only calls `createIndex`, which works on an existing collection.
- `createCollection` on an existing collection fails with "already exists", so an existing stream collection needs `collMod`.
- One validator can hold every inline projection: `projections.<name>` isn't required, so a stream that has only some projections passes, and a wrong value in any of them is rejected. This also covers `SINGLE_COLLECTION` storage, where all stream types share one collection.
- With `validationLevel: 'strict'`, appending to an old stream still works, because Emmett rewrites the whole projection in the new shape after the upcaster ran. An update that leaves an old document invalid (for example `$set` on another field) is rejected. With `moderate`, that update is accepted and a new invalid document is still rejected.
- Emmett's `JSONSerializer` writes bigints as strings, so checking the JSON form works for bigint fields.
- ajv (draft 2020-12, strict) compiles the exported JSON Schema of the `s` and Zod projections and validates the JSON form, but only after `objectid` is registered as a format. Without that it throws `unknown format "objectid"`. Any JSON Schema consumer (ajv, EventCatalog, UI generators) needs the custom formats registered.
- Downcast in the codec works: the stored document has the downcast shape and reads back through the upcaster.

### Wrong or incomplete, now fixed in the prototype

- **`date-time` doesn't say what the code wants.** `z.iso.datetime()` (a string in code) and the `isoDate` codec (a `Date` in code) export the same input JSON Schema. The codec gave a `Date` to code typed as `string`. Fix: Emmett reads the output side too ([experiments/date-output-side.txt](prototypes/experiments/date-output-side.txt)). With `libraryOptions: { unrepresentable: 'any' }` Zod exports `{}` for `Date` and `bigint` and keeps `type: 'string'` for a string. ArkType does the same with `libraryOptions: { fallback: ... }` ([experiments/output-side-arktype.txt](prototypes/experiments/output-side-arktype.txt)). A path whose output side is still `type: 'string'` stays in its JSON form in code. `libraryOptions` are per library, so Emmett has to pass each library's option; other libraries are not checked.
- **The `s` builder's output side was wrong.** It exported a `Date` field as `{ type: 'string', format: 'date-time' }` on both sides. Changed in `prototypes/api-ergonomics/lib/schema.ts`: every schema has an `outputJsonSchema`, `s.date()` exports `{}` on the output side, and `object`, `array`, `optional` compose it. Nothing in the events PoC read the output side; `npm run check` there passes.
- **`bigint` needs a format.** Spec section 6 describes `schema.bigint()` as a string with a digit `pattern` only. Without a `format` Emmett can't find the field. Added `s.bigint()` with `{ type: 'string', format: 'int64', pattern: '^-?\\d+$' }`. For Zod: `z.codec(z.stringFormat('int64', /^-?\d+$/), z.bigint(), ...)`. MongoDB stores `Long`; the driver gives back a number when the value fits in 53 bits, so `fromStored` handles `Long` and number. Pongo stores a string.
- **`s.nullable()` was missing.** Added; it exports `anyOf: [inner, { type: 'null' }]`. MongoDB stores `null`, Pongo stores `null`, the code gets `null`.
- **The MongoDB validator broke on Zod keywords.** `z.int()` exports `type: 'integer'`, which MongoDB rejects. It now maps to `bsonType: ['int', 'long', 'double']` with `multipleOf: 1`, because the driver stores integers outside int32 as `double`. Draft 2020-12 numeric `exclusiveMinimum` maps to `minimum` plus `exclusiveMinimum: true`, and `const` maps to `enum`. `pattern` is now kept for fields without a known format, and MongoDB enforces it.
- **`additionalProperties: false` was dropped from the validator.** Now kept, with `_metadata` added to the projection's properties. Emmett's `_metadata` has `streamPosition` as a bigint (stored as `Long`), so it is allowed as an object, not described field by field. Zod's input side has no `additionalProperties`, so Zod projections accept unknown fields; `s` projections reject them.
- **Query filters converted only equality.** `{ placedAt: { $gte: '...' } }` passed the whole operator object to `new Date()`. Now `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in` and `$nin` values are converted. Tested on MongoDB (stream collection and plain collection) and on Pongo with SQLite, where ISO strings compare in time order.
- **The upcaster didn't get the schema version.** The PoC stripped `_metadata` before upcasting. MongoDB's `_metadata.schemaVersion` is the version that wrote the stored state, until Emmett rewrites it after `evolve`. The upcaster now gets `{ schemaVersion }`. Pongo has no schema version (`_version` is the document version), so a Pongo upcaster can only look at the shape.

### Shown for the first time

- **Avro.** An Avro schema derived from the same JSON Schema round-trips the `s` and Zod projections through avsc. Avro formats are built like storage formats: `date-time` to `timestamp-millis`, `int64` to `long`, `objectid` to `string`. avsc gives an Avro `long` as a JS number and rejects unsafe integers, so a bigint `long` type is registered; the registry doesn't apply to `{ type: 'long', logicalType }`, so timestamps stay numbers ([experiments/avro-long.txt](prototypes/experiments/avro-long.txt)). Avro has no absent field: an optional field comes back as `null`, not missing.
- **Dumbo columns.** Columns derived from the JSON Schema give a table that SQLite creates. Mapping: `string` to `Text`, `boolean` to `Boolean`, `integer` to `Integer`, `date-time` to `Timestamptz`, `int64` to `BigInteger`, `objectid` to `Text`, objects and arrays to `JSON` (the token Pongo uses for `data`; `JSONB` renders as `BLOB` in SQLite). Dumbo has no token for a number with decimals, so `number` is `'DOUBLE PRECISION'`, which works in PostgreSQL and in SQLite. Earlier I said `integer` maps to `BigInteger`: wrong, Dumbo's `BigInteger` is a JS `bigint`. PostgreSQL DDL is not run.
- **Generated converter.** A converter generated once as code from the format paths gives the same stored and code values as the generic walk, for `s` and Zod, carts and orders, MongoDB and Pongo formats. It is 1.3 to 6 times faster per document ([experiments/compiled-converter.txt](prototypes/experiments/compiled-converter.txt)); with Pongo most of the time is `new Date` and `toISOString`.
- **A third library.** ArkType works once the format is set with `.configure({ format })`; without it ArkType exports only a `pattern` for ISO dates and Emmett finds no date fields.

### Conflicts found

- **Downcast and the derived validator.** A validator derived from the code schema rejects the downcast shape (tested). With downcast, the validator has to describe the stored shape, or be off.
- **Spec sections 6 and 7.** Section 6 gives `bigint` no format, section 7 says the serializer converts dates and bigints (`parseDates`, `parseBigInts`) and the schema only checks. Both conflict with the agreed decision that the schema drives conversion. Not changed in spec.md.

### Still not verified

- Registering formats on the event store and Pongo client options. This needs a change in `emmett-mongodb` and Pongo, not a prototype next to them.
- A database-side check for Pongo. Pongo's collection definition takes only `indexes` (`pongoSchema.collection(name, { indexes })`), and its columns are fixed, so there is no place for a `CHECK` constraint today.
- PostgreSQL DDL from the Dumbo columns, Valibot and Effect Schema output sides.
- Q4 (what the code sees for an `ObjectId`) is still open; the prototype uses a hex string.
