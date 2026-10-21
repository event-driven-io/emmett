# #14: Suggestion: symbols vs string keys & bidirectional encoding
Source: https://github.com/standard-schema/standard-schema/issues/14 (state: open, created 2024-10-23T20:46:49Z, by tim-smart)

First off, this is a nice idea and I'm interested to see where it goes :)

We have been looking at whether we could support this standard with "effect/Schema", but there are some lacking features.

- Polluting the interface with string keys isn't viable, as we then have to make sure users can't use those names when creating class based schemas
- No support for bidirectional schemas, which is a foundational feature of "effect/Schema"

Here is a draft proposal:

```ts
export const v1 = Symbol.for("standard-schema/v1")

export const v1Encodable = Symbol.for("standard-schema/v1/Encodable")

/**
 * The Standard Schema v1 interface.
 */
export interface StandardSchema<
  in out Output,
  in out Input = Output,
  out Error = unknown, // allow a library to define the error shape
> {
  readonly [v1]: {
    /**
     * The vendor name of the schema library.
     */
    readonly vendor: string

    /**
     * Validates unknown input values.
     */
    readonly decode: (input: Input) => Result<Output, Error>
  }
}

/**
 * The Standard Schema v1 interface.
 */
export interface Encodable<
  in out Output,
  in out Input = Output,
  out Error = unknown,
> extends StandardSchema<Output, Input, Error> {
  readonly [v1Encodable]: {
    /**
     * Encodes the output value to the input value.
     */
    readonly encode: (input: Output) => Result<Input, Error>
  }
}

export type Result<A, E = unknown> = Result.Ok<A> | Result.Error<E>

export declare namespace Result {
  export interface Ok<A> {
    readonly ok: true
    readonly value: A
  }

  export interface Error<E = unknown> {
    readonly ok: false
    readonly error: E
  }
}
```

The alternative for us is to export an adapter api, instead of implementing the interface directly. But in either case, the "Encodable" interface would be a welcome addition.

## Comment by datner at 2024-10-23T22:11:53Z

I strongly support this approach; in general, having more tightly typed interactions is invaluable.

A common example would be react-hook-form, which supports the current idea of `Schema<A>.` The issue is that it accounts only for the output, which means that all the types for the input are jumbled, ruining the developer experience. If a lib does not know the input, it can either use `A` and `A` or just declare `unknown` or `never` (or even some unique type from the spec)

## Comment by tim-smart at 2024-10-24T21:49:03Z

Also a potential design that supports async too:

