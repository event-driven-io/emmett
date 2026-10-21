# #7: How about producing and emitting schemas?
Source: https://github.com/standard-schema/standard-schema/issues/7 (state: open, created 2024-09-20T00:10:20Z, by romeerez)

I'm glad to find the standard-schema initiative, thanks for starting it!

I'd like to ask about two different cases: producing at runtime, and emitting schemas.

## Producing schemas at runtime

In my case, it's an ORM where user defines column types in some specific way, and it can produce zod and valibot schemas at runtime:

```ts
// imaginary syntax:
const dbTable = defineTable('myTable', (t) => ({
  id: t.serial().primaryKey(),
  name: t.text().unique(),
  bio: t.text().max(1000),
}))

dbTable.outputSchema() // zod or valibot schema, based on user config
dbTable.inputSchema()
dbTable.createSchema() // id is omitted
dbTable.updateSchema() // partial
```

That's my use-case, which is applicable for any ORM, query-builder, and similar libraries that allow to define types with their custom DSL. And the DSL has to be custom because of their specifics.

I propose to define an AST that potentially covers all features of all the validation libraries, starting with a limited set, of course, the ast will be translated to a target schema by a third-party library.

So standard-schema defines an interface, zod defines specific schemas, and imaginary package @standard-schema/zod-producer connects to a standard-schema interface and knows how to produce a zod schema from the AST.

Different libraries have different feature set, so there should be a way to require a set of needed features. If, for example, client library needs discriminated unions, but user specifies a schema producer that doesn't support that, it fails at runtime. Could fail in compile time as well.

## Schemas code-generation

Producing schemas at runtime has a caveat that the produced validation schema depends on the library (ORM) itself. In my case, it's backend-only, and it's not an option for user to import such a schema to the frontend in monorepo. This feature was requested a couple of times.

To support re-using validation on frontend, the only way is to have a CLI command to generate schemas code (let me know if there are other ways).

Code-generating schemas would be beneficial to libraries that have types defined outside of JS: GraphQL schemas, protobufs, introspecting database schemas.

The same AST from the above could be used by a third-pary library to generate code.

## Comment by fabian-hiller at 2024-10-06T15:37:55Z

Thanks for sharing these ideas! I was already thinking about an AST-like representation of schemas, similar to JSON Schema but optimized for TypeScript. Probably not something we want to tackle right now, but definitely something very interesting for the future. This AST representation can then be used to directly validate unknown data or to generate its representation in a specific schema library like Zod, Valibot, or ArkType.

## Comment by romeerez at 2024-10-06T17:22:27Z

I can see how it sounds too complex and not too realistic, so it's understandable why we don't currently have such a common AST.

As for runtime schema generation, it indeed has to map the AST to a validation lib on a TypeScript level, and I'd bet it's too impossible and risky to land up with "type instantiation is excessively deep" kind of problems.

But, the generation doesn't require TS mappings, so it's more realistic, and would be very useful.

