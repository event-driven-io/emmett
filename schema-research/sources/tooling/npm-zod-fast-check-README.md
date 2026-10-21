# zod-fast-check

A small library to automatically derive [fast-check](https://github.com/dubzzz/fast-check) [arbitraries](https://github.com/dubzzz/fast-check/blob/master/documentation/Arbitraries.md) from schemas defined using the validation library [Zod](https://github.com/colinhacks/zod). These enables easy and thorough property-based testing.

## Usage

Here is a complete example using [Jest](https://jestjs.io/).

```ts
import * as z from "zod";
import * as fc from "fast-check";
import { ZodFastCheck } from "zod-fast-check";

// Define a Zod schema
const User = z.object({
  firstName: z.string(),
  lastName: z.string(),
});

// Define an operation using the data type
function fullName(user: unknown): string {
  const parsedUser = User.parse(user);
  return `${parsedUser.firstName} ${parsedUser.lastName}`;
}

// Create an arbitrary which generates valid inputs for the schema
const userArbitrary = ZodFastCheck().inputOf(User);

// Use the arbitrary in a property-based test
test("User's full name always contains their first and last names", () =>
  fc.assert(
    fc.property(userArbitrary, (user) => {
      const name = fullName(user);
      expect(name).toContain(user.firstName);
      expect(name).toContain(user.lastName);
    })
  ));
```

The main interface is the `ZodFastCheck` class, which has the following methods:

### inputOf

`inputOf<Input>(zodSchema: ZodSchema<unknown, ZodTypeDef, Input>): Arbitrary<Input>`

Creates an arbitrary which will generate values which are valid inputs to the schema. This should be used for testing functions which use the schema for validation.

### outputOf

`outputOf<Output>(zodSchema: ZodSchema<Output, ZodTypeDef, unknown>): Arbitrary<Output>`

Creates an arbitrary which will generate values which are valid outputs of parsing the schema. This means any transformations have already been applied to the values. This should be used for testing functions which do not use the schema directly, but use data parsed by the schema.

### override

`override<Input>(schema: ZodSchema<unknown, ZodTypeDef, Input>, arbitrary: Arbitrary<Input>): ZodFastCheck`

Returns a new `ZodFastCheck` instance which will use the provided arbitrary when generating inputs for the given schema. This includes if the schema is used as a component of a larger schema.

For example, if we have a schema which validates that a string has a prefix, we can define an override to produce valid values.

```ts
const WithFoo = z.string().regex(/^foo/);

const zodFastCheck = ZodFastCheck().override(
  WithFoo,
  fc.string().map((s) => "foo" + s)
);

const arbitrary = zodFastCheck.inputOf(z.array(WithFoo));
```

Schema overrides are matched based on object identity, so you need to define the override using the exact schema object, rather than an equivalent schema.

If you need to use zod-fast-check to generate the override, it is easy to end up with a circular dependency. You can avoid this by defining the override lazily using a function. This function is called with the `ZodFastCheck` instance as an argument.

```ts
const WithFoo = z.string().regex(/^foo/);

const zodFastCheck = ZodFastCheck().override(WithFoo, (zfc) =>
  zfc.inputOf(z.string()).map((s) => "foo" + s)
);

const arbitrary = zodFastCheck.inputOf(z.array(WithFoo));
```

## Supported Zod Schema Features

### Data types

✅ string (including email, datetime, UUID and URL)  
✅ number  
✅ nan  
✅ bigint  
✅ boolean  
✅ date  
✅ undefined  
✅ null  
✅ symbol
✅ array  
✅ object  
✅ union  
✅ discriminated union  
✅ tuple  
✅ record  
✅ map  
✅ set  
✅ function  
✅ literal  
✅ enum  
✅ nativeEnum  
✅ promise  
✅ any  
✅ unknown  
✅ void  
✅ optional  
✅ nullable  
✅ default  
✅ branded types  
✅ transforms  
✅ refinements (see below)  
✅ pipe  
✅ catch  
❌ intersection  
❌ lazy  
❌ never

### Refinements

Refinements are supported, but they are produced by filtering the original arbitrary by the refinement function. This means that for refinements which have a very low probability of matching a random input, it will not be able to generate valid values. This is most common when using refinements to check that a string matches a particular format. If this occurs, it will throw a `ZodFastCheckGenerationError`.

In cases like this, it is recommended to define an override for the problematic subschema.

