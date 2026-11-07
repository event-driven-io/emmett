# Message schemas for Emmett: specification

This spec describes schema-backed message definitions for Emmett: events and commands defined once, with validation, typed factories, serialization, versioning, JSON Schema and Avro export, web framework integration and EventCatalog output. Command handlers and workflows can take definitions as an option (section 8.4). Streams get definitions later and are out of scope here.

Every decision traces back to [qa.md](qa.md), which quotes Oskar's answers verbatim. Decisions marked "projections Qn" come from the projection schemas brainstorm in [projections/qa.md](projections/qa.md), which also refined versioning for messages. The research behind it is in [findings/](findings/) and [projections/findings.md](projections/findings.md), and the compiled experiments are in [prototypes/](prototypes/) and [projections/prototypes/](projections/prototypes/). Projection schemas have their own spec, [projections/spec.md](projections/spec.md).

## 1. Goals

- Define a message once and get its TypeScript type, a typed factory, runtime validation and documentation metadata from that one definition.
- Keep today's code working unchanged. The type-only `Event<>` and `Command<>` types, the `event()` and `command()` factories, plain unions and every existing API stay as they are.
- Stay close to today's code with as little friction as possible. No grouping helpers, no classes, no build step required.
- Let users bring their own schema library through Standard Schema, and ship a small built-in one so they don't have to.
- Produce Standard JSON Schema and Avro, ready for schema registries and EventCatalog.
- Fit idiomatically into Hono, Express, Fastify and NestJS, following each framework's popular validation plugin.

## 2. Hard constraints

- Messages stay plain objects described by regular TypeScript types. No classes (Q2).
- No `any` in the public API, and functions over classes in the implementation (project rules).
- Standard JSON Schema compatibility is required (Q2).
- No dependency on TypeBox (Q23) or on Zod. Both work as user-supplied libraries.
- Validation is synchronous everywhere. A schema whose validation returns a Promise is rejected with an error (Q14, Q15).
- A build step may be offered as an optional extra, never as the only way (Q4, Q7).
- Emmett ships ESM and CJS, so `shapewright` does too.

## 3. Packages

### 3.1 `@event-driven-io/shapewright` (new, shared by Emmett and Pongo)

The name is provisional (Q35). The package starts in this repository under `src/packages/shapewright`, the way `@event-driven-io/almanac` did, and moves out later. It holds what Pongo can use as well as Emmett (Q34):

- the built-in `schema` builder (section 6),
- the Standard Schema plumbing that accepts any compatible library (section 5),
- `parse`, `safeParse` and `serialize` built on `JSONSerializer` (section 7),
- `JSONSerializer` and `JSONCodec`, moved here from Emmett and from Pongo's Dumbo, which each have a copy today (Q36),
- JSON Schema and Avro export (section 9).

### 3.2 `@event-driven-io/emmett`

Builds `Event(...)` and `Command(...)` on top of `shapewright` (section 4), plus versioning, documentation fields and test helpers. It re-exports `JSONSerializer` and `JSONCodec` from `shapewright` so existing imports keep working.

### 3.3 Web bindings

`emmett-honojs`, `emmett-expressjs` and `emmett-fastify` get the pieces described in section 10.

## 4. Defining messages

### 4.1 The definition

`Event` is both a type (unchanged) and a function (new). They share one name and one import, which TypeScript allows because types and values live in separate namespaces. Emmett exports no `Event` value today, so nothing clashes (Q8).

```ts
import { Event, schema } from '@event-driven-io/emmett';

export const ShoppingCartConfirmed = Event('ShoppingCartConfirmed', {
  data: schema.object({
    shoppingCartId: schema.string(),
    confirmedAt: schema.date(),
  }),
  metadata: schema.object({ clientId: schema.string() }),
  description: 'Shopper confirmed the cart',
});

export type ShoppingCartConfirmed = typeof ShoppingCartConfirmed.Type;
// same as Event<'ShoppingCartConfirmed', { shoppingCartId: string; confirmedAt: Date }, { clientId: string }>
```