```ts
export const v1 = Symbol.for("standard-schema/v1")
export type v1 = typeof v1

export interface Schema<
  in out Output,
  in out Input = Output,
  out Error = unknown // allow a library to define the error shape
> {
  readonly [v1]: {
    readonly vendor: string
    readonly decode: (input: Input) => Result<Output, Error>

    // helpers for extracting the types
    readonly Output: Output
    readonly Input: Input
    readonly Error: Error
  }
}

export declare namespace StandardSchema {
  export interface Any {
    readonly [v1]: any
  }
}

// extraction helpers
export type Input<S extends StandardSchema.Any> = S[v1]["Input"]
export type Output<S extends StandardSchema.Any> = S[v1]["Output"]
export type Error<S extends StandardSchema.Any> = S[v1]["Error"]

// async
export interface Async<
  in out Output,
  in out Input = Output,
  out Error = unknown
> extends Schema<Output, Input, Error> {
  readonly [v1]: Schema<Output, Input, Error>[v1] & {
    readonly decodeAsync: (input: Input) => Promise<Result<Output, Error>>
  }
}

// bidirectional
export interface Encodable<
  in out Output,
  in out Input = Output,
  out Error = unknown
> extends Schema<Output, Input, Error> {
  readonly [v1]: Schema<Output, Input, Error>[v1] & {
    readonly encode: (input: Output) => Result<Input, Error>
  }
}

// bidirectional async
export interface EncodableAsync<
  in out Output,
  in out Input = Output,
  out Error = unknown
> extends Async<Output, Input, Error>, Encodable<Output, Input, Error> {
  readonly [v1]:
    & Encodable<Output, Input, Error>[v1]
    & Async<Output, Input, Error>[v1]
    & {
      readonly encodeAsync: (input: Output) => Promise<Result<Input, Error>>
    }
}

// result union
export type Result<A, E = unknown> = Result.Ok<A> | Result.Error<E>

export declare namespace Result {
  export interface Ok<A> {
    readonly ok: true
    readonly value: A
  }

  export interface Error<E = unknown> {
    readonly ok: false
    readonly error: E
  }
}

// apis for consumers
export const decode =
  <Output, Input, Error>(schema: Schema<Output, Input, Error>) =>
  (u: Input): Result<Output, Error> => schema[v1].decode(u)

export const decodeAsync =
  <Output, Input, Error>(schema: Async<Output, Input, Error>) =>
  (u: Input): Promise<Result<Output, Error>> => schema[v1].decodeAsync(u)

export const decodeUnknown: <Output, Input, Error>(
  schema: Schema<Output, Input, Error>
) => (u: unknown) => Result<Output, Error> = decode as any

export const decodeAsyncUnknown: <Output, Input, Error>(
  schema: Async<Output, Input, Error>
) => (u: unknown) => Promise<Result<Output, Error>> = decodeAsync as any

export const encode =
  <Output, Input, Error>(schema: Encodable<Output, Input, Error>) =>
  (u: Output): Result<Input, Error> => schema[v1].encode(u)

export const encodeAsync =
  <Output, Input, Error>(schema: EncodableAsync<Output, Input, Error>) =>
  (u: Output): Promise<Result<Input, Error>> => schema[v1].encodeAsync(u)

export const encodeUnknown: <Output, Input, Error>(
  schema: Encodable<Output, Input, Error>
) => (u: unknown) => Result<Input, Error> = encode as any

export const encodeAsyncUnknown: <Output, Input, Error>(
  schema: EncodableAsync<Output, Input, Error>
) => (u: unknown) => Promise<Result<Input, Error>> = encodeAsync as any

// apis for library authors
export const define = <Output, Input, Error>(options: {
  readonly decode: (input: Input) => Result<Output, Error>
  readonly vendor: string
}): Schema<Output, Input, Error>[v1] => ({
  ...options,
  Output: undefined as Output,
  Input: undefined as Input,
  Error: undefined as Error
})

export const defineAsync: <Output, Input, Error>(options: {
  readonly decode: (input: Input) => Result<Output, Error>
  readonly decodeAsync: (input: Input) => Promise<Result<Output, Error>>
  readonly vendor: string
}) => Async<Output, Input, Error>[v1] = define as any

export const defineEncodable: <Output, Input, Error>(options: {
  readonly decode: (input: Input) => Result<Output, Error>
  readonly encode: (input: Output) => Result<Input, Error>
  readonly vendor: string
}) => Encodable<Output, Input, Error>[v1] = define as any

export const defineEncodableAsync: <Output, Input, Error>(options: {
  readonly decode: (input: Input) => Result<Output, Error>
  readonly decodeAsync: (input: Input) => Promise<Result<Output, Error>>
  readonly encode: (input: Output) => Result<Input, Error>
  readonly encodeAsync: (input: Output) => Promise<Result<Input, Error>>
  readonly vendor: string
}) => EncodableAsync<Output, Input, Error>[v1] = define as any
```

Usage:

```ts
// usage for consumers
import * as StandardSchema from "./v1.js"

declare const numberFromString: StandardSchema.Schema<number, string, Error>

export const result: StandardSchema.Result<
  number,
  Error
> = StandardSchema.decode(numberFromString)("69420")

declare const numberFromStringBidirectional: StandardSchema.Encodable<
  number,
  string,
  Error
>
export const result2: StandardSchema.Result<
  number,
  Error
> = StandardSchema.decode(numberFromStringBidirectional)("69420")
export const encoded: StandardSchema.Result<
  string,
  Error
> = StandardSchema.encode(numberFromStringBidirectional)(69420)

// grab the types
export type TheOutput = StandardSchema.Output<
  typeof numberFromStringBidirectional
>
export type TheInput = StandardSchema.Input<
  typeof numberFromStringBidirectional
>
export type TheError = StandardSchema.Error<
  typeof numberFromStringBidirectional
>
```

```ts
// usage for library authors
import * as StandardSchema from "./v1.js"

export abstract class LibrarySchema<Output, Input>
  implements StandardSchema.Encodable<Output, Input, Error>
{
  abstract parse(input: Input): Output
  abstract serialize(output: Output): Input

  get [StandardSchema.v1]() {
    return StandardSchema.defineEncodable({
      vendor: "my-library",
      decode: (input: Input): StandardSchema.Result<Output, Error> => ({
        ok: true,
        value: this.parse(input)
      }),
      encode: (output: Output): StandardSchema.Result<Input, Error> => ({
        ok: true,
        value: this.serialize(output)
      })
    })
  }
}
```

