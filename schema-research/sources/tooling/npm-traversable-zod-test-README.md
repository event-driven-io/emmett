<br>
<h1 align="center">ᯓ𝘁𝗿𝗮𝘃𝗲𝗿𝘀𝗮𝗯𝗹𝗲/𝘇𝗼𝗱-𝘁𝗲𝘀𝘁</h1>
<br>

<p align="center">
  Testing utility that generates arbitrary, <a href="https://en.wikipedia.org/wiki/Pseudorandomness" target="_blank">pseudorandom</a> <a href="https://zod.dev" target="_blank">zod</a> schemas, powered by <a href="https://github.com/dubzzz/fast-check" target="_blank"><code>fast-check</code></a>
</p>

<div align="center">
  <img alt="NPM Version" src="https://img.shields.io/npm/v/%40traversable%2Fzod-test?style=flat-square&logo=npm&label=npm&color=blue">
  &nbsp;
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.5%2B-blue?style=flat-square&logo=TypeScript&logoColor=4a9cf6">
  &nbsp;
  <img alt="License" src="https://img.shields.io/static/v1?label=License&message=MIT&labelColor=59636e&color=838a93">
  &nbsp;
  <img alt="npm" src="https://img.shields.io/npm/dt/@traversable/zod-test?style=flat-square">
  &nbsp;
</div>

<div align="center">
  <!-- <img alt="npm bundle size (scoped)" src="https://img.shields.io/bundlephobia/minzip/%40traversable/zod-test?style=flat-square&label=size">
  &nbsp; -->
  <img alt="Static Badge" src="https://img.shields.io/badge/%F0%9F%8C%B2-tree--shakeable-brightgreen?labelColor=white">
  &nbsp;
  <img alt="Static Badge" src="https://img.shields.io/badge/ESM-supported-2d9574?style=flat-square&logo=JavaScript">
  &nbsp;
  <img alt="Static Badge" src="https://img.shields.io/badge/CJS-supported-2d9574?style=flat-square&logo=Node.JS">
  &nbsp;
</div>
<br>
<br>

## Requirements

`@traversable/zod-test` has 2 peer dependencies:

