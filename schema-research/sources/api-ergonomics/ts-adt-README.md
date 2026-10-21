# ADTs for typescript

### Enables succinct ADT declaration.

In typescript, [Algebraic Data Types](https://www.typescriptlang.org/docs/handbook/unions-and-intersections.html#discriminating-unions) are encoded using union types with a discriminator field.

Example:

```ts
import { ADT } from "ts-adt";

type Option<A> = ADT<{
  some: { value: A };
  none: {};
}>;
```

This translates to:

```ts
type Option<A> = { _type: "some"; value: A } | { _type: "none" };
```

Here, `Option<A>` represents a value that can be one of two types; either it's an object with a `_type` attribute `"some"` _and_ a value `A`, or it's an object with `_type` attribute `"none"`. This type is quite useful, especially when used with Typescript's type narrowing feature:

```ts
declare const userImage: Option<string>;

function getUserImage(): string {
  if (userImage._type === "some") {
    return userImage.value; // value is accessible here, since _type is 'some'
  } else {
    return "http://example.com/defaultImage";
  }
}
```

## Pattern matching

Pattern matching is a common usecase when dealing with ADTs. You'll often find yourself in a position where you need to default to certain values depending on what the underlying value is. For this reason, we've included a `match` and `matchI` function:

```ts
import { ADT, match, matchI } from "ts-adt";

declare const userImage: Option<string>;

const img = matchI(userImage)({
  some: ({ value }) => value,
  none: () => "http://example.com/defaultImage",
});

const img = pipe(
  userImage,
  match({
    some: ({ value }) => value,
    none: () => "http://example.com/defaultImage",
  })
);
```

Both functions work the same way, but their arguments are ordered differently for better inference in different cases.

### Partial Matching

You can also use _partial matching_ if you don't need to match against all possible cases.

Consider if you have an ADT of the shape:

```ts
type Xor<A, B> = ADT<{
  nothing: {};
  left: { value: A };
  right: { value: A };
}>;

declare const myXor: Xor<number>;
```

You can supply an "otherwise" function which gets invoked if the value doesn't match any of the supplied matchers. The otherwise function will be passed a value whose type is the types which _weren't_ matched.

```ts
declare const myXor: Xor<number>;

matchPI(promise)({ nothing: () => 0 }, (rest) => {
  // rest inferred as {_type: 'left', value: number } | {_type: 'right', value: number }
  return rest.value;
});
```

## Custom Discriminant field

By default, `ADT` and the `match` functions use the `_type` field as the discriminant. You can build an ADT using a different discriminant field, along with matching `match` functions by using the utilities in `ts-adt/MakeMatch`:

```ts
import { MakeADT, makeMatchers } from "ts-adt/MakeADT";

type Option<A> = MakeADT<
  "typ",
  {
    some: { value: A };
    none: {};
  }
>; // { typ: 'some', value: A } | { typ: 'none' }

const [match, matchP, matchI, matchPI] = makeMatchers("typ");
```

You can also use `makeMatchers` to build matchers for ADTs in other libraries:

```ts
import * as O from "fp-ts/Option";

const [match, matchP, matchI, matchPI] = makeMatchers("_tag");

pipe(
  O.fromNullable("value"),
  match({
    None: () => 0,
    Some: (v) => v.value,
  })
);
```
