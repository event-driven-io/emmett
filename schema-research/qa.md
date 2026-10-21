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

Raw sources are in [sources/](sources/), downloaded packages in [packages/](packages/), and compiled experiments in [prototypes/](prototypes/).

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
