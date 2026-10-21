# API ergonomics: define once, get value, type, factory and union

This is research for Q2 in [qa.md](../qa.md). It compares the options side by side and doesn't pick one; the decisions Oskar would need to make are at the end.

## Summary

We wrote the same shopping cart (4 events, 4 commands, metadata, dates, unions, `decide` and `evolve`) in ten ways, then compiled and ran each one. This section shows what the ways look like and how they differ. It doesn't pick one.

### The problem every style has to solve

Today an event is only a type:

```ts
type ShoppingCartConfirmed = Event<
  'ShoppingCartConfirmed',
  { shoppingCartId: string; confirmedAt: Date },
  ShoppingCartEventMetadata
>;
```

To validate or produce JSON Schema, the event has to exist at runtime too, so it becomes a value:

```ts
const ShoppingCartConfirmed = Event('ShoppingCartConfirmed', {
  data: { shoppingCartId: s.string(), confirmedAt: s.date() },
  metadata: ShoppingCartEventMetadata,
});
```

But `evolve` and `decide` still need the type, for example `(state, event: ShoppingCartConfirmed) => ...`. TypeScript refuses to use a `const` as a type:

```text
error TS2749: 'ShoppingCartConfirmed' refers to a value, but is being used as a type here.
Did you mean 'typeof ShoppingCartConfirmed'?
```

So each style needs some way to get the type back. There are only three:

1. Add a line that pulls the type out of the value, using the `typeof` keyword (styles A, B, D, E).
2. Write the type by hand, as today, and have the compiler check that the schema matches it (style C).
3. Make the event a `class`. A class is the only construct that is a value and a type at the same time (style F).

### The same event in each style

**A: built-in schema, plus a `typeof` line.**

```ts
export const ShoppingCartConfirmed = Event('ShoppingCartConfirmed', {
  data: { shoppingCartId: s.string(), confirmedAt: s.date() },
  metadata: ShoppingCartEventMetadata,
});
export type ShoppingCartConfirmed = typeof ShoppingCartConfirmed.Type;
```

**B, B2 to B5: the same as A, with another library's schema.** Zod, Valibot, ArkType, Effect, TypeBox. Only the `data` part changes:

```ts
data: z.object({ shoppingCartId: z.string(), confirmedAt: isoDate }),
```

**C: type first.** You write today's type, then the schema. If they disagree, it doesn't compile.

```ts
export type ShoppingCartConfirmed = Event<
  'ShoppingCartConfirmed',
  { shoppingCartId: string; confirmedAt: Date },
  ShoppingCartEventMetadata
>;
export const ShoppingCartConfirmed = Event<ShoppingCartConfirmed>('ShoppingCartConfirmed', {
  data: { shoppingCartId: s.string(), confirmedAt: s.date() },
  metadata: ShoppingCartEventMetadata,
});
```

**D: grouped.** All events of a stream in one call, two `typeof` lines for the whole group.

```ts
export const ShoppingCartEvent = Events(
  {
    ProductItemAddedToShoppingCart: { /* ... */ },
    ShoppingCartConfirmed: { shoppingCartId: s.string(), confirmedAt: s.date() },
    // ...
  },
  { metadata: { clientId: s.string() } },
);
export type ShoppingCartEvent = typeof ShoppingCartEvent.Type;   // the union
export type ShoppingCartEvents = typeof ShoppingCartEvent.Types; // single events, as ShoppingCartEvents['ShoppingCartConfirmed']
```

**E: interface.** Like A, but the type line is an interface.

```ts
export const ShoppingCartConfirmed = Event('ShoppingCartConfirmed', { /* as in A */ });
export interface ShoppingCartConfirmed extends Event.Of<typeof ShoppingCartConfirmed> {}
```

**F: class.** No type line, but events are created with `new`.

```ts
export class ShoppingCartConfirmed extends EventClass('ShoppingCartConfirmed', {
  data: { shoppingCartId: s.string(), confirmedAt: s.date() },
  metadata: ShoppingCartEventMetadata,
}) {}
```