`data` and `metadata` accept any Standard Schema: the built-in `schema`, Zod, Valibot, ArkType, Effect (wrapped with `Schema.toStandardSchemaV1`), or TypeBox through the user's own adapter. `metadata` is optional.

`Command(...)` has exactly the same API (Q22). The only difference is the metadata rule in section 4.4.

### 4.2 Getting the type

Two equivalent forms are provided (Q8):

```ts
export type ShoppingCartConfirmed = typeof ShoppingCartConfirmed.Type;
export type ShoppingCartConfirmed = InferEvent<typeof ShoppingCartConfirmed>;
```

- `.Type` exists only for the type checker. At runtime it is `undefined`.
- `InferEvent<D>` is `D['Type']`. `InferCommand<D>` is the same for commands.
- The resulting type is exactly today's `Event<...>` / `Command<...>`. Deciders, handlers, event stores and unions take it without changes.
- Unions stay plain TypeScript unions, as today (Q6):

```ts
export type ShoppingCartEvent =
  | ProductItemAddedToShoppingCart
  | ProductItemRemovedFromShoppingCart
  | ShoppingCartConfirmed
  | ShoppingCartCancelled;
```

- Emmett's `Event<>` type itself does not change (Q7). The `Event<typeof X>` form was prototyped and rejected.
- Both forms were verified to produce the same type: `prototypes/api-ergonomics/experiments/type-and-infer.ts`.

### 4.3 What a definition carries

The value returned by `Event(...)` is a function with fields attached (Q9 onwards). It's built the way the prototype does it, with `Object.assign(create, {...})` in `prototypes/api-ergonomics/lib/message.ts`.

- **Call:** the typed factory (section 4.4).
- `type`: the message type string, `'ShoppingCartConfirmed'`.
- `kind`: `'Event'` or `'Command'`.
- `Type`: the type-level message type (section 4.2).
- `data` and `metadata`: the part schemas, each a Standard Schema with `parse` and `safeParse`, for HTTP validators and plugins (Q42).
- `is(message)`: a type guard that narrows a union to this message.
- `parse`, `safeParse` and `serialize`: section 7.
- `~standard`: Standard Schema for the whole message, so a definition can be passed to any Standard Schema consumer (section 7.4).
- `toJSONSchema()` and `toAvro()`: section 9.
- `example()`: section 11.
- The documentation fields from section 4.6, readable as properties.

Field names on a definition must not be `name` or `length`. Because the definition is a function, setting them throws "Cannot assign to read only property 'name' of function" (checked with Node). `call`, `apply`, `bind` and `toString` would hide the function's own methods and must be avoided as well.

### 4.4 The factory

The factory works like today's `event()` / `command()` without the type argument, and may call them internally (Q9):

```ts
// today
event<ShoppingCartConfirmed>('ShoppingCartConfirmed', data, metadata);

// with a definition
ShoppingCartConfirmed(data, metadata);
```

Metadata rules follow today's factories (`src/packages/emmett/src/typing/event.ts:59`, `command.ts:51`):

- Event: `metadata` is required when the definition declares it, and absent when it doesn't.
- Command without declared metadata: `metadata` is optional and typed as `DefaultCommandMetadata` (`{ now: Date }`).
- Command with declared metadata: `metadata` is required.

The factory sets the message's `schemaVersion` automatically (Q30). It is a top-level field, not a metadata entry (projections Q12). See section 8.

**Validation in the factory is opt-in, per definition** (Q11, Q12):

```ts
export const ShoppingCartConfirmed = Event('ShoppingCartConfirmed', {
  data: ...,
  validate: true,
});
```

With `validate: true`, the factory checks `data` and `metadata` against their schemas and throws `ValidationError` (section 7.5) on invalid input (Q13). It stays synchronous. If the schema's `validate` returns a Promise, the factory throws (Q14).

### 4.5 Hand-written types without schemas

