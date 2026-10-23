version = '3.2.1'
time.modified = '2026-03-29T02:14:24.485Z'
readme = '<h1 align="center">🛡️ Express Zod Safe</h1>\n' +
  '<p align="center">\n' +
  '  <a href="https://www.npmjs.com/package/express-zod-safe" target="_blank">\n' +
  '    <img alt="Downloads" src="https://img.shields.io/npm/dm/express-zod-safe.svg?color=blue&label=Downloads">\n' +
  '  </a>\n' +
  '  <a href="https://www.npmjs.com/package/express-zod-safe" target="_blank">\n' +
  '    <img alt="Version" src="https://img.shields.io/npm/v/express-zod-safe.svg?label=Version">\n' +
  '  </a>\n' +
  '  <a href="https://github.com/AngaBlue/exe/blob/master/LICENSE" target="_blank">\n' +
  '    <img alt="Licence: MIT" src="https://img.shields.io/npm/l/express-zod-safe?color=green&label=Licence" />\n' +
  '  </a>\n' +
  '</p>\n' +
  '\n' +
  'Express Zod Safe is a strict, typesafe middleware designed for Node.js applications, leveraging the robustness of Zod schemas to validate incoming request bodies, parameters, and queries. This package seamlessly integrates with Express.js (or similar frameworks) to provide developers with a typesafe, declarative approach to ensure data integrity and prevent invalid or malicious data from affecting their applications.\n' +
  '\n' +
  "_This package was inspired by Aquila169's [zod-express-middleware](https://github.com/Aquila169/zod-express-middleware) package, and is intended to be a more robust and typesafe alternative._\n" +
  '\n' +
  '## 🔒 Features\n' +
  '\n' +
  ' - **Typesafe**: Built with TypeScript, offering complete typesafe interfaces that enrich your development experience.\n' +
  ' - **Zod Integration**: Utilises Zod schemas for comprehensive and customisable request validation.\n' +
  ' - **Middleware Flexibility**: Easily integrates with Express.js middleware stack, ensuring a smooth validation process without compromising performance.\n' +
  ' - **Parameter & Query Validation**: Validates not just request bodies but also URL parameters and query strings, covering all facets of incoming data.\n' +
  ' - **Error Handling**: Provides detailed, developer-friendly error responses to aid in debugging and informing API consumers.\n' +
  ' - **Simple & Intuitive**: Designed to be easy to use and understand, with a declarative API that is both concise and powerful.\n' +
  '\n' +
  '## ⬇️ Install\n' +
  '\n' +
  'Install this package using your package manager of choice.\n' +
  '\n' +
  '```sh\n' +
  'npm i express-zod-safe\n' +
  '```\n' +
  '\n' +
  '`zod`, `express` and `@types/express` are peer dependencies and must be installed separately.  This means you can bring your own version of these packages, and this package will not force you to use a specific version.\n' +
  '\n' +
  '```sh\n' +
  'npm i zod express && npm i -D @types/express\n' +
  '```\n' +
  '\n' +
  '⚠️ Warning ⚠️: This package is designed to work with Zod `v4.0.0` and above.  If you are using Zod `v3.x.x`, you will need to use `express-zod-safe@1.5.4`.\n' +
  '\n' +
  '## 🛠️ Usage\n' +
  '\n' +
  '```ts\n' +
  "import express from 'express';\n" +
  "import validate from 'express-zod-safe';\n" +
  "import { z } from 'zod';\n" +
  ' \n' +
  'const app = express();\n' +
  'app.use(express.json());\n' +
  ' \n' +
  '// Define your Zod schemas\n' +
  'const params = {\n' +
  '  userId: z.string().uuid(),\n' +
  '};\n' +
  'const query = {\n' +
  '  age: z.coerce.number().optional(), // Given all query params and url params are strings, this will coerce the value to a number.\n' +
  '};\n' +
  'const body = {\n' +
  '  name: z.string(),\n' +
  '  email: z.string().email(),\n' +
  '};\n' +
  ' \n' +
  '// Use the validate middleware in your route\n' +
  "app.post('/user/:userId', validate({ params, query, body }), (req, res) => {\n" +
  '  // Your route logic here\n' +
  "  res.send('User data is valid!');\n" +
  '});\n' +
  '\n' +
  "app.listen(3000, () => console.log('Server running on port 3000'));\n" +
  '```\n' +
  '\n' +
  '**Note:** The `validate` middleware must be used **after** any other middleware that parses/modifies the request body, such as `express.json()` or `express.urlencoded()`.\n' +
  '\n' +
  '### 📄 Using `ValidatedRequest`\n' +
  'When you want to type the `Request` object outside of route handlers, you can use the `ValidatedRequest` utility to infer the validated types. Pass the same Zod schemas you provide to `validate` and the resulting `Request` type will be narrowed accordingly.\n' +
  '\n' +
  '```ts\n' +
  "import type { Response } from 'express';\n" +
  "import validate, { type ValidatedRequest } from 'express-zod-safe';\n" +
  "import { z } from 'zod';\n" +
  '\n' +
  'const bodySchema = z.object({\n' +
  '\ttitle: z.string(),\n' +
  '\tdescription: z.string().max(200)\n' +
  '});\n' +
  '\n' +
  'type CreatePostRequest = ValidatedRequest<{ body: typeof bodySchema }>;\n' +
  '\n' +
  'function createPostHandler(req: CreatePostRequest, res: Response) {\n' +
  '\t// req.body.title -> string\n' +
  '\t// req.body.description -> string (max length validated by Zod)\n' +
  "\tres.json({ message: 'Created!' });\n" +
  '}\n' +
  '\n' +
  "app.post('/posts', validate({ body: bodySchema }), createPostHandler);\n" +
  '```\n' +
  '\n' +
  '### 📦 Custom Error Handling\n' +
  'By default, the `validate` middleware will send a 400 Bad Request response with a JSON body containing the error message.  However, you can provide your own error handling function to customise the error response.\n' +
  '\n' +
  '```ts\n' +
  '// ... extending the previous example\n' +
  '\n' +
  'const handler = (errors, req, res, next) => {\n' +
  '  res.status(400).json({\n' +
  "    message: 'Invalid request data',\n" +
  '    errors: errors.map((error) => error.message),\n' +
  '  });\n' +
  '};\n' +
  '\n' +
  '// Use the validate middleware in your route\n' +
  "app.post('/user/:userId', validate({ handler, params, query, body }), (req, res) => {\n" +
  '  // Your route logic here\n' +
  "  res.send('User data is valid!');\n" +
  '});\n' +
  '```\n' +
  '\n' +
  'If you plan to use the same error handler across every route, use `setGlobalOptions`:\n' +
  '\n' +
  '\n' +
  '```ts\n' +
  "import { setGlobalOptions } from 'express-zod-safe';\n" +
  '\n' +
  'setGlobalOptions({\n' +
  '  handler: (errors, req, res) => {\n' +
  '    // Your error handling here\n' +
  '  }\n' +
  '})\n' +
  '```\n' +
  '\n' +
  '### ⚠️ Usage with Additional Middleware\n' +
  'When using `express-zod-safe` with other middleware, it is important not to explicitly type the `Request` parameter in the middleware, as this will override the inferred type that `express-zod-safe` generates from your validation schemas.  The best way to do this is to instead type your other middleware (or cast them) to `WeakRequestHandler`, a weakly typed version of the `RequestHandler` type from `express`.\n' +
  '\n' +
  '```ts\n' +
  "import validate, { type WeakRequestHandler } from 'express-zod-safe';\n" +
  '\n' +
  '// Use the RequestHandler type, instead of explicitly typing (req: Request, res: Response, next: NextFunction)\n' +
  'const authenticate: WeakRequestHandler = (req, res, next) => {\n' +
  '  // ... perform user authentication\n' +
  '\n' +
  '  next();\n' +
  '};\n' +
  '\n' +
  "app.post('/user/:userId', authenticate, validate({ params, query, body }), (req, res) => {\n" +
  '  // Your validation typing will work as expected here\n' +
  '});\n' +
  '\n' +
  '```\n' +
  '\n' +
  'If you do not control the middleware, such as when you import it from another library, you can instead cast the middleware to `WeakRequestHandler`.\n' +
  '\n' +
  '```ts\n' +
  '// For one off cases...\n' +
  "app.post('/user/:userId', authenticate as WeakRequestHandler, validate({ params, query, body }), (req, res) => {\n" +
  '  // Your validation typing will work as expected here\n' +
  '});\n' +
  '\n' +
  '// For a middleware with a lot of use, aliasing the middleware...\n' +
  'const auth = authenticate as WeakRequestHandler;\n' +
  "app.post('/user/:userId', auth, validate({ params, query, body }), (req, res) => {\n" +
  '  // Your validation typing will work as expected here\n' +
  '});\n' +
  '```\n' +
  '\n' +
  '### ⚠️ URL Parameters & Query Strings Coercion\n' +
  'As mentioned in the example above, all URL parameters and query strings are parsed as strings.  This means that if you have a URL parameter or query string that is expected to be a number, you must use the `z.coerce.number()` method to coerce the value to a number.  This is because Zod will not coerce the value for you, and will instead throw an error if the value is not a string.\n' +
  '\n' +
  '```ts\n' +
  'const params = {\n' +
  '  userId: z.coerce.number(),\n' +
  '};\n' +
  '\n' +
  "app.get('/user/:userId', validate({ params }), (req, res) => {\n" +
  '  // req.params.userId -> number\n' +
  '});\n' +
  '```\n' +
  '\n' +
  '### ⚠️ Missing Validation Schemas\n' +
  'If you do not provide a validation schema for a particular request component (e.g. `params`, `query`, or `body`), then that component will be assumed to be empty.  This means that requests with non-empty components will be rejected, and requests with empty components will be accepted.  The types on the `req` object will also reflect this, and will be an empty object `{}` if the component is not provided.\n' +
  '\n' +
  '```ts\n' +
  'const body = {\n' +
  '  name: z.string(),\n' +
  '  email: z.string().email(),\n' +
  '};\n' +
  '\n' +
  "app.post('/user', validate({ body }), (req, res) => {\n" +
  '  // req.body.name -> string\n' +
  '  // req.body.email -> string\n' +
  "  // req.params.age -> Property 'age' does not exist on type unknown\n" +
  "  // req.query.age -> Property 'age' does not exist on type unknown\n" +
  '});\n' +
  '```\n' +
  '\n' +
  "This behaviour is intentional and ensures that you do not try to access or use a property that does not exist on the `req` object.  If you'd prefer to allow any property for any given request component, you can do so by setting a loose validation schema with `z.any()`.\n" +
  '\n' +
  '```ts\n' +
  'const body = {\n' +
  '  name: z.string(),\n' +
  '  email: z.string().email(),\n' +
  '};\n' +
  '\n' +
  'const params = z.any()\n' +
  '\n' +
  "app.post('/user', validate({ body, params }), (req, res) => {\n" +
  '  // req.body.name -> string\n' +
  '  // req.body.email -> string\n' +
  '  // req.params.age -> any\n' +
  "  // req.query.age -> Property 'age' does not exist on type unknown\n" +
  '});\n' +
  '```\n' +
  '\n' +
  'To enable this behaviour globally without the need to explicitly set `z.any()` in each instance, use `setGlobalOptions`:\n' +
  '\n' +
  '```ts\n' +
  "import { setGlobalOptions } from 'express-zod-safe';\n" +
  '\n' +
  'setGlobalOptions({\n' +
  "  missingSchemaBehavior: 'any'\n" +
  '});\n' +
  '```\n' +
  '\n' +
  '### ⚠️ Default Schema Object Strictness\n' +
  'When a plain JavaScript object is supplied instead of a Zod schema object, the default behaviour is to assume `z.strictObject`.  This means that additional keys will cause validation to fail.  To override this behaviour, use `z.object()` explicitly:\n' +
  '\n' +
  '```ts\n' +
  '// z.object allows additional keys\n' +
  'const body = z.object({\n' +
  '  name: z.string(),\n' +
  '  email: z.string().email(),\n' +
  '});\n' +
  '\n' +
  "app.post('/user', validate({ body }), (req, res) => {\n" +
  '  // ...\n' +
  '});\n' +
  '```\n' +
  '\n' +
  '*Note: in both instances, additional keys will be stripped from the output.  The difference lies in whether additional keys throw a validation error or are silently removed.*\n' +
  '\n' +
  'To enable this behaviour globally without the need to explicitly set `z.object()` in each instance, use `setGlobalOptions`:\n' +
  '\n' +
  '```ts\n' +
  "import { setGlobalOptions } from 'express-zod-safe';\n" +
  '\n' +
  'setGlobalOptions({\n' +
  "  defaultSchemaObject: 'lax'\n" +
  '});\n' +
  '```\n' +
  '\n' +
  '## ⭐️ Show your support\n' +
  '\n' +
  'Give a ⭐️ on GitHub if this project helped you!\n' +
  '\n' +
  '## 📝 License\n' +
  '\n' +
  'Copyright © [Ang'... 141 more characters