For another use-case that I encountered recently, I was using [@anatine/zod-mock](https://github.com/anatine/zod-plugins/tree/main/packages/zod-mock) to generate fake data for tests, and also wanted to support valibot. Luckily, someone already covered that: [valimock](https://github.com/Saeris/valimock), and this is probably a good tool and is enough, but you can see that some cases aren't implemented, and the fact that people have spend time to implement same kind of work for different libraries sounds like something a good engineer would want to automate.

You could write a mapping from a library schema to the common AST once (typebox, vine.js, effect schemas, etc), and write a mock data library for that AST just once. Or a library to generate protobufs, graphql types, it would be easier to generate anything, because right now you'd have to dig into implementation details of a given library and support only a single one at a time.

So the common AST doesn't have to deal with TypeScript type mappings, but to be an extended version of JSON schema. Because JSON schema is only for JSON types, and validation libs can also handle Date objects, functions, other objects, custom validations (`refine` in zod) and various things.

## Comment by ssalbdivad at 2024-10-18T16:37:01Z

This "extended version of JSON schema optimized for TS types" is essentially what `@ark/schema` attempts to solve. It's the internal representation used for ArkType's type system.

As is, the requirements are quite stringent around how sets of types can be organized to ensure they are always fully reduced in ArkType, but for other validators where that's not a goal, we may eventually be able to adopt a looser version of that format.

It also offers some big advantages of JSON schema in terms of granularity e.g. being able to assign metadata to an individual constraint like a regex as opposed to only on the root of a type itself, giving you a lot more control over error messages.

As @fabian-hiller points out though, this would be a much bigger undertaking than the original scope of the project to do well.

## Comment by logaretm at 2024-10-18T18:29:35Z

Forms would benefit greatly from this. Like we have discussed in #11, this can offload some decisions to the implementing form library like default value generation.

Something also that I have implemented with varying degree of success in my work is "path descriptors" which are basically some simple hints about a field/path.

The main use-case where we do actually walk the tree of different providers like Zod/Yup/Valibot is to determine if a field is required through detecting the presence of some validators, yes it is not perfect and doesn't cover custom validators but many people liked it because it reduces the verbosity of UI considerably using the schema as the source of truth.

Another use-case is form generation given a schema, but maybe I will create a specific discussion for this once I gather my thoughts on it.

I initially wanted to build more on this concept by extracting some other metadata like `maxLength` and other validators that can be represented as UI hints (e.g: `x characters remaining`) or upgrading validators to active constraints, in other words actively prevent more characters from being entered. I think an AST can allow something like that because it is possible with every schema provider I have tried so far.

If this is out of scope for now then it is fine, but it would go along way to furthering custom logic and decision making for extended libraries like forms. Ideally I want to only support this standard rather than maintain different implementations with inconsistent feature parity.

## Comment by fabian-hiller at 2024-10-18T19:36:18Z

Once the standard spec is in v1, we can start thinking about what would be the right approach for a standard TS schema AST. Basically, it could live parallel to the spec in a `@standard-schema/ast` package instead of being included in the spec.

## Comment by datner at 2024-10-23T22:49:31Z

I don't think it's the right approach to leave this as an afterthought.. The way the spec is currently structured is by declaring some shared interface and calling it a day. That is useful, but nothing trivial adapters don't currently solve.

By defining an AST a lot of the hard questions that are not immediately evident would raise their heads.
It does not mean to commit to that AST, but working from the technical requirements into an interface (like a spec) rather than working from an interface into the technical requirements (like a library) would make sure that instead of having `v1`, which is a fundamentally arbitrary shared interface and a `v2` that would instantly deprecate it. `v1` would take longer to cook but would be significantly more future-looking

## Comment by fabian-hiller at 2024-10-23T23:52:10Z

From my experience as the author of Modular Forms and Valibot, who regularly talks to other framework and library authors, I think the Standard Schema spec is exactly what most frameworks and libraries are looking for right now to simplify compatibility with schema libraries.

I think a standard AST is mainly interesting for form libraries and AI SDKs. Also, it is much harder, and in some cases probably impossible, to define such an AST that works for everyone, and to convince most schema libraries to rewrite their code. For this reason, the AST requires much more effort and time, which I don't have. Therefore, it is a lower priority for me at the moment.

However, feel free to talk to other schema library authors and write an initial proposal for a standard AST. Perhaps you could also lead this effort.

## Comment by igalklebanov at 2024-12-24T21:57:36Z

We owe all of you some 🍻 .

---

+1'ing the codegen use case.

downstream codegen library -> standard schema/s.
standard schema/s -> standard codegen library -> zod/valibot/arktype/etc schema/s.
downstream codegen library now supports all the flavors! 😋 

## Comment by duncanbeevers at 2025-04-10T00:25:22Z

I'm a maintainer on [openapi-typescript](https://github.com/openapi-ts/openapi-typescript), and we're looking at ways in which the Schema-as-Validation and Schema-as-Types communities can maximize impact.

We've been focused on *generating* concrete TypeScript types based on OpenAPI types. OpenAPI depends heavily on JSONSchema, and it seems there's likely opportunity to identify some common functionality, while we continue spending effort supporting the OpenAPI-specific concepts.

If there's a community discussing these topics feel free to DM me, or to continue conversation here.

## Comment by sandros94 at 2025-08-09T16:19:17Z

Indeed I see this more on the scope of a `@standard-schema/ast` rather than `spec` itself. As this will be more for advanced libraries rather general use, while allowing validation libraries to hop in if interested 

## Comment by fabian-hiller at 2025-08-10T02:41:46Z

We are currently exploring the possibility of integrating JSON Schema. We may share more information in the coming weeks.

## Comment by sinclairzx81 at 2025-08-11T05:16:21Z

@fabian-hiller Hello, 

> We are currently exploring the possibility of integrating JSON Schema. We may share more information in the coming weeks.

Having JSON Schema supported in StandardSchemaV2 would be good, but would it be possible for the specification to mandate that a future `['~standard'].schema()` function return statically observable schematics?

As each library would know the return structures it generates per type, it should be feasible to produce a static type representation that matches those return structures. For example:

```typescript
// Bad ❌

const T = x.object({                                // const T: JsonSchema = ...
  x: x.number(),                                    //
  y: x.number(),                                    // ^ schematics opaque
  z: x.number(),
})['~standard'].schema()

// Good ✔️ 

const S = x.object({                                // const S: {
  x: x.number(),                                    //   type: 'object',
  y: x.number(),                                    //   required: ['x', 'y', 'z'],
  z: x.number(),                                    //   properties: {
})['~standard'].schema()                            //     x: { type: 'number' },
                                                    //     y: { type: 'number' },
                                                    //     z: { type: 'number' }
                                                    //   }
                                                    // } = ...

S.properties.x.type                                 // 'number' type-safe navigable properties

// Remote Library Inference

type Infer<T> =
  T extends { properties: infer P } ? { [K in keyof P]: Infer<P[K]> } :
  T extends { const: infer C } ? C :
  T extends { type: 'number' } ? number : 
  T extends { type: 'string' } ? string :
  T extends { type: 'boolean' } ? boolean :
  unknown


type X = Infer<typeof S>                           // type X = {
                                                   //   x: number;
                                                   //   y: number;
                                                   //   z: number;
                                                   // }
```

This would mean type inference could be handled uniformly by libraries that focus specifically on JSON Schema inference.  

https://github.com/ThomasAribart/json-schema-to-ts

It would also mean issues would be mitigated related to X > JSON Schema type mismatch; where a library may infer a type that is mismatched to the schema it generates. This would be the case if having to rely on `['~standard'].validate()` return types to infer generated JSON Schema.

---

Let me know your thoughts.






## Comment by fabian-hiller at 2025-08-11T07:45:30Z

Hey! Thank you for sharing this idea! How many schema libraries do you know of that return statically observable types? If most libraries don't support it, standardizing it will be difficult. It would be complicated for Valibot to return such a type because, unlike TypeBox, we are not built natively on top of JSON Schema. It would require a very long, complex conditional type, and I'm afraid there might be edge cases, such as recursive schemas, that cannot be represented correctly.

## Comment by sinclairzx81 at 2025-08-11T10:35:23Z

@fabian-hiller Hiya, Thanks for the response. 

---

> How many schema libraries do you know of that return statically observable types?

None as far as I know (but then again, it's new for libraries to be generating remote schematics). This said, I think static introspectable schematics is going to be an important step towards achieving unified inference and validation as well as establishing a common AST. Just need libraries to converge on a common schema specification first.

---

> If most libraries don't support it, standardizing it will be difficult.

Well, I wouldn't expect anyone to support aspects of a specification that doesn't exist yet, but being able to generate a static types that correlate to generated runtime structures (JSON schema or otherwise) should be a straight forward process. I wouldn't expect it to be a significant hurdle for authors and contributors trying to adopt a V2 specification.

---

> It would be complicated for Valibot to return such a type because, unlike TypeBox, we are not built natively on top of JSON Schema.

Libraries don't need to be JSON Schema first to generate it statically. Here is a quick external mapping for Valibot that creates type level JSON Schema mappings. The mapping logic (12 lines) would be simpler to implement internal to Valibot and next to the actual schema generation code.

[ToSchema | FromSchema Reference](https://www.typescriptlang.org/play/?moduleResolution=99&target=99&jsx=0&module=199#code/JYWwDg9gTgLgBAKjgQwM5wG5wGZQiOAcg2QBtgAjCGQgKFoGMIA7VeAFTgF5MA6CCgCsApgxgAKAN5wZsufID0CuE1YcAXHwDyQ0TADKDABbCQyADyTaMgB6aMvNlGDMA5uICUAGnm+-cJVkoYWQAExZSAE84Oz59GGc3QxMzcwBXZlDhbBdhUIA+AG5rOEj7XmY0kAphKE8ff0aA5RlgsIjosr4AOSqaqGTTCwysnOY8opKAL3KqCFIQ5nqm-0DWkPDmKLgZvgAhCHnFwdSR7NyC4pkAd3LyGFqycUIbSKnCDxXZNbg2ze3bnwADLAB5QMgnCwAIleUyhPjOYwmxQAvp8vhi-IEUQjMudxgV6DBImBhHB9Nw4OwIJDzMTSRBsFT8o1AvSyRSeFZMTysS04OzNFCBCIxFCrrzJTIfsEAI5pYDBUJC65QuAAHzgMLVmqhkR1WrhEqlvJ+YDwpNgwGEqE03JNpv5tjtApJwiFThcrnFcBRxodGJ+Mi60kFWsq1VqPr9JQDgadOxdYahcwWyGY0f9caaQbggOkqjYQthmdj2Zz-Jj5a+2KJbrgAA1KQAxPAgWn6Fnx12kxuU+3V1n82KetxZweKfldCP9ccT7783apxZz+fNWSAmFvcVltcL330QIAWhPp7P54vl6v15vt5PtECrfwkIfyjv74-n4-tHZcCf7eMIZzHYFkuBKThhBsB5MnQaRzQgS0YGtW04BcbBajgAAFX04AAfjgaQAG0AGlUOYOAAGthEiRksIAXU0f9aUwki6JZFE4HUcC4Eg6DQlglQWCLMj0KgOAAGEcPwySuJkCCoOEGCCJ7d0iBnWpCCkuB1LEzRuN4xT+OUsNCFHVxNI4-CzM4-SFKU0M3U0Qhl3TCy8LgFzyNkuAMgo5gIGuZhXzgL9QrC0LgupF9j3C2K4svH96yiwCzB0UUYHMbCDKUgAlURoFCTKLVqYliOo3E-IC5h8i8EpMOKq0bR4uyjLypgoEK+qEJKyIysiHx00iUCCLLI8-g6OASLIyjqNozCGKpGkUosFjiLYkoOIAMgInFaGGhzSSckU9EIHw5QVJVNComimS6xDkJ8eD7ptTQ7pK5CcMS3tkpSCwQMpcRbL49AHDSvRaTQjCspa9A2oKorutgXrypQZghoGtGWXwssfqGMGxEyllvPk4HgVBR5SAh5hRIkjGhvcgshJgTRJI44nmtJhwDiOdNaUGrHjMcohPLc9nsqMhxekjAZlvMfmGZUpydNFoHDJB3h4kSVw+cxhWTLMlWZEkFFaA8eggA)

```typescript
import * as v from 'valibot'

const T = v.object({               // const T: v.ObjectSchema<{
  x: v.string(),                   //   readonly x: v.StringSchema<undefined>;
  y: v.number(),                   //   readonly y: v.NumberSchema<undefined>;
  z: v.boolean(),                  //   readonly z: v.BooleanSchema<undefined>;
  w: v.literal('xyz')              //   readonly w: v.LiteralSchema<"xyz", undefined>;
})                                 // }, undefined>

type S = ToSchema<typeof T>         // type S = {
                                    //   type: "object";
                                    //   required: "w" | "x" | "y" | "z";
                                    //   properties: {
                                    //     x: { type: "string"; };
                                    //     y: { type: "number"; };
                                    //     z: { type: "boolean"; };
                                    //     w: { const: "xyz"; };
                                    //   };
                                    // }

type X = FromSchema<S>              // type X = {
                                    //   x: string;
                                    //   y: number;
                                    //   z: boolean;
                                    //   w: "xyz";
                                    // }
```

---

> It would require a very long, complex conditional type, and I'm afraid there might be edge cases, such as recursive schemas, that cannot be represented correctly.

Mapping runtime types to JSON schema structures is a relatively straight forward process so long as runtime type structures are statically observable (as is the case for Valibot - as per link). The same would be true for Zod. I wouldn't be too concerned about complex conditional types, schema mapping is not that bad.

With regards to recursive schemas though, it is a big topic (too big to go into here). I will say that JSON Schema is referential ($ref), so the generated runtime/static structures need not generate self recursive types (cyclic), only non-cyclic referential structures (usually with $ref + $defs)

As for how libraries go about generating referential schematics from cyclic structures, that is a challenge for each library. But worse case scenario would be to simply map `{} - any` as that's historically been the defacto way to express recursion. 

---

Happy to discuss more.







## Comment by sinclairzx81 at 2025-09-24T05:07:19Z

@fabian-hiller Hi, was there any follow up on this one?

Just a heads up. I've recently published TB 1.0 which includes validation support for Standard Schema. This feature would ironically put TB under the "tools / frameworks" section of the README  (which I thought was interesting), but this aside ... I am currently looking at ways to try and get Standard Schema integrated into various OpenAPI and Json Schema infrastructure. 

Based on what I see, the easiest path for Json Schema frameworks to adopt Standard Schema would be if:

1) Standard Schema expose a `toJsonSchema()` function on the `StandardSchemaVX` interface (validation | planned?)
2) Standard Schema ensure `toJsonSchema()` function returns statically observable Json Schema (inference)

It is point 2 that seems somewhat contentious. While an integrator could technically infer from the `~standard.validate`, as the integrator will likely already have Json Schema inference infrastructure available to them, they are now faced with having to introduce a specialized type mapping path for the `~standard.validate` return type when it would just be easier to derive the static type from schematic structures return from `toJsonSchema()` (as per [reference](https://www.typescriptlang.org/play/?moduleResolution=99&target=99&jsx=0&module=199#code/JYWwDg9gTgLgBAKjgQwM5wG5wGZQiOAcg2QBtgAjCGQgKFoGMIA7VeAFTgF5MA6CCgCsApgxgAKAN5wZsufID0CuE1YcAXHwDyQ0TADKDABbCQyADyTaMgB6aMvNlGDMA5uICUAGnm+-cJVkoYWQAExZSAE84Oz59GGc3QxMzcwBXZlDhbBdhUIA+AG5rOEj7XmY0kAphKE8ff0aA5RlgsIjosr4AOSqaqGTTCwysnOY8opKAL3KqCFIQ5nqm-0DWkPDmKLgZvgAhCHnFwdSR7NyC4pkAd3LyGFqycUIbSKnCDxXZNbg2ze3bnwADLAB5QMgnCwAIleUyhPjOYwmxQAvp8vhi-IEUQjMudxgV6DBImBhHB9Nw4OwIJDzMTSRBsFT8o1AvSyRSeFZMTysS04OzNFCBCIxFCrrzJTIfsEAI5pYDBUJC65QuAAHzgMLVmqhkR1WrhEqlvJ+YDwpNgwGEqE03JNpv5tjtApJwiFThcrnFcBRxodGJ+Mi60kFWsq1VqPr9JQDgadOxdYahcwWyGY0f9caaQbggOkqjYQthmdj2Zz-Jj5a+2KJbrgAA1KQAxPAgWn6Fnx12kxuU+3V1n82KetxZweKfldCP9ccT7783apxZz+fNWSAmFvcVltcL330QIAWhPp7P54vl6v15vt5PtECrfwkIfyjv74-n4-tHZcCf7eMIZzHYFkuBKThhBsB5MnQaRzQgS0YGtW04BcbBajgAAFX04AAfjgaQAG0AGlUOYOAAGthEiRksIAXU0f9aUwki6JZFE4HUcC4Eg6DQlglQWCLMj0KgOAAGEcPwySuJkCCoOEGCCJ7d0iBnWpCCkuB1LEzRuN4xT+OUsNCFHVxNI4-CzM4-SFKU0M3U0Qhl3TCy8LgFzyNkuAMgo5gIGuZhXzgL9QrC0LgupF9j3C2K4svH96yiwCzB0UUYHMbCDKUgAlURoFCTKLVqYliOo3E-IC5h8i8EpMOKq0bR4uyjLypgoEK+qEJKyIysiHx00iUCCLLI8-g6OASLIyjqNozCGKpGkUosFjiLYkoOIAMgInFaGGhzSSckU9EIHw5QVJVNComimS6xDkJ8eD7ptTQ7pK5CcMS3tkpSCwQMpcRbL49AHDSvRaTQjCspa9A2oKorutgXrypQZghoGtGWXwssfqGMGxEyllvPk4HgVBR5SAh5hRIkjGhvcgshJgTRJI44nmtJhwDiOdNaUGrHjMcohPLc9nsqMhxekjAZlvMfmGZUpydNFoHDJB3h4kSVw+cxhWTLMlWZEkFFaA8eggA))

Has there been any updates recently?








## Comment by fabian-hiller at 2025-09-28T01:36:53Z

I am very sorry for my late reply! I think this is really interesting but I don't have a lot time right now working on it.

> get Standard Schema integrated into various OpenAPI and Json Schema infrastructure

@colinhacks, @ssalbdivad and I have been working on that, and we'll probably publish a preview soon.