Hand-written types keep working exactly as today, with no schema (Q3). Writing a type by hand and then a definition checked against it was rejected because it defines the shape twice (Q7). A code generator that produces schemas from today's hand-written types may be offered later as an optional extra (Q7; `ts-json-schema-generator` worked on today's types unchanged, see [findings/type-naming.md](findings/type-naming.md)).

### 4.6 Documentation fields

`Event(...)` and `Command(...)` options accept (Q28):

- `description`: string
- `summary`: string
- `version`: a number, if the option stays; whether it does is open (section 15)
- `deprecated`: `{ message: string; date?: string }`
- `examples`: an array of example `data` values (or whole messages; see open questions)
- `owners`: string array
- `tags`: string array

They feed JSON Schema annotations, EventCatalog and the registry exports. Field mapping per tool is in [findings/tooling.md](findings/tooling.md), section 7.

## 5. Bring your own schema library

A schema is anything that implements Standard Schema v1 (`~standard.validate`). Where a schema also implements Standard JSON Schema (`~standard.jsonSchema`), JSON Schema export uses it with `target: 'draft-2020-12'` and the `input` side, which describes the stored JSON form.

What users need per library, from the prototypes in `prototypes/api-ergonomics/styles/b-*`:

- Zod, Valibot, ArkType: the schema as it is.
- Effect: `Schema.toStandardSchemaV1(schema)`.
- TypeBox: a user-side adapter, such as TypeBox's own `example/standard`. Emmett doesn't ship it. Through the adapter, type-checking one file took 3 to 6 s in the prototype.
- JSON Schema export: Zod 4.2+ and ArkType provide it themselves; Valibot and Effect need their own wrappers (`toStandardJsonSchema`, `Schema.toStandardJSONSchemaV1`). A schema without `~standard.jsonSchema` exports `{}` for that part (see open questions).

Implementation notes from the prototypes ([findings/api-ergonomics.md](findings/api-ergonomics.md), key finding 13):

- ArkType types and Effect schemas are functions, so detecting a schema must check for `~standard` on functions as well as objects.
- Issue shapes differ per library. Normalise to `{ message, path }` (section 7.5).

## 6. The built-in `schema` builder

A small builder that copies Zod 4's API, with no Zod code or dependency (Q26, Q27). It's exported as `schema` for now; the final name is open. Every schema it builds implements Standard Schema and Standard JSON Schema, and has `parse` and `safeParse`. It should stay small and simple. If it doesn't, the fallback is to let users bring their own library (Q23a).

The prototype `s` builder (`prototypes/api-ergonomics/lib/schema.ts`, 198 lines, about 4 KB minified) is the starting point.

**Types:**

```ts
schema.string()  schema.number()  schema.int()     schema.bigint()
schema.boolean() schema.date()    schema.literal() schema.enum([...])
schema.object()  schema.array()   schema.record()  schema.union([...])
schema.null()    schema.unknown() .optional()      .nullable()
```

**Formats**, top-level as in Zod 4: `schema.email()`, `schema.uuid()`, `schema.url()`.

**Checks:**

```ts
schema.string().min(1).max(100).length(10).regex(/.../)
schema.number().min(0).max(10).positive().nonnegative()
schema.array(...).min(1).max(10).nonempty()
```

**Left out:** refinements, transforms, defaults, `tuple`, `map`, `set`, `intersection` and recursive schemas. Users who need them bring their own library.

`schema.date()` and `schema.bigint()` check for a `Date` and a `bigint`. Turning stored strings back into them is the serializer's job (section 7.2). In JSON Schema they describe the stored form: `{ "type": "string", "format": "date-time" }` for dates, and a string with a digit `pattern` for bigints, since `JSONSerializer` writes bigints as strings (proposed, not discussed).

## 7. Parsing and serialization

### 7.1 Methods

