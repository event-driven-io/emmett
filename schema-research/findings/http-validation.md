# Request validation in Hono, Express, Fastify and NestJS

Research for Q39 in [qa.md](../qa.md). Oskar asked how the web frameworks Emmett binds to validate requests with schemas, so that command definitions can offer the same, including an easy way that doesn't need `.pick()`. Collected on 2026-10-23. Sources are in [sources/http-validation/](../sources/http-validation/). Download counts are npm weekly downloads for 2026-10-12 to 2026-10-18 (`npm-downloads-2026-10-23.txt`).

## Summary

- All four validate each part of the request separately: body, route params, query, headers. None validates one object built from several parts, and none knows about commands. The command is built in the handler afterwards.
- Hono and NestJS (through nestjs-zod) accept schemas from other libraries. Hono takes any Standard Schema. nestjs-zod needs only a `parse` method. A definition's `data` schema would plug into both as it is.
- Fastify validates JSON Schema natively. Types come from a type provider, and there is no established Standard Schema type provider. A definition's JSON Schema plugs into validation, but types would need an Emmett type provider.
- Express has no built-in validation. The schema middlewares are small and Zod-only. Emmett's Express binding would need its own middleware.

## Hono 4.13.8

Validation targets, from `hono/dist/types/types.d.ts:539` in Emmett's `node_modules` (verified):

```ts
export type ValidationTargets = {
  json: any;
  form: Record<string, T | T[]>;
  query: Record<string, string | string[]>;
  param: Record<P, ...>;
  header: Record<RequestHeader | CustomHeader, string>;
  cookie: Record<string, string>;
};
```

`@hono/standard-validator` 0.4.0 (1.1M downloads) takes any Standard Schema, one target per middleware (verified, `hono-standard-validator-0.4.0-README.md`):

```ts
app.post('/author', sValidator('json', schema), (c) => {
  const data = c.req.valid('json')
  ...
})
```

An optional hook decides the response on failure: `sValidator('json', schema, (result, c) => { if (!result.success) return c.text('Invalid!', 400) })`. `@hono/zod-validator` 0.9.1 (3.2M downloads) is the same for Zod only.

Several parts of one request mean several middlewares, for example `sValidator('param', ...)` and `sValidator('json', ...)` on the same route.

## Express

No built-in validation. Middlewares found:

- `express-validator` (889K downloads): its own validation chains, not schema-based.
- `zod-express-middleware` (18.7K, last published 2022-05-25) and `express-zod-safe` 3.2.1 (9.2K): Zod only. `express-zod-safe` takes one schema per part, and accepts a plain object of field schemas as a shorthand (verified, `express-zod-safe.md`):

```ts
const params = { userId: z.string().uuid() };
const query = { age: z.coerce.number().optional() };
const body = { name: z.string(), email: z.string().email() };

app.post('/user/:userId', validate({ params, query, body }), (req, res) => { ... });
```

It also exports `ValidatedRequest<{ body: typeof bodySchema }>` to type a handler written outside the route.

## Fastify

Fastify validates route schemas with ajv as JSON Schema, per part: `body`, `params`, `querystring`, `headers`, and `response`. Types come from a type provider:

- `fastify-type-provider-zod` 7.0.0 (806K downloads) replaces the validator and serializer compilers with Zod's (verified, `fastify-type-provider-zod-7.0.0-README.md`):

```ts
app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

app.withTypeProvider<ZodTypeProvider>().route({
  method: 'GET',
  url: '/',
  schema: { querystring: z.object({ name: z.string().min(4) }), response: { 200: z.string() } },
  handler: (req, res) => { res.send(req.query.name); },
});
```

- `@fastify/type-provider-typebox` 6.3.0 (347K) and `@fastify/type-provider-json-schema-to-ts` 5.0.1 (30K) infer types from TypeBox or `as const` JSON Schema.
- Standard Schema providers exist but are barely used: `fastify-type-provider-standard-schema` 0.2.0 (11 downloads), `fastify-standard-schema` 5.0.4 (3).

## NestJS, checked through nestjs-zod 5.5.0 (808K downloads)

`createZodDto(schema)` turns a schema into a DTO class, and `ZodValidationPipe` validates `@Body()`, `@Param()` and `@Query()` against it (verified, `nestjs-zod.md`):

```ts
class CredentialsDto extends createZodDto(CredentialsSchema) {}

@Controller('auth')
class AuthController {
  async signIn(@Body() credentials: CredentialsDto) {}
}
```

The README says the schema can come from any Zod version: "The only requirement is that the schema has a method called `parse`". A definition's `data` schema with `parse` would work. The DTO has to be a class because NestJS reads parameter types through decorators; that class lives in the user's NestJS code, not in Emmett.

## What this means for command definitions

- Exposing the command's `data` schema as a Standard Schema with `parse` and JSON Schema covers Hono, NestJS and Fastify validation when the body is the whole `data`.
- When the body is only part of `data`, as in Emmett's own Hono sample (`shoppingCartId` from the route, `unitPrice` computed), every framework expects the user to write a separate schema per part, or derive one with `.pick()` / `.omit()`.
- No framework builds one object from route params plus body and validates it once. An Emmett helper that does that would be new, not a copy of an existing pattern.

## Not covered

Elysia, oRPC, ts-rest and Wolverine were left out at Oskar's request.
