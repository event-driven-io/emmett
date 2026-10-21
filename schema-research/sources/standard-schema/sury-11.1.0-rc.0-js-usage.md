[⬅ Back to highlights](../README.md)

# JavaScript API reference

## Table of contents

- [Table of contents](#table-of-contents)
- [Install](#install)
- [Basic usage](#basic-usage)
  - [Parsing data](#parsing-data)
  - [Inferred types](#inferred-types)
  - [Checking against a type you already have](#checking-against-a-type-you-already-have)
  - [Encoding data](#encoding-data)
  - [JSON Schema](#json-schema)
  - [Standard Schema](#standard-schema)
- [Defining schemas](#defining-schemas)
  - [Advanced schemas](#advanced-schemas)
- [Strings](#strings)
  - [String formats](#string-formats)
  - [Custom error messages](#custom-error-messages)
  - [ISO datetimes](#iso-datetimes)
- [Numbers](#numbers)
- [Optionals](#optionals)
- [Nullables](#nullables)
- [Nullish](#nullish)
- [Objects](#objects)
  - [Literal fields](#literal-fields)
  - [Advanced object schema](#advanced-object-schema)
  - [`strict`](#strict)
  - [`strip`](#strip)
  - [`deepStrict` & `deepStrip`](#deepstrict-deepstrip)
  - [`merge`](#merge)
- [Arrays](#arrays)
  - [Compact Columns](#compact-columns)
- [Tuples](#tuples)
  - [Advanced tuple schema](#advanced-tuple-schema)
- [Unions](#unions)
  - [Discriminated unions](#discriminated-unions)
  - [Converting to / from a union](#converting-to-from-a-union)
- [Records](#records)
- [Date](#date)
- [ISO DateTime](#iso-datetime)
- [Instance](#instance)
- [Blob](#blob)
- [File](#file)
- [FormData](#formdata)
  - [Checkboxes](#checkboxes)
  - [Blank inputs](#blank-inputs)
  - [Not supported](#not-supported)
- [Env](#env)
- [URLSearchParams](#urlsearchparams)
- [Query string](#query-string)
- [Protocol Buffers](#protocol-buffers)
  - [Field types](#field-types)
  - [Optional fields](#optional-fields)
  - [Lists and maps](#lists-and-maps)
  - [Oneof](#oneof)
  - [Recursive messages](#recursive-messages)
  - [Well-known types](#well-known-types)
  - [Generating a `.proto`](#generating-a-proto)
  - [Unknown fields and errors](#unknown-fields-and-errors)
  - [`ArrayBuffer` output](#arraybuffer-output)
  - [Performance and compatibility](#performance-and-compatibility)
- [Content](#content)
- [Meta](#meta)
- [Brand](#brand)
- [Custom schema](#custom-schema)
- [Recursive schemas](#recursive-schemas)
- [Refinements](#refinements)
  - [`shape`](#shape)
- [Operations](#operations)
  - [At a glance](#at-a-glance)
  - [Pipelines](#pipelines)
  - [Built-in operations](#built-in-operations)
  - [Constructing entities](#constructing-entities)
  - [Chaining operations](#chaining-operations)
  - [`reverse`](#reverse)
  - [`to`](#to)
  - [`name`](#name)
  - [`toInputExpression`](#toinputexpression)
  - [`toOutputExpression`](#tooutputexpression)
  - [`pathToText`](#pathtotext)
  - [`toString`](#tostring)
- [Error handling](#error-handling)
- [Global config](#global-config)
  - [`defaultAdditionalItems`](#defaultadditionalitems)
  - [`disableNanNumberValidation`](#disablenannumbervalidation)

## Install

```sh
npm install sury
```

> 🧠 You don't need to install [ReScript](https://rescript-lang.org/) compiler for the library to work.

## Basic usage

The main building block of **Sury** is a schema - a type definition that exists at runtime.

```ts
import * as S from "sury"; // 8.6 kB (min + gzip) for this schema, tree-shaken

const playerSchema = S.schema({
  username: S.string,
  xp: S.number,
});
```

### Parsing data

Parses unknown data and returns a strongly-typed deep clone of the input, with unknown fields stripped by default:

```ts
S.parseOrThrow(playerSchema, { username: "billie", xp: 100 });
// => returns { username: "billie", xp: 100 }
```

Invalid data throws `S.Error`:

```ts
S.parseOrThrow(playerSchema, { username: "billie", xp: "not a number" });
// => throws S.Error: Failed at xp: Expected number, received "not a number"
```

Use `S.parseAsResult` if you'd rather have a result than an exception - see [Operations](#operations) and [Error handling](#error-handling).

> 🧠 Besides `parse` there are operations to transform without validation, assert without allocating an output, and encode back to the input format. See [Operations](#operations).

### Inferred types

**Sury** infers the static type from the schema definition. Extract it with `S.Infer<typeof schema>`, `S.Output<typeof schema>`, or `S.Input<typeof schema>`:

```ts
const playerSchema = S.schema({
  username: S.string,
  xp: S.number,
});
//? S.Schema<{ username: string; xp: number }, { username: string; xp: number }>

type Player = S.Infer<typeof playerSchema>;
```

The type parameters read in the direction data flows: `S.Schema<TInput, TOutput>` - the encoded type the schema accepts, then the decoded type it produces. `TOutput` defaults to `TInput`, so an identity schema is just `S.Schema<string>`.

To annotate "any schema producing `T`, whatever it accepts", leave the input as `unknown`:

```ts
const parseT = <T>(schema: S.Schema<unknown, T>, data: unknown): T =>
  S.parseOrThrow(schema, data);
```

### Checking against a type you already have

When you already have the type - generated, shared, or just written by hand - `S.schemaOf` checks a definition against it instead of inferring a new one.

```ts
type User = {
  id: string;
  name: string;
  publishedAt?: Date;
};

const userSchema = S.schemaOf<User>()({
  id: S.string,
  name: S.string,
  publishedAt: S.optional(S.isoDateTime.with(S.to, S.date)),
});
//? S.Schema<{ id: string; name: string; publishedAt?: string | undefined }, User>
```

Anything that doesn't line up is a type error on the field causing it: a wrong type, a missing field, a field the type doesn't declare, or an optional field defined without [`S.optional`](#optionals).

Codecs need no second type argument, since the encoded type is read off the definition. A union or a recursive schema is passed as the schema itself.

### Encoding data

Every schema has an `Input` type as well as an `Output` type, so the same definition encodes back to the input format:

```ts
S.encodeOrThrow(playerSchema, { username: "billie", xp: 100 });
// => returns { username: "billie", xp: 100 }
```

That's uneventful without transformations. Add some - [`to`](#to) for coercion, [`shape`](#shape) for restructuring - and the reverse direction comes with them:

```ts
const userSchema = S.schema({
  USER_ID: S.string.with(S.to, S.bigint),
  USER_NAME: S.string,
}).with(S.shape, (input) => ({
  id: input.USER_ID,
  name: input.USER_NAME,
}));
//? S.Schema<{ USER_ID: string; USER_NAME: string }, { id: bigint; name: string }>

S.parseOrThrow(userSchema, { USER_ID: "0", USER_NAME: "Dmitry" });
// { id: 0n, name: "Dmitry" }

S.encodeOrThrow(userSchema, { id: 0n, name: "Dmitry" });
// { USER_ID: "0", USER_NAME: "Dmitry" }
```

`S.encodeOrThrow` skips validation. For a validating reverse pass, use [`reverse`](#reverse), which returns a full-featured schema with `Input` and `Output` swapped:

```ts
S.parseOrThrow(S.reverse(userSchema), { id: 0n, name: "Dmitry" });
// { USER_ID: "0", USER_NAME: "Dmitry" }
```

### JSON Schema

`S.toInputJSONSchemaOrThrow(schema, { target })` emits `"draft-07"` (default), `"draft-2020-12"`, or `"openapi-3.0"`. Properties and examples come out in the **Input** format:

```ts
const documented = userSchema.with(S.meta, {
  description: "User entity in our system",
  examples: [{ id: 0n, name: "Dmitry" }],
});

S.toInputJSONSchemaOrThrow(documented);
// {
//   type: "object",
//   properties: {
//     USER_ID: { type: "string" },
//     USER_NAME: { type: "string" },
//   },
//   required: ["USER_ID", "USER_NAME"],
//   description: "User entity in our system",
//   examples: [{ USER_ID: "0", USER_NAME: "Dmitry" }],
// }
```

`S.toOutputJSONSchemaOrThrow` describes the other side - what the schema produces, and what `S.encodeOrThrow` accepts:

```ts
const apiUser = S.schema({
  USER_NAME: S.string,
  AGE: S.string.with(S.to, S.number),
}).with(S.shape, (input) => ({ name: input.USER_NAME, age: input.AGE }));

S.toOutputJSONSchemaOrThrow(apiUser);
// {
//   type: "object",
//   properties: { name: { type: "string" }, age: { type: "number" } },
//   required: ["name", "age"],
// }
```

A type JSON has no way to describe - a `bigint`, a `symbol`, a `Date` - throws on the side it appears, whichever direction that is.

The `target` decides the type of the result - `S.JSONSchema7`, `S.JSONSchema2020`, or `S.OpenAPISchema30` - so `prefixItems` is there to reach for on a draft-2020-12 result and `nullable` on an OpenAPI one, and neither is on a draft-07 one.

`S.fromJSONSchemaOrThrow` converts in the other direction:

```ts
S.assertInputOrThrow(
  S.fromJSONSchemaOrThrow({
    type: "string",
    format: "email",
  }),
  "example.com"
);
// Throws S.Error: Expected email, received "example.com"
```

A document written inline is validated and typed:

```ts
const schema = S.fromJSONSchemaOrThrow({
  type: "object",
  properties: { id: { type: "string" }, role: { enum: ["admin", "user"] } },
  required: ["id"],
});
// S.Schema<{ id: string; role?: "admin" | "user" | undefined }>
```

A `$ref` pointing into the same document is followed, recursive ones included:

```ts
const comment = S.fromJSONSchemaOrThrow({
  $ref: "#/$defs/comment",
  $defs: {
    comment: {
      type: "object",
      properties: {
        text: { type: "string" },
        replies: { type: "array", items: { $ref: "#/$defs/comment" } },
      },
      required: ["text"],
    },
  },
});
// S.Schema<{ text: string; replies?: ...[] | undefined }>

S.assertInputOrThrow(comment, { text: "hi", replies: [{ text: 1 }] });
// Throws S.Error: Failed at replies[0].text: Expected string, received 1
```

`$defs` and `definitions` pointers are named in the type; one on any other path (`#/components/schemas/Pet`) is validated the same, but typed as `S.JSON`.

A `$ref` leading outside the document - a URL, a `urn:`, an `$anchor`, a `$id` base - throws instead of silently accepting anything, so bundle first.

A keyword it cannot model - an unsupported `type`, an unparseable `pattern`, a `$ref` cycle with no content - throws too, rather than widening to `S.json`.

To also have TypeScript check the schema document itself, annotate it with `satisfies S.JSONSchema` - that catches a misspelled keyword while leaving `x-` vendor extensions open. The annotation widens literals (e.g. `required`, `enum`), so the inferred type gets wider too - every property becomes optional.

A schema read from a file or an API needs no cast: a non-literal argument - `unknown`, `S.JSON`, or one of the dialect types - falls back to `S.Schema<S.JSON, S.JSON>`, so pair it with `S.to` when you need a narrower type.

> 🧠 **Sury**'s internal representation is itself JSON Schema-shaped, so a schema is readable as-is: `S.schema("Hello world!")` logs `{ type: "string", const: "Hello world!", ... }`.

### Standard Schema

**Sury** implements the [Standard Schema](https://standardschema.dev/) specification, so a schema works with any library that accepts one, such as form libraries. It reports every issue, not only the first:

```ts
const schema = S.schema({ name: S.string, age: S.number });

schema["~standard"].validate({ name: "Dmitry", age: 30 }).value;
// { name: "Dmitry", age: 30 }

schema["~standard"].validate({ name: 1, age: "30" }).issues;
// [
//   { message: "Expected string, received 1", path: ["name"] },
//   { message: 'Expected number, received "30"', path: ["age"] },
// ]
```

A schema with an async codec answers with a promise.

The `~standard` property also implements the [Standard JSON Schema](https://standardschema.dev/json-schema) spec, exposing a `jsonSchema` converter for the schema's input and output types. Call `S.enableStandardJSONSchema()` once to enable it:

```ts
S.enableStandardJSONSchema();

const schema = S.string.with(S.to, S.number);

schema["~standard"].jsonSchema.input({ target: "draft-2020-12" });
// { $schema: "https://json-schema.org/draft/2020-12/schema", type: "string" }
schema["~standard"].jsonSchema.output({ target: "draft-2020-12" });
// { $schema: "https://json-schema.org/draft/2020-12/schema", type: "number" }
```

> 🧠 `jsonSchema.input(options)` equals `S.toInputJSONSchemaOrThrow(schema, options)` and `.output(options)` equals `S.toInputJSONSchemaOrThrow(S.reverse(schema), options)`, so the `target` option behaves the same as above. The `options` argument is required by the spec.

## Defining schemas

```ts
import * as S from "sury";

// Primitive values
S.string;
S.number;
S.int32;
S.integer;
S.boolean;
S.bigint;
S.symbol;
S.void;

// Literal values
// Supports any JS type
// Validated using strict equal checks
S.schema("tuna");
S.schema(12);
S.schema(2n);
S.schema(true);
S.schema(undefined);
S.schema(null);
S.schema(Symbol("terrific"));
S.literal("tuna"); // alias for S.schema

// NaN literals
// Validated using Number.isNaN
S.schema(NaN);

// Simple Objects
S.schema({ name: S.string, age: S.number });
S.object({ name: S.string, age: S.number }); // alias for S.schema

// Arrays and records
S.array(S.string);
S.record(S.number); // { [k: string]: number }

// Simple Tuples
S.schema([S.string, S.number]);
S.tuple([S.string, S.number]); // alias for S.schema

// Anywhere a schema is accepted, a raw definition works too - it's
// passed through S.schema for you
S.array({ id: S.string }); // { id: string }[]
S.record({ n: S.number }); // { [k: string]: { n: number } }
S.optional([S.string, "ok"]); // [string, "ok"] | undefined
S.nullable("foo"); // "foo" | null

// Unions
S.union([S.string, S.number]);
S.anyOf([S.string, S.number]); // alias for S.union
// Enum-like union of literals
S.union(["Win", "Draw", "Loss"]);
// Discriminated unions
S.union([
  { kind: "circle", radius: S.number },
  { kind: "square", x: S.number },
]);

// Catch-all type
// Allows any value
S.unknown;
S.any; // alias for S.unknown, typed as S.Schema<any, any>

// Never type
// Allows no values
S.never;
```

> 🧠 `S.schema` turns any definition into a schema - `S.literal`, `S.object` and `S.tuple` are aliases for it. Only `S.object` and `S.tuple` also take a definer function, for [advanced object](#advanced-object-schema) and [advanced tuple](#advanced-tuple-schema) schemas.

### Advanced schemas

> 🧠 Don't forget `S.to` which comes with powerful coercion logic.

```ts
// JSON type
// Allows string | boolean | number | null | Record<string, JSON> | JSON[]
S.json;

// JSON string
// Asserts that the input is a valid JSON string
S.jsonString;
S.jsonStringWithSpace(2);
// Parses JSON string and validates that it's a number
// JSON string -> number
S.jsonString.with(S.to, S.number);
// Encodes number to JSON string
S.number.with(S.to, S.jsonString);
// Encoding to S.jsonString builds an optimized JSON string encoder instead of
// calling JSON.stringify - usually 1.3-2x faster.

// Asserts that the input is a Date instance and not Invalid Date
S.date;

// Asserts that the input is an instance of Uint8Array
S.uint8Array;
// Decodes Uint8Array to utf-8 string
S.uint8Array.with(S.to, S.string);
// Encodes utf-8 string to Uint8Array
S.string.with(S.to, S.uint8Array);

// Base64 text, whose payload is bytes
S.base64;
// Decodes base64 to the bytes it stores
S.base64.with(S.to, S.uint8Array);

// An ArrayBuffer of its own. Bytes convert into it by taking ownership: a
// view over its whole buffer hands the buffer over, any other view is copied
// to size. Back to bytes is a view, which allocates nothing.
S.arrayBuffer;
S.uint8Array.with(S.to, S.arrayBuffer);

// Protocol Buffers wire format, whose payload is a message
S.protobuf;
// Encodes an object with numbered fields to protobuf bytes
S.schema({ id: S.int32.with(S.protobufField, 1) }).with(S.to, S.protobuf);
```

See [Content](#content) for what happens when bytes and a JSON document meet.

## Strings

**Sury** includes a handful of string-specific refinements and transforms:

```ts
S.string.with(S.maxLength, 5); // Expected string.length <= 5
S.string.with(S.minLength, 5); // Expected string.length >= 5
S.string.with(S.length, 5); // Expected string.length == 5
S.string.with(S.nonEmpty); // Expected string.length >= 1
S.string.with(S.pattern, /[0-9]/); // Invalid pattern

S.string.with(S.trim); // trim whitespaces
```

For format-specific validation, use the standalone schemas - see [String formats](#string-formats) below.

> For RFC 3339 datetime strings use the dedicated standalone `S.isoDateTime` schema, or `S.utcDateTime` when only `Z` is acceptable - see [ISO datetimes](#iso-datetimes) below.

> ⚠️ Validating email addresses is nearly impossible with just code. Different clients and servers accept different things and many diverge from the various specs defining "valid" emails. The ONLY real way to validate an email address is to send a verification email to it and check that the user got it. With that in mind, Sury picks a relatively simple regex that does not cover all cases.

When using built-in refinements, you can provide a custom error message.

```ts
S.nonEmpty(S.string, "String can't be empty");
S.length(S.string, 5, "SMS code should be 5 digits long");
```

### String formats

The JSON Schema string format vocabulary, as standalone schemas:

```ts
S.email; // Email address
S.idnEmail; // Internationalized email address
S.uuid; // UUID, any version
S.uuidv4; // UUIDv4 - random
S.uuidv6; // UUIDv6 - reordered time
S.uuidv7; // UUIDv7 - Unix time, sorts by creation
S.cuid; // CUID
S.cuid2; // CUID2
S.ulid; // ULID
S.ksuid; // KSUID
S.xid; // XID
S.nanoid; // Nano ID alphabet
S.e164; // E.164 phone number
S.mac; // MAC address, EUI-48 or EUI-64
S.hex; // Hexadecimal digits
S.cidrv4; // IPv4 CIDR block
S.cidrv6; // IPv6 CIDR block
S.uri; // URI - a scheme is required
S.httpUrl; // URI with the scheme pinned to http or https
S.uriReference; // URI or relative reference
S.uriTemplate; // URI Template
S.iri; // IRI - a URI with Unicode allowed
S.iriReference; // IRI or relative reference
S.hostname; // Host name
S.idnHostname; // Internationalized host name
S.ipv4; // IPv4 address
S.ipv6; // IPv6 address
S.isoDate; // Calendar date
S.isoTime; // Time of day
S.isoDateTime; // Timestamp, Z or offset
S.utcDateTime; // Timestamp, Z only
S.duration; // Duration
S.jsonPointer; // JSON Pointer
S.relativeJsonPointer; // Relative JSON Pointer
S.base64; // Base64, standard alphabet with canonical padding
S.base64url; // Base64url, URL-safe alphabet, no padding
```

Each survives a round trip through `S.toInputJSONSchemaOrThrow` and `S.fromJSONSchemaOrThrow`,
though not all of them as a name. A format the JSON Schema vocabulary has no
keyword for publishes its own regex as `pattern` instead, so what round-trips is
the behavior:

```ts
S.toInputJSONSchemaOrThrow(S.ulid); // { type: "string", pattern: "^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$" }
S.toInputJSONSchemaOrThrow(S.uuidv7); // { type: "string", format: "uuid", pattern: "…-7[0-9a-fA-F]{3}-…" }
S.toInputJSONSchemaOrThrow(S.httpUrl); // { type: "string", format: "uri", pattern: "^[hH][tT][tT][pP][sS]?:" }
```

`S.base64` and `S.base64url` emit `contentEncoding` instead. See
[Content](#content). `S.cidrv6` is the one format with neither spelling - its
address grammar is case-insensitive and a JSON Schema `pattern` carries no
flags, so it emits a plain `string` and widens on the way back in.

Three carry no length of their own, because the length is a property of the
generator rather than of the format. Compose one when you know it:

```ts
S.nanoid.with(S.length, 21); // the default Nano ID generator
S.cuid2.with(S.length, 24);
S.hex.with(S.length, 64); // a SHA-256 digest
```

**A format checks syntax, not safety.** Every one is exactly as strict as its
spec, so a well-formed value passes even when it isn't one you want to accept:

```ts
S.assertInputOrThrow(S.uri, "javascript:alert(1)"); // passes - a valid URI
S.assertInputOrThrow(S.hostname, "169.254.169.254"); // passes - a valid host name
S.assertInputOrThrow(S.uriReference, "//evil.com"); // passes - a valid reference
```

When you want a security decision rather than a syntax check, compose one. The
extra constraint rides along into the JSON Schema, so it stays honest:

```ts
const httpsOnly = S.uri.with(S.pattern, /^https:\/\//);
// { type: "string", format: "uri", pattern: "^https:\\/\\/" }
```

Three worth knowing before you pick one:

- **`S.url` is not `S.uri`.** `S.url` is an instance of the JS `URL` class, the
  way `S.date` is a `Date` - use it when you want the parsed object and its
  `.host` / `.pathname`. `S.uri` validates a string and leaves it a string.
- **`S.uriReference` is usually the one you want for a link field.** `S.uri`
  requires a scheme, so it rejects `/dashboard`.
- **`S.httpUrl` is `S.uri` with the scheme pinned** to `http` or `https`, in one
  check. It still rejects `javascript:` and `data:`, but it is not a safety
  check either - `https://169.254.169.254/` passes.

To make the *type* record that a value was validated, [brand it](#brand).

### Custom error messages

Built-in refinements accept an optional last argument for a custom error message:

```ts
S.minLength(S.string, 5, "Too short");
S.pattern(S.string, /^\d+$/, "Must be numeric");
```

For standalone schemas or more control, use `S.meta` with the `errorMessage` field:

```ts
// Override a specific constraint message
S.email.with(S.meta, { errorMessage: { format: "Must be a valid email" } });

// Use "_" as a catch-all for any constraint
S.email.with(S.meta, { errorMessage: { _: "Invalid input" } });

// Reset error messages (removes all overrides)
schema.with(S.meta, { errorMessage: {} });
```

Available keys: `format`, `type`, `minimum`, `maximum`, `minLength`, `maxLength`, `minItems`, `maxItems`, `minSize`, `maxSize`, `pattern`, `_` (catch-all).

### ISO datetimes

`S.isoDateTime` is a **standalone** string schema (`S.Schema<string, string>`) that validates RFC 3339 datetime strings, exactly what the JSON Schema `date-time` format means: a `Z` or a timezone offset, with arbitrary sub-second decimal precision. `S.utcDateTime` is the same grammar with only `Z` allowed.

```ts
S.parseOrThrow(S.isoDateTime, "2020-01-01T00:00:00Z"); // pass
S.parseOrThrow(S.isoDateTime, "2020-01-01T00:00:00.123456Z"); // pass (arbitrary precision)
S.parseOrThrow(S.isoDateTime, "2020-01-01T00:00:00+02:00"); // pass

S.parseOrThrow(S.utcDateTime, "2020-01-01T00:00:00Z"); // pass
S.parseOrThrow(S.utcDateTime, "2020-01-01T00:00:00+02:00"); // throws: Expected UTC date-time, received "2020-01-01T00:00:00+02:00"
```

Both emit `format: "date-time"`. `S.utcDateTime` adds a `pattern` pinning the `Z`, so its document reads back as `S.utcDateTime` through `S.fromJSONSchemaOrThrow`.

To decode an ISO datetime string into a `Date`, chain it with `.with(S.to, S.date)`:

```ts
const schema = S.string.with(S.to, S.date);
// schema has the type S.Schema<string, Date>
```

## Numbers

**Sury** includes some of number-specific refinements:

```ts
S.number.with(S.lte, 5); // Expected number <= 5
S.number.with(S.gte, 5); // Expected number >= 5
S.number.with(S.lt, 5); // Expected number < 5
S.number.with(S.gt, 5); // Expected number > 5
S.number.with(S.multipleOf, 2); // Expected number % 2
```

They work on `S.bigint`, `S.integer`, `S.int32` and `S.port` too. `S.int32`
and `S.port` have a range of their own, so a bound outside it describes a
schema nothing satisfies and fails where it's written:

```ts
S.integer.with(S.gte, 5); // Expected integer >= 5
S.int32.with(S.gte, 3000000000);
// int32 >= 3000000000 contradicts int32 <= 2147483647
S.number.with(S.gte, 5).with(S.lte, 1);
// number <= 1 contradicts number >= 5
```

Optionally, you can pass in a third argument to provide a custom error message.

```ts
S.number.with(S.lte, 5, "this👏is👏too👏big");
```

## Optionals

You can make any schema optional with `S.optional`.

```ts
const schema = S.optional(S.string);

S.parseOrThrow(schema, undefined); // => returns undefined
type A = S.Infer<typeof schema>; // string | undefined
```

You can pass a default value to the second argument of `S.optional`.

```ts
const stringWithDefaultSchema = S.optional(S.string, "tuna");

S.parseOrThrow(stringWithDefaultSchema, undefined); // => returns "tuna"
type A = S.Infer<typeof stringWithDefaultSchema>; // string
```

Optionally, you can pass a function as a default value that will be re-executed whenever a default value needs to be generated:

```ts
const numberWithRandomDefault = S.optional(S.number, Math.random);

S.parseOrThrow(numberWithRandomDefault, undefined); // => 0.4413456736055323
S.parseOrThrow(numberWithRandomDefault, undefined); // => 0.1871840107401901
S.parseOrThrow(numberWithRandomDefault, undefined); // => 0.7223408162401552
```

Conceptually, this is how **Sury** processes default values:

1. If the input is `undefined`, the default value is returned
2. Otherwise, the data is parsed using the base schema

The default is what parsing returns, so it is written in the schema's output shape, even when the schema transforms:

```ts
const item = S.object((s) => ({ kind: "a", value: s.field("v", S.string) }));
const itemsSchema = S.optional(S.array(item), [{ kind: "a", value: "x" }]);

S.parseOrThrow(itemsSchema, undefined); // => [{ kind: "a", value: "x" }]
S.optional(S.array(item), [{ v: "x" }]); // throws: Invalid default
```

## Nullables

Similarly, you can create nullable types with `S.nullable`.

```ts
const nullableStringSchema = S.nullable(S.string);
S.parseOrThrow(nullableStringSchema, "asdf"); // => "asdf"
S.parseOrThrow(nullableStringSchema, null); // => null
```

Pass a fallback as the second argument to replace the absent case:

```ts
S.parseOrThrow(S.nullable(S.string, "fallback"), null); // => "fallback"
```

## Nullish

A convenience method that returns a "nullish" version of a schema. Nullish schemas will accept both `undefined` and `null`. Read more about the concept of "nullish" [in the TypeScript 3.7 release notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-3-7.html#nullish-coalescing).

```ts
const nullishStringSchema = S.nullish(S.string);
S.parseOrThrow(nullishStringSchema, "asdf"); // => "asdf"
S.parseOrThrow(nullishStringSchema, null); // => null
S.parseOrThrow(nullishStringSchema, undefined); // => undefined
```

Pass a fallback as the second argument to replace both `undefined` and `null`:

```ts
const schema = S.nullish(S.string, "fallback");
S.parseOrThrow(schema, undefined); // => "fallback"
S.parseOrThrow(schema, null); // => "fallback"
```

To replace only `undefined` and keep `null`, use `S.optional(S.nullable(S.string), "fallback")`.

## Objects

```ts
// all properties are required by default
const dogSchema = S.schema({
  name: S.string,
  age: S.number,
});

// extract the inferred type like this
type Dog = S.Infer<typeof dogSchema>;

// equivalent to:
type Dog = {
  name: string;
  age: number;
};
```

### Literal fields

Besides passing schemas for values in `S.schema`, you can also pass **any** Js value and it'll be treated as a literal field.

```ts
const meSchema = S.schema({
  id: S.number,
  name: "Dmitry Zakharov",
  age: 23,
  kind: "human",
  metadata: {
    description: "What?? Even an object with NaN works! Yes 🔥",
    money: NaN,
  } ,
});
```

Literal fields keep their narrow type - `kind` above is `"human"`, not `string` - which is what makes discriminated unions work.

### Advanced object schema

Sometimes you want to transform the data coming to your system. You can easily do it by passing a function to the `S.object` schema.

```ts
const userSchema = S.object((s) => ({
  id: s.field("USER_ID", S.number),
  name: s.field("USER_NAME", S.string),
}));

S.parseOrThrow(userSchema)({
  USER_ID: 1,
  USER_NAME: "John",
});
// => returns { id: 1, name: "John" }

// Infer output TypeScript type of the userSchema
type User = S.Infer<typeof userSchema>; // { id: number; name: string }
```

Compared to using custom transformation functions, the approach has 0 performance overhead. Also, you can use the same schema to convert the parsed data back to the initial format:

```ts
S.encodeOrThrow(userSchema)({
  id: 1,
  name: "John",
});
// => returns { USER_ID: 1, USER_NAME: "John" }
```

### `strict`

By default **Sury** object schema strip out unrecognized keys during parsing. You can disallow unknown keys with `S.strict` function. If there are any unknown keys in the input, **Sury** will fail with an error.

```ts
const personSchema = S.strict(
  S.schema({
    name: S.string,
  })
);

S.parseOrThrow(personSchema)({
  name: "bob dylan",
  extraKey: 61,
});
// => throws S.Error
```

If you want to change it for all schemas in your app, you can use `S.global` function:

```ts
S.global({
  defaultAdditionalItems: "strict",
});
```

### `strip`

Use the `S.strip` function to reset an object schema to the default behavior (stripping unrecognized keys).

### `deepStrict` & `deepStrip`

Both `S.strict` and `S.strip` are applied for the first level of the object schema. If you want to apply it for all nested schemas, you can use `S.deepStrict` and `S.deepStrip` functions.

```ts
const schema = S.schema({
  bar: {
    baz: S.string,
  },
});

S.strict(schema); // { "baz": string } will still allow unknown keys
S.deepStrict(schema); // { "baz": string } will not allow unknown keys
```

### `merge`

You can add additional fields to an object schema with the `merge` function.

```ts
const baseTeacherSchema = S.schema({ students: S.array(S.string) });
const hasIDSchema = S.schema({ id: S.string });

const teacherSchema = S.merge(baseTeacherSchema, hasIDSchema);
type Teacher = S.Infer<typeof teacherSchema>; // => { students: string[], id: string }
```

> 🧠 The function will throw if the schemas share keys. The returned schema also inherits the "unknownKeys" policy (strip/strict) of B.

## Arrays

```ts
const stringArraySchema = S.array(S.string);
```

**Sury** includes some of array-specific refinements. A bound on the size shows
up in the inferred type, so destructuring and indexing just work:

```ts
S.array(S.string).with(S.length, 2); //? S.Schema<[string, string]>
S.array(S.string).with(S.minLength, 2); //? S.Schema<[string, string, ...string[]]>
S.array(S.string).with(S.nonEmpty); //? S.Schema<[string, ...string[]]>
S.array(S.string).with(S.maxLength, 5); //? S.Schema<string[]>

const [lat, lng] = S.parseOrThrow(S.array(S.number).with(S.length, 2), input); // both number
```

### Compact Columns

`S.compactColumns` flattens an array of objects into one array of values per field, and back again:

```ts
const rowSchema = S.schema({
  id: S.string,
  name: S.string,
  deleted: S.boolean,
});

const schema = S.compactColumns(S.json).with(S.to, S.array(rowSchema));

S.encodeOrThrow(schema)([
  { id: "0", name: "Hello", deleted: false },
  { id: "1", name: "World", deleted: true },
]);
// [["0", "1"], ["Hello", "World"], [false, true]]

S.parseOrThrow(schema, [["0", "1"], ["Hello", "World"], [false, true]]);
// [{ id: "0", name: "Hello", deleted: false }, { id: "1", name: "World", deleted: true }]
```

The layout is the one described in [Boosting Postgres INSERT Performance by 2x With UNNEST](https://www.timescale.com/blog/boosting-postgres-insert-performance).

<details>

<summary>
Checkout the compiled code yourself:
</summary>

```javascript
(i) => {
  let v3 = [new Array(i.length), new Array(i.length), new Array(i.length)];
  for (let v2 = 0; v2 < i.length; ++v2) {
    v3[0][v2] = i[v2].id;
    v3[1][v2] = i[v2].name;
    v3[2][v2] = i[v2].deleted;
  }
  return v3;
};
```

</details>

## Tuples

Unlike arrays, tuples have a fixed number of elements and each element can have a different type.

```ts
const athleteSchema = S.schema([
  S.string, // name
  S.number, // jersey number
  {
    pointsScored: S.number,
  }, // statistics
]);

type Athlete = S.Infer<typeof athleteSchema>;
// type Athlete = [string, number, { pointsScored: number }]
```

### Advanced tuple schema

Sometimes you want to transform incoming tuples to a more convenient data-structure. To do this you can pass a function to the `S.tuple` schema.

```ts
const athleteSchema = S.tuple((s) => ({
  name: s.item(0, S.string),
  jerseyNumber: s.item(1, S.number),
  statistics: s.item(
    2,
    S.schema({
      pointsScored: S.number,
    })
  ),
}));

type Athlete = S.Infer<typeof athleteSchema>;
// type Athlete = {
//   name: string;
//   jerseyNumber: number;
//   statistics: {
//     pointsScored: number;
//   };
// }
```

That looks much better than before. And the same as for advanced objects, you can use the same schema for transforming the parsed data back to the initial format. Also, it has 0 performance overhead and is as fast as parsing tuples without the transformation.

## Unions

An union represents a logical OR relationship. You can apply this concept to your schemas with `S.union`. The same api works for discriminated unions as well.

The schema function `union` creates an OR relationship between any number of schemas that you pass as the first argument in the form of an array. On validation, the schema returns the result of the first schema that was successfully validated.

> 🧠 Members are matched in the order they are passed to `S.union` - the first one that fits the value wins.

It's also available as `S.anyOf`, matching the JSON Schema keyword it maps to.

```ts
// TypeScript type for reference:
// type Union = string | number;

const stringOrNumberSchema = S.union([S.string, S.number]);

S.parseOrThrow(stringOrNumberSchema, "foo"); // passes
S.parseOrThrow(stringOrNumberSchema, 14); // passes
```

### Discriminated unions

```typescript
// TypeScript type for reference:
// type Shape =
// | { kind: "circle"; radius: number }
// | { kind: "square"; x: number }
// | { kind: "triangle"; x: number; y: number };

const shapeSchema = S.union([
  {
    kind: "circle",
    radius: S.number,
  },
  {
    kind: "square",
    x: S.number,
  },
  {
    kind: "triangle",
    x: S.number,
    y: S.number,
  },
]);
```

### Converting to / from a union

[`S.to`](#to) works with unions on either side of the conversion. There are
three cases.

**Single type → union.** Members are tried in the order you wrote them; the
first one that accepts the value wins:

```ts
const schema = S.json.with(S.to, S.union([S.bigint, S.string]));

S.parseOrThrow(schema, "123"); // 123n - the bigint member comes first
S.parseOrThrow(schema, "abc"); // "abc" - not a valid bigint, so the string member takes it
S.parseOrThrow(schema, true); // throws - no member accepts a boolean
```

Notice that `true` wasn't converted to `"true"`, even though boolean → string
is a supported conversion. A value is only converted into a member type the
source can't produce itself: JSON has no bigints, so strings are offered to
`S.bigint` - but JSON already has strings, so the `S.string` member only
accepts actual strings.

**Union → single type.** The mirror image - each member converts to the target
the same way it would with a direct `S.to`:

```ts
const schema = S.union([S.bigint, S.boolean]).with(S.to, S.string);

S.parseOrThrow(schema, 123n); // "123"
S.parseOrThrow(schema, true); // "true"
```

An `undefined` or `null` member is a wider type, not a value to convert.
`S.optional(X)` or `S.nullable(X)` meeting a single type works as `X` would and
rejects the missing value: `S.optional(S.number).with(S.to, S.string)` writes
`12` as `"12"` and never `undefined` as `"undefined"`, and
`S.optional(S.string).with(S.to, S.string)` is `string -> string`. The same
holds the other way round: a single type converted into `S.optional(X)` never
produces `undefined`, and a string never reads `"undefined"` as one. `S.json`,
which holds the value, is the exception and keeps converting it as `null`.

**Union → union.** Values pass through to the member of the same type on the
other side - nothing is converted, so every member needs a counterpart. The one
exception: an `undefined` member without a counterpart may pair with a `null`
member on the other side, and vice versa:

```ts
S.union([S.string, S.number]).with(S.to, S.union([S.number, S.string])); // ✅ both pass through
S.optional(S.string).with(S.to, S.nullable(S.string)); // ✅ undefined <-> null
S.optional(S.string).with(S.to, S.nullable(S.boolean)); // ❌ string has no counterpart
```

Good to know:

- Formats count as distinct types: `S.int32` won't match a plain `S.number`
  member, and `S.json` won't match `S.string`.
- Nested unions are treated as one flat union: `S.union([S.string,
  S.union([S.number, S.boolean])])` has three members.
- When a value fails a member - wrong type, failed refinement, or an error
  thrown inside it - the next member gets a try. Only when all members fail
  does the union throw, listing each member's reason.

#### When a conversion is rejected

Some conversions have more than one reasonable meaning, and some have none.
Rather than guess, Sury rejects those with an `Invalid operation` error right
at the `S.parseOrThrow` / `S.encodeOrThrow` call - not later, on each value - and the
error suggests a rewrite that says what you mean.

**Ambiguous.** Given `"123"` - should it stay a string, or become a number?
Both readings are sensible, so Sury makes you pick:

```ts
S.string.with(S.to, S.union([S.number, S.string]));
// Ambiguous string -> number | string. Should number be decoded or ignored?
// Choose with S.to for string -> number, or S.never -> number

// Convert to a number when possible, keep the string otherwise:
const asNumber = S.string.with(S.to, S.union([S.string.with(S.to, S.number), S.string]));
S.parseOrThrow(asNumber, "123"); // 123
S.parseOrThrow(asNumber, "abc"); // "abc"

// Or pass strings through, never producing a number:
const asString = S.string.with(S.to, S.union([S.never.with(S.to, S.number), S.string]));
S.parseOrThrow(asString, "123"); // "123"
S.parseOrThrow(asString, "abc"); // "abc"
```

**The two unions don't cover each other.** Union-to-union converts nothing, so
a member with no same-type counterpart has nowhere to go:

```ts
S.union([S.string, S.number]).with(S.to, S.union([S.number, S.string, S.boolean]));
// Ambiguous string | number -> number | string | boolean. Should boolean be decoded
// or ignored? Choose with S.to for string -> boolean, or S.never -> boolean
S.optional(S.string).with(S.to, S.nullable(S.boolean)); // ❌ string doesn't match boolean
S.optional(S.string).with(S.to, S.nullable(S.string.with(S.to, S.boolean))); // ✅
```

**No conversion exists.** If a conversion between two types isn't supported
outside a union, putting it inside one doesn't change that. Use `S.never` to
mark a member as unreachable:

```ts
S.boolean.with(S.to, S.union([S.string, S.symbol])); // ❌ boolean -> symbol isn't supported
S.union([S.boolean, S.symbol]).with(S.to, S.string); // ❌ symbol -> string isn't supported
S.boolean.with(S.to, S.union([S.string, S.never.with(S.to, S.symbol)])); // ✅ symbol marked unreachable
```

> 🧠 Union conversion always validates every member, so transformed unions stay
> consistent across decode and encode.

## Records

Record schema is used to validate types such as `{ [k: string]: number }`.

If you want to validate the values of an object against some schema but don't care about the keys, use `S.record(valueSchema)`:

```ts
const numberCacheSchema = S.record(S.number);

type NumberCache = S.Infer<typeof numberCacheSchema>;
// => { [k: string]: number }
```

## Date

`S.date` validates that the input is a `Date` instance and rejects Invalid Date.

```ts
S.parseOrThrow(S.date, new Date()); // passes
S.parseOrThrow(S.date, new Date("2024-01-01T00:00:00Z")); // passes
S.parseOrThrow(S.date, new Date("invalid")); // throws
S.parseOrThrow(S.date, "2024-01-01"); // throws - not a Date instance
```

> Unlike `S.isoDateTime` (which validates ISO datetime strings) and `S.string.with(S.to, S.date)` (which decodes ISO strings into Date objects), `S.date` validates existing Date instances directly.

You can use `S.decodeOrThrow` with multiple arguments to decode between strings and dates:

```ts
// Decode ISO string to Date
S.decodeOrThrow(S.string, S.date, "2024-01-01T00:00:00.000Z"); // Date

// Decode Date to ISO string
S.decodeOrThrow(S.date, S.string, new Date("2024-01-01T00:00:00.000Z")); // "2024-01-01T00:00:00.000Z"
```

## ISO DateTime

`S.Schema<string, string>`

```ts
const schema = S.isoDateTime;

S.parseOrThrow(schema, "2020-01-01T00:00:00Z"); // "2020-01-01T00:00:00Z"
S.parseOrThrow(schema, "not-a-date"); // throws
```

Standalone string schema that validates RFC 3339 datetime strings; `S.utcDateTime` allows only `Z`. See also [ISO datetimes](#iso-datetimes) under Strings for more details and examples.

## Instance

You can use `S.instance` to check that the input is an instance of a class. This is useful to validate inputs against classes that are exported from third-party libraries.

```ts
class Test {
  name: string;
}

const testSchema = S.instance(Test);

const blob: any = "whatever";
S.parseOrThrow(testSchema, new Test()); // passes
S.parseOrThrow(testSchema, blob); // throws S.Error: Expected Test, received "whatever"
```

## Blob

`S.blob` validates a `Blob`. Its size is bounded in bytes with `S.minSize`,
`S.maxSize` and `S.size`:

```ts
S.blob; // Expected Blob
S.blob.with(S.maxSize, 1_000_000); // Expected Blob.size <= 1000000
S.blob.with(S.minSize, 1); // Expected Blob.size >= 1
S.blob.with(S.size, 2); // Expected Blob.size == 2
S.blob.with(S.maxSize, 1_000_000, "Too large"); // custom message
```

The same bounds work on any `S.instance` schema with a `.size`, counting
entries rather than bytes:

```ts
S.instance(Set).with(S.minSize, 1); // Expected Set.size >= 1
```

> Strings and arrays use `S.minLength`/`S.maxLength`/`S.length` instead.
> A lower bound of `0` is dropped; a negative one is an error.

## File

`S.file` validates a `File`. A `File` is a `Blob`, so it also satisfies
`S.blob` - not the other way round.

```ts
S.parseOrThrow(S.file, new File(["hi"], "a.txt")); // passes
S.parseOrThrow(S.file, new Blob(["hi"])); // throws - Expected File, received Blob
S.parseOrThrow(S.blob, new File(["hi"], "a.txt")); // passes
```

It takes the same size bounds as [`S.blob`](#blob):

```ts
S.file.with(S.minSize, 2).with(S.maxSize, 10); // Expected 2 <= File.size <= 10
```

`S.Blob`, `S.File` and `S.FormData` are exported as types, for projects whose
TypeScript config has neither `lib.dom` nor `@types/node` and so has none of
its own:

```ts
const upload = (f: S.File) => S.parseOrThrow(S.file, f);
```

## FormData

`S.formData` validates a `FormData`. Convert it with `S.to` and one schema
serves both the request handler and the `fetch` body:

```ts
const signup = S.formData.with(
  S.to,
  S.schema({
    email: S.email,
    age: S.number, // "42" -> 42
    agree: true, // a checkbox that has to be ticked
    avatar: S.file,
  }),
);

S.decodeOrThrow(signup)(await request.formData());
// => { email: "a@b.co", age: 42, agree: true, avatar: File }
S.encodeOrThrow(signup)(user);
// => a FormData, ready for fetch(url, { body })
```

Text coercions are the ones [`S.record(S.string)`](#records) gets:

```ts
S.schema({
  age: S.number, // "42" -> 42
  avatar: S.file, // the entry as it is, and so is S.blob
  photos: S.array(S.file), // every "photos" entry, for a multi-file input
  point: S.tuple([S.number, S.number]), // exactly two, or the count is reported
});
```

A list is never absent - no entries is the empty list - so `S.optional(S.array(x))`
reads `[]` where the key is missing, and a default on a list is rejected.

A key the schema declares once but the form sent twice is reported rather than
resolved:

```ts
S.schema({ name: S.string.with(S.nonEmpty) });
// name=first&name=second
// => Failed at name: Expected string.length >= 1, received ["first", "second"]
```

### Checkboxes

A boolean field is a checkbox, since nothing else a browser sends is one, and
it stays one however you wrap it:

```ts
S.schema({
  agree: S.boolean, // "on"/"true" -> true, "false" or absent -> false
  terms: true, // must be ticked:  absent -> Expected true, received undefined
  spam: false, // must stay clear: "on"  -> Expected false, received "on"
  notify: S.optional(S.boolean), // tri-state: absent -> undefined
  seen: S.nullable(S.boolean), // absent -> null
});
```

Encoding omits an unchecked box, exactly as a browser does - unless the field
has a third state, since absent and unchecked are the same wire:
`S.optional(S.boolean)` and `S.nullable(S.boolean)` write their `false` out to
keep it apart. `S.optional(S.boolean, true)` still cannot round-trip: its
`false` omits, and an absent box is its default.

Any other `value` is a string the schema should name (`S.union(["yes", "no"])`),
and a list of booleans is rejected: a checkbox group submits the value of each
checked box, so `S.array(S.string)` is what one decodes to.

A boolean arm of a union reads the same way:

```ts
S.union([S.boolean, S.number]); // "on" -> true, "false" -> false, "42" -> 42
```

### Blank inputs

An empty text input submits `""`, and a required string field has to say what
that means:

```ts
S.formData.with(S.to, S.schema({ name: S.string }));
// throws at S.decodeOrThrow: Failed at name: Ambiguous "" for string. Should a blank
// input be rejected, kept, or read as absent? Choose with S.nonEmpty,
// S.minLength(0), or S.optional
```

```ts
S.schema({
  name: S.string.with(S.nonEmpty), // "" -> Expected string.length >= 1
  bio: S.string.with(S.minLength, 0), // "" -> "", a value
  nick: S.optional(S.string), // "" -> undefined
  note: S.nullable(S.string), // "" -> null
  tier: S.optional(S.number, 1), // "" -> 1, the default
  age: S.number, // "" -> Expected number
});
```

Only a required, non-nullable string has to choose - every other target answers
for itself, `S.minLength(0)` being the way to say "the empty string is a value"
without adding a check. It says that inside a wrapper too:
`S.optional(S.string.with(S.minLength, 0))` reads `""` as `""` and only a
missing key as absent, which is the one spelling that tells the two apart.

The question follows the text: `S.string.with(S.trim)` hands it on to a bare
string and is asked again, `S.string.with(S.trim).with(S.nonEmpty)` is not, and
each string arm of a union answers for itself.

### Not supported

`S.strict` fails at operation creation: a browser adds entries no schema
declared, so "no entries but these" is not something a form can promise.
Objects strip by default; keep it that way.

Nested objects have no wire form here - send them as a
[`S.jsonString`](#advanced-schemas) field:

```ts
S.schema({ prefs: S.jsonString.with(S.to, S.schema({ theme: S.string })) });
```

A repeated key is flat and positional, so every item of a list is exactly one
entry: `S.array(S.optional(S.string))` and `S.array(S.array(S.string))` are both
rejected rather than silently closing the gaps.

A file input with nothing chosen still submits an empty, unnamed `File`; that
sentinel reads as absent, so a required `S.file` reports a missing file,
`S.nullable(S.file)` reads `null`, and `S.array(S.file)` reads `[]`.

## Env

`S.env` is an environment variable value. `process.env` is a record of these:

```ts
const envSchema = S.schema({
  PORT: S.port,
  DEBUG: S.boolean,
  NAME: S.nullable(S.string),
});

S.decodeOrThrow(process.env, S.record(S.env), envSchema);
// { PORT: "8080", DEBUG: "true" } => { PORT: 8080, DEBUG: true, NAME: null }
```

A single var is the same coercion. `S.env` is `string | undefined`, the way
`process.env.PORT` is typed: `undefined` is the unset var, and so is `""`.

```ts
S.decodeOrThrow(process.env.PORT, S.env, S.port); // unset -> Expected port, received undefined
S.decodeOrThrow(process.env.NAME, S.env, S.optional(S.string)); // unset or "" -> undefined
S.decodeOrThrow(process.env.BIO, S.env, S.string.with(S.minLength, 0)); // unset -> failure, "" -> ""
S.decodeOrThrow(process.env.BIO, S.env, S.optional(S.string.with(S.minLength, 0))); // unset -> undefined, "" -> ""
```


## URLSearchParams

```ts
const search = S.urlSearchParams.with(
  S.to,
  S.schema({
    q: S.string.with(S.nonEmpty),
    page: S.optional(S.number),
    tags: S.array(S.string),
  }),
);

S.decodeOrThrow(new URLSearchParams("q=hi&page=2&tags=a&tags=b"), search);
```

Same field coercions as [`S.formData`](#formdata), without files. A required,
non-nullable string must say what a blank entry means.

## Query string

```ts
const search = S.queryString.with(
  S.to,
  S.schema({
    q: S.string.with(S.nonEmpty),
    page: S.optional(S.number),
  }),
);

S.decodeOrThrow("q=hi&page=2", search);
S.encodeOrThrow({ q: "hi", page: 2 }, search);
```

## Protocol Buffers

`S.protobuf` encodes and decodes the [Protocol Buffers](https://protobuf.dev)
binary format. Number each field with `S.protobufField` and use `S.protobuf` as
the other side of the operation. You don't need a `.proto` file or a code
generation step.

```ts
const User = S.schema({
  id: S.int32.with(S.protobufField, 1),
  name: S.string.with(S.protobufField, 2),
  tags: S.array(S.string).with(S.protobufField, 3),
  score: S.optional(S.number).with(S.protobufField, 4),
});

const encode = S.encodeOrThrow(User, S.protobuf);
const decode = S.decodeOrThrow(S.protobuf, User);

const bytes = encode({ id: 150, name: "Ada", tags: ["ml"] });
// Uint8Array [8, 150, 1, 18, 3, 65, 100, 97, 26, 2, 109, 108]
decode(bytes); // { id: 150, name: "Ada", tags: ["ml"] }
```

To get a single schema that parses bytes from `unknown`, use
`S.protobuf.with(S.to, User)`:

```ts
S.parseOrThrow(S.protobuf.with(S.to, User))(body);
```

### Field types

The schema picks the protobuf type:

| Schema                       | Protobuf type    |
| ---------------------------- | ---------------- |
| `S.string`                   | `string`         |
| `S.boolean`                  | `bool`           |
| `S.int32`                    | `int32`          |
| `S.number`                   | `double`         |
| `S.bigint`                   | `int64`          |
| `S.uint8Array`               | `bytes`          |
| `S.union([0, 1, 2])`         | `enum`           |
| `S.schema({ ... })`          | a nested message |
| `S.array(T)`                 | `repeated T`     |
| `S.record(T)`                | `map<string, T>` |
| `S.date`                     | `google.protobuf.Timestamp` |
| `S.json`                     | `google.protobuf.Value` |

Pass an object instead of a number to choose another type. The value in your
schema can differ from the wire type:

```ts
S.schema({
  id: S.string.with(S.protobufField, { number: 1, type: "uint32" }), // "150" is sent as 150
  delta: S.int32.with(S.protobufField, { number: 2, type: "sint32" }),
  hash: S.bigint.with(S.protobufField, { number: 3, type: "fixed64" }),
  ratio: S.number.with(S.protobufField, { number: 4, type: "float" }),
});
```

`type` is one of `double`, `float`, `int32`, `int64`, `uint32`, `uint64`,
`sint32`, `sint64`, `fixed32`, `fixed64`, `sfixed32`, `sfixed64`, `bool`,
`string`, `bytes`, `enum`, `message`, or one of the
[well-known types](#well-known-types). 64-bit integers are `bigint`s.

### Optional fields

Proto3 skips a field that holds its default value (`0`, `""`, `false`, empty
bytes), and decodes a missing field as that default. Wrap a field in
`S.optional` to tell "unset" from "zero":

```ts
const Counter = S.schema({
  count: S.int32.with(S.protobufField, 1),
  limit: S.optional(S.int32).with(S.protobufField, 2),
});

decode(encode({ count: 0 })); // { count: 0 }
decode(encode({ count: 0, limit: 0 })); // { count: 0, limit: 0 }
```

A nested message that isn't `S.optional` decodes to its empty value when it's
missing.

### Lists and maps

`S.array` is a repeated field. `S.record` is a map with `string` keys; set
`key` to use another key type:

```ts
S.schema({
  scores: S.array(S.int32).with(S.protobufField, 1), // repeated int32
  counts: S.record(S.int32).with(S.protobufField, 2), // map<string, int32>
  byId: S.record(User).with(S.protobufField, { number: 3, key: "int64" }), // map<int64, User>
});
```

Repeated numbers are packed. Set `packed: false` to write one tag per item.

### Oneof

Give optional fields the same `oneof` name. At most one of them can be set, and
encoding a value with two of them set throws:

```ts
S.schema({
  text: S.optional(S.string).with(S.protobufField, { number: 1, oneof: "value" }),
  count: S.optional(S.int32).with(S.protobufField, { number: 2, oneof: "value" }),
});
```

### Recursive messages

Use [`S.recursive`](#recursive-schemas):

```ts
type Category = { name: string; children: Category[] };

const Category = S.recursive<Category>("Category", (self) =>
  S.schema({
    name: S.string.with(S.protobufField, 1),
    children: S.array(self).with(S.protobufField, 2),
  }),
);
```

### Well-known types

Google's `google.protobuf.*` types are supported. `S.date` and `S.json` pick
theirs automatically. For the others, set `type`:

```ts
const Job = S.schema({
  at: S.date.with(S.protobufField, 1),
  payload: S.json.with(S.protobufField, 2),
  timeout: S.schema({ seconds: S.bigint, nanos: S.int32 }).with(S.protobufField, {
    number: 3,
    type: "google.protobuf.Duration",
  }),
  retries: S.optional(S.int32).with(S.protobufField, {
    number: 4,
    type: "google.protobuf.Int32Value",
  }),
});
```

| `type`                          | Schema                                                         |
| ------------------------------- | -------------------------------------------------------------- |
| `google.protobuf.Timestamp`     | `S.date`, or `S.schema({ seconds: S.bigint, nanos: S.int32 })` |
| `google.protobuf.Duration`      | `S.schema({ seconds: S.bigint, nanos: S.int32 })`              |
| `google.protobuf.Value`         | `S.json`                                                       |
| `google.protobuf.Struct`        | `S.record(S.json)`                                             |
| `google.protobuf.ListValue`     | `S.array(S.json)`                                              |
| `google.protobuf.FieldMask`     | `S.array(S.string)`                                            |
| `google.protobuf.Empty`         | `S.schema({})`                                                 |
| `google.protobuf.Int32Value`, `StringValue` and the other wrappers | `S.optional(S.int32)`, `S.optional(S.string)`, ... |

A `Date` holds milliseconds, so use the `{ seconds, nanos }` form when you need
nanoseconds. Inside `S.array` or `S.record`, a wrapper's item doesn't need
`S.optional`.

### Generating a `.proto`

`S.toProtoOrThrow` prints the `.proto` file for a message schema, so other
languages can generate code from it:

```ts
const Address = S.schema({
  street: S.string.with(S.protobufField, 1),
}).with(S.meta, { name: "Address" });

const Customer = S.schema({
  id: S.int32.with(S.protobufField, 1),
  homeAddress: S.optional(Address).with(S.protobufField, 2),
  kind: S.union([0, 1, 2]).with(S.protobufField, 3),
}).with(S.meta, { name: "Customer" });

S.toProtoOrThrow(Customer, { package: "acme.v1" });
```

```proto
syntax = "proto3";

package acme.v1;

message Customer {
  enum Kind {
    KIND_UNSPECIFIED = 0;
    KIND_1 = 1;
    KIND_2 = 2;
  }

  int32 id = 1;
  optional Address home_address = 2;
  Kind kind = 3;
}

message Address {
  string street = 1;
}
```

- The `name` meta names a message. Without it, the field name does.
- The `description` meta prints as a comment, and `deprecated` as
  `[deprecated = true]`.
- Field names print in snake_case, as the proto3 style guide asks. The wire
  only uses field numbers, so this changes nothing about the bytes.
- Well-known types print as imports.

### Unknown fields and errors

Fields your schema doesn't declare are skipped, so a sender can add fields
without breaking you. They are not kept, so decoding and then encoding drops
them. Use `S.strict` on the message to throw on them instead.

Bad input throws an `S.Error` that points to the field, and so does a value
its field's type can't hold when encoding:

```ts
const Account = S.schema({
  id: S.int32.with(S.protobufField, 1),
  address: S.optional(Address).with(S.protobufField, 2),
  tags: S.array(S.string).with(S.protobufField, 3),
});

S.decodeOrThrow(S.protobuf, Account)(new Uint8Array([8, 1, 18, 3, 10, 1, 255]));
// S.Error: Failed at address.street: Protobuf string is not valid UTF-8

S.decodeOrThrow(S.protobuf, Account)(new Uint8Array([26, 1, 97, 26, 1, 255]));
// S.Error: Failed at tags[1]: Protobuf string is not valid UTF-8

S.decodeOrThrow(Account, S.protobuf)({ id: 2 ** 40, tags: [] });
// S.Error: Failed at id: Expected int32, received 1099511627776
```

A schema that can't be a message, such as a field without a number or two
fields with the same number, throws when you create the operation.

### `ArrayBuffer` output

Encoded bytes are a view into a shared buffer, like a Node `Buffer`. To get an
`ArrayBuffer` of its own, for example to transfer it to a worker, convert
through `S.arrayBuffer`:

```ts
S.encodeOrThrow(User, S.protobuf.with(S.to, S.arrayBuffer))(user); // ArrayBuffer
S.decodeOrThrow(S.arrayBuffer.with(S.to, S.protobuf), User)(buffer);
```

### Performance and compatibility

`S.protobuf` passes 696 of the 698 binary proto3 cases of Google's conformance
suite. The two it fails need unknown fields kept through a round trip. JSON and
text formats, proto2 and extensions aren't supported.

See [Benchmarks: Protobuf](https://github.com/DZakh/sury/blob/main/docs/benchmarks/protobuf.md)
for bundle size and speed against protobuf.js, protobuf-es and pbf.

## Content

Bytes in JSON become base64. They are not mangled as UTF-8.

### Bytes in a JSON field

A field of bytes is written as base64. You do not pass pack or unpack.

```ts
S.encodeOrThrow(S.schema({ payload: S.uint8Array }), S.jsonString)({
  payload: new Uint8Array([137, 80, 78, 71]),
});
// {"payload":"iVBORw=="}
```

### A JWT segment

JWT segments are base64url. Parse the text as JSON, then as the object.

```ts
S.parseOrThrow(
  S.base64url.with(S.to, S.jsonString.with(S.to, S.schema({ sub: S.string }))),
)("eyJzdWIiOiJhIn0");
// { sub: "a" }

// The same schema, chained
S.base64url.with(S.to, S.jsonString).with(S.to, S.schema({ sub: S.string }));
```

### Switch base64 alphabets

`S.base64url` is URL-safe and has no padding.

```ts
S.base64; // standard alphabet, canonical padding
S.base64url; // URL-safe alphabet, no padding

S.parseOrThrow(S.base64.with(S.to, S.base64url), "iVBORw==");
// "iVBORw"
```

### The bytes are JSON text

```ts
S.uint8Array.with(S.to, S.jsonString, "unpack");
// decode unpack, encode pack
```

### The JSON string holds the bytes

```ts
S.uint8Array.with(S.to, S.jsonString, "pack");
// decode pack, encode unpack
```

### The string is JSON text

```ts
S.string.with(S.to, userSchema, "unpack");
// the text is read as userSchema
```

### The JSON string holds the string

```ts
S.string.with(S.to, S.jsonString, "pack");
// "hi" is stored as '"hi"'
```

### If you omit pack or unpack

Sury does not guess when both conversions exist.

```ts
S.parseOrThrow(S.uint8Array.with(S.to, S.jsonString));
// throws: Ambiguous Uint8Array -> JSON string. Should the bytes be packed or
// unpacked? Choose with S.to and "pack" or "unpack"
```

### UTF-8, the same bytes, parse, or widen

```ts
S.uint8Array.with(S.to, S.string); // UTF-8
S.base64.with(S.to, S.uint8Array); // the same bytes
S.jsonString.with(S.to, S.string); // parses
S.base64.with(S.to, S.string); // widens
```

## Meta

Use `S.meta` to add metadata to the resulting schema.

```ts
const documentedStringSchema = S.string.with(S.meta, {
  description: "A useful bit of text, if you know what to do with it.",
});

documentedStringSchema.description; // A useful bit of text...
```

This can be useful for documenting fields, generating JSON, etc.

`examples` are written in the schema's **Output** type, the same as a default passed to `S.optional`. Both are validated and stored in the **Input** type, so `schema.examples` and `schema.default` read back in wire form and land in the JSON Schema of the input side as they are; the output side's document decodes them back.

```ts
S.toInputJSONSchemaOrThrow(documentedStringSchema);
// {
//   "type": "string",
//   "description": "A useful bit of text, if you know what to do with it."
// }
```

## Brand

Add a type-only symbol to an existing type so that only values produced by validation satisfy it.

Use `S.brand` to attach a nominal brand to a schema's output. This is a TypeScript-only marker: it does not change runtime behavior. Combine it with `S.refine` (or any validation) so only validated values can acquire the brand - parsing mints one from unknown data, and [`S.makeOutputOrThrow`](#constructing-entities) from a plain value you already hold.

```ts
// Brand a string as a UserId
const userIdSchema = S.string.with(S.brand, "UserId");
type UserId = S.Infer<typeof userIdSchema>; // S.Brand<string, "UserId">

const id: UserId = S.makeOutputOrThrow(userIdSchema, "u_123"); // OK
const asString: string = id; // OK: branded value is assignable to string
// @ts-expect-error - A plain string is not assignable to a branded string
const notId: UserId = "u_123";
```

You can define brands for refined constraints, like even numbers:

```ts
const evenSchema = S.number
  .with(S.refine, (value) => value % 2 === 0, {
    error: "Expected an even number",
  })
  .with(S.brand, "even");

type Even = S.Infer<typeof evenSchema>; // S.Brand<number, "even">

const good: Even = S.makeOutputOrThrow(evenSchema, 2); // OK
// @ts-expect-error - number is not assignable to brand "even"
const bad: Even = 5;
```

For more information on branding in general, check out [this excellent article](https://www.learningtypescript.com/articles/branded-types) from [Josh Goldberg](https://github.com/joshuakgoldberg).

## Custom schema

**Sury** might not have many built-in schemas for your use case. In this case you can create a custom schema for any TypeScript type.

1. Choose a base schema which is the closest to your type. Most likely it'll be `S.instance`.
2. Use `S.to` with `{decode, encode}` codecs to add the custom conversion logic.
3. Optionally, use `S.meta` to add customize the name of the schema and additional metadata.

```ts
const mySet = <T>(itemSchema: S.Schema<unknown, T>): S.Schema<unknown, Set<T>> =>
  S.instance(Set<unknown>)
    .with(S.to, S.instance(Set<T>), {
      decode: (input) => {
        const output = new Set<T>();
        input.forEach((item, index) => {
          try {
            output.add(S.parseOrThrow(itemSchema, item));
          } catch (e) {
            if (e instanceof S.Error) {
              throw new Error(`At item ${index} - ${e.reason}`);
            }
            throw e;
          }
        });
        return output;
      },
      encode: (output) =>
        new Set([...output].map((item) => S.encodeOrThrow(itemSchema, item))),
    })
    .with(S.meta, {
      name: `Set<${S.toInputExpression(itemSchema)}>`,
    });

const numberSetSchema = mySet(S.number);
type NumberSet = S.Infer<typeof numberSetSchema>; // Set<number>

S.parseOrThrow(numberSetSchema, new Set([1, 2, 3])); // passes
S.parseOrThrow(numberSetSchema, new Set([1, 2, "3"])); // throws S.Error: At item 3 - Expected number, received "3"
S.parseOrThrow(numberSetSchema, [1, 2, 3]); // throws S.Error: Expected Set<number>, received [1, 2, 3]
```

## Recursive schemas

You can define a recursive schema in **Sury**. Unfortunately, TypeScript derives the Schema type as `unknown` so you need to explicitly specify the type and it'll start correctly typechecking.

```ts
type Node = {
  id: string;
  children: Node[];
};

const nodeSchema = S.recursive<Node>("Node", (nodeSchema) =>
  S.schema({
    id: S.string,
    children: S.array(nodeSchema),
  })
);
```

One type parameter is enough when the schema doesn't transform - `S.recursive<Node>` is `S.Schema<Node, Node>`. When the recursive schema transforms its input, pass both sides in `S.Schema<TInput, TOutput>` order:

```ts
type Row = { title: string; children: Row[] };

const rowSchema = S.recursive<unknown, Row>("Row", (rowSchema) =>
  S.schema({
    TITLE: S.string,
    CHILDREN: S.array(rowSchema),
  }).with(S.shape, (input) => ({
    title: input.TITLE,
    children: input.CHILDREN,
  }))
);
```

> 🧠 Despite supporting recursive schema, passing cyclical data will cause an infinite loop.

## Refinements

**Sury** lets you provide custom validation logic via refinements. Refinements let you define checks that are not expressible in the type system alone - for example, checking that a number is positive or that a string is a valid URL.

```ts
const positiveNumberSchema = S.number.with(S.refine, (value) => value > 0);
```

Refinement functions should return `true` to indicate success or `false` to signal failure. By default, a failed refinement throws with the message `"Refinement failed"`.

#### Custom error message

Provide a custom error message via the `error` option:

```ts
const shortStringSchema = S.string.with(S.refine, (value) => value.length <= 255, {
  error: "String can't be more than 255 characters",
});
```

#### Custom error path

When refining an object schema, you can use the `path` option to attach the error to a specific field. It is the same array `error.path` carries: strings for keys and numbers for array indices, so `["items", 0]` reports `Failed at items[0]`:

```ts
const passwordFormSchema = S.schema({
  password: S.string,
  confirm: S.string,
}).with(S.refine, (data) => data.password === data.confirm, {
  error: "Passwords don't match",
  path: ["confirm"],
});
```

#### Chaining refinements

Refinements can be chained. Each refinement is applied in order:

```ts
const evenPositiveSchema = S.number
  .with(S.refine, (val) => val > 0, { error: "Must be positive" })
  .with(S.refine, (val) => val % 2 === 0, { error: "Must be even" });
```

The refine function is applied for both parsing and encoding.

A refinement can't be async. For a check that has to await, use an async
[codec](#custom-transformations) that returns the value unchanged, and keep
`encode: "auto"` so encoding stays a plain pass:

```ts
const activeUser = S.uuid.with(S.to, S.uuid, {
  decode: {
    async: async (id) => {
      const isActiveUser = await checkIsActiveUser(id);
      if (!isActiveUser) {
        throw new Error(`The user ${id} is inactive.`);
      }
      return id;
    },
  },
  encode: "auto",
});

const userSchema = S.schema({
  id: activeUser,
  name: S.string,
});

type User = S.Infer<typeof userSchema>; // { id: string, name: string }

// Need to use S.parseAsPromiseOrReject for schemas with async transformations
await S.parseAsPromiseOrReject(userSchema)({
  id: "1",
  name: "John",
});
```

### **`shape`**

The `S.shape` schema is a helper function that allows you to transform the value to a desired shape. It'll statically derive required data transformations to perform the change in the most optimal way.

> ⚠️ Even though it looks like you operate with a real value, it's actually a dummy proxy object. So conditions or any other runtime logic won't work. Please use `S.to` for such cases.

```typescript
const circleSchema = S.number.with(S.shape, (radius) => ({
  kind: "circle",
  radius: radius,
}));

S.parseOrThrow(circleSchema, 1); //? { kind: "circle", radius: 1 }

// Also works in reverse 🔄
S.encodeOrThrow(circleSchema, { kind: "circle", radius: 1 }); //? 1
```

## Operations

### At a glance

Every operation names two things: the **verb** - what it does - and the **outcome** - what you get when it fails. Operations that look at one side of a schema say which side in their name; the conversions cross between the sides, so they keep their own names.

|           | Input side                                           | Output side                                            | Crosses both                |
| --------- | ---------------------------------------------------- | ------------------------------------------------------ | --------------------------- |
| Convert   |                                                      |                                                        | `parse`, `decode`, `encode` |
| Construct | `makeInput`                                          | `makeOutput`                                           |                             |
| Validate  | `isInput`, `isInputAsPromise`                        | `isOutput`, `isOutputAsPromise`                        |                             |
| Compare   | `isEqualInput`, `compareInput`                       | `isEqualOutput`, `compareOutput`                       |                             |
| Assert    | `assertInputOrThrow`, `assertInputAsPromiseOrReject` | `assertOutputOrThrow`, `assertOutputAsPromiseOrReject` |                             |
| Describe  | `toInputJSONSchemaOrThrow`, `toInputExpression`      | `toOutputJSONSchemaOrThrow`, `toOutputExpression`      |                             |

### Outcomes

A suffix names the failure mechanism only when the return type doesn't reveal it. `TOutput` and `Promise<TOutput>` reveal nothing, so they take `OrThrow` / `OrReject`; `Result<TOutput>` carries the failure in the type, so it takes none. `isInput` cannot fail, so it takes none either.

| Suffix | Returns | |
| --- | --- | --- |
| `OrThrow` | `TOutput` | throws `S.Error` |
| `AsResult` | `S.Result<TOutput>` | `{ success, value, error, issues }` |
| `AsPromiseOrReject` | `Promise<TOutput>` | rejects with `S.Error` - never throws synchronously |
| `AsResultPromise` | `Promise<S.Result<TOutput>>` | |
| `AsPromisableResult` | `S.Result<TOutput> \| Promise<S.Result<TOutput>>` | follows the schema's own shape |

`parse`, `decode`, `encode`, `makeInput` and `makeOutput` each take all five.

There is no promisable *throwing* variant: `Result | Promise<Result>` is already two shapes to branch on, and once you have branched you know which one you have.

```ts
S.parseOrThrow(userSchema, data);          //? { id: string }
S.parseAsResult(userSchema, data);         //? S.Result<{ id: string }>
S.decodeAsResultPromise(userSchema, data); //? Promise<S.Result<{ id: string }>>
```

`assert` keeps its `OrThrow` suffix against that rule: `assert` doesn't unambiguously mean "throws" in JS (`console.assert` logs and continues), and the async form returns `Promise<void>`, which reveals nothing.

The `Result` is compiled into the operation rather than wrapped around it, which is what lets a schema that provably cannot throw emit no `try` at all:

```ts
S.parseAsResult(S.schema({ id: S.unknown }).with(S.noValidation, true)).toString();
// => (i) => { return { success: true, value: { id: i.id }, error: void 0, issues: void 0 } }
```

Both branches of a `Result` carry the same keys in the same order, so `const { value, error } = result` narrows and a consumer's `.success` read stays monomorphic.

#### Every issue at once

A failed `Result` lists every problem in `issues`, so a form can show them all. `error` is the first one, the same error `OrThrow` would throw:

```ts
const signup = S.schema({
  email: S.email,
  password: S.string.with(S.minLength, 8),
  tags: S.array(S.string),
});

S.parseAsResult(signup, { email: "x", password: "123", tags: ["a", 1] }).issues;
// [
//   { message: 'Expected email, received "x"', path: ["email"] },
//   { message: 'Expected string.length >= 8, received "123"', path: ["password"] },
//   { message: "Expected string, received 1", path: ["tags", 1] },
// ]
```

A `Result` is a Standard Schema result, the same one [`~standard.validate`](#standard-schema) returns.

A refine on an object runs only when all its fields are valid, so it never sees a broken value:

```ts
const passwords = S.schema({ password: S.string.with(S.minLength, 8), confirm: S.string })
  .with(S.refine, (v) => v.password === v.confirm, { error: "Passwords must match" });

S.parseAsResult(passwords, { password: "123", confirm: "x" }).issues;
// [{ message: 'Expected string.length >= 8, received "123"', path: ["password"] }]
```

A union reports one issue for itself, and async fields report theirs after the sync ones (`activeUser` is the async check from [Refinements](#refinements)):

```ts
const account = S.schema({ id: activeUser, age: S.number });

(await S.parseAsResultPromise(account, { id: inactiveId, age: "x" })).issues;
// [
//   { message: 'Expected number, received "x"', path: ["age"] },
//   { message: `The user ${inactiveId} is inactive.`, path: ["id"] },
// ]
```

Every failure of the value comes back in the outcome's own shape, exceptions included: a refine or coder that throws is wrapped as `invalid_conversion` with the exception as its `cause`, and so is anything else the value raises on its way through (a getter, say). Only a defect - a schema wired wrong, which fails for every input - throws out of every outcome, at the point the operation is created.

### Call forms

Every operation takes any of four call forms, told apart by how many arguments you pass and which of them are schemas:

```ts
const parse = S.parseOrThrow(userSchema);      // compiled operation, data-last
parse(data);

S.parseOrThrow(S.jsonString, userSchema);      // a compiled chain, up to 3 schemas

S.parseOrThrow(userSchema, data);              // immediate, schema first
S.parseOrThrow(data, userSchema);              // immediate, data first
S.parseOrThrow(S.jsonString, userSchema, raw); // immediate, chain first
```

Nothing is ever probed for `undefined`, only counted - `S.parseOrThrow(S.void)` is the compiled operation, `S.parseOrThrow(S.void, undefined)` parses `undefined`.

Two schemas always read as a chain, so parsing a Sury schema **as data** is only available through the compiled form:

```ts
S.parseOrThrow(metaSchema, someSchema); // parses the schema object
```

A deeper chain is written with [`S.to`](#to). Anything that isn't a Sury schema in a schema slot - a foreign Standard Schema, or a hole - is reported rather than silently read as the data to validate.

### Pipelines

Conversion targets are schemas, not dedicated functions: `S.json`, `S.jsonString`, `S.unknown`, `S.date`, and `S.uint8Array` are ordinary schemas usable at any position in a chain.

- **`S.decodeOrThrow(from, ...intermediate, to)`** - compile a forward pipeline from one schema to another.
- **`S.encodeOrThrow(from, ...intermediate, to)`** - the same, starting from the reverse of `from`. Only the first schema is reversed: `S.encodeOrThrow(a, b)` is `S.decodeOrThrow(S.reverse(a), b)`.

Each call fuses the whole chain into a single function generated via `new Function`.

```ts
// Validate unknown input.
S.parseOrThrow(userSchema, data);

// Parse a JSON string, then validate.
S.decodeOrThrow(S.jsonString, userSchema, rawString);

// Encode a domain value all the way out to a JSON string.
S.encodeOrThrow(userSchema, S.jsonString, user);

// Decode a UTF-8 byte payload into text.
S.decodeOrThrow(S.uint8Array, S.string, bytes);
```

The same applies inside schemas via [`S.to`](#to). A field, an array element, or a tuple slot can be its own multi-stage chain:

```ts
const apiUser = S.schema({
  // Arrives as a JSON string, which is parsed and validated as an array of addresses.
  addresses: S.jsonString.with(S.to, S.array(addressSchema)),

  // Arrives as bytes, decoded as UTF-8, mapped to a Date.
  createdAt: S.uint8Array.with(S.to, S.string).with(S.to, S.date),

  // Element-level transforms work the same way.
  ids: S.array(S.string.with(S.to, S.bigint)),
});
```

`S.to` is the same compiler as `S.decodeOrThrow` / `S.encodeOrThrow`, applied at a single point in a larger schema. The whole tree - top-level operation plus every nested `S.to` - folds into one generated function.

> 🧠 `S.parseOrThrow` and `S.assertInputOrThrow` are `S.decodeOrThrow` with `S.unknown` on the input side. Asserting skips building the output, which is why it's 2-3× faster than parsing.

### Built-in operations

Every operation takes any of the four [call forms](#call-forms); the signatures below show the compiled one.

**Parse** - validate unknown data and transform it to the output type:

- `S.parseOrThrow(schema)`: `(data: unknown) => TOutput`
- `S.parseAsResult(schema)`: `(data: unknown) => S.Result<TOutput>`
- `S.parseAsPromiseOrReject(schema)`: `(data: unknown) => Promise<TOutput>`
- `S.parseAsResultPromise(schema)`: `(data: unknown) => Promise<S.Result<TOutput>>`
- `S.parseAsPromisableResult(schema)`: `(data: unknown) => S.Result<TOutput> | Promise<S.Result<TOutput>>` - one compiled operation for a schema whose async-ness you don't know. A synchronous schema answers with the `Result` itself, an async one with a promise of it; `decode`, `encode`, `makeInput` and `makeOutput` take it too.

**Decode** - transform a value the input type already describes. Type validations are skipped; refinements and transforms still run:

- `S.decodeOrThrow(schema)`: `(data: TInput) => TOutput`
- `S.decodeAsResult(schema)`: `(data: TInput) => S.Result<TOutput>`
- `S.decodeAsPromiseOrReject(schema)`: `(data: TInput) => Promise<TOutput>`
- `S.decodeAsResultPromise(schema)`: `(data: TInput) => Promise<S.Result<TOutput>>`

`S.noValidation(schema, true)` turns type validations off for a schema even under a parse. The value is trusted as it stands, including what it renders to: a `Date` under `S.jsonString` is spliced straight from `toISOString()` with no escaping, so a value that isn't a real `Date` there produces whatever text its method returns.

**Encode** - the reverse direction, exactly `S.decodeOrThrow` applied to `S.reverse(schema)`:

- `S.encodeOrThrow(schema)`: `(data: TOutput) => TInput`
- `S.encodeAsResult(schema)`: `(data: TOutput) => S.Result<TInput>`
- `S.encodeAsPromiseOrReject(schema)`: `(data: TOutput) => Promise<TInput>`
- `S.encodeAsResultPromise(schema)`: `(data: TOutput) => Promise<S.Result<TInput>>`

**Validate** - a compiled TypeScript type guard that answers instead of throwing:

- `S.isInput(schema)`: `(data: unknown) => data is TInput`
- `S.isOutput(schema)`: `(data: unknown) => data is TOutput`
- `S.isInputAsPromise(schema)` / `S.isOutputAsPromise(schema)`: `(data: unknown) => Promise<boolean>`, for a schema with an async conversion. Resolves to the answer and never rejects.

```ts
const isUser = S.isInput(userSchema);

const users = records.filter(isUser);
```

**Compare** - `S.isEqualInput(schema)` / `S.isEqualOutput(schema)` answer whether two values of that side are the same; `S.compareInput(schema)` / `S.compareOutput(schema)` answer `-1 | 0 | 1`, ascending, for `Array.prototype.sort`. 0 is exactly when `isEqual` would be true.

```ts
const eventSchema = S.schema({ kind: "click", at: S.date, path: S.string });

const isSameEvent = S.isEqualOutput(eventSchema); // compiled operation, data-last
//? (a, b) => a === b || (+a.at === +b.at && a.path === b.path)

isSameEvent(
  { kind: "click", at: new Date("2026-01-01"), path: "/a" },
  { kind: "click", at: new Date("2026-01-01"), path: "/a" },
);
// => true, two different Date objects for the same instant

S.isEqualOutput(eventSchema, a, b); // immediate, schema first
S.isEqualOutput(a, b, eventSchema); // immediate, data first
```

`kind` is a literal, so it contributes no comparison at all: a value that conforms can only hold the one it declares. Fields and elements otherwise compare by their own schemas, and a `Date` by its time, a `Set` by its members, a `FormData` by its entries in order.

`isEqual` answers for every schema. `compare` answers for the schemas that have an order: `S.string`, `S.number`, `S.bigint`, `S.boolean`, `S.date`, `S.url`, a literal, `S.optional` / `S.nullable` of one of those, an enum of one kind, and `S.tuple` of any of those. Anything else throws when the comparator is compiled.

```ts
const ascByAtPath = S.compareOutput(S.tuple([S.date, S.string]));
[[later, "b"], [at, "a"]].sort(ascByAtPath);
//=> [[at, "a"], [later, "b"]]

S.compareOutput(S.schema({ at: S.date }));
//! Can't compare { at: Date; }. Only primitives, Date, URL and tuples of them are orderable. Use isEqual for equality
```

To sort records, compare the fields you want to sort by as a tuple:

```ts
events.sort((a, b) => ascByAtPath([a.at, a.path], [b.at, b.path]));
```

Descending is the same comparator with the arguments the other way round:

```ts
events.sort((a, b) => ascByAtPath([b.at, b.path], [a.at, a.path]));
```

Both values have to be valid for the schema already - this compares, it does not validate. Use [`S.makeOutputOrThrow`](#constructing-entities) on a value you built yourself if you need it checked first.

**Assert** - validate without building an output, which makes it 2-3× faster than parsing:

- `S.assertInputOrThrow(schema, data)`: `asserts data is TInput`
- `S.assertOutputOrThrow(schema, data)`: `asserts data is TOutput`
- `S.assertInputAsPromiseOrReject(schema, data)` / `S.assertOutputAsPromiseOrReject(schema, data)`: `Promise<void>`

Only the immediate call forms narrow: TypeScript resolves an assertion signature only through a name with an explicit type annotation, so the compiled form is typed as a plain `(data: unknown) => void`.

### Constructing entities

When you already hold a value of the schema's type - one you built in code rather than received from the wire - a constructor validates it and hands it straight back, so the value keeps its identity instead of becoming a decoded clone:

```ts
const userSchema = S.schema({ id: S.string, email: S.email });
const makeUser = S.makeOutputOrThrow(userSchema);

makeUser({ id: "1", email: "billie@example.com" });
// => returns the very object it was given

makeUser({ id: "1", email: "not-an-address" });
// throws S.Error: Failed at email: Expected email, received "not-an-address"
```

`S.makeOutputOrThrow` validates a value of the schema's output type, `S.makeInputOrThrow` one of its input type. Each verb comes in all five outcomes (`OrThrow`, `AsResult`, `AsPromiseOrReject`, `AsResultPromise`, `AsPromisableResult` - see [Outcomes](#outcomes)). Make takes one schema: compiled `make(schema)`, or immediate `make(schema, data)` / `make(data, schema)`. A chain is `.with(S.to, ...)` on the schema first. The compiled form is `(Schema<TInput, TOutput>) => (TOutput) => TOutput` for the output side and `(TInput) => TInput` for the input side, with the outcome's return wrapper.

Every check the schema carries runs - types, refinements, and the conversion itself - so an entity the schema has no way to encode is rejected at construction rather than at the point it's sent:

```ts
const eventSchema = S.schema({
  at: S.string.with(S.to, S.date),
});

S.makeOutputOrThrow(eventSchema, { at: new Date("nope") });
// throws S.Error: Failed at at: Expected Date, received invalid Date
```

A branded schema is the one place a constructor takes a *narrower* value than it returns: the brand is what it mints, so it can't also be what it demands.

```ts
const userIdSchema = S.uuid.with(S.brand, "UserId");

const userId = S.makeOutputOrThrow(userIdSchema, "f81d4fae-7dec-11d0-a765-00a0c91e6bf6");
//? S.Brand<string, "UserId">
```

A branded schema used as a *field* keeps its brand in what the constructor asks for, so only a value that has already been through validation fits.

### Chaining operations

Every operation accepts up to three schemas to build a single fused pipeline. The first schema is the input side and the last is the output side; intermediate schemas act as stages. `S.encodeOrThrow` reverses only the first schema.

```ts
// Decode a JSON string into your domain type in one pass
const parseJsonString = S.decodeOrThrow(S.jsonString, userSchema);
parseJsonString('{"id":"1","name":"John"}');

// Encode your domain type to a JSON string in one pass
const stringifyUser = S.encodeOrThrow(userSchema, S.jsonString);
stringifyUser({ id: "1", name: "John" });

// Later stages run forward, as in S.decodeOrThrow
S.encodeOrThrow(S.number, S.string.with(S.to, S.number), 1); //? 1
```

### **`reverse`**

```ts
S.reverse(S.nullable(S.string));
// S.optional(S.string)
```

```ts
const schema = S.object((s) => s.field("foo", S.string));

S.parseOrThrow(schema, { foo: "bar" });
// "bar"

const reversed = S.reverse(schema);

S.parseOrThrow(reversed, "bar");
// {"foo": "bar"}

S.parseOrThrow(reversed, 123);
// throws S.Error with the message: `Expected string, received 123`
```

Reverses the schema. This gets especially magical for schemas with transformations 🪄

### **`to`**

This very powerful API allows you to coerce another data type in a declarative way. Let's say you receive a number that is passed to your system as a string. For this `S.to` is the best fit:

```ts
const schema = S.string.with(S.to, S.number);

S.parseOrThrow(schema, "123"); //? 123.
S.parseOrThrow(schema, "abc"); //? throws: Expected number, received "abc"

// Reverse works correctly as well 🔥
S.encodeOrThrow(schema, 123); //? "123"
```

#### Custom transformations

When no built-in conversion fits, pass your own `decode` and `encode`:

```ts
const schema = S.string.with(S.to, S.number, {
  decode: (string) => parseInt(string, 10),
  encode: (number) => number.toString(),
});

S.parseOrThrow(schema, "123"); //? 123
S.parseOrThrow(schema, "abc"); //? throws: Expected number, received NaN
S.encodeOrThrow(schema, 123); //? "123"
```

The result of `decode` is validated by the target schema, so a coder that
returns the wrong thing fails right there instead of leaking a bad value.

Pass `"pack"` or `"unpack"` as the third argument when both conversions exist.
See [Content](#content).

```ts
S.uint8Array.with(S.to, S.jsonString, "unpack");
// decode unpack, encode pack
```

Besides a function, each direction accepts:

```ts
// "auto": keep the built-in conversion for that direction
S.string.with(S.to, S.string, { decode: (s) => s.trim(), encode: "auto" });

// "never": this direction is impossible, fail when an operation needs it
S.string.with(S.to, S.number, { decode: (s) => s.length, encode: "never" });

// {async: fn}: run with S.parseAsPromiseOrReject / S.encodeAsPromiseOrReject
const user = S.schema({ id: S.uuid, name: S.string });

S.uuid.with(S.to, user, {
  decode: { async: (id) => loadUser(id) },
  encode: (user) => user.id,
});
```

Describe what you decode into. The target is what validates the coder's result,
types the output, and exports to JSON Schema:

```ts
const csv = S.string.with(S.to, S.array(S.string), {
  decode: (csv) => csv.split(","),
  encode: (items) => items.join(","),
});

S.parseOrThrow(csv, "a,b,c"); //? ["a", "b", "c"]
S.encodeOrThrow(csv, ["a", "b"]); //? "a,b"
```

> 🧠 `S.any` accepts anything, so it's the escape hatch for a value no schema
> can describe. It checks nothing about what the coder returns - reach for it
> last, not first.

Passing a single function is a decode-only shorthand. Encoding such a schema
fails, since Sury has no way back:

```ts
const schema = S.string.with(S.to, S.number, (string) => string.length);

S.parseOrThrow(schema, "abc"); //? 3
S.encodeOrThrow(schema); //? throws: Encoding is ambiguous when only a decode function is provided
```

> 🧠 Prefer the built-in `S.string.with(S.to, S.number)` when it does the job.

### **`name`**

```ts
const schema = S.schema({ abc: 123 }).with(S.meta, { name: "Abc" });

schema.name; // "Abc"
```

Used internally for readable error messages.

### **`toInputExpression`**

```ts
S.toInputExpression(S.schema({ abc: 123 }));
// "{ abc: 123; }"

S.toInputExpression(S.string.with(S.meta, { name: "Address" }));
// "Address"
```

Used internally for readable error messages.

> 🧠 The format is subject to change

### **`toOutputExpression`**

```ts
const schema = S.to(S.string, S.number);

S.toInputExpression(schema);
// "string"

S.toOutputExpression(schema);
// "number"
```

The same expression for the schema's output type.

> 🧠 The format is subject to change

### **`pathToText`**

```ts
S.pathToText(["user", "tags", 2]);
// "user.tags[2]"

S.pathToText(["my key"]);
// '["my key"]'
```

Renders an error's `path` array the way `error.message` shows it - dots for identifier-safe keys, brackets for indices and anything else. Useful when building your own messages from `error.path` or a Standard Schema issue's `path`.

### **`toString`**

```ts
`${S.string}`;
// "Schema<string>"

`${S.to(S.string, S.number)}`;
// "Schema<string, number>"

String(S.schema({ id: S.string, age: S.number }));
// "Schema<{ id: string; age: number; }>"
```

Both sides at once, in the order the type declares them - `Schema<TInput, TOutput>` - with the second parameter dropped when the two sides match.

`console.log(schema)` deliberately still shows the internal schema shape, which is usually what you want when you're inspecting one. Ask for the expression explicitly when you want it - `` console.log(`${schema}`) `` or `console.log("%s", schema)`.

The output side is derived through [`reverse`](#reverse), so nested transforms are reported correctly:

```ts
`${S.schema({ a: S.to(S.string, S.number) })}`;
// "Schema<{ a: string; }, { a: number; }>"
```

> 🧠 The format is subject to change

## Error handling

**Sury** throws `S.Error`, a subclass of `Error` named `SuryError`, so `instanceof` works as usual. A thrown error carries a `stack` starting at the line that called the operation; one handed back by an `AsResult` outcome or by Standard Schema has none, because nothing threw.

An async schema that fails after its first `await` rejects with one too, starting at the `await` that received it. A bare `.catch()` has no `await` to trace back through, so its stack can't name your line:

```ts
const parseId = S.parseAsPromiseOrReject(
  S.string.with(S.to, S.number, {
    decode: { async: async (id: string) => Number(id) },
    encode: String,
  }),
);

try {
  await parseId("abc");
} catch (e) {
  e.stack; // starts at the `await` above
}

parseId("abc").catch((e) => {
  e.stack; // doesn't name this line
});
```

Every error carries:

- `path` - where the failure happened, as an array of keys and indices from the root of the value (`[]` at the root, `["items", 0]` inside). `S.pathToText(path)` renders it as `items[0]`.
- `reason` - the failure itself, without the path: `Expected string, received undefined`.
- `message` - `reason` prefixed with the path when there is one: `Failed at items[0]: Expected string, received undefined`.
- `code` - which kind of failure, with extra fields per kind:
  - `"invalid_input"` - the value doesn't match. `expected` and `received` are schemas describing both sides, `input` is the value, and `unionErrors` lists each member's failure when a union rejected it.
  - `"unrecognized_key"` - a `strict` object saw a key it doesn't declare, named in `key`. One key per error.
  - `"invalid_conversion"` - a custom `decode`/`encode` threw. `from`/`to` are the schemas and `cause` is what it threw.
  - `"unsupported_decode"` - the two schemas have no conversion between them. See [When a conversion is rejected](#when-a-conversion-is-rejected).
  - `"invalid_operation"` - the schema itself can't run this way, such as an async schema under a sync operation.

```ts
try {
  S.parseOrThrow(S.schema({ items: S.array(S.string) }), { items: ["a", 1] });
} catch (e) {
  if (e instanceof S.Error) {
    e.message; // => 'Failed at items[1]: Expected string, received 1'
    e.reason; // => 'Expected string, received 1'
    e.path; // => ["items", 1]
    e.code; // => "invalid_input"
  }
}
```

Printing one shows the failure and what this value decided. `expected` and
`received` are schemas shared by every failure of the same check, so they stay
out of the way until you ask for them:

```ts
console.log(e);
// [SuryError: Failed at items[1]: Expected string, received 1] {
//   code: 'invalid_input',
//   path: [ 'items', 1 ],
//   input: 1
// }

e.expected; // => S.string
```

Or ask the operation for a result instead of an exception - the `AsResult` and
`AsResultPromise` outcomes build it into the compiled operation, so there is no
callback to wrap and nothing to remember to catch:

```ts
const result = S.parseAsResult(S.schema(false), true);

if (result.success) {
  console.log(result.value);
} else {
  console.log(result.error);
}

const asyncResult = await S.parseAsResultPromise(S.boolean, data);
```

`error` is a `S.DataError` - `invalid_input`, `unrecognized_key` or
`invalid_conversion`, all failures **of this value**, reportable to whoever
supplied it. `result.issues` lists every failure (see
[Every issue at once](#every-issue-at-once)).

A `S.DefectError` - `invalid_operation` or `unsupported_decode` - is never a
result. A schema wired wrong fails for every input, so it is the developer's
bug, not an entry in someone's form validation; it is raised where the operation
is created, which for an immediate call form is that same call.

## Global config

**Sury** has a global config that can be changed to customize the behavior of the library.

### `defaultAdditionalItems`

`defaultAdditionalItems` is an option that controls how unknown keys are handled when parsing objects. The default value is `strip`, but you can globally change it to `strict` to enforce strict object parsing.

```ts
S.global({
  defaultAdditionalItems: "strict",
})
```

### `disableNanNumberValidation`

`disableNanNumberValidation` is an option that controls whether the library should check for NaN values when parsing numbers. The default value is `false`, but you can globally change it to `true` to allow NaN values. If you parse many numbers which are guaranteed to be non-NaN, you can set it to `true` to improve performance ~10%, depending on the case.

```ts
S.global({
  disableNanNumberValidation: true,
})
```