- `X.parse(input, options?)`: returns the typed message, or throws `ValidationError` (Q16).
- `X.safeParse(input, options?)`: returns `{ success: true, data } | { success: false, error }`, Zod's shape. `error` is the same `ValidationError` that `parse` throws (Q17).
- `X.serialize(message, options?)`: returns a JSON string (Q21).

All three are synchronous. A schema whose validation returns a Promise makes them throw (Q15).

### 7.2 Reading flow

`parse` and `safeParse` follow the flow of today's `JSONCodec.decode` (`src/packages/emmett/src/serialization/json/jsonSerializer.ts:293-324`) and add the schema check (Q19, Q20):

1. If `input` is a JSON string, run `serializer.deserialize(input, options)`. If it's already a parsed object, skip this step. Parsing Avro input comes later.
2. Apply `upcast`: the definition's own upcast (section 8.3) and any `upcast` passed in `options` (their order is an open question).
3. Check `{ type, data, metadata }` against the definition: `type` must equal `X.type`, then `data` and `metadata` against their schemas.

`options` are the same as `JSONSerializer`'s deserialize options (`parseDates`, `parseBigInts`, `reviver`), plus `serializer` to pass a custom one, plus `upcast`.

The schema drives conversion, and the serializer is schema aware (projections Q2, Q4). The serializer turns stored values into the form the code sees, such as a `Date` or a `bigint`, for the fields the schema describes that way. It does not guess from the value. Today's `JSONSerializer` guesses: with `parseDates`, a field typed `string` that holds `"2026-10-31T10:00:00.000Z"` comes back as a `Date` (checked, [projections/findings.md](projections/findings.md#17-verifying-the-remaining-assumptions) section 17).

There is a basic set of schema types, and users can extend it at setup with pluggable codecs, for example an `objectId` type from the MongoDB package (projections Q2a). How types are registered and how a schema marks a non-JSON type are open (section 15).

### 7.3 Writing flow

`serialize` mirrors `JSONCodec.encode` and adds the check (Q21):

1. Check the message against the definition.
2. Apply `downcast` if given in `options`.
3. Run `serializer.serialize(message, options)`.

`serialize` was added for parity with `parse`. The need for it isn't proven yet.

### 7.4 What a definition validates

A definition always means the whole message (Q42). `parse`, `safeParse` and the definition's Standard Schema (`~standard`) all validate `{ type, data, metadata }`. This matches Zod, where `schema.parse(x)` returns `z.infer<typeof schema>`: here `X.parse(x)` returns `X.Type`.

To validate only a part, use the part schemas:

```ts
ConfirmShoppingCart.parse(storedJson);             // { type, data, metadata }
ConfirmShoppingCart.data.parse(requestBody);        // data only
sValidator('json', ConfirmShoppingCart.data);       // Hono
```

### 7.5 Errors

Emmett's `ValidationError` (`src/packages/emmett/src/errors/index.ts:119`) gains an `issues` list (Q18):

```ts
error.issues; // [{ message: 'Expected string, received number', path: ['data', 'shoppingCartId'] }]
```

- Each issue has only `message` and `path`, the same for every library. Vendor-specific fields (ArkType adds its whole context) are dropped.
- Paths are prefixed with `data` or `metadata`. A wrong `type` gives `path: ['type']`.
- `message` text comes from the schema library and differs between libraries.

Where the error class lives, given that `shapewright` needs it too, is an open question.

## 8. Versioning

Messages and projection documents are versioned the same way ([projections/spec.md](projections/spec.md) section 5). Today versioning is dispersed, and the goal is one concept (projections Q4). The design sets foundations now, so a schema registry can be added later (projections Q4).

This section replaces the string version (Q29) and the upcaster map (Q31) with the decisions from projections Q4 to Q15.

### 8.1 The version value

