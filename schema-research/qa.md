# Message schemas: Q&A

Brainstorm log for adding schema support to Emmett message definitions (events and commands first; workflows and command handlers later). Each answer quotes Oskar verbatim, followed by the decision as interpreted.

## Initial idea (verbatim)

> I'd like to introduce standard JSON schema support to define message types (events. commands, etc.) but also eventually also workflows, command handlers with metadata, but starting from messages.
>
> I'd like to not only have it for validation but also eventually for generating docs, tests etc. so knowing metadata
>
> Probably eventually I'd like to also have schema registry. This should go eventually in a package that's used in Emmett and Pongo, so core code should be in the package like almanac, that's in the repo, but will be moved out at some point.
>
> Also, we'll need to support schema registry, maybe compatible with https://xregistry.io/ or other schema registry (like confluent registry).
>
> For schema, I'd like to give people option to bring their own library (zod, TypeBox, etc.) but I'd like to also provide the basic option out of the box, so they don't need to bring it. I like https://github.com/sinclairzx81/typebox
>
> Read also
>
> https://standardschema.dev/json-schema
> https://www.inngest.com/blog/too-many-javascript-schema-libraries-support-only-one
>
> So definitely we need to use Event( ... ) and Command ( ...) in a similar way as we have definition now.
>
> Do a research before asking question and keep my answers verbatim in qa.md

## Research reports

- [First pass: initial findings](findings.md)
- [Standard Schema and schema libraries](findings/standard-schema.md): the two specs, Zod, Valibot, ArkType, Effect, TypeBox, Sury, VineJS, Typia, integrators, Date and bigint handling, built-in builder probe
- [Schema formats and registries](findings/formats-registries.md): JSON Schema, JSON Structure, Avro, Protobuf, xRegistry, Confluent, Apicurio, KurrentDB, schema evolution
- [Docs and test tooling, EventCatalog, framework prior art](findings/tooling.md): AsyncAPI, CloudEvents, EventCatalog (model, versioning, licensing, SDK prototype), 17 frameworks compared, test data generation experiments
- [TypeScript API patterns for definitions, factories and unions](findings/api-ergonomics.md): ten styles compared (built-in, Zod, Valibot, ArkType, Effect, TypeBox, type first, grouped, interface, class), survey of 20 libraries, hover, errors, dates, compile cost, bundle size
  - [Full shopping-cart examples per style](findings/api-ergonomics-examples.md), generated from the type-checked code
- [Emmett and Pongo integration points](findings/codebase.md)
- [Naming a message type without `typeof`](findings/type-naming.md): what TypeScript allows, one `typeof` per group (tRPC, Hono), types-first generation (typia, ts-json-schema-generator), schema-first generation (json-schema-to-typescript), for Q4

Raw sources are in [sources/](sources/) and compiled experiments in [prototypes/](prototypes/). Downloaded npm packages cited as `packages/<name>-<version>/...` are not committed; `npm pack <name>@<version>` fetches the same files.

## Additional requirements (verbatim)

Requirements Oskar added outside a specific question.

> Yes, I'd like to also have easy option to integrate with things liike EventCatalog

Interpreted: integrating message definitions with documentation tools such as EventCatalog should be easy.

## Questions and answers

### Q1. Shape of `Event(...)` and `Command(...)`

TypeScript allows a value and a type to share a name. Proposal:

```ts
// Today
type ShoppingCartOpened = Event<'ShoppingCartOpened', { cartId: string }>;
const e = event<ShoppingCartOpened>('ShoppingCartOpened', { cartId: '1' });

// Proposed
const ShoppingCartOpened = Event('ShoppingCartOpened', {
  data: Type.Object({ cartId: Type.String() }), // any Standard Schema
  metadata: Type.Object({ tenantId: Type.String() }), // optional
  description: 'Shopper opened a cart',
});
type ShoppingCartOpened = Event.Of<typeof ShoppingCartOpened>;
// resolves to Event<'ShoppingCartOpened', { cartId: string }, { tenantId: string }>

ShoppingCartOpened({ cartId: '1' }, { tenantId: 't1' }); // creates the event
ShoppingCartOpened.validate(input); // Standard Schema result
ShoppingCartOpened.toJSONSchema(); // for docs and the registry
```

`Command(...)` mirrors this. The inferred type is exactly today's `Event<>`, so deciders, handlers and event stores don't change. The type-only `Event<>` keeps working for people who don't want schemas.

Is this the `Event(...)` / `Command(...)` you have in mind? If not, how should it differ? In particular: callable factory, or a method such as `.create(...)`?

Oskar (verbatim):

> We need to definitely keep the old Event to be backward compatible, it looks more or less as you said. It'd be also good if we generated also the event factories
>
> Event.Of sounds a bit verbose?  Event.Of<typeof ShoppingCartOpened> Is there an option to make this easier and accessible and closer to how accessible is what we have?

Decision (interpreted):

- The type-only `Event<>` and `Command<>` and the lowercase `event()` / `command()` creators stay unchanged for backward compatibility.
- The proposed `Event('Type', { data, metadata, description })` shape is accepted in general.
- The definition also acts as the event factory: calling `ShoppingCartOpened({ ... })` creates the event.
- `Event.Of<typeof X>` is too verbose; a shorter way to get the type is needed (see Q2).

### Q2. Getting the TypeScript type from a definition

TypeScript cannot turn a `const` into a type without `typeof`; only a `class` creates a value and a type under one name. Options:

```ts
// A. Phantom property, no import (Effect Schema: typeof S.Type, ArkType: typeof T.infer)
type ShoppingCartOpened = typeof ShoppingCartOpened.Type;

// B. Short helper type (Zod: z.infer<typeof S>, TypeBox: Static<typeof T>)
type ShoppingCartOpened = EventOf<typeof ShoppingCartOpened>;

// C. Class, no typeof at all, but instances become class instances
class ShoppingCartOpened extends Event('ShoppingCartOpened', { data }) {}
```

Recommendation: A. It needs no import and reads close to today's one-line alias. It is checked in `prototypes/typeExtraction.ts`. `.type` stays the runtime string (`'ShoppingCartOpened'`), and `.Type` exists only for types. B could ship as well for generic code.

Which option, and is `.Type` a good name?

Oskar (verbatim):

> I'd need to see the whole example with unions etc. The current code looks verbosed to me, also const ProductAdded = Event('ProductAdded', { data: { productId: '', quantity: 0 } }); This looks artificial where are types?

> I'm not saying that we HAVE TO be 1:1 to typebox, this is just an inspiration, also that's why I gave you suggestions for other json schemas, plus we NEED to be standard json schema compatible, but it doesn't mean that we cannot e.g. generate Avro or so and use it as the base or other schema type with more features than json schema
>
> Did you really do research as I asked?

> Plus you should be doing /brainstorm as asked, not suggesting me changes

Decision (interpreted):

- Q2 is not answered yet. Oskar needs a complete example (events, commands, unions, business logic) with real schemas before choosing.
- TypeBox is inspiration, not a template to copy.
- Standard JSON Schema compatibility is a hard requirement.
- The internal base model may be richer than JSON Schema (for example Avro or another format), as long as JSON Schema can be produced from it.
- The brainstorm asks questions; it does not propose designs or recommend options.
- The first research round was too shallow. Broader research is under way (see `findings/`) before continuing.

#### Q2, asked again after the research

