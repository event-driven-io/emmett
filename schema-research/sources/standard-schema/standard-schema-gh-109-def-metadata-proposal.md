# #109: Proposal: Add .def Metadata to standard-schema
Source: https://github.com/standard-schema/standard-schema/issues/109 (state: closed, created 2025-08-02T18:56:14Z, by ReverseGem7)

Add .def field to `~standard` like:

- Zod (v4): `schema._zod.def`
- Zod (v3): `schema._def`
- ArkType: `schema.toString()`
- Valibot: `schema.type`

## Comment by fabian-hiller at 2025-08-06T02:40:06Z

Hey 👋 Thank you for creating this issue. How would you use this field?

## Comment by ReverseGem7 at 2025-08-06T13:45:33Z

Hi Fabian! Thanks for the question.
I would use the .def field to autogenerate documentation based on the provided schema.

## Comment by ReverseGem7 at 2025-08-06T13:59:39Z

I’ve also seen some proposals requesting fields like `default` or `optional`, which could be included in this `.def` metadata.
Additionally, functions like `toJsonSchema` could rely on this field without needing to be built into the core libraries.

## Comment by cowboyd at 2025-08-19T14:57:01Z

+1 for this use case. In my case which is for a CLI, when generating a parser + help documentation based on a schema you want to have:

1. a general description in the event that a user does not provide one. For example a port might have the string `"port number between 1024 and 65535"`
2. Is it optional or not? In this case, you can actually fudge it by validating against `undefined`, and if it passes then it is, by definition, optional
3. What is the parseable primitive type. I.e. `string`, `boolean`, `number`, `object`.
4. Is `Array.isArray()` guaranteed to be true if a valid value is defined?
5. What is the default value (if any)

Right now, I can use StandardSchema for the validation and for (2) via the workaround I described, but as it stands, I have to ask the user to provide (1),(3),(4), and (5) by hand which feels redundant.

## Comment by Tyler-Petrov at 2025-09-29T18:21:43Z

It would be nice to support a field `title` and `description`.

Valibot:
```typescript
const field = v.pipe(
    v.string(),
    v.title('Username'),
    v.description(
        'A username must be between 4 and 16 characters long and can only contain letters, numbers, underscores and hyphens.'
    )
)
```

## Comment by cowboyd at 2025-09-30T14:39:35Z

Agree with a description. Title is a bit tricky because the same schema can be used in any number of contexts without modification.

## Comment by lishaduck at 2025-10-13T12:50:01Z

For titles etc, Effect uses a [generic "annotations" field](https://effect.website/docs/schema/annotations/), which feels like it makes more sense to codify than an actual title field in Standard Schema.

## Comment by colinhacks at 2025-12-16T18:39:55Z

If the structure of the def is library-specific then it has no place on `~standard`. You'd need to do all sorts of library specific logic to do anything useful, so you might as well special-case the "def accessing" logic too.

The "right way" to make this useful is some kind of "Standard AST" spec which has been floated but isn't in active development.

## Comment by cowboyd at 2025-12-17T21:20:28Z

@colinhacks I'm not sure I follow. Wouldn't the idea be to adapt library specific metadata into a standard meta schema in the same way that library specific validation is adapted into a standard. In other words, if the def adapted, then it is not library-specific, and then there is no need to do all sorts of library-specific logic.
 

## Comment by fabian-hiller at 2026-01-03T01:25:49Z

Is the `.def` idea something that our new Standard JSON Schema spec now covers? https://standardschema.dev/json-schema