- The version is a number. Semver, free strings and a version in the type name are out (projections Q4).
- It's also used for docs, EventCatalog and the registry (Q29).
- Reading stays backward compatible (projections Q5):
  - Data from 0.42 and earlier has no version in metadata.
  - 0.43.0-beta.54, rc.1 and rc.2 store `schemaVersion` as a string in metadata (commit `2090840b`). A reader accepts a string and treats it as a number, so `"2"` reads as 2. Non-numeric strings such as `"v2"` get no special handling.
  - The `message_schema_version TEXT` column in PostgreSQL and SQLite holds wrong values in old rows (`'1'` with quotes, or the stream version), and reads don't use it.

### 8.2 `schemaVersion` on the message

- `schemaVersion` is a regular field of the message, next to `type`, `data` and `metadata`. It is not a metadata entry (projections Q12).
- It's required on recorded messages and optional on `Event` (projections Q14). So a `switch (event.schemaVersion)` in an upcast narrows `data` in each case, and the plain events `decide` returns compile without it ([projections/findings.md](projections/findings.md#30-schemaversion-required-only-on-recorded-messages-verified-where-marked) section 30).
- Every driver sets it on read, with a test per driver. A required field on the type is not enough: `kind` is required on `RecordedMessage` too, and MongoDB returns recorded events without it (projections Q15).

A recorded event, as a reader gets it:

```ts
{
  type: 'ShoppingCartConfirmed',
  schemaVersion: 2,
  data: { shoppingCartId: 'cart-1', confirmedAt: new Date('2026-11-06T10:00:00.000Z') },
  metadata: { clientId: 'client-1' },
}
```

Where each store saves the field is open (section 15).

### 8.3 Versions of a definition and upcasting

- Each version has its own schema. Upcast and downcast map between versions, and both are optional (projections Q4).
- The upcast is one function written by the user, not one function per step (projections Q11). It gets a message of any version and returns the version the code works with. Because `schemaVersion` is at the top level, a `switch` on it narrows `data` in each case:

```ts
upcast: (event) => {
  switch (event.schemaVersion) {
    case 1:
      return { type: event.type, schemaVersion: 2, data: { clientId: event.data.clientId, totalAmount: event.data.total }, metadata: event.metadata };
    case 2:
      return event;
  }
},
```

  Checked with tsc ([projections/prototypes/experiments/top-level-upcast.ts](projections/prototypes/experiments/top-level-upcast.ts)): inside `case 1:`, `event.data.totalAmount` fails with "Property 'totalAmount' does not exist". The names of the input and output types, and how the version the code works with is chosen, are open (section 15).
- Users may remove old versions from the definition. It is allowed, not recommended (projections Q7).
- `parse` applies the definition's upcast without the caller passing it.

### 8.4 Definitions in the command handler and workflows

- The command handler and workflows can take definitions. Definitions are optional, and without them people can still use Emmett comfortably, as today (projections Q15).
- An event appended without `schemaVersion` does not get 1 as a default, because people would forget to set it (projections Q15).
- The event store is not required to know the definitions (projections Q15). Its read-time `upcast` option keeps working as today. Letting stores take stream and event schemas comes later, together with the registry.

## 9. Exports and registry readiness

There's no registry integration in the first version, but the exports must be ready for one (Q32, Q33).

- `X.toJSONSchema()`: JSON Schema for the whole message, with `type` as a `const`, `data` and `metadata` from their schemas, and the documentation fields as annotations (`title`, `description`, `examples`, `deprecated`). The prototype's version is in `prototypes/api-ergonomics/lib/message.ts`.
- `X.toAvro()`: an Avro schema for the whole message. Existing converters were lossy and look unmaintained ([findings/formats-registries.md](findings/formats-registries.md), section 1.3), so this is our own mapping from the definition. Avro's JSON encoding is not the plain JSON Emmett stores (unions are wrapped, timestamps are numbers), so the Avro schema describes the message for registries and Avro consumers, not Emmett's storage.
- The exported schemas must be accepted by Confluent, xRegistry, Apicurio and KurrentDB registries (Q33). The registries disagree about JSON Schema compatibility rules ([findings/formats-registries.md](findings/formats-registries.md), section 4.2), so tests should check the exports against each one's expectations.
- Checking compatibility between versions of a definition (backward, forward, full) may come later (Q33).

