# zod-schema-faker

> Generate mock data from [zod](https://github.com/colinhacks/zod) schemas. Powered by
> [@faker-js/faker](https://github.com/faker-js/faker) and [randexp.js](https://github.com/fent/randexp.js).

[![CI](https://github.com/soc221b/zod-schema-faker/actions/workflows/ci.yml/badge.svg)](https://github.com/soc221b/zod-schema-faker/actions/workflows/ci.yml)
[![NPM](https://img.shields.io/npm/v/zod-schema-faker.svg?label=NPM&color=brightgreen)](https://www.npmjs.com/package/zod-schema-faker)

Features

- Support zod v3, v4 and mini
- Support almost all zod types
- Support for custom zod types
- Extensive tests

## Installation

```sh
npm install --save-dev zod-schema-faker @faker-js/faker randexp
```

## Usage

### Setup

v3:

```ts
import { install } from 'zod-schema-faker' // alias: 'zod-schema-faker/v3'

install()
```

v4 or mini:

```ts
import { setFaker } from 'zod-schema-faker/v4'
import { faker } from '@faker-js/faker'

setFaker(faker)
```

### Fake Built-in types

```ts
import { fake } from 'zod-schema-faker'

const Player = z.object({
  username: z.string(),
  xp: z.number(),
})

const data = fake(Player)
console.log(data) // { username: "billie", xp: 100 }
```

### Fake Custom types

v3:

```ts
import { installCustom, fake, getFaker, ZodTypeFaker } from 'zod-schema-faker'

// define a custom zod schema
const pxSchema = z.custom<`${number}px`>(val => {
  return typeof val === 'string' ? /^\d+px$/.test(val) : false
})

// define a custom faker
class ZodPxFaker extends ZodTypeFaker<typeof pxSchema> {
  fake(): `${number}px` {
    return `${getFaker().number.int({ min: 0 })}px`
  }
}

// call installCustom() to register custom faker
installCustom(pxSchema, ZodPxFaker)

// generate fake data based on schema
const data = fake(pxSchema) // '100px'
```

v4 or mini:

```ts
import { custom, fake, Fake, getFaker } from 'zod-schema-faker/v4'

// define a custom zod schema
const pxSchema = z.custom<`${number}px`>(val => {
  return typeof val === 'string' ? /^\d+px$/.test(val) : false
})

// define a custom faker
const fakePxSchema: Fake<typeof pxSchema> = () => {
  return (getFaker().number.int({ min: 1, max: 100 }) + 'px') as `${number}px`
}

// call custom() to register custom faker
custom(pxSchema, fakePxSchema)

// generate fake data based on schema
const data = fake(pxSchema) // '100px'
```

## API

### v3

#### Core APIs

- `function install(): void`: Install fakers for built-in types, must be called before using `fake`.
- `function fake<T extends z.ZodType>(schema: T): z.infer<T>`: Generate fake data based on schema.
- `class ZodSchemaFakerError`

#### Random Utility APIs

- `function seed(value?: number): void`: Sets the seed to use.
- `function setFaker(faker: Faker): void`: Use given faker instance instead of the default one.
- `function getFaker(): Faker`: Get the faker instance. Defaults to `fakerEN`.
- `function randexp(pattern: string | RegExp, flags?: string): string`: Create random strings that match a given regular
  expression.

#### Customization APIs - see [example](./tests/zod-custom-faker.test.ts) for details

- `class ZodTypeFaker`: Base class for fakers.
- `function installCustom<T extends z.ZodTypeAny>(schema: T, faker: typeof ZodTypeFakerConcrete<T>): void`: Install
  fakers for custom schemas, must be called before using `fake`.

### v4

#### Core APIs

- `function fake<T extends core.$ZodType>(schema: T): core.infer<T>`: Generate fake data based on schema.

#### Random Utility APIs

- `function seed(value?: number): void`: Sets the seed or generates a new one. This method is intended to allow for
  consistent values in tests, so you might want to use hardcoded values as the seed.
- `function setFaker(faker: Faker): void`: Set the faker instance to use.
- `function getFaker(): Faker`: Get the faker instance.
- `function randexp(pattern: string | RegExp, flags?: string): string`: Create random strings that match a given regular
  expression.

#### Customization APIs

- `function custom<T extends core.$ZodType>(schema: T, fake: Fake<T>): void`: Generate fake data based on schema.
- `type Fake<T extends core.$ZodType> = (schema: T, context: Context, rootFake: RootFake) => core.infer<T>`: Custom fake
  function.

## Unsupported

### v3

- .refine ❌
- .superRefine ❌

### v4

- .codec 🚧
- .intersection 🚧
- .preprocess 🚧
- .refine ❌
- .stringbool custom 🚧
- .stringFormat custom 🚧
- .superRefine ❌

## About

Distributed under the MIT license. See LICENSE for more information.

