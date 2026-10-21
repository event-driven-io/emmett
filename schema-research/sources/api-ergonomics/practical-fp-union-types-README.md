# Union Types

[![NPM version badge](https://badgen.net/npm/v/@practical-fp/union-types)](https://npmjs.org/package/@practical-fp/union-types)
[![Bundle size badge](https://badgen.net/bundlephobia/minzip/@practical-fp/union-types)](https://bundlephobia.com/result?p=@practical-fp/union-types)
[![Dependency count badge](https://badgen.net/bundlephobia/dependency-count/@practical-fp/union-types)](https://bundlephobia.com/result?p=@practical-fp/union-types)
[![Tree shaking support badge](https://badgen.net/bundlephobia/tree-shaking/@practical-fp/union-types)](https://bundlephobia.com/result?p=@practical-fp/union-types)
![License badge](https://img.shields.io/npm/l/@practical-fp/union-types)

A Typescript library for creating discriminating union types. Requires Typescript 3.5 or higher.

[Typescript Handbook on discriminating union types](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions)

## Example

```typescript
import { impl, matchExhaustive, Variant } from "@practical-fp/union-types"

type Shape =
    | Variant<"Circle", { radius: number }>
    | Variant<"Square", { sideLength: number }>

const { Circle, Square } = impl<Shape>()

function getArea(shape: Shape) {
    return matchExhaustive(shape, {
        Circle: ({ radius }) => Math.PI * radius ** 2,
        Square: ({ sideLength }) => sideLength ** 2,
    })
}

const circle = Circle({ radius: 5 })
const area = getArea(circle)
```

## Installation

```bash
$ npm install @practical-fp/union-types
```

## Usage

### Defining a discriminating union type

```typescript
import { Variant } from "@practical-fp/union-types"

type Shape =
    | Variant<"Circle", { radius: number }>
    | Variant<"Square", { sideLength: number }>
```

This is equivalent to the following type:

```typescript
type Shape =
    | { tag: "Circle", value: { radius: number } }
    | { tag: "Square", value: { sideLength: number } }
```

### Creating an implementation

```typescript
import { impl } from "@practical-fp/union-types"

const { Circle, Square } = impl<Shape>()
```

`impl<>()` can only be used if your environment has full support
for [Proxies](https://caniuse.com/?search=Proxy). Alternatively, use the `constructor<>()` function.

```typescript
import { constructor } from "@practical-fp/union-types"

const Circle = constructor<Shape, "Circle">("Circle")
const Square = constructor<Shape, "Square">("Square")
```

`Circle` and `Square` can then be used to wrap values as a `Shape`.

```typescript
const circle: Shape = Circle({ radius: 5 })
const square: Shape = Square({ sideLength: 3 })
```

`Circle.is` and `Square.is` can be used to check if a shape is a circle or a square.
They also act as a type guard.

```typescript
const shapes: Shape[] = [circle, square]
const sideLengths = shapes.filter(Square.is).map(square => square.value.sideLength)
```

You can also create custom implementations using the `tag()` and `predicate()` helper functions.

```typescript
import { predicate, tag } from "@practical-fp/union-types"

const Circle = (radius: number) => tag("Circle", { radius })
const isCircle = predicate("Circle")

const Square = (sideLength: number) => tag("Square", { sideLength })
const isSquare = predicate("Square")
```

### Matching against a union

```typescript
import { matchExhaustive } from "@practical-fp/union-types"

function getArea(shape: Shape) {
    return matchExhaustive(shape, {
        Circle: ({ radius }) => Math.PI * radius ** 2,
        Square: ({ sideLength }) => sideLength ** 2,
    })
}
```

`matchExhaustive()` is exhaustive, i.e., you need to match against every variant of the union.
Cases can be omitted when using a wildcard case with `matchWildcard()`.

```typescript
import { matchWildcard, WILDCARD } from "@practical-fp/union-types"

function getDiameter(shape: Shape) {
    return matchWildcard(shape, {
        Circle: ({ radius }) => radius * 2,
        [WILDCARD]: () => undefined,
    })
}
```

`switch`-statements can also be used to match against a union.

```typescript
import { assertNever } from "@practical-fp/union-types"

function getArea(shape: Shape) {
    switch (shape.tag) {
        case "Circle":
            return Math.PI * shape.value.radius ** 2
        case "Square":
            return shape.value.sideLength ** 2
        default:
            // exhaustiveness check
            // compile-time error if a case is missing
            assertNever(shape)  
    }
}
```

### Generics
`impl<>()` and `constructor<>()` also support generic union types.

In case the variant type uses unconstrained generics, 
`unknown` needs to be passed as its type arguments.

```typescript
import { impl, Variant } from "@practical-fp/union-types"

type Result<T, E> =
    | Variant<"Ok", T>
    | Variant<"Err", E>

const { Ok, Err } = impl<Result<unknown, unknown>>()
```

In case the variant type uses constrained generics,
the constraint type needs to be passed as its type arguments.

```typescript
import { impl, Variant } from "@practical-fp/union-types"

type Result<T extends object, E> =
    | Variant<"Ok", T>
    | Variant<"Err", E>

const { Ok, Err } = impl<Result<object, unknown>>()
```

### `strictImpl<>()` and `strictConstructor<>()`
`impl<>()` and `constructor<>()` generate generic constructor functions.
This may not always be desirable.

```typescript
import { impl } from "@practical-fp/union-types"

const { Circle } = impl<Shape>()
const circle = Circle({
    radius: 5,
    color: "red",
})
```

Since `Circle` is generic, it's perfectly fine to pass extra properties other than `radius`.

To prevent that, we can use `strictImpl<>()` or `strictConstructor<>()` to create a strict 
implementation which is not generic.

```typescript
import { strictImpl } from "@practical-fp/union-types"

const { Circle } = strictImpl<Shape>()
const circle = Circle({
    radius: 5,
    color: "red",  // compile error
})
```