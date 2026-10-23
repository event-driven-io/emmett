# Naming a message type without `typeof`

Research for Q4 in [qa.md](../qa.md). Oskar asked whether there is something better than `export type ShoppingCartConfirmed = typeof ShoppingCartConfirmed.Type;`, and how others do it. This report lists what exists and what was checked. It doesn't pick an option.

Prototypes are in [prototypes/type-naming/](../prototypes/type-naming/), sources in [sources/type-naming/](../sources/type-naming/). Earlier evidence is in [api-ergonomics.md](api-ergonomics.md).

## Summary

`typeof` can't be shortened away in TypeScript itself. The TypeScript team declined the idea of an implicit `typeof` on purpose. Others get rid of it in one of three ways:

1. They write `typeof` once for a whole group instead of once per message (tRPC, Hono).
2. They write plain TypeScript types and let a tool generate the runtime part from them (typia, ts-json-schema-generator).
3. They write schema files and let a tool generate the TypeScript types (json-schema-to-typescript, openapi-typescript, Prisma, GraphQL Codegen).

Options 2 and 3 need a build step. Everyone else, including Zod, Valibot, ArkType, Effect and TypeBox, writes one `typeof` per type.

## 1. TypeScript won't add an implicit `typeof`

- [microsoft/TypeScript#26769](https://github.com/microsoft/TypeScript/issues/26769), "Implicit 'typeof value' where a type is expected", was closed as Declined. Ryan Cavanaugh, the TypeScript lead, wrote: "It's very much intentional that we don't this, because it creates dangerous maintenance traps". Saved as `ts-issue-26769.json`.
- [#48275](https://github.com/microsoft/TypeScript/issues/48275), "Why not to remove typeof from Typescript?", was closed with the same arguments (`ts-issue-48275.json`).
- Only `class` and `enum` declare a value and a type under one name (TS handbook, `sources/api-ergonomics/ts-handbook-declaration-merging.html`). Classes are ruled out by Q2.

## 2. One `typeof` for a whole group

You write one `typeof` for a group, and every member's type is looked up by name.

```ts
// tRPC (reported, sources/api-ergonomics/trpc-infer-types.html)
export type AppRouter = typeof appRouter;
type Inputs = inferRouterInputs<AppRouter>;
type CreatePostInput = Inputs['post']['create'];

// Hono RPC (reported, sources/api-ergonomics/hono-rpc.html)
export type AppType = typeof route;
```

The same works for Emmett definitions, with one `typeof` per module (verified, `prototypes/api-ergonomics/experiments/no-typeof.ts`, block 6):

```ts
import * as defs from './no-typeof-defs'; // a file with Event(...) definitions
export type Defs = TypesOf<typeof defs>;
const handle = (e: Defs['Opened']) => e.data.cartId;
```

Style D (`ShoppingCartEvents['ShoppingCartConfirmed']`) is the same idea, with the group defined in one `Events({...})` call instead of a module.

You get a single type through a lookup such as `Defs['Opened']`, not as a plain name such as `Opened`.

## 3. Plain TypeScript types, runtime part generated

### typia 15.1.0 (verified, `prototypes/type-naming/src/typia.ts`)

You write today's types and call typia with the type as a generic argument. At build time, a compiler plugin replaces the call with a generated validator.

```ts
export type ShoppingCartConfirmed = Event<
  'ShoppingCartConfirmed',
  { shoppingCartId: string; confirmedAt: Date },
  ShoppingCartEventMetadata
>;
export type ShoppingCartEvent = ShoppingCartConfirmed | ShoppingCartCancelled;

const validate = typia.createValidate<ShoppingCartEvent>();
typia.json.schema<ShoppingCartEvent>(); // JSON Schema
```

What the run showed:

- Validation works. The errors carry paths, for example `{"path":"$input.data.shoppingCartId","expected":"string","value":1}`.
- The validator implements Standard Schema `validate` (`~standard` keys: `version`, `vendor`, `validate`). It does not implement `~standard.jsonSchema`; the JSON Schema comes from the separate `typia.json.schema<T>()` call.
- It accepts a revived `Date` as `confirmedAt`, and the JSON Schema says `{ "type": "string", "format": "date-time" }`.
- The JSON Schema uses OpenAPI 3.1 components, and the generated names for generic aliases are long, for example `ReadonlytypeShoppingCartConfirmeddatashoppingCartIdstringconfirmedAtDate...`.
- typia 15 requires `ttsc`, a wrapper around the TypeScript 7 (Go) compiler. Stock `tsc`, `tsx` and `ts-node` don't apply the transform. Running the same file with `tsx` throws `Error on typia.createValidate(): no transform has been configured.` Bundlers need `@ttsc/unplugin`.
- The first run compiled typia's Go plugin, which typia warns can take "several minutes" on a cold cache.

### ts-json-schema-generator 2.9.0 (verified, `prototypes/type-naming/ts-json-schema-generator-output.json`)

A CLI that reads plain TypeScript types and writes JSON Schema. It doesn't change the compiler or the runtime.

```bash
npx ts-json-schema-generator --path src/types.ts --type ShoppingCartEvent
```

- It works on today's `Event<...>` types unchanged, and the definitions keep the type names (`ShoppingCartConfirmed`, `ShoppingCartEventMetadata`).
- A JSDoc comment on the type becomes `description` (`/** Shopper confirmed the cart */`).
- `Date` becomes `{ "type": "string", "format": "date-time" }`. The output is draft-07, and it took 1.6 s for this file.
- It only produces JSON Schema. Validating at runtime would need a JSON Schema validator, which wasn't tested here.

### Not tested

- `@deepkit/type` 1.0.19 provides runtime type information through a compiler plugin (reported).
- `ts-runtime-checks` 0.6.3, last published in December 2024 (npm).

## 4. Schema files, TypeScript types generated

### json-schema-to-typescript 16.0.0 (verified, `prototypes/type-naming/json-schema-to-typescript-output.ts`)

Run on the JSON Schema from section 3, it produced:

```ts
/** Shopper confirmed the cart */
export interface ShoppingCartConfirmed {
  data: { confirmedAt: string; shoppingCartId: string };
  metadata?: ShoppingCartEventMetadata;
  type: "ShoppingCartConfirmed";
}
```

- Names and descriptions survive.
- `Date` comes back as `string`, because JSON Schema has no date type.
- The union was named after the file (`TsJsonSchemaGeneratorOutput`).

Tools in the same family: openapi-typescript 7.13.0, Kubb 5.11.6, quicktype 26.0.0 and @asyncapi/modelina 5.10.1 (npm versions; not tested). Prisma, GraphQL Codegen and protobuf generators also work this way (reported).

## 5. Options that stay close to today's code

Oskar asked for options that keep today's code as it is, with plain unions (`type ShoppingCartEvent = A | B | C`) and no new helpers, and for how other tools spell the same thing. Each option below is per message, and the union stays a plain union.

| Option | One message | `typeof` | Same pattern elsewhere | Status |
|---|---|---|---|---|
| 0. Today, no schema | `type X = Event<'X', Data, Meta>` | 0 | | unchanged |
| 1. Type first, schema checked against it | today's type, plus `const X = Event<X>('X', { data, metadata })` | 0 | Effect `Data.taggedEnum<T>()`, XState `setup({ types })`, practical-fp `impl<T>()` | verified, style C |
| 2. Today's `Event<>` type also accepts a definition | `type X = Event<typeof X>` | 1 | Zod `z.infer<typeof X>`, TypeBox `Static<typeof X>`, Valibot `v.InferOutput<typeof X>` | verified, `experiments/event-of-definition.ts` |
| 3. Phantom property | `type X = typeof X.Type` | 1 | Effect `typeof X.Type`, ArkType `typeof X.infer`, Drizzle `typeof t.$inferSelect` | verified, style A |
| 4. Interface, same as 2 | `interface X extends Event<typeof X> {}` | 1 | | verified, `experiments/event-of-definition.ts` |
| 5. Build step, as an extra | today's type unchanged; schema generated from it | 0 | typia, ts-json-schema-generator | verified, sections 3 and 4 |

What the `experiments/event-of-definition.ts` check showed for options 2 and 4:

- `type ShoppingCartConfirmed = Event<typeof ShoppingCartConfirmed>` is exactly `Event<'ShoppingCartConfirmed', { shoppingCartId: string; confirmedAt: Date }, { clientId: string }>`.
- Every existing use of the type still means the same: `Event`, `Event<'X'>`, `Event<'X', Data>`, `Event<'X', Data, Meta>`, `Event<any, any, any>` (Emmett's `AnyEvent`), and `<E extends Event>` constraints. It also works with Emmett's `Decider`, and the union narrows in `switch (event.type)`. A deliberately wrong assertion fails, so the checks are real.
- It needs a change to Emmett's `Event` type: the first parameter accepts `string | definition`, and there's a guard so that `any` doesn't produce a union of both branches.
- Hovers: with a `type` alias, `ShoppingCartConfirmed` and a union containing it expand to the full shape. With the `interface` form, hovers show `interface ShoppingCartOpened` and `ShoppingCartOpened | ShoppingCartEvent` (`results/event-of-definition-hover.txt`).
- `Command<typeof X>` wasn't tested; the same change would apply.

## Open questions for Oskar

1. Is a build step (code generation or a compiler plugin) acceptable to get rid of `typeof`, given "I just want to run regular ts with types"?
2. Is one `typeof` per group or module, with types looked up by name (`Events['X']`), acceptable?
3. If neither, is one `typeof` per message the accepted cost of deriving the type from a schema?