The research is finished (see [Research reports](#research-reports)). The ten styles are in [findings/api-ergonomics-examples.md](findings/api-ergonomics-examples.md) as full, type-checked shopping-cart code (4 events, 4 commands, metadata, dates, unions, business logic), and compared in [findings/api-ergonomics.md](findings/api-ergonomics.md). Asked without a recommendation: where should the TypeScript type of a message come from (inferred from the schema, or written by hand and checked against it), and which way of naming it is closest to what Oskar wants (today, A `typeof X.Type`, C type first, D grouped, E interface, F class)?

Oskar (verbatim):

> Class is not acceptable, I just want to run regular ts with types

Decision (interpreted):

- Classes are ruled out, so style F and anything else that turns messages into class instances are out. Messages stay plain objects described by regular TypeScript types.
- Still open: what "regular ts with types" means for the other two routes. Either the type is written by hand and the schema is checked against it (C), or the type comes from the schema through a `typeof` line (A, B, D, E). Q3 asks this.

### Q3. Hand-written type, or type taken from the schema?

Classes are out, so a message's TypeScript type can come from one of two places (see [the summary in findings/api-ergonomics.md](findings/api-ergonomics.md#summary)):

```ts
// 1. Written by hand, as today; the schema next to it must match, or it doesn't compile (style C)
export type ShoppingCartConfirmed = Event<
  'ShoppingCartConfirmed',
  { shoppingCartId: string; confirmedAt: Date },
  ShoppingCartEventMetadata
>;
export const ShoppingCartConfirmed = Event<ShoppingCartConfirmed>('ShoppingCartConfirmed', {
  data: { shoppingCartId: s.string(), confirmedAt: s.date() },
  metadata: ShoppingCartEventMetadata,
});

// 2. Taken from the schema with one typeof line (styles A, B, D, E)
export const ShoppingCartConfirmed = Event('ShoppingCartConfirmed', {
  data: { shoppingCartId: s.string(), confirmedAt: s.date() },
  metadata: ShoppingCartEventMetadata,
});
export type ShoppingCartConfirmed = typeof ShoppingCartConfirmed.Type;
```

When you say "regular ts with types", which of these do you mean? Or should Emmett support both?

Oskar (verbatim):

> Dude, didn't I tell you whether we need to support both and be backward compatible?

Decision (interpreted):

- Both routes are supported. This follows from the Q1 answer ("We need to definitely keep the old Event to be backward compatible"), so Q3 shouldn't have been asked.
- Route 1: hand-written types, as today. They keep working with no schema, and a schema can optionally be attached and checked against the type (style C).
- Route 2: the type is taken from the schema.
- Classes are out (Q2).

### Q4. Naming the type when it comes from the schema

For route 2, Oskar found `Event.Of<typeof X>` too verbose (Q1). These are the forms that compiled in the research (full code in [findings/api-ergonomics-examples.md](findings/api-ergonomics-examples.md)):

```ts
// A. One line per message
export type ShoppingCartConfirmed = typeof ShoppingCartConfirmed.Type;

// E. One interface per message
export interface ShoppingCartConfirmed extends Event.Of<typeof ShoppingCartConfirmed> {}

// D. All events of a stream defined in one Events({...}) call, two lines per group
export type ShoppingCartEvent = typeof ShoppingCartEvent.Type;   // the union
export type ShoppingCartEvents = typeof ShoppingCartEvent.Types; // ShoppingCartEvents['ShoppingCartConfirmed']
```

Measured differences: hovering over the union shows event names with E, but the full field lists with A and D. D's definitions are 12% shorter than today's; A's are about 50% longer, and E's about 64% longer.

Which of these forms is closest to what you want, or should it look different?

Oskar (verbatim):

> can we do it better than typeof ShoppingCartConfirmed.Type;
>
> It works, but it's kinda far from great accessibility
>
> How others are doing it

> Also I totally don't understand what do you mean by
>
> ```ts
> // D. All of a stream's events in one Events({...}) call, then two lines per group
> export type ShoppingCartEvent = typeof ShoppingCartEvent.Type;   // the union
> export type ShoppingCartEvents = typeof ShoppingCartEvent.Types; // ShoppingCartEvents['ShoppingCartConfirmed']
> ```
>
> ???
>
> export type ShoppingCartEvents = typeof ShoppingCartEvent.Types; // ShoppingCartEvents['ShoppingCartConfirmed'] how?

Decision (interpreted):

- `typeof X.Type` works but isn't accessible enough. Oskar wants to see what others do before choosing. Researched in [findings/type-naming.md](findings/type-naming.md).
- Style D was explained in the chat. `Events({...})` defines all of a stream's events at once. `ShoppingCartEvents` is an object type keyed by event name, so `ShoppingCartEvents['ShoppingCartConfirmed']` is the single event's type. No answer on D yet.

#### Q4, asked again after the research

The findings: TypeScript declined an implicit `typeof` on purpose (issue #26769). Every schema library writes one `typeof` per type. Others avoid it in one of three ways:

1. One `typeof` for a whole group, with members looked up by name (tRPC `inferRouterInputs<AppRouter>['post']['create']`; style D's `ShoppingCartEvents['ShoppingCartConfirmed']`).
2. Plain TypeScript types plus a tool that generates the runtime part. typia needs its own compiler (`ttsc`, TypeScript 7) and doesn't run under plain `tsx`. ts-json-schema-generator is a CLI that writes JSON Schema from today's types.
3. Schema files plus a tool that generates the TypeScript types (json-schema-to-typescript, openapi-typescript, Prisma).

Which of these is acceptable, if any: a build step (2 or 3), one `typeof` per group with lookup by name (1), or one `typeof` per message as it is now?

Oskar (verbatim):

> build step could be acceptable as an option, not as the only way.
>
> Again, we need to have a similar experience as we had allowing to define types but also types from metadata, getting proper typescript types with algebraic types etc.

> Also I don;t know what do you umean by typeof per group or module.

Decision (interpreted):

- A build step (generating code from types, or types from schema files) can be offered as an option, but Emmett must work without one.
- The experience should stay close to today's: users can write types by hand, or get them from the definition (schema and metadata). Either way they get proper TypeScript types, including unions (algebraic data types) usable in `evolve`, `decide` and pattern matching.
- "One `typeof` per group or module" needed explaining (done in the chat; see the next question).

### Q5. One `typeof` per file instead of one per message

Explained to Oskar with this example, which compiles (`prototypes/api-ergonomics/experiments/per-module.ts` and `per-module-defs.ts`):

```ts
// shoppingCartEvents.ts: definitions only, no type lines
export const ShoppingCartConfirmed = Event('ShoppingCartConfirmed', {
  data: { shoppingCartId: s.string(), confirmedAt: s.date() },
  metadata: { clientId: s.string() },
});
export const ShoppingCartCancelled = Event('ShoppingCartCancelled', { /* ... */ });

// types: one typeof for the whole file
import * as shoppingCartEvents from './shoppingCartEvents';
export type ShoppingCartEvents = TypesOf<typeof shoppingCartEvents>;
export type ShoppingCartEvent = ShoppingCartEvents[keyof ShoppingCartEvents]; // the union

// optional short names, written without typeof
export type ShoppingCartConfirmed = ShoppingCartEvents['ShoppingCartConfirmed'];
```

The union narrows in `switch (event.type)` as today. Style D does the same, but the group is one `Events({...})` call instead of a file.

Is this way of getting the types something Emmett should offer, next to the per-message `typeof X.Type` and hand-written types?

Oskar (verbatim):

> import * as shoppingCartEvents from './shoppingCartEvents';
>  I don't think that someone will be doing something like that

Decision (interpreted):

- Getting the types for a whole file with `import * as` and one `typeof` is out. Users won't structure code like that.

Oskar (verbatim, follow-ups to the same answer):

> Rather they'd export variable

> Rather they'd export variable with union

Decision (interpreted):

- Users would export a variable holding the union, and derive the union type from it, rather than collect types with `import * as`.

### Q6. What goes into the exported union variable

Two forms compiled in the research (full code in [findings/api-ergonomics-examples.md](findings/api-ergonomics-examples.md)):

```ts
// A: each event defined on its own, then the union variable lists them
export const ShoppingCartConfirmed = Event('ShoppingCartConfirmed', {
  data: { shoppingCartId: s.string(), confirmedAt: s.date() },
  metadata: ShoppingCartEventMetadata,
});
export type ShoppingCartConfirmed = typeof ShoppingCartConfirmed.Type;
// ... the same for the other three events

export const ShoppingCartEvent = Events(
  ProductItemAddedToShoppingCart,
  ProductItemRemovedFromShoppingCart,
  ShoppingCartConfirmed,
  ShoppingCartCancelled,
);
export type ShoppingCartEvent = typeof ShoppingCartEvent.Type;

// D: the events are defined inside the union variable
export const ShoppingCartEvent = Events(
  {
    ShoppingCartConfirmed: { shoppingCartId: s.string(), confirmedAt: s.date() },
    ShoppingCartCancelled: { shoppingCartId: s.string(), cancelledAt: s.date() },
    // ...
  },
  { metadata: { clientId: s.string() } },
);
export type ShoppingCartEvent = typeof ShoppingCartEvent.Type;   // the union
export type ShoppingCartEvents = typeof ShoppingCartEvent.Types; // one event: ShoppingCartEvents['ShoppingCartConfirmed']
export const { ShoppingCartConfirmed, ShoppingCartCancelled } = ShoppingCartEvent; // factories
```

In A, every event also needs its own `typeof` line to be used by name. In D, a single event's type is `ShoppingCartEvents['ShoppingCartConfirmed']`.

Is the exported union variable you have in mind A (a list of events defined separately), D (the events defined inside it), or something else?

Oskar (verbatim):

> Dude, you get the code on what's the current way. We need to be as close as possible and ass less friction as possible. I don't think that Events Helper is useful, it looks terrible

Decision (interpreted):

- Today's code is the baseline: the new way must be as close to it as possible, with as little friction as possible.
- No `Events(...)` helper, in either form (A's list or D's grouped definitions). The union stays a plain TypeScript union, as today: `export type ShoppingCartEvent = A | B | C | D;`.
- Q6 is answered by this.

### Q7. What the schema version of today's code should look like

Today (from `samples/` and the research examples):

```ts
export type ShoppingCartConfirmed = Event<
  'ShoppingCartConfirmed',
  { shoppingCartId: string; confirmedAt: Date },
  ShoppingCartEventMetadata
>;

export type ShoppingCartEvent =
  | ProductItemAddedToShoppingCart
  | ProductItemRemovedFromShoppingCart
  | ShoppingCartConfirmed
  | ShoppingCartCancelled;
```

Constraint from the research: when the type comes from a runtime definition, TypeScript needs either a hand-written type next to it or a `typeof` somewhere (TypeScript declined an implicit `typeof`, issue #26769).

Could Oskar sketch how `ShoppingCartConfirmed` should look once it also has a schema, written the way he'd want to read it, even if it doesn't compile today? That sketch then gets checked against what TypeScript allows.

Oskar (verbatim):

> Dude, okay, I said that if there's no other option we need to use typeof, but I'm asking for what options we have to make it similar and accessible

> And close to how other tools are doing (or at least know how they're doing it)

Decision (interpreted):

- `typeof` is acceptable where there's no other option. Oskar asked for the options that keep the code close to today's and accessible, compared with how other tools do it, not for a sketch from him.
- Options listed in [findings/type-naming.md, section 5](findings/type-naming.md#5-options-that-stay-close-to-todays-code), and `Event<typeof X>` (today's `Event<>` type accepting a definition) verified in `prototypes/api-ergonomics/experiments/event-of-definition.ts`.

#### Q7, asked again with the options

| Option | One message | Same pattern elsewhere |
|---|---|---|
| 0. Today, no schema | `type X = Event<'X', Data, Meta>` | |
| 1. Type first | today's type, plus `const X = Event<X>('X', { data, metadata })` | Effect `Data.taggedEnum<T>()`, XState `setup({ types })` |
| 2. `Event<>` accepts a definition | `type X = Event<typeof X>` | Zod `z.infer<typeof X>`, TypeBox `Static<typeof X>` |
| 3. Phantom property | `type X = typeof X.Type` | Effect `typeof X.Type`, ArkType `typeof X.infer` |
| 4. Interface | `interface X extends Event<typeof X> {}` | |
| 5. Build step, as an extra | today's type; schema generated | typia, ts-json-schema-generator |

Which of options 1 to 5 should Emmett offer next to today's type-only `Event<>`?

Oskar (verbatim):

> I don't understand this, stop creating this bs tables, and just explain in a straightforward way

#### Q7, asked again in plain words

When the shape lives in a runtime definition, TypeScript can only get a type from it with `typeof`, or you write the type by hand. That leaves four ways:

- A. Write the type by hand as today, and pass it to the definition: `Event<ShoppingCartConfirmed>('ShoppingCartConfirmed', { ... })`. TypeScript checks that the definition matches the type. No `typeof`, but the shape is written twice.
- B. Write only the definition, and get the type with one line per message: `type ShoppingCartConfirmed = Event<typeof ShoppingCartConfirmed>`. Zod does the same with `z.infer<typeof X>`. The shape is written once.
- C. The same as B, spelled `typeof ShoppingCartConfirmed.Type`, as Effect and ArkType do.
- D. Write only today's types, and a build tool generates the schema from them (typia, ts-json-schema-generator). No `typeof` and no duplication, but it needs a build step.

Which of these should Emmett support next to today's types?

Oskar (verbatim):

> Do you trully believe that throwind such text is an explanation?

#### Q7, asked again with code

Answer re-sent as full code for one event per option (today, A: type first with the definition checked against it, B: definition first with `type X = Event<typeof X>`, D: build step), plus why `typeof` is needed (TS2749). Same question: which of these should Emmett support next to today's types?

Oskar (verbatim):

> A - not acceptable, why would you define it twice?
> B - this is better, but Event type should remain as it is
> D - As said, we can have gode generator, but as optional

Decision (interpreted):

- A (hand-written type plus a definition checked against it) is rejected, because it defines the shape twice.
- B (definition first, type derived from it) is the direction, but Emmett's `Event<>` type stays as it is, so `Event<typeof X>` is out.
- D (code generator from today's types) is an optional extra, not the main way.

#### Q8: how to get the type from the definition

With `Event<>` unchanged, the type has to come from somewhere else. Two ways:

```ts
export const ShoppingCartConfirmed = Event('ShoppingCartConfirmed', {
  data: { shoppingCartId: s.string(), confirmedAt: s.date() },
});

// 1. a property on the definition (Effect, ArkType)
export type ShoppingCartConfirmed = typeof ShoppingCartConfirmed.Type;

// 2. a separate type helper (Zod `z.infer<typeof X>`, TypeBox `Static<typeof X>`)
export type ShoppingCartConfirmed = InferEvent<typeof ShoppingCartConfirmed>;
```

Which of these two should Emmett use?

Oskar (verbatim):

> We could have Event both as type and as function that generate schema, right?

Answer: yes. TypeScript keeps types and values in separate namespaces, so `type Event<...>` and `function Event(...)` can share one name and one import. Emmett core exports no `Event` value today (checked `src/packages/emmett/src`), so there's no clash. The prototype `prototypes/api-ergonomics/experiments/event-of-definition.ts` declares both (`type Event` and `const Event`) and compiles. This doesn't remove the need to name the derived type, so Q8 stays open.

Oskar (verbatim):

> Like All?

Unclear whether this means "support both forms" or "is this how all other libraries do it". Asked Oskar which one.

Oskar (verbatim):

> I don't understand, we can have .Type and also InferEvent right?

Answer: yes. `InferEvent<D>` is only `D['Type']`, so both give the same type. Verified in `prototypes/api-ergonomics/experiments/type-and-infer.ts`: both equal `Event<'ShoppingCartConfirmed', { shoppingCartId: string; confirmedAt: Date }>`, `tsc -p .` exits 0, and a deliberately wrong assertion fails with TS2344.

Oskar (verbatim):

> Ok, now the question, how integration with zod, typebox etc. will look like if we decide this?

Answer (from the existing prototypes in `prototypes/api-ergonomics/styles/b-*`, which compile with `tsc -p .`): `Event(...)` accepts any Standard Schema for `data` and `metadata`, and the type line stays `typeof X.Type` whatever the library. Zod, Valibot and ArkType schemas are passed as they are. Effect needs `Schema.toStandardSchemaV1(...)`. TypeBox doesn't implement Standard Schema and its author won't add it, so it needs a small adapter (`lib/typebox.ts`). JSON Schema comes from `~standard.jsonSchema` where the library provides it (Zod 4.2+, ArkType); Valibot and Effect need their wrappers, and a TypeBox schema is already JSON Schema. Details in [findings/standard-schema.md](findings/standard-schema.md) and [findings/api-ergonomics-examples.md](findings/api-ergonomics-examples.md). Q8 (ship both `.Type` and `InferEvent`) asked again.

Oskar (verbatim):

> It'd be also good if Event returned something that's also a function so you could do
>
> ShoppingCartConfirmed({...// pass here typed data})
>
> and also do .Type and possibly other methods fields we'll find useful

Decision (interpreted): the value returned by `Event(...)` is callable as a typed factory and also carries `.Type` plus other fields and methods.

Notes: the prototypes already do this (`lib/message.ts`, `define` uses `Object.assign(create, {...})`), with `type`, `kind`, `description`, `Type`, `is`, `validate` and `toJSONSchema`, called as `ShoppingCartConfirmed(data, metadata)` in `styles/*/businessLogic.ts`. Because the definition is a function, a field can't be called `name` or `length`: `Object.assign` throws "Cannot assign to read only property 'name' of function" (checked with Node). `call`, `apply`, `bind` and `toString` would also shadow function methods.

#### Q9: what the factory takes

Which call shape should the factory have: `ShoppingCartConfirmed(data, metadata)`, as in the prototype, or one object, `ShoppingCartConfirmed({ data, metadata })`?

Oskar (verbatim):

> metadata could be optional as in the event method factory (it could use it internally)

Decision (interpreted): the factory takes positional arguments like today's `event(type, data, metadata)` in `src/packages/emmett/src/typing/event.ts:59`, without the `type`: `ShoppingCartConfirmed(data, metadata)`. It may call `event()` / `command()` internally. Metadata follows the same rules as today's factories: for events, it is required when the definition declares metadata and absent when it doesn't; for commands without declared metadata, it is optional `DefaultCommandMetadata` (`typing/command.ts:51`). The prototype already matches this.

#### Q10: does the factory validate

Should calling `ShoppingCartConfirmed(data, metadata)` validate the data against the schema at runtime, or only be type-checked, with validation left to `.validate(...)`?

Oskar (verbatim):

> It could

Decision (interpreted): the factory may validate at runtime. Not yet clear whether always or on request.

#### Q11: when the factory validates

Should the factory always validate, or only when switched on (for example per definition, or globally in configuration)?

Oskar (verbatim):

> I think that it'd be good if it was opt-in

Decision (interpreted): the factory doesn't validate by default; validation is opt-in.

#### Q12: where to opt in

Where should the opt-in live: on the definition (`Event('X', { ..., validate: true })`), on the call, or globally for the whole app?

Oskar (verbatim):

> yes, for now let'd do it in Event helper

Decision (interpreted): the opt-in goes on the definition, in the `Event(...)` / `Command(...)` options, for now.

#### Q13: what happens when validation fails

With validation switched on and invalid data, should the factory throw (Emmett already has `ValidationError` in `src/packages/emmett/src/errors/index.ts`), or return a result with the issues?

Oskar (verbatim):

> Throw an error

Decision (interpreted): with validation on, invalid data makes the factory throw (Emmett's `ValidationError` is the existing candidate).

#### Q14: async validation in the factory

Standard Schema's `validate` may return a Promise (Zod with async refinements, VineJS always). With validation on, should the factory stay synchronous and throw when the library returns a Promise (what the Standard Schema FAQ suggests for sync consumers), or return a Promise in that case?

Oskar (verbatim):

> Why would it return promise?

Answer: only when the schema itself has an async check, for example a Zod `.refine(async ...)` that looks something up. Checked with Zod in `prototypes/standard-schema`: `~standard.validate` returns `{ value: ... }` for a plain schema and `Promise { <pending> }` for the same schema with `.refine(async ...)`. VineJS returns a Promise for every schema. Q14 stays open.

Oskar (verbatim):

> NO, I won't allow such

Decision (interpreted): async schemas aren't supported in the factory. It stays synchronous; if a library's `validate` returns a Promise, the factory throws.

#### Q15: async in `.validate(...)`

Does the same rule apply to `ShoppingCartConfirmed.validate(json)`: synchronous, throwing on async schemas? In the prototype it's `async` today.

Oskar (verbatim):

> yes.

Decision (interpreted): `.validate(...)` is synchronous too, and throws on schemas whose validation returns a Promise.

#### Q16: what `.validate(...)` returns

For invalid input, should `.validate(json)` return the issues (`{ issues }`, the Standard Schema result shape, as in the prototype) or throw `ValidationError` like the factory?

Oskar (verbatim):

> what other libraries are doing?

Answer: every library checked offers both a throwing call and a result-returning call. Run in `prototypes/standard-schema/throw-or-result.ts`, output in `throw-or-result.txt`:

- Zod: `parse` throws `ZodError`, `safeParse` returns `{ success, error }`.
- Valibot: `parse` throws `ValiError`, `safeParse` returns `{ success, output, issues }`.
- ArkType: calling the type returns `ArkErrors`, `.assert` throws.
- Effect: `decodeUnknownSync` throws `SchemaError`, `decodeUnknownResult` returns a result.
- TypeBox: `Value.Parse` throws `ParseError`, `Value.Check` returns a boolean (`Value.Errors` lists the issues).
- VineJS: `validate` throws `ValidationError`, `tryValidate` returns `[error, value]`.
- Standard Schema `~standard.validate` returns `{ issues }`.

#### Q16, asked again

Should Emmett offer both a throwing and a result-returning call, as all of these do, or only one?

Oskar (verbatim):

> ok, then use parse/safeparse approach

Decision (interpreted): definitions get `parse(input)`, which throws on invalid input, and `safeParse(input)`, which returns a result. Both are synchronous. This replaces the prototype's `validate`.

#### Q17: the `safeParse` result shape

Which shape should `safeParse` return: Zod's `{ success: true, data } | { success: false, error }`, Valibot's `{ success, output, issues }`, or Standard Schema's `{ value } | { issues }`?

Oskar (verbatim):

> Go zod structure

Decision (interpreted): `safeParse` returns `{ success: true, data } | { success: false, error }`, where `error` is the same error `parse` throws.

#### Q18: what the error carries

Today `ValidationError` holds only a message. Emmett calls `~standard.validate`, which gives a list of issues (`{ message, path }`), not the library's own error object (`ZodError`, `ValiError`). ArkType adds extra fields to each issue. Should `ValidationError` get an `issues` list with only `message` and `path`, the same for every library?

Oskar (verbatim):

> yes

Decision (interpreted): `ValidationError` gets an `issues` list of `{ message, path }`, the same for every library, with paths prefixed by `data` or `metadata`. Vendor-specific issue fields are dropped.

#### Q19: dates in `parse`

`ShoppingCartConfirmed` has `confirmedAt: Date`, but JSON has no dates. `JSONSerializer` writes ISO strings and only revives them with `parseDates` on (`emmett/src/serialization/json/jsonSerializer.ts:201-214`); PostgreSQL, SQLite and EventStoreDB return strings, MongoDB returns `Date` (see [findings/codebase.md](findings/codebase.md), section 2.4). When `parse` gets `confirmedAt: '2026-10-23T10:00:00.000Z'`, should it turn the string into a `Date` itself, or expect the caller to have revived it already?

Oskar (verbatim):

> How would you doi it and how others are doing?

Answer: run in `prototypes/standard-schema/dates.ts`, output in `dates.txt`. Every library's plain date schema (`z.date()`, `v.date()`, ArkType `Date`, Effect `Schema.Date`) accepts a `Date` and rejects an ISO string. Every string-to-Date schema (Zod codec, Valibot `transform`, ArkType `string.date.iso.parse`, Effect `DateFromString`, TypeBox `Codec`) accepts the string and rejects a `Date`. Only Zod's `z.coerce.date()` accepts both, and it also accepts `0` (epoch) and `'2026-10-23'`. The prototype's built-in `s.date()` accepts both and returns a `Date` (`prototypes/api-ergonomics/lib/schema.ts:93`).

Outside schema libraries: typed-language event stores (Marten with System.Text.Json, Axon with Jackson) convert in the deserializer, which knows the declared field type. In TypeScript, tRPC's superjson records which fields were dates in the payload and restores them, and Emmett today guesses from the string shape (`dateReviver`, opt-in `parseDates`).

Recommendation given (Oskar asked for one): the schema converts, because it's the only thing at runtime that knows a field is a date. Date fields accept both an ISO string and a `Date` and return a `Date`, because the same `parse` sees strings from PostgreSQL, SQLite and EventStoreDB, `Date` from MongoDB, and `Date` from the factory when validation is on. The built-in `s.date()` does this already; for other libraries, the docs show a date schema that accepts both. JSON Schema describes the wire form: `{ "type": "string", "format": "date-time" }`.

#### Q19, asked again

Do you agree that date fields accept both an ISO string and a `Date`, and that `parse` returns a `Date`?

Oskar (verbatim):

> I think that we should use internally json serializer call it's deserialize and allow passing options as param, the same as serializer and also upcast/downcast, so the same flow

Decision (interpreted): `parse` follows the flow `JSONCodec` already has (`src/packages/emmett/src/serialization/json/jsonSerializer.ts:293-324`): `serializer.deserialize(payload, options)` with the same options as `JSONSerializer` (`parseDates`, `parseBigInts`, `reviver`), then `upcast`, then the schema check. The reverse direction uses `downcast`, then `serializer.serialize`. Dates are revived by the serializer (`parseDates`), so the schema only checks for a `Date`; this answers Q19 differently from my recommendation.

#### Q20: what `parse` takes

`JSONCodec.decode` takes a JSON string. PostgreSQL (JSONB through the pg type parser) and MongoDB (BSON) hand Emmett objects that are already parsed, and the factory has an object too. Should `parse` take only a JSON string, or also an already-parsed object, skipping `deserialize` for it?

Oskar (verbatim):

> if others are doing such then yes

Answer: they do. Zod `parse`, Valibot `parse`, ArkType, Effect `decodeUnknown*` and TypeBox `Value.Parse` all take an already-parsed value (see `prototypes/standard-schema/throw-or-result.ts`). Parsing a JSON string is a separate, opt-in step: Effect `Schema.fromJsonString`, ArkType `string.json.parse`; Zod has none (`z.json()` describes JSON-compatible values, it doesn't parse strings), so you call `JSON.parse` first. Checked against the installed packages in `prototypes/standard-schema`.

Decision (interpreted): `parse` and `safeParse` take either a JSON string, which goes through `deserialize`, or an already-parsed object, which skips it. Both then go through `upcast` and the schema check.

#### Q21: the other direction

`downcast` belongs to writing. Should definitions also get the writing side, for example `ShoppingCartConfirmed.serialize(event, options)`, running the schema check, then `downcast`, then `serializer.serialize`?

Oskar (verbatim):

> is this something that others are doing?

Answer: partly. Run in `prototypes/standard-schema/encode.ts`, output in `encode.txt`:

- Zod (`z.encode(schema, value)`), Effect (`Schema.encodeSync`) and TypeBox (`Value.Encode`) go back from the in-code value to the wire form: `Date` became `"2026-10-23T10:00:00.000Z"`. Zod's encode also checks the value and threw on `confirmedAt: 'nope'`. Effect can go all the way to a JSON string with `Schema.fromJsonString`.
- Valibot and ArkType have no encode; their transforms are one-way.
- Standard Schema has no encode yet. The Standard Codec proposal (PR #180) is open ([findings/standard-schema.md](findings/standard-schema.md)).
- Kafka with Confluent's JSON Schema serializer checks the payload when producing if `json.fail.invalid.schema` is on (reported from Confluent docs, not tested here).

Emmett itself already does it in `JSONCodec.encode` (`downcast`, then `serialize`), without a schema check.

#### Q21, asked again

Emmett's flow doesn't need a library encode: the schema checks the in-code value (a `Date` is a `Date`), and `JSONSerializer` turns it into an ISO string, so the check works through Standard Schema `validate` for every library. Should definitions get the writing side (`serialize`: schema check, `downcast`, `serializer.serialize`)?

Oskar (verbatim):

> I'm not sure if that's needed, but we can add it for pairity

Decision (interpreted): definitions get `serialize(event, options)` (schema check, `downcast`, `serializer.serialize`) for parity with `parse`, even though the need isn't proven.

#### Q22: commands

Should `Command(...)` get exactly the same API as `Event(...)`: callable factory, `.Type`, `InferCommand`, opt-in validation, `parse` / `safeParse` / `serialize`? The one known difference is metadata: commands without declared metadata accept the optional `DefaultCommandMetadata` (`{ now: Date }`, `src/packages/emmett/src/typing/command.ts:71`).

Oskar (verbatim):

> yes, it should be the same

Decision (interpreted): `Command(...)` has the same API as `Event(...)`, with today's `DefaultCommandMetadata` rule for commands without declared metadata.

#### Q23: the built-in default schema library

The original brief said "I like TypeBox" for the out-of-the-box option. What the prototypes showed ([findings/api-ergonomics.md](findings/api-ergonomics.md), key findings 8 and 9; [findings/standard-schema.md](findings/standard-schema.md), section 2.7):

- TypeBox doesn't implement Standard Schema and its author won't add it, so Emmett needs an adapter. Through it, one file took 3 to 6 s to type-check (1.3M type instantiations against about 8K for the others). One event factory bundled to 153 KB. TypeBox 1.x is ESM only; Emmett ships ESM and CJS. Its schemas are JSON Schema already.
- A small Emmett-owned builder (`s.string()`, `s.date()`, ...) implementing Standard Schema and Standard JSON Schema bundled to about 4 KB and type-checked like the other libraries. It's code Emmett has to write and maintain.

Should the built-in default be TypeBox, wrapped by Emmett, or a small Emmett-owned builder?

Oskar (verbatim):

> We could provide somehing that would be compatible if it's not a big burden, but I don't want typebox dependency

Decision (interpreted): no TypeBox dependency in Emmett. Unclear what "compatible" refers to; asked.

#### Q23a: compatible with what

Which did you mean: (1) TypeBox schemas work with `Event(...)` through an optional adapter, with TypeBox as the user's own dependency (peer dependency, separate package, or copy-paste snippet in the docs); (2) Emmett's own builder mirrors TypeBox's API (`Type.Object`, `Type.String`, ...) so it feels familiar; or (3) something else?

Oskar (verbatim):

> 2 as long as it's not a lot of code and not complicated, if not then let user define it

Decision (interpreted): Emmett's built-in builder mirrors TypeBox's API (`Type.Object`, `Type.String`, ...) with no TypeBox code or dependency, as long as it stays small and simple. If it doesn't, users bring their own library instead.

For scale: the prototype builder `s` (`prototypes/api-ergonomics/lib/schema.ts`) is 198 lines and covers `string`, `number`, `boolean`, `date`, `literal`, `array`, `optional` and `object`, implementing Standard Schema and Standard JSON Schema.

#### Q24: what the built-in builder covers

Beyond those eight, event payloads commonly also need `Union` (for algebraic types), `Record`, `Null`/nullable, `Integer` and `Enum`. Should the built-in cover that list and stop there, leaving anything else (formats like uuid or email, min/max constraints, `BigInt`) to a user's own library?

Oskar (verbatim):

> no, I just want to be able to get typebox object, if that's not possible then i don't care

> Dude, wtf. I just want to take typebox schema, but I don't want to repeat it, or are you asking about emmett basic validation stuff?

Correction: the Q23a decision above was a misreading. What Oskar wants is to pass a TypeBox schema to `Event(...)` without writing the shape twice, and without Emmett depending on TypeBox. If that's not possible, TypeBox support doesn't matter. Q24 was about Emmett's own basic builder, which is a separate question and stays open.

What's possible: a TypeBox schema is plain JSON Schema, but checking a value against it needs TypeBox's `Value` (or another JSON Schema validator), so Emmett can't validate it without a dependency. The closest is one wrapper call around the schema, `standard(Type.Object({...}))`, where `standard` is TypeBox's own copy-paste adapter (`example/standard` in the TypeBox repo) living in the user's code or the docs. The shape is still written once. Known cost from the prototype: 3 to 6 s type-check for one file through the adapter.

#### Q25: TypeBox through a wrapper

Is one `standard(...)` call around a TypeBox schema acceptable, or is that the "not possible" case where TypeBox support doesn't matter?

Oskar (verbatim):

> Ok, then maybe it'd be better to follow closer to zod? What's the most popular validation tool?

Answer: Zod, by a wide margin. npm weekly downloads for 2026-10-12 to 2026-10-18 (`sources/standard-schema/npm-downloads-2026-10-23.md`): zod 207M, @sinclair/typebox 0.x 67M, effect 30M, joi 14.6M, valibot 13.1M, typebox 1.x 8.0M, yup 6.8M, arktype 1.3M. Downloads include installs pulled in by other packages: `@jest/schemas` depends on `@sinclair/typebox`, and the OpenAI and MCP SDKs depend on Zod (checked with `npm view`). The 2026-10-04 numbers were about twice as high for most packages, so treat them as rough.

#### Q26: what "follow closer to Zod" means

Which did you mean: (1) Emmett's own built-in builder copies Zod's API (`z.object`, `z.string`, ...), with no Zod dependency, or (2) no built-in builder, and Zod becomes the library the docs and samples use?

Oskar (verbatim):

> 1. But not z, but let's use schema for now or something similar

Decision (interpreted): Emmett ships a small built-in builder that copies Zod's API, with no Zod dependency, exported as `schema` for now (name not final): `schema.object({ shoppingCartId: schema.string(), confirmedAt: schema.date() })`.

#### Q24, asked again with the Zod-style API

Should the built-in cover only the prototype's eight kinds plus the ones event payloads commonly need, and stop there?

- prototype: `schema.string()`, `schema.number()`, `schema.boolean()`, `schema.date()`, `schema.literal()`, `schema.array()`, `.optional()`, `schema.object()`
- commonly needed: `schema.union()` (algebraic types), `schema.record()`, `.nullable()`, `schema.int()`, `schema.enum()`

Anything else (uuid or email formats, min/max, `bigint`, refinements) would need the user's own library.

Oskar (verbatim):

> 1 think that we can have some basic stuff like bigint, date, email etc. I don't want force someone to use other lib for obvious stuff, we don't need to cover all, but should give most common scenarios

Decision (interpreted): the built-in `schema` covers the common scenarios, including things like `bigint`, dates and email, so nobody needs another library for obvious cases. It doesn't aim to cover everything.

#### Q27: the built-in list

A draft list, all spelled as in Zod:

- Types: `string`, `number`, `int`, `bigint`, `boolean`, `date`, `literal`, `enum`, `object`, `array`, `record`, `union`, `null`, `unknown`, plus `.optional()` and `.nullable()`.
- String checks: `.min()`, `.max()`, `.length()`, `.regex()`, `.email()`, `.uuid()`, `.url()`.
- Number checks: `.min()`, `.max()`, `.positive()`, `.nonnegative()`.
- Array checks: `.min()`, `.max()`, `.nonempty()`.

Left out: refinements, transforms, defaults, `tuple`, `map`, `set`, `intersection`, recursive schemas. `date` and `bigint` rely on `JSONSerializer` (`parseDates`, `parseBigInts`) to turn strings back into values, as decided in Q19/Q20.

What would you add to or drop from this list?

Oskar (verbatim):

> let's start with that

Decision (interpreted): the built-in `schema` starts with the Q27 draft list as it is. Formats follow Zod 4's top-level style (`schema.email()`, `schema.uuid()`, `schema.url()`), as suggested in the Q27 reply; not explicitly confirmed.

#### Q28: documentation fields on a definition

The prototype has only `description`. Fields that show up across AsyncAPI, CloudEvents, EventCatalog, xRegistry and JSON Schema ([findings/tooling.md](findings/tooling.md), section 7): `description` (all of them), `version` (required by EventCatalog, used by registries), `deprecated` (EventCatalog `{ message, date }`, xRegistry, JSON Schema), `examples` (AsyncAPI, EventCatalog, JSON Schema), `summary`/`title`, `owners` and `tags` (EventCatalog, AsyncAPI). Which of these should the `Event(...)` / `Command(...)` options accept?

Oskar (verbatim):

> ok, let's start with that

Decision (interpreted): `Event(...)` and `Command(...)` options accept `description`, `version`, `deprecated` (`{ message, date }`), `examples`, `summary`, `owners` and `tags`.

#### Q29: what `version` does

Today Emmett stores no version with an event. Upcasting is a function passed in read options (`upcast?: (event) => event`, `src/packages/emmett/src/eventStore/versioning/upcasting.ts`), and it decides by looking at the event itself. Is `version` only documentation (docs, EventCatalog, registry), or should it also be stored with each event (for example in metadata) so reads can tell which version they got?

Oskar (verbatim):

> It'll be also used for versioning, we already store that in latest main

Context checked: `main` commit `2090840b` ("Set an event schema version in metadata and use it in upcasting (PostgreSQL, SQLite)", 2026-10-22) adds optional `schemaVersion?: string` to `CommonRecordedMessageMetadata`, stores it in `message_schema_version`, keeps it in metadata, and reads events without it as `'1'` (`DefaultMessageSchemaVersion`). Upcasters switch on `event.metadata.schemaVersion`. This branch (`schema_research`) doesn't have the commit yet.

Decision (interpreted): the definition's `version` is the same thing as `metadata.schemaVersion` from `main`, in its plain string format (`'1'`, `'2'`), not semver.

#### Q30: who sets `schemaVersion`

Should the factory set `metadata.schemaVersion` from the definition's `version` automatically, so `ShoppingCartConfirmed(data, metadata)` produces `metadata: { ...metadata, schemaVersion: '2' }` without the caller passing it?

Oskar (verbatim):

> yes

Decision (interpreted): the factory sets `metadata.schemaVersion` from the definition's `version` automatically.

#### Q31: where upcasters live

Today an upcaster is passed when reading (`readStream(id, { schema: { versioning: { upcast } } })`), and Q20 added an `upcast` option to `parse`. Should a definition also be able to carry its own upcasters, keyed by the old version, so `parse` and reads apply them without the caller passing anything?

```ts
export const ProductItemAdded = Event('ProductItemAdded', {
  data: schema.object({ productItem: PricedProductItem }),
  version: '2',
  upcast: { '1': (event) => ({ ...event, data: { productItem: event.data } }) },
});
```

Oskar (verbatim):

> ok

> This and also just function for upcast, then one can to it based on message type or schema version

Decision (interpreted): a definition's `upcast` accepts either a map keyed by old version (`{ '1': (event) => ... }`) or a single function `(event) => event`, where the user switches on `event.type` or `event.metadata.schemaVersion` themselves. `parse` and reads apply it without the caller passing it.

#### Q32: registry in the first version

Is a schema registry (xRegistry, Confluent) part of the first version, or does the first version stop at definitions exporting JSON Schema (`toJSONSchema()`), with the registry later?

Oskar (verbatim):

> I think that we should already at least prepare and ensure that we can get the compatibility and export to json schema and avro

Decision (interpreted): no registry integration in the first version, but the design must be ready for it: definitions export JSON Schema and Avro schemas, and "compatibility" is covered (meaning asked in Q33).

Facts relevant to Avro export ([findings/formats-registries.md](findings/formats-registries.md), section 1.3): Avro's JSON encoding isn't the plain JSON Emmett stores (unions are wrapped, `{"string": "a"}`; timestamps are epoch numbers), so an Avro export would describe the event for a registry or for Avro consumers, not how Emmett stores it. Converting JSON Schema to Avro and back with existing tools was lossy (avrotize dropped `uuid`, timestamps, defaults; the JS converters on npm look unmaintained).

#### Q33: what "compatibility" means

Which did you mean: (1) Emmett can check that a new version of a definition is compatible with the previous one (backward / forward / full, as registries do), for example in a test; (2) the exported schemas are accepted by the registries (Confluent, xRegistry, Apicurio, KurrentDB); or both?

Oskar (verbatim):

> 2. and maybe 1, but first 2

Decision (interpreted): first, exported schemas must be accepted by the registries (Confluent, xRegistry, Apicurio, KurrentDB). Checking compatibility between versions of a definition may come later.

#### Q34: the shared package

Following almanac (`@event-driven-io/almanac`, which `emmett` depends on), a split could be: the shared package holds what Pongo can use too (the `schema` builder, Standard Schema plumbing, `parse` / `safeParse` / `serialize` with `JSONSerializer`, JSON Schema and Avro export), and `emmett` builds `Event(...)` / `Command(...)` on top. Is that the split you want?

Oskar (verbatim):

> yes

Decision (interpreted): the shared package holds the `schema` builder, Standard Schema plumbing, `parse` / `safeParse` / `serialize` and JSON Schema / Avro export; `emmett` builds `Event(...)` / `Command(...)` on top. Open: where `JSONSerializer` lives (Emmett and Pongo's Dumbo each have one today).

#### Q35: package name

What should the shared package be called (`@event-driven-io/...`)?

Oskar (verbatim):

> how would you have something fitting to back to the future name?

Answer: suggestions given (Back to the Future, like Emmett and Almanac): `sketch` (Doc's flux capacitor drawing: the plan of a thing's shape), `time-circuits` (the dashboard showing destination, present and last departed: versions), `letter` (Doc's 1885 letter, delivered intact 70 years later: a message that survives time), `flux` (short, but clashes with Flux the React pattern and Flux CD). Recommended `sketch`.

Oskar (verbatim):

> none of that works great

Answer: second round of suggestions: `strickland` (Mr. Strickland, the strict vice principal who catches every slacker: validation), `einstein` (Doc's dog, the first time traveller, sent ahead to check the trip works), `model` (Doc's crude scale model of Hill Valley: "Please excuse the crudity of this model"). Recommended `strickland`.

Oskar (verbatim):

> no, it's used already, and i want something unique

Answer: checked unscoped names on npm (2026-10-23). Taken: strickland, time-circuits, clocktower, flux-capacitor, copernicus, einstein, gigawatts, mcfly, lorraine, plutonium and others. Free: jigowatt, outatime, lonepine, twinpines, mrfusion, hillvalley, timecircuits, tannen. Third round of suggestions: `lonepine` (Twin Pines Mall becomes Lone Pine Mall after Marty changes the past: same thing, new shape, because history changed, i.e. versioning and upcasting), `mrfusion` (turns garbage into fuel: `parse` turns untrusted input into typed data), `jigowatt` (Doc's "1.21 jigowatts"), `outatime` (the DeLorean's licence plate).

Oskar (verbatim):

> what outhers?

Answer: another npm check (2026-10-23). Also free: greatscott, 88mph, timetrain, fadingphoto, shonash, seamus, thisisheavy, noroads, hillvalleytelegraph, savetheclocktower, lyon-estates, timecircuits (unhyphenated). Taken: great-scott, density, hoverboard, docbrown, telegraph, timeline, ripple, paradox, flyer, lightning, blueprint, jules, eastwood, griff, heavy.

Oskar (verbatim):

> maybe something like schematic but not used, doesn't have to be from back to the future

Answer: npm check (2026-10-23). Taken: schematic, schematics, schematica, schemata, schemat, skema, skhema, schemer, schemable, schemix, skematic, schemo, schemr, schematist, schemaly, schemantic, schemagic, schematik, schemasmith, shapesmith, typesmith, schemagraph, blueprint, outline, contour, stencil, mould, morphe, eidos, forma, codex, canon, rubric, glyph and others. Free: schematix, schemist, schemetry, draughtsman, draftsman, schemaforge, schemacraft, schemaworks, schemant, shapewright, sigil, msgshape.

Oskar (verbatim):

> ok, then ltet's start with shapewright

Decision (interpreted): the shared package is `@event-driven-io/shapewright` for now.

#### Q36: where `JSONSerializer` lives

Emmett (`src/packages/emmett/src/serialization/json/jsonSerializer.ts`) and Pongo's Dumbo (`@event-driven-io/dumbo`, checked in its published typings) each have the same `JSONSerializer`, `JSONCodec` (with `upcast` / `downcast`) and `parseDates` options. `shapewright`'s `parse` / `serialize` need it. Should `JSONSerializer` and `JSONCodec` move into `shapewright`, with Emmett and Dumbo importing them from there?

Oskar (verbatim):

> for now, yes

Decision (interpreted): `JSONSerializer` and `JSONCodec` move into `shapewright` for now; Emmett and Dumbo import them from there.

#### Q37: how EventCatalog gets the definitions

From [findings/tooling.md](findings/tooling.md), sections 2.5 to 2.8. Three ways: (1) an EventCatalog generator module shipped by us, which users list in `eventcatalog.config.js` and which reads their definitions and writes catalog files through the MIT-licensed `@eventcatalog/sdk`; (2) a function or CLI that writes the catalog folder directly, run by users themselves; (3) export AsyncAPI and let users run EventCatalog's AsyncAPI generator, which needs a paid Scale licence or an AGPL-compatible project. The prototype did (2)-style writes with the SDK and it worked. Which way should the first version take?

Oskar (verbatim):

> all? but sequential?

Answer: all three can be done one after another, and they build on each other: (2) the function that writes catalog files is the base; (1) the generator is a thin wrapper that calls it from `eventcatalog.config.js`; (3) AsyncAPI export is separate work, and also useful outside EventCatalog.

#### Q37, asked again

Is the order 2, then 1, then 3 right?

Oskar (verbatim):

> makes sense

Decision (interpreted): EventCatalog support comes in this order: a function that writes catalog files, then an EventCatalog generator wrapping it, then AsyncAPI export.

#### Q38: where Emmett validates on its own

So far validation runs in the factory (opt-in) and when users call `parse` / `safeParse`. Emmett has other single points where it could run automatically if it knew the definitions ([findings/codebase.md](findings/codebase.md), section 3.2): on append, on read (after upcasting), and at the HTTP boundary in the Express, Hono and Fastify bindings. Should the first version validate automatically in any of those, or only when users call `parse`?

Oskar (verbatim):

> eventually we also need definition of stream and command hanlder and other, but we can do that later, we should definitely be able to pass to hono validators for commands like it gets zod automatically, also similar to express

Decision (interpreted): stream and command handler definitions come later. The first version must let command definitions plug into Hono's validators the way Zod schemas do (`@hono/standard-validator` takes any Standard Schema), and do the same for Express. No automatic validation on append or read was asked for.

Context checked: in Emmett's Hono e2e sample (`src/packages/emmett-honojs/src/e2e/decider/api.ts:68-95`), the request body (`{ productId, quantity }`) isn't the command data. The command is built from the route param `shoppingCartId`, the body, and a computed `unitPrice`.

#### Q39: what the HTTP validator checks

Since the body and the command data differ, what should a command definition validate at the HTTP boundary: (1) the body against the command's `data` schema, which only works when the body is the whole data; (2) a part of `data` picked or omitted from the definition (like Zod's `.pick()` / `.omit()`); or (3) a separate request schema, with the command validated by the factory once built?

Oskar (verbatim):

> I mean, it should be similar capabitliyt to what other gives, we should also allow to have some easy without pipck, research

> Dude, focus on hono, express and fastify, maybe also nestjs (but just to check if we're good)

Research scope: how Hono, Express and Fastify validate requests with schemas (and NestJS as a check), and how they handle input whose parts come from the body, route params and query.

Research: [findings/http-validation.md](findings/http-validation.md). All four frameworks validate each request part (body, params, query, headers) separately, and the command is built afterwards in the handler. Hono (`@hono/standard-validator`) takes any Standard Schema; nestjs-zod needs only a `parse` method; Fastify validates JSON Schema natively but has no established Standard Schema type provider; Express has no built-in validation and its schema middlewares are small and Zod-only (`express-zod-safe` validates `{ params, query, body }`). None of them builds one object from params plus body.

#### Q39, asked again

Is this what you meant: the easy path is passing the definition directly, and it validates the body as the command's `data` (`sValidator('json', ConfirmShoppingCart)`); when the body is only part of `data`, users derive a schema with `.pick()` / `.omit()`, or write a separate one, as with Zod today?

Oskar (verbatim):

> what's sValidator?

Answer: `sValidator` is the middleware exported by `@hono/standard-validator` (Hono's official middleware repo, 1.1M weekly downloads). It takes a request part (`'json'`, `'param'`, `'query'`, `'header'`, `'form'`, `'cookie'`) and any Standard Schema, validates that part, returns 400 on failure (or calls an optional hook), and makes the typed value available as `c.req.valid('json')`. `zValidator` from `@hono/zod-validator` is the Zod-only version. Q39 stays open.

Oskar (verbatim):

> yes, as data

Decision (interpreted): a definition passed to a validator (its Standard Schema `~standard`) validates the request body as the command's `data`. When the body is only part of `data`, users derive a schema with `.pick()` / `.omit()` or write a separate one. Note: this makes the definition's Standard Schema cover `data`, while `parse` / `safeParse` cover the whole `{ type, data, metadata }` message.

#### Q40: the missing pieces in Express and Fastify

Hono works with definitions through `sValidator` as it is. Express has no schema validation built in, and Fastify has no used Standard Schema type provider. Should Emmett's Express binding ship a `validate({ body, params, query })` middleware that takes Standard Schemas (definitions included), and Emmett's Fastify binding ship a type provider for them?

Oskar (verbatim):

> yes

Decision (interpreted): Emmett's Express binding ships a `validate({ body, params, query })` middleware taking Standard Schemas, definitions included; Emmett's Fastify binding ships a type provider for them. Hono uses `sValidator` as it is.

#### Q41: test generation

From [findings/tooling.md](findings/tooling.md), section 5: definitions can feed Emmett's Given/When/Then specs with (a) example payloads (from `examples`, or generated from JSON Schema with `json-schema-faker`, which gave 0 invalid values in 2000 in the experiment), (b) a property check that every event `decide` returns is valid against its own definition, and (c) round-trip checks (serialize, upcast, parse). They can't supply the expected events in `then`. Generated values are valid but not meaningful (random ids, huge quantities). Is any of (a), (b) or (c) part of the first version, or does test generation come later?

Oskar (verbatim):

> I mean, it should be idiomatic in all frameworks or similar to popular plugins and compatible tiht htme

Decision (interpreted, about Q40, the web bindings): each binding follows the idiom of the popular plugin for its framework and stays compatible with it: Hono like `@hono/standard-validator` / `@hono/zod-validator` (`sValidator('json', X)`, `c.req.valid('json')`); Express like `express-zod-safe` (`validate({ params, query, body })`); Fastify like `fastify-type-provider-zod` (validator compiler plus type provider, `schema: { body, params, querystring }`); NestJS works with `nestjs-zod` (`createZodDto(schema)`). Q41 (test generation) is still open.

Conflict found: `nestjs-zod` calls the schema's `parse` method on the request body ("The only requirement is that the schema has a method called `parse`"). Q16 made a definition's `parse` validate the whole `{ type, data, metadata }` message, while Q39 made the definition validate the body as `data` when passed to a validator. Passed to `createZodDto`, a definition would reject every valid body.

#### Q42: what `parse` on a definition validates

Which way: (1) a definition behaves like a schema of its `data` everywhere (`parse`, `safeParse` and `~standard` all validate `data`, as a Zod schema would), with a separate method for the whole message; or (2) `parse` / `safeParse` stay for the whole message, and the definition exposes its data schema as `X.data` for NestJS and the other plugins?

Oskar (verbatim):

> maybe safe it'd be data and metadata, and explicitly use .data? Thoughts? What follow sthe least surprise?\

Answer (Oskar asked for an opinion): agreed, option 2 is the least surprising. Reason: in Zod, `schema.parse(x)` returns `z.infer<typeof schema>`, the same type the schema stands for. Here `typeof X.Type` and the factory's return value are the whole message, so `X.parse(x)` and the definition's Standard Schema (`StandardSchemaV1.InferOutput<typeof X>`) should return the whole message too. One rule: "a definition always means the message; `X.data` and `X.metadata` mean the parts". This reverses the detail from Q39: passing `X` to a validator would validate a whole message; for a request body, users pass `X.data` (`sValidator('json', ConfirmShoppingCart.data)`, `createZodDto(ConfirmShoppingCart.data)`).

#### Q42, asked again

Confirm: a definition (`parse`, `safeParse`, `~standard`) always validates the whole message, and `X.data` / `X.metadata` are the part schemas for HTTP validators and plugins?

Oskar (verbatim):

> ok,

Decision (interpreted): a definition (`parse`, `safeParse`, `~standard`) always validates the whole message; `X.data` and `X.metadata` are the part schemas, used for HTTP validators and plugins (`sValidator('json', X.data)`, `validate({ body: X.data })`, `createZodDto(X.data)`). This replaces the Q39 detail where passing `X` meant `data`.

#### Q41, asked again

Should test generation (example payloads, a check that every event `decide` returns matches its definition, round-trip checks) be part of the first version, or come later?

Oskar (verbatim):

> a - ues
> b-c - maybe but last step

Decision (interpreted): example payloads are in the first version. The check that `decide` returns valid events and the round-trip checks may come, as the last step.

#### Q43: where examples come from

Should `X.example()` return only the `examples` written on the definition, or also generate one from the schema when none are written? Generating needs a generator: `json-schema-faker` (verified 0 invalid in 2000 in the experiment) as a dependency, or Emmett's own for the built-in `schema` kinds.

Oskar (verbatim):

> 1

Decision (interpreted): `X.example()` returns only the `examples` written on the definition. Nothing is generated.

#### Q44: ready for the spec?

Remaining points would go into spec.md as open questions rather than more Q&A: the JSON Schema target (2020-12 vs draft-07; registries and EventCatalog examples use both), how Avro export maps types (dates, bigint, unions), how definition upcasters combine with read-time `upcast`, the final name of the `schema` builder, and the stream and command handler definitions planned for later. Should I write spec.md now?

Oskar (verbatim):

> yes

Spec written: [spec.md](spec.md).

#### Q45: GitHub

Should spec.md go to a GitHub repository? This folder is already inside the Emmett repo on branch `schema_research`, so the options are committing it there, or creating a separate GitHub repository for it. Nothing is committed or pushed without your go-ahead.

Oskar (verbatim):

> deserialize for objects such as PostgreSQL JSONB - wot?

Answer: when Emmett reads from PostgreSQL, the event store never sees a JSON string. Dumbo registers a pg type parser for `jsonb` (OID 3802) and `json` (114) that calls the event store's configured serializer, `options.serializer.deserialize(val)` (`@event-driven-io/dumbo` `dist/pg.js:2578-2584`, `src/storage/postgresql/pg/serialization/index.ts`), and the PostgreSQL event store passes its `serialization` options to Dumbo (`src/packages/emmett-postgresql/src/eventStore/postgreSQLEventStore.ts:337-340`). So `deserialize` has already run before a definition's `parse` gets the event, and dates are `Date` only if the store was configured with `parseDates: true`. The spec's open question is therefore narrower: when a store isn't configured with `parseDates`, `schema.date()` rejects the ISO string; is that acceptable (configure the store), or should `parse` handle it?

Oskar (verbatim):

> I dont understand, store gives json, that parses events. Eventually we'll add schema registry that'll allow passing streams and events schema, but I told it's for later.
>
> We were discussing parsing json and/or avro later and objects afaik

Decision (interpreted): event stores are out of scope for the first version. They keep returning deserialized events as today; letting stores take stream and event schemas comes later, with the registry. A definition's `parse` / `safeParse` are about parsing a JSON string or an already-parsed object, and Avro input later. Removed the store-related open question from the spec, and changed the spec so that only `parse` applies a definition's upcaster; event store reads keep their current `upcast` option until store integration.