## Comment by fabian-hiller at 2024-11-05T15:17:13Z

Is there any update on this? I know you have exchanged ideas with Colin. From my perspective, according to [our readme](https://github.com/standard-schema/standard-schema?tab=readme-ov-file#use-cases), encode/decode is currently outside the scope of this specification. But that does not mean that we should not consider it in the long term. The use case for decode/encode is a bit different. Also, a standard spec only makes sense if there are multiple schema libraries containing this functionality. One idea is not to add it to the interface of the current Standard Schema spec, but to provide it as an additional interface.

## Comment by datner at 2024-11-12T00:03:15Z

What kind of update? I think that the spec provided by the previous comment is quite extensive and complete as far as suggestions go 🤔 
What would be the next steps if a leveled/tiered spec is the direction?

## Comment by joshmossas-old at 2025-01-10T06:03:22Z

I would like to add that polluting the interface with string keys causes problems for libraries who's purpose is to be a "schema builder" for some other standard. This is the case for both [Typebox](https://github.com/sinclairzx81/typebox) (A type builder for JSON schema) and my own library [Arri RPC](https://github.com/modiimedia/arri) (Specificially the [schema builder](https://github.com/modiimedia/arri/blob/master/languages/ts/ts-schema/README.md))

Both Typebox and Arri use symbols so that when the schemas get passed to JSON stringify the additional properties used at runtime will not be included in the final output otherwise we risk producing non-spec compliant schemas

The usage of the `~standard` string key means that in order for us to support standard-schema we either need to implement a custom `toJSON()` function that omits the `~standard` key for all of our schemas, or we need to create an adapter layer which is not ideal.

### Example 1: Typebox

This Typebox schema

```ts
import { Type } from "@sinclair/typebox";

const User = Type.Object({
  id: Type.String(),
  name: Type.String(),
})

JSON.stringify(User)
```

Outputs the following:

```json
{
  "type": "object",
  "properties": {
    "id": { "type": "string" },
    "name": { "type": "string" }
  },
  "required": [ "id", "name" ],
}
```

### Example 2: Arri

This Arri schema

```ts
import { a } from "@arrirpc/schema";

const User = a.object({
  id: a.string(),
  name: a.string(),
})

JSON.stringify(User);
```

Outputs the following:

```json
{
  "properties": {
    "id": { "type": "string", "metadata": {} },
    "name": { "type": "string", "metadata": {} }
  },
  "metadata": {}
}
```

## Autocomplete Concerns Aren't Actually An Issue

_Let me preface this by saying my experience concerning this specific issue is based around the context that I use VSCode. However, I believe the behaviors should be the same since ultimately most editors will be using the same LSP._

From the Readme, it seems the primary reason for not using symbols is because you want to ensure that the standard-schema key remains at the bottom of the autocomplete list. However, Symbols are actually the perfect use case for this. It's true that defining a symbol will result in it showing up in autocomplete. However that is not the case if the symbol was declared by an external library. When that happens the symbols is actually completely omitted from autocomplete. The only way get them to reappear is to explicitly import them from the origin library.

Here is the behavior when inside of the Arri schema library. The symbol `SCHEMA_METADATA` autocompletes because it was defined inside of that library.

![image](https://github.com/user-attachments/assets/f39c9acb-845c-4527-9a1e-aaf189034045)

And here is the behavior of when I use the Arri schema library in an application. Notice how the symbol doesn't appear in autocomplete at all.

![image](https://github.com/user-attachments/assets/cff442ea-f0a9-4045-96be-864b6d823c69)

Once I manually import `SCHEMA_METADATA` then the symbol reappears in autocomplete.

This has the effect that library maintainers will have to deal with the `~standard` symbol polluting their autocomplete but consumers of the library won't unless they explicitly import the symbols. I think this is a perfectly fine and acceptable trade-off.

I've also prepared an example repo where you can test these behaviors yourself:
https://github.com/joshmossas/symbol-autocomplete-example

## Comment by joshmossas-old at 2025-01-10T07:07:03Z

Concerning the initial bidirectional encoding proposal, I may be alone on this but think we probably need to differentiate between "decoding" and "validation". A serialized version of a type doesn't always match 1-to-1 with the runtime version of a type. I believe in most cases when someone wants to "validate" an unknown input they are checking something that already exists at runtime, which in my view is something distinct from "decoding".

A very simple example is dates. Say you have a `date()` schema that is used to validate whether an input is a Javascript Date. `date().decode()` would expect a date-time string while `date().validate()` would expect an instance of the Date class. 

So in my head the interfaces would look something like this: 

```ts
// pseudo-code

export interface StandardSchema<T> {
  readonly [v1]: {
    validate: (input: unknown) => input is T
  }
}

export interface Decodable<Input, Output> extends StandardSchema {
  readonly [v1Decodable]: {
    readonly decode: (input: Input) => Result<Output, Error>
  }
}

export interface Encodable<Input, Output> extends StandardSchema {
  readonly [v1Encodable]: {
    readonly encode: (input: Output) => Result<Input, Error>;
  }
}
```

It would be cool if standard-schema did support such a feature as it opens up more opportunities for type-safety across the wire. That said I do understand that bi-directional encoding isn't a common feature among JS validation libraries. We use bi-directional encoding with Arri and I guess effect/schema supports it (which I learned via this thread), but other than that I don't know any (maybe ajv when using JTD instead of JSON schema?)

## Comment by ssalbdivad at 2025-01-10T19:27:20Z

Symbols are a non-starter for me as they'd require a direct dependency and would break if multiple versions of standard-schema are installed or resolved.

## Comment by joshmossas-old at 2025-01-10T23:07:44Z

> as they'd require a direct dependency and would break if multiple versions of standard-schema are installed or resolved.

Hi @ssalbdivad that's actually not true. So long as standard-schema creates their symbol using [`Symbol.for`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Symbol/for) you would be able to re-declare the symbol in your library without introducing another dependency. This is because `Symbol.for` will always return the same symbol so long as the key is the same. This also prevents the scenario you described of having breakage due to multiple versions of standard-schema being installed

Here I am using manually re-declaring symbols to access hidden properties in Typebox and Arri. Both of the console.logs here log out the hidden property values.

![image](https://github.com/user-attachments/assets/74561fec-b5dc-447c-aef7-58d11923941c)

Symbols have the added benefit that there will be basically no reasonable scenario where we get conflicting keys. A dev might potentially want to use the `~standard` key, but it's not likely someone will use `const standardV1 = Symbol.for("standard-schema/v1")` specifically. We could also make it more unique if we wanted.

## Comment by ssalbdivad at 2025-01-11T00:12:46Z

@joshmossas Unfortunately, TypeScript does not have type-level support for `Symbol.for`. Even if this worked at runtime, those same incompatibilities would result in type errors (I recently migrated all `symbols` in arktype to unsuggested strings for this reason).

Can't you just define the property as non-enumerable?

```ts
const o = { json: true }

Object.defineProperty(o, "~standard", { enumerable: false, value: {} })

// { "json": true }
const serialized = JSON.stringify(o)
```

## Comment by joshmossas-old at 2025-01-11T01:35:41Z

@ssalbdivad Ohhh okay I understand the issue. You are correct. Essentially, symbols don't cause problems when implementing the standard-schema interface (which what I was focusing on). They cause issues when passing the resulting schema into a standard-schema compatible library. This is because TS will not able to accurately infer that the input conforms the standard-schema interface (even though it actually does have the required properties).

> Can't you just define the property as non-enumerable?

Wow actually this is the first I've heard of this feature. That solves my main issue so thanks. :raised_hands: 

I've shifted my stance. Using symbols is prolly a hard "no". I'm still a big fan of bi-directional encoding.

## Comment by datner at 2025-01-13T00:46:52Z

@ssalbdivad What you're saying is correct, but I believe it's irrelevant unless I misunderstand something. 🤔 
You don't need a type for any `Symbol.for`. Libraries are not expected to literally invoke `Symbol.for` with the agreed-upon string key. That would be silly for many reasons, even beyond typescript.
The more realistic consumption is with an imported symbol, right?
```ts
import { v1 } from 'standard-schema/implementation' //or smthn
```
Typescript _can_ track the identities of unique symbols just fine. When needing to support symbols given from outside and make them consistent in arktype, I can imagine how complex it can get, but if the symbols have a stable known shared type, why would it be problematic?

![CleanShot 2025-01-13 at 02 20 45](https://github.com/user-attachments/assets/36cab19d-6ed8-4f6f-99b7-1ca9ff8e1842)

So @joshmossas , you too, feel free to correct me if I'm wrong. This means that Typescript will accurately infer that the input conforms to the standard-schema interface. I guess that the caveat is that libs would have to declare a peer on standard-schema instead of just implementing the interface ad-hoc and letting the structural typing give it a pass.

The biggest issue with the string-based approach is not enumeration and not autocomplete, it's simple interface pollution... In the future we found we screwed up and the interface for `~standard` is not good enough, the prime real estate of that name is now taken. Ah, so we bump the `~standard.version` from 1 to 2, right? But that means that we're no longer backwards compatible, we can't support version 1 _and_ version 2, unless we implement all sorts of snazzy hacks and workarounds. If symbols were used there wouldn't even be mental effort required to delegate towards that issue

## Comment by joshmossas-old at 2025-01-13T21:27:44Z

@datner Let me start by saying I agree with your concerns. While enumeration was my primary issue I do agree that polluting the interface with `~standard` is not good. I also think that the interface itself should make more room for potential backwards compatibility.

That said, the reason I switched my stance so quickly concerning symbols is because I had already ran into the exact problem that @ssalbdivad described but didn't realize it. The example you describe works as expected until you get 2 or more degrees of separation from the source of the symbol.

Consider the following scenario that I ran into:

1. `typebox` declares symbols to fulfill the `TSchema` interface and `TType` interface
2. `@arrirpc/typebox-adapter` contains a helper function called `typeboxAdapter()` which accepts a `TSchema` and converts it to an Arri Schema. `TSchema` is imported from `typebox` and `typebox` is listed as a peer dependency.
3. `@arrirpc/server` expects to receive Arri schemas when defining parameters and responses for procedures.
4. Create an app using `@arrirpc/server` `typebox` and `@arrirpc/typbox-adapter`

In step 4 the `typeboxAdapter()` helper can no longer infer that Typebox schemas conform to the `TSchema` interface. So the bug only occurs when you are a couple degrees of separation from the symbol declaration.

Here I am declaring creating the adapter function. `TSchema` is imported directly from `@sinclair/typebox`

![image](https://github.com/user-attachments/assets/67446da7-c4c6-4daa-bb4a-f3a7be2250a4)

Here is the type inference working as expected in my tests

![image](https://github.com/user-attachments/assets/0dcf976b-3936-40b8-8c61-7aabf4daa583)

Here is the type inference failing when I actually try to use it in an application

![image](https://github.com/user-attachments/assets/cf84c616-70d6-46e3-87d8-fc23749bf762)

Examining the type error shows that Typescript believes that the `[Kind]` symbol in `Type.Object` does not match the `[Kind]` symbol expected by `typeboxAdapter()` even though it was imported from the Typebox library. 

![image](https://github.com/user-attachments/assets/f470859e-aa41-45c2-8895-12fb2b37470a)

These are the kind of type errors that standard-schema is likely to run into if it were to use symbols and it's unfortunately due to a issue with Typescript itself. This conversation actually motivated me to look further into issues with how TS handles symbols and I came across some other issues and discussions that seem relevant to what we are debating here:

- https://github.com/microsoft/TypeScript/issues/57165#issuecomment-1924688856
- https://github.com/microsoft/TypeScript/issues/52534#issuecomment-1424663656

This conversation also actually made me realize how to fix the type inference errors I was having and it was actually just to strip out the symbols from the interface. (Typebox uses them internally but they aren't needed for an adapter)

![image](https://github.com/user-attachments/assets/6cc826e0-5700-407f-85c5-43412f1226b2)
![image](https://github.com/user-attachments/assets/e70e19a5-798d-472f-a44e-0be2753d88da)

Obviously standard-schema couldn't do this because the symbol would needed to fulfill the interface


## Comment by joshmossas-old at 2025-01-13T21:49:45Z

GUYS I just had a crazy idea!!!

Firstly let me say that IMHO the biggest reason why symbols cannot be used is because it will cause type errors due to Typescript perceiving symbols to be mismatched. I am of the opinion that autocomplete concerns aren't an issue.

Symbols have huge advantages because:
1. They can be guaranteed to be unique
2. They do not pollute the interface with special string keys
3. Backwards compat is straightforward

If we remove the problem of type errors, symbols become strictly better IMHO. So to enable this what if, and hear me out... what if we _lied_ to the typescript compiler? Typescript doesn't need to know that the key is a symbol right?

```ts
function secretSymbol<T extends string>(key: T) {
  // lie and tell TS that this is "T" when it's really a symbol
  // prefixing the string with a space means it won't be suggested via autocomplete (thank you ArkType for this trick)
  return Symbol.for(key) as any as ` ${T}`;
}

export const v1 = secretSymbol("standard-schema/v1");
export const v2 = secretSymbol("standard-schema/v2");

export interface StandardSchema<Input = unknown, Output = Input> {
  readonly [v1]: {
    /**
     * The vendor name of the schema library.
     */
    readonly vendor: string;
    /**
     * Validates unknown input values.
     */
    readonly validate: (
      value: unknown
    ) => Result<Output> | Promise<Result<Output>>;
    /**
     * Inferred types associated with the schema.
     */
    readonly types?: Types<Input, Output> | undefined;
  };
  readonly [v2]: {
    // whatever shape v2 takes
  }
}
```

Consuming the schema

```ts
import { StandardSchema, v1 } from "@standard-schema/spec";

async function handleSchema(schema: StandardSchema) {
  const result = await schema[v1].validate("foo");
}
```

It so cursed but I think it literally fixes all the problems, and if TS ever fixes the inference issues surrounding `symbold.for()` we can remove the cast.

## Comment by datner at 2025-01-16T00:21:53Z

@joshmossas not only is it not cursed, I was going to suggest exactly that (the lying to TS part). We're in libland, not userland, it's totally fine and many times beneficial to fix the types how we need them to be. Types aren't real. Though I was going to suggest to explicitly type the symbols as their own type cyclically, I will admit I don't understand why it works, but thats how Effect-TS moves symbols around (which there are a TON of) and we've yet to hear about any issues like you describe:
```ts
// SpecV1.ts
import * as internal from './internal/specv1'

export const v1: unique symbol = internal.v1

export type v1 = typeof v1
```
```ts
// internal/specv1.ts
import type * as Spec from '../SpecV1'

export const v1: Spec.v1 = Symbol.for('...') as Spec.v1
```



## Comment by ssalbdivad at 2025-01-16T03:11:51Z

I don't see any semantic difference between `Symbol.for("~standard")` and `"~standard"` as a non-enumerable key, presuming `~standard` is a sufficiently obscure name (which is a separate discussion, but I believe it is).

What exactly are we getting in return for the extra complexity?

## Comment by datner at 2025-01-16T13:04:58Z

@ssalbdivad describe a backwards compatible imaginary v2 spec, with symbols its this:
```ts
interface V1 {
  [v1]: {..}
}

interface V2 {
  [v2]: {..}
}
```
In the current approach, I can't really see how to make
```ts
interface Schema {
  "~standard": {
    readonly version: 1
  }
}
```
extensible such that tomorrow an implementer, adapter, and users all can use either version 1, version 2, or both. To clarify, a situation such as:
schema lib: supports v1 and v2
framework: supports strictly v1
lib: supports strictly v2

Should not only be valid and functional, but also typesafe, though I don't feel like I need to explain to _you_ why and and in what way :P

## Comment by ssalbdivad at 2025-01-16T13:30:23Z

```ts
export const v1 = "~standardV1"
export const v2 = "~standardV2"
```

Again, the specificity of `"~standard"` aside, I can't see how `Symbol.for` is not semantically equivalent to just using the string literal directly.

## Comment by datner at 2025-01-16T13:56:18Z

You can't put it aside, that is the current standard lol [version in the struct](https://github.com/standard-schema/standard-schema/blob/4f63407ce4db69c8bde1a762386b553d050bf3e5/packages/spec/src/index.ts#L19), which is exactly the point,
they differ _only_ semantically, as they eliminate exactly these kinds of design considerations and allow for arbitrary flexibility forwards and backwards. This is a conversation of how to nip a bike shed in the bud before it blossoms (yes, bike sheds are Eukaryotes just like you and me 🥰 ) 

## Comment by ssalbdivad at 2025-01-16T14:08:18Z

Ideally, we will never have to make a breaking change to StandardSchema, but if we do, perhaps we would have to resort to something horrendously unwieldy like `~standardV2`.

The concern you're describing is to do with the string literals being chosen/constants exported rather than a meaningful distinction between string and symbolic keys.

Consider the symbolic shed officially padlocked for now, though would still consider bidirectionality as an extension to be discussed at a later date ⏰💤

## Comment by fabian-hiller at 2025-01-24T00:05:18Z

Thank you all for discussing this. My opinion is that simplicity is preferred in this case and the ability to implement the spec without a dependency. I don't think adding a string key is a big problem. In fact, I think it makes sense because you are intentionally adding new functionality to your schema, and `Object.defineProperty(...)` seems like a good workaround for libraries that don't want this key to be enumerable. When it comes to versioning, I think that schema libraries should only support one specific version. So the `~standard` key is not a problem. On the other hand, third-party libraries should support any version they can. TypeScript makes sure that only supported schemas can be passed, and third-party libraries can call `['~standard'].validate` directly if there has been no breaking change, or use `['~standard'].version` as a discriminator if necessary. I think this should work out in the long run, but if not, we can always rename the key and rethink the whole spec.

## Comment by tim-smart at 2025-01-28T00:05:58Z

If string keys are non-negotiable then I would still like to see support for encoding. Something like:

```ts
export interface Schema<
  out Output,
  in Input = Output
> {
  // use "~standard-v2" for next version etc
  readonly "~standard": {
    readonly vendor: string
    readonly decode: (input: Input) => Result<Output> | Promise<Result<Output>>
  }
}

export interface Issue {
  /** The error message of the issue. */
  readonly message: string
  /** The path of the issue, if any. */
  readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined
}

export interface PathSegment {
  /** The key representing a path segment. */
  readonly key: PropertyKey
}

// extraction helpers
export type Input<S extends Schema<any, any>> = S extends Schema<infer _O, infer _I> ? _I : never
export type Output<S extends Schema<any, any>> = S extends Schema<infer _O, infer _I> ? _O : never

// bidirectional
export interface Encodable<
  in out Output,
  in out Input = Output
> extends Schema<Output, Input> {
  readonly ["~standard"]: Schema<Output, Input>["~standard"] & {
    readonly encode: (input: Output) => Result<Input> | Promise<Result<Input>>
  }
}

// result union
export type Result<A> = Result.Ok<A> | Result.Error

export declare namespace Result {
  export interface Ok<A> {
    readonly ok: true
    readonly value: A
  }

  export interface Error {
    readonly ok: false
    readonly issues: ReadonlyArray<Issue>
  }
}

// apis for consumers
export const decode =
  <Output, Input>(schema: Schema<Output, Input>) => (u: Input): Result<Output> | Promise<Result<Output>> =>
    schema["~standard"].decode(u)

export const decodeUnknown: <Output, Input>(
  schema: Schema<Output, Input>
) => (u: unknown) => Result<Output> | Promise<Result<Output>> = decode as any

export const encode =
  <Output, Input>(schema: Encodable<Output, Input>) => (u: Output): Result<Input> | Promise<Result<Input>> =>
    schema["~standard"].encode(u)

export const encodeUnknown: <Output, Input>(
  schema: Encodable<Output, Input>
) => (u: unknown) => Result<Input> | Promise<Result<Input>> = encode as any
```

## Comment by tim-smart at 2025-01-28T00:10:06Z

Also not sure why the current spec is using the term "validate" as the decoding method name. Quite a lot of schemas contain transformations, so isn't really the correct terminology.

But that is just a nit pick :)

## Comment by ssalbdivad at 2025-01-28T01:09:16Z

@tim-smart You do realize 1.0 was published earlier today, no?

TBH I agree with you on "validate," but where was this feedback yesterday!? 😆

Also, why are we already planning v2!?

This is madness, I tell you... madness.

## Comment by joshmossas-old at 2025-01-28T01:18:19Z

In his defense, I did bring this up previously, but I think it got overlooked due to the debate surrounding symbols 😅

https://github.com/standard-schema/standard-schema/issues/14#issuecomment-2581931181

> I may be alone on this but think we probably need to differentiate between "decoding" and "validation". A serialized version of a type doesn't always match 1-to-1 with the runtime version of a type. I believe in most cases when someone wants to "validate" an unknown input they are checking something that already exists at runtime, which in my view is something distinct from "decoding".

## Comment by ssalbdivad at 2025-01-28T01:28:38Z

@joshmossas 🪦It probably would have just ended up as parse or something which would be more familiar to the broader community, but alas, the inaccuracy will haunt us for the foreseeable future.

One of my primary motivations for making a `Type` a top-level function was not having to name this😅

## Comment by fabian-hiller at 2025-01-30T04:24:21Z

I discussed the name with Colin a few months ago and my idea was to call it `.run`. But in the end `.validate` seemed to be a more intuitive name, even if it is not 100% correct in all cases.

## Comment by datner at 2025-01-30T22:00:04Z

Framing the term 'validate' as "not 100% correct in all cases" presents it as the overwhelmingly common case. I would argue that validation (alone) is actually less common than parsing. In fact, I’m comfortable asserting that validation alone is exceedingly rare. In the context of schema usage, except in the most trivial cases, if any form of validation is being done, it's almost certain to be part of parsing.

I understand why the term seems intuitive. Over the last 2 decades (holy crap), the colloquial language in this field included the verb “validate” to mean “parse from js to js.” I assume this distinction arose mainly because, prior to TypeScript and modern web APIs, there was no significant difference between parsing and validating when handling data. "Parsing" as a description was typically reserved for format-boundary transformations, and without types, you couldn’t extract meaningful information from the interaction more than a simple check could (boolean information).

For example:

```js
// var body = eval("(" + res.data + ")")
var body = JSON.parse(res.data); 

try {
  body = parse(body);
}
// vs
if (validate(body)) ...
```
If anything, parsing as a semantic was confusing, verbose, and mentally expensive in the age of callback-hell with its assert-like behavior.
Moreover, since type information could not be retained everyone used a workflow where validation occurred as data was processed, an issue even today:

```js
if (isFooValid(body.foo)) {
   // ...
   if (foo.bar && foo.bar[0] && foo.bar[0].baz) ...
}
```

So both in functionality and to distinguish itself from parsing raw JSON or XML text into a pojo, the terminology of 'validate' was widely adopted, even when the functionality was actually 'parsing'. With TypeScript, async-await, non-primitive platform natives (looking at you, `Date` 👀 ), parsing suddenly holds significant value. Since as I hinted at before, the most crucial distinction lies in the information that can be derived:

```ts
const isValue: boolean = schema.validate(input);
const value: Foo = schema.parse(input);
```

I recognize that my strong stance on terminology may come across as pedantic 😆, but these distinctions truly matter, particularly for standards. A more thoroughly considered opinion on this topic can be found in [this blog post by Matias Kinnunen](https://mtsknn.fi/blog/parse-dont-just-validate/). Obviously theres also the "parse, don't validate" post, but both are long so there’s also https://github.com/colinhacks/zod/discussions/962. I bet the most people in this forum are already familiar with these resources. So I don’t expect to introduce anything new, But I do want to shed light on these important nuances so they are not just swept aside.


### **THAT SAID,** the bidirectionality is the remaining the important matter at hand here, so to not derail the thread further (as I am VERY prone to doing) I will open a new issue regarding the naming

## Comment by lishaduck at 2025-08-27T02:09:11Z

Zod recently released codecs, so is there any more interest in adding in support here now that a "major" library has bidirectional encoding support? (I use Effect Schema btw 😉)

## Comment by aboodman at 2025-12-05T20:46:50Z

We would really like bidirectionality for use in https://zerosync.dev/.

## Comment by lukeramsden at 2025-12-09T15:49:24Z

No bi-di in Standard Schema is gonna make it much more nasty to support Zod codecs in things like tRPC

## Comment by fabian-hiller at 2025-12-12T04:51:47Z

Maybe a new Standard Codec Schema could make sense. I plan to look into bidirectional encoding for Valibot v2.

## Comment by Vicentesan at 2026-01-19T12:06:50Z

hey, just wanted to add a real world example of why this is needed

i've been working with Elysia (web framework) which claims Standard Schema support. the problem: it can only call `~standard.validate` for decoding requests, but for responses you need the opposite direction (encode)

so if you have an Effect schema like:

```ts
const ResponseEncoder = Schema.transform(
    Schema.Literal("ResponseTypeSide"),
    Schema.Literal("ResponseEncodedSide"),
    { decode: () => "ResponseEncodedSide", encode: () => "ResponseTypeSide" }
)
```

the response goes out wrong because Elysia calls validate (decode) on responses too:

// Handler returns "ResponseTypeSide"
// Response body is "ResponseEncodedSide" <- decoding when it should encode

it's not just missing encode, it's transforming the responses in the wrong direction

same issue with z.date() or Schema.Date, dates should serialize to ISO strings in responses

any web framework doing request/response handling hits this wall. the Encodable proposal would unblock this entire use case. is there anything holding it back?