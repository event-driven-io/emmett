# Projection schemas: Q&A

Brainstorm log for adding schemas to projections: MongoDB inline projections first, then Pongo and the other projection types. It builds on the message schemas spec in [../spec.md](../spec.md). Each answer quotes Oskar verbatim, followed by the decision as interpreted.

## Initial idea (verbatim)

> read @schema-research/spec.md and the issue https://github.com/event-driven-io/emmett/issues/424
>
> and this discussion
>
> _----
>
> red_man0 [NVIM],  — 27.10.2026 14:07
> ...1 year later
>
> Finally upgraded to mongo 8, so should be able to make use of some of the features added that we couldn't before.
> Just made this issue: https://github.com/event-driven-io/emmett/issues/424. Not sure if it should be more generic on the inline projection options for emmett globally, but it's probably only an issue for schema-less DBs
>
> I'd imagine that you're forced to do this for SQL implementations
>
> Oskar Dudycz — 27.10.2026 15:17
> Wow, welcome my friend 🙂
> how was this year? I'm curious your lessons learned from using Emmett 🙂
> Regarding Schema, I'd be much more inclined to start with JSon Schema, I have initial idea for Emmeett message types, we could discuss that for Mongo, the base idea would be the same.
> https://github.com/event-driven-io/emmett/blob/schema_research/schema-research/spec.md
> Also @thiagomini ☝️ I'd be also grateful for your thoughts.
>
> red_man0 [NVIM],  — 27.10.2026 18:15
> Things are going really well w/ emmett, our team is definitely getting well accustomed to an event-sourced architecture for our models using it.
>
> red_man0 [NVIM],  — 28.10.2026 00:08
> This sounds like it'll help a ton! I feel like allowing schemas for inline projections for implementations like Mongo would be a natural extension of this
>
> Oskar Dudycz — 28.10.2026 10:03
> Yes, I think that'd be imho the related stuff, especially that I also need it for Pongo, for similar reasons as in Mongo, but also to be able to e.g. do query optimisation. Could you expand on the use cases in which you're using mongoose and its schema capabilities? I saw they can also generate code behind the scenes.
> I'm asking mostly to see if we'd need to support mongoose client instead of the regular mongo
>
> Oskar Dudycz — 28.10.2026 10:04
> Happy to hear that. Maybe we could catch up via call to discuss what's new etc? 🙂
> Have you checked already v0.43.0? THere are some nice stuff there like async consumers, workflows etc.
>
> Oskar Dudycz — 28.10.2026 10:05
> Does it mean that you can now also use oplog and trandsactions? 🙂
>
> red_man0 [NVIM],  — 29.10.2026 00:12
> I'd definitely love to chat sometime. Unfortunately, still not using replica sets / oplog so that's a bummer. We have been wanting to start looking at the workflow processor stuff you've been working on though since it sounds awesome.
>
> For schema/mongoose stuff: we can probably just extend the inline projections to accept a JSON schema for projections, I don't necessarily need mongoose-specific support.
>
> We mostly just use mongoose for schema management and field-casting on saves. It has some other stuff like write/read hooks, but we've pretty much banned usage of that for our team.
> Any mongoose schemas / models for projections would just use features that could be done with JSON schemas as well / not just mongoose.
>
> Oskar Dudycz — 29.10.2026 18:59
> Understood 👍  I think then that the schema package will need to go first.
> I'll probably make the linked spec an RFC, maybe other folks will also comment, as it's a recurring question.
> Also in relation to what I posted on general having schema opens a lot of other options, like UI, code generation, etc.
>
> ---
>
> Check mongodb schema and mongoose and discuss how could we enhance this to enable also it for Mongodb projections but also accordingly for Pongo/Dumbo and other projections

## Research reports