## 10. Web framework integration

Each binding follows the idiom of the popular validation plugin for its framework and stays compatible with it (Q40). Research: [findings/http-validation.md](findings/http-validation.md).

In all of them, the request body is validated against a part schema, usually `X.data`. When the body is only part of the data (for example, `shoppingCartId` comes from the route and `unitPrice` is computed, as in `src/packages/emmett-honojs/src/e2e/decider/api.ts:68-95`), users derive a schema or write a separate one (Q39).

- **Hono:** works as it is through `@hono/standard-validator`, because part schemas are Standard Schemas:

  ```ts
  router.post('/carts/:id/confirm', sValidator('json', ConfirmShoppingCart.data), (c) => {
    const data = c.req.valid('json');
  });
  ```

- **Express:** Express has no schema validation built in, so `emmett-expressjs` ships a `validate` middleware in the style of `express-zod-safe`, taking any Standard Schema per request part:

  ```ts
  router.post('/carts/:id/confirm', validate({ params, query, body: ConfirmShoppingCart.data }), handler);
  ```

- **Fastify:** Fastify validates JSON Schema per part, and there's no established Standard Schema type provider. `emmett-fastify` ships a validator compiler and a type provider in the style of `fastify-type-provider-zod`:

  ```ts
  app.withTypeProvider<EmmettTypeProvider>().post('/carts/:id/confirm', {
    schema: { body: ConfirmShoppingCart.data },
  }, handler);
  ```

- **NestJS:** no Emmett package. Part schemas work with `nestjs-zod`, which needs only a `parse` method: `class ConfirmDto extends createZodDto(ConfirmShoppingCart.data) {}`.

No automatic validation is added on append or on read in the first version (Q38).

## 11. Testing support

- **First version:** `X.example()` returns the `examples` written on the definition. Nothing is generated (Q41, Q43). It feeds Emmett's Given/When/Then specs.
- **Last step, maybe:** a check that every event `decide` returns is valid against its definition, and round-trip checks (`serialize` → `upcast` → `parse` gives the same message back) (Q41).

What schemas can and can't supply for tests is in [findings/tooling.md](findings/tooling.md), section 5.4.

## 12. EventCatalog

Three steps, in this order (Q37):

1. A function, shipped by us, that takes definitions and writes EventCatalog folders through the MIT-licensed `@eventcatalog/sdk`: `index.mdx` with frontmatter from the documentation fields, `schema.json` from `toJSONSchema()`, and `examples/*.json`. The prototype in `prototypes/tooling/eventcatalog/` did this.
2. An EventCatalog generator module that wraps the function, so users list it in `eventcatalog.config.js`.
3. AsyncAPI export, which also works outside EventCatalog. EventCatalog's own AsyncAPI generator needs a paid licence or an AGPL-compatible project ([findings/tooling.md](findings/tooling.md), section 2.6).

Things the generator has to settle are listed in [findings/tooling.md](findings/tooling.md), section 2.8. They include EventCatalog's semver `version` versus our numbers `1`, `2`; producers and consumers living on services, which definitions don't know about; and keeping or regenerating hand-edited Markdown.

## 13. Backward compatibility

- `Event<>`, `Command<>`, `AnyEvent`, `event()`, `command()`, `DefaultCommandMetadata`, `JSONSerializer` and `JSONCodec` keep their names, signatures and behaviour.
- Moving `JSONSerializer` and `JSONCodec` to `shapewright` is invisible to users: Emmett re-exports them.
- Code without definitions is unaffected. Definitions are opt-in per message, and both styles can be mixed in one union.
- `schemaVersion` changes from a string in metadata to a number at the top level of the message. The string type was only in 0.43.0 prereleases (beta.54, rc.1, rc.2), and stored strings still read as numbers (section 8.1). Users of those prereleases who read `event.metadata.schemaVersion` in an upcast have to change it.

