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