- [MongoDB, Mongoose, and today's MongoDB and Pongo projections](findings.md)
  - [Who converts values: how others do it](findings.md#7-who-converts-values-how-others-do-it), for Q2
  - [Registering extra types at setup](findings.md#8-registering-extra-types-at-setup-how-its-done-today), for Q2a and Q3
  - [How people mark `ObjectId` fields when using Zod with MongoDB](findings.md#10-how-people-mark-objectid-fields-when-using-zod-with-mongodb), for Q3 asked again
  - [Verified by prototype](findings.md#9-verified-by-prototype): MongoDB 8.3.13 validators, Mongoose 9.11.4, Zod 4.6.5, `avsc` 5.7.9, Emmett `JSONSerializer`
- [Prototypes](prototypes/): [experiments](prototypes/experiments/) with their saved `.txt` outputs, pinned versions in [package.json](prototypes/package.json)

## Questions and answers

### Q1. What a projection schema is for

Which of these jobs belong in the first version, which later, and which are out?

1. Check in the app before Emmett writes the document. An invalid document from `evolve` would fail the append.
2. Enforce in the database. Emmett sets a MongoDB `$jsonSchema` validator on the collection; Pongo could get an equivalent through its migrations.
3. Convert values on write, as Mongoose does on save (a string to `ObjectId`, an ISO string to `Date`).
4. Convert query filter values in `projections.inline.find` / `findOne` and Pongo queries, so `{ ownerId: '64f...' }` matches a stored `ObjectId`.
5. Optimise queries (indexes, typed JSON paths in Pongo).
6. Infer the document type from the schema, as `typeof X.Type` does for messages.
7. Feed docs, UI and code generation.

Oskar (verbatim):

> For MongoDb the bare minimum is to allow setting the MongoDB schema for collections used in projections, the tricky part would be to do it on inline projections as they're nested inside the stream document.
>
> For Pongo as the first step what in Mongo. But later it should make it possible to have better, optimised queries.
>
> Also yes to upcasting/downcasting on read similarily to events and already existing mechanism.
>
> Also yes, infering and we should probably merge it with dumbo and pongo schema, right? We can use those schemas to translate to sql definitions.
>
> We could also get query builder for Dumbo.
>
> I'd like to also have eventually the code generatioon for serializers to be optimised knowing what's biging, what's date.
>
> Validation on save/read also, but opt-in

Answer to Oskar's question ("merge it with dumbo and pongo schema, right?"), from the Dumbo 0.13.0-rc.1 and Pongo 0.17.0-rc.1 typings:

- Dumbo's `dumboSchema.table(name, { columns, primaryKey, indexes, relationships })` already describes SQL tables, and `InferTableRow` infers the TypeScript row type from column tokens (`SQL.column.type.BigInteger`, `Timestamptz`, `Text`, `JSONB<T>()`, ...). Each token carries both the SQL type and the JS type, which is the mapping a schema-to-SQL translation needs (`bigint` to `BIGINT`, `Date` to `TIMESTAMPTZ`).
- A Pongo collection is a Dumbo table with fixed columns: `_id` (`Text`), `data` (`JSON<Document>`), `metadata` (`JSON<Record<...>>`), `_version` (`BigInteger`), `_partition` (`Text`), `_archived` (`Boolean`), `_created` and `_updated` (`Timestamptz`). Checked in the Pongo 0.17.0-rc.1 typings, `index-dCblFtZr.d.ts:83-228`. The document shape lives only in the `Document` generic. Nothing at runtime knows the fields inside `data`. (Corrected: I first wrote `JSONB<Document>` without checking.)
- So a document schema would fill the place that is empty today: the shape inside Pongo's `data` column, and the JSON paths its indexes point to. Dumbo's column tokens stay the layer for real SQL columns.

Decision (interpreted):

- MongoDB, first version: users can set a MongoDB schema (`$jsonSchema` validator) on the collections that projections write to. Inline projections are the hard case, because they are nested in the stream document at `projections.<name>`.
- Pongo, first version: the same as for MongoDB. Later: schemas enable better, optimised queries.
- Upcasting and downcasting on read, like events and like Pongo's existing `versioning.upcast` / `downcast`: in.
- Inferring the document type from the schema: in, merged with Dumbo and Pongo schema components, and used to produce SQL definitions.
- Later: a query builder for Dumbo.
- Eventually: generated serializers optimised by knowing which fields are `bigint` and `Date`.
- App-side validation on save and on read: in, opt-in.
- Not answered yet: converting values on write (job 3) and in query filters (job 4); docs and UI (job 7) were mentioned in the Discord thread but not here.

### Q2. Converting values on write and in query filters

A MongoDB validator with `ownerId: { bsonType: 'objectId' }` rejects a document whose `ownerId` is a string; MongoDB never converts. A filter `{ ownerId: '64f...' }` doesn't match a stored `ObjectId`. Mongoose converts on save, update and in filters. The message schemas spec keeps converting out of the schema (the serializer converts, the schema checks). Standard Schema allows output to differ from input (Zod's `z.coerce`). Users can also convert in `evolve`.

Should Emmett convert values to their stored types on write and in query filters? If so, which part should do it: the schema, a serializer or codec next to it, or something else?

Oskar (verbatim):

> I'm not sure what would be better, seems to me like schema should be definition, and codec having schema could pass it to serializer, but probably serializer would need to be also schema aware, right? How others are handling it?

Answer to Oskar's question ("How others are handling it?"), full survey in [findings.md](findings.md), section 7:

- The schema converts: Mongoose (`SchemaType.cast`, also in query filters), Ajv `coerceTypes` (JSON scalars only), and two-way codecs in Zod 4.1+ (`z.codec`), Effect (`Encoded` / `Type`) and TypeBox 1.x (`Type.Codec`). Codec functions can't be exported to JSON Schema, and Standard Schema has no `encode` yet (the Standard Codec proposal, PR #180, is open).
- A serializer or mapper converts, reading declarations on the schema: the MongoDB C# driver (`[BsonRepresentation(BsonType.ObjectId)] string Id`, also used for typed filters), Prisma (`String @db.ObjectId`, converted in ORM `where` filters but not in the pipeline builder), Drizzle (per-column `toDriver` / `fromDriver`), Dumbo (column tokens, `mapColumnToDate`), oRPC (`x-native-type` keyword in JSON Schema plus a `JsonSchemaCoercer`).
- Nobody converts: the MongoDB server and Papr, which only sets `$jsonSchema` validators on collections.
- No schema, guess from the value: Emmett and Dumbo `JSONSerializer` today (`parseDates` converts any 24-character string shaped like an ISO date).
- Generated serializers: fast-json-stringify (from JSON Schema) and JSON Accelerator (from TypeBox). Both write only and don't validate.

So "schema as definition, codec passes it to a schema-aware serializer" matches the C# driver, Prisma, Drizzle, Dumbo and oRPC. In all of them the schema states the stored type per field as data, not as functions.

Decision: open, asked again as Q2a.

### Q2a. Where the serializer reads the stored type from

Where should the schema-aware serializer get each field's stored type?

1. From data in the schema's JSON Schema (`bsonType: 'objectId'`, `format: 'date-time'`, or an extension keyword like oRPC's `x-native-type`). Works for any library that exports Standard JSON Schema; the built-in builder would need something like `schema.objectId()`.
2. From the schema library's own codecs (Zod `z.codec`, Effect, TypeBox `Type.Codec`, Standard Codec once it lands). Emmett side only; not exportable.
3. Both: the data form by default, the library codec when present.

Plain JSON Schema has no `ObjectId` type, and Pongo stores JSON, so an `ObjectId` there would be a string anyway.

Oskar (verbatim):

> I think that we should have the basic set of schema types, but we should also allow extending them in setup, then e.g. MongoDB could plug its objectid with converters. So yes, codec for type is a good idea to be pluggable.

Oskar, added while I was researching the next question (verbatim):

> Remember that we also need to support other schemas like avro etc.

Decision (interpreted):

- There is a basic set of schema types.
- Users can add types at setup. For example, the MongoDB package plugs in an `objectId` type with its converters.
- Each type has its own codec (converters), and codecs are pluggable.
- Formats other than JSON Schema, such as Avro, must be supported too. From [findings.md](findings.md), section 8: one pluggable type then needs a representation per format, such as a JSON Schema keyword, a MongoDB `bsonType`, an Avro `logicalType` and a Dumbo SQL column token. Avro's own logical types already work this way (`avsc`: `Type.forSchema(schema, { logicalTypes: { 'timestamp-millis': DateType } })`).
- Not answered yet: whether the codecs from schema libraries (Zod `z.codec`, Effect, TypeBox `Type.Codec`) are used too.

### Q3. Where pluggable types are registered

1. A global registry (Dumbo's `dumboDatabaseDriverRegistry.register`, Mongoose's `mongoose.ObjectId.cast`).
2. Per instance (Emmett's `serialization` option, `avsc`'s `forSchema(schema, { logicalTypes })`): passed when the event store, Pongo client or Dumbo pool is created.
3. No registry: the type is an importable value carrying its codec (Zod, Effect, TypeBox), e.g. `import { objectId } from '@event-driven-io/emmett-mongodb'`.
4. A global default plus a copy per instance (Dumbo's `SQLProcessorsRegistry({ from: defaultProcessorsRegistry })`).

Oskar (verbatim):

> I think that 3 or or both, thoughts?

> I think that 3 or 2 or both, thoughts?

Answer (Oskar asked for an opinion): both, with the two splitting the work:

- Option 3 declares what a field is: `objectId()` in the schema. The TypeScript type has to come from here. A definition is built before any store exists, so a type registered on an instance (option 2) can't change what `typeof X.Type` says. Exports (JSON Schema, Avro) also work from the definition alone.
- Option 2 decides how that type is stored by a given target. One document schema can land in MongoDB, where `objectId` is a BSON `ObjectId`, and in Pongo, where it is a string inside JSON. The same split applies to `bigint` and `Date` across SQL column types and Avro logical types.
- Prior art for this split: Avro names a `logicalType` in the schema and passes its implementation when compiling (`forSchema(schema, { logicalTypes })`); the MongoDB C# driver marks the property (`[BsonRepresentation(BsonType.ObjectId)]`) and the serializer applies it; Drizzle declares the column type in the table and lets the driver codec convert.
- Cost: two places to look, and a rule is needed for a schema type with no codec on the instance. Avro falls back to the underlying type; Emmett could do the same, or fail at setup.

Oskar, added while I was writing the answer (verbatim):

> Especially that we should allow people to use Zod, right?

Answer: yes, and Zod is the strongest reason not to rely on option 3 alone. An `objectId()` value from Emmett is not a Zod schema, so it can't go inside `z.object({...})`. What Zod users can do:

- Use Zod's own types or codecs (`z.instanceof(ObjectId)`, `z.codec(...)`). These work on the Emmett side only; their functions don't reach JSON Schema or Avro.
- Mark the field with metadata, which Zod copies into its JSON Schema output: `z.string().meta({ whatever: 1234 })` gives `{ type: "string", whatever: 1234 }`, and metadata takes precedence over the keywords Zod generates (zod v4.6.5, `content/json-schema.mdx`). A codec registered on the instance (option 2) can then find the field by that keyword in the schema's Standard JSON Schema output, whichever library produced it.

So option 3 serves the built-in builder (and inference), while option 2 plus a keyword in JSON Schema is what reaches Zod, Valibot, ArkType and the others.

Decision: open, waiting for Oskar's confirmation.

Oskar, after that answer (verbatim):

> Just to doublecheck, rethink your answer ansure that you're not making things up as you go without checking with the poc code

> Tbt, I didn't even understand your answer and what you suggest I think that you were just bs me

> Ensure to keep any reserch outcomes in @schema-research/

> link it also in qa.md

What I did: wrote prototypes and ran them against MongoDB 8.3.13, Mongoose 9.11.4, Zod 4.6.5, `avsc` 5.7.9 and Emmett's `JSONSerializer` ([findings.md](findings.md#9-verified-by-prototype), section 9). Most claims held. Corrections:

- `validationLevel: 'constraint'` is rejected by MongoDB 8.3.13 ("not supported with current FCV"); I had listed it as available.
- Pongo's `data` column is `JSON<Document>`, not `JSONB<Document>` (fixed in Q1).
- A non-Zod schema inside `z.object` does type-check; it fails only at runtime. I had implied it fails outright.
- "A type registered on an instance can't change `typeof X.Type`" was my reasoning, not something I tested.

The Q3 answer above was hard to follow. It is explained again, with one example, in the reply that follows; the question stays open.

### Q3, asked again

Is this the split you want: the schema only labels what a field is (for a Zod user, `ownerId: z.string().meta({ 'x-emmett-type': 'objectId' })`), and each database package brings the converter for that label?

Oskar (verbatim):

> ownerId: z.string().meta({ 'x-emmett-type': 'objectId' }) - this seems ugly, did you check how people are using zod with MongoDb?
>
> and tbt I'm not even sure what are you checking

What I'm checking, in one sentence: when a projection document has a field like `ownerId`, how the user tells Emmett "this field is a MongoDB `ObjectId`", so the string is converted before writing and before querying.

Answer, from [findings.md](findings.md#10-how-people-mark-objectid-fields-when-using-zod-with-mongodb), section 10: I had not checked. People using Zod with MongoDB don't write the label by hand. A database-specific helper returns a Zod schema with the label inside: `zObjectId()` in `@nullix/zod-mongoose` (20,186 weekly downloads; a Zod codec from hex string to `ObjectId`, labelled in the package's own Zod registry), `zId('Company')` in `@zodyac/zod-mongoose`, `ObjectIdSchema` in `@palmetto/zod-mongoose-schema`. Only `zod-to-mongo-schema` (114 weekly) has users write `.meta({ bsonType: 'objectId' })`. All of these are small next to Mongoose itself (8,880,175 weekly).

Decision: open.

Oskar (verbatim):

> Could you stop bs me and tell me what's the conclusion and what could we do, as said, we want to support the standard schema, and thanks to that be compatible with zod, have own builder, did you even read spec? Did you even tried with the poc we have as asked?

What I did: wrote one prototype that uses only Standard Schema (`~standard.validate` and `~standard.jsonSchema`) with Zod and with the spec's `s` builder, and ran it against MongoDB 8.3.13 ([findings.md](findings.md#11-standard-schema-only-what-emmett-can-and-cant-do-with-it), section 11).

Conclusion: the label that works across libraries is the JSON Schema `format` on the field (`format: 'objectid'`). Zod writes it with `z.stringFormat('objectid', regex)`, the `s` builder with a type a plugin adds. Emmett reads it from `~standard.jsonSchema`, builds the MongoDB validator from it, and converts values with the codec registered for that format, on write, in query filters and on read. A Zod `z.codec` converts in `validate()`, but its JSON Schema loses the label, so it doesn't fit.

Decision: open.

Oskar (verbatim):

> Dude, how register? I asked you to stop bs me, right? Also how that relates to previous options 3 and 2?

Answer: registration was not designed or tested. In the prototype it is a hard-coded object keyed by format name (`mongoTypes` in `standard-schema-projection.ts`), with `bsonType`, `toStored` and `fromStored`; nothing is passed at setup. Relation to Q3: the prototype is option 2 (converters live outside the schema) with the JSON Schema `format` as the label. Option 3 for Zod, a `z.codec`, was tested and failed: the JSON Schema it exports loses the label, so the derived validator rejects its output, query filters can't be converted, and its `validate()` rejects the `ObjectId` read back. The `s` builder's `objectId()` in the prototype is option 3 only as a label, without a converter.

Decision: open.

Oskar (verbatim):

> Dude, this is not poc, this is bs, there was a poc of schema for events. ANd you just made it up

Answer: right. The previous script did not use the events PoC, and its converter map was made up. Redone on the events PoC (`prototypes/api-ergonomics`, styles `a-builtin` and `b-zod`) with the real MongoDB event store ([findings.md](findings.md#12-inline-projection-with-a-schema-on-the-events-poc-and-the-real-mongodb-event-store), section 12). The events PoC has no type registration: dates convert inside the type (`s.date()`, Zod `isoDate` codec), which is Q3 option 3. Found on the way: querying an inline projection by an `ObjectId` value finds nothing, because Emmett's filter prefixing breaks the `ObjectId`.

Decision: open.

Oskar (verbatim):

> Dude, again what's the goal, you're just bs me and monkey patching instead of focusing on goal, why are you telling that it doesn't exist and because of that you're making some claims. If it doesn't exist and it'd be good to make that happen then we need to discuss how and why. You're just focusing on monkey patching instead of the consistent design.

Answer: stepped back to the goal and described one consistent design, built from the Q1, Q2 and Q2a decisions, spec.md sections 6 and 7, and the prototype results (findings.md sections 9, 11 and 12). Summary: the schema describes the type the code sees and names non-JSON types by a JSON Schema `format`; each storage brings the codecs for those formats; Emmett runs one read, write and query flow using both. See the reply that follows for the full text.

Decision: open.

### Q4. What the code sees for a MongoDB id field

With the design above, should the code see a MongoDB id field as a hex `string`, so the same projection works in MongoDB and Pongo, or as an `ObjectId`, like Mongoose gives you?

Oskar (verbatim):

> Dude, what is this even a question, how the hell i know how mongoos does it.

Answer: the question assumed knowledge I should have brought. Mongoose gives the code an `ObjectId`: `castObject` turns the hex string into a `Types.ObjectId` (verified, [mongoose.txt](prototypes/experiments/mongoose.txt)). The trade-offs and a recommendation are in the reply that follows.

Decision: open.

Oskar, after that answer (verbatim):

> So does that mean that standard schema has just json types?

Answer, from [findings.md](findings.md#13-what-standard-schema-says-about-types), section 13: Standard Schema has no types of its own: only `validate()` at runtime, and input and output types for TypeScript. The only runtime description is Standard JSON Schema, which has only JSON types, so a `Date` or `ObjectId` can be described only by its JSON form (`string` plus `format`). Zod throws for `z.date()`, `z.bigint()` and `z.instanceof(ObjectId)`, and a codec describes only its JSON input side. Consequence for the design: if Emmett reads `format` from the input side, `validate()` must get the JSON form, so the storage codec converts between the stored value and the JSON form, not the code's value.

Oskar, after that answer (verbatim):

> ANd did you check that your proposal will actually work and how would it look like?

Answer: I had not. Built it on the events PoC and the real MongoDB event store ([findings.md](findings.md#14-the-proposed-flow-end-to-end), section 14). It works for the `s` builder and Zod: `ObjectId` and `date` stored, `string` and `Date` in code, validator derived and accepted, wrong values rejected by the codec and by MongoDB. Not working: querying through `projections.inline.findOne` (the filter-prefix bug). Not prototyped: registration, an extension point in `s`, arrays and unions, opt-in validation, upcast and downcast.

Decision: open (Q4 still open).

Oskar, after that answer (verbatim):

> Then could you prove if it works and explain me what's your actual proposal afterwards and how will it work and show me examples?

Answer: test suite in [prototypes/tests/projectionSchema.test.ts](prototypes/tests/projectionSchema.test.ts), 17 of 17 passing for the `s` builder and Zod, on MongoDB and on Pongo with SQLite ([findings.md](findings.md#15-proof-test-suite-for-the-proposed-flow), section 15). Breaking the `ObjectId` codec makes 10 tests fail, so they test the conversion. The proposal and examples are in the reply that follows. Two consequences found: a validator on a collection with older documents needs `validationLevel: 'moderate'` or a migration, and read validation can't be fully opt-in because `validate()` is what produces `Date`s from ISO strings.

Oskar, after that answer (verbatim):

> A custom format, here money stored as a MongoDB Decimal128: [the `getMongoDBEventStore({ ..., schema: { formats: { decimal128: ... } } })` example]
>
> I don't understand that.
>
> Validation shouldn't be enforced and it can't always add overhead. Why read can't work as it works now if someone didn't enable validation? Plus schema should be use to convert, am I correct?
>
> Also it can't be just format as, again, validation is not even merely the most important thing in adding schema. We need to have it also for other stuff explained in spec

Answer: Oskar is right that the schema should drive conversion. Conversion no longer goes through `validate()`; validation is opt-in on write and read, and without it `validate()` is never called (tested, [findings.md](findings.md#16-conversion-from-the-schema-validation-opt-in), section 16). The earlier claim that read validation can't be opt-in was wrong and is struck out in section 15. On "not just format": Emmett reads the whole JSON Schema (types, required fields, nesting, arrays, enums, descriptions), and `format` only names the types JSON lacks; how each use from the spec reads it is in the reply that follows.

Decision: conversion is driven by the schema; validation is opt-in on write and on read, with no `validate()` call when off.

Oskar, after that answer (verbatim):

> Dude, why are you asking questions if you're now contradicting yourself and you didn't tell me how do you want to fullfil what I said?

Answer: listed the contradictions and which version stands, then went through each requirement from Q1, Q2a and spec.md: how the design fulfils it, and whether it is proven by the tests or not yet. See the reply that follows. No new question asked.

Oskar, after that answer (verbatim):

> then validate and verify all assumptions

Answer: second test suite [prototypes/tests/designAssumptions.test.ts](prototypes/tests/designAssumptions.test.ts); both suites 61 of 61, each new piece broken once on purpose to check a test fails ([findings.md](findings.md#17-verifying-the-remaining-assumptions), section 17). Held as claimed: validator at collection creation, `collMod` for existing collections, one validator for all inline projections, strict and moderate with old documents, downcast in the codec, JSON Schema export with ajv once formats are registered. Wrong and fixed in the prototype: `date-time` alone doesn't say whether the code wants a `Date` or a string (now read from the output side, checked for Zod and ArkType), the `s` builder's output side, `bigint` needing a format, MongoDB validator keywords (`integer`, `exclusiveMinimum`, `const`, `pattern`, `additionalProperties`), filters with operators, schema version for the upcaster, and `integer` to Dumbo `BigInteger` (it is `Integer`). Shown for the first time: Avro, Dumbo columns on SQLite, generated converter (1.3 to 6 times faster), ArkType. Conflicts: downcast against the derived validator, spec sections 6 and 7 against schema-driven conversion. Not verified: format registration on the store, a Pongo database-side check, PostgreSQL DDL, Valibot and Effect.

Oskar, after that answer (verbatim):

> I don't understand those conflicts

Answer: explained both with examples. Downcast: the code's state is `{ clientId, totalAmount }`, the downcaster stores `{ clientId, total }`, and a MongoDB validator derived from the code's schema requires `totalAmount`, so MongoDB rejects the write (test "documents the conflict"). Spec sections 6 and 7: they say `JSONSerializer` turns strings into dates and bigints and the schema only checks; the serializer guesses by looking at each value, so a field typed `string` that holds `"2026-10-31T10:00:00.000Z"` comes back as a `Date` (checked with `JSONSerializer.deserialize(..., { parseDates: true, parseBigInts: true })`), while the projection design converts only the fields the schema marks. No question asked.

Oskar, after that answer (verbatim):

> Didn't we agree that serializer should be schema aware? Also similar downcast and upcast shouldn't be technical mechanism to downcast/upcast shcema?
>
> Also
>
> The validator was derived from CartSummary, so it requires totalAmount.
> MongoDB rejects the write with "Document failed validation".
>
> Where does it happen?
>
> What's your suggestion?
>
> Also how do we support multiple schema version? We need that also for messages to be consistent and organised, currently that's dispersed

Answer: yes, a schema-aware serializer was agreed in Q1 and Q2a; spec.md sections 6 and 7 are older and only need updating, which keeps the Q19/Q20 flow (deserialize, upcast, check) and swaps the guessing serializer for the schema-aware one. Upcast and downcast should map between schema versions, each version having its own schema; the prototype's downcast has no schema for what it returns, which causes the validator conflict. The rejection happens in MongoDB, on the single `updateOne` in `appendToStream` (`src/packages/emmett-mongodb/src/eventStore/mongoDBEventStore.ts:479`) that pushes the events and sets the inline projection, so the events aren't appended either. Suggested one versioned definition for messages and documents, listing each version's schema with its upcast and downcast; listed where versioning lives today. Not prototyped yet.

Oskar, after that answer (verbatim):

> I assume that this upcast and downcast should be optional?
>
> ALso why do you define version outside of versions?
>
> Dude, rethink and make it consistent, this seems weird in general, and I think that you're again making things up and try to monkey patch instead of come up with consistent design. Also for message versioning. This should be the general concept, you should also check how others are handling that

Oskar, after I started reading .NET and JVM sources (verbatim):

> Dude, are you fng kidding me with checking non-ts code? I'm asking about schema versionig

Answer: surveyed schema versioning in TS tools ([findings.md](findings.md#18-schema-versioning-in-the-typescript-ecosystem), section 18; sources in [../sources/versioning/](../sources/versioning/)). Yes, both are optional: upcast is needed only when old data doesn't parse with the next schema, downcast only when something must store an older version. `version` outside the list was inconsistent; the versions list alone says which is current. Suggested one concept for messages and documents: an ordered list of versions, each with its schema and optional upcast and downcast. Not prototyped.

Oskar, after that answer (verbatim):

> How will upcast from v1 to v3 be done? And if you don't know then check it

Answer: checked with a prototype and tests ([findings.md](findings.md#19-upcasting-across-several-versions-verified), section 19). A v1 document is converted with the v1 schema, upcast to v2 by v2's function, then passed to v3 as it is because v3 has none; validation on read checks the result against v3. 25 of 25 tests on MongoDB and Pongo, for the `s` builder and Zod. A tuple of versions types each `upcast` argument from the version before and requires `upcast` only when the shape changed; a map keyed by version can't type it. Messages are not tested yet.

Oskar, after that answer (verbatim):

> @ts-expect-error - we shouldn't use it

Answer: removed every `@ts-expect-error`. The cases that must not compile moved to [prototypes/tests/versionedTypes.test.ts](prototypes/tests/versionedTypes.test.ts), which compiles each snippet with the TypeScript compiler API and asserts the reported errors (6 of 6; all suites 92 of 92).

Oskar, after the status summary (verbatim):

> And you didn't answer my question about schema v1 => v3

Answer: the earlier test had no upcast on v3, so it showed only one step. Added a test where v3 has its own upcast ([findings.md](findings.md#two-upcasts-in-a-row-verified)): v1 is converted with the v1 schema, then upcast v1 -> v2, then v2 -> v3; v2 runs only v2 -> v3; writing v1 runs v3 -> v2 -> v1. There is no direct v1 -> v3 function; the only direct form would be Q31's single function.

Oskar, after the status summary (verbatim):

> Dude, wtf do you mean by ObjectId in code (Q4): should it be a hex string or an ObjectId? The PoC uses a string.
>
> I told you that you're using some detached questions and expect me to give you answer same for others

Answer: Q4 is not a decision for Oskar. Checked ([findings.md](findings.md#20-what-the-code-gets-for-an-objectid-verified), section 20): once the MongoDB codec stops turning the `ObjectId` into a string itself, the schema's output side decides, as for dates. `objectId()` or `z.stringFormat('objectid', ...)` gives a string, a Zod codec to `ObjectId` gives an `ObjectId`; MongoDB stores an `ObjectId` in both. The remaining questions will be asked one at a time with an example.

Oskar, while I was checking that (verbatim):

> Why would we do one step at a time? Isn't that an overhead?

Answer: measured ([findings.md](findings.md#21-cost-of-upcasting-step-by-step-measured), section 21): 3 steps 240 ns per document, one direct function 83 ns, one MongoDB `findOne` about 605,000 ns. Steps keep each new version to one function; direct functions need one per older version, rewritten for every new version.

Oskar, after that answer (verbatim):

> Why single function has no schemas, can't we have union type based on the schema version?

Answer: it can; my claim was wrong. Built and tested ([findings.md](findings.md#22-one-upcast-function-over-a-union-of-stored-versions-verified), section 22): with the versions list still naming each version's schema, `versioned([{ schema: V1 }, { schema: V2 }, { schema: V3 }], { upcast: (stored) => switch (stored.schemaVersion) ... })` gets `{ schemaVersion, value }` with `value` converted by that version's schema and narrowed per `case`; a missing case is a compile error. It is also the direct path, one call instead of one per step. 107 of 107 tests. Downcast for this form not done.

Oskar, after the conclusion and suggested API (verbatim):

> OK, so what's the conclusion and where are we in discussions? How your suggested api would look like?

Answer: summarised the agreed parts (Standard Schema, opt-in validation, schema-aware serializer with format codecs, `versioned` list with optional upcast and downcast, step or single-function form), showed the suggested API for projections, messages, Pongo and store `formats`, and listed three open decisions: version type, removing `version` from `Event(...)`, and rewriting spec.md sections 6 to 8.

Oskar, on the version type (verbatim):

> maybe we could align version to number always?

Answer: it fits the `versioned` list, where the version is the position (1, 2, 3). Checked what changes in today's code: `schemaVersion?: string` and `DefaultMessageSchemaVersion = '1'` in `emmett/src/typing/message.ts:76-82`; PostgreSQL and SQLite store it in a `message_schema_version TEXT NOT NULL` column and also inside the `message_metadata` JSON, which wins on read (`readStream.ts:76`); MongoDB events keep it in metadata as a string, while MongoDB projections already use a number (`mongoDBEventStore.ts:77`). Asked how old string versions should be read.

Oskar, after that answer (verbatim):

> Then why did you claim it should be number and this is the issue?

Answer: the suggested API already made the version a number (the list position, `case 1:` in the single-function form, numeric `StoredVersion` in the PoC), so asking "keep or change" was a false decision. The only real point is how events already stored with string versions are read; that is a compatibility detail of the number decision, not a reason against it.

Oskar, after that answer (verbatim):

> Ok, so are there any issues in using text value here?

Answer: no blocker, but four issues. (1) Text sorts by characters: checked in Node and SQLite, `ORDER BY` puts `'10'` before `'9'`, and `WHERE v < '10'` does not find `'9'`; this hits queries such as "find events stored below version 10", not today's code, which never compares versions. (2) The `versioned` list needs a number for the position (`schemaVersion - 1`, `slice`), so every read parses the text; `'2'`, `'02'` and `' 2'` parse to 2 but fail an equality check such as `case '2':`. (3) A `string` type accepts `'v2'` or `'2.1'`, which have no position in the list. (4) MongoDB projections already store a number, so keeping text for events leaves two types for one concept; switching projections to text breaks their stored `_metadata.schemaVersion: 1`.

Oskar, after that answer (verbatim):

> What's versioned list?

Answer: my shorthand for the array passed to `versioned([...])` in the PoC ([versionedSchema.ts](prototypes/lib/versionedSchema.ts), [versioning.test.ts](prototypes/tests/versioning.test.ts)). Each entry is one schema version: `{ schema, upcast?, downcast? }`. Its position is the version number (first entry is version 1), the last entry is the current version, and `upcast`/`downcast` convert between an entry and the one before it. Should have named it instead of using an undefined term.

Oskar, after that answer (verbatim):

> I was thinking about the semver versioning, but my concern is what will happened if there are multiple versions being handled, not only "old" and "new"

Answer: many versions in storage already work: the list can hold any number of entries and a read walks from the stored position to the last one (tests cover 1 to 3). Two cases the list does not cover: (a) several app versions running at once, where an app that knows versions 1 to 2 reads a version 3 written by a newer app and throws `Unknown schema version 3` (`versionAt`, [versionedSchema.ts:56-59](prototypes/lib/versionedSchema.ts#L56-L59)); semver's minor part could say "3 is compatible with 2, read it as 2". (b) Branches, such as a fix to 1.x released after 2.0; a linear list has no place for it. Asked which case is the concern.

Oskar, after that answer (verbatim):

> Dude, that's why we have upcast and downcast to map to newer and older versions, so I don't get "A plain number can't tell A whether v3 is safe to read as v2 or not."
>
> It doesn't have to if we have defined how to map them.
>
> Semver could be useful for mapping strategies, as if we have major then we can asume that's compatible
>
> Ok, rethink this and back to the questions

Answer: agreed, the claim was wrong. Mapping covers it: the app that knows v3 downcasts to v2 when it writes (the PoC already has `write(value, 2)`, [versionedSchema.ts:73](prototypes/lib/versionedSchema.ts#L73)), so a reader that knows only v1 to v2 never sees v3. Semver then is a mapping strategy: the same major means compatible, so no upcast or downcast is needed inside a major.

Question 1 (version value): with semver, the stored version is no longer the list position. Should each list entry declare its version as a semver string, with upcast and downcast needed only when the major changes? For example:

```ts
versioned([
  { version: '1.0.0', schema: V1 },
  { version: '1.1.0', schema: V1_1 },
  { version: '2.0.0', schema: V2, upcast, downcast },
]);
```

Stored: `"schemaVersion": "1.1.0"`.

Oskar, on Question 1 (verbatim):

> I didn't say that it has to be semver

Answer: correct, I turned an idea into a decision. Question 1 withdrawn. Semver stays a possible mapping strategy (same major means compatible), not a decision. The version stays a number, as in your earlier suggestion.

Question 2 (stored string versions): events already stored by Emmett carry the version as a string, in the metadata JSON (`"schemaVersion": "2"`) and in PostgreSQL and SQLite also in the `message_schema_version TEXT` column. Users could also have set their own values, such as `"v2"` or `"2.1"`. How should Emmett read these once the version is a number?

Oskar, on Question 2 (verbatim):

> What's the question behind the question?

Answer: converting `"2"` to `2` on read is trivial, so that is not the real question. The real one is: must Emmett read data written by earlier Emmett versions as it is, without the user running a migration? If yes, Emmett needs a rule for values that are not integers (`"v2"`, `"2.1"`). If no, the change to a number can ship with a migration step and a breaking-change note.

Question 2 (restated): must Emmett read events stored by earlier versions as they are, or can the change to a number require a migration?

Oskar, on Question 2 (verbatim):

> How other tools are setting the message and projection version? Check in the Internet for schema registries and Marten and Axon

Answer: researched, [findings.md](findings.md#23-how-other-tools-set-message-and-projection-versions-researched) section 23. Schema registries (Confluent, AWS Glue, Azure) use an integer version assigned by the registry, and the message carries a schema ID, not the version; Confluent marks breaking changes with a separate major-version property and maps across majors with UPGRADE and DOWNGRADE rules. Apicurio allows string versions. Marten has no version on events (a version is a new type name) and a `uint` projection version. Axon uses a string: `@Revision("1.0")` in 4, matched by equality; `@Event(version = "1.0")` in 5, default `0.0.1`, with missing stored versions read as `0.0.0` without a migration.

Oskar, after that answer (verbatim):

> What about kurrent?

Oskar, while I was checking that (verbatim):

> WHy axon then use semver?

Answer: [findings.md](findings.md#24-kurrent-and-whether-axon-uses-semver-researched) section 24. Kurrent: no version field in KurrentDB; KurrentDB 26 has a schema registry used by the Surge SDK. A record carries a schema name; compatible changes are new registry versions under the same name, checked by compatibility modes; breaking changes get a new name (`order.shipped.v2`) with one upcast per hop. Axon: it does not use semver, only a semver-looking default. The version is any non-blank string without `#`, nothing parses or compares it, and matching is exact or a user-written predicate such as `startsWith("0.")`. No reason is documented; Axon 4 already took revisions from the Maven project version.

Oskar, after that answer (verbatim):

> How do tej detect compatible from breaking?

Answer: [findings.md](findings.md#25-how-tools-tell-compatible-from-breaking-changes-researched) section 25. Registries (Confluent, Kurrent) diff the new schema against the previous one (or all previous ones) at registration, by rules per compatibility mode: required fields, removed fields, type changes. A failing check rejects the version; it is never accepted as "breaking". Starting a breaking line is the user's decision: a new major-version property (Confluent) or a new schema name (Kurrent). Marten and Axon do not check; the user decides.

Oskar, after that answer (verbatim):

> you said, that Axon and Marten knows if it's breaking or not

Answer: I wrote "Confluent, Kurrent and Marten all separate compatible changes from breaking ones". That was wrong for Marten: it has no version and no check; a compatible change is the same type read by a tolerant JSON deserializer, a breaking change is a new type name plus an upcaster, and the user picks which. I did not claim it for Axon, but "a same major check done by hand" could read that way: Axon does not know either; the user writes the predicate. Only the registries (Confluent, Kurrent) check, and they only reject.

Oskar, after that answer (verbatim):

> ok, so now we're back to our case, we don't have yet schema registry, we'll probably have it at some point, but what's your thought on numeric vs semantic versioned. My guess that other shouldn't be taken into an account, thoughts?

Answer: number. (1) Without a registry nothing checks a semver label, so "same major" is a claim the user makes (Axon shows this); if Emmett skipped mapping because of it, a wrong label gives silently wrong reads. (2) The `versioned` list already gives what "same major" would: upcast is optional only where the previous version's type fits the next schema, and the compiler requires it otherwise (`Versions` type, [versionedSchema.ts:10-17](prototypes/lib/versionedSchema.ts#L10-L17); test "requires an upcast when the previous version does not fit the next schema"). That is a checked backward rule, not a label; downcast is not checked the same way. (3) A number orders without parsing; semver strings need a parser, and text order puts `"10.0.0"` before `"9.0.0"`. (4) Registries number versions with integers (Confluent, AWS Glue, Azure) and keep the major as a separate property, so a number now does not block a registry later. Projections already use a number (Marten `uint`, Emmett MongoDB). Agreed on leaving the other forms (free strings, version in the type name) out.

Oskar, after that answer (verbatim):

> Dude, the fact that we don't have registry atm is not an argument, as we need to set foundations for now.
>
> I'm not saying that we need to use semver, but I want a proper tradeoff analysis, without making things up

Answer: dropped the registry argument. Tradeoffs in [findings.md](findings.md#26-number-or-semver-for-the-version-tradeoffs-verified-where-marked) section 26, with ordering checked in JS, SQLite, PostgreSQL and MongoDB, and semver literal types checked with tsc. The deciding point: semver adds information only for a reader that meets a version newer than it knows. Asked whether such a reader should accept it without the writer downcasting.

Oskar, after that answer (verbatim):

> Ok, then let's settle projection and message version on number

Decision: the version of a message and of a projection document is a number. Semver, free strings and a version in the type name are out.

Correction: this record first also said "It is the position in the `versioned` list, starting at 1, and the last entry is the current version." Oskar did not say that. Q7 (removing old versions) makes it an open point.

### Q5. Reading versions already stored as strings

Asked: should Emmett read events already stored with a string version as they are, or can the switch to a number require a one-time migration of the stored data?

Oskar (verbatim):

> We need to keep it backward compatible, I think that recently we aligned in in v43 to be string, maybe we can rewind this? Check migrations

Answer, checked in git history, the migrations and npm:

- `schemaVersion?: string` in `CommonRecordedMessageMetadata` came with commit 2090840b ("Set an event schema version in metadata and use it in upcasting (PostgreSQL, SQLite)", 2026-10-22). It first shipped in 0.43.0-beta.54, then in 0.43.0-rc.1 and rc.2.
- The latest stable release on npm is 0.42.4. 0.43.0 is still a release candidate (rc.2, 2026-11-04). So the string type was never in a stable release.
- Before that commit, the `message_schema_version TEXT` column was written but never read. PostgreSQL wrote the literal `'1'`, with the quotes, for every event (`messages.map(() => "'1'")`). SQLite wrote the expected stream version. Metadata had no `schemaVersion`.
- Since that commit, reads take the version from the metadata JSON and use `'1'` when it is missing. They do not read the column.
- No migration changes the column. PostgreSQL migrations 0_43_0 and 0_44_0 and SQLite 0_43_0 only recreate the append function with the same `text[]` parameter. The column has been TEXT since 0.36.0 (renamed from `event_schema_version`).
- MongoDB events have no version handling; metadata is stored as given. MongoDB projections store `schemaVersion: number`, with a default of 1 (`mongoDBInlineProjection.ts:161`).

So yes, it can be rewound: change the type to `number` before 0.43.0 is final. Rows from 0.42.x and earlier have no version in metadata, so they read as 1. The column does not block this, because reads ignore it. Only rows written by 0.43.0-beta.54 or an rc with a version set by the user have a string in metadata.

Oskar, after that answer (verbatim):

> it may, but assume it's numeric

Decision: a reader may accept a string version from metadata and assumes it holds a number, so `"2"` reads as 2. Non-numeric strings such as `"v2"` get no special handling.

### Q6. Whether `Event(...)` keeps a `version` option

Asked: should `Event(...)` and `Command(...)` still accept a `version` option, or should the version come only from the `versioned` list, so a definition without a list is version 1?

Oskar (verbatim):

> Why do we need versioned helper and do we need to have explicit version?

Answer: [findings.md](findings.md#27-whether-the-versions-list-needs-a-versioned-helper-and-an-explicit-version-verified) section 27. `versioned()` returns its input unchanged; it exists only for type inference. Checked with tsc and tests: a plain array passed straight to `Event(...)` or a projection types each upcast the same way, with the same errors, so the helper is not needed. The current version comes from the list length as a literal type, so an explicit `version` is not needed for it. One limit: because the stored version is a position, old entries can never be removed from the list.

### Q7. Removing old versions from the list

Asked: should a user be able to remove old versions from the list once no stored data uses them, or do all versions stay in the list for good?

Oskar (verbatim):

> Yes, they should be able to remove them (not that I recommend it, but yes), we should probably make optional currentVersion, when we're preparing, or using the exact version, but are aware of new, right?

Decision: removing old versions is allowed (not recommended). An optional `currentVersion` is proposed for when the list already holds a newer version than the one in use: while preparing a rollout, or while using an exact version and knowing about newer ones.

Note: one number cannot cover both cases at once. With v1 removed and v4 prepared, the list is [v2, v3, v4] and `currentVersion: 3`. The same list and number also fit [v1, v2, v3] with no removal and no prepared version, so a reader cannot tell whether stored `2` is the first or the second entry. Removal needs its own anchor, for example the number of the first entry. Asked first which version's type the code works with.

### Q8. Which type the code works with when `currentVersion` is older than the last entry

Asked: with `currentVersion: 3` and v4 in the list, does the code work with the v3 type (stored v4 is downcast to v3 on read, writes store v3) or with the v4 type (writes downcast to v3, stored v4 read as is)?

Oskar (verbatim):

> the v3, thoughts on that? currentVersion definitely shouldn't be also required

Decision: the code works with the type of the `currentVersion` entry. `currentVersion` is optional; without it, the last entry is current.

My thoughts, sent with the next question:

- Reads: stored v1 and v2 upcast up to v3 and stop there; stored v4 is downcast to v3. Writes store v3.
- This is the direction Confluent calls FORWARD: "consumers using old schema can read data written with new schema" (`sources/version-values/confluent-schema-evolution.txt:53`). Confluent also says FORWARD "is harder to work with. In a sense, you need to anticipate all future changes" (line 402). Here the v4 entry and its downcast ship before the switch, so the reader does not have to anticipate anything.
- Entries after `currentVersion` then need a `downcast`; in the PoC it is always optional. Whether the type can require it from a literal `currentVersion` is not checked yet.
- Events are never rewritten, so downcasting on read loses nothing stored. Projection documents are read, evolved and written back whole (`mongoDBInlineProjection.ts:168-196`). A v3 instance that updates a document stored as v4 would write it back as v3, and the v4-only fields would be lost.

### Q9. What a `currentVersion: 3` instance does with a projection document stored as v4

Asked: when an instance with `currentVersion: 3` updates a projection document stored as v4, should it write v3 and accept the loss, upcast its v3 result to v4 and write v4, or refuse the update and fail the handler?

Oskar (verbatim):

> hmmm, what would be the least surprising? Also could we generate current event type based on current Version (so the number or non existing) and also have all versions as a separate variable?
>
> Thoughts?

Answer: [findings.md](findings.md#28-code-type-from-an-optional-currentversion-and-every-stored-version-as-its-own-type-verified) section 28. Types: yes, checked with tsc. `typeof X.Type` follows `currentVersion` (or the last entry), `typeof X.Stored` is a union of every stored version narrowed by `schemaVersion`, and entries after `currentVersion` must have a `downcast`. Least surprising: the two write options both lose v4-only fields without an error (upcasting fills defaults, it does not bring the value back). Refusing loses nothing, but in MongoDB it fails the append. Marten avoids the case by storing each projection version separately.

Oskar, after that answer (verbatim):

> Stored is a bad term, imprecise
>
> So my take: for events, currentVersion with a downcast on read works well. For projection documents, a newer stored version may be a case to keep from happening, rather than one to handle.
>
> I don't understand what do you mean.
>
> Q - that's already done in the code and outside of that discussion

Answer:

- `Stored` is imprecise because the union is every version of the message, wherever the value comes from (the event store, a queue, an HTTP request), not only what is stored. Name still open.
- What I meant: events are only read, never written back, so reading stored v4 as v3 through `downcast` changes nothing in the database. Projection documents are read, evolved and written back. If an instance at v3 meets a v4 document, each option either loses data or fails the append. So the question is not how to handle that case, but how to make sure an old instance never meets a newer document.
- Already done in the code: Pongo projections write each version to its own collection, `${collectionName}_v${version}` (`emmett-postgresql/src/eventStore/projections/pongo/pongoProjections.ts:235-236`). Out of this discussion.

### Q10. Name for the type of any version of a message

Asked: what should the type for "any version of this message" be called (for example `AnyVersion`, `AllVersions`, `Versioned`)?

Oskar (verbatim):

> Ok, so what about our discussions about current version, I don't think that's settled

Answer: not answered yet, parked. Listed what is agreed and what is open about `currentVersion`, and asked about the open part that blocks the rest: how the list says which version its first entry is after old entries are removed.

Oskar, while I was writing that answer (verbatim):

> WTF is any version of this message?

Answer: it is the type of a value before upcasting, when it can still be v1, v2 or v3 and `schemaVersion` says which. The single-function `upcast` takes it, and a `switch` on `schemaVersion` narrows `data`. It was my reading of "have all versions as a separate variable" from Q9, and may not be what Oskar meant.

### Q11. How the first remaining entry gets its version after removal

Asked: once old entries are removed, how should the definition say which version the first remaining entry is (a number on every entry, a `firstVersion` option, or placeholders for removed entries)?

Oskar (verbatim):

> Maybe we shouldn't have union or current, but user should explicitly select which version do they use?
>
> I mean we could have the Versions.All and Versions.Any or something similar for the use in upcast/downcast

Idea: no `currentVersion` and no default type on the definition. The user picks the version they work with explicitly. Something like `Versions.All` and `Versions.Any` exists for upcast and downcast. Not settled; asked where the runtime learns the picked version, because a type alone does not exist at runtime.

Oskar, after that answer (verbatim):

> No, All, should be AND, we could use it to have backward compatible downcast. Versions.1 or Versions.2 would be imho better
>
> Regarding question isn't enough to do with typing and use in evolve specific version dogether with upcast?

Answer: [findings.md](findings.md#29-picking-a-version-explicitly-without-currentversion-verified) section 29. `Versions.2` is a syntax error; `Versions[2]` works. Typing plus one user-written upcast is enough for reads: the upcast's return type names the version and `evolve` takes that version, with no runtime number. Writes carry the number in `metadata.schemaVersion`, and the compiler makes the writer set it. The per-entry form (upcast and downcast on each list entry) still needs a runtime number, because the runtime runs the steps and has to know where to stop. `All` as AND works (a value parses with every version), but it is `never` when a field changes type. TypeScript does not narrow by `metadata.schemaVersion`, so `Any` keeps the number at the top level.

Oskar, after that answer (verbatim):

> The per-entry form isn't covered. With an upcast and downcast on each list entry, the runtime runs the steps itself, so it has to know where to stop. A type doesn't exist at runtime, so that form still needs a number. - I don't understand
>
> Same
>
> metadata.schemaVersion doesn't narrow. On TypeScript 6.0.3, switching on it leaves message.data un-narrowed ("Property 'total' does not exist"). Only a top-level field narrows. That's why Any is { schemaVersion: 1; message: Versions[1] } | { schemaVersion: 2; ... } | ....
>
> Could you stop using jargon and imprecise statements?

Answer: explained both again with examples. (1) With one small function per step, Emmett picks and runs the steps. To pick, it needs the version that `evolve` wants, but `evolve`'s parameter type is removed when TypeScript produces JavaScript (checked with tsc: `(state: number, event: V2): number => ...` becomes `(state, event) => ...`). So that number must be passed as a value. With one function written by the user, the user's code decides, so Emmett only calls it. (2) Inside `case 1:` of a `switch (event.metadata.schemaVersion)`, TypeScript still treats `event.data` as v1, v2 or v3, so `event.data.total` does not compile. With `switch (value.schemaVersion)`, where the field is directly on the switched value, TypeScript treats `data` as v1 inside `case 1:`.

Oskar, after that answer (verbatim):

> Didn't we agree to have a single upcast function?
>
> TypeScript does this when the version sits inside metadata. - why?

Answer: (1) It was not recorded as agreed. My summary ("step or single-function form") kept both, and Oskar's questions "Why would we do one step at a time? Isn't that an overhead?" and "Why single function has no schemas" pointed to one function, but I never asked for the decision. Recorded now. (2) TypeScript narrows a union only by a field that sits directly on the value being checked; TypeScript issue #18758, open since 2017 ([findings.md](findings.md#29-picking-a-version-explicitly-without-currentversion-verified) section 29).

Decision: the upcast is a single function written by the user, not one function per step. How downcast is written is not decided.

### Q12. How downcast is written

Asked: with a single upcast function, should downcast also be a single function written by the user, for example `downcast: (message: Versions[3]) => Versions[2]`?

Oskar (verbatim):

> ok, so we could add version to Event higher, right and move it from metadata, right?

Answer, checked:

- Narrowing: with Emmett's own `Event` type plus a top-level `schemaVersion` (`Event<'Confirmed', { total: number }, M> & { readonly schemaVersion: 1 }`), a `switch (event.schemaVersion)` gives `event.data` as v1 inside `case 1:`. tsc 6.0.3, no errors.
- `Event` already has one optional top-level field besides `type`, `data` and `metadata`: `kind?: 'Event'` (`emmett/src/typing/event.ts`).
- Today the version is `schemaVersion?: string` in `CommonRecordedMessageMetadata`, so it exists only on recorded messages (read from a store), not on an `Event` the code creates.
- Stores: PostgreSQL and SQLite have the `message_schema_version` column, but old rows hold wrong values there (`'1'` with quotes, or the stream version), so reads take the version from the metadata JSON. MongoDB stores `{ type, data, metadata }` built field by field (`mongoDBEventStore.ts:432-439`), so a new top-level field is dropped unless that mapping changes. KurrentDB records have only type, data and metadata, so the version has to be stored in metadata there anyway (`eventstoreDBEventStore.ts:276-296`).
- Users of 0.43.0-beta.54 and the rcs who read `event.metadata.schemaVersion` in an upcast would have to change it.

Asked whether the top-level field only changes what the code sees, with each store keeping the version where it is stored today.

Oskar, after that answer (verbatim):

> Dude, it'd be a regular part of the Event, not something accidental.

Decision: `schemaVersion` is a regular part of the `Event`, next to `type`, `data` and `metadata`, not an entry in metadata. How each store saves it is not decided.

Oskar, after my next message (verbatim):

> DUDE, WTF, I didn't say that

Answer: my record and reply added "every store saves and reads it as such, not as a metadata entry". Oskar did not say how stores save it; removed. Asked which part was wrong if it is something else.

### Q13. Whether a hand-written event must include `schemaVersion`

Asked: when an event is written by hand, without the `Event(...)` factory, must it include `schemaVersion`, or can it be left out and read as 1?

Oskar (verbatim):

> Can it be only required on the RecordedEvent? Or maybe for "Payload" we could add v1 suffix to type also? Thought? Probably we'll need that for payload?

Answer, checked in the code:

- Required only on recorded messages has a precedent: `kind` is optional on `Event` (`kind?: 'Event'`, `emmett/src/typing/event.ts`) and required on `RecordedMessage` (`message.ts:68-73`), which `ReadEvent` is. The upcast runs on recorded messages, so its `switch` gets a required field. A created event without it would be stored as 1; the `Versions[2]` types from section 29 already require `schemaVersion: 2`.
- "Payload" in Emmett today is `EventPayloadType` / `MessagePayloadType`: the stored shape when it differs from the current one (`upcasting.ts`, docs `api-reference/commandhandler.md`, "Schema versioning"). The docs example names the stored shape `ProductItemAddedV1` in TypeScript but keeps the `type` string `'ProductItemAdded'` ("The event type name stays the same across versions"), and its upcast tells versions apart by shape: `if ('productItem' in event.data)` (`handleCommandWithDecider.versioning.unit.spec.ts:15-33`).
- A suffix in the `type` string (`'ProductItemAdded.v1'`) is the version-in-type-name form that was left out earlier. It would make each version a different type for everything that filters by type, such as projections' `canHandle` lists. With a top-level `schemaVersion`, a payload union already narrows by it, so the suffix is not needed for the `switch`.

Asked whether the suffix meant the `type` string or the TypeScript type name.

Oskar (verbatim):

> nam

Read as "name": the suffix on the TypeScript type name (`ProductItemAddedV1`), as in today's docs; the stored `type` string stays `'ProductItemAdded'`.

Oskar, after I moved to the next question (verbatim):

> Why are you going to the next uestion? What did you record?

> How is it closing?! What does it settle?

Answer: it settles nothing. A TypeScript type name is the user's naming choice and is removed when TypeScript produces JavaScript, so Emmett never sees it. I was wrong to treat it as closing Q13. Still open from Q13: whether `schemaVersion` is required only on recorded messages (Oskar's question, checked as possible, not decided), and how a hand-written payload type says its version, since `Event<Type, Data, Metadata>` has no place for it.

### Q14. Whether `schemaVersion` is required on `Event` or only on recorded messages

Asked: must `schemaVersion` be required only on recorded events (optional on `Event`, like `kind`), or required on both?

Oskar (verbatim):

> Dude, I'd say that only for Recorded, but you need to double check

Answer: checked, [findings.md](findings.md#30-schemaversion-required-only-on-recorded-messages-verified-where-marked) section 30. It works in the types: recorded messages narrow fully, and plain events compile without it. Two catches. (1) The `kind` precedent is only a type promise: MongoDB returns recorded events without `kind` (verified at runtime), and KurrentDB's mapping does not set it either (read from code). So every driver must set `schemaVersion` on read, with a test per driver. (2) A v2-shaped event without `schemaVersion` compiles, so the store saves its default for it.

### Q15. What the store saves when an appended event has no `schemaVersion`

Asked: when an event is appended without `schemaVersion`, should the store save 1, or should the append fail?

Oskar (verbatim):

> > Catch 1: kind is required only on paper. RecordedMessage marks kind as required, but not every store sets it:
>
> Then this is a bug that needs to be fixed.
>
> Catch 2 - I don't understand where v2 did come from
>
> what should the store save: 1, - can it be the latest version?

Answer:

- `kind` missing on MongoDB (and, from the code, KurrentDB) recorded events: a bug to fix, separate from this design. Asked whether to open an issue or fix it in its own change.
- V2 was a type I wrote by hand in the check: `type V2 = Event<'Added', { totalAmount: number }> & { readonly schemaVersion?: 2 }`, a second version of the same event. Because the field is optional, an object of that type compiles without it, so nothing stops code from appending a v2 event with no version.
- Latest version: the store gets only the plain object (`{ type, data, metadata }`). TypeScript types are removed at runtime, so for hand-written types nothing at runtime knows which version is the latest. With `Event(...)` definitions, the definition knows it (the length of its list), but the message spec says event stores do not know about definitions in the first version (spec.md section 8). So the store can save the latest version only if it is given the definitions, or if the factory already set it on the event.

Oskar, after that answer (verbatim):

> Dude, wtf is this syntax Event<'Added', { totalAmount: number }> & { readonly schemaVersion?: 2 };?
>
> It's artificial, and obviously if you set schemaVersion to not required then it'll allow to pass 2
>
> I don't think that 1 is a good choice, people will accidentally forget it imho. I also don't want to force store for that. Definitely we can provide schema to command handler, thoughts?

Decisions: no default of 1 for an appended event without `schemaVersion`. The event store is not required to know the definitions for this. Proposal: give the definitions to the command handler.

Answer, checked in the code:

- The intersection syntax was mine, made up for the check, and the result was obvious. Not an API.
- The command handler already takes `schema: { versioning: { upcast, downcast } }` (`emmett/src/commandHandling/handleCommand.ts:91-96`). It passes it to the read (`:192`) and to `appendToStream` (`:295`). So definitions there are a small addition to an existing option.
- Every event decide returns goes through the handler before the append (`eventsToAppend`, `:236-237` and `:290-295`). The handler can set the latest version from the definition, or fail when an event's type has no definition.
- Other paths append without the command handler: `handleWorkflow` (`workflows/handleWorkflow.ts:366` and `:531`, no `schema` option), the workflow processor (`workflowProcessor.ts:316`, has a `schema` option at `:50`), processors forwarding messages (`processors/processors.ts:466`), and direct `eventStore.appendToStream` calls. Events appended there would not get a version from the definitions.

Asked what should happen to events appended outside the command handler.

Oskar, after my thoughts on giving definitions to the command handler (verbatim, two messages):

> Dude, I asked you a question

> Man, they can take definitions, but schema is not mandatory, people should still be able to comfortably use it without them

Decision: the command handler (and workflows) can take definitions, but definitions are optional. Without them, Emmett works as today.

Follow-up: without definitions, nothing knows the latest version, so a hand-written event without `schemaVersion` reaches the store with no version. Data from 0.42 and earlier has none either, and reads it as 1 (Q5). Asked to confirm that a missing version without definitions is read as 1, the same as old data.