## 14. Suggested order of work

1. Create `shapewright`, move `JSONSerializer` and `JSONCodec` into it, and re-export them from Emmett and Dumbo.
2. Standard Schema plumbing, issue normalisation and `ValidationError.issues`.
3. The built-in `schema` builder with Standard Schema and Standard JSON Schema.
4. `Event(...)` and `Command(...)`: factory, `.Type`, `InferEvent`, `InferCommand`, `is`, part schemas, documentation fields, opt-in factory validation.
5. `parse`, `safeParse` and `serialize`, with upcasting and `schemaVersion`. Every driver sets `schemaVersion` on read, with a test per driver.
6. `toJSONSchema()`, then `toAvro()`, tested against the registries' expectations.
7. Web bindings: Express middleware, Fastify type provider, Hono docs and tests.
8. `example()`.
9. EventCatalog: the writer function, then the generator, then AsyncAPI export.
10. Maybe: the `decide` validity check and round-trip checks, then compatibility checks between versions, then the optional code generator for hand-written types.

## 15. Open questions

- **JSON Schema target:** draft 2020-12 (the Standard JSON Schema default) or draft-07 (EventCatalog's examples, and the format AsyncAPI mandates). Possibly both.
- **Avro mapping:** how dates (`timestamp-millis` or string), bigints (`long` or string), unions and nullable fields map.
- **Upcasters:** the order and precedence when a definition has its own `upcast` and `parse` is also given one in its options.
- **Event store integration:** stores taking stream and event schemas, together with the registry (later, per Oskar).
- **Avro input:** parsing Avro, not only exporting Avro schemas (later).
- **`examples` shape:** example `data` values or whole messages.
- **Schemas without JSON Schema:** whether a library schema without `~standard.jsonSchema` (plain Valibot, Effect without its wrapper) exports `{}`, throws, or warns.
- **Where `ValidationError` lives,** given that `shapewright` needs it and Emmett has it today.
- **Naming:** the final name of the `schema` builder, and of the package (`shapewright` is provisional).
- **`Command` with `schemaVersion`:** whether commands get `version` and `schemaVersion` exactly as events do.
- **Later definitions:** streams (Q38). Command handlers and workflows can already take definitions (section 8.4).

Versioning points still open from the projection schemas brainstorm. Details and evidence are in [projections/spec-refinement.md](projections/spec-refinement.md) section 3.

- **The version the code works with:** an optional `currentVersion` on the definition (the last entry when left out), or the user picks a version explicitly, with `Versions[2]` for one version, `Versions.All` as the AND of all versions for a backward-compatible downcast, and `Versions.Any` for upcast and downcast (projections Q8, Q11).
- **Type names:** for any version of a message and for all versions. "Stored" is rejected as imprecise (projections Q9, Q10).
- **Downcast:** how it is written, for example one user function `(message: Versions[3]) => Versions[2]` (projections Q12).
- **Removing old versions:** how the definition says which version its first remaining entry is (projections Q11).
- **A version newer than the reader knows:** for events, and for projection documents, which are written back (projections Q9).
- **Where each store saves `schemaVersion`:** PostgreSQL and SQLite columns hold wrong old values, MongoDB maps stored fields one by one, KurrentDB records have only type, data and metadata (projections Q12).
- **A missing version without definitions:** whether it reads as 1, the same as data from 0.42 and earlier (projections Q15).
- **Appends outside the command handler:** what version events get from `handleWorkflow`, processors that forward messages and direct `appendToStream` calls (projections Q15).
- **Hand-written payload types:** how they say their version; a `V1` suffix on the TypeScript type name settles nothing (projections Q13).
- **`version` option on `Event(...)`:** whether it stays, given that the definition's versions give the current version (projections Q6).
- **When the type changes to a number:** before 0.43.0 is final, as Oskar suggested, or later (projections Q5).
- **Registering types and marking non-JSON types:** see [projections/spec.md](projections/spec.md) section 9.