### How `decide` changes

Today `decide` returns an object literal. Every other style calls the definition instead, and F needs `new`:

```ts
// today
return { type: 'ShoppingCartConfirmed', data: { shoppingCartId, confirmedAt: metadata.now }, metadata: { clientId } };

// A, B, C, D, E
return ShoppingCartConfirmed({ shoppingCartId, confirmedAt: metadata.now }, { clientId });

// F
return new ShoppingCartConfirmed({ shoppingCartId, confirmedAt: metadata.now }, { clientId });
```

Because the generated types are compatible with today's, returning an object literal should still compile in A to E. We didn't test that for the class style, F.

### Other differences that showed up

- **Editor tooltips.** Hovering over `ShoppingCartEvent` in today's code, C, E and F shows `ProductItemAddedToShoppingCart | ProductItemRemovedFromShoppingCart | ...`. In A, B and D it shows the full field list of all four events instead of their names.
- **Length.** Compared with today's definitions: D is 12% shorter, F 31% longer, A about 50% longer, E and the library styles 60 to 85% longer, C 94% longer (you write both the type and the schema).
- **Dates.** Emmett's serializer already turns ISO strings into `Date` objects when reading events. Only the built-in `s.date()` accepts both a string and a `Date`. The Zod, Valibot, ArkType, Effect and TypeBox date schemas we tried reject an existing `Date`.
- **Classes.** With F, forgetting `new` is a compile error, and an event read back from the store is a plain object, so `instanceof ShoppingCartConfirmed` is false.
- **Bundle size** depends on the schema library, not on the style. One event with the built-in schema adds about 4 KB to a bundle. Valibot adds 6 KB, TypeBox and ArkType about 150 KB, Effect 250 KB, Zod 450 KB.
- **TypeBox is slow to type-check** through Emmett's adapter: 3 to 6 seconds for this one file, against well under a second for the others. We didn't find a fix.
- **Backward compatibility** doesn't separate the styles. In all ten, the generated types can be passed wherever today's `Event<>` types and `Decider` are expected.

