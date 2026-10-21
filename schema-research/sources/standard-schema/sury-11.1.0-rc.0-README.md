[![CI](https://github.com/DZakh/sury/actions/workflows/ci.yml/badge.svg)](https://github.com/DZakh/sury/actions/workflows/ci.yml)
[![sury npm](https://img.shields.io/npm/dm/sury?label=Sury)](https://www.npmjs.com/package/sury)
[![rescript-schema npm](https://img.shields.io/npm/dm/rescript-schema?label=ReScript%20Schema)](https://www.npmjs.com/package/rescript-schema)
[![license](https://img.shields.io/npm/l/sury)](https://github.com/DZakh/sury/blob/main/LICENSE)

# Sury 🧬

**Schema for everything - faster than hand-written code.**

Declare your data once, in TypeScript or ReScript. The wires it travels are schemas too, and they chain:

```ts
const signupSchema = S.schema({ id: S.bigint, email: S.email, avatar: S.blob });
type Signup = S.Infer<typeof signupSchema>;

const signupsFileSchema = S.file.with(S.to, S.jsonString).with(S.to, S.array(signupSchema));

await S.decodeAsPromiseOrReject(signupsFileSchema)(file);
// => [{ id: 7n, email: "a@b.co", avatar: Blob }], the avatar rode as base64
await S.encodeAsPromiseOrReject(signupsFileSchema)(signups);
// => a File, from the same declaration - input and return strictly typed
```

Wires today: `S.json`, `S.jsonString`, `S.formData`, `S.env`, `S.urlSearchParams`, `S.queryString`, `S.base64`, `S.base64url`, `S.uint8Array`, `S.protobuf`, `S.file` and `S.blob`. Coming next: `S.request`, `S.response`, `S.capnp`, `S.rkyv`, `S.toon`.

```sh
npm install sury
```

**API Reference:** [TypeScript](https://github.com/DZakh/sury/blob/main/docs/js-usage.md) | [ReScript](https://github.com/DZakh/sury/blob/main/docs/rescript-usage.md) | [ReScript PPX](https://github.com/DZakh/sury/blob/main/packages/sury-ppx/README.md)

**Benchmarks:** [Schema](https://github.com/DZakh/sury/blob/main/docs/benchmarks/schema.md) | [JSON Encoding](https://github.com/DZakh/sury/blob/main/docs/benchmarks/jsonString.md) | [JSON Schema](https://github.com/DZakh/sury/blob/main/docs/benchmarks/jsonSchema.md) | [Protobuf](https://github.com/DZakh/sury/blob/main/docs/benchmarks/protobuf.md)

## Sponsors

Sury's sponsors, who make the time to build it possible:

<p>
  <a href="https://rescript-association.org/"><img alt="ReScript Association" height="30" src="https://raw.githubusercontent.com/DZakh/sury/main/assets/sponsors/rescript-association.png"></a>
  &nbsp;&nbsp;&nbsp;&nbsp;
  <a href="https://envio.dev/"><img alt="Envio" height="26" src="https://raw.githubusercontent.com/DZakh/sury/main/assets/sponsors/envio.png"></a>
  &nbsp;&nbsp;&nbsp;&nbsp;
  <a href="https://www.carla.se/"><picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/DZakh/sury/main/assets/sponsors/carla-dark.png">
    <img alt="Carla" height="28" src="https://raw.githubusercontent.com/DZakh/sury/main/assets/sponsors/carla.png">
  </picture></a>
</p>

> If you want to support the development of the project, [DM me on X](https://x.com/dzakh_dev) and get your logo here as a gratitude.

## Why Sury

Describe your data model once - unions, constraints and metadata included, with a type you can actually read on hover:

```ts
import * as S from "sury"; // Tree-shakable: a schema + parse operation starts at 8.6 kB gzip

const eventSchema = S.union([
  {
    type: "user.created",
    id: S.bigint,
    tags: S.array({ name: S.string }).with(S.nonEmpty, "Add at least one tag"),
  },
  { type: "user.deleted", id: S.bigint, payload: S.json },
]).with(S.meta, { description: "User lifecycle event" });

type Event = S.Output<typeof eventSchema>;
//   ^? { type: "user.created"; id: bigint; tags: [{ name: string }, ...{ name: string }[]] }
//      | { type: "user.deleted"; id: bigint; payload: S.JSON }
```

The same schema parses and encodes - no second definition. Encoding is even faster than `JSON.stringify` - read more in [Encode, Don't Stringify: How JSON.stringify Lies to You](https://dev.to/dzakh/encode-dont-stringify-how-jsonstringify-lies-to-you-38fk):

```ts
const parseEvent = S.decodeOrThrow(S.jsonString, eventSchema);
parseEvent('{"type":"user.created","id":"42","tags":[{"name":"vip"}]}');
// => { type: "user.created", id: 42n, tags: [{ name: "vip" }] }

S.encodeOrThrow(eventSchema, S.jsonString, { type: "user.deleted", id: 7n, payload: { reason: "spam" } });
// => '{"type":"user.deleted","id":"7","payload":{"reason":"spam"}}'
```

Errors tell you exactly where to look, in wire terms - the missing `id` is a missing string:

```ts
parseEvent('{"type":"user.deleted"}');
// => throws S.Error: Failed at id: Expected string, received undefined

parseEvent('{"type":"user.created","id":"42","tags":[]}');
// => throws S.Error: Failed at tags: Add at least one tag
```

All possible ways to run your schema, with a decision required where safety matters - perfect to navigate and review agentic code:

```ts
S.parseOrThrow(eventSchema, input); // => Event, or throws S.Error
S.parseAsResult(eventSchema, input); // => { success: true, value } | { success: false, error, issues }
S.parseAsPromiseOrReject(eventSchema, input); // => Promise<Event>, rejects with S.Error
S.parseAsResultPromise(eventSchema, input); // => Promise<Result<Event>>
S.parseAsPromisableResult(eventSchema, input); // => Result<Event> for a sync schema, Promise<Result<Event>> for an async one

S.parseAsResult(input, eventSchema); // Data first works too
S.parseAsResult(S.jsonString, eventSchema, input); // A pipeline of up to three schemas
const safeParseEvent = S.parseAsResult(eventSchema); // Schema alone compiles the operation beforehand
safeParseEvent(input);
```

Need a different wire? Wrap the same model in base64url. The pipeline knows both of its ends, so `S.encodeOrThrow` and `S.decodeOrThrow` take just the schema:

```ts
const b64Event = S.base64url.with(S.to, S.jsonString.with(S.to, eventSchema));

S.encodeOrThrow(b64Event, { type: "user.deleted", id: 7n, payload: { reason: "spam" } });
// => "eyJ0eXBlIjoidXNlci5kZWxldGVkIiwiaWQiOiI3IiwicGF5bG9hZCI6eyJyZWFzb24iOiJzcGFtIn19"

S.decodeOrThrow(b64Event, "eyJ0eXBlIjoidXNlci5kZWxldGVkIiwiaWQiOiI3IiwicGF5bG9hZCI6eyJyZWFzb24iOiJzcGFtIn19");
// => { type: "user.deleted", id: 7n, payload: { reason: "spam" } }
```

Thanks to [Standard Schema](https://standardschema.dev/), the schema plugs straight into tRPC, Hono, TanStack and 28+ other libraries. `validate` reports every issue at once, ready for a form:

```ts
eventSchema["~standard"].validate({ type: "user.created", id: 7, tags: [] }).issues;
// => [
//   { message: "Expected bigint, received 7", path: ["id"] },
//   { message: "Add at least one tag", path: ["tags"] },
// ]
```

Its Standard JSON Schema extension describes the wire - and a `bigint` has no wire until you give it one:

```ts
S.enableStandardJSONSchema(); // Opt-in, so unused JSON Schema code tree-shakes away

eventSchema["~standard"].jsonSchema.input({ target: "draft-07" });
// => throws: Failed at id: Expected JSON, received bigint

S.json.with(S.to, eventSchema)["~standard"].jsonSchema.input({ target: "draft-07" });
// => { anyOf: [...], description: "User lifecycle event", ... } - with id: { type: "string" }
```

You can go the other way too: feed JSON Schema in and get a typed Sury schema back. 93% of the official draft-07 test suite passes in CI:

```ts
const emailSchema = S.fromJSONSchemaOrThrow({ type: "string", format: "email" });
//? S.Schema<string, string>

S.parseOrThrow(emailSchema, "hi@sury.dev"); // => "hi@sury.dev"
```

Recursive schemas work out of the box:

```ts
type Node = { id: string; children: Node[] };
const nodeSchema = S.recursive<Node>("Node", (nodeSchema) =>
  S.schema({ id: S.string, children: S.array(nodeSchema) }),
);
```

Renaming fields between the wire and your code is one `S.shape` call, and the encode direction follows automatically:

```ts
const userSchema = S.schema({
  USER_ID: S.string.with(S.to, S.bigint),
  USER_NAME: S.string,
}).with(S.shape, (input) => ({
  id: input.USER_ID,
  name: input.USER_NAME,
}));

S.parseOrThrow(userSchema, { USER_ID: "0", USER_NAME: "Dmitry" });
// => { id: 0n, name: "Dmitry" }
S.encodeOrThrow(userSchema, { id: 0n, name: "Dmitry" });
// => { USER_ID: "0", USER_NAME: "Dmitry" }
```

The other side of the wire is yours too. A constructor checks a value you built in code - refinements included, and whether the schema can encode it - and hands back the very object it was given. For a branded schema, it's how the brand gets minted:

```ts
const makeEvent = S.makeOutputOrThrow(eventSchema);

makeEvent({ type: "user.deleted", id: 7n, payload: { reason: "spam" } });
// => the object you passed in, checked

makeEvent({ type: "user.created", id: 7n, tags: [] });
// => throws S.Error: Failed at tags: Add at least one tag

const userIdSchema = S.uuid.with(S.brand, "UserId");
const userId = S.makeOutputOrThrow(userIdSchema, "f81d4fae-7dec-11d0-a765-00a0c91e6bf6");
//? S.Brand<string, "UserId">
```

The same schema lets you compare your values, fast and safe:

```ts
const sessionSchema = S.schema({ kind: "session", id: S.string, startedAt: S.date });

S.isEqualOutput(
  sessionSchema,
  { kind: "session", id: "s1", startedAt: new Date("2026-01-01") },
  { kind: "session", id: "s1", startedAt: new Date("2026-01-01") },
);
// => true, two Date objects for the same instant

const isSameSession = S.isEqualOutput(sessionSchema);
//? (a, b) => a === b || (a.id === b.id && +a.startedAt === +b.startedAt)

const ascByStart = S.compareOutput(S.date);
sessions.sort((a, b) => ascByStart(a.startedAt, b.startedAt));
```

Every operation that looks at one side of a schema says which side in its name - `S.makeOutputOrThrow` and `S.isInput`, `S.toInputJSONSchemaOrThrow` for the wire and `S.toOutputJSONSchemaOrThrow` for your types.

Reading a `File` is asynchronous, so a pipeline that starts from one becomes async too:

```ts
const configSchema = S.file.with(S.to, S.jsonString.with(S.to, S.schema({ theme: S.string })));

await S.parseAsPromiseOrReject(configSchema, new File(['{"theme":"dark"}'], "config.json"));
// => { theme: "dark" }
```

No need for a separate library to decode your env vars:

```ts
const envSchema = S.schema({
  PORT: S.port,
  DEBUG: S.boolean,
  NAME: S.nullable(S.string),
});

S.decodeOrThrow(process.env, S.record(S.env), envSchema);
// { PORT: "8080", DEBUG: "true" } => { PORT: 8080, DEBUG: true, NAME: null }
```

Some data arrives in awkward layouts - like the columnar arrays that [boost Postgres INSERT performance by 2x](https://www.timescale.com/blog/boosting-postgres-insert-performance). Describe the layout instead of writing glue code, and `S.compactColumns` turns columns into rows and back:

```ts
const rows = S.compactColumns(S.json).with(S.to, S.array({ id: S.bigint, city: S.string }));

S.decodeOrThrow(rows, [["1", "2"], ["Tbilisi", "Batumi"]]);
// => [{ id: 1n, city: "Tbilisi" }, { id: 2n, city: "Batumi" }]
S.encodeOrThrow(rows, [{ id: 1n, city: "Tbilisi" }, { id: 2n, city: "Batumi" }]);
// => [["1", "2"], ["Tbilisi", "Batumi"]]
```

A form submission is strings, files and missing checkboxes. `S.formData` reads it as what you declared, and builds the body you post back:

```ts
const signup = S.formData.with(
  S.to,
  S.schema({
    name: S.string.with(S.nonEmpty),
    age: S.number, // "42" -> 42
    agree: true, // a checkbox that has to be ticked
    newsletter: S.optional(S.boolean), // tri-state: absent -> undefined
    role: S.union(["admin", "user"]),
    tags: S.array(S.string), // every "tags" entry
    avatar: S.file,
    prefs: S.jsonString.with(S.to, S.schema({ theme: S.string })),
  }),
);

S.decodeOrThrow(signup)(await request.formData());
// => { name: "Ann", age: 42, agree: true, newsletter: undefined, role: "user",
//      tags: ["a", "b"], avatar: File, prefs: { theme: "dark" } }

S.encodeOrThrow(signup)(value);
// => a FormData with one append per field, ready for fetch(url, { body })
```

Protocol Buffers need no `.proto` file and no code generation step. Number the fields, name `S.protobuf` as the other side, and the same schema still parses, infers types and converts to JSON Schema:

```ts
const userSchema = S.schema({
  id: S.int32.with(S.protobufField, 1),
  name: S.string.with(S.protobufField, 2),
  tags: S.array(S.string).with(S.protobufField, 3),
}).with(S.meta, { name: "User" });

S.encodeOrThrow(userSchema, S.protobuf, { id: 150, name: "Ada", tags: ["ml"] });
// => Uint8Array [8, 150, 1, 18, 3, 65, 100, 97, 26, 2, 109, 108]

S.decodeOrThrow(S.protobuf, userSchema, bytes);
// => { id: 150, name: "Ada", tags: ["ml"] }

S.toProtoOrThrow(userSchema, { package: "acme.v1" }); // hand the other side its .proto
// => message User {
//      int32 id = 1;
//      string name = 2;
//      repeated string tags = 3;
//    }
```

### The code a schema turns into

Here's what `parseEvent` from above actually runs - a function specialized for this exact shape: the union dispatches on the discriminant, the `bigint` coercion is inlined as a bare `BigInt()` call, your `nonEmpty` message is a plain length check, and `S.jsonString` -> union -> fields fuse into one pass:

```js
(i) => {
  let v0;
  try {
    v0 = JSON.parse(i);
  } catch (t) {
    e[0](i);
  }
  if (typeof v0 === "object" && v0 && !Array.isArray(v0)) {
    for (;;) {
      if (v0.type === "user.created") {
        let v2 = v0.id, v3 = v0.tags;
        typeof v2 === "string" || e[2](v2);
        let v1;
        try {
          v1 = BigInt(v2);
        } catch (_) {
          e[1](v2);
        }
        Array.isArray(v3) || e[6](v3);
        // ...validates each tag, tracking the error path
        v8.length > 0 || e[5](v8); // e[5] throws your nonEmpty message
        v0 = { type: v0.type, id: v1, tags: v8 };
        break;
      }
      if (v0.type === "user.deleted") {
        // ...one branch per variant, no loop over union members
      }
      e[9](v0);
    }
  } else {
    e[10](v0);
  }
  return v0;
};
```

The encoder gets the same treatment right below - and that's why Sury tends to outrun even hand-rolled validation ([benchmarks](#comparison)).

### Encoding vs `JSON.stringify`

The encoder builds the JSON text directly - no intermediate object, the structure baked in as literals, and `JSON.stringify` left only the free-form `payload`:

```js
(i) => {
  if (typeof i === "object" && i && !Array.isArray(i)) {
    for (;;) {
      // ...one branch per variant
      if (i.type === "user.deleted") {
        let v6 = JSON.stringify(i.payload);
        let v7 = '{"type":"user.deleted","id":"' + i.id + '"';
        if (v6 !== void 0) {
          v7 += ',"payload":' + v6;
        }
        i = v7 + "}";
        break;
      }
    }
  }
  return i;
};
```

And the values `JSON.stringify` silently corrupts throw instead:

```ts
JSON.stringify({ price: Infinity });
// => '{"price":null}'

S.encodeOrThrow(S.schema({ price: S.number }), S.jsonString, { price: Infinity });
// => throws S.Error: Failed at price: Expected JSON, received Infinity
```

| Encode to JSON string                 | **Sury**    | `JSON.stringify` | fast-json-stringify |
| ------------------------------------- | ----------- | ---------------- | ------------------- |
| API response (user profile, 7 fields) | **305 ns**  | 590 ns           | 382 ns              |
| Event feed (50 tagged-union events)   | **5.05 µs** | 7.82 µs          | 20.26 µs            |
| `bigint` id + binary payload + `Date` | **1.17 µs** | 1.51 µs          | 1.45 µs             |

And 3.2× lighter than fast-json-stringify - 18.0 kB against 56.9 kB, encoder included.

## Comparison

Sury shines in a lot of different aspects, so each of them gets a comparison page of its own:

- [Schema](https://github.com/DZakh/sury/blob/main/docs/benchmarks/schema.md) - describe a shape, check a value against it, read the type on hover. Against Zod, TypeBox, Valibot and ArkType.
- [JSON Encoding](https://github.com/DZakh/sury/blob/main/docs/benchmarks/jsonString.md) - turn a value into JSON text and read it back. Against `JSON.stringify` and fast-json-stringify.
- [JSON Schema](https://github.com/DZakh/sury/blob/main/docs/benchmarks/jsonSchema.md) - emit JSON Schema, and read somebody else's back. Against Zod, TypeBox, ArkType and Ajv.
- [Protobuf](https://github.com/DZakh/sury/blob/main/docs/benchmarks/protobuf.md) - the Protocol Buffers wire, without a `.proto` file or a codegen step. Against protobufjs, protobuf-es and pbf.

Don't take my word for it. Sury is measured by other people too:

- [typescript-runtime-type-benchmarks](https://moltar.github.io/typescript-runtime-type-benchmarks/) - every library in the ecosystem on the same object, in one chart
- [schemabenchmarks.dev](https://schemabenchmarks.dev/) - where the time goes, step by step: download, initialization, validation, parsing, Standard Schema, codec
- [json-schema-compliance-suite](https://github.com/sinclairzx81/json-schema-compliance-suite) - how much of JSON Schema a library actually gets right

## Integrations

Use Sury anywhere a schema is accepted:

- [tRPC](https://trpc.io/docs/server/validators#with-sury), [TanStack Form](https://tanstack.com/form), [TanStack Router](https://tanstack.com/router), [Hono](https://hono.dev/), and 28+ more via the [Standard Schema](https://standardschema.dev/) spec
- Anything that speaks [JSON Schema](https://json-schema.org/), via `S.toInputJSONSchemaOrThrow` / `S.fromJSONSchemaOrThrow`
- [nuqs](https://nuqs.dev/docs/parsers/community/sury) - turn a schema into a search param parser

## Used by

- [HyperIndex](https://github.com/enviodev/hyperindex) - Envio's blockchain indexing framework, which uses Sury to power native high-performance external calls
- [rescript-rest](https://github.com/DZakh/rescript-rest) - RPC-like client, contract, and server implementation for a pure REST API
- [rescript-envsafe](https://github.com/DZakh/rescript-envsafe) - makes sure you don't accidentally deploy apps with missing or invalid environment variables
- [rescript-stripe](https://github.com/enviodev/rescript-stripe) - describe and manage Stripe billing in a declarative way with code
- Internal form library at [Carla](https://www.carla.se/)

Building something with Sury? [Let me know](https://x.com/dzakh_dev) and I'll add it here.

## FAQ

### Is `new Function` safe to use?

Yes. It's the same technique TypeBox, Zod v4 and ArkType use, and it's where much of the speed comes from ([the code a schema turns into](#the-code-a-schema-turns-into)). Cloudflare Workers allows `new Function` during Worker startup (the default since compatibility date 2025-06-01), so schemas and operations created at the top level work there.

There's currently no eval-free mode, so Sury won't run where dynamic code evaluation is forbidden: pages under a strict CSP without `'unsafe-eval'`, some browser extension contexts, and a few restricted edge runtimes. If that's your environment, [Valibot](https://valibot.dev/) is the honest recommendation today.

### Why "Sury"?

It's short, it's pronounceable, and the 🧬 fits: a schema is the DNA of your data - one definition that everything else is derived from.

## Resources

- Standard JSON Schema vs JSON Schema ([Dev.to](https://dev.to/dzakh/standard-json-schema-vs-json-schema-54fc))
- Encode, Don't Stringify: How JSON.stringify Lies to You ([Dev.to](https://dev.to/dzakh/encode-dont-stringify-how-jsonstringify-lies-to-you-38fk))
- Making my TypeScript types 15.7x faster ([Dev.to](https://dev.to/dzakh/making-my-typescript-types-157x-faster-4gcg))
- Welcome Sury - The fastest schema with next-gen DX ([Dev.to](https://dev.to/dzakh/welcome-sury-the-fastest-schema-with-next-gen-dx-5gl4))
- ReScript Schema unique features ([Dev.to](https://dev.to/dzakh/javascript-schema-library-from-the-future-5420))
- Building and consuming REST API in ReScript with rescript-rest and Fastify ([YouTube](https://youtu.be/37FY6a-zY20?si=72zT8Gecs5vmDPlD))

## Contributing

Bug reports, ideas, and pull requests are all welcome - open an [issue](https://github.com/DZakh/sury/issues) to get started.

## License

[MIT](https://github.com/DZakh/sury/blob/main/LICENSE)