1. [`zod`](https://zod.dev/) (v4)
2. [`fast-check`](https://fast-check.dev/)

## Usage

```bash
$ pnpm add -D @traversable/zod-test zod fast-check
```

Here's an example of importing the library:

```typescript
import { z } from 'zod'
import { zxTest } from '@traversable/zod-test'

// see below for specifc examples
```

## Track record

`@traversabe/zod-test` has found several upstream bugs in `zod`:

1. Security exploit: `z.object` pollutes the global `Object` prototype
  - [Issue](https://github.com/colinhacks/zod/issues/4357)
  - [Sandbox](https://stackblitz.com/edit/vitest-dev-vitest-ypelnmjv?file=test%2Frepro.test.ts&initialpath=__vitest__/)

2. Bug: `z.literal` escaping bug
  - [Issue](https://github.com/colinhacks/zod/issues/4894)
  - [Sandbox](https://stackblitz.com/edit/vitest-dev-vitest-w1um2qny?file=test%2Frepro.test.ts&initialpath=__vitest__/)

3. Bug: "Diagonal" objects passed to `z.enum` produce false negatives
- [Issue](https://github.com/colinhacks/zod/issues/4353)
- [Sandbox](https://stackblitz.com/edit/vitest-dev-vitest-srmahjsw?file=package.json,test%2Fenum.test.ts&initialpath=__vitest__/)

4. Bug: `z.file` output type incompatible with `globalThis.File`
  - [Issue](https://github.com/colinhacks/zod/issues/4973)
  - [Sandbox](https://stackblitz.com/edit/zod-file-bug-repro?file=test%2Frepro.test.ts&initialpath=__vitest__/)


## Table of contents

- [`zxTest.fuzz`](https://github.com/traversable/schema/tree/main/packages/zod-test#zxtestfuzz)
- [`zxTest.seedToSchema`](https://github.com/traversable/schema/tree/main/packages/zod-test#zxtestseedtoschema)
- [`zxTest.seedToValidData`](https://github.com/traversable/schema/tree/main/packages/zod-test#zxtestseedtovaliddata)
- [`zxTest.seedToInvalidData`](https://github.com/traversable/schema/tree/main/packages/zod-test#zxtestseedtoinvaliddata)
- [`zxTest.seedToValidDataGenerator`](https://github.com/traversable/schema/tree/main/packages/zod-test#zxtestseedtovaliddatagenerator)
- [`zxTest.seedToInvalidDataGenerator`](https://github.com/traversable/schema/tree/main/packages/zod-test#zxtestseedtoinvaliddatagenerator)
- [`zxTest.SeedGenerator`](https://github.com/traversable/schema/tree/main/packages/zod-test#zxtestseedgenerator)
- [`zxTest.SeedValidDataGenerator`](https://github.com/traversable/schema/tree/main/packages/zod-test#zxtestseedvaliddatagenerator)
- [`zxTest.SeedInvalidDataGenerator`](https://github.com/traversable/schema/tree/main/packages/zod-test#zxtestseedinvaliddatagenerator)


### `zxTest.fuzz`

Convert a Zod schema into a [fast-check](https://github.com/dubzzz/fast-check) arbitrary.

Configure how fuzzed values will be generated via the 2nd argument (`options`).

Override individual arbitraries via the 3rd argument (`overrides`).

> [!NOTE]
>
> `zxTest.fuzz` is the __only__ schema-to-generator function that has itself
> been fuzz tested to ensure that no matter what schema you give it, the data-generator it
> returns will always produce valid data. 
>
> This excludes schemas that make it impossible to generate valid data, for example:
> 
> - `z.never` 
> - `z.nonoptional(z.undefined())`
> - `z.enum([])`
> - `z.union([])`
> - `z.intersection(z.number(), z.string())`

#### Example

```typescript
import * as vi from 'vitest'
import * as fc from 'fast-check'
import { fuzz } from '@traversable/zod-test'

const Schema = z.record(
  z.string(), 
  z.union(
    z.number(),
    z.string(),
  )
)

const generator = fuzz(
  Schema, 
  { record: { minKeys: 1 }, number: { noDefaultInfinity: true } },
  { string: () => fc.stringMatching(/[\S\s]+[\S]+/) },
)

vi.test('fuzz test example', () => {
  fc.assert(
    fc.property(generator, (data) => {
      vi.assert.doesNotThrow(() => Schema.parse(data))
    }),
    { numRuns: 1_000 }
  )
})
```

#### See also
- the [fast-check docs](https://fast-check.dev)


### `zxTest.seedToSchema`

Use `zxTest.seedToSchema` to convert a seed generated by `zxTest.SeedGenerator` into a
zod schema that satisfies the configuration options you specified.

#### Example

```typescript
import { zxTest } from '@traversable/zod-test'
import * as fc from 'fast-check'

const builder = zxTest.SeedGenerator()['*']
const [mySeed] = fc.sample(builder.object, 1)

const mySchema = zxTest.seedToSchema(mySeed)
//    ^? const mySchema: z.ZodType
```


### `zxTest.seedToValidData`

Use `zxTest.seedToValidData` to convert a seed generated by `zxTest.SeedGenerator` into
data that satisfies the schema that the seed represents.

#### Example

```typescript
import { zxTest } from '@traversable/zod-test'
import * as fc from 'fast-check'

const builder = zxTest.SeedGenerator()['*']
const [mySeed] = fc.sample(builder.object, 1)

const mySchema = zxTest.seedToSchema(mySeed)
//    ^? const mySchema: z.ZodType

const validData = zxTest.seedToValidData(mySeed)

mySchema.parse(validData) // will never throw
```


### `zxTest.seedToInvalidData`

Use `zxTest.seedToInvalidData` to convert a seed generated by `zxTest.SeedGenerator` into
data that does **not** satisfy the schema that the seed represents.

#### Example

```typescript
import { zxTest } from '@traversable/zod-test'
import * as fc from 'fast-check'

const builder = zxTest.SeedGenerator()['*']
const [mySeed] = fc.sample(builder.object, 1)

const mySchema = zxTest.seedToSchema(mySeed)
//    ^? const mySchema: z.ZodType

const invalidData = zxTest.seedToValidData(mySeed)

mySchema.parse(invalidData) // should always throw
```


### `zxTest.seedToValidDataGenerator`

Like [`zxTest.seedToValidData`](https://github.com/traversable/schema/tree/main/packages/zod-test#zxtestseedtovaliddata), except `zxTest.seedToValidDataGenerator` accepts a seed and returns a valid data arbitrary (which can then be used to produce valid data).

#### Example

```typescript
import { zxTest } from '@traversable/zod-test'
import * as fc from 'fast-check'

const builder = zxTest.SeedGenerator()['*']
const [mySeed] = fc.sample(builder.object, 1)

const mySchema = zxTest.seedToSchema(mySeed)
//    ^? const mySchema: z.ZodType

const validDataGenerator = zxTest.seedToValidDataGenerator(mySeed)
const [validData] = fc.sample(validDataGenerator, 1)

mySchema.parse(validData) // will never throw
```


### `zxTest.seedToInvalidDataGenerator`

Like [`zxTest.seedToInvalidData`](https://github.com/traversable/schema/tree/main/packages/zod-test#zxtestseedtoinvaliddata), except `zxTest.seedToValidDataGenerator` accepts a seed and returns an invalid data arbitrary (which can then be used to produce invalid data).

#### Example

```typescript
import type * as z from 'zod'
import * as fc from 'fast-check'
import { zxTest } from '@traversable/zod-test'

const builder = zxTest.SeedGenerator()['*']
const [mySeed] = fc.sample(builder.object, 1)

const mySchema = zxTest.seedToSchema(mySeed)
//    ^? const mySchema: z.ZodType

const invalidDataGenerator = zxTest.seedToInvalidDataGenerator(mySeed)
const [invalidData] = fc.sample(invalidDataGenerator, 1)

mySchema.parse(invalidData) // will always throw
```


### `zxTest.SeedGenerator`

> [!NOTE]
>
> `zxTest.SeedGenerator` is fairly low-level. All of the other exports of this library have been implemented in terms of `zxTest.SeedGenerator`.

Generates a configurable, pseudo-random "seed builder".

- Use [`zxTest.seedToSchema`](https://github.com/traversable/schema/tree/main/packages/zod-test#zxtestseedtoschema) to convert a seed into a zod schema
- Use [`zxTest.seedToValidData`](https://github.com/traversable/schema/tree/main/packages/zod-test#zxtestseedtovaliddata) to convert a seed into valid data
- Use [`zxTest.seedToInvalidData`](https://github.com/traversable/schema/tree/main/packages/zod-test#zxtestseedtoinvaliddata) to convert a seed into invalid data

#### Example

```typescript
import { zxTest } from '@traversable/zod-test'
import * as fc from 'fast-check'

const builder = zxTest.SeedGenerator({
  include: ["boolean", "string", "object"],
  // 𐙘 use `include` to only include certain schema types
  exclude: ["boolean", "any"],
  // 𐙘 use `exclude` to exclude certain schema types altogether (overrides `include`)
  object: { maxKeys: 5 },
  // 𐙘 specific arbitraries are configurable by name
})

// included schemas are present as properties on your generator...
builder.string
builder.object

// ...excluded schemas are not present...
builder.boolean // 🚫 TypeError

// ...a special wildcard `"*"` property (pronounced "surprise me") is always present:
builder["*"]

/**
 * `fast-check` will generate a seed, which is a data structure containing
 * integers that represent a kind of AST.
 *
 * To use a seed, you need to pass it to an interpreter like `zxTest.seedToSchema`,
 * `zxTest.seedToValidData` or `zxTest.seedToInvalidData`:
 */

const [mySeed] = fc.sample(builder.object, 1)

const mySchema = zxTest.seedToSchema(mySeed)
//    ^? const mySchema: z.ZodType

const validData = zxTest.seedToValidData(mySeed)
//    ^? since the `mySeed` was also used to generate `mySchema`,
//       parsing `validData` should always succeed

const invalidData = zxTest.seedToInvalidData(mySeed)
//    ^? since the `mySeed` was also used to generate `mySchema`,
//       parsing `invalidData` should always fail
```


### `zxTest.SeedValidDataGenerator`

Like [`zxTest.SeedGenerator`](https://github.com/traversable/schema/tree/main/packages/zod-test#zxtestseedgenerator), except `zxTest.SeedValidDataGenerator` comes pre-configured to exclude schemas that make it impossible to reliably generate valid data.

> [!NOTE]
>
> `zxTest.SeedValidDataGenerator` does not accept any options. If you need more fine-grained control of the schemas being generated, use [`zxTest.SeedGenerator`](https://github.com/traversable/schema/tree/main/packages/zod-test#zxtestseedgenerator).



### `zxTest.SeedInvalidDataGenerator`

Like [`zxTest.SeedGenerator`](https://github.com/traversable/schema/tree/main/packages/zod-test#zxtestseedgenerator), except `zxTest.SeedValidDataGenerator` comes pre-configured to exclude schemas that make it impossible to reliably generate invalid data.

> [!NOTE]
>
> `zxTest.SeedInvalidDataGenerator` does not accept any options. If you need more fine-grained control of the schemas being generated, use [`zxTest.SeedGenerator`](https://github.com/traversable/schema/tree/main/packages/zod-test#zxtestseedgenerator).


