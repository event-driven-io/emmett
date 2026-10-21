# #174: [PROPOSAL] Object-keys introspection API
Source: https://github.com/standard-schema/standard-schema/issues/174 (state: open, created 2026-07-18T13:16:12Z, by kibertoad)

# Proposal: standardized object-keys introspection for Standard Schema

## Summary

Standard Schema gives the ecosystem one validation interface. It deliberately keeps that interface tiny, and there is no standardized, runtime way to ask an object schema *which keys it declares*.

That single missing capability forces every tool that needs an object schema's shape to reach into each library's private internals (valibot's `.entries`, zod's `.shape` / `.keyof()`, arktype's props), or to make callers hand the keys over a second time. This proposal makes the narrow case for adding an **optional, opt-in way to list an object schema's keys** to the Standard Schema spec, so consumers can read shape once, library-agnostically, the same way they already validate library-agnostically today.

We scope this intentionally to **object keys only**. A broader structural-introspection surface (nested schemas, element types, unions) is explicitly out of scope here; see [Alternatives](#drawbacks-and-alternatives).

## Motivation

Standard Schema lets a library accept a schema from any validator and call `~standard.validate` without knowing which library produced it. That neutrality holds for exactly as long as the library only needs a *value* checked. It ends the moment the library needs the schema's *shape* (the names of the fields it declares), because the interface offers no way to ask for them.

A library in that position has two options today: stay coupled to a single validator so it can read that validator's internals, or route validation through Standard Schema and then bolt a private, non-standard introspection layer onto the side to recover what the spec won't return. Neither is the outcome Standard Schema exists to produce. Two real libraries sit at opposite ends of that fork.

### message-queue-toolkit: blocked from adopting Standard Schema at all

[message-queue-toolkit](https://github.com/kibertoad/message-queue-toolkit) is a widely-used messaging abstraction over RabbitMQ, SQS, SNS, and Kafka. It validates every incoming message against a schema before a handler runs (the part Standard Schema covers), but it also *introspects those schemas*. Its `MessageSchemaContainer` reads the discriminator declared inside each message schema (a `z.literal` located by `messageTypePath`) to build a message-type → schema routing table, and configurable `messageTimestampField` / `messageDeduplicationIdField` / `messageMetadataField` name declared fields that carry transport metadata. All of that is reading schema *shape*, not validating a *value*.

Standard Schema exposes none of it, so the library reads zod directly and is pinned to zod as a result. It cannot move onto the neutral interface without vendoring an introspection extension the spec doesn't define, so it hasn't, because adopting Standard Schema today would mean surrendering a capability the library is built on. This is the gap at its starkest: a popular library that *wants* the validator-independence Standard Schema promises and is shut out of it by a missing accessor. Reading an object's declared keys is the foundational slice of exactly that missing introspection.

### toad-contracts: adopted Standard Schema, then vendored the missing piece

[toad-contracts](https://github.com/kibertoad/toad-contracts) is a contract-first API layer written entirely against Standard Schema. It never imports a concrete validator. It did go neutral, and then one feature forced it to fill the gap itself. To mount a contract as a route, it turns a path-params schema into an Express/Fastify-style pattern such as `/orgs/:orgId/users/:userId`.

Here is the mechanism, since it's the whole reason keys are needed. When an author defines a contract, they don't write the path string directly; they provide a **`pathResolver`**, a function that takes the path-param *values* and builds the concrete URL:

```ts
// The author writes this. Given values, it returns a real path.
pathResolver: ({ orgId, userId }) => `/orgs/${orgId}/users/${userId}`;

pathResolver({ orgId: "42", userId: "7" }); // => "/orgs/42/users/7"
```

That resolver is the single source of truth for the URL layout, and core deliberately never parses its string template. So to recover the route *pattern* (`/orgs/:orgId/users/:userId`) rather than a concrete URL, core calls the very same resolver, but instead of real values, it passes each parameter its own placeholder string: `orgId → ":orgId"`, `userId → ":userId"`. Substituting those in produces exactly the `:placeholder` pattern the router expects.

To build that argument object, core must know *which* parameters exist (`orgId` and `userId`) so it can hand each one its `:key` placeholder. **That list of parameter names is precisely what it reads from the schema's keys.** This is the only reason the loop below exists: it isn't iterating for iteration's sake, it's constructing a `{ orgId: ":orgId", userId: ":userId" }` argument to feed back into the author's resolver.

```ts
export const mapApiContractToPath = (routeConfig: ApiContract): string => {
  // No path params → the resolver takes no arguments; just call it.
  if (!routeConfig.requestPathParamsSchema) {
    return routeConfig.pathResolver(undefined);
  }

  // 1. Ask the schema which parameter names it declares: ["orgId", "userId"].
  // 2. Map each to its own placeholder: { orgId: ":orgId", userId: ":userId" }.
  const resolverParams = routeConfig.requestPathParamsSchema["~standard"].objectKeys
    .input()
    .reduce<Record<string, string>>((acc, key) => {
      acc[key] = `:${key}`;
      return acc;
    }, {});

  // 3. Feed those placeholders through the author's own resolver, yielding
  //    "/orgs/:orgId/users/:userId" instead of a concrete URL.
  return routeConfig.pathResolver(resolverParams);
};
```

Step 1 is the capability Standard Schema lacks. Everything else is ordinary code. The whole feature hinges on being able to ask an object schema for its declared keys.

Standard Schema cannot answer "which keys?", so toad-contracts has to define the capability itself. Rather than invent a bespoke shape, core vendors a **local copy of the exact extension proposed below**: `StandardObjectKeysV1`, a sibling interface that sits *beside* Standard Schema in the same `"~standard"` namespace. Both API contracts and message contracts depend on that one surface:

```ts
// Vendored locally today; identical to the extension proposed below.
export interface StandardObjectKeysV1<Input = unknown, Output = Input> {
  readonly "~standard": StandardObjectKeysV1.Props<Input, Output>;
}
// ...Props.objectKeys: { input(): readonly string[]; output(): readonly string[] }

/** A path-params schema: a Standard Schema that also carries object-key introspection. */
export type RequestPathParamsSchema = RequestObjectSchema & StandardObjectKeysV1;

/** A message schema whose declared field names can be enumerated for routing/projection. */
export type RoutableMessageSchema = StandardSchemaV1 & StandardObjectKeysV1;
```

And because the spec can't satisfy that interface, every schema library needs an adapter whose *only* job is to recover keys. The valibot adapter reads valibot's private `.entries` and attaches the `~standard.objectKeys` lister:

```ts
export const withObjectKeys = <TSchema extends StandardSchemaV1>(
  schema: TSchema,
): TSchema & StandardObjectKeysV1 => {
  const entries = (schema as { entries?: Record<string, unknown> }).entries;

  if (entries === null || typeof entries !== "object") {
    throw new TypeError(
      "withObjectKeys expects a valibot object schema exposing `.entries` (e.g. object({ ... })). " +
        "Wrapped schemas like pipe(object(...), ...) and non-object schemas do not expose object " +
        "keys and cannot be used for path-param mapping or message field introspection.",
    );
  }

  const keys = Object.keys(entries);
  const objectKeys: StandardObjectKeysV1.Lister = { input: () => keys, output: () => keys };
  Object.assign(schema["~standard"], { objectKeys });
  return schema as TSchema & StandardObjectKeysV1;
};
```

This works, but it is pure friction that exists solely because the spec stops one step short:

- **Every adapter re-implements it.** The zod adapter reads `.shape`; an arktype adapter its props. `StandardObjectKeysV1` is a small interface re-satisfied N times against N private surfaces, and toad-contracts has to vendor that interface itself because the spec offers no home for it.
- **It leaks the library back into "library-agnostic" code.** Authors must wrap path-param and message schemas in `withObjectKeys(...)` (or otherwise attach the keys), a step that has nothing to do with their domain and exists only to paper over a spec gap.
- **It is fragile.** `.entries` is valibot-internal and only present on plain object schemas; `pipe(object(...), ...)` loses it, hence the runtime guard above. A standardized accessor would carry the same guarantees as `validate` does.

These two libraries are not unusual. The same gap stands in front of anyone generating OpenAPI, rendering forms, deriving routing or partition keys, projecting message fields, or otherwise programming against a schema's *shape* rather than a *value*, and it pushes every one of them toward the same two bad options: couple to a validator, or vendor an extension.

## Use cases

Listing keys is a low-level operation, but a lot of tooling needs it. A partial list:

### API contracts

- **Route-pattern derivation.** Exactly the toad-contracts case: turn a path-params schema into `/users/:userId` without the author restating the keys.
- **Query-param and header documentation.** Enumerate the names a contract declares for its query string or headers to render docs, generate an OpenAPI `parameters` array, or print a human-readable contract summary, without coupling to any one library.
- **Contract self-consistency checks.** Verify at startup that a `pathResolver` template and its path-params schema agree (every `:placeholder` has a matching key, and vice versa), catching drift before it ships.

### Message and event schemas

When a schema describes a queue/stream message rather than an HTTP request, you frequently need its field *names* with no value in hand:

- **Field projection / selection.** Pick a subset of fields for an event envelope, a change-data record, or a column list for a columnar sink, driven by the schema's declared keys.
- **Routing-key / partition-key derivation.** Build a routing or partition key from named fields enumerated off the schema.
- **Partial "patch" payloads.** Iterate a schema's keys to construct or validate a partial-update message where any declared subset of fields may be present.
- **Field-to-header mapping.** Promote selected message fields onto transport metadata/headers, keyed by the schema's field names.

### Cross-cutting

- **Form and UI generation.** Render one input per declared key.
- **Masking / redaction.** Walk declared keys to decide what to drop or hash before logging.
- **Shape diffing.** Compare two schemas' key sets to detect a breaking change.

Every one of these is reachable today only via per-library internals or by asking the caller to repeat the keys the schema already knows.

## Why `validate` is not enough

A reasonable first reaction is "you already have `validate`, recover the keys from that." You can't, reliably:

- **Validation needs a value; introspection does not.** Keys are *static structure*, available before any data exists. Manufacturing a "probe" object to feed `validate` means inventing values that pass every field's constraints, generally impossible in the common case.
- **Validation transforms and strips.** A passing result reflects the *output* shape after coercion, defaulting, and unknown-key stripping, not the declared input keys. Optional keys absent from the probe simply won't appear.
- **Async schemas can't be introspected synchronously.** `~standard.validate` may return a `Promise`. Route mapping, OpenAPI emission, and form rendering are synchronous; awaiting validation just to learn field names is the wrong tool.

Keys are metadata about the schema, in the same category as `~standard.vendor`, not something to be reverse-engineered from a validation run.

## Prior art: libraries already expose this

The capability isn't speculative. Every major Standard Schema implementation already exposes object keys at runtime. Each spells it differently, which is precisely the fragmentation Standard Schema exists to remove.

**valibot.** A plain object schema exposes its key→schema map as `.entries`:

```ts
import { object, string } from "valibot";

const schema = object({ userId: string(), orgId: string() });
Object.keys(schema.entries); // ["userId", "orgId"]
```

Only plain object schemas (`object`, `strictObject`, `looseObject`, `objectWithRest`) carry `.entries`; a wrapped `pipe(object(...), ...)` does not.

**zod.** An object schema exposes `.shape`, and `.keyof()` returns an enum of its keys (both v3 and v4):

```ts
import { z } from "zod";

const schema = z.object({ userId: z.string(), orgId: z.string() });
Object.keys(schema.shape);     // ["userId", "orgId"]
schema.keyof().options;        // ["userId", "orgId"]
```

**arktype.** Object types expose their structure through the type's internal representation (props/required keys), reachable from a parsed type.

The shared takeaway: **listing an object's keys is universal and already implemented everywhere; it is simply unstandardized.** Lifting it into the spec replaces three private spellings with one public contract.

## Proposed spec extension

The spec already extends itself in exactly the way this proposal needs. The current [`@standard-schema/spec`](https://github.com/standard-schema/standard-schema/tree/main/packages/spec) defines a base `StandardTypedV1` (carrying `version` / `vendor` / `types`) and then layers optional capabilities on top as **sibling interfaces** that each declare their own `"~standard"` properties: `StandardSchemaV1` adds `validate`, and `StandardJSONSchemaV1` adds a `jsonSchema` converter. A schema library opts into a capability by *also* satisfying its interface; a consumer feature-detects by checking for the member.

This proposal adds one more sibling in that same mold: **`StandardObjectKeysV1`**. The shape mirrors `StandardJSONSchemaV1` deliberately, including the input/output split, since a schema's declared input keys and its post-transform output keys can differ. It slots into the existing package without inventing new conventions:

```ts
// References the base `StandardTypedV1` already exported by the spec; it is not redefined here.
import type { StandardTypedV1 } from "@standard-schema/spec";

/** The Standard Object Keys interface. */
export interface StandardObjectKeysV1<Input = unknown, Output = Input> {
  /** The Standard Object Keys properties. */
  readonly "~standard": StandardObjectKeysV1.Props<Input, Output>;
}

export declare namespace StandardObjectKeysV1 {
  /** The Standard Object Keys properties interface. */
  export interface Props<Input = unknown, Output = Input>
    extends StandardTypedV1.Props<Input, Output> {
    /** Methods for listing the input/output object keys. */
    readonly objectKeys: StandardObjectKeysV1.Lister;
  }

  /** The Standard Object Keys lister interface. */
  export interface Lister {
    /** Lists the declared keys of the input object shape. May throw if the schema does not describe an object. */
    readonly input: (
      options?: StandardObjectKeysV1.Options | undefined,
    ) => ReadonlyArray<string>;
    /** Lists the declared keys of the output object shape. May throw if the schema does not describe an object. */
    readonly output: (
      options?: StandardObjectKeysV1.Options | undefined,
    ) => ReadonlyArray<string>;
  }

  /** The options for the input/output methods. */
  export interface Options {
    /** Explicit support for additional vendor-specific parameters, if needed. */
    readonly libraryOptions?: Record<string, unknown> | undefined;
  }

  /** The Standard types interface. */
  export interface Types<Input = unknown, Output = Input>
    extends StandardTypedV1.Types<Input, Output> {}

  /** Infers the input type of a Standard. */
  export type InferInput<Schema extends StandardTypedV1> =
    StandardTypedV1.InferInput<Schema>;

  /** Infers the output type of a Standard. */
  export type InferOutput<Schema extends StandardTypedV1> =
    StandardTypedV1.InferOutput<Schema>;
}
```

The block above is written in the spec package's own style, so it can be dropped into `src/index.ts` as-is.

### How libraries implement it

Each library already has the data; satisfying the interface is a thin wrapper. Valibot, for example:

```ts
import type { StandardObjectKeysV1 } from "@standard-schema/spec";

const keys = Object.keys(object({ userId: string(), orgId: string() }).entries);
const objectKeys: StandardObjectKeysV1.Lister = {
  input: () => keys,
  output: () => keys, // valibot strips unknowns but keeps declared keys
};
```

### How consumers use it

Consumers feature-detect on the `objectKeys` member, the same pattern they already use to tell a plain `StandardSchemaV1` from a `StandardJSONSchemaV1`:

```ts
const hasObjectKeys = (
  schema: StandardSchemaV1,
): schema is StandardSchemaV1 & StandardObjectKeysV1 =>
  "objectKeys" in schema["~standard"];
```

Design intent:

- **Optional and additive.** It is a separate interface, exactly like `StandardJSONSchemaV1`. Nothing about existing schemas changes; non-object schemas and non-adopting libraries simply don't satisfy it, and `validate` is untouched.
- **Keys only.** Returns declared top-level property names: no nested schemas, no value types. Every library already has this, so implementation is trivial and consumer semantics are obvious.
- **Consistent with the spec's own precedent.** Same `"~standard"` namespace, same `Props`/`Types`/`InferInput`/`InferOutput` boilerplate, same input/output split as `StandardJSONSchemaV1`.
- **Already proven in the wild.** `@toad-contracts/core` vendors this exact surface locally today as `StandardObjectKeysV1`, and libraries like message-queue-toolkit stay pinned to a single validator precisely because it isn't in the spec. The demand is demonstrated, not hypothetical.

The exact name and whether the lister exposes `input`/`output` or a single accessor are open for the spec authors; this proposal argues for the *capability* and offers a faithful, spec-formatted shape.

## Drawbacks and alternatives

- **Status quo: keep adapter glue.** Every consumer keeps vendoring its own `StandardObjectKeysV1` copy + `withObjectKeys` equivalent against private internals. Workable, but it's exactly the per-library coupling Standard Schema set out to eliminate, duplicated across the ecosystem.
- **Standardize a broader introspection surface** (nested schemas, element/value types, unions, optionality). More powerful, but far larger and harder to land, and most consumers only need the key list. We deliberately keep this proposal narrow; a fuller surface can build on it later if the spec authors want it.
- **Open questions** for whichever direction is chosen: should keys include optional/absent fields (they should; they're declared); is key *order* guaranteed (insertion order is the natural, already-observed behavior); and how should object *unions* (`a | b`) report keys (likely out of scope, with `objectKeys` simply absent).

## What adoption changes

For the spec, this is a single optional sibling interface. Downstream, it closes the fork from [Motivation](#motivation): a library that introspects object shape no longer has to choose between pinning itself to one validator and vendoring a private extension. The ones blocked on that choice can move onto the neutral interface; the ones that already vendored `StandardObjectKeysV1` can drop it and re-export the type from `@standard-schema/spec` once validators satisfy it natively.


## Comment by pullfrog[bot] at 2026-07-18T13:16:15Z


<!-- PULLFROG_DIVIDER_DO_NOT_REMOVE_PLZ -->
<sup><a href="https://pullfrog.com"><picture><source media="(prefers-color-scheme: dark)" srcset="https://pullfrog.com/logos/frog-white-full-18px.png"><img src="https://pullfrog.com/logos/frog-green-full-18px.png" width="9px" height="9px" style="vertical-align: middle; " alt="Pullfrog"></picture></a>&nbsp;&nbsp;｜ [Build this ➔](https://pullfrog.com/trigger/standard-schema/standard-schema/174?action=build) ｜ [Make a plan ➔](https://pullfrog.com/trigger/standard-schema/standard-schema/174?action=plan)</sup>

## Comment by KTrain5169 at 2026-08-16T10:36:40Z

Been writing my own tools that use the Standard Schema spec. Can agree that this would be really nice, and would like to see this happen.

## Comment by fabian-hiller at 2026-09-26T22:36:38Z

Thanks for the detailed proposal! Similar requests have come up before:

- #46: standardized way to determine a schema's base type
- #109: expose `.def` metadata on `~standard`
- #7: producing and emitting schemas (shared AST)
- #11: extracting defaults from a schema
- #21 → #134: `toJSONSchema`, which led to Standard JSON Schema

My concern is that "keys only" doesn't cover the ambiguous cases (unions, intersections, records, transforms, and output keys in general), and it's the first step toward the general AST introspection we've avoided so far. It also doesn't seem to solve the message-queue-toolkit case, which needs nested introspection to find the discriminator.

Can you explain why Standard JSON Schema doesn't solve this for you? `~standard.jsonSchema.input()` already returns the object's `properties`, so reading the keys should just be `Object.keys(schema["~standard"].jsonSchema.input({ target: "draft-2020-12" }).properties)`.
