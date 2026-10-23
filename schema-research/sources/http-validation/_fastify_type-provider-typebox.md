version = '6.3.0'
time.modified = '2026-10-12T08:17:24.739Z'
readme = '# @fastify/type-provider-typebox\n' +
  '\n' +
  '[![CI](https://github.com/fastify/fastify-type-provider-typebox/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/fastify/fastify-type-provider-typebox/actions/workflows/ci.yml)\n' +
  '[![NPM version](https://img.shields.io/npm/v/@fastify/type-provider-typebox)](https://www.npmjs.com/package/@fastify/type-provider-typebox)\n' +
  '[![neostandard javascript style](https://img.shields.io/badge/code_style-neostandard-brightgreen?style=flat)](https://github.com/neostandard/neostandard)\n' +
  '\n' +
  'A Type Provider for [Typebox](https://github.com/sinclairzx81/typebox).\n' +
  '\n' +
  '## Installation\n' +
  '\n' +
  '```sh\n' +
  'npm i typebox # Required as peer dependency\n' +
  'npm i @fastify/type-provider-typebox\n' +
  '```\n' +
  '\n' +
  '### Compatibility\n' +
  '\n' +
  '| Plugin version | Fastify version |\n' +
  '| ---------------|-----------------|\n' +
  '| `>=5.x`        | `^5.x`          |\n' +
  '| `>=1.x <5.x`   | `^4.x`          |\n' +
  '\n' +
  '\n' +
  'Please note that if a Fastify version is out of support, then so are the corresponding versions of this plugin\n' +
  'in the table above.\n' +
  "See [Fastify's LTS policy](https://github.com/fastify/fastify/blob/main/docs/Reference/LTS.md) for more details.\n" +
  '\n' +
  '## Overview\n' +
  '\n' +
  'This package provides enhanced support for TypeBox by integrating it with the Fastify [Type Provider](https://fastify.dev/docs/latest/Reference/Type-Providers/) infrastructure. It provides a re-export of the TypeBox `Type.*` builder for convenience as well as providing additional utility types and optional validation infrastructure that can be useful when leveraging TypeBox with Fastify.\n' +
  '\n' +
  '## Usage\n' +
  '\n' +
  '```ts\n' +
  "import Fastify from 'fastify'\n" +
  "import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox'\n" +
  '\n' +
  'const fastify = Fastify().withTypeProvider<TypeBoxTypeProvider>()\n' +
  '```\n' +
  '\n' +
  'Note that the following will not work:\n' +
  '\n' +
  '```ts\n' +
  "import Fastify from 'fastify'\n" +
  "import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox'\n" +
  '\n' +
  'const fastify = Fastify()\n' +
  '\n' +
  'fastify.withTypeProvider<TypeBoxTypeProvider>()\n' +
  '```\n' +
  '\n' +
  '## Example\n' +
  '\n' +
  '```ts\n' +
  "import Fastify from 'fastify'\n" +
  "import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'\n" +
  '\n' +
  '// This package re-export Typebox package\n' +
  '// but you can also use any builders imported\n' +
  '// directly from typebox\n' +
  "import { Type } from 'typebox'\n" +
  '\n' +
  '\n' +
  'const fastify = Fastify().withTypeProvider<TypeBoxTypeProvider>()\n' +
  '\n' +
  "fastify.post('/', {\n" +
  '  schema: {\n' +
  '    body: Type.Object({\n' +
  '      x: Type.String(),\n' +
  '      y: Type.Number(),\n' +
  '      z: Type.Boolean()\n' +
  '    })\n' +
  '  }\n' +
  '}, (req) => {\n' +
  '  // The `x`, `y`, `z` types are automatically inferred\n' +
  '  const { x, y, z } = req.body\n' +
  '})\n' +
  '```\n' +
  '\n' +
  '## Type definition of FastifyRequest & FastifyReply + TypeProvider\n' +
  '```ts\n' +
  "import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';\n" +
  "import { Type } from '@fastify/type-provider-typebox';\n" +
  'import type {\n' +
  '  ContextConfigDefault,\n' +
  '  FastifyBaseLogger,\n' +
  '  FastifyInstance,\n' +
  '  FastifyReply,\n' +
  '  FastifyRequest,\n' +
  '  RawReplyDefaultExpression,\n' +
  '  RawRequestDefaultExpression,\n' +
  '  RawServerDefault,\n' +
  "} from 'fastify';\n" +
  "import type { RouteGenericInterface } from 'fastify/types/route';\n" +
  "import type { FastifySchema } from 'fastify/types/schema';\n" +
  '\n' +
  'export type FastifyTypeBox = FastifyInstance<\n' +
  '  RawServerDefault,\n' +
  '  RawRequestDefaultExpression,\n' +
  '  RawReplyDefaultExpression,\n' +
  '  FastifyBaseLogger,\n' +
  '  TypeBoxTypeProvider\n' +
  '>;\n' +
  '\n' +
  'export type FastifyRequestTypeBox<TSchema extends FastifySchema> = FastifyRequest<\n' +
  '  RouteGenericInterface,\n' +
  '  RawServerDefault,\n' +
  '  RawRequestDefaultExpression,\n' +
  '  TSchema,\n' +
  '  TypeBoxTypeProvider\n' +
  '>;\n' +
  '\n' +
  'export type FastifyReplyTypeBox<TSchema extends FastifySchema> = FastifyReply<\n' +
  '  RouteGenericInterface,\n' +
  '  RawServerDefault,\n' +
  '  RawRequestDefaultExpression,\n' +
  '  RawReplyDefaultExpression,\n' +
  '  ContextConfigDefault,\n' +
  '  TSchema,\n' +
  '  TypeBoxTypeProvider\n' +
  '>;\n' +
  '\n' +
  'export const CreateProductSchema = {\n' +
  '  body: Type.Object({\n' +
  '    name: Type.String(),\n' +
  '    price: Type.Number(),\n' +
  '  }),\n' +
  '  response: {\n' +
  '    201: Type.Object({\n' +
  '      id: Type.Number(),\n' +
  '    }),\n' +
  '  },\n' +
  '};\n' +
  '\n' +
  'export const CreateProductHandler = (\n' +
  '  req: FastifyRequestTypeBox<typeof CreateProductSchema>,\n' +
  '  reply: FastifyReplyTypeBox<typeof CreateProductSchema>,\n' +
  ') => {\n' +
  '  // The `name` and `price` types are automatically inferred\n' +
  '  const { name, price } = req.body;\n' +
  '\n' +
  '  // The response body type is automatically inferred\n' +
  "  reply.status(201).send({ id: 'string-value' });\n" +
  "  //                       ^? error TS2322: Type 'string' is not assignable to type 'number'.\n" +
  '};\n' +
  '```\n' +
  '\n' +
  '\n' +
  '## Plugin definition\n' +
  '\n' +
  '> **Note**\n' +
  '> When using plugin types, withTypeProvider is not required in order to register the plugin\n' +
  '\n' +
  '```ts\n' +
  "import { Type, FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'\n" +
  '\n' +
  'const plugin: FastifyPluginAsyncTypebox = async function(fastify, _opts) {\n' +
  "  fastify.get('/', {\n" +
  '    schema: {\n' +
  '      body: Type.Object({\n' +
  '        x: Type.String(),\n' +
  '        y: Type.Number(),\n' +
  '        z: Type.Boolean()\n' +
  '      })\n' +
  '    }\n' +
  '  }, (req) => {\n' +
  '    /// The `x`, `y`, and `z` types are automatically inferred\n' +
  '    const { x, y, z } = req.body\n' +
  '  });\n' +
  '}\n' +
  '```\n' +
  '\n' +
  '## Usage with JavaScript and JSDoc\n' +
  '\n' +
  'In plain JavaScript projects type-checked with `checkJs`, the type provider can be\n' +
  'applied with a JSDoc type cast:\n' +
  '\n' +
  '```js\n' +
  "import Fastify from 'fastify'\n" +
  "import { Type } from '@fastify/type-provider-typebox'\n" +
  '\n' +
  "/** @typedef {import('fastify').FastifyInstance<import('fastify').RawServerDefault, import('fastify').RawRequestDefaultExpression, import('fastify').RawReplyDefaultExpression, import('fastify').FastifyBaseLogger, import('@fastify/type-provider-typebox').TypeBoxTypeProvider>} FastifyTypeBox */\n" +
  '\n' +
  'const fastify = /** @type {FastifyTypeBox} */ (Fastify())\n' +
  '\n' +
  "fastify.post('/', {\n" +
  '  schema: {\n' +
  '    body: Type.Object({ x: Type.String() })\n' +
  '  }\n' +
  '}, (req) => {\n' +
  '  const { x } = req.body // inferred as string\n' +
  '})\n' +
  '```\n' +
  '\n' +
  'For plugins, annotate the function with the plugin types instead:\n' +
  '\n' +
  '```js\n' +
  "/** @type {import('@fastify/type-provider-typebox').FastifyPluginAsyncTypebox} */\n" +
  'const plugin = async (fastify) => {\n' +
  '  // routes registered here get full type inference\n' +
  '}\n' +
  '```\n' +
  '\n' +
  '## Type Compiler\n' +
  '\n' +
  'TypeBox provides an optional type compiler that perform very fast runtime type checking for data received on routes. Note this compiler is limited to types expressable through the TypeBox `Type.*` namespace only. To enable this compiler, you can call `.setValidatorCompiler(...)` with the `TypeBoxValidatorCompiler` export provided by this package.\n' +
  '\n' +
  '```ts\n' +
  "import { Type, TypeBoxTypeProvider, TypeBoxValidatorCompiler } from '@fastify/type-provider-typebox'\n" +
  "import Fastify from 'fastify'\n" +
  '\n' +
  'const fastify = Fastify().setValidatorCompiler(TypeBoxValidatorCompiler)\n' +
  '\n' +
  "fastify.withTypeProvider<TypeBoxTypeProvider>().get('/', {\n" +
  '  schema: {\n' +
  '    querystring: Type.Object({\n' +
  '      x: Type.String(),\n' +
  '      y: Type.String(),\n' +
  '      z: Type.String()\n' +
  '    })\n' +
  '  }\n' +
  '}, (req) => {\n' +
  '  const { x, y, z } = req.query\n' +
  '})\n' +
  '```\n' +
  '\n' +
  'For additional information on this compiler, please refer to the TypeBox documentation located [here](https://github.com/sinclairzx81/typebox#compile).\n' +
  '\n' +
  '## Register formats\n' +
  '\n' +
  'The Format module of TypeBox can be used to register string formats.\n' +
  '\n' +
  '```ts\n' +
  "import { Format } from '@fastify/type-provider-typebox'\n" +
  '\n' +
  "Format.Set('custom-format', (value) => value === 'custom');\n" +
  "Format.Set('regex-format', (value) => /^my-format$/.test(value));\n" +
  '```\n' +
  '\n' +
  'See the [official TypeBox documentation](https://sinclairzx81.github.io/typebox/#/docs/format/overview) for additional information on formats.\n' +
  '\n' +
  '### String formats with TypeBox\n' +
  '\n' +
  'TypeBox provides built-in string formats. Call `registerAjvFormats()` before\n' +
  'compiling schemas to use the string formats from `ajv-formats` with\n' +
  "`TypeBoxValidatorCompiler`. This registers 22 formats in TypeBox's global format\n" +
  'registry, replacing any existing validators with the same names.\n' +
  '\n' +
  '```ts\n' +
  "import { registerAjvFormats } from '@fastify/type-provider-typebox'\n" +
  '\n' +
  'registerAjvFormats()\n' +
  '```\n' +
  '\n' +
  "The helper uses `ajv-formats`' full validation mode. Its rules differ from\n" +
  "TypeBox's defaults: `url` rejects `http://localhost:3000`, `email` rejects\n" +
  '`user@localhost`, `date-time` accepts a space separator, and `uuid` accepts the\n' +
  '`urn:uuid:` prefix. `password` and `binary` accept any string.\n' +
  '\n' +
  'Numeric formats (`int32`, `int64`, `float`, and `double`) are not registered because\n' +
  "TypeBox's format registry validates strings. Register custom validators with\n" +
  '`Format.Set()` after calling the helper to override individual formats.\n' +
  '\n' +
  '## License\n' +
  '\n' +
  'Licensed under [MIT](./LICENSE).\n'