Full code for every style is in [api-ergonomics-examples.md](api-ergonomics-examples.md). The measurements behind each point are in [Key findings](#key-findings), and the decisions are in [Open questions for Oskar](#open-questions-for-oskar).

The research subagent wrote this report, and the main session saved it here, because the harness blocks subagents from writing report files. Each style's full definitions are in [api-ergonomics-examples.md](api-ergonomics-examples.md), generated from the type-checked files. The code and captured outputs are in [prototypes/api-ergonomics/](../prototypes/api-ergonomics/): styles in `styles/`, logs in `results/`. Sources are in [sources/api-ergonomics/](../sources/api-ergonomics/).

**How to read the evidence:**

- "verified" means compiled with tsc, run with tsx, or read in the package source. "reported" means taken from the docs.
- Versions: TypeScript 6.0.3 (the version in Emmett's `src/package.json`), cross-checked with 7.0.2; zod 4.6.5, valibot 1.5.0, arktype 2.2.7, effect 4.0.0, typebox 1.3.34, @standard-schema/spec 1.1.0, RTK 2.13.0, ts-pattern 5.9.0, xstate 5.33.2, inngest 4.21.1, drizzle-orm 0.45.3, typesafe-actions 5.1.0, unionize 3.1.0, @practical-fp/union-types 1.5.1, ts-adt 2.1.2, esbuild 0.28.2.
- Emmett's own types and functions come from the built `src/packages/emmett/dist`, linked into the prototype as a `file:` dependency.

## Key findings

1. **`typeof` can't be avoided without classes.** Only `class` and `enum` create a value and a type under one name (TS handbook table, `ts-handbook-declaration-merging.html`). Verified error: `error TS2749: 'Confirmed7' refers to a value, but is being used as a type here. Did you mean 'typeof Confirmed7'?`.
2. **Every surveyed library with a runtime definition uses `typeof`.** Examples: Effect `typeof S.Type`, ArkType `typeof T.infer`, Zod `z.infer<typeof S>`, Valibot `v.InferOutput<typeof S>`, TypeBox `Static<typeof T>`, Drizzle `typeof t.$inferSelect`, Elysia `typeof T.static`, unionize `UnionOf<typeof A>`, typesafe-actions `ActionType<typeof actions>`.
   - The exceptions are classes (Effect `Schema.Class` and `TaggedClass`) and type-first designs, where the type is written by hand and the runtime part is derived from it (Effect `Data.taggedEnum<T>()`, practical-fp `impl<T>()`, XState `setup({ types })`).
3. **All ten styles compile, run and interoperate (verified).** TypeScript 6.0.3 and 7.0.2 both exit 0. `experiments/compat-all.ts` proves mutual assignability with today's unions, and every style's `decider` fits `Decider<ShoppingCart, TodayCommand, TodayEvent>`.
4. **Strict type identity holds only for type-first (C).** Elsewhere the only difference is that today's `PricedProductItem = ProductItem & {unitPrice}` is an intersection, while schemas infer a flattened object. This doesn't affect assignability (`results/strict-identity.txt`).
5. **Size varies a lot by style.** Event and command definition sections, non-whitespace characters, compared with today:

   | Style | Change |
   |---|---|
   | D, grouped | −12% |
   | F, classes | +31% |
   | A, built-in | +52% |
   | B, Zod | +64% |
   | B2, Valibot | +65% |
   | B3, ArkType | +58% |
   | B4, Effect | +78% |
   | B5, TypeBox | +85% |
   | E, interface | +64% |
   | C, type first | +94% |

   Today has no runtime schema at all, so it is the floor, not a fair competitor.
6. **Only the built-in `s.date()` handles both forms of a date (verified, `experiments/date-roundtrip.ts`).** It accepts an ISO string and a `Date` revived by Emmett's `JSONSerializer` (`parseDates: true`). The Zod, Valibot, ArkType, Effect and TypeBox string-to-Date transforms reject a `Date`; Zod, for example, says "Invalid input: expected string, received Date".
   - Zod's `z.date()` throws "Date cannot be represented in JSON Schema".
   - Plain Valibot and Effect's `Schema.toStandardSchemaV1` expose no `jsonSchema`, so the data schema came out as `{}`.
7. **Interfaces, type-first and classes keep names in hovers.** The `typeof X.Type` aliases hover as the full `Readonly<{...}> & { readonly kind?: "Event" }` shape. Unions hover as four expanded `Event<...>` blocks, even when written as `A | B | C | D` of aliases. Today, C, E and F hover as `type ShoppingCartEvent = ProductItemAddedToShoppingCart | ProductItemRemovedFromShoppingCart | ShoppingCartConfirmed | ShoppingCartCancelled`.
8. **Compile cost is low except for the TypeBox adapter.** Type instantiations per style, with the shared lib alone at 4,339:

   | Style | Instantiations |
   |---|---|
   | today | 692 |
   | A, built-in | 8,200 |
   | B, Zod | 9,897 |
   | B2, Valibot | 11,595 |
   | B3, ArkType | 28,136 |
   | B4, Effect | 11,352 |
   | B5, TypeBox | 1,333,875 (3 to 6 s check time) |
   | C, type first | 6,413 |
   | D, grouped | 8,076 |
   | E, interface | 8,330 |
   | F, classes | 9,211 |

   - Plain TypeBox costs 3.6K. Calling `Value.Decode` with a wide `TSchema` cost 1.31M by itself; the agent fixed that in the adapter with an `as never` cast.
   - The rest of the cost is TypeBox's generic types being related to `Event()`'s constraint (a trace shows 2.7 s in `getVariancesWorker`, marked "unreliable"). No fix was found.
   - TypeScript 7.0.2 checks the TypeBox style in 1.3 s, and style A in 0.019 s.
9. **Bundle size depends on the schema library, and nothing tree-shakes.** One event factory, minified, Emmett external:

   | Style | Bytes |
   |---|---|
   | today | 146 |
   | built-in (A, C, D, E, F) | about 4,200 |
   | Valibot | 6,098 |
   | TypeBox | 153,174 |
   | ArkType | 157,797 |
   | Effect | 249,412 |
   | Zod (classic import) | 455,849 |

   Unused definitions in the same module stay in the bundle. Neither `/* @__PURE__ */` nor `/* @__NO_SIDE_EFFECTS__ */` removed them (verified with esbuild); the cause is unconfirmed. Zod Mini was not measured.
10. **`isolatedDeclarations` breaks every schema-first style.** Today's file gets 0 errors; styles A through F get 7 to 9 `TS9010`/`TS9013` errors each. Emmett doesn't enable this option today.
11. **Partial type-argument inference doesn't exist (verified with RTK).** `createAction<number>('counter/increment')` widens `.type` to `string`; the literal survives only with `createAction<number, 'counter/increment'>`. That limits any `Event<Data>('Name', ...)` design.
12. **Classes have extra costs (verified).**
    - Forgetting `new` fails with `TS2348 ... Did you mean to include 'new'?`.
    - `instanceof` is false after a JSON round trip, so events read from a store are plain objects.
    - Serialized property order changes.
    - `Events(...)` doesn't accept classes, so `canHandle` lists `X.type` by hand.
13. **Runtime pitfalls that any design needs to handle.**
    - Callable schemas: ArkType types and Effect schemas are functions, so a "schema or record of field schemas" shorthand must detect `~standard` on functions too. The agent's first version got this wrong and reported issues like `path:["data","fields"]`.
    - Issue shapes: vendors differ. ArkType returns whole error objects with internal context, and Valibot uses `{key}` path segments. The prototype normalizes to `{ message, path }`.
14. **Effect RPC uses the same shorthand.** `Rpc.make` accepts a payload that "can be either a schema or struct fields", the same as the prototype's `data: { field: s.string() }` (verified in `effect/dist/rpc/Rpc.d.ts`).

## Survey

The table has the "verified" or "reported" status per row. The compiling samples are in `survey/*.ts`.

| Library | Type of one message | Union | Factory | Guard / match | Value and type share a name? |
|---|---|---|---|---|---|
| Effect 4 | `typeof S.Type` / `.Encoded` | `Schema.Union([...]).pipe(Schema.toTaggedUnion('_tag'))`, `Schema.TaggedUnion({...})` | `S.make` | `U.match`, `U.guards.X` | Only `Schema.Class` / `TaggedClass` (verified) |
| Effect Data | hand-written `Data.TaggedEnum<{...}>` | same | `Data.taggedEnum<T>()` | `$is`, `$match` | type first (verified) |
| ArkType | `typeof T.infer` / `.inferIn` | `A.or(B)`; `scope({...}).export()` with string names | the type itself | | no (verified) |
| Zod | `z.infer<typeof S>` | `z.discriminatedUnion` | no | `z.getDiscriminatedOption` | no (verified) |
| Valibot | `v.InferOutput<typeof S>` | `v.variant` | no | | no (verified) |
| TypeBox | `Static<typeof T>` | `Type.Union` | no | `Value.Check` | no (verified) |
| Drizzle | `typeof t.$inferSelect` | | | | no (verified) |
| RTK | `ReturnType<typeof a>`, `a.type` | | `createAction` | `a.match` | no (verified) |
| ts-pattern | `P.infer<typeof p>` | | | `match().exhaustive()`, `isMatching` | no (verified) |
| XState | `setup({ types: { events: {} as A \| B } })` | | | | type first (verified) |
| Inngest | `ReturnType<typeof def.create>` (no helper) | | `def.create` | | no; a class instance that rejects transforms via `AssertNoTransform` (verified) |
| typesafe-actions | `ActionType<typeof actions>` | same | | | no (verified) |
| unionize | `UnionOf<typeof Actions>` | one record defines it | `Actions.X` | `Actions.match` | no (verified) |
| practical-fp | `Variant<...>` | | `impl<T>()` | `matchExhaustive` | type first (verified) |
| ts-adt | `ADT<{...}>` | | | `matchI` | type only (verified) |
| tRPC | `inferRouterInputs` | | | | reported |
| Hono | `InferResponseType` | | | | reported |
| Elysia | `typeof T.static`, `UnwrapSchema` | | | | reported |
| oRPC | inferred from `.input()` / `.output()` | | | | reported |
| Trigger.dev | payload inferred in `run` | | | | reported |
| mitt, ts-event-bus | type-first event maps | | | | reported; ts-event-bus is unmaintained |

## Options for naming the type

| Option | `typeof` needed | Result |
|---|---|---|
| Phantom property, `type X = typeof X.Type` | 1 per type | hover shows the expanded shape |
| Helper, `Event.Of<typeof X>` | 1 per type | hover shows the expanded shape |
| `interface X extends Event.Of<typeof X> {}` | 1 per type | hover shows the name |
| `interface X extends typeof X.Type {}` | | TS1109 |
| Type first, `type X = Event<...>` plus `Event<X>('X', ...)` | 0 | identical to today's types; schema mismatches are compile errors |
| Grouped, `typeof G.Type` and `typeof G.Types` | 2 per union | members reached as `G['X']` |
| One `typeof` per module (`TypesOf<typeof import(...)>`) | 1 per module | works |
| Namespace merged with a function | | the type lives at `X.Type`, not `X` |
| Class | 0 | `new` required |
| Codegen | | not tested |
| `declare module` | | can't turn a value into a type (reasoned, not tested) |

## Prototype

- `lib/schema.ts`: the built-in builder `s` (`string`, `number`, `boolean`, `date`, `literal`, `array`, `optional`, `object` with `.extend`). Every schema implements `~standard.validate` and `~standard.jsonSchema`.
- `lib/message.ts`: `Event()` and `Command()` return a callable factory with `type`, `kind`, `Type`, `is()`, `validate()` and `toJSONSchema()`, with a type-first overload. `Events()` / `Commands()` build unions with `types` for `canHandle`, or define a whole group in one call.
- `lib/classes.ts` and `lib/typebox.ts`: the class style (F) and the TypeBox adapter.

The styles are in `styles/{today, a-builtin, b-zod, b2-valibot, b3-arktype, b4-effect, b5-typebox, c-type-first, d-grouped, e-interface, f-class}/`, each with `shoppingCart.ts`, `businessLogic.ts` and `usage.ts`.

- The business logic of B to B5, C and E is identical to A's (`results/diff-*`). A differs from today only in calling factories instead of returning object literals.
- D reaches members through `ShoppingCartEvents['X']`; F uses `new X(...)`.

Every `usage.ts` was run, and the output is in `results/usage-run.txt`. Today prints `now is a Date? false`, because a cast HTTP body keeps the ISO string where the type says `Date`; the schema styles print `true`.

The deliberate-mistake errors from both compilers are in `results/errors.txt` and `results/ts7.txt`:

- Factory misuse gives the same errors in every function style as today.
- Passing an example value instead of a schema gives "No overload matches this call".
- In style C, a schema that disagrees with the type produces a 9-line chain through `~standard.validate`.

## Open questions for Oskar

1. Should the type be inferred from the schema (A, B, D, E, F) or written by hand and checked against the schema (C)?
2. If inferred, how should users name it: `typeof X.Type`, `Event.Of<typeof X>` (or another helper name), an interface, or grouped `Types['X']`?
3. Per-message definitions, or grouped ones?
4. Should the union be a runtime value (`types`, `is`, `validate`), or only a type?
5. Should `data` and `metadata` accept a record of field schemas as shorthand?
6. Factory shape: `X(data, metadata)`, `X.create(...)`, or both?
7. Should classes be allowed at all?
8. Dates: should the built-in date accept both an ISO string and a `Date`? Should Emmett ship or document a recommended date schema for each library?
9. Should Emmett reject other transforms, as Inngest does?
10. Should validation issues be normalized to `{ message, path }`?
11. Is TypeBox's compile cost through an adapter acceptable?
12. Is `isolatedDeclarations` support a requirement?
