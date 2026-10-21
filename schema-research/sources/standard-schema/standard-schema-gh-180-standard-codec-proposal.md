# #180: Add Standard Codec spec proposal
Source: https://github.com/standard-schema/standard-schema/pull/180 (state: open, created 2026-08-27T17:09:00Z, by colinhacks)

Proposes **Standard Codec**, a fourth interface in the family: a Standard Schema that can also run its transformation in reverse.

```ts
// decode: string -> Date
codec["~standard"].validate("2025-01-01T00:00:00.000Z");
// => { value: Date("2025-01-01T00:00:00.000Z") }

// encode: Date -> string
codec["~standard"].encode(new Date("2025-01-01T00:00:00.000Z"));
// => { value: "2025-01-01T00:00:00.000Z" }
```

## Why

Serialization boundaries are bidirectional. A framework that reads a `Date` out of a query string usually has to write one back into a URL; a framework that parses a request body usually has to serialize the response. Standard Schema only describes the read direction, so tools that need the write direction hard-code an adapter per library, ask the user for the inverse transform, or reject transforming schemas outright.

Zod 4.1 codecs and Effect Schema both already model this. There is no standard shape for a consumer to accept.

## The design

`StandardCodecV1.Props` extends `StandardSchemaV1.Props` and adds one method:

```ts
/** Encodes unknown values into the input type. This is the inverse of `validate`. */
readonly encode: (
  value: unknown,
  options?: StandardCodecV1.Options | undefined
) => Result<Input> | Promise<Result<Input>>;
```

Four consequences fall out of that:

| | |
| --- | --- |
| No `decode` method | Validation already _is_ the decode direction — `unknown -> Result<Output>`. A second method with the same job would be two sources of truth. |
| Codecs are schemas | Every `StandardCodecV1` satisfies `StandardSchemaV1`, so it works unmodified with every tool that accepts one today. |
| Encoding mirrors validation | Same `unknown` parameter, same `Result` union, same `issues` on failure, same optional `Promise`. |
| Non-transforming schemas are free | When input and output are identical, encoding can delegate straight to validation. |

## Open questions

1. **Extending Standard Schema vs staying orthogonal.** Standard JSON Schema shares only the `StandardTypedV1` base, and the FAQ makes a point of the specs being orthogonal traits. Encoding is different: it is defined as the inverse of validation, so the two can't be separated. The alternative — extend `StandardTypedV1` and declare both `decode` and `encode` — duplicates `validate` and loses free compatibility with existing integrators. Worth confirming that the asymmetry with Standard JSON Schema is acceptable.
2. **Round-tripping.** Currently a documented expectation, not a type-level or runtime guarantee. Lossy codecs are told to document where it breaks down.
3. **Naming.** Chose `encode` for symmetry with the Zod/Effect vocabulary. Alternatives: `reverse`, `serialize`.
4. **Implementer table.** Left empty. Zod codecs map onto this directly and would presumably be the first entry.

## Contents

- `packages/spec/codec.md` — the spec document, structured like `json-schema.md`
- `packages/spec/src/index.ts` and `packages/spec/README.md` — the interface
- `packages/examples/codec-implement.ts` and `codec-integrate.ts` — an ISO-datetime codec and a generic consumer
- `packages/web/app/codec/page.tsx` — the site page, plus a card on the index

No version bump in `package.json` / `jsr.json` — that belongs to the release, not the proposal.

Refs #14


## Comment by cloudflare-workers-and-pages[bot] at 2026-08-27T17:10:55Z

## Deploying standard-schema with &nbsp;<a href="https://pages.dev"><img alt="Cloudflare Pages" src="https://user-images.githubusercontent.com/23264/106598434-9e719e00-654f-11eb-9e59-6167043cfa01.png" width="16"></a> &nbsp;Cloudflare Pages

<table><tr><td><strong>Latest commit:</strong> </td><td>
<code>865e703</code>
</td></tr>
<tr><td><strong>Status:</strong></td><td>&nbsp;✅&nbsp; Deploy successful!</td></tr>
<tr><td><strong>Preview URL:</strong></td><td>
<a href='https://e4103e26.standard-schema.pages.dev'>https://e4103e26.standard-schema.pages.dev</a>
</td></tr>
<tr><td><strong>Branch Preview URL:</strong></td><td>
<a href='https://codec.standard-schema.pages.dev'>https://codec.standard-schema.pages.dev</a>
</td></tr>
</table>

[View logs](https://dash.cloudflare.com/?to=/3eef35e2fc9f974f5b2dfaad9f021bbe/pages/view/standard-schema/e4103e26-8ce8-443c-b024-0cc33bdf8be0)


## Comment by lishaduck at 2026-09-06T23:31:06Z

> No `decode` method |	Validation already _is_ the decode direction — `unknown -> Result<Output>`. A second method with the same job would be two sources of truth.

Is this a good time to revisit #24? I haven't read the spec, just the blurb in the description, but I'd think we'd want something similar to Zod's `parse`/`decode` dichotomy or Effect's `decode`/`decodeUnknown`, which I read that as explicitly disavowing.
I know we don't want to drop `validate` support, which is reasonable—[^1]it's a different use-case. But if we have to update to add `~standard.encode` anyway, I don't see how adding a (potentially cheaper) `~standard.decode` hurts anything.

[^1]: All 1 em-dashes authored by me, Eli.